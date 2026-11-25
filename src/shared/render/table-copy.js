// A table's copies for the Render panel's copy buttons (pure; no host imports): its plain text, a boxed text table
// ("art", for Slack) and tab-separated text (the plain side of the html copy). `token` is a marked table token.
// width, wrapRanges, columnWidths and tableArt are ported from prismantis 0.20.0 (hooks/render.tsx), and tableText
// from its hooks/html.ts: https://github.com/NahumLitvin/prismantis (MIT).

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

// Column widths that fit `available` columns with `gap` between them: natural when they fit, else the narrow ones
// keep theirs and the rest share what's left (never below a column's longest word when that fits).
function columnWidths(natural, available, gap, words = []) {
  const room = Math.max(natural.length, available - gap * (natural.length - 1));
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= room) return natural;
  const minimum = natural.map((w, c) => Math.min(w, Math.max(1, words[c] ?? 1)));
  const widths = natural.map(() => 0);
  let open = natural.map((_, c) => c);
  let left = room;
  for (let fixed = [-1]; fixed.length;) {
    const share = Math.floor(left / open.length);
    const claim = (c) => (natural[c] <= share ? natural[c] : minimum[c]);
    const minimumsFit = open.reduce((a, c) => a + minimum[c], 0) <= left;
    const needed = open.reduce((a, c) => a + claim(c), 0);
    fixed = open.filter((c) => natural[c] <= share);
    if (minimumsFit && (!fixed.length || needed > left)) fixed = open.filter((c) => minimum[c] > share);
    fixed.forEach((c) => { widths[c] = claim(c); left -= widths[c]; });
    open = open.filter((c) => !fixed.includes(c));
  }
  open.forEach((c, i) => { widths[c] = Math.max(1, Math.floor(left / open.length) + (i < left % open.length ? 1 : 0)); });
  while (widths.reduce((a, b) => a + b, 0) > room) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 1) break;
    widths[widest]--;
  }
  return widths;
}

// The plain text of marked inline tokens: markup gone, escapes as their character, a link as "text (address)" (as
// prismantis's displayText) or just its address when that is its text.
export function cellText(tokens) {
  return (tokens ?? []).map((t) => {
    if (t.type === "link") { const text = cellText(t.tokens); return text && text !== t.href ? `${text} (${t.href})` : t.href; }
    return Array.isArray(t.tokens) && t.type !== "codespan" ? cellText(t.tokens) : t.text ?? "";
  }).join("");
}

const rowsOf = (token) => [token.header, ...token.rows].map((r) => token.header.map((_, c) => cellText(r[c]?.tokens).replace(/\s+/g, " ").trim()));

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
