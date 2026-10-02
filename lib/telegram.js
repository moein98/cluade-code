// Telegram delivery and the bot's small in-chat app, through the Bot API. Uses curl.exe because it
// supports the local SOCKS proxy that Telegram needs from Iran. Reports and notices are sent as
// image cards (lib/card); without a browser to render them they fall back to formatted text.
// Messages that fail to send are queued in data/telegram.json and retried every 10 minutes (for
// example until the VPN is back).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const card = require("./card");

const MAX_CHUNK = 3900; // Telegram's limit is 4096 characters per message
const MAX_CAPTION = 1000; // and 1024 per photo caption
const MAX_QUEUE = 50;
const MAX_TEXTS = 20; // report texts kept for the "full text" button

function createTelegram(cfg, dataDir, opts = {}) {
  const t = cfg.telegram || {};
  const file = path.join(dataDir, "telegram.json");
  let st = { chatId: "", queue: [], texts: {} };
  try {
    st = { ...st, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {}
  st.texts = st.texts || {};
  let lastError = null;
  let lastSent = null;
  let flushing = false;
  const save = () => fs.writeFileSync(file, JSON.stringify(st, null, 1));
  const configured = () => !!(t.enabled && t.botToken);
  const chatId = () => t.chatId || st.chatId;
  const fa = () => (opts.language ? opts.language() === "fa" : true);
  const useCards = () => t.cards !== false && card.available();

  // fields: JSON body, or with files { name: pngBuffer } a multipart form. Every form value goes
  // through a temp file ("name=<file"): curl.exe gets its arguments in the ANSI code page, which
  // would mangle Persian captions.
  function call(method, body, viaProxy, timeoutSec = 30, files) {
    return new Promise((resolve, reject) => {
      const args = ["-s", "-m", String(timeoutSec)];
      let tmp = null;
      if (files) {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aos-tg-"));
        for (const [k, v] of Object.entries(body || {})) {
          if (v == null) continue;
          const f = path.join(tmp, `${k}.txt`);
          fs.writeFileSync(f, typeof v === "string" ? v : JSON.stringify(v), "utf8");
          args.push("-F", `${k}=<${f}`);
        }
        for (const [k, buf] of Object.entries(files)) {
          const f = path.join(tmp, `${k}.png`);
          fs.writeFileSync(f, buf);
          args.push("-F", `${k}=@${f};type=image/png`);
        }
      } else {
        args.push("-H", "Content-Type: application/json", "--data-binary", "@-");
      }
      if (viaProxy) args.push("--proxy", t.proxy);
      args.push(`https://api.telegram.org/bot${t.botToken}/${method}`);
      const p = spawn("curl.exe", args, { windowsHide: true });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("error", reject);
      p.on("close", (code) => {
        if (tmp) fs.rm(tmp, { recursive: true, force: true }, () => {});
        let j = null;
        try {
          j = JSON.parse(out);
        } catch {}
        if (j && j.ok) return resolve(j.result);
        const e = new Error(j ? j.description : `curl exit ${code} (network or proxy unreachable)`);
        e.curlExit = code;
        e.api = !!j; // Telegram answered (bad request), as opposed to a network failure
        reject(e);
      });
      p.stdin.end(files ? "" : JSON.stringify(body || {}));
    });
  }

  // Through the configured proxy; when the proxy fails at the network level (nothing listens:
  // curl exit 7, e.g. the VPN runs in system-wide mode; or it listens but cannot reach Telegram:
  // exit 35/56/28), try a direct connection. Answers from Telegram itself are not retried.
  async function api(method, body, timeoutSec, files) {
    if (!t.proxy) return call(method, body, false, timeoutSec, files);
    try {
      return await call(method, body, true, timeoutSec, files);
    } catch (e) {
      if (e.api) throw e;
      return call(method, body, false, timeoutSec, files);
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

  const esc = card.markdown.esc;
  const stripTags = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const kb = (rows) => (rows ? { inline_keyboard: rows } : undefined);

  // Formatted text; when Telegram rejects the HTML (a tag cut by chunking), the same text as plain.
  async function sendText(chat, html, keyboard) {
    const parts = chunks(html);
    for (let i = 0; i < parts.length; i++) {
      const markup = i === parts.length - 1 ? kb(keyboard) : undefined;
      try {
        await api("sendMessage", { chat_id: chat, text: parts[i], parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup });
      } catch (e) {
        if (!e.api) throw e;
        await api("sendMessage", { chat_id: chat, text: stripTags(parts[i]), disable_web_page_preview: true, reply_markup: markup });
      }
    }
  }

  // One page: a photo with caption and buttons. More: an album (caption on the first page), then
  // a short message that carries the buttons (albums cannot have any).
  async function sendPages(chat, pages, caption, keyboard, footer) {
    const cap = caption.length > MAX_CAPTION ? caption.slice(0, MAX_CAPTION - 1) + "…" : caption;
    if (pages.length === 1) {
      return api("sendPhoto", { chat_id: chat, caption: cap, parse_mode: "HTML", reply_markup: kb(keyboard) }, 90, { photo: pages[0] });
    }
    const files = {};
    const media = pages.slice(0, 10).map((p, i) => {
      files[`p${i}`] = p;
      return { type: "photo", media: `attach://p${i}`, ...(i === 0 ? { caption: cap, parse_mode: "HTML" } : {}) };
    });
    await api("sendMediaGroup", { chat_id: chat, media }, 120, files);
    if (keyboard) await sendText(chat, footer || cap.split("\n")[0], keyboard);
  }

  function rememberText(label, markdown) {
    const id = Date.now().toString(36);
    st.texts[id] = { label, markdown, at: Date.now() };
    const ids = Object.keys(st.texts).sort((a, b) => st.texts[a].at - st.texts[b].at);
    for (const old of ids.slice(0, Math.max(0, ids.length - MAX_TEXTS))) delete st.texts[old];
    save();
    return id;
  }

  const T = (f, e) => (fa() ? f : e);
  const homeButton = () => [{ text: T("🏠 خانه", "🏠 Home"), callback_data: "home" }];

  // A queued item → Telegram. Kinds: report, notice, text (old queue entries are plain { text }).
  async function deliver(chat, item) {
    if (item.kind === "report") {
      const r = item.report;
      const { emoji } = card.pages.look(r.skill, r.domain);
      const head = `${emoji} <b>${esc(r.label || r.skill || "")}</b>`;
      const info = [r.model, r.cost != null ? `$${Number(r.cost).toFixed(2)}` : "", r.source === "cloud" ? "☁️" : ""].filter(Boolean).join(" · ");
      const id = rememberText(r.label, r.markdown);
      const keyboard = [[{ text: T("📝 متن کامل", "📝 Full text"), callback_data: `txt:${id}` }, ...homeButton()]];
      if (useCards()) {
        try {
          const pages = await card.report({ ...r, fa: undefined });
          const more = pages.length > 1 ? `\n${T(`${card.pages.faDigits(pages.length)} صفحه`, `${pages.length} pages`)}` : "";
          return await sendPages(chat, pages, `${head}${info ? `\n${esc(info)}` : ""}${more}`, keyboard, `${head} · ${T("گزارش کامل در بالا", "full report above")}`);
        } catch (e) {
          if (!e.api && e.curlExit != null) throw e; // network: retry later as a card
          console.log(`[telegram] card failed, sending text: ${e.message}`);
        }
      }
      const body = card.markdown.toTelegram(card.markdown.frontmatter(r.markdown).body);
      return sendText(chat, `${head}${info ? `\n<i>${esc(info)}</i>` : ""}\n\n${body}`, [homeButton()]);
    }
    if (item.kind === "notice") {
      const n = item.notice;
      const caption = `${n.emoji || "🔔"} <b>${esc(n.title)}</b>${(n.lines || []).length ? "\n" + n.lines.map((l) => esc(l)).join("\n") : ""}`;
      if (useCards()) {
        try {
          return await sendPages(chat, await card.notice({ ...n, fa: fa() }), caption, null);
        } catch (e) {
          if (!e.api && e.curlExit != null) throw e;
          console.log(`[telegram] card failed, sending text: ${e.message}`);
        }
      }
      return sendText(chat, caption);
    }
    for (const part of chunks(item.text)) await api("sendMessage", { chat_id: chat, text: part, disable_web_page_preview: true });
  }

  async function flush() {
    if (!configured() || flushing || !st.queue.length) return;
    flushing = true;
    try {
      const chat = await resolveChat();
      while (st.queue.length) {
        await deliver(chat, st.queue[0]);
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

  function enqueue(item) {
    if (!configured()) return;
    st.queue.push({ ...item, at: new Date().toISOString() });
    st.queue = st.queue.slice(-MAX_QUEUE);
    save();
    flush();
  }
  const send = (text) => enqueue({ kind: "text", text });
  // { emoji, title, lines[], tone: ok|warn|bad, crumb }
  const notice = (n) => enqueue({ kind: "notice", notice: n });
  // { skill, label, domain, markdown, model, cost, at, source }
  const report = (r) => enqueue({ kind: "report", report: r });

  // Called for every finished local run.
  function onRun(run, label, result, skill) {
    if (!configured()) return;
    // Runs started from Telegram (/run) always answer there.
    const wanted = (t.skills || []).includes(run.skill) || run.trigger === "telegram";
    const ok = run.status === "COMPLETE";
    if (ok && wanted) {
      report({ skill: run.skill, label, domain: skill && skill.domain, markdown: String(result || ""), model: run.model, cost: run.cost ?? 0, at: Date.now() });
    } else if (!ok && (wanted || t.notifyFailures)) {
      notice({ emoji: "❌", title: label, lines: [run.error || T("اجرا ناموفق بود", "failed")], tone: "bad", crumb: T("خطای اجرا", "Run failed") });
    }
  }

  // Called when cloud sync copies a new report into the vault. Off by default: the reports
  // repo's GitHub Action already delivers cloud reports, even with the PC off.
  function onCloudReport(skill, label, text) {
    if (configured() && t.sendCloudReports && (t.skills || []).includes(skill)) {
      report({ skill, label, markdown: String(text || ""), source: "cloud" });
    }
  }

  // ---------- the bot: commands and buttons, answering only the configured chat ----------
  // app.command(text) / app.callback(data) return a reply:
  //   { html, caption, keyboard } a screen (an image card), { text, keyboard } formatted text,
  //   { toast } a short popup for a button, { reportText: id } the stored text of a report.
  let app = null;
  async function show(chat, reply, editMsg) {
    if (!reply) return;
    if (reply.reportText) {
      const r = st.texts[reply.reportText];
      if (!r) return sendText(chat, T("این متن دیگر نگه‌داری نمی‌شود.", "That text is no longer kept."));
      return sendText(chat, `<b>${esc(r.label || "")}</b>\n\n${card.markdown.toTelegram(card.markdown.frontmatter(r.markdown).body)}`);
    }
    if (reply.html && useCards()) {
      try {
        const [png] = await card.screen(reply.html);
        const caption = reply.caption || "";
        if (editMsg && editMsg.photo) {
          const media = { type: "photo", media: "attach://p0", caption, parse_mode: "HTML" };
          try {
            return await api("editMessageMedia", { chat_id: chat, message_id: editMsg.message_id, media, reply_markup: kb(reply.keyboard) }, 60, { p0: png });
          } catch (e) {
            if (!e.api) throw e; // e.g. the message is too old to edit: send a new one
          }
        }
        return await sendPages(chat, [png], caption, reply.keyboard);
      } catch (e) {
        if (!e.api && e.curlExit != null) throw e;
        console.log(`[telegram] screen failed, sending text: ${e.message}`);
      }
    }
    const text = reply.text || reply.caption || "";
    if (editMsg && editMsg.text) {
      try {
        return await api("editMessageText", { chat_id: chat, message_id: editMsg.message_id, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb(reply.keyboard) });
      } catch {}
    }
    if (text) return sendText(chat, text, reply.keyboard);
  }

  let offset = st.offset || 0;
  async function handle(u, chat) {
    if (u.callback_query) {
      const q = u.callback_query;
      if (!q.message || String(q.message.chat.id) !== String(chat)) return;
      let reply;
      try {
        reply = await app.callback(q.data || "");
      } catch (e) {
        reply = { toast: `❌ ${e.message}`.slice(0, 190) };
      }
      await api("answerCallbackQuery", { callback_query_id: q.id, text: reply && reply.toast, show_alert: !!(reply && reply.alert) }).catch(() => {});
      if (reply && (reply.html || reply.text || reply.reportText)) await show(chat, reply, reply.reportText ? null : q.message);
      return;
    }
    const m = u.message;
    if (!m || String(m.chat.id) !== String(chat) || !m.text || !m.text.startsWith("/")) return;
    let reply;
    try {
      reply = await app.command(m.text.trim());
    } catch (e) {
      reply = { text: `❌ ${esc(e.message)}` };
    }
    if (typeof reply === "string") reply = { text: esc(reply) };
    await show(chat, reply);
  }

  async function poll() {
    try {
      const chat = await resolveChat();
      const updates = await callLong({ offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          await handle(u, chat);
        } catch (e) {
          console.log(`[telegram] reply failed: ${e.message}`);
        }
      }
      if (updates.length) {
        st.offset = offset;
        save();
      }
      setTimeout(poll, 500);
    } catch (e) {
      lastError = e.message;
      setTimeout(poll, 60e3); // network/VPN down: back off
    }
  }
  // getUpdates with a server-side wait needs a longer curl timeout than normal calls.
  const callLong = (body) => api("getUpdates", body, 70);

  // The command menu next to the message box.
  function setMenu() {
    const commands = [
      ["start", T("خانه — وضعیت و دکمه‌ها", "Home — status and buttons")],
      ["skills", T("مهارت‌ها و اجرا", "Skills and run")],
      ["inbox", T("خروجی‌های تازه", "New outputs")],
      ["note", T("یادداشت در یادداشت روزانه", "Add to today's note")],
      ["help", T("راهنما", "Help")],
    ].map(([command, description]) => ({ command, description }));
    api("setMyCommands", { commands }).catch((e) => console.log(`[telegram] menu: ${e.message}`));
  }

  function startCommands(handler) {
    if (!configured() || t.commands === false) return;
    app = handler;
    setTimeout(() => {
      setMenu();
      poll();
    }, 5e3);
  }

  setInterval(flush, 10 * 60e3);
  setTimeout(flush, 15e3);

  return {
    send,
    notice,
    report,
    onRun,
    onCloudReport,
    startCommands,
    // A screen from lib/tgapp.js, sent as a new message.
    sendScreen: async (reply) => show(await resolveChat(), reply),
    status: () => ({
      enabled: !!t.enabled,
      configured: configured(),
      hasChat: !!chatId(),
      queued: st.queue.length,
      lastSent,
      error: lastError,
      cards: useCards(),
    }),
  };
}

module.exports = { createTelegram };
