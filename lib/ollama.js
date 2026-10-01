// Portable Ollama for semantic search, started only when it is needed and stopped again.
//
// - use(fn) starts `ollama serve` from config.semantic.ollamaPath if nothing answers on the host,
//   runs fn, and arms an idle timer. Models and Ollama's home directory stay in its own folder.
// - After semantic.idleMin minutes (default 5) without use, the server is stopped, but only if
//   this app started it and no other program is using it: another model loaded in it, or our
//   model kept loaded longer than our own requests asked for, means someone else uses it.
// - An Ollama that was already running (installed app, another program) is never stopped.
// - Requests ask for a short keep_alive so the model leaves RAM soon after the last query.
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEEP_ALIVE_SEC = 60;
// CPU only by default (semantic.gpu: false): embedding a query takes ~60 ms on the CPU, while
// setting up the GPU (Vulkan) for every cold start took over 30 s here and holds VRAM.
const CPU_ONLY = {
  OLLAMA_VULKAN: "0",
  GGML_VK_VISIBLE_DEVICES: "",
  CUDA_VISIBLE_DEVICES: "-1",
  HIP_VISIBLE_DEVICES: "-1",
  ROCR_VISIBLE_DEVICES: "-1",
};

function createOllama(cfg, dataDir) {
  const s = cfg.semantic || {};
  const host = s.host || "http://127.0.0.1:11434";
  const model = s.model || "bge-m3";
  const exe = s.ollamaPath || "";
  const base = exe ? path.dirname(exe) : "";
  const idleMs = (s.idleMin || 5) * 60e3;
  const gpu = s.gpu === true;
  const pidFile = path.join(dataDir, "ollama.pid");
  const status = { running: false, ours: false, pulling: false, progress: 0, error: null, lastUse: 0 };
  let child = null;
  let pid = null; // pid of the `ollama serve` this app started
  let busy = 0;
  let starting = null;
  let idleTimer = null;

  async function up() {
    try {
      return (await fetch(`${host}/api/version`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
      return false;
    }
  }

  // After a crash of this app, adopt the server it had started: the pid file names a process
  // that is still alive and really is ollama.exe (pids get reused). Called only by the process
  // that owns the dashboard port, so an attached second instance never stops it.
  function adopt() {
    if (!s.enabled) return;
    sweepOrphans();
    let p;
    try {
      p = Number(fs.readFileSync(pidFile, "utf8"));
    } catch {
      return;
    }
    if (!(p > 0)) return forget();
    execFile("tasklist.exe", ["/FI", `PID eq ${p}`, "/FO", "CSV", "/NH"], { windowsHide: true }, (err, out) => {
      if (!err && /^"ollama\.exe"/im.test(String(out))) {
        pid = p;
        status.ours = true;
        armIdle();
      } else {
        forget();
      }
    });
  }

  async function start() {
    if (await up()) {
      status.running = true;
      return;
    }
    if (!exe || !fs.existsSync(exe)) throw new Error(`ollama.exe not found at ${exe || "(semantic.ollamaPath)"}`);
    const home = path.join(base, "home");
    fs.mkdirSync(home, { recursive: true });
    child = spawn(exe, ["serve"], {
      cwd: base,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        OLLAMA_HOST: host.replace(/^https?:\/\//, ""),
        OLLAMA_MODELS: s.modelsDir || path.join(base, "models"),
        OLLAMA_KEEP_ALIVE: `${KEEP_ALIVE_SEC}s`,
        OLLAMA_MAX_LOADED_MODELS: "1",
        OLLAMA_NUM_PARALLEL: "1",
        USERPROFILE: home,
        HOME: home,
        ...(gpu ? {} : CPU_ONLY),
      },
    });
    pid = child.pid;
    status.ours = true;
    fs.writeFileSync(pidFile, String(pid));
    child.on("exit", () => {
      child = null;
      if (pid && !alive(pid)) {
        forget(); // it crashed or was closed from outside: clean up its runners too
        sweepOrphans();
      }
    });
    for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
    if (!(await up())) throw new Error("ollama serve did not start");
    status.running = true;
    console.log("[ollama] started");
  }

  function alive(p) {
    try {
      process.kill(p, 0);
      return true;
    } catch {
      return false;
    }
  }

  function forget() {
    pid = null;
    status.ours = false;
    status.running = false;
    try {
      fs.unlinkSync(pidFile);
    } catch {}
  }

  async function pullIfMissing() {
    const tags = await (await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(10e3) })).json();
    if ((tags.models || []).some((m) => m.name === model || m.name.startsWith(`${model}:`))) return;
    status.pulling = true;
    status.progress = 0;
    console.log(`[ollama] pulling ${model}…`);
    try {
      // Streamed: progress lines keep the connection alive (a non-streamed pull sends nothing
      // until the end, and fetch gives up after 5 minutes without response headers).
      const r = await fetch(`${host}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: true }) });
      if (!r.ok) throw new Error(`pull ${model}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      const decoder = new TextDecoder();
      let buf = "";
      let ok = false;
      for await (const part of r.body) {
        buf += decoder.decode(part, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          const j = JSON.parse(line);
          if (j.error) throw new Error(`pull ${model}: ${j.error}`);
          if (j.total) status.progress = Math.floor((100 * (j.completed || 0)) / j.total);
          if (j.status === "success") ok = true;
        }
      }
      if (!ok) throw new Error(`pull ${model} ended before it finished`);
      console.log(`[ollama] ${model} ready`);
    } finally {
      status.pulling = false;
    }
  }

  // Run fn while Ollama is up; starts it on demand. Rejects when it can't be started.
  async function use(fn) {
    if (!s.enabled) throw new Error("semantic search is off");
    busy++;
    clearTimeout(idleTimer);
    try {
      if (!starting) {
        starting = (async () => {
          await start();
          await pullIfMissing();
        })().finally(() => (starting = null));
      }
      await starting;
      status.error = null;
      return await fn();
    } catch (e) {
      status.error = e.message.split("\n")[0];
      throw e;
    } finally {
      busy--;
      status.lastUse = Date.now();
      armIdle();
    }
  }

  function armIdle() {
    clearTimeout(idleTimer);
    if (pid) idleTimer = setTimeout(idleCheck, idleMs);
  }

  // Someone else uses the server when it holds another model, or holds ours longer than the
  // keep_alive of our last request.
  async function othersUsing() {
    try {
      const ps = await (await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(3000) })).json();
      const ours = `${model}`;
      return (ps.models || []).some((m) => {
        const name = m.name || m.model || "";
        if (!(name === ours || name.startsWith(`${ours}:`))) return true;
        return Date.parse(m.expires_at) > status.lastUse + (KEEP_ALIVE_SEC + 30) * 1000;
      });
    } catch {
      return false; // not answering: nothing to protect
    }
  }

  async function idleCheck() {
    if (!pid || busy || starting) return armIdle();
    if (Date.now() - status.lastUse < idleMs - 1000) return armIdle();
    if (await othersUsing()) {
      console.log("[ollama] idle here, but another program is using it — leaving it running");
      return armIdle();
    }
    stop();
  }

  // Stop the server this app started, then its model runners: they can outlive `ollama serve`
  // (taskkill /T doesn't always reach them) and each holds the whole model in RAM.
  // Resolves once the server and its runners are gone.
  function stop() {
    clearTimeout(idleTimer);
    if (!pid) return Promise.resolve();
    const p = pid;
    forget();
    console.log("[ollama] stopped");
    return new Promise((resolve) =>
      execFile("taskkill.exe", ["/PID", String(p), "/T", "/F"], { windowsHide: true }, () => sweepOrphans().then(resolve))
    );
  }

  // Kill runner processes from this Ollama folder whose parent is gone (never a live server's).
  function sweepOrphans() {
    if (!base) return Promise.resolve();
    const dir = base.replace(/'/g, "''");
    const ps =
      "$all = Get-CimInstance Win32_Process; $ids = $all.ProcessId; " +
      `$all | Where-Object { $_.Name -eq 'llama-server.exe' -and $_.ExecutablePath -like '${dir}\\*' -and $ids -notcontains $_.ParentProcessId } | ` +
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }";
    return new Promise((resolve) =>
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true }, (err, out) => {
        const n = String(out || "").trim().split(/\s+/).filter(Boolean).length;
        if (n) console.log(`[ollama] removed ${n} leftover runner process(es)`);
        resolve();
      })
    );
  }

  // On app exit: stop ours unless another program is using it right now.
  async function shutdown() {
    if (!pid) return;
    if (!(await othersUsing())) await stop();
  }

  return {
    adopt,
    use,
    up,
    stop,
    shutdown,
    host,
    model,
    keepAlive: `${KEEP_ALIVE_SEC}s`,
    options: gpu ? {} : { num_gpu: 0 }, // per request too, for an Ollama this app didn't start
    status: () => ({ ...status, model, running: !!pid || status.running }),
  };
}

module.exports = { createOllama };
