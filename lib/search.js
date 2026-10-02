// Vault search: BM25 ranking over the vault's notes with Persian-aware normalization
// (Arabic ي/ك → Persian ی/ک, ZWNJ and diacritics removed). Used by the dashboard and by the
// vault-search MCP server. The index is rebuilt lazily when files change.
const fs = require("fs");
const path = require("path");

const K1 = 1.4;
const B = 0.75;
const SKIP_DIRS = new Set([".obsidian", ".git", ".claude", ".trash", "node_modules"]);

function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ً-ٰٟ]/g, "") // Arabic diacritics
    .replace(/‌/g, ""); // ZWNJ: "می‌شود" and "میشود" match
}
function tokenize(s) {
  return normalize(s).match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function createSearch(vault, opts = {}) {
  const skip = new Set([...SKIP_DIRS, ...(opts.skipDirs || [])]);
  let docs = [];
  let df = new Map();
  let avgLen = 1;
  let builtAt = 0;
  let signature = "";

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
        // Hidden folders (.obsidian, .brainsync …) and configured folders are not notes.
        if (e.name.startsWith(".") || skip.has(e.name)) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!skip.has(r)) walk(path.join(dir, e.name), r);
        } else if (/\.md$/i.test(e.name)) {
          try {
            out.push({ rel: r, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs });
          } catch {}
        }
      }
    };
    walk(vault, "");
    return out;
  }

  function build() {
    const files = listFiles();
    const sig = files.map((f) => `${f.rel}:${f.mtime}`).join("|");
    if (sig === signature) return;
    signature = sig;
    docs = [];
    df = new Map();
    for (const f of files) {
      const text = fs.readFileSync(path.join(vault, f.rel), "utf8");
      const title = path.posix.basename(f.rel, ".md");
      const tokens = tokenize(`${title} ${text}`);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      docs.push({ rel: f.rel, title, titleTokens: new Set(tokenize(title)), text, len: tokens.length, tf, mtime: f.mtime });
    }
    avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
    builtAt = Date.now();
  }

  function snippet(text, terms) {
    const plain = text.replace(/^---[\s\S]*?---\s*/, "").replace(/\s+/g, " ");
    const norm = normalize(plain);
    let at = -1;
    for (const t of terms) {
      at = norm.indexOf(t);
      if (at >= 0) break;
    }
    const start = Math.max(0, at - 60);
    return (start > 0 ? "…" : "") + plain.slice(start, start + 200).trim() + "…";
  }

  function search(query, limit = 10) {
    if (Date.now() - builtAt > 30e3) build();
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const n = docs.length;
    const scored = [];
    for (const d of docs) {
      let score = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (n - df.get(t) + 0.5) / (df.get(t) + 0.5));
        score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avgLen));
        // A note named after the query is what people usually want: a strong title bonus.
        if (d.titleTokens.has(t)) score += 3 * idf + 1;
      }
      if (score > 0) scored.push({ file: d.rel, title: d.title, score, at: d.mtime });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((r) => {
      const d = docs.find((x) => x.rel === r.file);
      return { ...r, score: Math.round(r.score * 100) / 100, snippet: snippet(d.text, terms) };
    });
  }

  return { search, size: () => docs.length };
}

module.exports = { createSearch, tokenize };
