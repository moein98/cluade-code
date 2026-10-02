// Compact widget view of the dashboard. Runs inside the Electron widget window
// (window.agenticDesktop is provided by electron/preload.js) or as a plain page at /widget.
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const { t, hm } = I18N;
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
function fmtTrend(x) {
  if (x == null || Math.abs(x) < 0.1) return `· ${t("flat")}`;
  return (x > 0 ? "▲ " : "▼ ") + Math.round(Math.abs(x) * 100) + "%";
}
function modelName(id) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id || "");
  return m ? `${m[1].toUpperCase()} ${m[2]}${m[3] ? "." + m[3] : ""}` : t("defaultModel");
}
// Joins mixed Persian/number segments; each is bidi-isolated so RTL text keeps its order.
const segs = (...parts) => parts.map((p) => `<bdi>${p}</bdi>`).join(" · ");
const skillOf = (name) => (state ? state.skills.find((k) => k.name === name) : null);
const labelOf = (name, fallback) => esc(I18N.skillLabel(skillOf(name), fallback));

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agentic-OS": "1" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { code: j.code });
  return j;
}

function tile(el, o) {
  const pct = o.pct != null ? Math.min(100, o.pct) : o.limit ? Math.min(100, (o.used / o.limit) * 100) : 0;
  el.innerHTML = `
    <div class="row"><span class="lbl">${o.label}</span><span class="rt">${o.right}</span></div>
    <div class="meter"><div class="fill" style="width:${pct}%"></div></div>
    <div class="row bottom"><span class="val"><bdi>${o.value}</bdi></span><span class="mid">${o.mid}</span>${
      o.badge ? `<span class="badge">${o.badge}</span>` : "<span></span>"
    }</div>`;
}

function render() {
  const s = state;
  if (s && s.meta.language && s.meta.language !== I18N.lang()) I18N.set(s.meta.language);
  $("#online").className = "w-dot " + (s ? "ok" : "bad");
  $("#body").hidden = !s;
  $("#offline").hidden = !!s;
  if (s) {
    const limText = (x) => `${x.live ? "~" : ""}${fmtTok(x.limit)}`;
    for (const [id, x, label] of [
      ["#t-5h", s.fiveHour, t("fiveHour")],
      ["#t-week", s.weekly, t("weekly")],
    ]) {
      tile($(id), {
        label, right: `${t("resets")} · ${I18N.dur(x.resetsIn, true)}`, used: x.used, limit: x.limit, pct: x.pct,
        value: `${fmtTok(x.used)} <small>/ ${limText(x)}</small>`,
        mid: x.pct != null ? segs(`${Math.round(x.pct)}%`, `${x.sessions} ${t("sessions")}`) : `· ${x.sessions} ${t("sessions")}`,
        badge: fmtTrend(x.trend),
      });
    }
    const r = s.routines;
    tile($("#t-routines"), {
      label: `${t("routines")} · ${esc(s.meta.plan)}`, right: "", used: r.runsToday, limit: r.limit,
      value: `${r.runsToday} <small>/ ${r.limit}</small>`, mid: `$${r.costToday.toFixed(1)} ${t("today")}`,
    });

    const run = s.recentRuns.find((x) => x.status === "RUNNING") || s.lastRun;
    const last = $("#last");
    if (run) {
      const cls = run.status === "RUNNING" ? "running" : run.status === "FAILED" ? "failed" : "";
      let stats;
      if (run.status === "RUNNING") stats = segs(`${t("started")} ${hm(run.startedAt)}`, modelName(run.model));
      else if (run.status === "FAILED") stats = `<bdi>${esc(run.error || "failed")}</bdi>`;
      else stats = segs(hm(run.startedAt), `$${(run.cost ?? 0).toFixed(4)}`, modelName(run.model), `${run.output ?? 0} ${t("out")}`);
      last.dataset.note = run.note || "";
      last.title = run.note ? `${t("openInObsidian")} · ${run.note}` : "";
      last.innerHTML = `<div class="lbl">${t("lastRun")} · ${labelOf(run.skill, run.label)}</div>
        <div class="status ${cls}"><span>${t(run.status)}</span><span class="sdot"></span></div>
        <div class="stats${run.status === "FAILED" ? " err" : ""}">${stats}</div>`;
    } else {
      last.dataset.note = "";
      last.innerHTML = `<div class="lbl">${t("lastRun")}</div><div class="status"><span>${t("idle")}</span><span class="sdot"></span></div><div class="stats">${t("noRuns")}</div>`;
    }

    const next = $("#next");
    if (flash && Date.now() < flash.until) {
      next.className = "w-next err";
      next.textContent = flash.msg;
    } else if (s.upcoming.length) {
      const u = s.upcoming[0];
      const label = I18N.skillLabel(skillOf(u.skill), u.label) + (u.cloud ? ` · ${t("cloud")}` : "");
      next.className = "w-next";
      next.textContent = `${t("next")} · ${label} · ${hm(u.at)} · ${t("inTime", { d: I18N.dur(u.at - Date.now(), true) })}`;
    } else {
      next.className = "w-next";
      next.textContent = `${t("next")} · ${t("nothingScheduled")}`;
    }

    const inboxLine = $("#inbox-line");
    inboxLine.hidden = !s.inbox.count;
    inboxLine.textContent = `${t("inbox")} · ${t("inboxNew", { n: s.inbox.count })}`;

    const live = armed && Date.now() - armedAt <= 4000;
    $("#skills").innerHTML = s.skills
      .map((k) => {
        const isArmed = live && armed === k.name;
        const cls = k.running ? " running" : isArmed ? " armed" : "";
        const text = k.running ? t("RUNNING") : isArmed ? t("clickToRun") : esc(I18N.skillLabel(k));
        const tip = `${I18N.skillLabel(k)} · ${I18N.tier(k.tier)} · ${modelName(k.model)}\n\n${k.description}`;
        return `<button class="w-skill${cls}" data-skill="${esc(k.name)}" title="${esc(tip)}"><i>${k.running ? "●" : "▸"}</i> ${text}</button>`;
      })
      .join("");
  }
  if (s && s.claude) {
    // A click opens the Obsidian page: the project page, or the note written for the session.
    const mark = (m) => `<span class="m${m === "old" ? " old" : ""}">${t(m === "old" ? "cpOld" : "cpThis")}</span>`;
    $("#w-projects").innerHTML = s.claude.projects
      .map((p) => `<button class="w-item" data-note="${esc(p.file)}" title="${esc(t("cpOpenHint"))}"><span class="n" dir="auto">${esc(p.name)}</span><span class="m">${t("cpSessionsN", { n: p.sessions })}</span></button>`)
      .join("");
    $("#w-sessions").innerHTML = s.claude.sessions
      .map((x) => `<button class="w-item" data-note="${esc(x.note)}" title="${esc((x.project ? x.project + " · " : "") + t("cpOpenHint"))}"><span class="n" dir="auto">${esc(x.title)}</span>${mark(x.machine)}</button>`)
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
  // No polling while the widget is hidden; catch up as soon as it is visible.
  if (!document.hidden) load.timer = setTimeout(load, busy ? 3000 : 10000);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});

function showError(msg) {
  flash = { msg, until: Date.now() + 5000 };
  render();
  setTimeout(render, 5100);
}

// Two-click confirm on skills: every run spends plan usage.
$("#skills").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-skill]");
  if (!b || !state) return;
  const k = skillOf(b.dataset.skill);
  if (!k || k.running) return;
  if (k.prompt.includes("<topic here>")) {
    // Needs input (e.g. deep-research): use the dashboard's prompt editor.
    if (desktop) desktop.openDashboard();
    else window.open(`/#run=${k.name}`, "_blank");
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
    // Over the quota guard: the widget doesn't override it; the dashboard can, after a confirm.
    showError(err.code === "QUOTA" ? t("quotaBlocked", { reason: err.message }) : err.message);
  }
});

$("#inbox-line").addEventListener("click", () => (desktop ? desktop.openDashboard() : window.open("/", "_blank")));

$("#last").addEventListener("click", async () => {
  const note = $("#last").dataset.note;
  if (!note) return;
  try {
    await post("/api/open/note", { file: note });
  } catch (err) {
    showError(err.message);
  }
});

document.addEventListener("click", async (e) => {
  const b = e.target.closest(".w-item[data-note]");
  if (!b) return;
  try {
    await post("/api/open/note", { file: b.dataset.note });
  } catch (err) {
    showError(err.message);
  }
});

$("#w-open").addEventListener("click", () => (desktop ? desktop.openDashboard() : window.open("/", "_blank")));
$("#w-close").addEventListener("click", () => (desktop ? desktop.hideWidget() : window.close()));

I18N.set("en");
load();
