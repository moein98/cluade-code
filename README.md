# Agentic OS

داشبورد command-center محلی برای Claude Code + vault ابسیدین (`moein brain`) — بازسازی Agentic OS از ویدیوی Chase AI.

## نصب (بعد از clone)

پیش‌نیازها: Windows، [Node.js](https://nodejs.org) 18 یا بالاتر، [Claude Code](https://claude.com/claude-code) لاگین‌شده، یک vault ابسیدین.

1. `config.example.json` را به `config.json` کپی کنید و `vault.path`، `vault.name` (نام vault در Obsidian) و `vault.label` را پر کنید.
2. پوشه‌های داخل `skills\` را به `<vault>\.claude\skills\` کپی کنید. skillها به ساختار vault خود من (`raw/`، `wiki/`، `index.md`، `log.md`) و خروجی فارسی تنظیم شده‌اند؛ برای vault خودتان ویرایش‌شان کنید.
3. `start.cmd` را اجرا کنید.

`config.json` و `data\` (تاریخچهٔ اجراها) در git نیستند.

## اجرا

```
start.cmd            ← سرور را روشن می‌کند و مرورگر را باز می‌کند
```

آدرس: http://127.0.0.1:4747 — فقط Node لازم است، بدون `npm install`.

برای اینکه routineهای زمان‌بندی‌شده خودکار اجرا شوند، سرور باید روشن باشد. برای اجرای خودکار هنگام ورود به ویندوز: `Win+R` → `shell:startup` → یک shortcut از `start-hidden.vbs` آنجا بگذارید (بدون پنجره اجرا می‌شود، لاگ در `data\server.log`).

## ویجت دسکتاپ

```
widget.vbs           ← ویجت شناور (WPF، بدون نصب چیز اضافه)
```

یا دکمهٔ **WIDGET** در داشبورد. اگر سرور خاموش باشد، ویجت خودش روشنش می‌کند.

- کشیدن با موس برای جابه‌جایی (جای ویجت ذخیره می‌شود) · دابل‌کلیک = حالت جمع‌وجور (فقط نوارها)
- کلیک راست: همیشه رو، باز کردن داشبورد/Claude Code/vault/یادداشت روزانه/پوشهٔ اجراها، بستن
- دکمهٔ skill: کلیک اول «CLICK TO RUN» را نشان می‌دهد، کلیک دوم (تا ۴ ثانیه) اجرا می‌کند؛ skillهایی که ورودی می‌خواهند (deep-research) داشبورد را باز می‌کنند
- کلیک روی Last Run = باز شدن گزارش در Obsidian
- برای اجرای خودکار هنگام ورود به ویندوز: یک shortcut از `widget.vbs` در `shell:startup`

## سه لایه

| لایه | کجا |
|---|---|
| Skills (architecture) | `<vault>\.claude\skills\<name>\SKILL.md` |
| Memory | vault: `raw/` → `wiki/` → `output/`، به‌علاوهٔ `dashboard-runs/` |
| Observability | همین داشبورد |

## داشبورد

- **5-HOUR / WEEKLY WINDOW** — توکن‌های مصرفی از لاگ‌های `~/.claude/projects/**/*.jsonl`. سقف‌ها در `config.json → limits` دستی‌اند (Anthropic سقف واقعی را محلی نمی‌دهد). `countCacheReads` تعیین می‌کند cache readها حساب شوند یا نه. برای ریست هفتگی ثابت: `"weeklyReset": {"day": "thu", "hour": 10}`.
- **ROUTINES** — اجراهای امروز / `dailyRunLimit` (۱۵، مثل سقف Routines پلن Max) + هزینهٔ معادل API امروز.
- **CUMULATIVE ACTIVITY** — مجموع تجمعی توکن‌ها در ۳۰ روز (hover برای جزئیات روز).
- **INTEGRATIONS** — از `claude mcp list` (هر ۱۵ دقیقه).
- **LAST RUN / RECENT RUNS** — هر اجرا یک یادداشت در `dashboard-runs/YYYY-MM-DD/HH-MM-<skill>.md`؛ کلیک = باز شدن در Obsidian.
- **SKILLS** — کلیک → prompt قابل ویرایش → `claude -p` headless در vault (`Ctrl+Enter` = اجرا).
- **UPCOMING · 24H / VAULT CHANGES · 48H**

## اضافه کردن skill

1. پوشهٔ `<vault>\.claude\skills\<name>\` با `SKILL.md` (frontmatter: `name`, `description`) بسازید — یا در Claude Code از `/skill-creator` استفاده کنید.
2. در `config.json → skills` یک ورودی اضافه کنید:

```json
{ "name": "<name>", "domain": "Research", "schedule": "09:00", "days": ["sat","sun"],
  "prompt": "Use the <name> skill.", "allowedTools": ["Read", "Glob", "Grep", "WebSearch"] }
```

`schedule` و `days` اختیاری‌اند (بدون آن‌ها = فقط دستی). در prompt می‌توان از `{{date}}`، `{{time}}` و `{{dailyNote}}` استفاده کرد. سرور را ری‌استارت کنید.

skillی که در config نباشد با دسترسی فقط-خواندنی (`Read, Glob, Grep`) زیر دامنهٔ Other نشان داده می‌شود.
