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
const { createInbox } = require("./lib/inbox");
const { createWatchers } = require("./lib/watcher");
const limits = require("./lib/limits");

const ROOT = __dirname;
const cfgFile = ["config.json", "config.example.json"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
const DATA = path.join(ROOT, "data");
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

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/widget": ["widget.html", "text/html; charset=utf-8"],
  "/widget.js": ["widget.js", "text/javascript; charset=utf-8"],
  "/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
  "/robot.svg": ["robot.svg", "image/svg+xml"],
};

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Recently modified vault notes (skips dot-folders and the runs folder).
function vaultChanges(hours) {
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
  const list = integrations.list();
  if (list === null) return list;
  const out = [...list];
  const cloud = cloudSync.status();
  if (cloud.enabled) {
    const t = new Date(cloud.lastSync);
    const status = cloud.error || (cloud.lastSync ? `synced ${pad(t.getHours())}:${pad(t.getMinutes())}` : "pending");
    out.push({ name: "cloud sync", ok: !cloud.error, status });
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

function openTerminal() {
  const wt = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "wt.exe");
  if (cfg.terminal !== "cmd" && fs.existsSync(wt)) return detached(wt, ["-d", vault, "claude"]);
  detached("cmd.exe", ["/c", "start", "Claude Code", "/D", vault, "cmd", "/k", "claude"]);
}

function openTarget(what, body) {
  switch (what) {
    case "claude":
      openTerminal();
      break;
    case "vault":
      detached("explorer.exe", [obsidianUri()]);
      break;
    case "widget":
      // Inside the desktop app, toggle its widget window; otherwise launch the PowerShell widget.
      if (hooks.toggleWidget) hooks.toggleWidget();
      else detached("wscript.exe", [path.join(ROOT, "widget.vbs")]);
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
    if (st) return send(res, 200, fs.readFileSync(path.join(ROOT, "public", st[0])), st[1]);
    if (url.pathname === "/api/state") {
      try {
        return send(res, 200, state());
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }
  }

  if (req.method === "POST") {
    if (req.headers["x-agentic-os"] !== "1") return send(res, 403, { error: "forbidden" });
    const body = await readBody(req);
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
      if (url.pathname === "/api/inbox/read") {
        if (body.all === true) inbox.markAll();
        else inbox.markRead(String(body.file || ""));
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/api/telegram/test") {
        if (!telegram.status().configured) throw new Error("Telegram is not configured (config.json → telegram)");
        telegram.send("Agentic OS ✓ — Telegram test");
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
      limits.refresh();
      telegram = createTelegram(cfg, DATA);
      runner = createRunner(cfg, DATA, {
        guard: quotaGuard,
        onFinish: (run, skill, result) => telegram.onRun(run, labelFor(skill.name, skill.label), result),
      });
      inbox = createInbox(cfg, DATA, () => runner.list());
      watchers = createWatchers(cfg, DATA, runner);
      integrations = createIntegrations(cfg);
      cloudSync = createCloudSync(cfg, ROOT, {
        onCopied: (rule, rel, text) => rule.skill && telegram.onCloudReport(rule.skill, labelFor(rule.skill), text),
      });
      console.log(`Agentic OS running at ${url}`);
      resolve({ url, alreadyRunning: false });
    });
  });
}

module.exports = { start, config: cfg, root: ROOT };

if (require.main === module) {
  start().then(({ url, alreadyRunning }) => {
    if (process.argv.includes("--open")) detached("explorer.exe", [url]);
    if (alreadyRunning) setTimeout(() => process.exit(0), 500);
  });
}
