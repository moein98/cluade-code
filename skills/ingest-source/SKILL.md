---
name: ingest-source
description: Ingest new raw source files into the wiki following the CLAUDE.md ingest workflow — source page, entity/concept/topic updates, index.md and log.md. Use when new files land in raw/ or when asked to "ingest", "process this source" or "add this to the wiki".
---

# Ingest Source

The prompt lists the new files under `raw/`. Process each one with the **Ingest workflow** in `CLAUDE.md`. `raw/` is immutable: read it, never edit, move or delete anything in it.

For each file:

1. Read it. Skip it, and say why, if it is empty, a duplicate of a source already in `wiki/sources/`, or not a source at all (for example a stray Untitled note).
2. Create `wiki/sources/<slug>.md` in the source page format from `CLAUDE.md`. The `sources:` frontmatter field is the raw file name.
3. Update existing entity, concept and topic pages that the source clearly bears on. Create a new page only for a recurring, important entity or concept — at most 3 new pages per file. Add backlinks both ways.
4. Add new pages to `index.md` in the right section.

Then append one entry to `log.md`: `## [YYYY-MM-DD] ingest | <titles>`, listing the pages created and updated.

Write wiki pages in the language of the vault's existing pages (mostly Persian, with technical terms in English).

Reply in Persian: per file, one line with what was created or updated; then any contradictions with existing pages that need a human decision.
