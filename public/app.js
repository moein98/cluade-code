const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = { sun: "SUN", mon: "MON", tue: "TUE", wed: "WED", thu: "THU", fri: "FRI", sat: "SAT" };

let state = null;

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

function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (bad ? " bad" : "");
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4000);
}

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
const hm = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dayLabel = (iso) => {
  const [, m, d] = iso.split("-");
  return `${MONTHS[+m - 1]} ${d}`;
};
const whenLabel = (t) => {
  const d = new Date(t);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? `TODAY ${hm(t)}` : `${MONTHS[d.getMonth()]} ${pad(d.getDate())} ${hm(t)}`;
};

function tile(el, o) {
  const pct = o.limit ? Math.min(100, (o.used / o.limit) * 100) : 0;
  el.innerHTML = `
    <div class="row"><span class="lbl">${o.label}</span><span class="rt">${o.right}</span></div>
    <div class="meter" role="meter" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><div class="fill" style="width:${pct}%"></div></div>
    <div class="row bottom"><span class="val">${o.value}</span><span class="mid">${o.mid}</span>${
      o.badge ? `<span class="badge">${o.badge}</span>` : "<span></span>"
    }</div>`;
}

function renderTiles(s) {
  const f = s.fiveHour;
  tile($("#t-5h"), {
    label: "5-HOUR WINDOW",
    right: `RESETS · ${fmtDur(f.resetsIn)}`,
    used: f.used,
    limit: f.limit,
    value: `${fmtTok(f.used)} <small>/ ${fmtTok(f.limit)}</small>`,
    mid: `· ${f.sessions} SESSIONS`,
    badge: fmtTrend(f.trend),
  });
  const w = s.weekly;
  tile($("#t-week"), {
    label: "WEEKLY WINDOW",
    right: `RESETS · ${fmtDur(w.resetsIn)}`,
    used: w.used,
    limit: w.limit,
    value: `${fmtTok(w.used)} <small>/ ${fmtTok(w.limit)}</small>`,
    mid: `· ${w.sessions} SESSIONS`,
    badge: fmtTrend(w.trend),
  });
  const r = s.routines;
  tile($("#t-routines"), {
    label: `ROUTINES · ${esc(s.meta.plan)}`,
    right: "",
    used: r.runsToday,
    limit: r.limit,
    value: `${r.runsToday} <small>/ ${r.limit}</small>`,
    mid: `$${r.costToday.toFixed(1)} TODAY`,
  });
}

function renderChart(act) {
  const box = $("#chart");
  const W = box.clientWidth;
  const H = box.clientHeight;
  const P = { l: 0, r: 0, t: 8, b: 26 };
  const days = act.days;
  const n = days.length;
  const max = Math.max(1, days[n - 1].cum) * 1.1;
  const x = (i) => P.l + ((W - P.l - P.r) * i) / (n - 1);
  const y = (v) => P.t + (H - P.t - P.b) * (1 - v / max);
  const bottom = H - P.b;

  let grid = "";
  for (let i = 0; i < n; i++) grid += `<line class="${i % 7 === 0 ? "g2" : "g1"}" x1="${x(i)}" x2="${x(i)}" y1="${P.t}" y2="${bottom}"/>`;
  for (let k = 0; k <= 8; k++) {
    const yy = P.t + ((bottom - P.t) * k) / 8;
    grid += `<line class="g1" x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}"/>`;
  }
  let labels = "";
  for (let i = 0; i < n - 3; i += 7) labels += `<text class="xl" x="${x(i) + 4}" y="${H - 6}">${dayLabel(days[i].date)}</text>`;

  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d.cum).toFixed(1)}`);
  const line = "M" + pts.join("L");
  const area = `${line}L${x(n - 1)},${bottom}L${x(0)},${bottom}Z`;

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative Claude Code tokens over the last 30 days, ${fmtTok(act.total)} total">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d0633d" stop-opacity=".38"/>
        <stop offset="1" stop-color="#d0633d" stop-opacity=".02"/>
      </linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#ag)"/>
      <path class="ln" d="${line}"/>
      ${labels}
      <g id="hover" visibility="hidden"><line class="cross" y1="${P.t}" y2="${bottom}"/><circle class="dot" r="4.5"/></g>
      <rect id="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    </svg>
    <div class="tip" id="tip" hidden></div>`;
  $("#total").textContent = `· ${fmtTok(act.total)}`;

  const hit = $("#hit");
  const g = $("#hover");
  const tip = $("#tip");
  hit.addEventListener("mousemove", (e) => {
    const rect = box.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (n - 1))));
    const d = days[i];
    g.setAttribute("visibility", "visible");
    g.querySelector("line").setAttribute("x1", x(i));
    g.querySelector("line").setAttribute("x2", x(i));
    g.querySelector("circle").setAttribute("cx", x(i));
    g.querySelector("circle").setAttribute("cy", y(d.cum));
    tip.hidden = false;
    tip.innerHTML = `<b>${dayLabel(d.date)}</b><br>DAY ${fmtTok(d.tokens)} · $${d.cost.toFixed(2)}<br>TOTAL ${fmtTok(d.cum)}`;
    const left = x(i) + 14 + tip.offsetWidth > W ? x(i) - 14 - tip.offsetWidth : x(i) + 14;
    tip.style.left = left + "px";
    tip.style.top = Math.max(0, y(d.cum) - tip.offsetHeight - 10) + "px";
  });
  hit.addEventListener("mouseleave", () => {
    g.setAttribute("visibility", "hidden");
    tip.hidden = true;
  });
}

function renderIntegrations(list) {
  const el = $("#integ");
  if (list === null) {
    el.innerHTML = `<span class="empty">CHECKING…</span>`;
    return;
  }
  if (!list.length) {
    el.innerHTML = `<span class="empty">NONE CONNECTED</span>`;
    return;
  }
  el.innerHTML = list
    .map((i) => `<span class="integ-item${i.ok ? "" : " bad"}" title="${esc(i.status)}">${esc(i.name)}</span>`)
    .join("");
}

function renderLast(s) {
  const running = s.recentRuns.find((r) => r.status === "RUNNING");
  const r = running || s.lastRun;
  const el = $("#last");
  if (!r) {
    el.innerHTML = `<div class="lbl">LAST RUN</div><div class="status"><span>IDLE</span><span class="sdot"></span></div>
      <div class="stats">NO RUNS YET · PICK A SKILL BELOW</div>`;
    return;
  }
  const cls = r.status === "RUNNING" ? "running" : r.status === "FAILED" ? "failed" : "";
  const link = r.note
    ? `<a class="olink" data-note="${esc(r.note)}">◆ OPEN IN OBSIDIAN · ${esc(r.note)}</a>`
    : "";
  let stats;
  if (r.status === "RUNNING") stats = `<div class="stats">STARTED ${hm(r.startedAt)} · ${esc(r.trigger.toUpperCase())}</div>`;
  else if (r.status === "FAILED") stats = `<div class="stats err">${esc(r.error || "failed")}</div>`;
  else stats = `<div class="stats">$${(r.cost ?? 0).toFixed(4)} · ${r.input ?? 0} IN · ${r.output ?? 0} OUT</div>`;
  el.innerHTML = `<div class="lbl">LAST RUN · ${esc(r.label)}</div>
    <div class="status ${cls}"><span>${r.status}</span><span class="sdot"></span></div>
    ${link}${stats}`;
}

function renderRecent(runs) {
  const el = $("#recent");
  if (!runs.length) {
    el.innerHTML = `<li class="empty">NO RUNS YET</li>`;
    return;
  }
  el.innerHTML = runs
    .map((r) => {
      const st = r.status === "RUNNING" ? `<span class="st run">●</span>` : r.status === "FAILED" ? `<span class="st bad">✕</span>` : `<span class="st">✓</span>`;
      return `<li ${r.note ? `data-note="${esc(r.note)}"` : ""} title="${esc(r.error || r.status)}"><span class="tm">${hm(r.startedAt)}</span><span class="nm">${esc(r.label)}</span>${st}</li>`;
    })
    .join("");
}

function scheduleText(s) {
  if (!s.schedule) return "ON DEMAND";
  const days = s.days ? s.days.map((d) => DAYS[d] || d).join(" ") : "DAILY";
  return `${days} · ${s.schedule}`;
}

function renderSkills(s) {
  const el = $("#skills");
  $("#skills-note").textContent = `${s.skills.length} SKILLS · CLICK TO RUN HEADLESS`;
  if (!s.skills.length) {
    el.innerHTML = `<div class="empty">NO SKILLS FOUND IN VAULT/.CLAUDE/SKILLS</div>`;
    return;
  }
  const order = [...s.domains, ...new Set(s.skills.map((k) => k.domain))];
  const domains = [...new Set(order)].filter((d) => s.skills.some((k) => k.domain === d));
  el.innerHTML = domains
    .map(
      (d) => `<div class="card domain"><span class="lbl">${esc(d)}</span>${s.skills
        .filter((k) => k.domain === d)
        .map(
          (k) => `<button class="skill${k.running ? " running" : ""}" data-skill="${esc(k.name)}" title="${esc(k.description)}">
            <span><span class="sn">${esc(k.label)}</span><span class="ss">${scheduleText(k)}</span></span>
            <span class="go">${k.running ? "RUNNING" : "▸ RUN"}</span></button>`
        )
        .join("")}</div>`
    )
    .join("");
}

function renderUpcoming(list) {
  $("#upcoming").innerHTML = list.length
    ? list.map((u) => `<li><span class="tm">${whenLabel(u.at)}</span><span class="nm">${esc(u.label)}</span><span class="st">IN ${fmtDur(u.at - Date.now())}</span></li>`).join("")
    : `<li class="empty">NOTHING SCHEDULED</li>`;
}

function renderChanges(list) {
  $("#changes").innerHTML = list.length
    ? list.map((c) => `<li data-note="${esc(c.file)}"><span class="tm">${whenLabel(c.at)}</span><span class="nm file">${esc(c.file)}</span><span></span></li>`).join("")
    : `<li class="empty">NO CHANGES</li>`;
}

function render(s) {
  $("#meta").textContent = `VAULT · ${s.meta.vault} · PLAN · ${s.meta.plan} · PERMISSIONS · ${s.meta.permissions}`;
  renderTiles(s);
  renderChart(s.activity);
  renderIntegrations(s.integrations);
  renderLast(s);
  renderRecent(s.recentRuns);
  renderSkills(s);
  renderUpcoming(s.upcoming);
  renderChanges(s.changes);
}

async function load() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    state = await r.json();
    if (!r.ok) throw new Error(state.error || r.statusText);
    render(state);
  } catch (e) {
    toast(`Dashboard offline: ${e.message}`, true);
  }
  const busy = state && state.recentRuns.some((r) => r.status === "RUNNING");
  clearTimeout(load.timer);
  load.timer = setTimeout(load, busy ? 3000 : 15000);
}

// Quick links
document.querySelectorAll("[data-open]").forEach((b) =>
  b.addEventListener("click", async () => {
    b.classList.add("flash");
    setTimeout(() => b.classList.remove("flash"), 300);
    try {
      await post(`/api/open/${b.dataset.open}`);
    } catch (e) {
      toast(e.message, true);
    }
  })
);

// Open notes in Obsidian (last run link, recent runs, vault changes)
document.addEventListener("click", async (e) => {
  const n = e.target.closest("[data-note]");
  if (!n) return;
  e.preventDefault();
  try {
    await post("/api/open/note", { file: n.dataset.note });
  } catch (err) {
    toast(err.message, true);
  }
});

// Skill launcher: editable prompt, then headless run
let current = null;
const modal = $("#modal");
function closeModal() {
  modal.hidden = true;
  current = null;
}
$("#skills").addEventListener("click", (e) => {
  const b = e.target.closest("[data-skill]");
  if (!b || !state) return;
  const k = state.skills.find((s) => s.name === b.dataset.skill);
  if (!k) return;
  current = k;
  $("#m-title").textContent = `${k.label} · ${k.domain.toUpperCase()} · ${scheduleText(k)}`;
  $("#m-desc").textContent = k.description;
  $("#m-prompt").value = k.prompt;
  $("#m-run").disabled = k.running;
  modal.hidden = false;
  const ta = $("#m-prompt");
  ta.focus();
  const ph = ta.value.indexOf("<topic here>");
  if (ph >= 0) ta.setSelectionRange(ph, ph + "<topic here>".length);
});
$("#m-cancel").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => e.target === modal && closeModal());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !modal.hidden) $("#m-run").click();
});
$("#m-run").addEventListener("click", async () => {
  if (!current) return;
  const name = current.name;
  const label = current.label;
  try {
    await post(`/api/run/${name}`, { prompt: $("#m-prompt").value });
    closeModal();
    toast(`${label} started — running headless`);
    load();
  } catch (e) {
    toast(e.message, true);
  }
});

window.addEventListener("resize", () => state && renderChart(state.activity));
load();
