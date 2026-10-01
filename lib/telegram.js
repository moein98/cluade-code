// Sends run results to Telegram through the Bot API. Uses curl.exe because it supports the
// local SOCKS proxy that Telegram needs from Iran. Messages that fail to send are queued in
// data/telegram.json and retried every 10 minutes (for example until the VPN is back).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const MAX_CHUNK = 3900; // Telegram's limit is 4096 characters per message
const MAX_QUEUE = 50;

function createTelegram(cfg, dataDir) {
  const t = cfg.telegram || {};
  const file = path.join(dataDir, "telegram.json");
  let st = { chatId: "", queue: [] };
  try {
    st = { ...st, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {}
  let lastError = null;
  let lastSent = null;
  let flushing = false;
  const save = () => fs.writeFileSync(file, JSON.stringify(st, null, 1));
  const configured = () => !!(t.enabled && t.botToken);
  const chatId = () => t.chatId || st.chatId;

  function call(method, body, viaProxy, timeoutSec = 30) {
    return new Promise((resolve, reject) => {
      const args = ["-s", "-m", String(timeoutSec), "-H", "Content-Type: application/json", "--data-binary", "@-"];
      if (viaProxy) args.push("--proxy", t.proxy);
      args.push(`https://api.telegram.org/bot${t.botToken}/${method}`);
      const p = spawn("curl.exe", args, { windowsHide: true });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("error", reject);
      p.on("close", (code) => {
        let j = null;
        try {
          j = JSON.parse(out);
        } catch {}
        if (j && j.ok) return resolve(j.result);
        const e = new Error(j ? j.description : `curl exit ${code} (network or proxy unreachable)`);
        e.curlExit = code;
        reject(e);
      });
      p.stdin.end(JSON.stringify(body || {}));
    });
  }

  // Through the configured proxy; when nothing listens on it (curl exit 7, e.g. the VPN runs in
  // system-wide mode instead), try a direct connection.
  async function api(method, body, timeoutSec) {
    if (!t.proxy) return call(method, body, false, timeoutSec);
    try {
      return await call(method, body, true, timeoutSec);
    } catch (e) {
      if (e.curlExit !== 7) throw e;
      return call(method, body, false, timeoutSec);
    }
  }

  // Without a configured chat id, use the chat of the latest message sent to the bot (e.g. /start).
  async function resolveChat() {
    if (chatId()) return chatId();
    const updates = await api("getUpdates", { limit: 20 });
    const msg = updates.map((u) => u.message || u.channel_post).filter(Boolean).pop();
    if (!msg) throw new Error("no chat yet — send /start to the bot in Telegram");
    st.chatId = String(msg.chat.id);
    save();
    console.log("[telegram] chat id detected");
    return st.chatId;
  }

  function chunks(text) {
    const out = [];
    let rest = text;
    while (rest.length > MAX_CHUNK) {
      let cut = rest.lastIndexOf("\n", MAX_CHUNK);
      if (cut < MAX_CHUNK / 2) cut = MAX_CHUNK;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, "");
    }
    if (rest.trim()) out.push(rest);
    return out;
  }

  async function flush() {
    if (!configured() || flushing || !st.queue.length) return;
    flushing = true;
    try {
      const chat = await resolveChat();
      while (st.queue.length) {
        for (const part of chunks(st.queue[0].text)) {
          await api("sendMessage", { chat_id: chat, text: part, disable_web_page_preview: true });
        }
        st.queue.shift();
        save();
        lastSent = Date.now();
      }
      lastError = null;
    } catch (e) {
      lastError = e.message;
      console.log(`[telegram] ${e.message} — ${st.queue.length} message(s) queued`);
    } finally {
      flushing = false;
    }
  }

  function send(text) {
    if (!configured()) return;
    st.queue.push({ text, at: new Date().toISOString() });
    st.queue = st.queue.slice(-MAX_QUEUE);
    save();
    flush();
  }

  const stripFrontmatter = (s) => String(s || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

  // Called for every finished local run.
  function onRun(run, label, result) {
    if (!configured()) return;
    // Runs started from Telegram (/run) always answer there.
    const wanted = (t.skills || []).includes(run.skill) || run.trigger === "telegram";
    const ok = run.status === "COMPLETE";
    if (ok && wanted) {
      const head = `✅ ${label}\n${run.model || ""} · $${(run.cost ?? 0).toFixed(2)}`;
      send(`${head}\n\n${stripFrontmatter(result)}`);
    } else if (!ok && (wanted || t.notifyFailures)) {
      send(`❌ ${label}\n${run.error || "failed"}`);
    }
  }

  // Called when cloud sync copies a new report into the vault. Off by default: the reports
  // repo's GitHub Action already delivers cloud reports, even with the PC off.
  function onCloudReport(skill, label, text) {
    if (configured() && t.sendCloudReports && (t.skills || []).includes(skill)) {
      send(`☁️ ${label}\n\n${stripFrontmatter(text)}`);
    }
  }

  // Bot commands (/status, /run …): long polling, answering only the configured chat.
  let offset = st.offset || 0;
  async function poll(handler) {
    try {
      const chat = await resolveChat();
      const updates = await callLong({ offset, timeout: 50, allowed_updates: ["message"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m || String(m.chat.id) !== String(chat) || !m.text || !m.text.startsWith("/")) continue;
        let reply;
        try {
          reply = await handler(m.text.trim());
        } catch (e) {
          reply = `❌ ${e.message}`;
        }
        if (reply) await api("sendMessage", { chat_id: chat, text: reply.slice(0, 4000), disable_web_page_preview: true });
      }
      if (updates.length) {
        st.offset = offset;
        save();
      }
      setTimeout(() => poll(handler), 500);
    } catch (e) {
      lastError = e.message;
      setTimeout(() => poll(handler), 60e3); // network/VPN down: back off
    }
  }
  // getUpdates with a server-side wait needs a longer curl timeout than normal calls.
  const callLong = (body) => api("getUpdates", body, 70);

  function startCommands(handler) {
    if (configured() && t.commands !== false) setTimeout(() => poll(handler), 5e3);
  }

  setInterval(flush, 10 * 60e3);
  setTimeout(flush, 15e3);

  return {
    send,
    onRun,
    onCloudReport,
    startCommands,
    status: () => ({
      enabled: !!t.enabled,
      configured: configured(),
      hasChat: !!chatId(),
      queued: st.queue.length,
      lastSent,
      error: lastError,
    }),
  };
}

module.exports = { createTelegram };
