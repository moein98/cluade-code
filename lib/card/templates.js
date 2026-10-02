// HTML pages for Telegram image cards, drawn as mind maps in the visual language of
// groepl/Obsidian-Templates: white page, title with a "type | source | date" line, a black root
// box, grey tree branches, white section boxes with black number circles, yellow key pills, a
// legend and a book-like badge. The tree runs top-down so it stays readable on a phone.
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

// The branch colour is exact (#9E9E9E): shot.js treats rows that hold only white and this grey
// as safe places to cut a long map into pages.
const BRANCH = "#9E9E9E";

const SKILL_EMOJI = {
  "morning-brief": "☀️",
  "inbox-brief": "📬",
  "weekly-review": "🗓️",
  "deep-research": "🔬",
  "market-scan": "📈",
  "project-pulse": "🚀",
  "vault-cleanup": "🧹",
  "ingest-source": "📥",
};
const DOMAIN_EMOJI = { Productivity: "⚡", Trading: "📈", Research: "🔬", Memory: "🧠", Projects: "🚀" };
const look = (skill, domain) => ({ emoji: SKILL_EMOJI[skill] || DOMAIN_EMOJI[domain] || "📄" });

const faDigits = (s) => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
function dateLine(ts, fa, short) {
  const d = ts ? new Date(ts) : new Date();
  try {
    // Built from parts: some ICU builds order the Persian date oddly ("۱۴۰۵ مهر ۱۰, جمعه").
    const opts = short ? { day: "numeric", month: "long", year: "numeric" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" };
    const p = {};
    for (const x of new Intl.DateTimeFormat(fa ? "fa-IR-u-ca-persian" : "en-GB", opts).formatToParts(d)) p[x.type] = x.value;
    const day = fa ? `${faDigits(p.day)} ${p.month} ${faDigits(p.year)}` : `${p.day} ${p.month} ${p.year}`;
    return p.weekday ? `${p.weekday} ${day}` : day;
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
const EXT = `<svg class="ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CSS = () => `${font()}
:root{--ink:#1A1A1A;--ink2:#3D3D3D;--mute:#7A7A7A;--line:#CFCFCF;--y:#F9BE2A;--y2:#FFF3CF;--red:#E5533D;--br:${BRANCH}}
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{font-family:Vazirmatn,"Segoe UI","Noto Sans Arabic",Tahoma,sans-serif;-webkit-font-smoothing:antialiased}
.page{width:720px;background:#fff;color:var(--ink);padding:30px 0 24px;overflow:hidden}
.hd{padding:0 30px}
h1{font-size:30px;font-weight:850;line-height:1.4;margin:0;letter-spacing:-.2px}
.sub{color:var(--mute);font-size:15px;margin-top:2px}
.lead{margin:16px 30px 0;font-size:15.5px;line-height:1.95;color:var(--ink2);border:2px solid #E4E4E4;border-radius:10px;padding:10px 16px;background:#FCFCFC}
.lead p{margin:0}
.rootw{margin:22px 22px 0;display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
.root{background:var(--ink);color:#fff;border-radius:8px;padding:9px 20px;font-size:21px;font-weight:800;display:inline-flex;gap:10px;align-items:center;line-height:1.5}
.ext{width:18px;height:18px;flex:none}
.rsub{color:var(--mute);font-size:14px;padding-bottom:6px;border-bottom:1.5px solid #BDBDBD;line-height:1.6}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin:10px 22px 0}
.tg{border:1.5px solid #BDBDBD;border-radius:8px;padding:0 10px;font-size:13.5px;color:var(--ink2);line-height:1.9}
/* tree */
ul.tree{list-style:none;margin:0;padding:0}
ul.tree>li{position:relative;padding-inline-start:30px;padding-top:var(--pt)}
ul.tree>li::before{content:"";position:absolute;inset-inline-start:0;top:0;bottom:0;border-inline-start:2px solid var(--br)}
ul.tree>li:last-child::before{bottom:auto;height:var(--elbow)}
ul.tree>li::after{content:"";position:absolute;inset-inline-start:0;top:var(--elbow);width:22px;border-top:2px solid var(--br)}
ul.tree.top{--pt:18px;--elbow:40px;margin-inline-start:46px;margin-inline-end:24px}
.kids{margin-inline-start:20px}
.kids>ul.tree{--pt:8px;--elbow:24px}
.kids ul.tree ul.tree{--pt:4px;--elbow:20px}
.node{display:inline-flex;align-items:center;gap:10px;background:#fff;border:2px solid var(--line);border-radius:10px;padding:6px 10px 6px 16px;max-width:100%}
.num{flex:none;width:28px;height:28px;border-radius:50%;background:var(--ink);color:#fff;font-weight:800;font-size:14px;display:grid;place-items:center}
.nt{font-size:19px;font-weight:800;line-height:1.5}
.ne{font-size:19px}
.leaf{font-size:16px;line-height:1.85;color:var(--ink2)}
.leaf p{margin:0}
.src{display:inline-block;background:var(--y);color:var(--ink);font-weight:700;font-size:14px;border-radius:6px;padding:0 10px;margin-inline-end:8px;line-height:1.9}
.nb{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--y);color:var(--ink);font-weight:800;font-size:13px;margin-inline-end:8px;vertical-align:1px}
.cb{display:inline-block;width:18px;height:18px;border:2px solid #9A9A9A;border-radius:4px;vertical-align:-3px;margin-inline-end:8px;position:relative}
.cb.on{background:#9A9A9A}
.cb.on::after{content:"✓";color:#fff;font-size:13px;position:absolute;inset:0;display:grid;place-items:center;line-height:1}
.done{color:var(--mute)}
strong{color:var(--ink);font-weight:800}
a,.wl{color:var(--ink);text-decoration:underline;text-decoration-color:var(--y);text-decoration-thickness:3px;text-underline-offset:3px}
mark{background:var(--y2);padding:0 3px;border-radius:4px}
.tag{border:1.5px solid #BDBDBD;border-radius:6px;padding:0 6px;font-size:.88em}
code{font-family:Consolas,"Cascadia Mono",monospace;font-size:.86em;background:#F2F2F2;border-radius:5px;padding:1px 6px;direction:ltr;unicode-bidi:embed}
pre{background:#1A1A1A;color:#EEE;border-radius:8px;padding:12px 14px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;text-align:left;margin:4px 0}
pre code{background:none;padding:0;color:inherit}
hr{border:0;border-top:2px dotted #CFCFCF;margin:8px 0}
h4{font-size:16.5px;font-weight:800;margin:0;color:var(--ink)}
blockquote{margin:0;padding:2px 14px;border-inline-start:4px solid var(--y);color:var(--ink2)}
.callout{background:var(--y);border-radius:6px;padding:8px 16px;color:var(--ink);font-weight:600}
.callout .ct{font-size:13px;font-weight:700;opacity:.75;display:flex;gap:6px}
.callout p{margin:2px 0;font-size:17px;font-weight:800;line-height:1.7}
.c-danger,.c-bug{background:var(--red);color:#fff}
table{width:100%;border-collapse:collapse;font-size:15px;margin:2px 0}
th{text-align:start;font-weight:800;padding:6px 6px;border-bottom:2.5px solid var(--ink)}
td{padding:6px 6px;border-bottom:1px solid #E2E2E2;color:var(--ink2);vertical-align:top}
.empty{color:var(--mute)}
.muted{color:var(--mute);font-size:14px}
.chip{display:inline-block;border-radius:6px;padding:0 9px;font-size:13.5px;font-weight:700;line-height:1.9;margin-inline-start:8px;border:1.5px solid #BDBDBD;color:var(--ink2)}
.chip.ok{background:var(--y);border-color:var(--y);color:var(--ink)}.chip.bad{background:var(--red);border-color:var(--red);color:#fff}.chip.run{background:var(--ink);border-color:var(--ink);color:#fff}
.kbd{display:inline-block;font-family:Consolas,monospace;direction:ltr;background:var(--y);border-radius:6px;padding:0 9px;color:var(--ink);font-weight:700;font-size:14.5px;margin-inline-end:8px}
.gauges{display:flex;gap:12px}
.gauge{flex:1;display:flex;align-items:center;gap:12px;border:2px solid #E4E4E4;border-radius:10px;padding:8px 12px}
.gauge .v{font-size:24px;font-weight:850;line-height:1.3;color:var(--ink)}
.gauge .l{font-size:13.5px;color:var(--mute)}
.ring{flex:none;width:70px;height:70px}
/* legend and badge */
.ft{display:flex;align-items:flex-end;justify-content:space-between;margin:30px 30px 0;gap:20px}
.lg b{display:block;font-size:16px;margin-bottom:4px}
.lg ul.tree{--pt:6px;--elbow:20px;margin-inline-start:8px}
.lg ul.tree>li{padding-inline-start:26px;font-size:13px;color:var(--ink2);line-height:1.6}
.lg .node{padding:1px 10px;border-radius:7px}
.lg .src{font-size:12.5px;padding:0 8px}
.bd{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:150px}
.book{width:56px;height:72px;background:#fff;border:1.5px solid #E2E2E2;border-inline-start:8px solid var(--y);border-radius:3px;display:grid;place-items:center;box-shadow:0 3px 8px -4px rgba(0,0,0,.25)}
.book svg{width:24px;height:30px}
.bd .n{font-weight:800;font-size:15px;display:flex;gap:6px;align-items:center}
.bd .n .ext{width:15px;height:15px}
.bd .u{font-size:12px;color:var(--mute);border-top:1.5px solid #9E9E9E;padding-top:2px}
`;

function doc(fa, body) {
  return `<!doctype html><html lang="${fa ? "fa" : "en"}" dir="${fa ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>${CSS()}</style></head><body><div class="page">${body}</div></body></html>`;
}

const header = (title, subParts) => `<div class="hd"><h1>${title}</h1><div class="sub">${subParts.filter(Boolean).join(" | ")}</div></div>`;
const rootBox = (label, sub) => `<div class="rootw"><div class="root">${label}${EXT}</div>${sub ? `<div class="rsub">${sub}</div>` : ""}</div>`;
const node = (n, title, emoji, fa) =>
  `<div class="node">${n != null ? `<span class="num">${fa ? faDigits(n) : n}</span>` : ""}<span class="nt">${title}</span>${emoji ? `<span class="ne">${emoji}</span>` : ""}</div>`;

// leaves: [{ html, sub[] }] → a branch list
function leaves(list) {
  return `<ul class="tree">${list
    .map((l) => `<li><div class="leaf">${l.html}</div>${l.sub && l.sub.length ? leaves(l.sub.map((s) => (typeof s === "string" ? { html: s } : s))) : ""}</li>`)
    .join("")}</ul>`;
}
// nodes: [{ title, emoji, leaves[], num }] → the main tree under the root box, numbered 1..n
function tree(nodes, fa) {
  return `<ul class="tree top">${nodes
    .map((n, i) => `<li>${node(n.num === false ? null : i + 1, n.title, n.emoji, fa)}${n.leaves && n.leaves.length ? `<div class="kids">${leaves(n.leaves)}</div>` : ""}</li>`)
    .join("")}</ul>`;
}

function footer(fa, note) {
  const T = (f, e) => (fa ? f : e);
  return `<div class="ft"><div class="lg"><b>${T("راهنما", "Legend")}</b><ul class="tree"><li><div class="node"><span class="nt" style="font-size:13px">${T(
    "بخش",
    "Section"
  )}</span></div></li><li><span class="src">${T("نکتهٔ کلیدی", "Key point")}</span></li><li>${T("جزئیات", "Details")}</li></ul></div><div class="bd"><div class="book">${ROBOT}</div><div class="n">Agentic OS${EXT}</div><div class="u">${
    note || ""
  }</div></div></div>`;
}

// A finished report: { skill, label, markdown, model, cost, at, domain, source, fa }.
function reportPage(o) {
  const { meta, body } = frontmatter(o.markdown);
  const fa = o.fa != null ? o.fa : isRtl(body);
  const T = (f, e) => (fa ? f : e);
  const parsed = sections(body, { leaves: true, digits: fa ? faDigits : String });
  const { emoji } = look(o.skill, o.domain);
  const label = o.label || o.skill || T("گزارش", "Report");
  const title = parsed.title || label;
  const when = o.at || (meta.date ? Date.parse(meta.date + "T12:00:00") : Date.now());
  const cloud = o.source === "cloud" || meta.source === "cloud-routine";
  const info = [o.model, o.cost != null ? `$${Number(o.cost).toFixed(2)}` : "", cloud ? `☁️ ${T("ابری", "cloud")}` : ""].filter(Boolean).join(" · ");
  const tags = []
    .concat(meta.tags || [])
    .concat(o.skill ? [o.skill] : [])
    .filter((t, i, a) => t && a.indexOf(t) === i)
    .map((t) => `<span class="tg">#${esc(t)}</span>`)
    .join("");
  const intro = parsed.intro.map((l) => l.html).join("");
  const nodes = parsed.sections.map((s) => ({ title: inline(s.title), emoji: s.emoji, leaves: s.html }));
  const main = nodes.length ? tree(nodes, fa) : parsed.intro.length ? tree([{ title: T("متن", "Content"), emoji: "📝", leaves: parsed.intro }], fa) : "";
  return doc(
    fa,
    `${header(inline(title), [T("نقشهٔ گزارش", "Report map"), esc(label), esc(dateLine(when, fa, true))])}${
      nodes.length && intro ? `<div class="lead">${intro}</div>` : ""
    }${rootBox(`${emoji} ${esc(label)}`, esc(info))}${tags ? `<div class="tags">${tags}</div>` : ""}${main}${footer(
      fa,
      o.at ? `${dateLine(o.at, fa, true)} · ${timeOf(o.at, fa)}` : dateLine(when, fa, true)
    )}`
  );
}

// Short notices (quota alerts, failures, quality checks): { emoji, title, lines[], tone, crumb, fa }.
function noticePage(o) {
  const fa = o.fa != null ? o.fa : isRtl(o.title + (o.lines || []).join(""));
  const T = (f, e) => (fa ? f : e);
  const lines = (o.lines || []).filter(Boolean);
  const pill = o.tone === "bad" ? ' style="background:var(--red);color:#fff"' : "";
  return doc(
    fa,
    `${header(inline(o.title), [T("اعلان", "Notice"), esc(o.crumb || ""), `${esc(dateLine(Date.now(), fa, true))} · ${timeOf(Date.now(), fa)}`])}${rootBox(
      `${o.emoji || "🔔"} ${esc(o.crumb || T("اعلان", "Notice"))}`
    )}${
      lines.length
        ? tree([{ title: T("جزئیات", "Details"), leaves: lines.map((l, i) => ({ html: i === 0 ? `<span class="src"${pill}>${inline(l)}</span>` : inline(l) })) }], fa)
        : ""
    }${footer(fa)}`
  );
}

// ---------- app screens ----------
function ring(pct, color, fa) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const r = 29;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 70 70"><circle cx="35" cy="35" r="${r}" fill="none" stroke="#EEEEEE" stroke-width="8"/><circle cx="35" cy="35" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-dasharray="${(
    (c * p) /
    100
  ).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 35 35)"/><text x="35" y="41" text-anchor="middle" font-size="16" font-weight="800" fill="#1A1A1A" font-family="Vazirmatn">${
    pct == null ? "—" : fa ? faDigits(Math.round(p)) + "٪" : Math.round(p) + "%"
  }</text></svg>`;
}
const levelColor = (p) => (p == null ? "#CFCFCF" : p >= 90 ? "#E5533D" : p >= 70 ? "#F59E2A" : "#F9BE2A");
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
  SKIPPED: ["", "رد شد", "skipped"],
};
const statusChip = (st, fa) => {
  const s = STATUS[st] || ["", st || "—", st || "—"];
  return `<span class="chip ${s[0]}">${fa ? s[1] : s[2]}</span>`;
};
const screenHeader = (title, where, fa) => header(title, ["Agentic OS", where, `${esc(dateLine(Date.now(), fa, true))} · ${timeOf(Date.now(), fa)}`]);

// Home: plan usage, today, runs, up next. `s` is server.state(), `label(name, fallback)`.
function homePage(s, label, fa) {
  const T = (f, e) => (fa ? f : e);
  const n = (x) => (fa ? faDigits(x) : String(x));
  const em = (name) => look(name, (s.skills.find((k) => k.name === name) || {}).domain).emoji;
  const gauge = (w, name) =>
    `<div class="gauge">${ring(w && w.pct, levelColor(w && w.pct), fa)}<div><div class="l">${name}</div><div class="v">${
      w && w.pct != null ? n(Math.round(w.pct)) + (fa ? "٪" : "%") : "—"
    }</div><div class="l">${T("ریست تا", "resets in")} ${span(w && w.resetsIn, fa)}</div></div></div>`;
  const running = s.skills.filter((k) => k.running);
  const last = s.lastRun;
  const runs = [
    ...running.map((k) => ({ html: `<span class="src">${em(k.name)} ${esc(label(k.name, k.label))}</span>${statusChip("RUNNING", fa)}` })),
    ...(last && !running.some((k) => k.name === last.skill)
      ? [
          {
            html: `<span class="src">${em(last.skill)} ${esc(label(last.skill, last.label))}</span>${statusChip(last.status, fa)}`,
            sub: [`<span class="muted">${T("آخرین اجرا", "Last run")} · ${timeOf(Date.parse(last.startedAt), fa)}${last.cost != null ? ` · $${last.cost.toFixed(2)}` : ""}</span>`],
          },
        ]
      : []),
  ];
  const next = (s.upcoming || []).slice(0, 3).map((u) => ({
    html: `<span class="src" dir="ltr">${timeOf(u.at, fa)}</span>${em(u.skill)} ${esc(label(u.skill, u.label))}${u.cloud ? ` <span class="muted">· ${T("ابری", "cloud")}</span>` : ""}${
      u.deferred ? ` <span class="muted">· ${T("بعد از ریست سهمیه", "after quota reset")}</span>` : ""
    }`,
  }));
  const nodes = [
    { title: T("مصرف Claude", "Claude usage"), emoji: "📊", leaves: [{ html: `<div class="gauges">${gauge(s.fiveHour, T("۵ ساعته", "5-hour"))}${gauge(s.weekly, T("هفتگی", "Weekly"))}</div>` }] },
    {
      title: T("امروز", "Today"),
      emoji: "📅",
      leaves: [
        { html: `<span class="src">${n(s.routines.runsToday)}${s.routines.limit ? ` / ${n(s.routines.limit)}` : ""}</span>${T("اجرا", "runs")}` },
        { html: `<span class="src">$${(s.routines.costToday || 0).toFixed(2)}</span>${T("هزینه", "cost")}` },
        { html: `<span class="src">${n(s.inbox.count)}</span>${T("مورد تازه در صندوق", "new in inbox")}` },
      ],
    },
    { title: T("اجراها", "Runs"), emoji: "⚙️", leaves: runs.length ? runs : [{ html: `<span class="empty">${T("هنوز اجرایی نبوده.", "No runs yet.")}</span>` }] },
    { title: T("بعدی", "Up next"), emoji: "⏰", leaves: next.length ? next : [{ html: `<span class="empty">${T("تا ۲۴ ساعت آینده چیزی زمان‌بندی نشده.", "Nothing in the next 24 hours.")}</span>` }] },
  ];
  if (s.quota && s.quota.blocked) nodes.push({ title: T("محافظ سهمیه", "Quota guard"), emoji: "⛔", leaves: [{ html: `<div class="callout c-danger"><p>${esc(s.quota.reason || "")}</p></div>` }] });
  return doc(fa, `${screenHeader(T("سلام 👋", "Hello 👋"), T("خانه", "Home"), fa)}${rootBox(`🤖 ${T("وضعیت", "Status")} · ${esc(s.meta.plan || "")}`)}${tree(nodes, fa)}${footer(fa, T("🔄 برای به‌روزرسانی", "🔄 to refresh"))}`);
}

// Skills, grouped by domain like the templates mind map.
function skillsPage(s, label, fa) {
  const T = (f, e) => (fa ? f : e);
  const groups = new Map();
  for (const k of s.skills) {
    const d = k.domain || T("دیگر", "Other");
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(k);
  }
  const nodes = [...groups].map(([d, list]) => ({
    title: esc(d),
    emoji: DOMAIN_EMOJI[d] || "📁",
    leaves: list.map((k) => ({
      html: `<span class="src">${look(k.name, k.domain).emoji} ${esc(label(k.name, k.label))}</span>${k.running ? statusChip("RUNNING", fa) : ""}`,
      sub: [`<span class="muted">${k.schedule ? `⏰ ${fa ? faDigits(k.schedule) : k.schedule}` : T("دستی", "manual")} · ${esc(k.tier || "")}</span>`],
    })),
  }));
  return doc(
    fa,
    `${screenHeader(T("مهارت‌ها", "Skills"), T(`${faDigits(s.skills.length)} مهارت`, `${s.skills.length} skills`), fa)}${rootBox(
      `🧠 ${T("مهارت‌ها", "Skills")}`,
      T("برای اجرا یکی را از دکمه‌ها انتخاب کن", "pick one below to run it")
    )}${tree(nodes, fa)}${footer(fa)}`
  );
}

function skillPage(k, label, fa, recent) {
  const T = (f, e) => (fa ? f : e);
  const { emoji } = look(k.name, k.domain);
  const runs = (recent || []).slice(0, 4).map((r) => ({
    html: `${esc(dateLine(Date.parse(r.startedAt), fa, true))} · ${timeOf(Date.parse(r.startedAt), fa)}${statusChip(r.status, fa)}`,
    sub: r.cost != null || r.model ? [`<span class="muted">${[r.model, r.cost != null ? `$${r.cost.toFixed(2)}` : ""].filter(Boolean).join(" · ")}</span>`] : [],
  }));
  const nodes = [
    { title: T("توضیح", "About"), emoji: "📋", leaves: [{ html: esc(k.description || "—") }] },
    {
      title: T("تنظیمات", "Settings"),
      emoji: "⚙️",
      leaves: [
        { html: `<span class="src">${k.schedule ? `⏰ ${fa ? faDigits(k.schedule) : k.schedule}` : T("اجرای دستی", "manual")}</span>${T("زمان", "schedule")}` },
        { html: `<span class="src">${esc(k.model || k.tier || "—")}</span>${T("مدل", "model")}` },
      ],
    },
    { title: T("اجراهای اخیر", "Recent runs"), emoji: "🕘", leaves: runs.length ? runs : [{ html: `<span class="empty">${T("هنوز اجرا نشده.", "No runs yet.")}</span>` }] },
  ];
  return doc(
    fa,
    `${screenHeader(esc(label(k.name, k.label)), T("مهارت", "Skill"), fa)}${rootBox(`${emoji} ${esc(k.name)}`, esc(k.domain || ""))}${tree(nodes, fa)}${footer(
      fa,
      k.running ? T("در حال اجرا…", "running…") : T("▶️ برای اجرا", "▶️ to run")
    )}`
  );
}

function inboxPage(s, label, fa) {
  const T = (f, e) => (fa ? f : e);
  const items = (s.inbox.items || []).slice(0, 10);
  const runs = items.filter((i) => i.kind === "run");
  const files = items.filter((i) => i.kind !== "run");
  const leaf = (i) => ({
    html: `<span class="src">${i.kind === "run" ? look(i.skill).emoji : "📄"} ${esc(i.kind === "run" ? label(i.skill, i.title) : i.title)}</span>`,
    sub: i.at ? [`<span class="muted">${esc(dateLine(i.at, fa, true))} · ${timeOf(i.at, fa)}</span>`] : [],
  });
  const nodes = [
    ...(runs.length ? [{ title: T("نتیجهٔ اجراها", "Run results"), emoji: "⚙️", leaves: runs.map(leaf) }] : []),
    ...(files.length ? [{ title: T("فایل‌های تازه", "New files"), emoji: "📂", leaves: files.map(leaf) }] : []),
  ];
  return doc(
    fa,
    `${screenHeader(T("صندوق خروجی‌ها", "Output inbox"), T(`${faDigits(s.inbox.count)} مورد تازه`, `${s.inbox.count} new`), fa)}${rootBox(`📬 ${T("صندوق", "Inbox")}`)}${
      nodes.length ? tree(nodes, fa) : tree([{ title: T("چیز تازه‌ای نیست ✨", "Nothing new ✨"), num: false }], fa)
    }${footer(fa)}`
  );
}

function helpPage(fa) {
  const T = (f, e) => (fa ? f : e);
  const cmd = (c, d) => ({ html: `<span class="kbd">${esc(c)}</span>`, sub: [`<span class="muted">${esc(d)}</span>`] });
  const nodes = [
    {
      title: T("دکمه‌ها", "Buttons"),
      emoji: "👆",
      leaves: [{ html: T("بیشتر کارها با دکمه‌های زیر هر صفحه انجام می‌شود؛ هر دکمه همین پیام را عوض می‌کند.", "Most things work with the buttons under each screen; a button changes this same message.") }],
    },
    {
      title: T("دستورها", "Commands"),
      emoji: "⌨️",
      leaves: [
        cmd("/start", T("صفحهٔ خانه", "home screen")),
        cmd("/skills", T("مهارت‌ها و اجرا", "skills and run")),
        cmd("/run <skill> [force]", T("اجرای مستقیم؛ force از محافظ سهمیه رد می‌شود", "run now; force bypasses the quota guard")),
        cmd("/note <text>", T("یادداشت در یادداشت روزانه", "add to today's note")),
        cmd("/inbox", T("خروجی‌های تازه", "new outputs")),
      ],
    },
  ];
  return doc(fa, `${screenHeader(T("راهنما", "Help"), T("ربات", "Bot"), fa)}${rootBox(`❓ ${T("راهنما", "Help")}`)}${tree(nodes, fa)}${footer(fa)}`);
}

module.exports = { reportPage, noticePage, homePage, skillsPage, skillPage, inboxPage, helpPage, look, faDigits, dateLine };
