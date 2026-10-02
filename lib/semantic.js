// Semantic vault search: multilingual embeddings from a local Ollama (default model bge-m3,
// which handles Persian and English) over chunks of the vault's notes, blended with BM25
// keyword scores (hybrid). A Persian query finds English notes and the other way round.
// The index lives in data/vectors.json and is updated incrementally (by file mtime) right before
// a search and once a night. Ollama runs only while embedding (lib/ollama.js starts and stops it);
// without it, or while the first index is being built, search falls back to keywords.
const fs = require("fs");
const path = require("path");

const CHUNK = 900; // characters per chunk
const BATCH = 16;
const SKIP = new Set([".obsidian", ".git", ".claude", ".trash", "node_modules"]);

const toB64 = (arr) => Buffer.from(new Float32Array(arr).buffer).toString("base64");
const fromB64 = (s) => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};
function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

function chunksOf(rel, text) {
  const title = path.posix.basename(rel, ".md");
  const body = text.replace(/^---[\s\S]*?---\s*/, "").replace(/\r/g, "");
  const parts = [];
  let cur = "";
  for (const para of body.split(/\n{2,}/)) {
    if ((cur + "\n\n" + para).length > CHUNK && cur) {
      parts.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${para}` : para;
    while (cur.length > CHUNK * 1.5) {
      parts.push(cur.slice(0, CHUNK));
      cur = cur.slice(CHUNK);
    }
  }
  if (cur.trim()) parts.push(cur);
  if (!parts.length) parts.push("");
  return parts.map((p) => `${title}\n${p}`.trim());
}

// ollama: lib/ollama.js instance (host, model, keepAlive, use()).
function createSemantic(cfg, dataDir, ollama) {
  const s = cfg.semantic || {};
  const { host, model } = ollama;
  const vault = cfg.vault.path;
  const skip = new Set([...SKIP, cfg.vault.runsFolder, ...(cfg.vault.searchSkip || [])]);
  const file = path.join(dataDir, "vectors.json");
  const status = { enabled: !!s.enabled, ready: false, chunks: 0, files: 0, building: false, error: null, lastBuild: null };
  let index = { model, files: {} };
  let cache = null; // decoded vectors

  function loadIndex() {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (j.model === model) index = j;
    } catch {}
    cache = null;
    status.files = Object.keys(index.files).length;
    status.chunks = Object.values(index.files).reduce((n, f) => n + f.chunks.length, 0);
    status.ready = status.chunks > 0;
  }
  if (status.enabled) loadIndex();

  async function embed(texts) {
    const r = await fetch(`${host}/api/embed`, {
      method: "POST",
      body: JSON.stringify({ model, input: texts, keep_alive: ollama.keepAlive, options: ollama.options }),
      signal: AbortSignal.timeout(300e3),
    });
    if (!r.ok) throw new Error(`ollama /api/embed ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).embeddings.map(normalize);
  }

  function listFiles() {
    const out = [];
    const walk = (dir, rel) => {
      let list;
      try {
        list = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of list) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.name.startsWith(".") || skip.has(e.name) || skip.has(r)) continue;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else if (/\.md$/i.test(e.name)) out.push(r);
      }
    };
    walk(vault, "");
    return out;
  }

  // Embed new or changed notes, drop deleted ones. Ollama is started only when something changed.
  async function build() {
    if (!status.enabled || status.building) return;
    status.building = true;
    try {
      const files = listFiles();
      const seen = new Set(files);
      let removed = 0;
      for (const rel of Object.keys(index.files)) {
        if (!seen.has(rel)) {
          delete index.files[rel];
          removed++;
        }
      }
      const todo = [];
      for (const rel of files) {
        let mtime;
        try {
          mtime = fs.statSync(path.join(vault, rel)).mtimeMs;
        } catch {
          continue;
        }
        if (!index.files[rel] || index.files[rel].mtime !== mtime) todo.push([rel, mtime]);
      }
      let changed = 0;
      if (todo.length) {
        await ollama.use(async () => {
          for (const [rel, mtime] of todo) {
            const texts = chunksOf(rel, fs.readFileSync(path.join(vault, rel), "utf8"));
            const vecs = [];
            for (let i = 0; i < texts.length; i += BATCH) vecs.push(...(await embed(texts.slice(i, i + BATCH))));
            index.files[rel] = { mtime, chunks: texts.map((t, i) => ({ text: t.slice(0, 600), vec: toB64(vecs[i]) })) };
            // Save every 25 notes so a long first build survives a restart.
            if (++changed % 25 === 0) fs.writeFileSync(file, JSON.stringify(index));
          }
        });
      }
      if (changed || removed || !fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(index));
      loadIndex();
      status.error = null;
      status.lastBuild = Date.now();
      if (changed) console.log(`[semantic] indexed ${changed} note(s); ${status.chunks} chunks total`);
    } catch (e) {
      status.error = e.message.split("\n")[0];
      console.log(`[semantic] index update failed: ${status.error}`);
    } finally {
      status.building = false;
    }
  }

  function vectors() {
    if (!cache) {
      cache = [];
      for (const [rel, f] of Object.entries(index.files)) {
        for (const c of f.chunks) cache.push({ rel, text: c.text, vec: fromB64(c.vec) });
      }
    }
    return cache;
  }

  // Best chunk per note by cosine similarity (vectors are unit length).
  async function query(q, limit = 10) {
    const [qv] = await ollama.use(() => embed([q]));
    const best = new Map();
    for (const c of vectors()) {
      let dot = 0;
      for (let i = 0; i < qv.length; i++) dot += qv[i] * c.vec[i];
      const b = best.get(c.rel);
      if (!b || dot > b.score) best.set(c.rel, { file: c.rel, score: dot, snippet: c.text });
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Hybrid ranking: 65% semantic, 35% keyword (BM25 scaled to the best hit). Keywords only while
  // the first index is being built or when Ollama can't be started.
  async function search(q, keyword, limit = 12) {
    const kwOnly = () => keyword(q, limit).map((h) => ({ ...h, mode: "keyword" }));
    if (!status.enabled || !q.trim()) return kwOnly();
    if (!status.ready) {
      build();
      return kwOnly();
    }
    let sem;
    try {
      await build();
      sem = await query(q, 30);
    } catch (e) {
      status.error = e.message.split("\n")[0];
      return kwOnly();
    }
    const kw = keyword(q, 30);
    const kwMax = Math.max(...kw.map((h) => h.score), 1e-9);
    const merged = new Map();
    for (const h of sem) {
      merged.set(h.file, {
        file: h.file,
        title: path.posix.basename(h.file, ".md"),
        sem: h.score,
        kw: 0,
        snippet: h.snippet.replace(/^[^\n]*\n/, "").replace(/\s+/g, " ").slice(0, 220) + "…",
      });
    }
    for (const h of kw) {
      const m = merged.get(h.file) || { file: h.file, title: h.title, sem: 0, snippet: h.snippet };
      m.kw = h.score / kwMax;
      merged.set(h.file, m);
    }
    return [...merged.values()]
      .map((m) => ({ ...m, score: Math.round((0.65 * m.sem + 0.35 * m.kw) * 1000) / 1000, mode: "hybrid" }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Start Ollama and load the model ahead of a search (the search box got focus), so the
  // query itself is fast. A no-op while it is warm.
  let warmedAt = 0;
  function warm() {
    if (!status.enabled || !status.ready || Date.now() - warmedAt < 30e3) return;
    warmedAt = Date.now();
    ollama.use(() => embed(["warm up"])).catch(() => {});
  }

  return { build, search, warm, status: () => ({ ...status, model }) };
}

module.exports = { createSemantic };
