// Agentic OS — local command center for Claude Code + the Obsidian vault.
// Zero dependencies: node server.js [--open]
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const usage = require("./lib/usage");
const { createRunner } = require("./lib/runner");
const { createIntegrations } = require("./lib/integrations");
const { createCloudSync } = require("./lib/cloudsync");

const ROOT = __dirname;
const cfgFile = ["config.json", "config.example.json"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
const vault = cfg.vault.path;
const runner = createRunner(cfg, DATA);
const integrations = createIntegrations(cfg);
const cloudSync = createCloudSync(cfg, ROOT);

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
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
      if (t > now && t - now <= 24 * 3600e3) out.push({ skill: r.id, label: `${r.label} · CLOUD`, at: t });
    }
  }
  return out;
}

function integrationList() {
  const list = integrations.list();
  const cloud = cloudSync.status();
  if (list === null || !cloud.enabled) return list;
  const t = new Date(cloud.lastSync);
  const status = cloud.error || (cloud.lastSync ? `synced ${pad(t.getHours())}:${pad(t.getMinutes())}` : "pending");
  return [...list, { name: "cloud sync", ok: !cloud.error, status }];
}

function state() {
  const u = usage.summary(cfg);
  const runs = runner.list();
  return {
    meta: {
      vault: cfg.vault.label,
      plan: cfg.plan,
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
      detached("wscript.exe", [path.join(ROOT, "widget.vbs")]);
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
        return send(res, 200, runner.start(m[1], "manual", prompt, tier));
      }
      if ((m = /^\/api\/open\/(\w+)$/.exec(url.pathname))) return send(res, 200, openTarget(m[1], body));
      if (url.pathname === "/api/integrations/refresh") {
        integrations.refresh();
        return send(res, 200, { ok: true });
      }
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  send(res, 404, { error: "not found" });
});

server.on("error", (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  // Already running (e.g. started at login): just open the existing dashboard.
  console.log(`Agentic OS is already running on port ${cfg.port}`);
  if (process.argv.includes("--open")) detached("explorer.exe", [`http://127.0.0.1:${cfg.port}`]);
  setTimeout(() => process.exit(0), 500);
});

server.listen(cfg.port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${cfg.port}`;
  console.log(`Agentic OS running at ${url}`);
  if (process.argv.includes("--open")) detached("explorer.exe", [url]);
});
