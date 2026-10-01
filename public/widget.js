// Compact widget view of the dashboard. Runs inside the Electron widget window
// (window.agenticDesktop is provided by electron/preload.js) or as a plain page at /widget.
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const desktop = window.agenticDesktop || null;

let state = null;
let armed = null;
let armedAt = 0;
let flash = null;

function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n || 0));
}
function fmtDur(ms) {
  if (ms == null) return "—";
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}D ${h}H` : `${h}H ${pad(m % 60)}M`;
}
function fmtTrend(t) {
  if (t == null || Math.abs(t) < 0.1) return "· FLAT";
  return (t > 0 ? "▲ " : "▼ ") + Math.round(Math.abs(t) * 100) + "%";
}
function modelName(id) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id || "");
  return m ? `${m[1].toUpperCase()} ${m[2]}${m[3] ? "." + m[3] : ""}` : "DEFAULT";
}
const hm = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agentic-OS": "1" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function tile(el, o) {
  const pct = o.limit ? Math.min(100, (o.used / o.limit) * 100) : 0;
  el.innerHTML = `
    <div class="row"><span class="lbl">${o.label}</span><span class="rt">${o.right}</span></div>
    <div class="meter"><div class="fill" style="width:${pct}%"></div></div>
    <div class="row bottom"><span class="val">${o.value}</span><span class="mid">${o.mid}</span>${
      o.badge ? `<span class="badge">${o.badge}</span>` : "<span></span>"
    }</div>`;
}

function render() {
  const s = state;
  $("#online").className = "w-dot " + (s ? "ok" : "bad");
  $("#body").hidden = !s;
  $("#offline").hidden = !!s;
  if (s) {
    const f = s.fiveHour;
    tile($("#t-5h"), {
      label: "5-HOUR WINDOW", right: `RESETS · ${fmtDur(f.resetsIn)}`, used: f.used, limit: f.limit,
      value: `${fmtTok(f.used)} <small>/ ${fmtTok(f.limit)}</small>`, mid: `· ${f.sessions} SESSIONS`, badge: fmtTrend(f.trend),
    });
    const w = s.weekly;
    tile($("#t-week"), {
      label: "WEEKLY WINDOW", right: `RESETS · ${fmtDur(w.resetsIn)}`, used: w.used, limit: w.limit,
      value: `${fmtTok(w.used)} <small>/ ${fmtTok(w.limit)}</small>`, mid: `· ${w.sessions} SESSIONS`, badge: fmtTrend(w.trend),
    });
    const r = s.routines;
    tile($("#t-routines"), {
      label: `ROUTINES · ${esc(s.meta.plan)}`, right: "", used: r.runsToday, limit: r.limit,
      value: `${r.runsToday} <small>/ ${r.limit}</small>`, mid: `$${r.costToday.toFixed(1)} TODAY`,
    });

    const run = s.recentRuns.find((x) => x.status === "RUNNING") || s.lastRun;
    const last = $("#last");
    if (run) {
      const cls = run.status === "RUNNING" ? "running" : run.status === "FAILED" ? "failed" : "";
      let stats;
      if (run.status === "RUNNING") stats = `STARTED ${hm(run.startedAt)} · ${modelName(run.model)}`;
      else if (run.status === "FAILED") stats = esc(run.error || "failed");
      else stats = `${hm(run.startedAt)} · $${(run.cost ?? 0).toFixed(4)} · ${modelName(run.model)} · ${run.input ?? 0} IN · ${run.output ?? 0} OUT`;
      last.dataset.note = run.note || "";
      last.title = run.note ? `Open in Obsidian · ${run.note}` : "";
      last.innerHTML = `<div class="lbl">LAST RUN · ${esc(run.label)}</div>
        <div class="status ${cls}"><span>${run.status}</span><span class="sdot"></span></div>
        <div class="stats${run.status === "FAILED" ? " err" : ""}">${stats}</div>`;
    } else {
      last.dataset.note = "";
      last.innerHTML = `<div class="lbl">LAST RUN</div><div class="status"><span>IDLE</span><span class="sdot"></span></div><div class="stats">NO RUNS YET</div>`;
    }

    const next = $("#next");
    if (flash && Date.now() < flash.until) {
      next.className = "w-next err";
      next.textContent = flash.msg;
    } else if (s.upcoming.length) {
      const u = s.upcoming[0];
      next.className = "w-next";
      next.textContent = `NEXT · ${u.label} · ${hm(u.at)} · IN ${fmtDur(u.at - Date.now())}`;
    } else {
      next.className = "w-next";
      next.textContent = "NEXT · NOTHING SCHEDULED";
    }

    const live = armed && Date.now() - armedAt <= 4000;
    $("#skills").innerHTML = s.skills
      .map((k) => {
        const isArmed = live && armed === k.name;
        const cls = k.running ? " running" : isArmed ? " armed" : "";
        const text = k.running ? "RUNNING" : isArmed ? "CLICK TO RUN" : esc(k.label);
        const tip = `${k.label} · ${(k.tier || "").toUpperCase()} · ${modelName(k.model)}\n\n${k.description}`;
        return `<button class="w-skill${cls}" data-skill="${esc(k.name)}" title="${esc(tip)}"><i>${k.running ? "●" : "▸"}</i> ${text}</button>`;
      })
      .join("");
  }
  if (desktop) desktop.resize(document.getElementById("card").offsetHeight);
}

async function load() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (!r.ok) throw new Error(r.statusText);
    state = await r.json();
  } catch {
    state = null;
  }
  render();
  const busy = state && state.recentRuns.some((x) => x.status === "RUNNING");
  clearTimeout(load.timer);
  load.timer = setTimeout(load, busy ? 3000 : 10000);
}

function showError(msg) {
  flash = { msg, until: Date.now() + 5000 };
  render();
  setTimeout(render, 5100);
}

// Two-click confirm on skills: every run spends plan usage.
$("#skills").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-skill]");
  if (!b || !state) return;
  const k = state.skills.find((s) => s.name === b.dataset.skill);
  if (!k || k.running) return;
  if (k.prompt.includes("<topic here>")) {
    // Needs input (e.g. deep-research): use the dashboard's prompt editor.
    if (desktop) desktop.openDashboard();
    else window.open("/", "_blank");
    return;
  }
  if (armed !== k.name || Date.now() - armedAt > 4000) {
    armed = k.name;
    armedAt = Date.now();
    render();
    setTimeout(render, 4100);
    return;
  }
  armed = null;
  try {
    await post(`/api/run/${k.name}`);
    load();
  } catch (err) {
    showError(err.message);
  }
});

$("#last").addEventListener("click", async () => {
  const note = $("#last").dataset.note;
  if (!note) return;
  try {
    await post("/api/open/note", { file: note });
  } catch (err) {
    showError(err.message);
  }
});

$("#w-open").addEventListener("click", () => (desktop ? desktop.openDashboard() : window.open("/", "_blank")));
$("#w-close").addEventListener("click", () => (desktop ? desktop.hideWidget() : window.close()));

load();
