// Copies reports that cloud routines push to GitHub into the vault.
// Reads them straight from the fetched remote refs, so the local working tree is never touched.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

function git(args, cwd) {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, windowsHide: true, timeout: 120e3, maxBuffer: 20e6 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    )
  );
}

function createCloudSync(cfg, repoDir) {
  const sync = cfg.cloudSync || {};
  const status = { lastSync: null, lastCopied: null, error: null };
  let busy = false;

  async function refExists(ref) {
    try {
      await git(["rev-parse", "--verify", "--quiet", ref], repoDir);
      return true;
    } catch {
      return false;
    }
  }

  async function run() {
    if (!sync.enabled || busy) return;
    busy = true;
    try {
      await git(["fetch", "--quiet", "origin"], repoDir);
      for (const branch of sync.branches || ["main"]) {
        const ref = `origin/${branch}`;
        if (!(await refExists(ref))) continue;
        for (const rule of sync.copy || []) {
          let listing = "";
          try {
            listing = await git(["ls-tree", "--name-only", ref, `${rule.from}/`], repoDir);
          } catch {
            continue;
          }
          for (const file of listing.split(/\r?\n/).filter((f) => f.endsWith(".md"))) {
            const name = path.posix.basename(file, ".md");
            const dest = path.join(cfg.vault.path, rule.to, (rule.rename || "{name}.md").replace("{name}", name));
            if (fs.existsSync(dest)) continue;
            const body = await git(["show", `${ref}:${file}`], repoDir);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, body, "utf8");
            status.lastCopied = path.relative(cfg.vault.path, dest).replace(/\\/g, "/");
            console.log(`[cloud] copied ${branch}:${file} -> ${status.lastCopied}`);
          }
        }
      }
      status.lastSync = Date.now();
      status.error = null;
    } catch (e) {
      status.error = e.message.split(/\r?\n/)[0];
      console.log(`[cloud] sync failed: ${status.error}`);
    } finally {
      busy = false;
    }
  }

  if (sync.enabled) {
    setTimeout(run, 10e3);
    setInterval(run, (sync.intervalMin || 15) * 60e3);
  }
  return { run, status: () => ({ enabled: !!sync.enabled, ...status }) };
}

module.exports = { createCloudSync };
