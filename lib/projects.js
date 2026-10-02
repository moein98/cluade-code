// Claude projects and sessions from this computer and the old one, linked to Obsidian pages.
//
// Projects are the vault's wiki/projects/*.md pages. A session belongs to a project when its
// working folder is inside the page's `path:` (frontmatter, one path or a list), or else when
// its title or first prompt names the project (page name, `aliases:`, last folder of `path:`).
// Every real session gets a short note in the vault (claudeProjects.notesFolder, default
// claude-sessions/) that links to its project page, so a click in the dashboard or the widget
// opens Obsidian on a page. Automated sessions (skill runs, quality grading, vault-sync
// distilling) are left out. The old computer's sessions were copied into ~/.claude/projects;
// they are told apart by its home folder and by a cut-over date (claudeProjects.oldComputer).
const fs = require("fs");
const path = require("path");
const { frontmatter } = require("./card/markdown");

// Prompts written by programs, not people: Agentic OS skill runs and quality grading, the old
// computer's vault sync ("You are distilling / cataloguing / updating …") and its plumbing tests.
const AUTO = /^(use the [\w-]+ skill|you are |reply with (exactly|only)\b|create the file \.\/scope-test)/i;
// Words too generic to tie a session to a project by name.
const STOP = new Set(["tools", "tool", "project", "projects", "design", "system", "sync", "app", "notes", "code", "claude", "obsidian", "panel", "office", "generator", "hardware", "right", "moein", "persian"]);

const norm = (p) => String(p || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
const unq = (v) => String(v).replace(/\\\\/g, "\\");
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(unq).filter(Boolean);
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const hm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const safeName = (s) =>
  String(s || "")
    .replace(/[\\/:*?"<>|#^[\]\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();

function createProjects(cfg, vault, dataDir, sessions) {
  const c = cfg.claudeProjects || {};
  const folder = c.notesFolder || "claude-sessions";
  const old = c.oldComputer || {};
  const oldHomes = list(old.homes).map(norm);
  const cutover = old.before ? Date.parse(old.before + "T00:00:00") : 0;
  const mapFile = path.join(dataDir, "claude-notes.json");
  let notes = {};
  try {
    notes = JSON.parse(fs.readFileSync(mapFile, "utf8"));
  } catch {}

  const machineOf = (s) => (oldHomes.some((h) => norm(s.cwd).startsWith(h)) || (cutover && s.start < cutover) ? "old" : "this");

  function readProjects() {
    const dir = path.join(vault, "wiki", "projects");
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".md"));
    } catch {}
    return names.map((n) => {
      const name = n.slice(0, -3);
      let meta = {};
      try {
        meta = frontmatter(fs.readFileSync(path.join(dir, n), "utf8")).meta;
      } catch {}
      const paths = list(meta.path);
      const tags = list(meta.tags);
      const keys = new Set(
        [name, ...paths.map((p) => path.win32.basename(p))]
          .map((k) => k.toLowerCase().trim())
          .filter((k) => k.length >= 4 && !STOP.has(k))
      );
      // Aliases are chosen by hand, so short ones count too (e.g. "مچ3").
      for (const a of list(meta.aliases)) if (a.trim().length >= 2) keys.add(a.toLowerCase().trim());
      // Hyphenated page names (KiCad-Hardware-Projects) also match on their parts.
      if (/[-_]/.test(name)) for (const part of name.toLowerCase().split(/[-_]+/)) if (part.length >= 5 && !STOP.has(part)) keys.add(part);
      return {
        name,
        file: `wiki/projects/${n}`,
        status: meta.status || "",
        oldPc: tags.includes("old-pc"),
        paths: paths.map(norm),
        keys: [...keys],
      };
    });
  }

  // Folder match (longest path wins), else a name in the title or first prompt.
  function projectOf(s, projects) {
    const cwd = norm(s.cwd);
    let best = null;
    let len = 0;
    for (const p of projects) {
      for (const pp of p.paths) {
        if ((cwd === pp || cwd.startsWith(pp + "\\")) && pp.length > len) {
          best = p;
          len = pp.length;
        }
      }
    }
    if (best) return best;
    const text = `${s.title}\n${s.firstPrompt}`.toLowerCase();
    let hit = null;
    let hitLen = 0;
    for (const p of projects) for (const k of p.keys) if (k.length > hitLen && text.includes(k)) (hit = p), (hitLen = k.length);
    return hit;
  }

  function noteText(s, project, machine) {
    const label = machine === "old" ? "کامپیوتر قدیمی" : "این کامپیوتر";
    const link = project ? `[[${project.name}]]` : "";
    const prompts = (s.prompts || []).map((p, i) => `${i + 1}. ${p.replace(/\s*\n+\s*/g, " ").replace(/^(#+|>|-)\s/, "")}`).join("\n");
    return `---
type: claude-session
session: ${s.id}
project: "${link}"
machine: ${machine === "old" ? "old-pc" : "this-pc"}
cwd: "${String(s.cwd || "").replace(/\\/g, "\\\\")}"
started: ${day(s.start)} ${hm(s.start)}
ended: ${day(s.end)} ${hm(s.end)}
messages: ${s.messages}
cost: ${(s.cost || 0).toFixed(2)}
model: ${s.model || ""}
tags: [claude-session, ${machine === "old" ? "old-pc" : "this-pc"}]
---

# ${s.title || s.id}

> [!info] جلسهٔ Claude Code · ${label}
> پروژه: ${link || "—"} · پوشه: \`${s.cwd || "—"}\` · ${s.messages} پیام · $${(s.cost || 0).toFixed(2)}
> ${day(s.start)} ${hm(s.start)} تا ${day(s.end)} ${hm(s.end)}

## درخواست‌ها
${prompts || "—"}

## ادامه
در پوشهٔ \`${s.cwd || "—"}\`: \`claude --resume ${s.id}\`

<!-- Written by Agentic OS (lib/projects.js) from ~/.claude/projects. Rewritten when the session changes; a project set here by hand is kept. -->
`;
  }

  // A project link written into a note by hand is kept when the note is rewritten.
  function keptProject(rel, projects) {
    try {
      const meta = frontmatter(fs.readFileSync(path.join(vault, rel), "utf8")).meta;
      const m = String(meta.project || "").match(/\[\[([^\]|]+)/);
      return m ? projects.find((p) => p.name === m[1]) || { name: m[1], file: null } : null;
    } catch {
      return null;
    }
  }

  let last = null;
  let lastAt = 0;
  function build() {
    const projects = readProjects();
    // A resumed or forked session can live in two files with one id: keep the latest (list is newest first).
    const seen = new Set();
    const all = sessions
      .list(5000, { full: true })
      .filter((s) => !AUTO.test(s.firstPrompt || "") && !seen.has(s.id) && seen.add(s.id));
    const dir = path.join(vault, folder);
    let wrote = 0;
    let dirty = false;
    const out = [];
    for (const s of all) {
      const machine = machineOf(s);
      const known = notes[s.id];
      const rel = (known && known.rel) || path.posix.join(folder, `${day(s.start)} ${safeName(s.title) || "session"} ${s.id.slice(0, 8)}.md`);
      const exists = fs.existsSync(path.join(vault, rel));
      let project = projectOf(s, projects);
      let manual = false;
      if (known && exists) {
        // The note's project differs from what was last written: it was changed by hand. Keep it.
        const inNote = keptProject(rel, projects);
        if (known.manual || (inNote ? inNote.name : "") !== known.project) {
          project = inNote;
          manual = true;
        }
      }
      if (!known || known.end !== s.end || !exists) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(vault, rel), noteText(s, project, machine), "utf8");
        wrote++;
      }
      if (!known || known.end !== s.end || known.project !== (project ? project.name : "") || known.manual !== manual) dirty = true;
      notes[s.id] = { rel, end: s.end, project: project ? project.name : "", manual };
      out.push({ id: s.id, title: s.title, cwd: s.cwd, start: s.start, end: s.end, messages: s.messages, cost: s.cost, machine, project: project ? project.name : "", note: rel });
    }
    if (wrote || dirty) fs.writeFileSync(mapFile, JSON.stringify(notes, null, 1));
    if (wrote) console.log(`[projects] ${wrote} session note(s) written`);

    const byProject = new Map();
    for (const s of out) {
      const k = s.project || "";
      if (!byProject.has(k)) byProject.set(k, []);
      byProject.get(k).push(s);
    }
    const rows = projects.map((p) => {
      const ss = byProject.get(p.name) || [];
      const machines = new Set(ss.map((s) => s.machine));
      if (p.oldPc) machines.add("old");
      if (!machines.size) machines.add("this");
      return {
        name: p.name,
        file: p.file,
        status: p.status,
        machines: [...machines],
        sessions: ss.length,
        last: ss.length ? Math.max(...ss.map((s) => s.end)) : 0,
        cost: ss.reduce((a, s) => a + (s.cost || 0), 0),
      };
    });
    rows.sort((a, b) => b.last - a.last || a.name.localeCompare(b.name));
    // Sessions that match no project page, grouped by working folder.
    const loose = new Map();
    for (const s of byProject.get("") || []) {
      const k = s.cwd || "—";
      if (!loose.has(k)) loose.set(k, []);
      loose.get(k).push(s);
    }
    return {
      projects: rows,
      sessions: out,
      unmatched: [...loose].map(([cwd, ss]) => ({ cwd, sessions: ss.length, last: Math.max(...ss.map((s) => s.end)) })).sort((a, b) => b.last - a.last),
      counts: { old: out.filter((s) => s.machine === "old").length, this: out.filter((s) => s.machine === "this").length},
      folder,
    };
  }

  // Cached for a minute; sessions.list() itself only re-reads changed files.
  function state() {
    if (!last || Date.now() - lastAt > 60e3) {
      try {
        last = build();
      } catch (e) {
        console.log(`[projects] ${e.message}`);
        last = last || { projects: [], sessions: [], unmatched: [], counts: { old: 0, this: 0 }, folder };
      }
      lastAt = Date.now();
    }
    return last;
  }

  return { state, refresh: () => ((lastAt = 0), state()) };
}

module.exports = { createProjects };
