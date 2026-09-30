---
name: morning-brief
description: Build today's morning briefing from Google Calendar, important unread Gmail, today's market scan and open loops in the vault, and write it into today's daily note. Use for "morning brief", "brief me", "what's on today".
---

# Morning Brief

Gather first, then write one briefing in Persian. Times are Asia/Tehran.

## Gather

1. **Calendar** — today's events across calendars (Google Calendar tools). If the tools are unavailable, say so in the brief and continue.
2. **Email** — Gmail threads from the last 24 hours that are unread and matter: real people, anything needing action, exchange/financial/security alerts. Read-only: never send, draft, label, archive or delete.
3. **Market** — today's `raw/market/YYYY-MM-DD-market-scan.md`, if it exists.
4. **Vault** — `index.md`, `wiki/personal/Goals.md`, `wiki/personal/Ideas Inbox.md`, the last ~10 entries of `log.md`, and the daily notes of the last 3 days (`YYYY-MM-DD.md` in the vault root).
5. **Yesterday's runs** — file names under `dashboard-runs/<yesterday>/`; note any failed ones (`status: failed` in frontmatter).

## Write

Sections, in this order:

- `### 📅 امروز` — events with times
- `### 📬 ایمیل‌های مهم` — at most 5; one line each: sender — subject — what's needed
- `### 📈 بازار` — 2–3 lines from today's market scan (skip if none)
- `### 🔁 کارهای باز` — open loops and TODOs from recent notes and the log
- `### 🎯 سه تمرکز امروز` — three concrete focus items, tied to Goals

Put it under a `## Morning Brief` heading in today's daily note (the path is given in the prompt; otherwise `YYYY-MM-DD.md` in the vault root — create it if missing). If that heading already exists today, replace that section instead of adding a second one. Don't touch any other file.

Final reply: the same briefing.
