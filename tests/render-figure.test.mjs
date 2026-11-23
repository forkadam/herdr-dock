// Figures in prismantis's syntax (src/shared/render/figure.js): runs, checks, and the SVG the Render panel shows.
import test from "node:test";
import assert from "node:assert/strict";
import { FIGURE_CELL, FIGURE_LINE, FIGURE_PAD, checkFigure, decideFigure, figureRuns, figureSvg } from "../src/shared/render/figure.js";

const THEME = { background: "#101010", foreground: "#eeeeee", muted: "#888888", accent: "#7aa2f7", dim: "#666666",
  ansi1: "#ff5555", ansi2: "#50fa7b", ansi3: "#f1fa8c" };
const X = (col) => FIGURE_PAD + col * FIGURE_CELL;
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
// Every <text>: its x positions (numbers), its attributes and its content.
const texts = (svg) => [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)]
  .map(([, a, content]) => { const at = attrs(a); return { ...at, xs: at.x.split(/\s+/).map(Number), content }; });
const near = (a, b) => Math.abs(a - b) < 0.01;
// The rectangles of the █ path of one colour: [x, y, w, h] per run (box lines are stroked paths, fill="none").
const blocks = (svg, fill) => [...svg.matchAll(/<path\b([^>]*)\/>/g)].map((m) => attrs(m[1])).filter((p) => p.fill === fill)
  .flatMap((p) => [...p.d.matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)h-[\d.]+z/g)].map((r) => r.slice(1, 5).map(Number)));

test("figureRuns: {role:text} runs; a role it doesn't know stays text; ▶ ◀ become ► ◄", () => {
  assert.deepEqual(figureRuns("a {accent:──}{warn:✗} b"),
    [{ text: "a " }, { text: "──", role: "accent" }, { text: "✗", role: "warn" }, { text: " b" }]);
  assert.deepEqual(figureRuns("{bold:x} ▶"), [{ text: "{bold:x} ►" }]);
});

test("checkFigure: prismantis's findings, numbered from the given first line", () => {
  const msg = (line) => checkFigure([line]).map((f) => f.message);
  assert.deepEqual(msg("a\tb"), ["tab, use spaces"]);
  assert.match(msg("x 🚀")[0], /"🚀" may draw as an emoji, use a text glyph/);
  assert.match(msg("漢")[0], /"漢" take two columns, use one-column glyphs/);
  assert.equal(msg("{Accent:x}")[0], '"{Accent:" is not a role, roles are accent, warn, ok, note, dim, strong in lower case');
  assert.equal(msg("{accent:x")[0], '"{accent:" is not closed, end it with }');
  assert.deepEqual(msg("a\u200bb"), ["invisible character, use plain text"]);
  assert.deepEqual(msg("x".repeat(101)), ["101 columns wide, at most 100"]);
  assert.deepEqual(checkFigure(["ok", "a\tb"], 2), [{ line: 4, message: "tab, use spaces" }]);
});

test("decideFigure: blank edges dropped; the first finding becomes the note; size limits", () => {
  assert.deepEqual(decideFigure("\n\nA {ok:B}\n\n"), { lines: ["A {ok:B}"] });
  assert.deepEqual(decideFigure("ok\nbad\tline"), { note: "figure line 2: tab, use spaces" });
  assert.deepEqual(decideFigure("\nok\nbad\tline"), { note: "figure line 3: tab, use spaces" });
  assert.deepEqual(decideFigure(Array(81).fill("x").join("\n")), { note: "figure has 81 lines, at most 80" });
});

test("figureSvg: each character at its own column, █ a rect filling its cell, role colours, its size", () => {
  const { svg, w, h } = figureSvg(["{accent:██}{warn:✗} x", "{strong:A}"], THEME);
  assert.equal(w, FIGURE_PAD * 2 + 5 * FIGURE_CELL);
  assert.equal(h, FIGURE_PAD * 2 + 2 * FIGURE_LINE);
  assert.match(svg, new RegExp(`^<svg[^>]*viewBox="0 0 ${w} ${h}"`));
  assert.match(svg, new RegExp(`<rect x="0" y="0" width="${w}" height="${h}" fill="${THEME.background}"/>`));
  assert.deepEqual(blocks(svg, THEME.accent), [[X(0), FIGURE_PAD, 2 * FIGURE_CELL, FIGURE_LINE]]);
  const t = texts(svg);
  const cross = t.find((x) => x.content === "✗");
  assert.ok(near(cross.xs[0], X(2)) && cross.fill === THEME.ansi1);
  const plain = t.find((x) => x.content === "x");
  assert.ok(near(plain.xs[0], X(4)) && plain.fill === THEME.foreground);
  const strong = t.find((x) => x.content === "A");
  assert.ok(strong.fill === THEME.foreground && strong["font-weight"] === "bold");
  assert.ok(t.every((x) => x.content.length === x.xs.length), "one x per character");
  assert.ok(!/var\(|color-mix|foreignObject/.test(svg));
});

test("figureSvg: <, & and quotes are escaped; a theme without dim or ansi colours still draws", () => {
  const { svg } = figureSvg(['a<b & "c"'], THEME);
  assert.match(svg, /a&lt;b/);
  assert.match(svg, /&amp;/);
  assert.ok(!/a<b/.test(svg));
  const bare = { background: "#101010", foreground: "#eeeeee", muted: "#888888", accent: "#7aa2f7" };
  const t = texts(figureSvg(["{dim:d}{warn:w}{ok:o}{note:n}"], bare).svg);
  assert.equal(t.find((x) => x.content === "d").fill, bare.muted);
  const warn = t.find((x) => x.content === "w");
  assert.ok(warn.fill === bare.foreground && warn["font-weight"] === "bold");
  assert.equal(t.find((x) => x.content === "o").fill, bare.foreground);
  assert.equal(t.find((x) => x.content === "n").fill, bare.foreground);
});

test("figureSvg: a bar of blocks is one rectangle per colour run, even across runs; a gap or a new colour starts another", () => {
  assert.deepEqual(blocks(figureSvg(["{ok:██}{ok:█} █"], THEME).svg, THEME.ansi2), [[X(0), FIGURE_PAD, 3 * FIGURE_CELL, FIGURE_LINE]]);
  assert.deepEqual(blocks(figureSvg(["{ok:██}{ok:█} █"], THEME).svg, THEME.foreground), [[X(4), FIGURE_PAD, FIGURE_CELL, FIGURE_LINE]]);
  assert.deepEqual(blocks(figureSvg(["{accent:█}{ok:█}"], THEME).svg, THEME.accent), [[X(0), FIGURE_PAD, FIGURE_CELL, FIGURE_LINE]]);
  assert.deepEqual(blocks(figureSvg(["{accent:█}{ok:█}"], THEME).svg, THEME.ansi2), [[X(1), FIGURE_PAD, FIGURE_CELL, FIGURE_LINE]]);
});

test("figureSvg: box-drawing characters are lines on the cell grid, so a box's sides meet from row to row", () => {
  const { svg } = figureSvg(["┌─┐", "│ │", "└─┘"], THEME);
  assert.ok(!texts(svg).some((t) => /[─│┌┐└┘]/.test(t.content)), "no box character is left to the font");
  const segs = [...svg.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)].map((m) => m.slice(1).map(Number));
  const cx = X(0) + FIGURE_CELL / 2;
  const vertical = segs.filter(([x1, , x2]) => near(x1, cx) && near(x2, cx));
  const covered = (y) => vertical.some(([, y1, , y2]) => Math.min(y1, y2) - 0.01 <= y && y <= Math.max(y1, y2) + 0.01);
  for (let y = FIGURE_PAD + FIGURE_LINE / 2; y <= FIGURE_PAD + 2.5 * FIGURE_LINE; y += 1) assert.ok(covered(y), `left side at y=${y}`);
});

test("figureSvg: box lines take their run's colour; a double line is two parallel lines", () => {
  const { svg } = figureSvg(["{warn:═}"], THEME);
  const paths = [...svg.matchAll(/<path\b([^>]*)\/>/g)].map((m) => attrs(m[1]));
  assert.equal(paths.length, 1);
  assert.equal(paths[0].stroke, THEME.ansi1);
  const ys = new Set([...paths[0].d.matchAll(/M[\d.]+ ([\d.]+)L[\d.]+ ([\d.]+)/g)].flatMap((m) => [m[1], m[2]]));
  assert.equal(ys.size, 2, "two horizontal lines");
});

test("figureSvg: box lines end exactly on their cell's edge, with butt caps, so neighbouring cells never overlap", () => {
  const { svg } = figureSvg(["│", "│"], THEME);
  const paths = [...svg.matchAll(/<path\b([^>]*)\/>/g)].map((m) => attrs(m[1]));
  assert.ok(paths.every((p) => (p["stroke-linecap"] ?? "butt") === "butt"));
  const ys = paths.flatMap((p) => [...p.d.matchAll(/M[\d.]+ ([\d.]+)L[\d.]+ ([\d.]+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]));
  assert.ok(near(Math.min(...ys), FIGURE_PAD) && near(Math.max(...ys), FIGURE_PAD + 2 * FIGURE_LINE), "from the top edge of row 0 to the bottom of row 1");
});

test("figureSvg: all blocks of one colour are one path, so stacked rows have no seam; box lines stay separate", () => {
  const { svg } = figureSvg(["{ok:██}", "{ok:██} {ok:█}", "{ok:│}"], THEME);
  const okPaths = [...svg.matchAll(/<path\b([^>]*)\/>/g)].map((m) => attrs(m[1])).filter((p) => p.fill === THEME.ansi2);
  assert.equal(okPaths.length, 1);
  assert.deepEqual(blocks(svg, THEME.ansi2), [[X(0), FIGURE_PAD, 2 * FIGURE_CELL, FIGURE_LINE],
    [X(0), FIGURE_PAD + FIGURE_LINE, 2 * FIGURE_CELL, FIGURE_LINE], [X(3), FIGURE_PAD + FIGURE_LINE, FIGURE_CELL, FIGURE_LINE]]);
  assert.ok([...svg.matchAll(/<path\b([^>]*)\/>/g)].map((m) => attrs(m[1])).some((p) => p.stroke === THEME.ansi2 && p.fill === "none"), "the │ is a stroked line");
});

test("figureSvg: a role colour too faint on the background falls back to the foreground (warn bold)", () => {
  const faint = { ...THEME, ansi1: "#1a1a1a", ansi2: "#151515", ansi3: "#121212" };
  const t = texts(figureSvg(["{warn:w}{ok:o}{note:n}"], faint).svg);
  const w = t.find((x) => x.content === "w");
  assert.ok(w.fill === THEME.foreground && w["font-weight"] === "bold");
  assert.equal(t.find((x) => x.content === "o").fill, THEME.foreground);
  assert.equal(t.find((x) => x.content === "n").fill, THEME.foreground);
});

test("checkFigure: noncharacters (U+FFFE, U+FFFF, an unpaired surrogate) are a finding", () => {
  for (const ch of ["\uFFFE", "\uFFFF", "\uD800"]) assert.deepEqual(checkFigure([`a${ch}b`]).map((f) => f.message), ["noncharacter, use plain text"]);
});
