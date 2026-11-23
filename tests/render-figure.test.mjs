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
  const blocks = [...svg.matchAll(/<rect\b([^>]*)\/>/g)].map((m) => attrs(m[1])).filter((r) => r.fill === THEME.accent);
  assert.deepEqual(blocks.map((r) => [Number(r.x), Number(r.y), Number(r.width), Number(r.height)]),
    [[X(0), FIGURE_PAD, FIGURE_CELL, FIGURE_LINE], [X(1), FIGURE_PAD, FIGURE_CELL, FIGURE_LINE]]);
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
