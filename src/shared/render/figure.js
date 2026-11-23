// Figures: ```figure blocks, text pictures drawn as written, checked and drawn as SVG (pure; no host imports).
// `{role:text}` colours a run. Each character sits at its own column, so a font's own advance never moves one, and █
// is a rect filling its cell, so bars are solid and meet.
// Ported from prismantis's hooks/figure.tsx (MIT, (c) 2026 Nahum Litvin: https://github.com/NahumLitvin/prismantis).

export const FIGURE_ROLES = ["accent", "warn", "ok", "note", "dim", "strong"];
export const FIGURE_MAX_COLUMNS = 100;
export const FIGURE_MAX_LINES = 80;
// The SVG's grid, in px: a 13 px monospace font in 7.8 x 18 cells, 10 px around.
export const FIGURE_FONT = 13;
export const FIGURE_CELL = 7.8;
export const FIGURE_LINE = 18;
export const FIGURE_PAD = 10;

const RAW_MAX_LINE = FIGURE_MAX_COLUMNS * 4;
const LISTED_GLYPHS = 8;

// Column widths (prismantis's hooks/render.tsx): East Asian wide and emoji presentation take two columns, marks none.
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3FFFD}\u20e3]|\p{Emoji_Presentation}|\p{Extended_Pictographic}\ufe0f/u;
const segmenter = new Intl.Segmenter();
export const graphemes = (s) => [...segmenter.segment(s)].map((g) => g.segment);
export const width = (s) =>
  /^[ -~]*$/.test(s) ? s.length
    : s.length === 1 ? (/\p{M}/u.test(s) ? 0 : WIDE.test(s) ? 2 : 1)
      : graphemes(s).reduce((w, g) => (/^\p{M}+$/u.test(g) ? w : w + (WIDE.test(g) ? 2 : 1)), 0);

const MARKUP = new RegExp(`\\{(${FIGURE_ROLES.join("|")}):([^{}]*)\\}`, "g");
const MARKER = /\{([A-Za-z][\w-]*):/g;
const TEXT_FORMS = { "▶": "►", "◀": "◄" };
const EMOJI_CAPABLE = /\p{Extended_Pictographic}/u;
const CONTROL = /[\0-\x08\x0b-\x1f\x7f-\x9f]/;
const DIRECTION_MARK = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const INVISIBLE = /[\u00ad\u200b-\u200d\u2028\u2029\ufeff]/;
const isRole = (name) => FIGURE_ROLES.includes(name);
const textForm = (text) => text.replace(/[▶◀]/g, (glyph) => TEXT_FORMS[glyph] ?? glyph);

// A line -> [{ text, role? }]: marked runs and the plain text between them.
export function figureRuns(line) {
  const runs = [];
  let at = 0;
  for (const match of line.matchAll(MARKUP)) {
    const [whole, role, text = ""] = match;
    if (match.index > at) runs.push({ text: textForm(line.slice(at, match.index)) });
    if (text && isRole(role)) runs.push({ text: textForm(text), role });
    at = match.index + whole.length;
  }
  if (at < line.length) runs.push({ text: textForm(line.slice(at)) });
  return runs;
}

const figureText = (line) => figureRuns(line).map((run) => run.text).join("");

const swapsTwoLetters = (name, role) => {
  if (name.length !== role.length) return false;
  const differ = [...name].flatMap((letter, i) => (letter === role[i] ? [] : [i]));
  const [first = -1, second = -1] = differ;
  return differ.length === 2 && second === first + 1 && name[first] === role[second] && name[second] === role[first];
};

const markupMessage = (marker, drawn, lastClose) => {
  const [written, name = ""] = marker;
  if (drawn.has(marker.index)) return undefined;
  const lower = name.toLowerCase();
  const role = FIGURE_ROLES.find((candidate) => candidate === lower || swapsTwoLetters(lower, candidate));
  if (!role) return undefined;
  if (name !== role) return `"${written}" is not a role, roles are ${FIGURE_ROLES.join(", ")} in lower case`;
  if (lastClose < marker.index + written.length) return `"${written}" is not closed, end it with }`;
  return `"${written}" holds braces, markup does not nest`;
};

const markupMessages = (line) => {
  const drawn = new Set([...line.matchAll(MARKUP)].map((match) => match.index));
  const lastClose = line.lastIndexOf("}");
  return [...line.matchAll(MARKER)].flatMap((marker) => markupMessage(marker, drawn, lastClose) ?? []);
};

const quoted = (glyphs) => {
  const distinct = [...new Set(glyphs)];
  const listed = distinct.slice(0, LISTED_GLYPHS).map((glyph) => `"${glyph}"`).join(", ");
  return distinct.length > LISTED_GLYPHS ? `${listed} and ${distinct.length - LISTED_GLYPHS} more` : listed;
};

const lineMessages = (line) => {
  const text = figureText(line);
  const glyphs = graphemes(text);
  const emoji = glyphs.filter((glyph) => EMOJI_CAPABLE.test(glyph));
  const wide = glyphs.filter((glyph) => !EMOJI_CAPABLE.test(glyph) && width(glyph) === 2);
  const columns = width(text);
  return [
    ...(columns > FIGURE_MAX_COLUMNS ? [`${columns} columns wide, at most ${FIGURE_MAX_COLUMNS}`] : []),
    ...(text.includes("\t") ? ["tab, use spaces"] : []),
    ...(CONTROL.test(text) ? ["control character, use plain text"] : []),
    ...(DIRECTION_MARK.test(text) ? ["direction mark, use plain text"] : []),
    ...(INVISIBLE.test(text) ? ["invisible character, use plain text"] : []),
    ...(emoji.length ? [`${quoted(emoji)} may draw as an emoji, use a text glyph`] : []),
    ...(wide.length ? [`${quoted(wide)} take two columns, use one-column glyphs`] : []),
    ...markupMessages(line),
  ];
};

// Every finding, [{ line, message }], lines numbered from `first` (the blank lines dropped before them).
export const checkFigure = (lines, first = 0) =>
  lines.flatMap((line, index) => lineMessages(line).map((message) => ({ line: first + index + 1, message })));

const leadingBlanks = (lines) => {
  const start = lines.findIndex((line) => line.trim());
  return start < 0 ? lines.length : start;
};

const withoutTrailingBlanks = (lines) => {
  let end = lines.length;
  while (end > 0 && !lines[end - 1]?.trim()) end--;
  return lines.slice(0, end);
};

// A figure's source -> { lines } to draw, or { note } saying why it can't be (the first finding, as prismantis says it).
export function decideFigure(source) {
  const raw = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const tooLong = raw.findIndex((line) => line.length > RAW_MAX_LINE);
  if (tooLong >= 0) return { note: `figure line ${tooLong + 1} is ${raw[tooLong].length} characters long` };
  if (raw.length > FIGURE_MAX_LINES * 2) return { note: `figure has ${raw.length} lines, at most ${FIGURE_MAX_LINES}` };
  const first = leadingBlanks(raw);
  const lines = withoutTrailingBlanks(raw.slice(first));
  if (!lines.length) return { note: "figure is empty" };
  if (lines.length > FIGURE_MAX_LINES) return { note: `figure has ${lines.length} lines, at most ${FIGURE_MAX_LINES}` };
  const [finding] = checkFigure(lines, first);
  return finding ? { note: `figure line ${finding.line}: ${finding.message}` } : { lines };
}

// ---- Drawing ----

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const px = (n) => Math.round(n * 100) / 100;

// A role's colour (and boldness) from the panel's theme; a theme without that colour falls back as prismantis does.
function roleStyle(role, theme) {
  const fg = theme.foreground;
  switch (role) {
    case "accent": return { fill: theme.accent ?? fg };
    case "warn": return theme.ansi1 ? { fill: theme.ansi1 } : { fill: fg, bold: true };
    case "ok": return { fill: theme.ansi2 ?? fg };
    case "note": return { fill: theme.ansi3 ?? fg };
    case "dim": return { fill: theme.dim ?? theme.muted ?? fg };
    case "strong": return { fill: fg, bold: true };
    default: return { fill: fg };
  }
}

// Checked lines -> { svg, w, h }. A run of non-space characters is one <text> with an x per character; spaces draw
// nothing; █ is a rect of its whole cell.
export function figureSvg(lines, theme) {
  const parts = [];
  let columns = 0;
  lines.forEach((line, row) => {
    const top = FIGURE_PAD + row * FIGURE_LINE;
    const baseline = px(top + FIGURE_FONT);
    let col = 0;
    for (const run of figureRuns(line)) {
      const style = roleStyle(run.role, theme);
      const attrs = `font-family="monospace" font-size="${FIGURE_FONT}" fill="${style.fill}"${style.bold ? ' font-weight="bold"' : ""}`;
      let chars = [];
      let xs = [];
      const flush = () => {
        if (chars.length) parts.push(`<text x="${xs.join(" ")}" y="${baseline}" ${attrs}>${esc(chars.join(""))}</text>`);
        chars = [];
        xs = [];
      };
      for (const g of graphemes(run.text)) {
        const x = px(FIGURE_PAD + col * FIGURE_CELL);
        if (g === " ") flush();
        else if (g === "█") {
          flush();
          parts.push(`<rect x="${x}" y="${px(top)}" width="${FIGURE_CELL}" height="${FIGURE_LINE}" fill="${style.fill}"/>`);
        } else if (g.length > 1) {
          // A cluster (a letter and its marks) is placed as one: an x list counts characters, not clusters.
          flush();
          parts.push(`<text x="${x}" y="${baseline}" ${attrs}>${esc(g)}</text>`);
        } else {
          chars.push(g);
          xs.push(x);
        }
        col += Math.max(1, width(g));
      }
      flush();
    }
    columns = Math.max(columns, col);
  });
  const w = px(FIGURE_PAD * 2 + columns * FIGURE_CELL);
  const h = px(FIGURE_PAD * 2 + lines.length * FIGURE_LINE);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`
    + `<rect x="0" y="0" width="${w}" height="${h}" fill="${theme.background}"/>\n${parts.join("\n")}\n</svg>\n`;
  return { svg, w, h };
}
