// Copies reports that cloud routines push to GitHub into the vault.
// Reads them straight from the fetched remote refs, so the local working tree is never touched.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// Never prompt: a background sync must not pop up a GitHub login window.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

function git(args, cwd, env = {}) {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, env: { ...GIT_ENV, ...env }, windowsHide: true, timeout: 120e3, maxBuffer: 20e6 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    )
  );
}

// hooks.onCopied(rule, vaultRelPath, text) runs for each newly copied report.
function createCloudSync(cfg, repoDir, hooks = {}) {
  const sync = cfg.cloudSync || {};
  // A separate reports repo (cloudSync.repo, e.g. a private one) gets its own blob-less clone
  // under data/; without it, reports are read from this project's own origin.
  const dir = sync.repo ? path.join(repoDir, "data", "cloud-reports") : repoDir;
  const status = { lastSync: null, lastCopied: null, error: null };
  let busy = false;

  async function refExists(ref) {
    try {
      await git(["rev-parse", "--verify", "--quiet", ref], dir);
      return true;
    } catch {
      return false;
    }
  }

  async function run() {
    if (!sync.enabled || busy) return;
    busy = true;
    try {
      if (sync.repo && !fs.existsSync(path.join(dir, ".git"))) {
        await git(["clone", "--quiet", "--no-checkout", "--filter=blob:none", sync.repo, dir], repoDir);
      }
      await git(["fetch", "--quiet", "origin"], dir);
      for (const branch of sync.branches || ["main"]) {
        const ref = `origin/${branch}`;
        if (!(await refExists(ref))) continue;
        for (const rule of sync.copy || []) {
          let listing = "";
          try {
            listing = await git(["ls-tree", "--name-only", ref, `${rule.from}/`], dir);
          } catch {
            continue;
          }
          for (const file of listing.split(/\r?\n/).filter((f) => f.endsWith(".md"))) {
            const name = path.posix.basename(file, ".md");
            const dest = path.join(cfg.vault.path, rule.to, (rule.rename || "{name}.md").replace("{name}", name));
            if (fs.existsSync(dest)) continue;
            const body = await git(["show", `${ref}:${file}`], dir);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, body, "utf8");
            status.lastCopied = path.relative(cfg.vault.path, dest).replace(/\\/g, "/");
            console.log(`[cloud] copied ${branch}:${file} -> ${status.lastCopied}`);
            if (hooks.onCopied) {
              try {
                hooks.onCopied(rule, status.lastCopied, body);
              } catch (e) {
                console.log(`[cloud] onCopied failed: ${e.message}`);
              }
            }
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

  // Write one file into the reports repo and push it — used for skill learnings that the cloud
  // routines read. Our clone is private to this app, so it is reset to origin/main first.
  async function pushFile(rel, content, message) {
    if (!sync.repo) throw new Error("cloudSync.repo is not set");
    while (busy) await new Promise((r) => setTimeout(r, 500));
    busy = true;
    try {
      if (!fs.existsSync(path.join(dir, ".git"))) {
        await git(["clone", "--quiet", "--filter=blob:none", sync.repo, dir], repoDir);
      }
      await git(["fetch", "--quiet", "origin"], dir);
      await git(["checkout", "--quiet", "-B", "main", "origin/main"], dir);
      if (sync.gitName) await git(["config", "user.name", sync.gitName], dir);
      if (sync.gitEmail) await git(["config", "user.email", sync.gitEmail], dir);
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
      await git(["add", "--", rel], dir);
      if (!(await git(["status", "--porcelain"], dir)).trim()) return false;
      await git(["commit", "--quiet", "-m", message], dir);
      await git(["push", "--quiet", "origin", "main"], dir);
      return true;
    } finally {
      busy = false;
    }
  }

  // Snapshot of the vault (working tree, uncommitted edits included, .gitignore respected) pushed
  // to cloudSync.vaultBranch of the reports repo, so cloud routines (weekly review) can read it
  // while the PC is off. A separate index file is used: the vault's own HEAD and index stay as they are.
  const vaultState = path.join(repoDir, "data", "vault-push.json");
  async function pushVault() {
    if (!sync.repo || !sync.vaultBranch) return false;
    const vault = cfg.vault.path;
    if (!fs.existsSync(path.join(vault, ".git"))) throw new Error("the vault is not a git repository");
    let last = {};
    try {
      last = JSON.parse(fs.readFileSync(vaultState, "utf8"));
    } catch {}
    const index = path.join(repoDir, "cache", "vault-index");
    fs.mkdirSync(path.dirname(index), { recursive: true });
    const env = { GIT_INDEX_FILE: index };
    await git(["add", "-A", "."], vault, env);
    const tree = (await git(["write-tree"], vault, env)).trim();
    if (tree === last.tree) return false;
    const who = { GIT_AUTHOR_NAME: sync.gitName || "Agentic OS", GIT_AUTHOR_EMAIL: sync.gitEmail || "agentic-os@localhost" };
    Object.assign(who, { GIT_COMMITTER_NAME: who.GIT_AUTHOR_NAME, GIT_COMMITTER_EMAIL: who.GIT_AUTHOR_EMAIL });
    const parent = last.commit ? ["-p", last.commit] : [];
    let commit;
    try {
      commit = (await git(["commit-tree", tree, ...parent, "-m", `vault snapshot ${new Date().toISOString()}`], vault, who)).trim();
    } catch {
      commit = (await git(["commit-tree", tree, "-m", `vault snapshot ${new Date().toISOString()}`], vault, who)).trim();
    }
    await git(["push", "--quiet", "--force", sync.repo, `${commit}:refs/heads/${sync.vaultBranch}`], vault);
    fs.writeFileSync(vaultState, JSON.stringify({ tree, commit, at: Date.now() }));
    console.log(`[cloud] vault snapshot pushed to ${sync.vaultBranch}`);
    return true;
  }

  async function tick() {
    await run();
    try {
      await pushVault();
      status.vaultError = null;
    } catch (e) {
      status.vaultError = e.message.split(/\r?\n/)[0];
      console.log(`[cloud] vault push failed: ${status.vaultError}`);
    }
  }

  if (sync.enabled) {
    setTimeout(tick, 10e3);
    setInterval(tick, (sync.intervalMin || 15) * 60e3);
  }
  return { run, pushFile, pushVault, status: () => ({ enabled: !!sync.enabled, ...status }) };
}

module.exports = { createCloudSync };
