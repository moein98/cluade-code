// Automatic quality check: after a run, a small model grades the output against the skill's
// `checks` (yes/no criteria from config.json). Runs with no tools, outside the vault, so it
// costs a few thousand Haiku tokens.
const { spawn } = require("child_process");

const MAX_OUTPUT_CHARS = 12000;

function createQuality(cfg, dataDir) {
  const model = (cfg.quality && cfg.quality.model) || (cfg.models && cfg.models.light) || "claude-haiku-4-5";

  function evaluate(skill, output) {
    return new Promise((resolve) => {
      const criteria = skill.checks.map((c, i) => `${i + 1}. ${c}`).join("\n");
      const prompt = [
        "You are grading the output of an automated task. Do not use any tools.",
        "Check the output against each criterion. Answer ONLY with JSON, no other text:",
        '{"pass": true|false, "failed": ["<criterion number>: <one-line reason>", ...]}',
        "pass is true only when every criterion is met.",
        "",
        "Criteria:",
        criteria,
        "",
        "<output>",
        String(output || "").slice(0, MAX_OUTPUT_CHARS),
        "</output>",
      ].join("\n");
      const child = spawn(
        cfg.claudePath || "claude",
        ["-p", "--output-format", "json", "--model", model, "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch"],
        { cwd: dataDir, windowsHide: true, env: { ...process.env, OBSIDIAN_SYNC_INTERVAL_DAYS: "9999" } }
      );
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stdin.on("error", () => {});
      const done = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill();
        done({ pass: null, failed: ["quality check timed out"] });
      }, 3 * 60e3);
      child.on("error", (e) => done({ pass: null, failed: [e.message] }));
      child.on("close", () => {
        try {
          const j = JSON.parse(out.trim());
          const m = /\{[\s\S]*\}/.exec(j.result || "");
          const verdict = JSON.parse(m[0]);
          done({ pass: !!verdict.pass, failed: (verdict.failed || []).slice(0, 10), cost: j.total_cost_usd, model });
        } catch {
          done({ pass: null, failed: ["could not read the grader's answer"] });
        }
      });
      child.stdin.end(prompt);
    });
  }

  return { evaluate };
}

module.exports = { createQuality };
