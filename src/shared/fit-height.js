// The definite height a scroll list is given. In Herdr's toolkit a list sized only by a max-height
// (`.max_h(N).overflow_y_scrollbar()`) clips but does not scroll; it scrolls when its box has a definite height. So
// such a list sits in an outer box of height `fitHeight(...)` (as tall as the content, `max` at most) and fills it
// as a scroll area: `v_flex().h(H)` holding `v_flex().id(..).flex_1().min_h(0).overflow_y_scrollbar()`.
// Pure: nothing here imports herdr or gpui.

// rows: how many rows of height rowH (gap between them, not around), pad: the padding and borders around the rows,
// extra: whatever else the list draws (a header, an empty-state line, a footer). An estimate that is a little high only
// leaves some blank space; a little low, a little scrolling.
export function fitHeight({ rows = 0, rowH = 0, gap = 0, pad = 0, extra = 0, max = Infinity } = {}) {
  const n = Math.max(0, rows);
  return Math.min(max, n * rowH + Math.max(0, n - 1) * gap + pad + extra);
}

// The height of rows of different heights stacked with `gap` between them (not around), for `fitHeight`'s `extra`.
export const stackHeight = (heights, gap = 0) => heights.reduce((n, h) => n + h, 0) + Math.max(0, heights.length - 1) * gap;

// ---- estimates for text that wraps (rows of unknown height) ----

const GLYPH = 0.55; // a glyph's average width as a part of the font size
const LINE = 1.618; // the toolkit's line height as a part of the font size

// A line of text at `size` px, rounded up.
export const lineHeight = (size) => Math.ceil(size * LINE);

// Width units of a text: 1 a glyph, 2 for a wide (CJK) one.
const units = (text) => { let n = 0; for (const ch of String(text ?? "")) n += ch.codePointAt(0) >= 0x2e80 ? 2 : 1; return n; };

// How wide `text` draws on one line at `size` px.
export const textWidth = (text, size) => units(text) * size * GLYPH;

// How many lines `text` takes in a box `width` px wide: words fill a line and go down when the next doesn't fit, a
// word longer than a line breaks across lines, a newline starts a line, and a blank text still draws one.
export function textLines(text, width, size) {
  const cap = Math.max(1, Math.floor(width / (size * GLYPH)));
  let lines = 0;
  for (const paragraph of String(text ?? "").split("\n")) {
    let n = 1, used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const w = units(word);
      if (used === 0) used = w;
      else if (used + 1 + w <= cap) used += 1 + w;
      else { n++; used = w; }
      while (used > cap) { n++; used -= cap; }
    }
    lines += n;
  }
  return lines;
}

// How tall `text` draws in a box `width` px wide at `size` px.
export const textHeight = (text, { width, size }) => textLines(text, width, size) * lineHeight(size);

// How many lines items of the given widths take in a box `avail` px wide that wraps them (a flex-wrap row with `gap`
// between items): one too wide for a line still takes that line.
export function flowLines(widths, avail, gap = 0) {
  let lines = 0, used = 0;
  for (const w of widths) {
    if (lines === 0) { lines = 1; used = w; }
    else if (used + gap + w <= avail) used += gap + w;
    else { lines++; used = w; }
  }
  return lines;
}
