// HTML pages for Telegram image cards: reports (in the spirit of an Obsidian note — banner, page
// icon, title, tag pills, sections) and the bot's app screens (home, skills, inbox, help).
// Every page is a self-contained document: the font is embedded, nothing is loaded from the web.
const fs = require("fs");
const path = require("path");
const { esc, inline, sections, frontmatter, isRtl } = require("./markdown");

let fontCss = null;
function font() {
  if (fontCss === null) {
    try {
      const b64 = fs.readFileSync(path.join(__dirname, "fonts", "Vazirmatn.woff2")).toString("base64");
      fontCss = `@font-face{font-family:Vazirmatn;src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:100 900;}`;
    } catch {
      fontCss = "";
    }
  }
  return fontCss;
}

// Colour themes: [banner from, banner to, accent, tint].
const THEMES = {
  rust: ["#D2663E", "#8E3A1F", "#C2552F", "#F8E8E0"],
  amber: ["#E9A23B", "#B4562A", "#C9702A", "#FBEEDC"],
  teal: ["#2E9C8F", "#1C5E6B", "#1F8577", "#DDF1EE"],
  indigo: ["#5B6BD6", "#2F3A8F", "#4655C2", "#E5E8FA"],
  violet: ["#9B6AD3", "#5A3590", "#7E4FC0", "#EFE6FA"],
  green: ["#5FA05A", "#2F6B3A", "#3F8A45", "#E3F2E1"],
  slate: ["#6B7A8C", "#36404D", "#506072", "#E7ECF1"],
  red: ["#D9534A", "#8F2A24", "#C2413A", "#FBE4E2"],
};
const SKILL_LOOK = {
  "morning-brief": ["☀️", "amber"],
  "inbox-brief": ["📬", "rust"],
  "weekly-review": ["🗓️", "indigo"],
  "deep-research": ["🔬", "indigo"],
  "market-scan": ["📈", "teal"],
  "project-pulse": ["🚀", "green"],
  "vault-cleanup": ["🧹", "violet"],
  "ingest-source": ["📥", "violet"],
};
const DOMAIN_LOOK = { Productivity: ["⚡", "amber"], Trading: ["📈", "teal"], Research: ["🔬", "indigo"], Memory: ["🧠", "violet"], Projects: ["🚀", "green"] };
function look(skill, domain) {
  const [emoji, theme] = SKILL_LOOK[skill] || DOMAIN_LOOK[domain] || ["📄", "rust"];
  return { emoji, theme };
}

const faDigits = (s) => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
function dateLine(ts, fa) {
  const d = ts ? new Date(ts) : new Date();
  try {
    // Built from parts: some ICU builds order the Persian date oddly ("۱۴۰۵ مهر ۱۰, جمعه").
    const opts = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
    const p = {};
    for (const x of new Intl.DateTimeFormat(fa ? "fa-IR-u-ca-persian" : "en-GB", opts).formatToParts(d)) p[x.type] = x.value;
    return fa ? `${p.weekday} ${faDigits(p.day)} ${p.month} ${faDigits(p.year)}` : `${p.weekday} ${p.day} ${p.month} ${p.year}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
const timeOf = (ts, fa) => {
  const d = new Date(ts);
  const s = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return fa ? faDigits(s) : s;
};

const ROBOT = `<svg viewBox="0 0 8 10" shape-rendering="crispEdges"><g fill="#c2552f"><rect x="3" width="2" height="1"/><rect x="1" y="1" width="6" height="3"/><rect x="2" y="4" width="4" height="1"/><rect y="5" width="8" height="1"/><rect y="6" width="1" height="1"/><rect x="7" y="6" width="1" height="1"/></g><g fill="#9a4024"><rect x="2" y="6" width="4" height="2"/><rect x="2" y="8" width="1" height="2"/><rect x="5" y="8" width="1" height="2"/></g><g fill="#161616"><rect x="2" y="2" width="1" height="1"/><rect x="5" y="2" width="1" height="1"/></g><rect x="3" y="3" width="2" height="1" fill="#7d3219"/></svg>`;
const CHEVRON = `<svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function css(theme) {
  const [b1, b2, acc, tint] = THEMES[theme] || THEMES.rust;
  return `${font()}
:root{--paper:#F6F3EE;--card:#fff;--ink:#1F1D1A;--ink2:#46423C;--mute:#8D877E;--line:#E8E2D9;--chip:#F1ECE4;--b1:${b1};--b2:${b2};--acc:${acc};--tint:${tint};}
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{font-family:Vazirmatn,"Segoe UI","Noto Sans Arabic",Tahoma,sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"ss01"}
.page{width:720px;background:var(--paper);color:var(--ink);padding-bottom:24px;overflow:hidden}
.banner{position:relative;height:148px;background:linear-gradient(135deg,var(--b1),var(--b2))}
.banner svg.grid{position:absolute;inset:0;width:100%;height:100%;opacity:.18}
.banner .crumb{position:absolute;top:18px;inset-inline-start:30px;color:#fff;font-size:14px;font-weight:600;opacity:.92;letter-spacing:.2px}
.banner .crumb b{font-weight:800}
.icon{position:absolute;bottom:-36px;inset-inline-start:30px;width:78px;height:78px;border-radius:24px;background:#fff;display:grid;place-items:center;font-size:42px;box-shadow:0 10px 24px -10px rgba(40,20,10,.45),0 0 0 5px var(--paper)}
.head{padding:50px 32px 0}
h1{font-size:31px;font-weight:850;line-height:1.4;margin:0;letter-spacing:-.2px}
.by{color:var(--mute);font-size:15px;margin-top:4px}
.by b{color:var(--acc);font-weight:700}
.meta{margin:16px 32px 4px;border-top:1px solid var(--line);padding-top:12px;display:flex;flex-wrap:wrap;gap:8px 8px;align-items:center}
.meta .k{color:var(--mute);font-size:13px;margin-inline-end:6px}
.pill{background:var(--tint);color:var(--acc);border-radius:999px;padding:2px 12px;font-size:14px;font-weight:650;white-space:nowrap}
.pill.n{background:var(--chip);color:var(--ink2)}
.intro{margin:12px 32px 0;font-size:16.5px;line-height:1.95;color:var(--ink2)}
.sec{margin:16px 22px 0;background:var(--card);border-radius:20px;padding:16px 22px 14px;border:1px solid #EDE7DE;box-shadow:0 8px 22px -16px rgba(60,40,20,.35)}
.sec-h{display:flex;align-items:center;gap:12px;margin-bottom:6px}
.sec-h .e{flex:none;width:42px;height:42px;border-radius:13px;background:var(--tint);display:grid;place-items:center;font-size:22px}
.sec-h h2{flex:1;font-size:20.5px;font-weight:800;margin:0;line-height:1.5}
.chev{width:20px;height:20px;color:var(--acc);flex:none}
.sec p,.intro p{font-size:16.5px;line-height:1.95;color:var(--ink2);margin:6px 0}
.sec h4{font-size:17px;font-weight:800;margin:14px 0 4px;display:flex;gap:8px;align-items:center}
ul,ol{list-style:none;padding:0;margin:4px 0}
li{font-size:16.5px;line-height:1.9;color:var(--ink2)}
ul>li{position:relative;padding-inline-start:22px;margin:9px 0}
ul>li::before{content:"";position:absolute;inset-inline-start:3px;top:.78em;width:8px;height:8px;border-radius:50%;background:var(--acc);opacity:.85}
ul.sub{margin:4px 0}
ul.sub>li::before{background:transparent;border:2px solid var(--acc);width:7px;height:7px}
ol{counter-reset:n}
ol>li{counter-increment:n;position:relative;padding-inline-start:46px;margin:12px 0;min-height:32px}
ol>li::before{content:counter(n,persian);position:absolute;inset-inline-start:0;top:3px;width:32px;height:32px;border-radius:10px;background:var(--acc);color:#fff;font-weight:800;font-size:16px;display:grid;place-items:center}
:lang(en) ol>li::before{content:counter(n)}
li.task{padding-inline-start:32px}
li.task::before{display:none}
li.task i{position:absolute;inset-inline-start:0;top:.45em;width:20px;height:20px;border-radius:6px;border:2px solid var(--acc)}
li.task.done i{background:var(--acc)}
li.task.done i::after{content:"✓";color:#fff;font-size:14px;font-style:normal;position:absolute;inset:0;display:grid;place-items:center;line-height:1}
li.task.done span{color:var(--mute);text-decoration:line-through}
.src{display:inline-block;background:var(--chip);color:var(--ink);font-weight:750;font-size:13.5px;border-radius:8px;padding:0 9px;margin-inline-end:8px;line-height:1.75}
strong{color:var(--ink);font-weight:800}
a,.wl{color:var(--acc);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
mark{background:#FDF0B8;padding:0 3px;border-radius:4px}
.tag{color:var(--acc);background:var(--tint);border-radius:6px;padding:0 6px;font-size:.88em}
code{font-family:Consolas,"Cascadia Mono",monospace;font-size:.86em;background:var(--chip);border-radius:6px;padding:1px 6px;direction:ltr;unicode-bidi:embed}
pre{background:#1F1D1A;color:#EDE8DF;border-radius:14px;padding:14px 16px;font-size:14px;line-height:1.6;white-space:pre-wrap;text-align:left}
pre code{background:none;padding:0;color:inherit}
hr{border:0;border-top:1px dashed var(--line);margin:14px 0}
blockquote{margin:10px 0;padding:4px 16px;border-inline-start:4px solid var(--acc);background:var(--tint);border-radius:10px}
.callout{margin:10px 0;padding:10px 16px;border-radius:14px;background:var(--tint);border-inline-start:4px solid var(--acc)}
.callout .ct{font-weight:800;display:flex;gap:8px;align-items:center;color:var(--acc);font-size:16px}
.c-warning,.c-danger,.c-bug{--tint:#FCEBDD;--acc:#C25E1F}
.c-success{--tint:#E3F2E1;--acc:#3F8A45}
.c-info,.c-note{--tint:#E5ECFA;--acc:#3F63C2}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:15.5px}
th{text-align:start;font-weight:800;padding:8px 6px;border-bottom:2.5px solid var(--ink)}
td{padding:8px 6px;border-bottom:1px solid var(--line);color:var(--ink2);vertical-align:top}
.foot{margin:22px 32px 0;padding-top:12px;border-top:1px solid var(--line);display:flex;align-items:center;gap:10px;color:var(--mute);font-size:13px}
.foot svg{width:15px;height:19px}
.foot .sp{flex:1}
/* app screens */
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 22px 0}
.tile{background:var(--card);border:1px solid #EDE7DE;border-radius:20px;padding:16px 18px;box-shadow:0 8px 22px -16px rgba(60,40,20,.35);display:flex;align-items:center;gap:14px}
.tile .lab{color:var(--mute);font-size:13.5px}
.tile .val{font-size:26px;font-weight:850;line-height:1.3}
.tile .sub{color:var(--mute);font-size:13px}
.ring{flex:none;width:86px;height:86px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:14px 22px 0}
.stat{background:var(--card);border:1px solid #EDE7DE;border-radius:18px;padding:12px 16px;text-align:center}
.stat .val{font-size:24px;font-weight:850}
.stat .lab{color:var(--mute);font-size:13px}
.row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.row .e{flex:none;width:38px;height:38px;border-radius:12px;background:var(--tint);display:grid;place-items:center;font-size:19px}
.row .t{flex:1;font-size:16px;font-weight:700;line-height:1.5}
.row .t small{display:block;color:var(--mute);font-weight:500;font-size:13px}
.chip{border-radius:999px;padding:2px 11px;font-size:13px;font-weight:700;white-space:nowrap;background:var(--chip);color:var(--ink2)}
.chip.ok{background:#E3F2E1;color:#2F7A36}.chip.bad{background:#FBE4E2;color:#B3362E}.chip.run{background:#E5E8FA;color:#3B49B5}.chip.warn{background:#FCEBDD;color:#B4561C}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 22px 0}
.sk{background:var(--card);border:1px solid #EDE7DE;border-radius:18px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.sk .e{flex:none;width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:23px}
.sk .t{font-size:16px;font-weight:800;line-height:1.5}
.sk .d{color:var(--mute);font-size:12.5px;line-height:1.7;margin-top:2px}
.empty{color:var(--mute);text-align:center;padding:18px 0;font-size:16px}
.big{font-size:16.5px;line-height:2;color:var(--ink2)}
.kbd{display:inline-block;font-family:Consolas,monospace;direction:ltr;background:var(--chip);border-radius:8px;padding:0 8px;color:var(--ink);font-weight:700;font-size:14.5px}
`;
}

// Faint card-catalogue grid on the banner.
const GRID = `<svg class="grid" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="g" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#fff" stroke-width="1"/></pattern><pattern id="d" width="180" height="180" patternUnits="userSpaceOnUse"><circle cx="150" cy="30" r="70" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="150" cy="30" r="40" fill="none" stroke="#fff" stroke-width="1.5"/></pattern></defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#d)"/></svg>`;

function doc({ theme, fa, body }) {
  const dir = fa ? "rtl" : "ltr";
  return `<!doctype html><html lang="${fa ? "fa" : "en"}" dir="${dir}"><head><meta charset="utf-8"><style>${css(theme)}</style></head><body><div class="page">${body}</div></body></html>`;
}

function banner({ emoji, crumb }) {
  return `<div class="banner">${GRID}<div class="crumb">${crumb}</div><div class="icon">${emoji}</div></div>`;
}

function footer(fa, extra) {
  return `<div class="foot">${ROBOT}<span>Agentic OS</span><span class="sp"></span><span>${extra || ""}</span></div>`;
}

// A finished report: { skill, label, markdown, model, cost, at, domain, source, fa }.
function reportPage(o) {
  const { meta, body } = frontmatter(o.markdown);
  const parsed = sections(body);
  const fa = o.fa != null ? o.fa : isRtl(body);
  const { emoji, theme } = look(o.skill, o.domain);
  const title = parsed.title || o.label || o.skill || "Report";
  const when = o.at || (meta.date ? Date.parse(meta.date + "T12:00:00") : Date.now());
  const tags = []
    .concat(meta.tags || [])
    .concat(o.skill ? [o.skill] : [])
    .filter((t, i, a) => t && a.indexOf(t) === i)
    .map((t) => `<span class="pill">#${esc(t)}</span>`);
  const info = [
    o.model ? `<span class="pill n">${esc(o.model)}</span>` : "",
    o.cost != null ? `<span class="pill n">$${Number(o.cost).toFixed(2)}</span>` : "",
    o.source === "cloud" || meta.source === "cloud-routine" ? `<span class="pill n">☁️ ${fa ? "ابری" : "cloud"}</span>` : "",
  ].join("");
  const secs = parsed.sections
    .map(
      (s) =>
        `<section class="sec"><div class="sec-h"><span class="e">${s.emoji || "•"}</span><h2>${inline(s.title)}</h2>${CHEVRON}</div>${s.html}</section>`
    )
    .join("");
  const intro = parsed.intro ? (parsed.sections.length ? `<div class="intro">${parsed.intro}</div>` : `<section class="sec">${parsed.intro}</section>`) : "";
  const crumb = `${fa ? "گزارش‌ها" : "Reports"} / <b>${esc(o.label || o.skill || "")}</b>`;
  return doc({
    theme,
    fa,
    body: `${banner({ emoji, crumb })}<div class="head"><h1>${inline(title)}</h1><div class="by">${fa ? "از" : "by"} <b>Agentic OS</b> · ${esc(
      dateLine(when, fa)
    )}</div></div><div class="meta"><span class="k">${fa ? "برچسب‌ها" : "Tags"}</span>${tags.join("")}${info}</div>${intro}${secs}${footer(
      fa,
      o.at ? timeOf(o.at, fa) : ""
    )}`,
  });
}

// Short notices (quota alerts, failures, quality checks): { emoji, title, lines[], tone, fa }.
function noticePage(o) {
  const fa = o.fa != null ? o.fa : isRtl(o.title + (o.lines || []).join(""));
  const theme = o.tone === "bad" ? "red" : o.tone === "warn" ? "amber" : o.tone === "ok" ? "green" : "slate";
  const items = (o.lines || []).filter(Boolean);
  return doc({
    theme,
    fa,
    body: `${banner({ emoji: o.emoji || "🔔", crumb: `${fa ? "اعلان" : "Notice"} / <b>${esc(o.crumb || "")}</b>` })}<div class="head"><h1>${inline(
      o.title
    )}</h1><div class="by">${esc(dateLine(Date.now(), fa))} · ${timeOf(Date.now(), fa)}</div></div>${
      items.length ? `<section class="sec"><ul>${items.map((l) => `<li><span>${inline(l)}</span></li>`).join("")}</ul></section>` : ""
    }${footer(fa)}`,
  });
}

// ---------- app screens ----------
function ring(pct, color, fa) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const r = 36;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 86 86"><circle cx="43" cy="43" r="${r}" fill="none" stroke="#EEE8DF" stroke-width="9"/><circle cx="43" cy="43" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(
    (c * p) /
    100
  ).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 43 43)"/><text x="43" y="49" text-anchor="middle" font-size="19" font-weight="800" fill="#1F1D1A" font-family="Vazirmatn">${
    pct == null ? "—" : fa ? faDigits(Math.round(p)) + "٪" : Math.round(p) + "%"
  }</text></svg>`;
}
const levelColor = (p) => (p == null ? "#B9B2A7" : p >= 90 ? "#D9534A" : p >= 70 ? "#E08A2E" : "#3F8A45");
function span(ms, fa) {
  if (ms == null || ms < 0) return "—";
  const h = Math.floor(ms / 3600e3);
  const m = Math.round((ms % 3600e3) / 60e3);
  const d = Math.floor(h / 24);
  const s = d >= 1 ? (fa ? `${d} روز و ${h % 24} ساعت` : `${d}d ${h % 24}h`) : h ? (fa ? `${h} ساعت و ${m} دقیقه` : `${h}h ${m}m`) : fa ? `${m} دقیقه` : `${m}m`;
  return fa ? faDigits(s) : s;
}
const STATUS = {
  COMPLETE: ["ok", "✓ موفق", "✓ done"],
  FAILED: ["bad", "✕ خطا", "✕ failed"],
  RUNNING: ["run", "● در حال اجرا", "● running"],
  SKIPPED: ["warn", "رد شد", "skipped"],
};
const statusChip = (st, fa) => {
  const s = STATUS[st] || ["", st || "—", st || "—"];
  return `<span class="chip ${s[0]}">${fa ? s[1] : s[2]}</span>`;
};

// Home: plan usage, today's runs, last and next runs. `s` is server.state(), `label(name, fallback)`.
function homePage(s, label, fa) {
  const n = (x) => (fa ? faDigits(x) : String(x));
  const T = (f, e) => (fa ? f : e);
  const usageTile = (w, name) =>
    `<div class="tile">${ring(w && w.pct, levelColor(w && w.pct), fa)}<div><div class="lab">${name}</div><div class="val">${
      w && w.pct != null ? n(Math.round(w.pct)) + (fa ? "٪" : "%") : "—"
    }</div><div class="sub">${T("ریست تا", "resets in")} ${span(w && w.resetsIn, fa)}</div></div></div>`;
  const running = s.skills.filter((k) => k.running);
  const last = s.lastRun;
  const next = (s.upcoming || []).slice(0, 3);
  const row = (emoji, title, sub, chip) =>
    `<div class="row"><span class="e">${emoji}</span><div class="t">${title}${sub ? `<small>${sub}</small>` : ""}</div>${chip || ""}</div>`;
  const lookOf = (name) => look(name, (s.skills.find((k) => k.name === name) || {}).domain).emoji;
  const runRows = [
    ...running.map((k) => row(lookOf(k.name), esc(label(k.name, k.label)), T("همین الان", "right now"), statusChip("RUNNING", fa))),
    last && !running.some((k) => k.name === last.skill)
      ? row(
          lookOf(last.skill),
          esc(label(last.skill, last.label)),
          `${T("آخرین اجرا", "Last run")} · ${timeOf(Date.parse(last.startedAt), fa)}${last.cost != null ? ` · $${last.cost.toFixed(2)}` : ""}`,
          statusChip(last.status, fa)
        )
      : "",
  ].join("");
  const nextRows = next
    .map((u) => row(lookOf(u.skill), esc(label(u.skill, u.label)), u.cloud ? T("ابری", "cloud") : u.deferred ? T("بعد از ریست سهمیه", "after quota reset") : "", `<span class="chip">${timeOf(u.at, fa)}</span>`))
    .join("");
  return doc({
    theme: "rust",
    fa,
    body: `${banner({ emoji: `<span style="width:44px;height:55px;display:block">${ROBOT}</span>`, crumb: `Agentic OS / <b>${T("خانه", "Home")}</b>` })}
<div class="head"><h1>${T("سلام 👋", "Hello 👋")}</h1><div class="by">${esc(dateLine(Date.now(), fa))} · ${timeOf(Date.now(), fa)} · <b>${esc(
      s.meta.plan || ""
    )}</b></div></div>
<div class="tiles">${usageTile(s.fiveHour, T("مصرف ۵ ساعته", "5-hour usage"))}${usageTile(s.weekly, T("مصرف هفتگی", "Weekly usage"))}</div>
<div class="stats"><div class="stat"><div class="val">${n(s.routines.runsToday)}${s.routines.limit ? `<span style="font-size:15px;color:var(--mute)">/${n(
      s.routines.limit
    )}</span>` : ""}</div><div class="lab">${T("اجرای امروز", "runs today")}</div></div><div class="stat"><div class="val">$${(s.routines.costToday || 0).toFixed(
      2
    )}</div><div class="lab">${T("هزینهٔ امروز", "cost today")}</div></div><div class="stat"><div class="val">${n(s.inbox.count)}</div><div class="lab">${T(
      "صندوق تازه",
      "new in inbox"
    )}</div></div></div>
${runRows ? `<section class="sec"><div class="sec-h"><span class="e">⚙️</span><h2>${T("اجراها", "Runs")}</h2></div>${runRows}</section>` : ""}
<section class="sec"><div class="sec-h"><span class="e">⏰</span><h2>${T("بعدی", "Up next")}</h2></div>${nextRows || `<div class="empty">${T("تا ۲۴ ساعت آینده چیزی زمان‌بندی نشده.", "Nothing scheduled in the next 24 hours.")}</div>`}</section>
${s.quota && s.quota.blocked ? `<section class="sec"><div class="callout c-warning"><div class="ct"><span>⛔</span>${T("محافظ سهمیه فعال است", "Quota guard is on")}</div><p>${esc(s.quota.reason || "")}</p></div></section>` : ""}
${footer(fa, T("برای به‌روزرسانی دکمهٔ 🔄 را بزن", "tap 🔄 to refresh"))}`,
  });
}

function skillsPage(s, label, fa) {
  const T = (f, e) => (fa ? f : e);
  const cards = s.skills
    .map((k) => {
      const { emoji, theme } = look(k.name, k.domain);
      const when = k.schedule ? `⏰ ${fa ? faDigits(k.schedule) : k.schedule}` : T("دستی", "manual");
      return `<div class="sk"><span class="e" style="background:${THEMES[theme][3]}">${emoji}</span><div><div class="t">${esc(label(k.name, k.label))}${
        k.running ? ` <span class="chip run">●</span>` : ""
      }</div><div class="d">${esc(k.domain || "")} · ${when} · ${esc(k.tier || "")}</div></div></div>`;
    })
    .join("");
  return doc({
    theme: "violet",
    fa,
    body: `${banner({ emoji: "🧠", crumb: `Agentic OS / <b>${T("مهارت‌ها", "Skills")}</b>` })}<div class="head"><h1>${T("مهارت‌ها", "Skills")}</h1><div class="by">${T(
      `${faDigits(s.skills.length)} مهارت · برای اجرا یکی را از دکمه‌های پایین انتخاب کن`,
      `${s.skills.length} skills · pick one below to run it`
    )}</div></div><div class="grid2">${cards}</div>${footer(fa)}`,
  });
}

function skillPage(k, label, fa, recent) {
  const T = (f, e) => (fa ? f : e);
  const { emoji, theme } = look(k.name, k.domain);
  const rows = (recent || [])
    .slice(0, 4)
    .map(
      (r) =>
        `<div class="row"><div class="t">${esc(dateLine(Date.parse(r.startedAt), fa))}<small>${timeOf(Date.parse(r.startedAt), fa)}${
          r.cost != null ? ` · $${r.cost.toFixed(2)}` : ""
        }${r.model ? ` · ${esc(r.model)}` : ""}</small></div>${statusChip(r.status, fa)}</div>`
    )
    .join("");
  return doc({
    theme,
    fa,
    body: `${banner({ emoji, crumb: `${T("مهارت‌ها", "Skills")} / <b>${esc(k.name)}</b>` })}<div class="head"><h1>${esc(label(k.name, k.label))}</h1><div class="by"><b>${esc(
      k.model || ""
    )}</b> · ${esc(k.domain || "")} · ${k.schedule ? `⏰ ${fa ? faDigits(k.schedule) : k.schedule}` : T("اجرای دستی", "manual")}</div></div>
<section class="sec"><div class="sec-h"><span class="e">📋</span><h2>${T("توضیح", "About")}</h2></div><p>${esc(k.description || "—")}</p></section>
<section class="sec"><div class="sec-h"><span class="e">🕘</span><h2>${T("اجراهای اخیر", "Recent runs")}</h2></div>${rows || `<div class="empty">${T("هنوز اجرا نشده.", "No runs yet.")}</div>`}</section>
${footer(fa, k.running ? T("در حال اجرا…", "running…") : T("برای اجرا ▶️ را بزن", "tap ▶️ to run"))}`,
  });
}

function inboxPage(s, label, fa) {
  const T = (f, e) => (fa ? f : e);
  const items = (s.inbox.items || []).slice(0, 10);
  const rows = items
    .map((i) => {
      const run = i.kind === "run";
      const emoji = run ? look(i.skill).emoji : "📄";
      const t = i.at || i.mtime || i.startedAt;
      return `<div class="row"><span class="e">${emoji}</span><div class="t">${esc(run ? label(i.skill, i.title) : i.title)}${
        t ? `<small>${esc(dateLine(typeof t === "number" ? t : Date.parse(t), fa))}</small>` : ""
      }</div></div>`;
    })
    .join("");
  return doc({
    theme: "rust",
    fa,
    body: `${banner({ emoji: "📬", crumb: `Agentic OS / <b>${T("صندوق", "Inbox")}</b>` })}<div class="head"><h1>${T("صندوق خروجی‌ها", "Output inbox")}</h1><div class="by">${T(
      `${faDigits(s.inbox.count)} مورد تازه`,
      `${s.inbox.count} new`
    )}</div></div><section class="sec">${rows || `<div class="empty">${T("چیز تازه‌ای نیست ✨", "Nothing new ✨")}</div>`}</section>${footer(fa)}`,
  });
}

function helpPage(fa) {
  const T = (f, e) => (fa ? f : e);
  const cmds = [
    ["/start", T("صفحهٔ خانه با دکمه‌ها", "home screen with buttons")],
    ["/status", T("مصرف، آخرین اجرا و بعدی", "usage, last and next run")],
    ["/skills", T("فهرست مهارت‌ها و اجرا", "skills and run buttons")],
    ["/run <skill>", T("اجرای مستقیم یک مهارت (force برای رد شدن از محافظ)", "run a skill (add force to bypass the guard)")],
    ["/note <text>", T("یادداشت در یادداشت روزانه", "add to today's daily note")],
    ["/inbox", T("خروجی‌های تازه", "new outputs")],
  ];
  return doc({
    theme: "slate",
    fa,
    body: `${banner({ emoji: "❓", crumb: `Agentic OS / <b>${T("راهنما", "Help")}</b>` })}<div class="head"><h1>${T("راهنما", "Help")}</h1><div class="by">${T(
      "بیشتر کارها با دکمه‌ها انجام می‌شود؛ این دستورها هم کار می‌کنند.",
      "Most things work with the buttons; these commands work too."
    )}</div></div><section class="sec">${cmds
      .map(([c, d]) => `<div class="row"><div class="t"><span class="kbd">${esc(c)}</span><small>${esc(d)}</small></div></div>`)
      .join("")}</section>${footer(fa)}`,
  });
}

module.exports = { reportPage, noticePage, homePage, skillsPage, skillPage, inboxPage, helpPage, look, faDigits, dateLine };
