// Agentic OS — local command center for Claude Code + the Obsidian vault.
// Zero dependencies: node server.js [--open]. The Electron app (electron/main.js) calls start() in-process.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const usage = require("./lib/usage");
const { createRunner } = require("./lib/runner");
const { createIntegrations } = require("./lib/integrations");
const { createCloudSync } = require("./lib/cloudsync");
const { createTelegram } = require("./lib/telegram");
const { createTgApp } = require("./lib/tgapp");
const { createInbox } = require("./lib/inbox");
const { createWatchers } = require("./lib/watcher");
const { createLearnings } = require("./lib/learnings");
const { createQuality } = require("./lib/quality");
const { createSearch } = require("./lib/search");
const { createSessions } = require("./lib/sessions");
const { checkMap } = require("./lib/mapcheck");
const { createOllama } = require("./lib/ollama");
const { createSemantic } = require("./lib/semantic");
const { buildBrain } = require("./lib/brain");
const limits = require("./lib/limits");

const { findHome, loadConfig } = require("./lib/home");

// APP holds the code and pages; HOME holds config.json and data/ (lib/home.js).
const APP = __dirname;
const HOME = findHome();
const cfg = loadConfig(HOME);
const DATA = path.join(HOME, "data");
fs.mkdirSync(DATA, { recursive: true });
const vault = cfg.vault.path;
// Created only once this process owns the port, so a second instance never runs a second scheduler.
let runner;
let integrations;
let cloudSync;
let telegram;
let inbox;
let watchers;
let hooks = {};
const DAY = 24 * 3600e3;
const learnings = createLearnings(cfg);
const quality = createQuality(cfg, DATA);
// vault.searchSkip: folders kept out of search, e.g. a raw archive already merged into the wiki.
const vaultSearch = createSearch(vault, { skipDirs: [cfg.vault.runsFolder, ...(cfg.vault.searchSkip || [])] });
const sessions = createSessions(usage.costOf, [DATA]); // quality checks run in data/
const ollama = createOllama(cfg, DATA);
const semantic = createSemantic(cfg, DATA, ollama);
// Vault search: hybrid (meaning + keywords) when semantic search is on and indexed, else keywords.
// Ollama is started for the query and stopped again after a few idle minutes (lib/ollama.js).
const searchVault = (q, n = 12) => semantic.search(q, (qq, k) => vaultSearch.search(qq, k), n);

// Which skill produced a vault file: a run note, or a cloud report copied by a cloudSync rule.
function skillForFile(rel) {
  const run = runner.list().find((r) => r.note === rel);
  if (run) return run.skill;
  const rule = ((cfg.cloudSync || {}).copy || []).find((c) => rel.startsWith(`${c.to}/`));
  return rule ? rule.skill : null;
}

// 👍/👎 on an output: saved on the run and appended to the skill's learnings.md. Cloud skills
// read their learnings from the reports repo, so those get pushed there too.
function giveFeedback(body) {
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  if (!rating) throw new Error("rating must be up or down");
  const note = String(body.note || "").slice(0, 500);
  let skill;
  let source;
  if (body.run) {
    const r = runner.updateRun(String(body.run), { feedback: { rating, note, at: new Date().toISOString() } });
    skill = r.skill;
    source = r.note;
  } else if (body.file) {
    source = String(body.file);
    skill = skillForFile(source);
  }
  if (!skill) throw new Error("no skill is linked to this item");
  const content = learnings.add(skill, { rating, note, source });
  if (source) inbox.markRead(source);
  if ((cfg.cloudRoutines || []).some((r) => r.skill === skill) && (cfg.cloudSync || {}).repo) {
    cloudSync
      .pushFile(`learnings/${skill}.md`, content, `learnings: ${skill}`)
      .then((pushed) => pushed && console.log(`[learnings] pushed ${skill} to the reports repo`))
      .catch((e) => console.log(`[learnings] push failed: ${e.message}`));
  }
  return { ok: true, skill };
}

// Grade a finished run against its skill's checks (config skills[].checks) with a small model.
function checkQuality(run, skill, result) {
  if (run.status !== "COMPLETE" || !(skill.checks || []).length || quotaGuard().blocked) return;
  runner.updateRun(run.id, { check: { pending: true } });
  quality.evaluate(skill, result).then((check) => {
    runner.updateRun(run.id, { check });
    console.log(`[quality] ${skill.name}: ${check.pass === true ? "pass" : check.pass === false ? "FAIL" : "unknown"}`);
    if (check.pass === false) {
      const fa = uiSettings().language === "fa";
      telegram.notice({
        emoji: "⚠️",
        title: `${labelFor(skill.name, skill.label)} — ${fa ? "کیفیت قبول نشد" : "quality check failed"}`,
        lines: check.failed,
        tone: "warn",
        crumb: fa ? "کنترل کیفیت" : "Quality check",
      });
    }
  });
}

// Memory map check (deterministic): on start and nightly; problems go to Telegram once a day.
let mapState = null;
let mapAlertDay = "";
function runMapCheck(alert) {
  mapState = checkMap(vault);
  const today = dayKey(new Date());
  if (alert && !mapState.ok && mapAlertDay !== today && telegram) {
    mapAlertDay = today;
    const fa = uiSettings().language === "fa";
    telegram.notice({
      emoji: "🗺️",
      title: `${fa ? "نقشهٔ حافظه مشکل دارد" : "Memory map problems"} (${mapState.problems.length})`,
      lines: mapState.problems.slice(0, 8),
      tone: "warn",
      crumb: fa ? "نقشهٔ حافظه" : "Memory map",
    });
  }
  return mapState;
}

// Brain view graph, cached briefly; its node paths are the only ones /api/open/path may open.
let brainCache = null;
function brain() {
  if (!brainCache || Date.now() - brainCache.builtAt > 60e3) {
    brainCache = buildBrain({
      vault,
      map: mapState || runMapCheck(false),
      skills: runner.skills(),
      runs: runner.list(),
      cloudRoutines: cfg.cloudRoutines,
    });
  }
  return brainCache;
}

// Telegram /note: append a line to today's daily note (append-only, no AI).
function addNoteFromTelegram(text) {
  const d = new Date();
  const rel = path.posix.join(cfg.vault.dailyFolder || "", `${dayKey(d)}.md`);
  const abs = insideVault(rel);
  const heading = "## 📥 از تلگرام";
  const old = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  const prefix = old.includes(heading) ? "" : `${old && !old.endsWith("\n") ? "\n" : ""}\n${heading}\n`;
  fs.appendFileSync(abs, `${prefix}- ${pad(d.getHours())}:${pad(d.getMinutes())} ${text.replace(/\s+/g, " ").trim()}\n`, "utf8");
  return rel;
}

// Telegram alert when live plan usage crosses a threshold (once per window and threshold).
const ALERTS_FILE = path.join(DATA, "alerts.json");
function checkQuotaAlerts() {
  const a = cfg.quotaAlerts || {};
  if (!a.enabled || !telegram) return;
  const live = limits.live();
  let sent = {};
  try {
    sent = JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8"));
  } catch {}
  const fa = uiSettings().language === "fa";
  let changed = false;
  for (const [key, win, thresholds, nameFa, nameEn] of [
    ["5h", live.fiveHour, a.fiveHour || [70, 90], "۵ ساعته", "5-hour"],
    ["week", live.weekly, a.weekly || [75, 90], "هفتگی", "weekly"],
  ]) {
    if (!win) continue;
    // resetsAt is a few hundred ms different on every read, so a window is matched by a reset
    // within 15 minutes, not by the exact value. Several thresholds crossed at once: one message.
    const sameWindow = (th) =>
      Object.keys(sent).some((id) => {
        const [k, t, h] = id.split(":");
        return k === key && Number(h) === th && Math.abs(Number(t) - win.resetsAt) < 15 * 60e3;
      });
    const crossed = thresholds.filter((th) => win.pct >= th && !sameWindow(th));
    for (const th of crossed) sent[`${key}:${win.resetsAt}:${th}`] = Date.now();
    if (crossed.length) {
      changed = true;
      const th = Math.max(...crossed);
      const r = new Date(win.resetsAt);
      const when = key === "week" ? `${dayKey(r)} ${pad(r.getHours())}:${pad(r.getMinutes())}` : `${pad(r.getHours())}:${pad(r.getMinutes())}`;
      telegram.notice({
        emoji: "⚠️",
        title: fa ? `مصرف ${nameFa} Claude به ${Math.round(win.pct)}٪ رسید` : `Claude ${nameEn} usage is at ${Math.round(win.pct)}%`,
        lines: fa ? [`هشدار ${th}٪`, `ریست: ${when}`] : [`Alert at ${th}%`, `Resets ${when}`],
        tone: th >= 90 ? "bad" : "warn",
        crumb: fa ? "سهمیه" : "Quota",
      });
    }
  }
  if (changed) {
    for (const [k, v] of Object.entries(sent)) if (v < Date.now() - 8 * DAY) delete sent[k];
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(sent, null, 1));
  }
}

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/widget": ["widget.html", "text/html; charset=utf-8"],
  "/widget.js": ["widget.js", "text/javascript; charset=utf-8"],
  "/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
  "/brain": ["brain.html", "text/html; charset=utf-8"],
  "/brain.js": ["brain.js", "text/javascript; charset=utf-8"],
  "/robot.svg": ["robot.svg", "image/svg+xml"],
};

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Recently modified vault notes (skips dot-folders and the runs folder). Walks the whole vault,
// so the result is cached for a minute.
let changesCache = null;
function vaultChanges(hours) {
  if (!changesCache || Date.now() - changesCache.at > 60e3) changesCache = { at: Date.now(), list: scanChanges(hours) };
  return changesCache.list;
}
function scanChanges(hours) {
  const since = Date.now() - hours * 3600e3;
  const out = [];
  const walk = (dir, rel) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (r !== cfg.vault.runsFolder) walk(path.join(dir, e.name), r);
      } else if (/\.(md|canvas|base)$/.test(e.name)) {
        const t = fs.statSync(path.join(dir, e.name)).mtimeMs;
        if (t >= since) out.push({ file: r, at: t });
      }
    }
  };
  walk(vault, "");
  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}

// UI settings shared by the dashboard, widget and tray (currently just the language).
const UI_FILE = path.join(DATA, "ui.json");
const LANGUAGES = ["fa", "en"];
function uiSettings() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(UI_FILE, "utf8"));
  } catch {}
  return { language: LANGUAGES.includes(s.language) ? s.language : cfg.language || "en" };
}
function saveUiSettings(body) {
  if (!LANGUAGES.includes(body.language)) throw new Error(`language must be one of ${LANGUAGES.join(", ")}`);
  const next = { ...uiSettings(), language: body.language };
  fs.writeFileSync(UI_FILE, JSON.stringify(next, null, 1));
  return next;
}

// Cloud routines (Claude Code Routines) run on Anthropic's side; list their next fire time locally.
function cloudUpcoming() {
  const now = Date.now();
  const out = [];
  for (const r of cfg.cloudRoutines || []) {
    const [h, m] = r.schedule.split(":").map(Number);
    for (let i = 0; i <= 1; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      d.setHours(h, m, 0, 0);
      const t = d.getTime();
      if (t > now && t - now <= 24 * 3600e3) out.push({ skill: r.skill || r.id, label: r.label, cloud: true, at: t });
    }
  }
  return out;
}

function integrationList() {
  // Local items show at once; MCP connectors join when `claude mcp list` has answered.
  const out = [...(integrations.list() || [])];
  const cloud = cloudSync.status();
  if (cloud.enabled) {
    const t = new Date(cloud.lastSync);
    const status = cloud.error || (cloud.lastSync ? `synced ${pad(t.getHours())}:${pad(t.getMinutes())}` : "pending");
    out.push({ name: "cloud sync", ok: !cloud.error, status });
  }
  if (cfg.semantic && cfg.semantic.enabled) {
    const o = ollama.status();
    const sm = semantic.status();
    const status = o.pulling
      ? `downloading ${o.model}… ${o.progress}%`
      : sm.building
        ? "indexing…"
        : sm.error ||
          o.error ||
          (sm.ready
            ? `${sm.files} notes · ${o.model} · Ollama ${o.running ? "on" : "off (starts on demand)"}`
            : "not indexed yet (the first search builds it)");
    out.push({ name: "semantic search", ok: !o.error && !sm.error, status, action: "semantic-index" });
  }
  if (mapState) {
    const status = mapState.ok ? "OK" : `${mapState.problems.length} problem(s): ${mapState.problems.slice(0, 3).join(" | ")}`;
    out.push({ name: "memory map", ok: mapState.ok, status, action: "map-check" });
  }
  const tg = telegram.status();
  if (tg.enabled) {
    const status = !tg.configured
      ? "no bot token in config.json"
      : tg.error || (tg.queued ? `${tg.queued} queued` : tg.hasChat ? "ready" : "send /start to the bot");
    out.push({ name: "telegram", ok: tg.configured && !tg.error && !tg.queued, status });
  }
  return out;
}

// Display name of a skill in the current UI language (used for Telegram messages).
function labelFor(name, fallback) {
  const s = runner.skills().find((k) => k.name === name);
  const lang = uiSettings().language;
  return (s && ((s.labels && s.labels[lang]) || s.label)) || fallback || name;
}

// Quota guard: block automatic runs while live plan usage is above the configured percentage.
function quotaGuard() {
  const g = cfg.quotaGuard || {};
  if (!g.enabled) return { blocked: false };
  const live = limits.live();
  for (const [win, max, name] of [
    [live.fiveHour, g.fiveHourMax, "5-hour"],
    [live.weekly, g.weeklyMax, "weekly"],
  ]) {
    if (win && max != null && win.pct >= max) {
      return {
        blocked: true,
        window: name,
        pct: win.pct,
        max,
        until: win.resetsAt,
        reason: `${name} usage is at ${Math.round(win.pct)}% (guard ${max}%)`,
      };
    }
  }
  return { blocked: false };
}

// Cost and volume per skill over the last 7 and 30 days, from the local run history.
function skillUsage(runs) {
  const now = Date.now();
  const by = new Map();
  for (const r of runs) {
    const t = Date.parse(r.startedAt);
    if (t < now - 30 * DAY || r.status === "RUNNING") continue;
    const u = by.get(r.skill) || { skill: r.skill, label: r.label, runs7: 0, cost7: 0, runs30: 0, cost30: 0, out30: 0, failed30: 0 };
    u.runs30++;
    u.cost30 += r.cost || 0;
    u.out30 += r.output || 0;
    if (r.status === "FAILED") u.failed30++;
    if (t >= now - 7 * DAY) {
      u.runs7++;
      u.cost7 += r.cost || 0;
    }
    by.set(r.skill, u);
  }
  return [...by.values()].sort((a, b) => b.cost30 - a.cost30);
}

// One snapshot serves the dashboard, widget and tray for a few seconds; actions clear it.
let stateCache = null;
function cachedState() {
  if (!stateCache || Date.now() - stateCache.at > 3000) stateCache = { at: Date.now(), value: state() };
  return stateCache.value;
}
const invalidate = () => (stateCache = null);

function state() {
  const live = limits.live();
  const u = usage.summary(cfg, live);
  const runs = runner.list();
  return {
    meta: {
      language: uiSettings().language,
      vault: cfg.vault.label,
      plan: String(live.plan || cfg.plan).toUpperCase(),
      limitsLive: !!(live.fiveHour || live.weekly),
      limitsError: live.error || null,
      permissions: (cfg.permissionMode || "default").replace(/([a-z])([A-Z])/g, "$1 $2"),
    },
    fiveHour: u.fiveHour,
    weekly: u.weekly,
    routines: { runsToday: runner.runsToday(), limit: cfg.dailyRunLimit, costToday: u.costToday },
    activity: u.activity,
    integrations: integrationList(),
    lastRun: runs[0] || null,
    recentRuns: runs.slice(0, 8),
    skills: runner.skills().map((s) => ({
      name: s.name,
      label: s.label,
      labels: s.labels,
      domain: s.domain,
      description: s.description,
      schedule: s.schedule,
      days: s.days,
      prompt: s.prompt,
      tier: s.tier,
      model: runner.resolveModel(s).model,
      running: runner.isRunning(s.name),
    })),
    models: cfg.models || {},
    quota: { enabled: !!(cfg.quotaGuard || {}).enabled, ...(cfg.quotaGuard || {}), ...quotaGuard() },
    inbox: inbox.state(),
    skillUsage: skillUsage(runs),
    watchers: watchers.status(),
    domains: cfg.domains || [],
    upcoming: [...runner.upcoming(), ...cloudUpcoming()].sort((a, b) => a.at - b.at),
    changes: vaultChanges(48),
  };
}

function detached(cmd, args) {
  const p = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: false });
  p.on("error", (e) => console.log(`[open] ${cmd}: ${e.message}`));
  p.unref();
}

const obsidianUri = (file) =>
  `obsidian://open?vault=${encodeURIComponent(cfg.vault.name)}` +
  (file ? `&file=${encodeURIComponent(file.replace(/\\/g, "/"))}` : "");

function insideVault(rel) {
  const abs = path.resolve(vault, rel || "");
  if (abs !== vault && !abs.startsWith(vault + path.sep)) throw new Error("path outside vault");
  return abs;
}

// A terminal running `claude <args>` in dir (Windows Terminal when available, else cmd).
function openTerminal(dir = vault, args = [], { title = "Claude Code", minimized = false } = {}) {
  const wt = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "wt.exe");
  if (!minimized && cfg.terminal !== "cmd" && fs.existsSync(wt)) return detached(wt, ["-d", dir, "claude", ...args]);
  detached("cmd.exe", ["/c", "start", title, ...(minimized ? ["/min"] : []), "/D", dir, "cmd", "/k", "claude", ...args]);
}

// Remote Control server: start or continue Claude Code sessions in the vault from the phone app.
function openRemoteControl(minimized = false) {
  const name = (cfg.remoteControl && cfg.remoteControl.name) || "Agentic OS";
  openTerminal(vault, ["remote-control", "--name", name], { title: "Remote Control", minimized });
}

// Skill builder: SKILL.md in the vault plus a config.json entry, live without a restart.
const BUILDER_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "WebSearch", "WebFetch"];
function createSkill(b) {
  const name = String(b.name || "").trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 40) throw new Error("name: lowercase letters, digits and dashes, e.g. weekly-plan");
  const dir = path.join(vault, ".claude", "skills", name);
  if (fs.existsSync(dir) || (cfg.skills || []).some((s) => s.name === name)) throw new Error(`skill already exists: ${name}`);
  const description = String(b.description || "").replace(/\s+/g, " ").trim();
  const instructions = String(b.instructions || "").trim();
  if (description.length < 10) throw new Error("description is too short");
  if (instructions.length < 10) throw new Error("instructions are too short");
  const schedule = String(b.schedule || "").trim();
  if (schedule && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule)) throw new Error("time must be HH:MM");
  const days = (Array.isArray(b.days) ? b.days : []).filter((d) => ["sat", "sun", "mon", "tue", "wed", "thu", "fri"].includes(d));
  const tools = (Array.isArray(b.tools) ? b.tools : []).filter((x) => BUILDER_TOOLS.includes(x));
  const tier = Object.keys(cfg.models || {}).includes(b.tier) ? b.tier : cfg.defaultTier || "standard";

  fs.mkdirSync(dir, { recursive: true });
  const title = name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description.replace(/\n/g, " ")}\n---\n\n# ${title}\n\n${instructions}\n`,
    "utf8"
  );
  const entry = {
    name,
    ...(b.label ? { labels: { fa: String(b.label).trim().slice(0, 40) } } : {}),
    domain: String(b.domain || "Other").trim().slice(0, 30) || "Other",
    tier,
    ...(schedule ? { schedule } : {}),
    ...(schedule && days.length && days.length < 7 ? { days } : {}),
    allowedTools: tools.length ? tools : ["Read", "Glob", "Grep"],
  };
  cfg.skills = [...(cfg.skills || []), entry];
  fs.writeFileSync(path.join(HOME, "config.json"), JSON.stringify(cfg, null, 2) + "\n", "utf8");
  runner.reloadSkills();
  return entry;
}

function openTarget(what, body) {
  switch (what) {
    case "claude":
      openTerminal();
      break;
    case "remote":
      openRemoteControl();
      break;
    case "path": {
      // Only paths that appear in the Brain graph (the memory map, notes, skills, runs).
      const p = String(body.path || "");
      if (!p || !brain().nodes.some((n) => n.path && path.normalize(n.path) === path.normalize(p))) throw new Error("path is not on the map");
      if (!fs.existsSync(p)) throw new Error("path not found");
      const relToVault = path.relative(vault, p);
      if (!relToVault.startsWith("..") && !path.isAbsolute(relToVault) && /\.md$/i.test(p)) {
        detached("explorer.exe", [obsidianUri(relToVault)]);
      } else if (fs.statSync(p).isDirectory()) {
        detached("explorer.exe", [p]);
      } else {
        detached("explorer.exe", [`/select,${p}`]);
      }
      break;
    }
    case "resume": {
      const id = String(body.session || "");
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("bad session id");
      const s = sessions.find(id);
      if (!s) throw new Error("session not found");
      openTerminal(s.cwd && fs.existsSync(s.cwd) ? s.cwd : vault, ["--resume", id], { title: "Claude Code — resume" });
      break;
    }
    case "vault":
      detached("explorer.exe", [obsidianUri()]);
      break;
    case "widget":
      // Inside the desktop app, toggle its widget window; otherwise launch the PowerShell widget.
      if (hooks.toggleWidget) hooks.toggleWidget();
      else detached("wscript.exe", [path.join(APP, "widget.vbs")]);
      break;
    case "daily": {
      const rel = path.posix.join(cfg.vault.dailyFolder || "", `${dayKey(new Date())}.md`);
      const abs = insideVault(rel);
      if (!fs.existsSync(abs)) fs.writeFileSync(abs, "", "utf8");
      detached("explorer.exe", [obsidianUri(rel)]);
      break;
    }
    case "runs":
    case "drafts": {
      const abs = insideVault(what === "runs" ? cfg.vault.runsFolder : cfg.vault.draftsFolder);
      fs.mkdirSync(abs, { recursive: true });
      detached("explorer.exe", [abs]);
      break;
    }
    case "note": {
      const rel = String(body.file || "");
      if (!fs.existsSync(insideVault(rel))) throw new Error("note not found");
      detached("explorer.exe", [obsidianUri(rel)]);
      inbox.markRead(rel);
      break;
    }
    default:
      throw new Error(`unknown target: ${what}`);
  }
  return { ok: true };
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (d) => {
      s += d;
      if (s.length > 1e5) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // Loopback only; the custom header on POSTs blocks cross-site form/fetch requests.
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  if (host !== "127.0.0.1" && host !== "localhost") return send(res, 403, { error: "forbidden" });
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "GET") {
    const st = STATIC[url.pathname];
    if (st) return send(res, 200, fs.readFileSync(path.join(APP, "public", st[0])), st[1]);
    const q = url.searchParams.get("q") || "";
    try {
      if (url.pathname === "/api/sessions") return send(res, 200, q ? sessions.search(q) : sessions.list(30));
      if (url.pathname === "/api/search") {
        const n = Math.min(20, Math.max(1, Number(url.searchParams.get("n")) || 12));
        // mode=keyword: instant BM25 answer, shown while the hybrid one is on its way.
        if (url.searchParams.get("mode") === "keyword") {
          return send(res, 200, vaultSearch.search(q.slice(0, 500), n).map((h) => ({ ...h, mode: "keyword" })));
        }
        return send(res, 200, await searchVault(q.slice(0, 500), n));
      }
      if (url.pathname === "/api/brain") return send(res, 200, brain());
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
    if (url.pathname === "/api/state") {
      try {
        return send(res, 200, cachedState());
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }
  }

  if (req.method === "POST") {
    if (req.headers["x-agentic-os"] !== "1") return send(res, 403, { error: "forbidden" });
    const body = await readBody(req);
    invalidate();
    try {
      let m;
      if ((m = /^\/api\/run\/([\w-]+)$/.exec(url.pathname))) {
        const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 20000) : undefined;
        const tier = typeof body.tier === "string" && body.tier ? body.tier : undefined;
        // force: the person saw the quota warning and chose to run anyway.
        return send(res, 200, runner.start(m[1], "manual", prompt, tier, { force: body.force === true }));
      }
      if ((m = /^\/api\/open\/(\w+)$/.exec(url.pathname))) return send(res, 200, openTarget(m[1], body));
      if (url.pathname === "/api/settings") return send(res, 200, saveUiSettings(body));
      if (url.pathname === "/api/feedback") return send(res, 200, giveFeedback(body));
      if (url.pathname === "/api/map/check") {
        const r = runMapCheck(false);
        brainCache = null;
        return send(res, 200, { ok: r.ok, problems: r.problems });
      }
      if (url.pathname === "/api/skills") return send(res, 200, createSkill(body));
      if (url.pathname === "/api/semantic/warm") {
        semantic.warm();
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/api/semantic/index") {
        if (!(cfg.semantic && cfg.semantic.enabled)) throw new Error("semantic search is off (config.json → semantic.enabled)");
        semantic.build(); // runs in the background; Ollama stops again when idle
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/api/inbox/read") {
        if (body.all === true) inbox.markAll();
        else inbox.markRead(String(body.file || ""));
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/api/telegram/test") {
        if (!telegram.status().configured) throw new Error("Telegram is not configured (config.json → telegram)");
        telegram.notice({ emoji: "✅", title: "Agentic OS ✓ — Telegram test", lines: [], tone: "ok", crumb: "Test" });
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/api/integrations/refresh") {
        integrations.refresh();
        return send(res, 200, { ok: true });
      }
    } catch (e) {
      return send(res, e.code === "QUOTA" ? 409 : 400, { error: e.message, code: e.code });
    }
  }

  send(res, 404, { error: "not found" });
});

// Resolves with { url, alreadyRunning }. When another process already serves the port,
// nothing is started here and callers just use that instance.
function start(options = {}) {
  hooks = options.hooks || {};
  const url = `http://127.0.0.1:${cfg.port}`;
  return new Promise((resolve, reject) => {
    server.once("error", (e) => {
      if (e.code !== "EADDRINUSE") return reject(e);
      console.log(`Agentic OS is already running on port ${cfg.port}`);
      resolve({ url, alreadyRunning: true });
    });
    server.listen(cfg.port, "127.0.0.1", () => {
      usage.setCalibrationFile(path.join(DATA, "limits.json"));
      ollama.adopt();
      limits.refresh();
      telegram = createTelegram(cfg, DATA, { language: () => uiSettings().language });
      runner = createRunner(cfg, DATA, {
        guard: quotaGuard,
        onFinish: (run, skill, result) => {
          invalidate();
          telegram.onRun(run, labelFor(skill.name, skill.label), result, skill);
          checkQuality(run, skill, result);
          if (hooks.onRunFinished) hooks.onRunFinished(run);
        },
      });
      inbox = createInbox(cfg, DATA, () => runner.list(), (rel) => skillForFile(rel));
      telegram.startCommands(
        createTgApp({
          state: () => {
            invalidate();
            return cachedState();
          },
          label: labelFor,
          fa: () => uiSettings().language === "fa",
          runSkill: (name, force) => runner.start(name, "telegram", undefined, undefined, { force }),
          addNote: addNoteFromTelegram,
          runsOf: (name) => runner.list().filter((r) => r.skill === name),
        })
      );
      setInterval(checkQuotaAlerts, 2 * 60e3);
      setTimeout(checkQuotaAlerts, 20e3);
      // Map check: now, then nightly at 03:00 with a Telegram alert on problems. The semantic
      // index catches up at the same time (Ollama runs only for that, then stops when idle);
      // searches update it too, so it is never more than a day behind.
      setTimeout(() => runMapCheck(false), 3e3);
      let nightlyDay = "";
      setInterval(() => {
        const d = new Date();
        if (d.getHours() === 3 && nightlyDay !== dayKey(d)) {
          nightlyDay = dayKey(d);
          runMapCheck(true);
          semantic.build();
        }
      }, 10 * 60e3);
      if (cfg.remoteControl && cfg.remoteControl.autoStart) setTimeout(() => openRemoteControl(true), 8e3);
      watchers = createWatchers(cfg, DATA, runner);
      integrations = createIntegrations(cfg);
      cloudSync = createCloudSync(cfg, HOME, {
        onCopied: (rule, rel, text) => rule.skill && telegram.onCloudReport(rule.skill, labelFor(rule.skill), text),
      });
      console.log(`Agentic OS running at ${url}`);
      resolve({ url, alreadyRunning: false });
    });
  });
}

// Before exit: stop the Ollama this app started, unless another program is using it.
function stop() {
  return ollama.shutdown().catch(() => {});
}

module.exports = { start, stop, state: cachedState, config: cfg, home: HOME, app: APP };

if (require.main === module) {
  start().then(({ url, alreadyRunning }) => {
    if (process.argv.includes("--open")) detached("explorer.exe", [url]);
    if (alreadyRunning) setTimeout(() => process.exit(0), 500);
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => stop().then(() => process.exit(0)));
}
