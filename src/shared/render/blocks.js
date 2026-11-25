// A reply (or a Markdown file) cut into the blocks the Render panel draws, each with its copy buttons (pure; no host
// imports). Pictures (```mermaid, ```figure) are found by splitSegments as before, so their ids don't change; the rest
// is read with marked (MIT). The buttons follow prismantis (https://github.com/NahumLitvin/prismantis, MIT): a table's
// md / art / html, copy on code, lists, quotes and alerts, copy source on a picture, copy md / copy html on a reply.
//
// Button: { label, text, html? }   (html only on a formatted copy; text is then its plain side)
// Block:  { kind: "text" | "table" | "code" | "list" | "quote" | "alert", md, lang?, alert?, buttons }
//       | { kind: "mermaid" | "figure", source, id, buttons }
import { marked } from "marked";
import { splitSegments } from "./markdown.js";
import { tableArt, tableText } from "./table-copy.js";

const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const OPTIONS = { gfm: true };

// Code as a fenced block, whatever it was written as (an indented block loses its indent once cut out): the fence is
// longer than any run of backticks inside.
function fenced(code, lang) {
  const fence = "`".repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map((r) => r.length + 1)));
  return `${fence}${lang}\n${code}\n${fence}`;
}

function mdBlocks(text) {
  const out = [];
  let run = "";
  const flush = () => {
    const md = run.trim();
    if (md) out.push({ kind: "text", md, buttons: [] });
    run = "";
  };
  for (const token of marked.lexer(text, OPTIONS)) {
    const raw = String(token.raw ?? "");
    if (token.type === "table") {
      flush();
      out.push({
        kind: "table", md: raw.trim(),
        buttons: [
          { label: "md", text: raw.trim() },
          { label: "art", text: tableArt(token) },
          { label: "html", text: tableText(token), html: marked.parser([token], OPTIONS) },
        ],
      });
    } else if (token.type === "code") {
      flush();
      const lang = String(token.lang ?? "").trim().split(/\s+/)[0];
      out.push({ kind: "code", md: fenced(token.text, lang), lang, buttons: [{ label: "copy", text: token.text }] });
    } else if (token.type === "list") {
      flush();
      out.push({ kind: "list", md: raw.trim(), buttons: [{ label: "copy", text: raw.trim() }] });
    } else if (token.type === "blockquote") {
      flush();
      const body = String(token.text ?? "");
      const alert = ALERT.exec(body);
      if (alert) {
        const md = body.slice(alert[0].length).trim();
        out.push({ kind: "alert", alert: alert[1].toLowerCase(), md, buttons: [{ label: "copy", text: md }] });
      } else {
        out.push({ kind: "quote", md: raw.trim(), buttons: [{ label: "copy", text: body.trim() }] });
      }
    } else {
      run += raw; // paragraphs, headings, rules, HTML, blank space: one stretch of text
    }
  }
  flush();
  return out;
}

// Text -> Block[], in order.
export function toBlocks(text) {
  return splitSegments(text).flatMap((seg) => (seg.kind === "md" ? mdBlocks(seg.text)
    : [{ kind: seg.kind, source: seg.source, id: seg.id, buttons: [{ label: "copy source", text: seg.source }] }]));
}

// A whole reply's buttons: copy md (as written) and copy html (marked's HTML, the Markdown as its plain side).
export function replyButtons(text) {
  const md = String(text ?? "");
  return [{ label: "copy md", text: md }, { label: "copy html", text: md, html: marked.parse(md, OPTIONS) }];
}
