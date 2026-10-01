// Learnings loop: feedback (👍/👎 + note) on a skill's output is appended to
// <vault>/.claude/skills/<skill>/learnings.md, which the runner tells the skill to read
// before its next run. Cloud skills get a copy pushed to the reports repo.
const fs = require("fs");
const path = require("path");

const MAX_ENTRIES = 40;
const HEADER =
  "# Learnings\n\nFeedback on earlier runs of this skill, newest last. Keep doing what got 👍; fix what got 👎.\n\n";

function createLearnings(cfg) {
  const file = (skill) => path.join(cfg.vault.path, ".claude", "skills", skill, "learnings.md");

  function add(skill, { rating, note, source, at = new Date() }) {
    if (!/^[\w-]+$/.test(skill)) throw new Error("bad skill name");
    const f = file(skill);
    if (!fs.existsSync(path.dirname(f))) throw new Error(`skill folder not found: ${skill}`);
    const pad = (n) => String(n).padStart(2, "0");
    const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
    const text = String(note || "").replace(/\s+/g, " ").trim().slice(0, 500);
    const line = `- ${day} ${rating === "up" ? "👍" : "👎"}${text ? ` ${text}` : ""}${source ? ` (${source})` : ""}`;
    const old = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : HEADER;
    const entries = old.split("\n").filter((l) => l.startsWith("- "));
    entries.push(line);
    const content = HEADER + entries.slice(-MAX_ENTRIES).join("\n") + "\n";
    fs.writeFileSync(f, content, "utf8");
    return content;
  }

  return { add, read: (skill) => (fs.existsSync(file(skill)) ? fs.readFileSync(file(skill), "utf8") : "") };
}

module.exports = { createLearnings };
