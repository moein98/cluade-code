// Runs vault skills headless (`claude -p`), saves each result to
// <vault>/dashboard-runs/YYYY-MM-DD/HH-MM-<skill>.md and fires scheduled skills.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HOUR = 3600e3;

function readSkills(vault) {
  const dir = path.join(vault, ".claude", "skills");
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return out;
  }
  for (const name of names) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, name, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const desc = fm && /^description:\s*(.+)$/m.exec(fm[1]);
    out.push({ name, description: desc ? desc[1].trim().replace(/^["']|["']$/g, "") : "" });
  }
  return out;
}

function createRunner(cfg, dataDir) {
  const vault = cfg.vault.path;
  const file = path.join(dataDir, "runs.json");
  let runs = [];
  try {
    runs = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  for (const r of runs) {
    if (r.status === "RUNNING") {
      r.status = "FAILED";
      r.error = "interrupted (dashboard was stopped)";
    }
  }
  const active = new Map();
  const skipped = new Set();
  const save = () => fs.writeFileSync(file, JSON.stringify(runs.slice(0, 500), null, 1));

  // Skills on disk merged with dashboard settings (domain, schedule, tools) from config.
  function skills() {
    const disk = readSkills(vault);
    const conf = new Map((cfg.skills || []).map((s) => [s.name, s]));
    return disk.map((s) => {
      const c = conf.get(s.name) || {};
      return {
        ...s,
        label: c.label || s.name.replace(/-/g, " ").toUpperCase(),
        domain: c.domain || "Other",
        schedule: c.schedule || null,
        days: c.days || null,
        prompt: c.prompt || `Use the ${s.name} skill.`,
        allowedTools: c.allowedTools || ["Read", "Glob", "Grep"],
        permissionMode: c.permissionMode || cfg.permissionMode || "acceptEdits",
        tier: c.tier || cfg.defaultTier || null,
        model: c.model || null,
        timeoutMin: c.timeoutMin || 20,
      };
    });
  }

  // Model routing: an explicit per-run tier wins, then the skill's own `model`, then its tier.
  function resolveModel(skill, tierOverride) {
    const models = cfg.models || {};
    if (tierOverride) {
      if (!models[tierOverride]) throw new Error(`unknown model tier: ${tierOverride}`);
      return { tier: tierOverride, model: models[tierOverride] };
    }
    if (skill.model) return { tier: skill.tier, model: skill.model };
    return { tier: skill.tier, model: models[skill.tier] || null };
  }

  const runsToday = () => {
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    return runs.filter((r) => Date.parse(r.startedAt) >= t0.getTime()).length;
  };

  function fill(text, now) {
    const daily = path.posix.join(cfg.vault.dailyFolder || "", `${dayKey(now)}.md`);
    return text
      .replaceAll("{{date}}", dayKey(now))
      .replaceAll("{{time}}", hm(now))
      .replaceAll("{{dailyNote}}", daily);
  }

  function writeNote(run, skill, body) {
    const d = new Date(run.startedAt);
    const folder = path.join(vault, cfg.vault.runsFolder, dayKey(d));
    fs.mkdirSync(folder, { recursive: true });
    let name = `${pad(d.getHours())}-${pad(d.getMinutes())}-${skill.name}.md`;
    for (let i = 2; fs.existsSync(path.join(folder, name)); i++) {
      name = `${pad(d.getHours())}-${pad(d.getMinutes())}-${skill.name}-${i}.md`;
    }
    const fm = [
      "---",
      `skill: ${skill.name}`,
      `status: ${run.status.toLowerCase()}`,
      `trigger: ${run.trigger}`,
      `model: ${run.model || "default"}`,
      `started: ${dayKey(d)} ${hm(d)}`,
      `duration_s: ${Math.round((run.durationMs || 0) / 1000)}`,
      `cost_usd: ${run.cost ?? ""}`,
      `tokens_in: ${run.input ?? ""}`,
      `tokens_out: ${run.output ?? ""}`,
      `session: ${run.session || ""}`,
      "---",
      "",
      `# ${skill.label} — ${dayKey(d)} ${hm(d)}`,
      "",
      "> [!quote] Prompt",
      ...run.prompt.split(/\r?\n/).map((l) => `> ${l}`),
      "",
      body,
      "",
    ];
    fs.writeFileSync(path.join(folder, name), fm.join("\n"), "utf8");
    return path.posix.join(cfg.vault.runsFolder, dayKey(d), name);
  }

  function start(name, trigger, promptOverride, tierOverride) {
    const skill = skills().find((s) => s.name === name);
    if (!skill) throw new Error(`unknown skill: ${name}`);
    if (active.has(name)) throw new Error(`${skill.label} is already running`);
    if (runsToday() >= cfg.dailyRunLimit) throw new Error(`daily run limit reached (${cfg.dailyRunLimit})`);
    const { tier, model } = resolveModel(skill, tierOverride);
    const now = new Date();
    const prompt = fill((promptOverride || skill.prompt).trim(), now);
    const run = {
      id: `${now.getTime().toString(36)}-${name}`,
      skill: name,
      label: skill.label,
      trigger,
      tier,
      model,
      prompt,
      startedAt: now.toISOString(),
      status: "RUNNING",
    };
    runs.unshift(run);
    active.set(name, run);
    save();

    const args = ["-p", "--output-format", "json", "--permission-mode", skill.permissionMode];
    if (model) args.push("--model", model);
    args.push("--allowedTools", ...new Set(["Skill", ...skill.allowedTools]));
    const child = spawn(cfg.claudePath || "claude", args, {
      cwd: vault,
      windowsHide: true,
      // Keep the Obsidian deep-sync Stop hook from firing inside headless runs.
      env: { ...process.env, OBSIDIAN_SYNC_INTERVAL_DAYS: "9999" },
    });
    let out = "";
    let err = "";
    let finished = false;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.on("error", () => {});
    const timer = setTimeout(() => {
      run.error = `timed out after ${skill.timeoutMin} min`;
      child.kill();
    }, skill.timeoutMin * 60e3);

    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      let j = null;
      const text = out.trim();
      try {
        j = JSON.parse(text);
      } catch {
        try {
          j = JSON.parse(text.split(/\r?\n/).filter(Boolean).pop());
        } catch {}
      }
      run.endedAt = new Date().toISOString();
      run.durationMs = Date.parse(run.endedAt) - Date.parse(run.startedAt);
      if (j) {
        run.cost = j.total_cost_usd;
        run.input = j.usage && j.usage.input_tokens;
        run.output = j.usage && j.usage.output_tokens;
        run.turns = j.num_turns;
        run.session = j.session_id;
      }
      const ok = !!j && !j.is_error && j.subtype === "success" && !run.error;
      run.status = ok ? "COMPLETE" : "FAILED";
      if (!ok) {
        run.error =
          run.error || (j && (j.result || j.subtype)) || err.trim().split(/\r?\n/).pop() || `exit code ${code}`;
      }
      const body = ok ? j.result : `**Error:** ${run.error}\n\n\`\`\`\n${(err || out).slice(-4000)}\n\`\`\``;
      try {
        run.note = writeNote(run, skill, body);
      } catch (e) {
        run.error = (run.error ? run.error + "; " : "") + `could not write note: ${e.message}`;
      }
      active.delete(name);
      save();
      console.log(`[run] ${skill.label} ${run.status}${run.error ? " — " + run.error : ""}`);
    };
    child.on("error", (e) => {
      err += e.message;
      finish(-1);
    });
    child.on("close", finish);
    child.stdin.end(prompt);
    console.log(`[run] ${skill.label} started (${trigger}, ${model || "default model"})`);
    return run;
  }

  function slotFor(skill, from) {
    if (!skill.schedule) return null;
    const [h, m] = skill.schedule.split(":").map(Number);
    const d = new Date(from);
    d.setHours(h, m, 0, 0);
    return d;
  }

  // Fire a scheduled skill once per slot; catch up if the dashboard was off at slot time.
  function tick() {
    const now = new Date();
    for (const s of skills()) {
      const slot = slotFor(s, now);
      if (!slot || active.has(s.name)) continue;
      if (s.days && !s.days.includes(DAYS[now.getDay()])) continue;
      if (now < slot || now - slot > (cfg.catchUpHours ?? 3) * HOUR) continue;
      if (runs.some((r) => r.skill === s.name && Date.parse(r.startedAt) >= slot.getTime())) continue;
      const key = `${s.name}@${slot.getTime()}`;
      try {
        start(s.name, "schedule");
      } catch (e) {
        if (!skipped.has(key)) console.log(`[schedule] skipped ${s.name}: ${e.message}`);
        skipped.add(key);
      }
    }
  }

  // Scheduled runs in the next 24 hours.
  function upcoming() {
    const now = Date.now();
    const out = [];
    for (const s of skills()) {
      if (!s.schedule) continue;
      for (let i = 0; i <= 1; i++) {
        const base = new Date(now);
        base.setDate(base.getDate() + i);
        const slot = slotFor(s, base);
        if (s.days && !s.days.includes(DAYS[slot.getDay()])) continue;
        const t = slot.getTime();
        if (t > now && t - now <= 24 * HOUR) out.push({ skill: s.name, label: s.label, at: t });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  setInterval(tick, 30e3);
  setTimeout(tick, 5e3);

  return {
    start,
    skills,
    resolveModel,
    upcoming,
    runsToday,
    list: () => runs,
    isRunning: (name) => active.has(name),
  };
}

module.exports = { createRunner };
