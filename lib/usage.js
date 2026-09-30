// Reads Claude Code session logs (~/.claude/projects/**/*.jsonl) incrementally
// and aggregates token usage into the dashboard's windows and 30-day activity.
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(os.homedir(), ".claude", "projects");
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const KEEP_MS = 36 * DAY;
const BLOCK = 5 * HOUR;

// [model prefix, input $/MTok, output $/MTok, cache-read $/MTok (default 0.1x input)]
// Cache writes: 5-minute = 1.25x input, 1-hour = 2x input.
const PRICES = [
  ["claude-fable-5-1", 10, 50, 0.25],
  ["claude-mythos-5-1", 10, 50, 0.25],
  ["claude-fable-5", 10, 50, 1],
  ["claude-mythos-5", 10, 50, 1],
  ["claude-opus-5-5", 4, 20, 0.2],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4-8", 5, 25],
  ["claude-opus-4-7", 5, 25],
  ["claude-opus-4-6", 5, 25],
  ["claude-opus-4-5", 5, 25],
  ["claude-opus-4", 15, 75],
  ["claude-sonnet-5-5", 2, 10, 0.2],
  ["claude-sonnet-5", 2, 10],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-4-5", 1, 5],
  ["claude-3-5-haiku", 0.8, 4],
].sort((a, b) => b[0].length - a[0].length);

function priceOf(model) {
  return PRICES.find((p) => (model || "").startsWith(p[0])) || PRICES.find((p) => p[0] === "claude-opus-5-5");
}

function costOf(model, u) {
  const [, inp, out, read] = priceOf(model);
  const cc = u.cache_creation || {};
  const write1h = cc.ephemeral_1h_input_tokens || 0;
  const write5m = cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens || 0) - write1h);
  const cost =
    (u.input_tokens || 0) * inp +
    (u.output_tokens || 0) * out +
    write5m * inp * 1.25 +
    write1h * inp * 2 +
    (u.cache_read_input_tokens || 0) * (read ?? inp * 0.1);
  return (cost / 1e6) * (u.speed === "fast" ? 2 : 1);
}

const files = new Map(); // path -> byte offset already parsed
const entries = new Map(); // message id + request id -> entry
let lastScan = 0;

function walk(dir, out) {
  let list;
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

function ingest(line) {
  if (!line.includes('"usage"')) return;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  const m = o.message;
  if (o.type !== "assistant" || !m || !m.usage || m.model === "<synthetic>") return;
  const ts = Date.parse(o.timestamp);
  if (!ts || Date.now() - ts > KEEP_MS) return;
  const u = m.usage;
  // Streaming writes one line per content block with the same message id; keep the latest.
  entries.set(`${m.id || o.uuid}:${o.requestId || ""}`, {
    ts,
    session: o.sessionId,
    model: m.model,
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cost: costOf(m.model, u),
  });
}

function scan() {
  const now = Date.now();
  if (now - lastScan < 5000) return;
  lastScan = now;
  for (const f of walk(ROOT, [])) {
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      continue;
    }
    if (now - st.mtimeMs > KEEP_MS) continue;
    let offset = files.get(f) || 0;
    if (st.size < offset) offset = 0; // file was rewritten
    if (st.size === offset) continue;
    const buf = Buffer.alloc(st.size - offset);
    const fd = fs.openSync(f, "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, offset);
    } finally {
      fs.closeSync(fd);
    }
    // Only consume complete lines; a partial last line is re-read next scan.
    const nl = buf.lastIndexOf(10);
    if (nl < 0) continue;
    files.set(f, offset + nl + 1);
    for (const line of buf.toString("utf8", 0, nl).split("\n")) ingest(line);
  }
  for (const [k, e] of entries) if (now - e.ts > KEEP_MS) entries.delete(k);
}

const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function trend(current, previous) {
  if (!previous) return null;
  return current / previous - 1;
}

function summary(cfg) {
  scan();
  const now = Date.now();
  const withReads = cfg.limits.countCacheReads !== false;
  const tok = (e) => e.input + e.output + e.cacheWrite + (withReads ? e.cacheRead : 0);
  const list = [...entries.values()].sort((a, b) => a.ts - b.ts);

  // 5-hour blocks: a block starts at the hour of its first message and lasts 5 hours.
  const blocks = [];
  for (const e of list) {
    let b = blocks[blocks.length - 1];
    if (!b || e.ts >= b.start + BLOCK) {
      b = { start: Math.floor(e.ts / HOUR) * HOUR, tokens: 0, sessions: new Set() };
      blocks.push(b);
    }
    b.tokens += tok(e);
    b.sessions.add(e.session);
  }
  const last = blocks[blocks.length - 1];
  const cur = last && now < last.start + BLOCK ? last : null;
  const done = blocks.filter((b) => b !== cur).slice(-10);
  const avgBlock = done.length ? done.reduce((s, b) => s + b.tokens, 0) / done.length : 0;
  const projected = cur ? (cur.tokens * BLOCK) / Math.max(now - cur.start, HOUR / 2) : 0;
  const fiveHour = {
    used: cur ? cur.tokens : 0,
    limit: cfg.limits.fiveHourTokens,
    sessions: cur ? cur.sessions.size : 0,
    resetsIn: cur ? cur.start + BLOCK - now : null,
    trend: cur ? trend(projected, avgBlock) : null,
  };

  // Weekly window: fixed reset (day + hour) when configured, otherwise rolling 7 days.
  let wStart;
  let resetsIn = null;
  const reset = cfg.limits.weeklyReset;
  if (reset && DAYS.includes(reset.day)) {
    const d = new Date(now);
    d.setHours(reset.hour || 0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() - DAYS.indexOf(reset.day) + 7) % 7));
    if (d.getTime() > now) d.setDate(d.getDate() - 7);
    wStart = d.getTime();
    resetsIn = wStart + 7 * DAY - now;
  } else {
    wStart = now - 7 * DAY;
  }
  const inRange = (a, b) => list.filter((e) => e.ts >= a && e.ts < b);
  const week = inRange(wStart, now + 1);
  const prevWeek = inRange(wStart - 7 * DAY, now - 7 * DAY);
  const weekly = {
    used: week.reduce((s, e) => s + tok(e), 0),
    limit: cfg.limits.weeklyTokens,
    sessions: new Set(week.map((e) => e.session)).size,
    resetsIn,
    trend: trend(week.reduce((s, e) => s + tok(e), 0), prevWeek.reduce((s, e) => s + tok(e), 0)),
  };

  // 30-day cumulative activity, one point per local day.
  const today0 = startOfDay(now);
  const byDay = new Map();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today0);
    d.setDate(d.getDate() - i);
    byDay.set(dayKey(d), { date: dayKey(d), tokens: 0, cost: 0, cum: 0 });
  }
  for (const e of list) {
    const day = byDay.get(dayKey(e.ts));
    if (day) {
      day.tokens += tok(e);
      day.cost += e.cost;
    }
  }
  let cum = 0;
  const days = [...byDay.values()];
  for (const d of days) d.cum = cum += d.tokens;

  const costToday = list.filter((e) => e.ts >= today0).reduce((s, e) => s + e.cost, 0);
  return { fiveHour, weekly, costToday, activity: { days, total: cum } };
}

module.exports = { summary };
