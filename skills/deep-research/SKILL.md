---
name: deep-research
description: Multi-source web research on a topic, saved into the vault as raw notes plus a wiki source page following the CLAUDE.md ingest workflow. Use for "deep research", "research X", "look into X for me".
---

# Deep Research

1. **Topic** — take it from the prompt. If there's no real topic (for example the placeholder `<topic here>` is still there), stop and say so.
2. **Search** — 5–10 searches from different angles: primary sources and official docs, recent news, critiques and counter-evidence, data. Fetch the best 5–8 pages. Prefer primary sources and note publication dates. Some sites are blocked from Iran; if a fetch fails, move on to another source.
3. **Raw notes** — write `raw/research/YYYY-MM-DD-<slug>.md`: the question, the source list (title, URL, date), and the key facts with the source for each fact.
4. **Ingest** (per `CLAUDE.md`) — create `wiki/sources/<slug>.md` in the source page format; create or update entity/concept/topic pages only where clearly warranted (at most 3); add the new pages to `index.md`; append `## [YYYY-MM-DD] ingest | <title>` to `log.md`.

Reply in Persian: 5–10 key findings with their sources, open questions, and the list of files written.
