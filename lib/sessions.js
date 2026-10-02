// Claude Code session history from ~/.claude/projects/**/*.jsonl: title, project folder,
// first prompt, time span, tokens and API-equivalent cost per session, plus full-text search.
// Parsed files are cached by size + mtime.
const fs = require("fs");
const path = require("path");
const os = require("os");

// CLAUDE_CONFIG_DIR moves Claude Code's folder (e.g. off drive C); default ~/.claude.
const ROOT = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
const cache = new Map(); // file -> { key, session }

function files() {
  const out = [];
  const walk = (d) => {
    let list;
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl") && !p.includes(`${path.sep}subagents${path.sep}`)) out.push(p);
    }
  };
  walk(ROOT);
  return out;
}

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((c) => c && c.type === "text").map((c) => c.text).join("\n")
      : "";

function parse(file, costOf) {
  const s = { id: path.basename(file, ".jsonl"), file, title: "", firstPrompt: "", prompts: [], cwd: "", start: 0, end: 0, messages: 0, tokens: 0, cost: 0, model: "" };
  const seen = new Set();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.sessionId) s.id = o.sessionId;
    if (o.cwd && !s.cwd) s.cwd = o.cwd;
    const ts = Date.parse(o.timestamp);
    if (ts) {
      if (!s.start || ts < s.start) s.start = ts;
      if (ts > s.end) s.end = ts;
    }
    if (o.type === "ai-title") s.title = o.aiTitle || o.title || s.title;
    if (o.type === "user" && o.message && !o.isMeta) {
      const t = textOf(o.message.content).trim();
      if (t && !t.startsWith("<")) {
        s.messages++;
        if (!s.firstPrompt) s.firstPrompt = t.slice(0, 200);
        if (s.prompts.length < 20) s.prompts.push(t.slice(0, 400)); // for session notes (lib/projects.js)
      }
    }
    if (o.type === "assistant" && o.message && o.message.usage) {
      const key = `${o.message.id}:${o.requestId || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const u = o.message.usage;
      s.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
      s.cost += costOf(o.message.model, u);
      if (o.message.model && o.message.model !== "<synthetic>") s.model = o.message.model;
    }
  }
  s.title = s.title || s.firstPrompt.split("\n")[0].slice(0, 80);
  return s;
}

// excludeDirs: working folders whose sessions are internal (e.g. quality checks run in data/).
function createSessions(costOf, excludeDirs = []) {
  const excluded = excludeDirs.map((d) => d.toLowerCase());
  const hidden = (s) => excluded.includes(String(s.cwd || "").toLowerCase());
  // full: keep the user prompts (session notes need them; the dashboard list does not).
  function list(limit = 30, { full = false } = {}) {
    const out = [];
    for (const f of files()) {
      let st;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      const key = `${st.size}:${st.mtimeMs}`;
      let c = cache.get(f);
      if (!c || c.key !== key) {
        c = { key, session: parse(f, costOf) };
        cache.set(f, c);
      }
      if (c.session.messages && !hidden(c.session)) out.push(c.session);
    }
    return out
      .sort((a, b) => b.end - a.end)
      .slice(0, limit)
      .map(({ file, prompts, ...s }) => (full ? { ...s, prompts } : s));
  }

  // Sessions whose user or assistant text contains every word of the query.
  function search(query, limit = 20) {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const f of files()) {
      const raw = fs.readFileSync(f, "utf8");
      const lower = raw.toLowerCase();
      if (!words.every((w) => lower.includes(w))) continue;
      let snippet = "";
      for (const line of raw.split("\n")) {
        if (!line.includes('"message"')) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        const t = o.message ? textOf(o.message.content) : "";
        const i = t.toLowerCase().indexOf(words[0]);
        if (i >= 0) {
          snippet = (i > 60 ? "…" : "") + t.slice(Math.max(0, i - 60), i + 140).replace(/\s+/g, " ") + "…";
          break;
        }
      }
      if (!snippet) continue; // matched only in metadata/tool payloads
      const c = cache.get(f);
      const s = c ? c.session : parse(f, costOf);
      if (hidden(s)) continue;
      out.push({ id: s.id, title: s.title, cwd: s.cwd, end: s.end, snippet });
    }
    return out.sort((a, b) => b.end - a.end).slice(0, limit);
  }

  function find(id) {
    return list(500).find((s) => s.id === id);
  }

  return { list, search, find };
}

module.exports = { createSessions };
