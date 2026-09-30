---
name: inbox-brief
description: Triage the last 24 hours of Gmail, summarize what matters, and create draft replies (never sent) for threads that need an answer. Use for "inbox brief", "triage my email", "draft my replies".
---

# Inbox Brief

1. Search Gmail for `in:inbox newer_than:1d`. Skip newsletters, promotions and automated notifications unless they are about security, money or an exchange account.
2. Classify each remaining thread: **needs reply** / **FYI** / **ignore**.
3. For up to 5 **needs reply** threads: read the thread and create a concise draft reply with the Gmail draft tool, in the thread's language, as a reply in that thread. Drafts only — never send, delete, archive, label or mark anything.
4. Save the summary to `output/drafts/YYYY-MM-DD-inbox-brief.md` (create the folder if needed).

Reply in Persian: one line per thread — sender — subject — category — action taken (draft created / none) — then a one-line overall summary.
