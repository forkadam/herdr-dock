// A table's copies for the Render panel's copy buttons (pure; no host imports): its plain text, a boxed text table
// ("art", for Slack) and tab-separated text (the plain side of the html copy). `token` is a marked table token.
// width, wrapRanges, columnWidths and tableArt are ported from prismantis 0.20.0 (hooks/render.tsx), and tableText
// from its hooks/html.ts: https://github.com/NahumLitvin/prismantis (MIT).

import { columnWidths } from "./columns.js";

const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}\u20E3]|\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;
const segmenter = new Intl.Segmenter();
const graphemes = (s) => [...segmenter.segment(s)].map((g) => g.segment);

// Terminal columns: wide (CJK, emoji) characters take two, combining marks none.
export const width = (s) =>
  /^[ -~]*$/.test(s) ? s.length
    : s.length === 1 ? (/\p{M}/u.test(s) ? 0 : WIDE.test(s) ? 2 : 1)
      : graphemes(s).reduce((w, g) => (/^\p{M}+$/u.test(g) ? w : w + (WIDE.test(g) ? 2 : 1)), 0);

// [start, end) ranges of text that fit w columns, broken between words (a word wider than w is cut).
function wrapRanges(text, w) {
  if (width(text) <= w) return [[0, text.length]];
  const out = [];
  let line;
  let used = 0;
  for (const word of text.matchAll(/\S+/g)) {
    let start = word.index;
    const end = start + word[0].length;
    let size = width(word[0]);
    if (size > w) {
      if (line) out.push(line);
      line = undefined;
      let cut = start;
      let taken = 0;
      for (const g of graphemes(text.slice(start, end))) {
        const step = width(g);
        if (cut > start && taken + step > w) {
          out.push([start, cut]);
          start = cut;
          size -= taken;
          taken = 0;
          if (size <= w) break;
        }
        cut += g.length;
        taken += step;
      }
    }
    if (start === end) continue;
    const joined = line ? used + width(text.slice(line[1], start)) + size : Infinity;
    if (line && joined <= w) {
      line = [line[0], end];
      used = joined;
    } else {
      if (line) out.push(line);
      line = [start, end];
      used = size;
    }
  }
  if (line) out.push(line);
  return out;
}

const longestWord = (text) => Math.max(0, ...text.split(/\s+/).map(width));

// The plain text of marked inline tokens: markup gone, escapes as their character, a link as "text (address)" (as
// prismantis's displayText) or just its address when that is its text.
export function cellText(tokens) {
  return (tokens ?? []).map((t) => {
    if (t.type === "link") { const text = cellText(t.tokens); return text && text !== t.href ? `${text} (${t.href})` : t.href; }
    return Array.isArray(t.tokens) && t.type !== "codespan" ? cellText(t.tokens) : t.text ?? "";
  }).join("");
}

const rowsOf = (token) => [token.header, ...token.rows].map((r) => token.header.map((_, c) => cellText(r[c]?.tokens).replace(/\s+/g, " ").trim()));

// Per column: the widest cell's display width and the longest word's (for columnWidths, in the panel's grid too).
export function tableSizes(token) {
  const cells = rowsOf(token);
  const column = (measure) => token.header.map((_, c) => Math.max(0, ...cells.map((r) => measure(r[c]))));
  return { natural: column(width), words: column(longestWord) };
}

const ART_WIDTH = 100;

// A boxed table in a ``` fence: headers centred, cells aligned as the table says, a rule between rows, at most 100 columns.
export function tableArt(token) {
  const cells = rowsOf(token);
  const column = (measure) => token.header.map((_, c) => Math.max(...cells.map((r) => measure(r[c]))));
  const widths = columnWidths(column(width), ART_WIDTH - 4, 3, column(longestWord));
  const pad = (text, c, align) => {
    const room = Math.max(0, widths[c] - width(text));
    const left = align === "right" ? room : align === "center" ? Math.floor(room / 2) : 0;
    return " ".repeat(left) + text + " ".repeat(room - left);
  };
  const line = (l, m, r) => l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
  const row = (r, header) => {
    const lines = r.map((text, c) => wrapRanges(text, widths[c]).map(([a, b]) => text.slice(a, b)));
    return Array.from({ length: Math.max(...lines.map((l) => l.length)) }, (_, i) =>
      `│ ${lines.map((l, c) => pad(l[i] ?? "", c, header ? "center" : token.align[c] ?? "left")).join(" │ ")} │`);
  };
  const art = [line("┌", "┬", "┐"), ...row(cells[0], true), ...cells.slice(1).flatMap((r) => [line("├", "┼", "┤"), ...row(r, false)]), line("└", "┴", "┘")];
  return ["```", ...art, "```"].join("\n");
}

// Tab-separated plain text; a cell holding a tab, a line break or a quote is quoted.
export function tableText(token) {
  const tsv = (text) => (/[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  return [token.header, ...token.rows].map((r) => r.map((cell) => tsv(cellText(cell.tokens))).join("\t")).join("\n");
}
