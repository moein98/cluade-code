// UI strings (English / Persian) and locale-aware formatting, shared by the dashboard and widget.
// The language is a server setting (POST /api/settings), so the dashboard, widget and tray agree.
const I18N = (() => {
  const S = {
    en: {
      vault: "VAULT", plan: "PLAN", limits: "LIMITS", live: "LIVE", est: "EST", permissions: "PERMISSIONS",
      liveTip: "Usage from claude.ai (same as /usage)",
      claudeCode: "CLAUDE CODE", vaultBtn: "VAULT", dailyNote: "DAILY NOTE", runsFolder: "RUNS FOLDER",
      drafts: "DRAFTS", widget: "WIDGET",
      fiveHour: "5-HOUR WINDOW", weekly: "WEEKLY WINDOW", routines: "ROUTINES", resets: "RESETS",
      sessions: "SESSIONS", today: "TODAY", flat: "FLAT",
      activity: "AGENTIC OS · CUMULATIVE ACTIVITY · 30D", day: "DAY", total: "TOTAL",
      integrations: "INTEGRATIONS", checking: "CHECKING…", noneConnected: "NONE CONNECTED",
      lastRun: "LAST RUN", idle: "IDLE", noRunsPick: "NO RUNS YET · PICK A SKILL BELOW", noRuns: "NO RUNS YET",
      openInObsidian: "OPEN IN OBSIDIAN", started: "STARTED", in: "IN", out: "OUT",
      COMPLETE: "COMPLETE", RUNNING: "RUNNING", FAILED: "FAILED", manual: "MANUAL", schedule: "SCHEDULE",
      recentRuns: "RECENT RUNS", skills: "SKILLS", skillsNote: "{n} SKILLS · CLICK TO RUN HEADLESS",
      noSkills: "NO SKILLS FOUND IN VAULT/.CLAUDE/SKILLS",
      onDemand: "ON DEMAND", daily: "DAILY", run: "▸ RUN",
      upcoming: "UPCOMING · 24H", nothingScheduled: "NOTHING SCHEDULED", inTime: "IN {d}", cloud: "CLOUD",
      changes: "VAULT CHANGES · 48H", noChanges: "NO CHANGES",
      cancel: "CANCEL", runHeadless: "RUN HEADLESS", startedOn: "{label} started on {model} — running headless",
      offline: "Dashboard offline: {e}", next: "NEXT", clickToRun: "CLICK TO RUN",
      offlineTitle: "DASHBOARD OFFLINE", offlineText: "The Agentic OS server is not reachable.",
      openDashboard: "Open dashboard", hideWidget: "Hide widget", defaultModel: "DEFAULT",
      inbox: "INBOX", inboxNew: "{n} NEW", markAllRead: "MARK ALL READ", inboxEmpty: "NOTHING NEW",
      usageTitle: "SKILL USAGE · 30D", colSkill: "SKILL", colRuns7: "RUNS 7D", colCost7: "COST 7D",
      colCost30: "COST 30D", noUsage: "NO RUNS IN THE LAST 30 DAYS",
      quotaConfirm: "{window} usage is at {pct}% (guard {max}%). Run anyway?",
      quotaBlocked: "Quota guard: {reason}", deferred: "DEFERRED · QUOTA", watch: "NEW FILE",
      windows: { "5-hour": "5-hour", weekly: "weekly" },
      kinds: { run: "RUN", output: "OUTPUT", "raw/market": "MARKET", "raw/research": "RESEARCH" },
      telegram: "TELEGRAM", remote: "REMOTE CONTROL", newSkill: "+ NEW SKILL",
      feedbackTitle: "FEEDBACK · {label}", feedbackHint: "What should be better next time? (optional for 👍)",
      send: "SEND", feedbackSaved: "Feedback saved — the skill reads it on its next run",
      qualityPass: "QUALITY ✓", qualityFail: "NEEDS REVIEW", qualityPending: "CHECKING QUALITY…",
      sessionsTitle: "CLAUDE CODE SESSIONS", sessionsSearch: "Search conversations…", resume: "▸ RESUME", noSessions: "NO SESSIONS",
      claudeTitle: "CLAUDE PROJECTS & SESSIONS", cpProjects: "PROJECTS · OBSIDIAN PAGES", cpSessions: "SESSIONS · BOTH COMPUTERS",
      cpAll: "ALL", cpThis: "THIS PC", cpOld: "OLD PC", cpNoProject: "NO PAGE", cpSessionsN: "{n} sessions", cpOpenHint: "Click: open in Obsidian",
      cpLoose: "{n} sessions without a project page — add path: or aliases: to a page in wiki/projects to link them", projects: "PROJECTS", recentSessions: "SESSIONS",
      searchTitle: "SEARCH VAULT", searchPlaceholder: "Search notes…", noResults: "NO RESULTS",
      builderTitle: "NEW SKILL", bName: "NAME (english, e.g. weekly-plan)", bLabel: "PERSIAN NAME", bDomain: "DOMAIN",
      bDescription: "WHEN TO USE IT (one sentence)", bInstructions: "INSTRUCTIONS (what the skill should do)",
      bSchedule: "TIME (optional, HH:MM)", bDays: "DAYS (none = every day)", bTier: "MODEL", bTools: "TOOLS",
      create: "CREATE", created: "Skill created: {name}",
      brain: "BRAIN", backToDash: "← DASHBOARD", names: "NAMES", motion: "MOTION", fit: "FIT", open: "OPEN",
      copyPath: "COPY PATH", flyTo: "FLY TO", copied: "Copied", brainSearch: "Search the map…",
      timelineRuns: "RUNS BY DAY", timelineFiles: "FILES BY LAST CHANGE", mapChecked: "Memory map: {result}", indexing: "Updating the search index in the background…",
      modes: { rings: "RINGS", circle: "CIRCLE", areas: "AREAS", links: "LINKS", timeline: "TIMELINE", orbit: "ORBIT" },
      kindNames: { root: "ROOT", area: "AREA", project: "PROJECT", skill: "SKILL", routine: "ROUTINE", memory: "MEMORY", note: "NOTE", run: "RUN" },
      dur: (d, h, m) => (d ? `${d}D ${h}H` : `${h}H ${String(m).padStart(2, "0")}M`),
      durShort: (d, h, m) => (d ? `${d}D ${h}H` : `${h}H ${String(m).padStart(2, "0")}M`),
      days: { sun: "SUN", mon: "MON", tue: "TUE", wed: "WED", thu: "THU", fri: "FRI", sat: "SAT" },
      domains: {},
      tiers: {},
    },
    fa: {
      vault: "مخزن", plan: "پلن", limits: "سقف‌ها", live: "زنده", est: "تخمینی", permissions: "دسترسی",
      liveTip: "مصرف از claude.ai (همان عدد ‎/usage‎)",
      claudeCode: "Claude Code", vaultBtn: "مخزن", dailyNote: "یادداشت روزانه", runsFolder: "پوشهٔ اجراها",
      drafts: "پیش‌نویس‌ها", widget: "ویجت",
      fiveHour: "پنجرهٔ ۵ ساعته", weekly: "پنجرهٔ هفتگی", routines: "روتین‌ها", resets: "ریست",
      sessions: "جلسه", today: "امروز", flat: "ثابت",
      activity: "AGENTIC OS · فعالیت تجمعی · ۳۰ روز", day: "روز", total: "مجموع",
      integrations: "اتصال‌ها", checking: "در حال بررسی…", noneConnected: "اتصالی نیست",
      lastRun: "آخرین اجرا", idle: "بیکار", noRunsPick: "هنوز اجرایی نیست · یک مهارت را از پایین انتخاب کن",
      noRuns: "هنوز اجرایی نیست",
      openInObsidian: "باز کردن در Obsidian", started: "شروع", in: "ورودی", out: "خروجی",
      COMPLETE: "انجام شد", RUNNING: "در حال اجرا", FAILED: "ناموفق", manual: "دستی", schedule: "زمان‌بندی",
      recentRuns: "اجراهای اخیر", skills: "مهارت‌ها", skillsNote: "{n} مهارت · کلیک برای اجرا در پس‌زمینه",
      noSkills: "مهارتی در ‎.claude/skills‎ مخزن پیدا نشد",
      onDemand: "دستی", daily: "روزانه", run: "▸ اجرا",
      upcoming: "برنامهٔ ۲۴ ساعت آینده", nothingScheduled: "چیزی زمان‌بندی نشده", inTime: "{d} دیگر", cloud: "ابری",
      changes: "تغییرات مخزن · ۴۸ ساعت", noChanges: "تغییری نیست",
      cancel: "انصراف", runHeadless: "اجرا در پس‌زمینه", startedOn: "{label} با {model} شروع شد — در پس‌زمینه",
      offline: "داشبورد در دسترس نیست: {e}", next: "بعدی", clickToRun: "دوباره کلیک کن",
      offlineTitle: "داشبورد خاموش است", offlineText: "سرور Agentic OS در دسترس نیست.",
      openDashboard: "باز کردن داشبورد", hideWidget: "پنهان کردن ویجت", defaultModel: "پیش‌فرض",
      inbox: "صندوق خروجی‌ها", inboxNew: "{n} تازه", markAllRead: "همه خوانده شد", inboxEmpty: "چیز تازه‌ای نیست",
      usageTitle: "مصرف مهارت‌ها · ۳۰ روز", colSkill: "مهارت", colRuns7: "اجرا ۷ روز", colCost7: "هزینه ۷ روز",
      colCost30: "هزینه ۳۰ روز", noUsage: "در ۳۰ روز گذشته اجرایی نبوده",
      quotaConfirm: "مصرف {window} به {pct}٪ رسیده (حد محافظ {max}٪). باز هم اجرا شود؟",
      quotaBlocked: "محافظ سهمیه: {reason}", deferred: "عقب افتاد · سهمیه", watch: "فایل جدید",
      windows: { "5-hour": "۵ ساعته", weekly: "هفتگی" },
      kinds: { run: "اجرا", output: "خروجی", "raw/market": "بازار", "raw/research": "تحقیق" },
      telegram: "تلگرام", remote: "کنترل از گوشی", newSkill: "+ مهارت جدید",
      feedbackTitle: "بازخورد · {label}", feedbackHint: "دفعهٔ بعد چه چیزی بهتر باشد؟ (برای 👍 اختیاری)",
      send: "ارسال", feedbackSaved: "بازخورد ذخیره شد — مهارت در اجرای بعدی آن را می‌خواند",
      qualityPass: "کیفیت ✓", qualityFail: "نیاز به بازبینی", qualityPending: "در حال بررسی کیفیت…",
      sessionsTitle: "جلسه‌های Claude Code", sessionsSearch: "جست‌وجو در گفت‌وگوها…", resume: "▸ ادامه", noSessions: "جلسه‌ای نیست",
      claudeTitle: "پروژه‌ها و جلسه‌های Claude", cpProjects: "پروژه‌ها · صفحه‌های Obsidian", cpSessions: "جلسه‌ها · هر دو کامپیوتر",
      cpAll: "همه", cpThis: "این کامپیوتر", cpOld: "کامپیوتر قدیمی", cpNoProject: "بدون صفحه", cpSessionsN: "{n} جلسه", cpOpenHint: "کلیک: باز کردن در Obsidian",
      cpLoose: "{n} جلسه صفحهٔ پروژه ندارند — برای وصل کردن، path: یا aliases: را در صفحهٔ wiki/projects بگذار", projects: "پروژه‌ها", recentSessions: "جلسه‌ها",
      searchTitle: "جست‌وجو در مخزن", searchPlaceholder: "جست‌وجو در یادداشت‌ها…", noResults: "نتیجه‌ای نیست",
      builderTitle: "مهارت جدید", bName: "نام انگلیسی (مثلاً weekly-plan)", bLabel: "نام فارسی", bDomain: "حوزه",
      bDescription: "کاربرد (یک جمله: کِی استفاده شود)", bInstructions: "دستورالعمل (مهارت دقیقاً چه کند)",
      bSchedule: "ساعت (اختیاری، HH:MM)", bDays: "روزها (هیچ‌کدام = هر روز)", bTier: "مدل", bTools: "ابزارها",
      create: "ساختن", created: "مهارت ساخته شد: {name}",
      brain: "نقشهٔ مغز", backToDash: "← داشبورد", names: "نام‌ها", motion: "حرکت", fit: "جا دادن", open: "باز کردن",
      copyPath: "کپی مسیر", flyTo: "برو", copied: "کپی شد", brainSearch: "جست‌وجو در نقشه…",
      timelineRuns: "اجراها بر اساس روز", timelineFiles: "فایل‌ها بر اساس آخرین تغییر", mapChecked: "نقشهٔ حافظه: {result}", indexing: "نمایهٔ جست‌وجو در پس‌زمینه به‌روز می‌شود…",
      modes: { rings: "حلقه‌ها", circle: "دایره", areas: "حوزه‌ها", links: "پیوندها", timeline: "زمان", orbit: "مدار" },
      kindNames: { root: "ریشه", area: "حوزه", project: "پروژه", skill: "مهارت", routine: "روتین", memory: "حافظه", note: "یادداشت", run: "اجرا" },
      dur: (d, h, m) => (d ? `${d} روز و ${h} ساعت` : h ? `${h} ساعت و ${m} دقیقه` : `${m} دقیقه`),
      durShort: (d, h, m) => (d ? `${d} روز ${h} س` : `${h} س ${m} د`),
      days: { sun: "یکشنبه", mon: "دوشنبه", tue: "سه‌شنبه", wed: "چهارشنبه", thu: "پنجشنبه", fri: "جمعه", sat: "شنبه" },
      domains: {
        Memory: "حافظه", Productivity: "بهره‌وری", Research: "تحقیق", Trading: "معامله‌گری", Projects: "پروژه‌ها", Other: "سایر",
        "Dev tools": "ابزارهای توسعه", Personal: "شخصی", Vault: "مخزن", core: "هسته",
      },
      tiers: { light: "سبک", standard: "استاندارد", heavy: "سنگین" },
    },
  };
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  // Jalali dates with Latin digits, e.g. "9 مهر"
  const jalali = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", { day: "numeric", month: "long" });

  let lang = "en";
  const pad = (n) => String(n).padStart(2, "0");

  function t(key, vars) {
    let s = (S[lang] && S[lang][key]) ?? S.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  }

  function set(next) {
    lang = S[next] ? next : "en";
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
    document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    document.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
    document.querySelectorAll("[data-lang]").forEach((el) => el.setAttribute("aria-pressed", el.dataset.lang === lang));
  }

  const hm = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  function dur(ms, short) {
    if (ms == null) return "—";
    const m = Math.max(0, Math.round(ms / 60000));
    return S[lang][short ? "durShort" : "dur"](Math.floor(m / 1440), Math.floor((m % 1440) / 60), m % 60);
  }
  // "2026-10-01" -> "OCT 01" / "9 مهر"
  function dayLabel(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return lang === "fa" ? jalali.format(new Date(y, m - 1, d)) : `${MONTHS[m - 1]} ${pad(d)}`;
  }
  function when(ts) {
    const d = new Date(ts);
    if (d.toDateString() === new Date().toDateString()) return `${t("today")} ${hm(ts)}`;
    return lang === "fa" ? `${jalali.format(d)} ${hm(ts)}` : `${MONTHS[d.getMonth()]} ${pad(d.getDate())} ${hm(ts)}`;
  }
  const dayName = (d) => S[lang].days[d] || d.toUpperCase();
  const domain = (d) => S[lang].domains[d] || d;
  const tier = (x) => S[lang].tiers[x] || String(x || "").toUpperCase();
  const kind = (k) => S[lang].kinds[k] || String(k || "").toUpperCase();
  const windowName = (w) => S[lang].windows[w] || w;
  // Skill display name: a translation from config (skill.labels.fa) when there is one.
  const skillLabel = (skill, fallback) => (skill && skill.labels && skill.labels[lang]) || (skill && skill.label) || fallback || "";

  return { t, set, lang: () => lang, hm, dur, dayLabel, when, dayName, domain, tier, kind, windowName, skillLabel };
})();
