const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const { t, hm } = I18N;

let state = null;

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

// Starts a skill; when the quota guard blocks it, asks before running anyway.
async function runSkill(name, body = {}) {
  try {
    return await post(`/api/run/${name}`, body);
  } catch (e) {
    const q = state && state.quota;
    if (e.code !== "QUOTA" || !q) throw e;
    const msg = t("quotaConfirm", { window: I18N.windowName(q.window), pct: Math.round(q.pct), max: q.max });
    if (!confirm(msg)) return null;
    return post(`/api/run/${name}`, { ...body, force: true });
  }
}

function toast(msg, bad) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (bad ? " bad" : "");
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 4000);
}

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
// claude-haiku-4-5 -> HAIKU 4.5
function modelName(id) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id || "");
  return m ? `${m[1].toUpperCase()} ${m[2]}${m[3] ? "." + m[3] : ""}` : t("defaultModel");
}
// Joins mixed Persian/number segments; each is bidi-isolated so RTL text keeps its order.
const segs = (...parts) => parts.map((p) => `<bdi>${p}</bdi>`).join(" · ");
const skillOf = (name) => (state ? state.skills.find((k) => k.name === name) : null);
const labelOf = (name, fallback) => esc(I18N.skillLabel(skillOf(name), fallback));

// Quality-check badge for a run (skills[].checks graded by a small model).
function qualityBadge(r) {
  const c = r && r.check;
  if (!c) return "";
  if (c.pending) return `<span class="qb">${t("qualityPending")}</span>`;
  if (c.pass === true) return `<span class="qb ok">${t("qualityPass")}</span>`;
  if (c.pass === false) return `<span class="qb bad" title="${esc((c.failed || []).join("\n"))}">⚠ ${t("qualityFail")}</span>`;
  return "";
}
// 👍/👎 buttons; data-run or data-file says what the feedback is about.
function fbButtons(target, label, given) {
  const attr = `${target} data-label="${esc(label)}"`;
  return `<span class="fbs"><button class="fb${given === "up" ? " on" : ""}" data-fb="up" ${attr} title="👍">👍</button><button class="fb${given === "down" ? " on" : ""}" data-fb="down" ${attr} title="👎">👎</button></span>`;
}

function tile(el, o) {
  // Live utilization from claude.ai when available; otherwise estimated from tokens.
  const pct = o.pct != null ? Math.min(100, o.pct) : o.limit ? Math.min(100, (o.used / o.limit) * 100) : 0;
  el.innerHTML = `
    <div class="row"><span class="lbl">${o.label}</span><span class="rt">${o.right}</span></div>
    <div class="meter" role="meter" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><div class="fill" style="width:${pct}%"></div>${
      o.guard != null ? `<span class="mark" style="inset-inline-start:${o.guard}%" title="${o.guard}%"></span>` : ""
    }</div>
    <div class="row bottom"><span class="val"><bdi>${o.value}</bdi></span><span class="mid">${o.mid}</span>${
      o.badge ? `<span class="badge">${o.badge}</span>` : "<span></span>"
    }</div>`;
}

function renderTiles(s) {
  const limText = (x) => `${x.live ? "~" : ""}${fmtTok(x.limit)}`;
  const q = s.quota || {};
  for (const [id, x, label, guard] of [
    ["#t-5h", s.fiveHour, t("fiveHour"), q.enabled ? q.fiveHourMax : null],
    ["#t-week", s.weekly, t("weekly"), q.enabled ? q.weeklyMax : null],
  ]) {
    tile($(id), {
      label,
      guard,
      right: `${t("resets")} · ${I18N.dur(x.resetsIn)}`,
      used: x.used,
      limit: x.limit,
      pct: x.pct,
      value: `${fmtTok(x.used)} <small>/ ${limText(x)}</small>`,
      mid: x.pct != null ? segs(`${Math.round(x.pct)}%`, `${x.sessions} ${t("sessions")}`) : `· ${x.sessions} ${t("sessions")}`,
      badge: fmtTrend(x.trend),
    });
  }
  const r = s.routines;
  tile($("#t-routines"), {
    label: `${t("routines")} · ${esc(s.meta.plan)}`,
    right: "",
    used: r.runsToday,
    limit: r.limit,
    value: `${r.runsToday} <small>/ ${r.limit}</small>`,
    mid: `$${r.costToday.toFixed(1)} ${t("today")}`,
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
  for (let i = 0; i < n - 3; i += 7) labels += `<text class="xl" x="${x(i) + 4}" y="${H - 6}">${I18N.dayLabel(days[i].date)}</text>`;

  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d.cum).toFixed(1)}`);
  const line = "M" + pts.join("L");
  const area = `${line}L${x(n - 1)},${bottom}L${x(0)},${bottom}Z`;

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("activity"))}: ${fmtTok(act.total)}">
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
    tip.innerHTML = `<b>${I18N.dayLabel(d.date)}</b><br>${t("day")} ${fmtTok(d.tokens)} · $${d.cost.toFixed(2)}<br>${t("total")} ${fmtTok(d.cum)}`;
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
    el.innerHTML = `<span class="empty">${t("checking")}</span>`;
    return;
  }
  if (!list.length) {
    el.innerHTML = `<span class="empty">${t("noneConnected")}</span>`;
    return;
  }
  el.innerHTML = list
    .map((i) => {
      // Clicking TELEGRAM sends a test message; MEMORY MAP re-runs the map check; SEMANTIC SEARCH
      // updates the index now.
      const test = i.name === "telegram" ? ` data-action="tg-test" role="button"` : i.action ? ` data-action="${esc(i.action)}" role="button"` : "";
      return `<span class="integ-item${i.ok ? "" : " bad"}"${test} title="${esc(i.status)}"><bdi>${esc(i.name)}</bdi></span>`;
    })
    .join("");
}

$("#integ").addEventListener("click", async (e) => {
  const a = e.target.closest("[data-action]");
  if (!a) return;
  try {
    if (a.dataset.action === "tg-test") {
      await post("/api/telegram/test");
      toast("Telegram ✓");
    } else if (a.dataset.action === "map-check") {
      const r = await post("/api/map/check");
      toast(t("mapChecked", { result: r.ok ? "✓" : r.problems.slice(0, 3).join(" | ") }), !r.ok);
      load();
    } else if (a.dataset.action === "semantic-index") {
      await post("/api/semantic/index");
      toast(t("indexing"));
      setTimeout(load, 3000);
    }
  } catch (err) {
    toast(err.message, true);
  }
});

function renderLast(s) {
  const running = s.recentRuns.find((r) => r.status === "RUNNING");
  const r = running || s.lastRun;
  const el = $("#last");
  if (!r) {
    el.innerHTML = `<div class="lbl">${t("lastRun")}</div><div class="status"><span>${t("idle")}</span><span class="sdot"></span></div>
      <div class="stats">${t("noRunsPick")}</div>`;
    return;
  }
  const cls = r.status === "RUNNING" ? "running" : r.status === "FAILED" ? "failed" : "";
  const link = r.note
    ? `<a class="olink" data-note="${esc(r.note)}">◆ ${t("openInObsidian")} · <bdi>${esc(r.note)}</bdi></a>`
    : "";
  let stats;
  if (r.status === "RUNNING") {
    stats = `<div class="stats">${segs(`${t("started")} ${hm(r.startedAt)}`, t(r.trigger), modelName(r.model))}</div>`;
  } else if (r.status === "FAILED") {
    stats = `<div class="stats err"><bdi>${esc(r.error || "failed")}</bdi></div>`;
  } else {
    stats = `<div class="stats">${segs(`$${(r.cost ?? 0).toFixed(4)}`, modelName(r.model), `${r.input ?? 0} ${t("in")}`, `${r.output ?? 0} ${t("out")}`)}</div>`;
  }
  const label = I18N.skillLabel(skillOf(r.skill), r.label);
  const foot =
    r.status === "COMPLETE"
      ? `<div class="last-foot">${qualityBadge(r)}${fbButtons(`data-run="${esc(r.id)}"`, label, r.feedback && r.feedback.rating)}</div>`
      : "";
  el.innerHTML = `<div class="lbl">${t("lastRun")} · ${esc(label)}</div>
    <div class="status ${cls}"><span>${t(r.status)}</span><span class="sdot"></span></div>
    ${link}${stats}${foot}`;
}

function renderRecent(runs) {
  const el = $("#recent");
  if (!runs.length) {
    el.innerHTML = `<li class="empty">${t("noRuns")}</li>`;
    return;
  }
  el.innerHTML = runs
    .map((r) => {
      const st =
        r.status === "RUNNING" ? `<span class="st run">●</span>`
        : r.status === "FAILED" ? `<span class="st bad">✕</span>`
        : r.check && r.check.pass === false ? `<span class="st bad" title="${t("qualityFail")}">⚠</span>`
        : `<span class="st">✓</span>`;
      return `<li ${r.note ? `data-note="${esc(r.note)}"` : ""} title="${esc(r.error || t(r.status))} · ${modelName(r.model)}"><span class="tm">${hm(r.startedAt)}</span><span class="nm">${labelOf(r.skill, r.label)}</span>${st}</li>`;
    })
    .join("");
}

function scheduleText(s) {
  if (!s.schedule) return t("onDemand");
  const days = s.days ? s.days.map(I18N.dayName).join(" ") : t("daily");
  return `${days} · ${s.schedule}`;
}

function renderSkills(s) {
  const el = $("#skills");
  $("#skills-note").textContent = t("skillsNote", { n: s.skills.length });
  if (!s.skills.length) {
    el.innerHTML = `<div class="empty">${t("noSkills")}</div>`;
    return;
  }
  const order = [...s.domains, ...new Set(s.skills.map((k) => k.domain))];
  const domains = [...new Set(order)].filter((d) => s.skills.some((k) => k.domain === d));
  el.innerHTML = domains
    .map(
      (d) => `<div class="card domain"><span class="lbl">${esc(I18N.domain(d))}</span>${s.skills
        .filter((k) => k.domain === d)
        .map(
          (k) => `<button class="skill${k.running ? " running" : ""}" data-skill="${esc(k.name)}" title="${esc(k.description)}">
            <span><span class="sn">${esc(I18N.skillLabel(k))}</span><span class="ss">${scheduleText(k)} · ${esc(I18N.tier(k.tier))}</span></span>
            <span class="go">${k.running ? t("RUNNING") : t("run")}</span></button>`
        )
        .join("")}</div>`
    )
    .join("");
}

function renderUpcoming(list) {
  $("#upcoming").innerHTML = list.length
    ? list
        .map((u) => {
          const label = labelOf(u.skill, u.label) + (u.cloud ? ` · ${t("cloud")}` : "") + (u.deferred ? ` · ${t("deferred")}` : "");
          return `<li><span class="tm">${I18N.when(u.at)}</span><span class="nm">${label}</span><span class="st">${t("inTime", { d: I18N.dur(u.at - Date.now()) })}</span></li>`;
        })
        .join("")
    : `<li class="empty">${t("nothingScheduled")}</li>`;
}

function renderChanges(list) {
  $("#changes").innerHTML = list.length
    ? list
        .map((c) => `<li data-note="${esc(c.file)}"><span class="tm">${I18N.when(c.at)}</span><span class="nm file"><bdi>${esc(c.file)}</bdi></span><span></span></li>`)
        .join("")
    : `<li class="empty">${t("noChanges")}</li>`;
}

function renderInbox(box) {
  $("#inbox-count").textContent = box.count ? t("inboxNew", { n: box.count }) : "";
  $("#inbox-all").hidden = !box.count;
  $("#inbox").innerHTML = box.items.length
    ? box.items
        .map((i) => {
          const title = i.kind === "run" ? labelOf(i.skill, i.title) : `<bdi>${esc(i.title)}</bdi>`;
          const review = i.review ? ` <span class="qb bad">⚠ ${t("qualityFail")}</span>` : "";
          const fb = i.run
            ? fbButtons(`data-run="${esc(i.run)}"`, I18N.skillLabel(skillOf(i.skill), i.title))
            : i.skill
              ? fbButtons(`data-file="${esc(i.file)}"`, I18N.skillLabel(skillOf(i.skill), i.title))
              : "";
          return `<li class="ib" data-note="${esc(i.file)}" title="${esc(i.file)}"><span class="tm">${I18N.when(i.at)}</span><span class="nm${i.kind === "run" ? "" : " file"}">${title}${review}</span><span class="st kind">${fb}${esc(I18N.kind(i.kind))}</span></li>`;
        })
        .join("")
    : `<li class="empty">${t("inboxEmpty")}</li>`;
}

function renderUsage(rows) {
  const el = $("#usage");
  if (!rows.length) {
    el.innerHTML = `<tr><td class="empty">${t("noUsage")}</td></tr>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.cost30), 0.01);
  el.innerHTML =
    `<tr><th>${t("colSkill")}</th><th>${t("colRuns7")}</th><th></th><th>${t("colCost7")}</th><th>${t("colCost30")}</th></tr>` +
    rows
      .map(
        (r) => `<tr title="${r.runs30} runs · ${r.failed30} failed · ${fmtTok(r.out30)} out">
          <td class="nm">${labelOf(r.skill, r.label)}</td>
          <td class="num">${r.runs7}</td>
          <td class="bar"><span style="width:${(r.cost30 / max) * 100}%"></span></td>
          <td class="num">$${r.cost7.toFixed(2)}</td>
          <td class="num">$${r.cost30.toFixed(2)}</td></tr>`
      )
      .join("");
}

function render(s) {
  if (s.meta.language && s.meta.language !== I18N.lang()) I18N.set(s.meta.language);
  $("#meta").textContent = [
    t("vault"), s.meta.vault, t("plan"), s.meta.plan, t("limits"), s.meta.limitsLive ? t("live") : t("est"),
    t("permissions"), s.meta.permissions,
  ].join(" · ");
  $("#meta").title = s.meta.limitsError || (s.meta.limitsLive ? t("liveTip") : "");
  renderTiles(s);
  renderChart(s.activity);
  renderIntegrations(s.integrations);
  renderLast(s);
  renderRecent(s.recentRuns);
  renderSkills(s);
  renderUpcoming(s.upcoming);
  renderChanges(s.changes);
  renderInbox(s.inbox);
  renderUsage(s.skillUsage);
}

async function load() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    state = await r.json();
    if (!r.ok) throw new Error(state.error || r.statusText);
    render(state);
    openFromHash();
  } catch (e) {
    toast(t("offline", { e: e.message }), true);
  }
  const busy = state && state.recentRuns.some((r) => r.status === "RUNNING");
  clearTimeout(load.timer);
  // No polling while the window is hidden or minimized; catch up as soon as it is visible.
  if (!document.hidden) load.timer = setTimeout(load, busy ? 3000 : 15000);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});

// Language switch (stored on the server so the widget and tray follow it)
document.querySelectorAll("[data-lang]").forEach((b) =>
  b.addEventListener("click", async () => {
    try {
      await post("/api/settings", { language: b.dataset.lang });
      I18N.set(b.dataset.lang);
      if (state) {
        state.meta.language = b.dataset.lang;
        render(state);
      }
    } catch (e) {
      toast(e.message, true);
    }
  })
);

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
  if (e.target.closest("[data-fb], [data-resume]")) return; // handled below
  const n = e.target.closest("[data-note]");
  if (!n) return;
  e.preventDefault();
  try {
    await post("/api/open/note", { file: n.dataset.note });
    load(); // opening an item marks it read in the inbox
  } catch (err) {
    toast(err.message, true);
  }
});

$("#inbox-all").addEventListener("click", async () => {
  try {
    await post("/api/inbox/read", { all: true });
    load();
  } catch (e) {
    toast(e.message, true);
  }
});

// Skill launcher: editable prompt and model tier, then headless run
let current = null;
let currentTier = null;
function renderTiers() {
  const models = (state && state.models) || {};
  $("#m-tiers").innerHTML = Object.entries(models)
    .map(
      ([tier, id]) => `<button class="tier" role="radio" aria-checked="${tier === currentTier}" data-tier="${esc(tier)}">
        <b>${esc(I18N.tier(tier))}</b> · ${modelName(id)}</button>`
    )
    .join("");
}
$("#m-tiers").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tier]");
  if (!b) return;
  currentTier = b.dataset.tier;
  renderTiers();
});
const modal = $("#modal");
function closeModal() {
  modal.hidden = true;
  current = null;
  if (location.hash.startsWith("#run=")) history.replaceState(null, "", location.pathname);
}
function openSkill(k) {
  current = k;
  $("#m-title").textContent = `${I18N.skillLabel(k)} · ${I18N.domain(k.domain)} · ${scheduleText(k)}`;
  $("#m-desc").textContent = k.description;
  $("#m-prompt").value = k.prompt;
  currentTier = k.tier;
  renderTiers();
  $("#m-run").disabled = k.running;
  modal.hidden = false;
  const ta = $("#m-prompt");
  ta.focus();
  const ph = ta.value.indexOf("<topic here>");
  if (ph >= 0) ta.setSelectionRange(ph, ph + "<topic here>".length);
}
// Deep link: /#run=<skill> opens that skill's run dialog.
function openFromHash() {
  const m = /^#run=([\w-]+)$/.exec(location.hash);
  if (m && modal.hidden && skillOf(m[1])) openSkill(skillOf(m[1]));
}
$("#skills").addEventListener("click", (e) => {
  const b = e.target.closest("[data-skill]");
  if (!b || !state) return;
  const k = skillOf(b.dataset.skill);
  if (k) openSkill(k);
});
$("#m-cancel").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => e.target === modal && closeModal());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !modal.hidden) $("#m-run").click();
});
$("#m-run").addEventListener("click", async () => {
  if (!current) return;
  const k = current;
  try {
    const tier = currentTier;
    const started = await runSkill(k.name, { prompt: $("#m-prompt").value, tier });
    if (!started) return;
    closeModal();
    toast(t("startedOn", { label: I18N.skillLabel(k), model: modelName(state.models[tier]) }));
    load();
  } catch (e) {
    toast(e.message, true);
  }
});

const debounce = (fn, ms) => {
  let h;
  return (...a) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...a), ms);
  };
};

// Secondary dialogs (feedback, skill builder): close buttons, backdrop and Escape.
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => (b.closest(".modal").hidden = true)));
document.querySelectorAll(".modal:not(#modal)").forEach((m) =>
  m.addEventListener("click", (e) => {
    if (e.target === m) m.hidden = true;
  })
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal:not(#modal)").forEach((m) => (m.hidden = true));
});

// Feedback (learnings loop): 👍/👎 plus an optional note, saved to the skill's learnings.md.
let fbTarget = null;
let fbRating = null;
const fbModal = $("#fb-modal");
function setRating(r) {
  fbRating = r;
  fbModal.querySelectorAll("[data-rating]").forEach((b) => b.setAttribute("aria-checked", b.dataset.rating === r));
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-fb]");
  if (!b) return;
  e.preventDefault();
  fbTarget = b.dataset.run ? { run: b.dataset.run } : { file: b.dataset.file };
  $("#fb-title").textContent = t("feedbackTitle", { label: b.dataset.label || "" });
  $("#fb-note").value = "";
  setRating(b.dataset.fb);
  fbModal.hidden = false;
  $("#fb-note").focus();
});
fbModal.addEventListener("click", (e) => {
  const r = e.target.closest("[data-rating]");
  if (r) setRating(r.dataset.rating);
});
$("#fb-send").addEventListener("click", async () => {
  try {
    await post("/api/feedback", { ...fbTarget, rating: fbRating, note: $("#fb-note").value });
    fbModal.hidden = true;
    toast(t("feedbackSaved"));
    load();
  } catch (e) {
    toast(e.message, true);
  }
});

// Vault search: keyword results (BM25) appear at once; when semantic search is on, the hybrid
// (meaning + keywords) answer replaces them a moment later. Only the newest query is shown.
// Focusing the box warms up Ollama so that answer comes quickly.
let searchSeq = 0;
function renderHits(hits) {
  $("#vault-results").innerHTML = hits.length
    ? hits
        .map((h) => `<li class="hit" data-note="${esc(h.file)}"><span class="nm file"><bdi>${esc(h.file)}</bdi></span><span class="snip" dir="auto">${esc(h.snippet)}</span></li>`)
        .join("")
    : `<li class="empty">${t("noResults")}</li>`;
}
$("#vault-q").addEventListener("focus", () => post("/api/semantic/warm").catch(() => {}));
$("#vault-q").addEventListener(
  "input",
  debounce(async () => {
    const q = $("#vault-q").value.trim();
    const seq = ++searchSeq;
    if (!q) {
      $("#vault-results").innerHTML = "";
      return;
    }
    const url = `/api/search?q=${encodeURIComponent(q)}`;
    try {
      const quick = await (await fetch(`${url}&mode=keyword`)).json();
      if (seq !== searchSeq) return;
      renderHits(quick);
      const full = await (await fetch(url)).json();
      if (seq === searchSeq && full.some((h) => h.mode === "hybrid")) renderHits(full);
    } catch (e) {
      toast(e.message, true);
    }
  }, 350)
);

// Claude Code sessions: recent list, full-text search, resume in a terminal.
async function loadSessions() {
  const q = $("#sess-q").value.trim();
  try {
    const list = await (await fetch(`/api/sessions${q ? `?q=${encodeURIComponent(q)}` : ""}`)).json();
    $("#sessions").innerHTML = list.length
      ? list
          .slice(0, 12)
          .map((s) => {
            const proj = (s.cwd || "").split(/[\\/]/).filter(Boolean).pop() || "";
            const meta = s.snippet
              ? `<span class="snip" dir="auto">${esc(s.snippet)}</span>`
              : `<span class="snip"><bdi>${esc(proj)}</bdi> · ${fmtTok(s.tokens)} · $${(s.cost || 0).toFixed(2)}</span>`;
            return `<li class="sess"><span class="tm">${I18N.when(s.end)}</span><span class="sbody"><span class="nm" dir="auto">${esc(s.title || s.id)}</span>${meta}</span><button class="link-btn" data-resume="${esc(s.id)}">${t("resume")}</button></li>`;
          })
          .join("")
      : `<li class="empty">${t("noSessions")}</li>`;
  } catch (e) {
    toast(e.message, true);
  }
}
$("#sess-q").addEventListener("input", debounce(loadSessions, 400));
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-resume]");
  if (!b) return;
  try {
    await post("/api/open/resume", { session: b.dataset.resume });
  } catch (err) {
    toast(err.message, true);
  }
});

// Skill builder: writes SKILL.md in the vault and a config.json entry.
const BUILDER_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "WebSearch", "WebFetch"];
const DAY_KEYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
$("#new-skill").addEventListener("click", () => {
  if (!state) return;
  const domains = [...new Set([...state.domains, ...state.skills.map((k) => k.domain), "Other"])];
  $("#sb-domain").innerHTML = domains.map((d) => `<option value="${esc(d)}">${esc(I18N.domain(d))}</option>`).join("");
  $("#sb-tier").innerHTML = Object.entries(state.models)
    .map(([k, id]) => `<option value="${esc(k)}"${k === "standard" ? " selected" : ""}>${esc(I18N.tier(k))} · ${modelName(id)}</option>`)
    .join("");
  $("#sb-days").innerHTML = DAY_KEYS.map((d) => `<label class="chk"><input type="checkbox" value="${d}">${esc(I18N.dayName(d))}</label>`).join("");
  $("#sb-tools").innerHTML = BUILDER_TOOLS.map(
    (x) => `<label class="chk"><input type="checkbox" value="${x}"${["Read", "Glob", "Grep"].includes(x) ? " checked" : ""}>${x}</label>`
  ).join("");
  for (const id of ["sb-name", "sb-label", "sb-desc", "sb-instr", "sb-time"]) $(`#${id}`).value = "";
  $("#sb-modal").hidden = false;
  $("#sb-name").focus();
});
$("#sb-create").addEventListener("click", async () => {
  const checked = (sel) => [...document.querySelectorAll(`${sel} input:checked`)].map((i) => i.value);
  try {
    const r = await post("/api/skills", {
      name: $("#sb-name").value.trim(),
      label: $("#sb-label").value.trim(),
      domain: $("#sb-domain").value,
      tier: $("#sb-tier").value,
      description: $("#sb-desc").value,
      instructions: $("#sb-instr").value,
      schedule: $("#sb-time").value.trim(),
      days: checked("#sb-days"),
      tools: checked("#sb-tools"),
    });
    $("#sb-modal").hidden = true;
    toast(t("created", { name: r.name }));
    load();
  } catch (e) {
    toast(e.message, true);
  }
});

window.addEventListener("resize", () => state && renderChart(state.activity));
window.addEventListener("hashchange", openFromHash);
I18N.set(document.documentElement.lang || "en");
load();
loadSessions();
