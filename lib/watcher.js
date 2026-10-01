// Runs a skill when new files land in a vault folder (e.g. a clipped article in raw/).
// Changes are collected for `debounceSec` after the last one, then a single run gets the whole
// list through the {{files}} prompt placeholder. Files already handed to a run are remembered
// in data/watch.json so restarts don't re-run them.
const fs = require("fs");
const path = require("path");

const EXT = /\.(md|txt|pdf|html?)$/i;

function createWatchers(cfg, dataDir, runner) {
  const vault = cfg.vault.path;
  const file = path.join(dataDir, "watch.json");
  let seen = {};
  try {
    seen = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const save = () => fs.writeFileSync(file, JSON.stringify(seen, null, 1));
  const states = [];

  for (const w of cfg.watchers || []) {
    if (w.enabled === false) continue;
    const root = path.join(vault, w.folder);
    const exclude = (w.exclude || []).map((x) => x.replace(/\\/g, "/").replace(/\/$/, "") + "/");
    const s = { skill: w.skill, folder: w.folder, pending: new Set(), timer: null, lastRun: null, error: null };
    const startedAt = Date.now();
    states.push(s);

    const fire = () => {
      s.timer = null;
      const files = [...s.pending].filter((f) => {
        try {
          return fs.statSync(path.join(vault, f)).size > 0;
        } catch {
          return false; // deleted or renamed meanwhile
        }
      });
      if (!files.length) {
        s.pending.clear();
        return;
      }
      try {
        runner.start(w.skill, "watch", undefined, undefined, { vars: { files: files.map((f) => `- ${f}`).join("\n") } });
        for (const f of files) {
          seen[f] = fs.statSync(path.join(vault, f)).mtimeMs;
          s.pending.delete(f);
        }
        save();
        s.lastRun = Date.now();
        s.error = null;
      } catch (e) {
        // Busy, quota guard or daily limit: keep the files and try again later.
        s.error = e.message;
        s.timer = setTimeout(fire, 10 * 60e3);
      }
    };

    try {
      fs.watch(root, { recursive: true }, (_event, name) => {
        if (!name) return;
        const rel = `${w.folder}/${String(name).replace(/\\/g, "/")}`;
        if (!EXT.test(rel) || exclude.some((x) => rel.startsWith(x))) return;
        if (rel.split("/").some((p) => p.startsWith("."))) return;
        let st;
        try {
          st = fs.statSync(path.join(vault, rel));
        } catch {
          return;
        }
        if (!st.isFile() || st.mtimeMs < startedAt - 5000 || seen[rel] >= st.mtimeMs) return;
        s.pending.add(rel);
        clearTimeout(s.timer);
        s.timer = setTimeout(fire, (w.debounceSec || 90) * 1000);
      });
      console.log(`[watch] ${w.folder}/ -> ${w.skill}`);
    } catch (e) {
      s.error = e.message;
      console.log(`[watch] cannot watch ${w.folder}: ${e.message}`);
    }
  }

  return {
    status: () => states.map((s) => ({ skill: s.skill, folder: s.folder, pending: [...s.pending], lastRun: s.lastRun, error: s.error })),
  };
}

module.exports = { createWatchers };
