---
name: weekly-review
description: Weekly review of the past 7 days — what got done, decisions, learnings, open TODOs, next week's focus and dashboard run spend — written to output/weekly/. Use for "weekly review", "summarize my week".
---

# Weekly Review

## Read (last 7 days)

- Daily notes (`YYYY-MM-DD.md` in the vault root)
- `log.md` entries
- `wiki/` pages whose `updated:` falls in the week
- `dashboard-runs/*/` notes — frontmatter (`skill`, `status`, `cost_usd`) and the first lines of each
- `wiki/personal/Goals.md`

## Write

`output/weekly/YYYY-Www.md` (ISO week number), with frontmatter:

```yaml
---
title: Weekly Review YYYY-Www
type: synthesis
tags: [weekly-review]
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: []
---
```

Persian sections: `## کارهای انجام‌شده`, `## تصمیم‌ها`, `## یادگیری‌ها`, `## کارهای باز`, `## تمرکز هفته بعد` (3–5 items tied to Goals), `## اجراهای داشبورد` (run count, failures, total cost).

Then append one entry to `log.md`: `## [YYYY-MM-DD] synthesis | Weekly Review YYYY-Www`. Edit nothing else.

Final reply: the review.
