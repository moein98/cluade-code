// Memory map check (deterministic, no AI). The vault's MAP.md links to one signpost per area
// (maps/*.md). Rules: every link points to something that exists; MAP.md stays under 60 lines
// and area maps under 80; area maps keep the six sections in order; every wiki/projects page
// appears on some map. Also parses the maps into entries for the Brain view.
const fs = require("fs");
const path = require("path");

const SECTIONS = ["Projects", "State", "Skills", "Memory", "Routines", "Not here"];
const LINK = /\[([^\]]+)\]\((?:<([^>]+)>|([^)\s]+))\)(?::\s*(.*))?/;

const norm = (p) => path.normalize(p).replace(/[\\/]+$/, "").toLowerCase();

// Entries of one signpost file: { section, name, target, note, line }.
function parseSignpost(file) {
  const out = [];
  let section = null;
  fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (line.startsWith("## ")) section = line.slice(3).trim();
      const m = line.startsWith("- ") ? LINK.exec(line) : null;
      if (!m) return;
      const raw = m[2] || m[3];
      const target = path.isAbsolute(raw) ? raw : path.resolve(path.dirname(file), raw);
      out.push({ section, name: m[1], target, note: (m[4] || "").trim(), line: i + 1 });
    });
  return out;
}

function checkMap(vault) {
  const rel = (f) => path.relative(vault, f).replace(/\\/g, "/");
  const root = path.join(vault, "MAP.md");
  const problems = [];
  const areas = [];
  if (!fs.existsSync(root)) return { ok: false, problems: ["MAP.md is missing"], areas, checkedAt: Date.now() };

  const linked = new Set();
  const checkFile = (file, limit) => {
    const lines = fs.readFileSync(file, "utf8").replace(/\s+$/, "").split(/\r?\n/);
    if (lines.length > limit) problems.push(`${rel(file)}: ${lines.length} lines (limit ${limit})`);
    const entries = parseSignpost(file);
    for (const e of entries) {
      linked.add(norm(e.target));
      if (!fs.existsSync(e.target)) problems.push(`${rel(file)}:${e.line}: missing ${e.target}`);
    }
    return { lines, entries };
  };

  const { entries: rootEntries } = checkFile(root, 60);
  const mapsDir = norm(path.join(vault, "maps"));
  for (const e of rootEntries) {
    if (norm(path.dirname(e.target)) !== mapsDir || !fs.existsSync(e.target)) continue;
    const { lines, entries } = checkFile(e.target, 80);
    const heads = lines.filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
    if (heads.join("|") !== SECTIONS.join("|")) {
      problems.push(`${rel(e.target)}: sections must be ${SECTIONS.join(", ")} (found ${heads.join(", ") || "none"})`);
    }
    areas.push({ name: e.name, note: e.note, file: e.target, entries });
  }

  // Area maps that MAP.md forgot, and project pages that no map mentions.
  try {
    for (const f of fs.readdirSync(path.join(vault, "maps"))) {
      if (f.endsWith(".md") && !linked.has(norm(path.join(vault, "maps", f)))) problems.push(`maps/${f}: not linked from MAP.md`);
    }
  } catch {}
  try {
    for (const f of fs.readdirSync(path.join(vault, "wiki", "projects"))) {
      const p = path.join(vault, "wiki", "projects", f);
      if (f.endsWith(".md") && !linked.has(norm(p))) problems.push(`wiki/projects/${f}: not on any map`);
    }
  } catch {}

  return { ok: problems.length === 0, problems, areas, rootEntries, checkedAt: Date.now() };
}

module.exports = { checkMap, parseSignpost, SECTIONS };
