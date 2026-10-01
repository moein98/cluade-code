// Brain view: the whole system as one graph (memory map, notes, skills, routines, runs).
// Canvas 2D, no libraries. Six layouts; hover dims all but a node and its links; click opens a
// card; search flies to a node; legend isolates one area. Tuning constants are at the top.
const SPEED = 0.15; // position easing per frame
const ORBIT_SPEED = 0.00018; // radians per ms
const RING = { root: 0, area: 1.2, project: 2.5, skill: 2.5, routine: 3.2, memory: 3.9, note: 4.7, run: 5.5 };
const RING_UNIT = 120;
const PALETTE = ["#d0633d", "#d9a047", "#5c9ee0", "#4fb39a", "#b07cd8", "#e07a9b", "#9ccc65", "#e0c25c"];
const MODES = ["rings", "circle", "areas", "links", "timeline", "orbit"];

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const { t } = I18N;
const cv = $("#cv");
const ctx = cv.getContext("2d");

let data = null;
let nodes = [];
let links = [];
const byId = new Map();
const adj = new Map();
let mode = "rings";
const view = { s: 1, x: 0, y: 0 };
let viewTarget = null;
let hover = null;
let selected = null;
let isolate = null;
let W = 0;
let H = 0;
let dpr = 1;

const pref = (k, d) => {
  try {
    return localStorage.getItem(`brain.${k}`) ?? d;
  } catch {
    return d;
  }
};
const setPref = (k, v) => {
  try {
    localStorage.setItem(`brain.${k}`, v);
  } catch {}
};

function toast(msg, bad) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (bad ? " bad" : "");
  el.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (el.hidden = true), 3000);
}

const areaColor = (area) => {
  if (area === "core") return "#ebe8e2";
  const i = data.areas.indexOf(area);
  return i < 0 ? "#6f6c67" : PALETTE[i % PALETTE.length];
};
const groups = () => [...data.areas, "Vault"];
function sorted(list) {
  const g = groups();
  return list.sort((a, b) => g.indexOf(a.area) - g.indexOf(b.area) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}

// ---------- layouts: each sets n.tx / n.ty (and n.ox/oy/oz for the orbit) ----------
const layouts = {
  rings() {
    const rings = new Map();
    for (const n of nodes) {
      const r = RING[n.kind] ?? 4;
      if (!rings.has(r)) rings.set(r, []);
      rings.get(r).push(n);
    }
    for (const [r, list] of rings) {
      sorted(list).forEach((n, i) => {
        const a = (i / list.length) * Math.PI * 2 + r * 0.7;
        n.tx = Math.cos(a) * r * RING_UNIT;
        n.ty = Math.sin(a) * r * RING_UNIT;
      });
    }
  },
  circle() {
    const list = sorted(nodes.filter((n) => n.kind !== "root"));
    const R = Math.max(380, list.length * 5.5);
    list.forEach((n, i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      n.tx = Math.cos(a) * R;
      n.ty = Math.sin(a) * R;
    });
    for (const n of nodes) if (n.kind === "root") n.tx = n.ty = 0;
  },
  areas() {
    const g = groups().filter((a) => nodes.some((n) => n.area === a));
    const R = 520;
    g.forEach((area, gi) => {
      const ang = (gi / g.length) * Math.PI * 2 - Math.PI / 2;
      const cx = Math.cos(ang) * R;
      const cy = Math.sin(ang) * R;
      const members = sorted(nodes.filter((n) => n.area === area && n.kind !== "root"));
      const hub = members.find((n) => n.kind === "area");
      if (hub) {
        hub.tx = cx;
        hub.ty = cy;
      }
      members
        .filter((n) => n !== hub)
        .forEach((n, i) => {
          const a = i * 2.39996; // golden angle
          const r = 34 + 21 * Math.sqrt(i);
          n.tx = cx + Math.cos(a) * r;
          n.ty = cy + Math.sin(a) * r;
        });
    });
    for (const n of nodes) if (n.kind === "root") n.tx = n.ty = 0;
  },
  links() {
    layouts.areas();
    const pos = nodes.map((n) => ({ n, x: n.tx + (Math.random() - 0.5) * 10, y: n.ty + (Math.random() - 0.5) * 10 }));
    const idx = new Map(pos.map((p, i) => [p.n.id, i]));
    for (let it = 0; it < 260; it++) {
      const fx = new Float64Array(pos.length);
      const fy = new Float64Array(pos.length);
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          let dx = pos[i].x - pos[j].x;
          let dy = pos[i].y - pos[j].y;
          const d2 = Math.max(dx * dx + dy * dy, 25);
          const f = 2600 / d2;
          const d = Math.sqrt(d2);
          dx = (dx / d) * f;
          dy = (dy / d) * f;
          fx[i] += dx;
          fy[i] += dy;
          fx[j] -= dx;
          fy[j] -= dy;
        }
      }
      for (const l of links) {
        const a = idx.get(l.s);
        const b = idx.get(l.t);
        const dx = pos[b].x - pos[a].x;
        const dy = pos[b].y - pos[a].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 70) * 0.025;
        fx[a] += (dx / d) * f;
        fy[a] += (dy / d) * f;
        fx[b] -= (dx / d) * f;
        fy[b] -= (dy / d) * f;
      }
      const step = 1 - it / 300;
      pos.forEach((p, i) => {
        fx[i] -= p.x * 0.004;
        fy[i] -= p.y * 0.004;
        const m = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]);
        const cap = 30 * step;
        const k = m > cap ? cap / m : 1;
        p.x += fx[i] * k;
        p.y += fy[i] * k;
      });
    }
    for (const p of pos) {
      p.n.tx = p.x;
      p.n.ty = p.y;
    }
  },
  timeline() {
    const timed = nodes.filter((n) => n.changed);
    const now = Date.now();
    const min = Math.max(Math.min(...timed.map((n) => n.changed)), now - 45 * 864e5);
    const x = (ts) => -700 + ((Math.max(ts, min) - min) / Math.max(1, now - min)) * 1400;
    const lane = { run: -230, routine: -110, skill: -40, project: 40, memory: 130, note: 220 };
    const perDay = new Map();
    for (const n of nodes) {
      if (n.kind === "root" || n.kind === "area" || !n.changed) {
        const list = nodes.filter((m) => m.kind === n.kind && (!m.changed || m.kind === "root" || m.kind === "area"));
        n.tx = -860;
        n.ty = (n.kind === "root" ? -260 : -200) + list.indexOf(n) * 24;
        continue;
      }
      const day = new Date(n.changed).toDateString();
      const k = `${n.kind}|${day}`;
      const i = perDay.get(k) || 0;
      perDay.set(k, i + 1);
      n.tx = x(n.changed);
      n.ty = (lane[n.kind] ?? 160) + (n.kind === "run" ? -i * 14 : ((i % 5) - 2) * 12);
    }
    data.timeRange = { min, now, x };
  },
  orbit() {
    layouts.rings();
    for (const n of nodes) {
      n.ox = n.tx;
      n.oz = n.ty;
      n.oy = -((RING[n.kind] ?? 4) - 2.5) * 40;
    }
  },
};

function setMode(m) {
  mode = MODES.includes(m) ? m : "rings";
  setPref("mode", mode);
  layouts[mode]();
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-checked", b.dataset.mode === mode));
  fit(true);
}

// ---------- view ----------
function bounds() {
  const xs = nodes.map((n) => n.tx);
  const ys = nodes.map((n) => n.ty);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
function fit(animate) {
  const b = bounds();
  const s = Math.min((W - 80) / (b.x1 - b.x0 + 120), (H - 150) / (b.y1 - b.y0 + 120), 2.2);
  const target = { s, x: (-(b.x0 + b.x1) / 2) * s, y: (-(b.y0 + b.y1) / 2) * s + 25 };
  if (animate) viewTarget = target;
  else Object.assign(view, target);
}
function flyTo(n) {
  const s = Math.max(view.s, 1.6);
  viewTarget = { s, x: -n.x * s, y: -n.y * s };
  select(n);
}
const toWorld = (mx, my) => ({ x: (mx - W / 2 - view.x) / view.s, y: (my - H / 2 - view.y) / view.s });

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
}

// ---------- drawing ----------
const size = (n) => (n.kind === "root" ? 13 : n.kind === "area" ? 9 : n.kind === "run" ? 2.6 : 3.2 + Math.sqrt(n.degree) * 1.5);
function shape(n, x, y, r) {
  ctx.beginPath();
  if (n.kind === "project") ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (n.kind === "skill") {
    ctx.moveTo(x, y - r * 1.3);
    ctx.lineTo(x + r * 1.3, y);
    ctx.lineTo(x, y + r * 1.3);
    ctx.lineTo(x - r * 1.3, y);
    ctx.closePath();
  } else if (n.kind === "routine") {
    ctx.moveTo(x, y - r * 1.3);
    ctx.lineTo(x + r * 1.2, y + r);
    ctx.lineTo(x - r * 1.2, y + r);
    ctx.closePath();
  } else ctx.arc(x, y, r, 0, Math.PI * 2);
}

function visibleAlpha(n) {
  const focus = hover || selected;
  if (focus) return n === focus || adj.get(focus.id).has(n.id) ? 1 : 0.12;
  if (isolate) return n.area === isolate || n.kind === "root" ? 1 : 0.12;
  return 1;
}

function frame(now) {
  if (mode === "orbit") {
    const a = $("#motion").checked ? now * ORBIT_SPEED : frame.frozen ?? 0;
    if (!$("#motion").checked) frame.frozen = a;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const n of nodes) {
      const X = n.ox * c - n.oz * s;
      const Z = n.ox * s + n.oz * c;
      const k = 900 / (900 + Z * 0.6);
      n.tx = X * k;
      n.ty = n.oy * k + Z * 0.32 * k;
      n.depth = k;
    }
  }
  for (const n of nodes) {
    n.x += (n.tx - n.x) * SPEED;
    n.y += (n.ty - n.y) * SPEED;
  }
  if (viewTarget) {
    view.s += (viewTarget.s - view.s) * SPEED;
    view.x += (viewTarget.x - view.x) * SPEED;
    view.y += (viewTarget.y - view.y) * SPEED;
    if (Math.abs(viewTarget.s - view.s) < 0.001 && Math.abs(viewTarget.x - view.x) < 0.5) viewTarget = null;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0e0e0e";
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * (W / 2 + view.x), dpr * (H / 2 + view.y));

  // Ring guides and timeline axis.
  ctx.lineWidth = 1 / view.s;
  if (mode === "rings") {
    ctx.strokeStyle = "#1c1c1c";
    for (const r of new Set(Object.values(RING))) {
      if (!r) continue;
      ctx.beginPath();
      ctx.arc(0, 0, r * RING_UNIT, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (mode === "timeline" && data.timeRange) {
    ctx.strokeStyle = "#262626";
    ctx.fillStyle = "#5f5d59";
    ctx.font = `${10 / Math.max(view.s, 0.6)}px JetBrains Mono, Vazirmatn, monospace`;
    const { min, now: end, x } = data.timeRange;
    // Label every Nth day so labels keep ~70px apart on screen.
    const dayPx = (x(min + 864e5) - x(min)) * view.s;
    const every = Math.max(1, Math.ceil(70 / Math.max(dayPx, 1)));
    ctx.direction = "ltr";
    ctx.textAlign = "left";
    let i = 0;
    for (let d = new Date(min); d.getTime() <= end; d.setDate(d.getDate() + 1), i++) {
      const xx = x(d.getTime());
      ctx.beginPath();
      ctx.moveTo(xx, -300);
      ctx.lineTo(xx, 290);
      ctx.stroke();
      if (i % every === 0) {
        ctx.fillText(I18N.dayLabel(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`), xx + 3, 300);
      }
    }
    ctx.fillStyle = "#8b8882";
    ctx.fillText(t("timelineRuns"), -700, -300);
    ctx.fillText(t("timelineFiles"), -700, -5);
  }

  // Links (in the timeline only those of the focused node, to keep it readable).
  const focus = hover || selected;
  for (const l of links) {
    if (mode === "timeline" && !(focus && (l.s === focus.id || l.t === focus.id))) continue;
    const a = byId.get(l.s);
    const b = byId.get(l.t);
    const hot = (hover || selected) && (a === (hover || selected) || b === (hover || selected));
    const alpha = Math.min(visibleAlpha(a), visibleAlpha(b));
    ctx.strokeStyle = hot ? "rgba(208,99,61,.85)" : `rgba(120,116,110,${0.28 * alpha})`;
    ctx.lineWidth = (hot ? 1.6 : 0.8) / view.s;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (mode === "circle") ctx.quadraticCurveTo(0, 0, b.x, b.y);
    else ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Nodes, back to front in the orbit.
  const order = mode === "orbit" ? [...nodes].sort((p, q) => p.depth - q.depth) : nodes;
  const showNames = $("#names").checked;
  // Labels always sit to the right of their node, also when the page is RTL.
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const n of order) {
    const alpha = visibleAlpha(n);
    const r = size(n) * (mode === "orbit" ? n.depth : 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = areaColor(n.area);
    shape(n, n.x, n.y, r);
    ctx.fill();
    if (n === selected || n === hover) {
      ctx.strokeStyle = "#ebe8e2";
      ctx.lineWidth = 1.5 / view.s;
      ctx.stroke();
    }
    const important = n.kind === "root" || n.kind === "area";
    const near = hover && (n === hover || adj.get(hover.id).has(n.id));
    if (showNames && (important || near || n === selected || (view.s > 1.3 && n.kind !== "run" && alpha > 0.5))) {
      ctx.fillStyle = important ? "#ebe8e2" : "#c4c1bb";
      ctx.font = `${important ? 600 : 400} ${(important ? 12 : 10.5) / Math.max(view.s, 0.7)}px JetBrains Mono, Vazirmatn, monospace`;
      ctx.fillText(n.label, n.x + r + 4 / view.s, n.y);
    }
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(frame);
}

// ---------- interaction ----------
function nodeAt(mx, my) {
  const w = toWorld(mx, my);
  let best = null;
  let bd = (12 / view.s) ** 2;
  for (const n of nodes) {
    const d = (n.x - w.x) ** 2 + (n.y - w.y) ** 2;
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

function select(n) {
  selected = n;
  const card = $("#card");
  if (!n) {
    card.hidden = true;
    return;
  }
  const kinds = t("kindNames");
  card.innerHTML = `<div class="lbl">${esc(kinds[n.kind] || n.kind)} · ${esc(I18N.domain(n.area))}</div>
    <h3 dir="auto">${esc(n.label)}</h3>
    ${n.note ? `<div class="note" dir="auto">${esc(n.note)}</div>` : ""}
    ${n.path ? `<div class="path">${esc(n.path)}</div>` : ""}
    <div class="acts">
      ${n.path ? `<button class="nb primary" data-act="open">${t("open")}</button><button class="nb" data-act="copy">${t("copyPath")}</button>` : ""}
      <button class="nb" data-act="fly">${t("flyTo")}</button>
    </div>`;
  card.hidden = false;
}

$("#card").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || !selected) return;
  if (b.dataset.act === "fly") flyTo(selected);
  if (b.dataset.act === "copy") {
    try {
      await navigator.clipboard.writeText(selected.path);
      toast(t("copied"));
    } catch (err) {
      toast(err.message, true);
    }
  }
  if (b.dataset.act === "open") {
    const r = await fetch("/api/open/path", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Agentic-OS": "1" },
      body: JSON.stringify({ path: selected.path }),
    });
    if (!r.ok) toast((await r.json().catch(() => ({}))).error || r.statusText, true);
  }
});

let drag = null;
cv.addEventListener("mousedown", (e) => {
  drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  cv.classList.add("drag");
});
window.addEventListener("mouseup", (e) => {
  cv.classList.remove("drag");
  if (drag && !drag.moved) select(nodeAt(e.clientX, e.clientY));
  drag = null;
});
cv.addEventListener("mousemove", (e) => {
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    viewTarget = null;
    view.x = drag.vx + dx;
    view.y = drag.vy + dy;
    return;
  }
  hover = nodeAt(e.clientX, e.clientY);
  cv.classList.toggle("point", !!hover);
  cv.title = hover ? hover.label : "";
});
cv.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    viewTarget = null;
    const w = toWorld(e.clientX, e.clientY);
    const s = Math.min(6, Math.max(0.15, view.s * Math.exp(-e.deltaY * 0.0015)));
    view.x = e.clientX - W / 2 - w.x * s;
    view.y = e.clientY - H / 2 - w.y * s;
    view.s = s;
  },
  { passive: false }
);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    select(null);
    $("#results").innerHTML = "";
  }
});

$("#q").addEventListener("input", () => {
  const q = $("#q").value.trim().toLowerCase();
  const hits = q
    ? nodes.filter((n) => `${n.label} ${n.path} ${n.note}`.toLowerCase().includes(q)).slice(0, 8)
    : [];
  $("#results").innerHTML = hits
    .map((n) => `<li data-id="${esc(n.id)}"><span dir="auto">${esc(n.label)}</span><small>${esc(n.path || n.note)}</small></li>`)
    .join("");
});
$("#results").addEventListener("click", (e) => {
  const li = e.target.closest("[data-id]");
  if (!li) return;
  flyTo(byId.get(li.dataset.id));
  $("#results").innerHTML = "";
});
$("#fit").addEventListener("click", () => fit(true));
for (const id of ["names", "motion"]) {
  $(`#${id}`).checked = pref(id, "1") === "1";
  $(`#${id}`).addEventListener("change", (e) => setPref(id, e.target.checked ? "1" : "0"));
}

function buildUi() {
  const names = t("modes");
  $("#modes").innerHTML = MODES.map((m) => `<button class="tier" role="radio" data-mode="${m}">${esc(names[m])}</button>`).join("");
  $("#modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (b) setMode(b.dataset.mode);
  });
  const areas = groups().filter((a) => nodes.some((n) => n.area === a));
  const legend = () => {
    $("#legend").innerHTML = areas
      .map((a) => {
        const cls = isolate === a ? " on" : isolate ? " off" : "";
        return `<span class="chip${cls}" data-area="${esc(a)}"><i style="background:${areaColor(a)}"></i>${esc(I18N.domain(a))}</span>`;
      })
      .join("");
  };
  legend();
  $("#legend").addEventListener("click", (e) => {
    const c = e.target.closest("[data-area]");
    if (!c) return;
    isolate = isolate === c.dataset.area ? null : c.dataset.area;
    legend();
  });
  $("#stats").textContent = `${nodes.length} · ${links.length}`;
}

async function main() {
  resize();
  window.addEventListener("resize", () => {
    resize();
    fit(true);
  });
  try {
    const st = await (await fetch("/api/state", { cache: "no-store" })).json();
    I18N.set(st.meta.language || "en");
  } catch {
    I18N.set("en");
  }
  data = await (await fetch("/api/brain", { cache: "no-store" })).json();
  nodes = data.nodes.map((n) => ({ ...n, x: 0, y: 0, tx: 0, ty: 0, degree: 0, depth: 1 }));
  for (const n of nodes) {
    byId.set(n.id, n);
    adj.set(n.id, new Set());
  }
  links = data.links.filter((l) => byId.has(l.s) && byId.has(l.t));
  for (const l of links) {
    adj.get(l.s).add(l.t);
    adj.get(l.t).add(l.s);
    byId.get(l.s).degree++;
    byId.get(l.t).degree++;
  }
  buildUi();
  const fromHash = /#mode=(\w+)/.exec(location.hash); // e.g. /brain#mode=links
  setMode(fromHash ? fromHash[1] : pref("mode", "rings"));
  fit(false);
  requestAnimationFrame(frame);
}

main().catch((e) => toast(e.message, true));
