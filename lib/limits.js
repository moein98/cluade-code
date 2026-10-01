// Live plan limits from claude.ai: the same numbers as Claude Code's /usage (5-hour session and
// weekly utilization). Read with the local Claude Code login; the OAuth token stays in this
// process and is only sent to api.anthropic.com.
const fs = require("fs");
const path = require("path");
const os = require("os");

const CREDS = path.join(os.homedir(), ".claude", ".credentials.json");
const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const TTL = 2 * 60e3;

let cache = null;
let fetchedAt = 0;
let inflight = null;
let lastError = null;

function readLogin() {
  try {
    const o = JSON.parse(fs.readFileSync(CREDS, "utf8")).claudeAiOauth;
    return o && o.accessToken ? o : null;
  } catch {
    return null;
  }
}

const windowOf = (w) =>
  w && typeof w.utilization === "number" ? { pct: w.utilization, resetsAt: Date.parse(w.resets_at) } : null;

async function refresh() {
  const login = readLogin();
  try {
    if (!login) throw new Error("no Claude Code login found");
    // Claude Code refreshes this token while it is in use; we never refresh or write credentials.
    if (login.expiresAt && login.expiresAt < Date.now()) throw new Error("login token expired — open Claude Code once");
    const r = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${login.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`usage endpoint HTTP ${r.status}`);
    const j = await r.json();
    cache = { plan: login.subscriptionType || null, fiveHour: windowOf(j.five_hour), weekly: windowOf(j.seven_day) };
    lastError = null;
  } catch (e) {
    lastError = e.message;
  } finally {
    fetchedAt = Date.now();
  }
}

// Last known live limits; refreshes in the background when older than TTL.
// A window whose reset time has passed is dropped until the next refresh.
function live() {
  if (Date.now() - fetchedAt > TTL && !inflight) inflight = refresh().finally(() => (inflight = null));
  if (!cache) return { error: lastError };
  const now = Date.now();
  const fresh = (w) => (w && w.resetsAt > now ? w : null);
  return { plan: cache.plan, fiveHour: fresh(cache.fiveHour), weekly: fresh(cache.weekly), error: lastError };
}

module.exports = { live, refresh };
