// Brain view data: one graph of the whole system, built from files that already exist —
// the memory map (MAP.md + maps/*.md), wiki notes and their [[links]], skills, routines and
// recent runs. Nodes: {id, kind, label, area, layer, path, note, changed}; links: {s, t}.
const fs = require("fs");
const path = require("path");

const KIND_BY_SECTION = { Projects: "project", State: "memory", Skills: "skill", Memory: "memory", Routines: "routine" };
const LAYER_BY_KIND = { root: "core", area: "core", project: "apps", app: "apps", skill: "skills", routine: "routines", memory: "memory", note: "memory", run: "runs" };

const key = (p) => "p:" + path.normalize(p).replace(/[\\/]+$/, "").toLowerCase();
const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
};

function buildBrain({ vault, map, skills, runs, cloudRoutines }) {
  const nodes = new Map();
  const links = [];
  const linkSet = new Set();
  const add = (id, kind, label, area, p, note, changed) => {
    if (!nodes.has(id)) {
      nodes.set(id, { id, kind, label, area, layer: LAYER_BY_KIND[kind] || "memory", path: p || "", note: note || "", changed: changed ?? (p ? mtime(p) : null) });
    }
    return nodes.get(id);
  };
  const link = (s, t) => {
    if (s === t || !nodes.has(s) || !nodes.has(t)) return;
    const k = s < t ? `${s}|${t}` : `${t}|${s}`;
    if (linkSet.has(k)) return;
    linkSet.add(k);
    links.push({ s, t });
  };

  const rootPath = path.join(vault, "MAP.md");
  add("root", "root", "MAP", "core", rootPath, "Root signpost");

  // Memory map: areas and their entries.
  for (const a of map.areas || []) {
    const areaId = key(a.file);
    add(areaId, "area", a.name, a.name, a.file, a.note);
    link("root", areaId);
    for (const e of a.entries) {
      const kind = KIND_BY_SECTION[e.section];
      if (!kind) continue;
      const n = add(key(e.target), kind, e.name, a.name, e.target, e.note);
      link(areaId, n.id);
    }
  }

  // Wiki notes and the [[links]] between them.
  const notes = [];
  const walk = (dir) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) notes.push(p);
    }
  };
  walk(path.join(vault, "wiki"));
  const byName = new Map(notes.map((p) => [path.basename(p, ".md").toLowerCase(), p]));
  for (const p of notes) add(key(p), "note", path.basename(p, ".md"), "Vault", p, path.relative(vault, p).replace(/\\/g, "/"));
  for (const p of notes) {
    const text = fs.readFileSync(p, "utf8");
    for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
      const target = byName.get(m[1].trim().toLowerCase());
      if (target) link(key(p), key(target));
    }
  }

  // Skills (the map may already know their SKILL.md), routines, runs.
  const agentic = (map.areas || []).find((a) => /agentic/i.test(a.name));
  const agenticId = agentic ? key(agentic.file) : "root";
  for (const s of skills) {
    const p = path.join(vault, ".claude", "skills", s.name, "SKILL.md");
    const n = add(key(p), "skill", s.labels && s.labels.fa ? `${s.label} · ${s.labels.fa}` : s.label, agentic ? agentic.name : "core", p, s.description);
    n.kind = "skill";
    n.layer = "skills";
    link(agenticId, n.id);
    if (s.schedule) {
      const r = add(`routine:${s.name}`, "routine", `${s.label} ${s.days ? s.days.join(" ") : "daily"} ${s.schedule}`, n.area, "", "local schedule");
      link(n.id, r.id);
    }
  }
  for (const c of cloudRoutines || []) {
    const r = add(`routine:cloud:${c.id}`, "routine", `${c.label} ${c.schedule} ☁`, agentic ? agentic.name : "core", "", "cloud routine");
    const s = skills.find((k) => k.name === c.skill);
    if (s) link(key(path.join(vault, ".claude", "skills", s.name, "SKILL.md")), r.id);
    else link(agenticId, r.id);
  }
  for (const r of runs.slice(0, 40)) {
    const t = Date.parse(r.startedAt);
    const d = new Date(t);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const n = add(`run:${r.id}`, "run", `${r.label} ${hm}`, agentic ? agentic.name : "core", r.note ? path.join(vault, r.note) : "", `${r.status} · ${r.model || ""} · $${(r.cost || 0).toFixed(2)}`, t);
    link(key(path.join(vault, ".claude", "skills", r.skill, "SKILL.md")), n.id);
  }

  return { nodes: [...nodes.values()], links, areas: (map.areas || []).map((a) => a.name), builtAt: Date.now() };
}

module.exports = { buildBrain };
