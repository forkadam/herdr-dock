// A reply (or a Markdown file) cut into the blocks the Render panel draws, each with its copy buttons (pure; no host
// imports). Pictures (```mermaid, ```figure) are found by splitSegments as before, so their ids don't change; the rest
// is read with marked (MIT). The buttons follow prismantis (https://github.com/NahumLitvin/prismantis, MIT): a table's
// md / art / html, copy on code, lists, quotes and alerts, copy source on a picture, copy md / copy html on a reply.
//
// Button: { label, text, html? }   (html only on a formatted copy; text is then its plain side)
// Every block also carries `bytes` (its Markdown's UTF-8 length, for the panel's budget) and what the panel draws:
// text `parts` (headings, paragraphs as runs, rules, HTML as text), list `items` (marker + blocks), quote and alert
// `blocks`, table `header` / `rows` (runs) / `align` / `natural` / `words`, code `lines` (coloured runs).
// Block:  { kind: "text" | "table" | "code" | "list" | "quote" | "alert", md, lang?, alert?, buttons }
//       | { kind: "mermaid" | "figure", source, id, buttons }
import { marked } from "marked";
import { splitSegments } from "./markdown.js";
import { tableArt, tableText, width } from "./table-copy.js";
import { pieces } from "./view.js";
import { inlineRuns } from "./runs.js";
import { codeLines } from "./code-colour.js";
import { applyFootnotes } from "./footnotes.js";

const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const OPTIONS = { gfm: true };

// Code as a fenced block, whatever it was written as (an indented block loses its indent once cut out): the fence is
// longer than any run of backticks inside.
export function fenced(code, lang) {
  const fence = "`".repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map((r) => r.length + 1)));
  return `${fence}${lang}\n${code}\n${fence}`;
}

const bytes = (s) => new TextEncoder().encode(String(s ?? "")).length;
// What a block costs the panel to draw, in prose-byte units: code makes about twice the pieces per byte and a table
// about three times (measured), so the budget counts them so.
export const COST_WEIGHT = { code: 2, table: 3 };
const withBytes = (b) => {
  const n = bytes(b.kind === "mermaid" || b.kind === "figure" ? b.source : b.md);
  return { ...b, bytes: n, cost: n * (COST_WEIGHT[b.kind] ?? 1) };
};

// Per column, from the cells as drawn: the widest cell's width and its longest piece (a code span is one piece; a
// link counts its text, not its address).
function drawnSizes(header, rows) {
  const cells = [header, ...rows];
  const column = (measure) => header.map((_, c) => Math.max(0, ...cells.map((r) => measure(r[c] ?? []))));
  return {
    natural: column((runs) => width(runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim())),
    words: column((runs) => Math.max(0, ...pieces(runs).map((p) => width(p.text.trim())))),
  };
}

// A text token -> what the panel draws for it (null: nothing to draw, e.g. blank space or a link definition).
function textPart(token) {
  switch (token.type) {
    case "heading": return { type: "heading", level: token.depth, runs: inlineRuns(token.tokens) };
    case "paragraph": return { type: "para", runs: inlineRuns(token.tokens) };
    case "text": return { type: "para", runs: inlineRuns(token.tokens ?? [{ type: "text", text: token.text }]) };
    case "hr": return { type: "rule" };
    case "html": { const text = String(token.raw ?? "").trim(); return text ? { type: "html", text } : null; }
    default: return null;
  }
}

const listMarker = (list, item, i) => (item.task ? (item.checked ? "☑" : "☐")
  : list.ordered ? `${(list.start === "" || list.start == null ? 1 : Number(list.start)) + i}.` : "•");

// marked block tokens -> Block[] (used for a reply and, recursively, for list items, quotes and alerts).
function tokenBlocks(tokens) {
  const out = [];
  let run = "";
  let parts = [];
  const flush = () => {
    const md = run.trim();
    if (md || parts.length) out.push(withBytes({ kind: "text", md, parts, buttons: md ? [{ label: "copy", text: md }] : [] }));
    run = "";
    parts = [];
  };
  for (const token of tokens) {
    const raw = String(token.raw ?? "");
    if (token.type === "table") {
      flush();
      out.push(withBytes({
        kind: "table", md: raw.trim(),
        ...(() => {
          const header = token.header.map((c) => inlineRuns(c.tokens));
          const rows = token.rows.map((r) => r.map((c) => inlineRuns(c.tokens)));
          return { header, rows, ...drawnSizes(header, rows) };
        })(),
        align: token.align.map((a) => a ?? null),
        buttons: [
          { label: "md", text: raw.trim() },
          { label: "art", text: tableArt(token) },
          { label: "html", text: tableText(token), html: marked.parser([token], OPTIONS) },
        ],
      }));
    } else if (token.type === "code") {
      flush();
      const lang = String(token.lang ?? "").trim().split(/\s+/)[0];
      out.push(withBytes({ kind: "code", md: fenced(token.text, lang), lang, lines: codeLines(token.text, lang), buttons: [{ label: "copy", text: token.text }] }));
    } else if (token.type === "list") {
      flush();
      out.push(withBytes({
        kind: "list", md: raw.trim(), buttons: [{ label: "copy", text: raw.trim() }],
        items: token.items.map((item, i) => ({
          marker: listMarker(token, item, i),
          blocks: tokenBlocks((item.tokens ?? []).filter((x) => x.type !== "checkbox")),
        })),
      }));
    } else if (token.type === "blockquote") {
      flush();
      const body = String(token.text ?? "");
      const alert = ALERT.exec(body);
      if (alert) {
        const md = body.slice(alert[0].length).trim();
        out.push(withBytes({ kind: "alert", alert: alert[1].toLowerCase(), md, blocks: tokenBlocks(marked.lexer(md, OPTIONS)), buttons: [{ label: "copy", text: md }] }));
      } else {
        out.push(withBytes({ kind: "quote", md: raw.trim(), blocks: tokenBlocks(token.tokens ?? []), buttons: [{ label: "copy", text: body.trim() }] }));
      }
    } else {
      run += raw; // paragraphs, headings, rules, HTML, blank space: one stretch of text
      const part = textPart(token);
      if (part) parts.push(part);
    }
  }
  flush();
  return out;
}

// Text -> Block[], in order. `marks` (from collectFootnotes over the whole reply or file): footnote references become
// their marks and the notes are taken out first.
export function toBlocks(text, { marks } = {}) {
  return splitSegments(marks ? applyFootnotes(text, marks) : text).flatMap((seg) => (seg.kind === "md" ? tokenBlocks(marked.lexer(seg.text, OPTIONS))
    : [withBytes({ kind: seg.kind, source: seg.source, id: seg.id, buttons: [{ label: "copy source", text: seg.source }] })]));
}

// A whole reply's buttons: copy md (as written) and copy html (marked's HTML, the Markdown as its plain side).
export function replyButtons(text) {
  const md = String(text ?? "");
  return [{ label: "copy md", text: md }, { label: "copy html", text: md, html: marked.parse(md, OPTIONS) }];
}
