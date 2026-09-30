---
name: vault-cleanup
description: Audit this Obsidian vault for broken links, orphan pages, index.md drift, missing frontmatter and Untitled/empty clutter, and return a prioritized cleanup report. Use when asked to clean up, lint, audit or health-check the vault.
---

# Vault Cleanup

A report-only lint pass, following the Lint workflow in `CLAUDE.md`. Never modify, move or delete files — the vault's rule is that lint findings are reported, not auto-fixed.

Skip `.obsidian/`, `.git/`, `.claude/`, `.trash/`, `dashboard-runs/` and `raw/` (raw sources are immutable). Treat `wiki/projects/Jewelry Micro-CNC/` code/config files (non-`.md`) as out of scope.

## Checks

1. **Broken links** — `[[...]]` targets in `wiki/`, `index.md` and root notes that match no file. Match on file name without extension, case-insensitive; strip `|alias` and `#heading`.
2. **Orphans** — `wiki/` pages that no other page links to (`index.md` counts as a link).
3. **Index drift** — `wiki/` pages missing from `index.md`, and `index.md` entries with no page.
4. **Frontmatter** — `wiki/` pages missing the frontmatter block or any of `title`, `type`, `tags`, `created`, `updated`.
5. **Clutter** — empty files and `Untitled*` files (`.md`, `.canvas`, `.base`) in the vault root, with their sizes.
6. **Stale** — `wiki/` pages whose `updated:` is more than 90 days old.
7. **Contradictions** — only ones you notice while reading; don't read every page in full just for this.

## Output

Reply in Persian, as Markdown:

- One-line health summary with a count per check.
- One section per check, file paths as `[[wikilinks]]`. At most 15 items per section; say how many more exist.
- `## پیشنهادهای اصلاح` — prioritized fixes, highest impact first, each one line.

Keep it under ~400 words.
