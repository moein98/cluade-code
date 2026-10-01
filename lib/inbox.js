// Output inbox: new results waiting to be read — finished run notes plus new or changed files in
// the configured vault folders. An item leaves the inbox once it is opened or marked read; a file
// that changes after being read comes back.
const fs = require("fs");
const path = require("path");

const DAY = 24 * 3600e3;

function createInbox(cfg, dataDir, listRuns) {
  const vault = cfg.vault.path;
  const opt = cfg.inbox || {};
  const file = path.join(dataDir, "inbox.json");
  let st = null;
  try {
    st = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  // First start: everything older than now counts as read, so the inbox doesn't flood.
  if (!st) st = { since: Date.now(), read: {} };
  const save = () => fs.writeFileSync(file, JSON.stringify(st, null, 1));
  save();

  function walk(rel, out) {
    let list;
    try {
      list = fs.readdirSync(path.join(vault, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (e.name.startsWith(".")) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r, out);
      else if (/\.(md|pdf|txt)$/i.test(e.name)) out.push(r);
    }
  }

  function all() {
    const horizon = Math.max(st.since, Date.now() - (opt.days || 14) * DAY);
    const items = new Map();
    for (const r of listRuns()) {
      const at = Date.parse(r.endedAt || r.startedAt);
      if (r.status === "COMPLETE" && r.note && at >= horizon) {
        items.set(r.note, { file: r.note, title: r.label, skill: r.skill, kind: "run", at });
      }
    }
    for (const folder of opt.folders || []) {
      const files = [];
      walk(folder, files);
      for (const f of files) {
        let at;
        try {
          at = fs.statSync(path.join(vault, f)).mtimeMs;
        } catch {
          continue;
        }
        if (at >= horizon && !items.has(f)) {
          items.set(f, { file: f, title: path.posix.basename(f).replace(/\.md$/i, ""), kind: folder, at });
        }
      }
    }
    return [...items.values()].filter((i) => !(st.read[i.file] >= i.at)).sort((a, b) => b.at - a.at);
  }

  function markRead(rel) {
    st.read[rel] = Date.now();
    save();
  }

  function markAll() {
    const now = Date.now();
    for (const i of all()) st.read[i.file] = now;
    // Forget read marks for files that left the window.
    const horizon = now - ((opt.days || 14) + 1) * DAY;
    for (const [k, v] of Object.entries(st.read)) if (v < horizon) delete st.read[k];
    save();
  }

  return {
    state: () => {
      const items = all();
      return { count: items.length, items: items.slice(0, 12) };
    },
    markRead,
    markAll,
  };
}

module.exports = { createInbox };
