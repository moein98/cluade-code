// Small Markdown → HTML converter for report cards: the subset that skills write (headings,
// lists, tasks, tables, quotes and Obsidian callouts, code, links, bold/italic). Everything is
// escaped first; only the tags made here reach the page. Also: Markdown → Telegram HTML for the
// text fallback, and helpers for frontmatter and sections.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A leading emoji (with variation selectors / ZWJ sequences) is split off headings for the icon tile.
const EMOJI_RE = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍(?:\p{Extended_Pictographic})|\p{Emoji_Modifier}|\p{Regional_Indicator})*)\s*/u;
function splitEmoji(s) {
  const m = String(s).match(EMOJI_RE);
  return m ? { emoji: m[1], text: s.slice(m[0].length) } : { emoji: "", text: s };
}

const isRtl = (s) => /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(s);

function frontmatter(md) {
  const m = String(md || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: String(md || "").trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, "");
    meta[kv[1]] = v;
  }
  return { meta, body: md.slice(m[0].length).trim() };
}

// Inline: code, links, wiki links, bold, italic, strike, highlight, #tags.
function inline(s) {
  const codes = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<span class="wl">$2</span>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="wl">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/==([^=]+)==/g, "<mark>$1</mark>")
    .replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, '$1<span class="tag">#$2</span>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

// "Source — rest" list items get the source as a small pill (e.g. "ClickUp — 3 overdue tasks").
function listItem(text) {
  const m = text.match(/^([^—:]{1,28}?)\s+[—–]\s+(.+)$/);
  if (m && !/[.!?؟]$/.test(m[1])) return `<span class="src">${inline(m[1])}</span>${inline(m[2])}`;
  return inline(text);
}

const CALLOUTS = {
  note: "📝", info: "ℹ️", tip: "💡", success: "✅", question: "❓", warning: "⚠️",
  danger: "⛔", bug: "🐞", example: "📌", quote: "💬", abstract: "📋", summary: "📋", todo: "☑️", decision: "⚖️",
};

function table(rows) {
  const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const align = cells(rows[1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "end" : ""));
  const td = (c, i, tag) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ""}>${inline(c)}</${tag}>`;
  return `<table><thead><tr>${head.map((c, i) => td(c, i, "th")).join("")}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c, i) => td(c, i, "td")).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

// Block-level conversion of one section body.
function blocks(md) {
  const lines = String(md).replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // fenced code
    if (/^```/.test(line)) {
      const buf = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      out.push(`<pre dir="ltr"><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    // heading inside a section
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const { emoji, text } = splitEmoji(m[2]);
      out.push(`<h4>${emoji ? `<span class="e">${emoji}</span>` : ""}${inline(text)}</h4>`);
      i++;
      continue;
    }
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    // table
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++].trim());
      out.push(table(rows));
      continue;
    }
    // quote / callout
    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      const c = buf[0].match(/^\[!(\w+)\][+-]?\s*(.*)$/);
      if (c) {
        const kind = c[1].toLowerCase();
        const title = c[2] || kind.charAt(0).toUpperCase() + kind.slice(1);
        out.push(
          `<div class="callout c-${esc(kind)}"><div class="ct"><span>${CALLOUTS[kind] || "📌"}</span>${inline(title)}</div>${blocks(buf.slice(1).join("\n"))}</div>`
        );
      } else out.push(`<blockquote>${blocks(buf.join("\n"))}</blockquote>`);
      continue;
    }
    // lists (one level of nesting by indentation)
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i++];
        const lm = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!lm) {
          items[items.length - 1].text += " " + l.trim();
          continue;
        }
        if (lm[1].length >= 2 && items.length) items[items.length - 1].sub.push(lm[3]);
        else items.push({ text: lm[3], sub: [] });
      }
      const li = (t) => {
        const task = t.match(/^\[( |x|X)\]\s+(.*)$/);
        if (task) return `<li class="task${task[1] === " " ? "" : " done"}"><i></i><span>${listItem(task[2])}</span></li>`;
        return `<li><span>${listItem(t)}</span></li>`;
      };
      const tag = ordered ? "ol" : "ul";
      out.push(
        `<${tag}>${items
          .map((it) => {
            const sub = it.sub.length ? `<ul class="sub">${it.sub.map(li).join("")}</ul>` : "";
            return li(it.text).replace(/<\/li>$/, `${sub}</li>`);
          })
          .join("")}</${tag}>`
      );
      continue;
    }
    // paragraph
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s+|\s*\|)/.test(lines[i]) &&
      !/^(\*{3,}|-{3,}|_{3,})\s*$/.test(lines[i])
    )
      buf.push(lines[i++].trim());
    if (buf.length) out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
    else i++;
  }
  return out.join("\n");
}

// Splits a report body into { title, intro, sections: [{ emoji, title, html }] }. A leading H1
// becomes the title; H2/H3 start sections (whichever level the report uses on top).
function sections(body) {
  let md = String(body || "").trim();
  let title = "";
  const h1 = md.match(/^#\s+(.+)\n?/);
  if (h1) {
    title = h1[1].trim();
    md = md.slice(h1[0].length);
  }
  const level = /^##\s/m.test(md) ? 2 : /^###\s/m.test(md) ? 3 : 0;
  if (!level) return { title, intro: blocks(md), sections: [] };
  const re = new RegExp(`^#{${level}}\\s+(.+)$`, "gm");
  const parts = [];
  let last = 0;
  let head = null;
  let intro = "";
  for (let m; (m = re.exec(md)); ) {
    const chunk = md.slice(last, m.index);
    if (head) parts.push({ ...head, md: chunk });
    else intro = chunk;
    head = splitEmoji(m[1].trim());
    last = m.index + m[0].length;
  }
  if (head) parts.push({ ...head, md: md.slice(last) });
  return {
    title,
    intro: blocks(intro),
    sections: parts.map((p) => ({ emoji: p.emoji, title: p.text, html: blocks(p.md) })),
  };
}

// Markdown → Telegram's HTML subset (b, i, s, code, pre, a, blockquote), for the text fallback.
function toTelegram(md) {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const out = [];
  let inCode = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      out.push(inCode ? "</pre>" : "<pre>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(esc(line));
      continue;
    }
    const tl = (s) =>
      esc(s)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>")
        .replace(/~~([^~]+)~~/g, "<s>$1</s>");
    let m;
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) out.push(`\n<b>${tl(m[1])}</b>`);
    else if ((m = line.match(/^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/))) out.push(`${m[1]}${m[2] === " " ? "☐" : "☑"} ${tl(m[3])}`);
    else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) out.push(`${m[1]}• ${tl(m[2])}`);
    else if ((m = line.match(/^>\s?(.*)$/))) out.push(`┃ ${tl(m[1].replace(/^\[!\w+\][+-]?\s*/, ""))}`);
    else if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) out.push("──────────");
    else out.push(tl(line));
  }
  if (inCode) out.push("</pre>");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = { esc, inline, blocks, sections, frontmatter, splitEmoji, isRtl, toTelegram };
