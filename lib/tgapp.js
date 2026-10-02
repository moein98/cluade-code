// The Telegram bot as a small app: every screen is an image card with buttons under it, and a
// button replaces the screen in place (lib/telegram.js edits the same message). Commands still
// work: /start, /status, /skills, /inbox, /run <skill> [force], /note <text>, /help.
const card = require("./card");

// ctx: { state() fresh server state, label(name, fallback), fa(), runSkill(name, force),
//        addNote(text) → vault path, runsOf(name) → recent runs }
function createTgApp(ctx) {
  const P = card.pages;
  const esc = card.markdown.esc;

  function screens() {
    const fa = ctx.fa();
    const T = (f, e) => (fa ? f : e);
    const s = ctx.state();
    const L = ctx.label;
    const home = { text: T("🏠 خانه", "🏠 Home"), callback_data: "home" };
    const pct = (w) => (w && w.pct != null ? `${Math.round(w.pct)}%` : "—");

    return {
      T,
      home: () => ({
        html: P.homePage(s, L, fa),
        caption: `🤖 <b>Agentic OS</b>\n${T("۵ ساعته", "5-hour")} ${pct(s.fiveHour)} · ${T("هفتگی", "weekly")} ${pct(s.weekly)}`,
        text: T(
          `🤖 <b>Agentic OS</b>\n📊 مصرف ۵ ساعته: ${pct(s.fiveHour)} · هفتگی: ${pct(s.weekly)}\nاجرای امروز: ${s.routines.runsToday}\nصندوق: ${s.inbox.count} مورد تازه`,
          `🤖 <b>Agentic OS</b>\n📊 5-hour: ${pct(s.fiveHour)} · weekly: ${pct(s.weekly)}\nRuns today: ${s.routines.runsToday}\nInbox: ${s.inbox.count} new`
        ),
        keyboard: [
          [
            { text: T("🧠 مهارت‌ها", "🧠 Skills"), callback_data: "skills" },
            { text: T(`📬 صندوق${s.inbox.count ? ` (${s.inbox.count})` : ""}`, `📬 Inbox${s.inbox.count ? ` (${s.inbox.count})` : ""}`), callback_data: "inbox" },
          ],
          [
            { text: T("🔄 به‌روزرسانی", "🔄 Refresh"), callback_data: "home" },
            { text: T("❓ راهنما", "❓ Help"), callback_data: "help" },
          ],
        ],
      }),
      skills: () => {
        const btns = s.skills.map((k) => ({ text: `${P.look(k.name, k.domain).emoji} ${L(k.name, k.label)}${k.running ? " ●" : ""}`, callback_data: `sk:${k.name}` }));
        const rows = [];
        for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
        rows.push([home]);
        return {
          html: P.skillsPage(s, L, fa),
          caption: `🧠 <b>${T("مهارت‌ها", "Skills")}</b>`,
          text: `🧠 <b>${T("مهارت‌ها", "Skills")}</b>\n${s.skills.map((k) => `• ${esc(L(k.name, k.label))} — <code>${k.name}</code>`).join("\n")}`,
          keyboard: rows,
        };
      },
      skill: (name) => {
        const k = s.skills.find((x) => x.name === name);
        if (!k) return { toast: T("این مهارت پیدا نشد.", "Skill not found.") };
        const needsTopic = (k.prompt || "").includes("<topic here>");
        const action = k.running
          ? [{ text: T("⏳ در حال اجرا…", "⏳ Running…"), callback_data: `sk:${k.name}` }]
          : needsTopic
          ? [{ text: T("ℹ️ موضوع لازم دارد — از داشبورد", "ℹ️ Needs a topic — use the dashboard"), callback_data: "noop" }]
          : [{ text: T("▶️ اجرا کن", "▶️ Run"), callback_data: `run:${k.name}` }];
        return {
          html: P.skillPage(k, L, fa, ctx.runsOf(k.name)),
          caption: `${P.look(k.name, k.domain).emoji} <b>${esc(L(k.name, k.label))}</b>`,
          text: `${P.look(k.name, k.domain).emoji} <b>${esc(L(k.name, k.label))}</b>\n${esc(k.description || "")}`,
          keyboard: [action, [{ text: T("⬅️ مهارت‌ها", "⬅️ Skills"), callback_data: "skills" }, home]],
        };
      },
      inbox: () => ({
        html: P.inboxPage(s, L, fa),
        caption: `📬 <b>${T("صندوق", "Inbox")}</b>`,
        text: s.inbox.items.length
          ? s.inbox.items.slice(0, 8).map((i) => `• ${esc(i.kind === "run" ? L(i.skill, i.title) : i.title)}`).join("\n")
          : T("چیز تازه‌ای نیست.", "Nothing new."),
        keyboard: [[{ text: T("🔄 به‌روزرسانی", "🔄 Refresh"), callback_data: "inbox" }, home]],
      }),
      help: () => ({
        html: P.helpPage(fa),
        caption: `❓ <b>${T("راهنما", "Help")}</b>`,
        text: T(
          "دستورها:\n/start — خانه\n/skills — مهارت‌ها\n/run &lt;مهارت&gt; — اجرا (با force از محافظ سهمیه رد می‌شود)\n/note &lt;متن&gt; — یادداشت روزانه\n/inbox — موارد تازه",
          "Commands:\n/start — home\n/skills — skills\n/run &lt;skill&gt; — run (add force to bypass the quota guard)\n/note &lt;text&gt; — daily note\n/inbox — new items"
        ),
        keyboard: [[home]],
      }),
    };
  }

  // Starts a run; the result arrives later as a report card.
  function run(name, force) {
    const S = screens();
    const { T } = S;
    const s = ctx.state();
    const k = s.skills.find((x) => x.name === name);
    if (!k) return { error: T(`مهارت «${name}» نیست.`, `No skill "${name}".`) };
    if ((k.prompt || "").includes("<topic here>")) return { error: T("این مهارت موضوع لازم دارد؛ از داشبورد اجرا کن.", "This skill needs a topic; run it from the dashboard.") };
    try {
      ctx.runSkill(name, force);
      return { ok: T(`▶️ ${ctx.label(name)} شروع شد. نتیجه همین‌جا می‌آید.`, `▶️ ${ctx.label(name)} started. The result will come here.`) };
    } catch (e) {
      if (e.code === "QUOTA") return { quota: T(`⛔ محافظ سهمیه: ${e.message}`, `⛔ Quota guard: ${e.message}`) };
      return { error: e.message };
    }
  }

  async function command(text) {
    const [raw, ...args] = text.split(/\s+/);
    const cmd = raw.toLowerCase().replace(/@\S+$/, "");
    const S = screens();
    const { T } = S;
    if (cmd === "/note") {
      const note = text.slice(raw.length).trim();
      if (!note) return { text: T("متن یادداشت را بعد از /note بنویس.", "Write the note after /note.") };
      const rel = ctx.addNote(note);
      return { text: T(`📝 در <code>${esc(rel)}</code> ذخیره شد.`, `📝 Saved to <code>${esc(rel)}</code>.`) };
    }
    if (cmd === "/skills") return S.skills();
    if (cmd === "/inbox") return S.inbox();
    if (cmd === "/help") return S.help();
    if (cmd === "/run") {
      const name = args[0];
      if (!name) return S.skills();
      const r = run(name, args[1] === "force");
      if (r.quota)
        return {
          text: esc(r.quota),
          keyboard: [[{ text: T("⚡ اجرای اجباری", "⚡ Run anyway"), callback_data: `force:${name}` }]],
        };
      return { text: esc(r.ok || `❌ ${r.error}`) };
    }
    return S.home(); // /start, /status, /menu and anything unknown
  }

  async function callback(data) {
    const [what, arg] = [data.split(":")[0], data.slice(data.indexOf(":") + 1)];
    const S = screens();
    const { T } = S;
    switch (what) {
      case "home":
        return { ...S.home(), toast: "" };
      case "skills":
        return S.skills();
      case "inbox":
        return S.inbox();
      case "help":
        return S.help();
      case "sk":
        return S.skill(arg);
      case "txt":
        return { reportText: arg };
      case "run":
      case "force": {
        const r = run(arg, what === "force");
        if (r.quota) return { toast: `${r.quota}\n${T("برای اجرای اجباری: /run", "To force: /run")} ${arg} force`, alert: true };
        if (r.error) return { toast: `❌ ${r.error}`, alert: true };
        return { ...screens().skill(arg), toast: r.ok };
      }
      default:
        return { toast: "" };
    }
  }

  return { command, callback };
}

module.exports = { createTgApp };
