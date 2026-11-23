// Painting beautiful-mermaid's flattened SVG (src/shared/render/paint.js): a colour per node and series, values on bar
// charts, author colours kept. Drawn with the real renderer, as the helper draws them.
import test from "node:test";
import assert from "node:assert/strict";
import { renderMermaidSVG } from "beautiful-mermaid";
import { flattenSvg } from "../src/shared/render/flatten.js";
import { mermaidColors, nodePalette, paintDiagram, styledIds } from "../src/shared/render/paint.js";

const THEME = { background: "#101010", foreground: "#eeeeee", muted: "#888888", border: "#3f4147", accent: "#7aa2f7",
  dim: "#666666", dark: true, ansi1: "#ff5555", ansi2: "#50fa7b", ansi3: "#f1fa8c", ansi4: "#6272a4", ansi5: "#ff79c6", ansi6: "#8be9fd" };
const LIGHT = { ...THEME, background: "#ffffff", foreground: "#222222", dark: false, ansi3: "#f1fa8c", ansi6: "#e0ffff" };
const draw = (src) => flattenSvg(renderMermaidSVG(src, mermaidColors(THEME)), THEME.background);
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
// Each node group (no nesting in beautiful-mermaid's output): its stroke colours and its text fills.
const nodes = (svg) => Object.fromEntries([...svg.matchAll(/<g class="(?:node|class-node|entity|actor)" data-id="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g)]
  .map(([, id, body]) => [id, { body, strokes: [...body.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase()),
    texts: [...body.matchAll(/<text\b[^>]*fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase()) }]));
const tagsWith = (svg, cls) => [...svg.matchAll(/<[a-z]+\b[^>]*>/g)].map((m) => attrs(m[0]))
  .filter((a) => (a.class ?? "").split(" ").includes(cls));
const barBox = (a) => {
  if (a.d) { const n = a.d.match(/-?[\d.]+/g).map(Number); const ys = n.filter((_, i) => i % 2); return { top: Math.min(...ys), bottom: Math.max(...ys) }; }
  return { top: Number(a.y), bottom: Number(a.y) + Number(a.height) };
};
const pal = nodePalette(THEME);

test("nodePalette: blue, cyan, green, magenta, yellow, then accent; no red; duplicates and unreadable colours dropped", () => {
  assert.deepEqual(pal, [THEME.ansi4, THEME.ansi6, THEME.ansi2, THEME.ansi5, THEME.ansi3, THEME.accent]);
  assert.equal(nodePalette({ ...THEME, ansi6: THEME.ansi4 }).length, 5);
  const light = nodePalette(LIGHT);
  assert.ok(!light.includes(LIGHT.ansi3) && !light.includes(LIGHT.ansi6), "yellow and pale cyan on white are dropped");
  assert.deepEqual(nodePalette({ background: "#101010", foreground: "#eeeeee", accent: "#7aa2f7" }), ["#7aa2f7"]);
});

test("styledIds: style, class (flowchart and state), cssClass, ::: and classDef default", () => {
  const s = styledIds("flowchart LR\n  A[x]:::hot --> B --> C & D\n  style B fill:#f00\n  class C,D cool\n  classDef hot fill:#0f0");
  assert.deepEqual([...s.ids].sort(), ["A", "B", "C", "D"]);
  assert.equal(s.all, false);
  assert.equal(styledIds("flowchart LR\n  A-->B\n  classDef default fill:#222").all, true);
  // In a class diagram `class X` declares a class; it doesn't style it.
  assert.deepEqual([...styledIds('classDiagram\n  class Pool\n  cssClass "Conn" hot').ids], ["Conn"]);
});

test("paintDiagram: each node its own palette colour, in order; a styled node is left as drawn and takes no colour", () => {
  const src = "flowchart LR\n  A --> S --> B\n  style S fill:#ff0000";
  const before = nodes(draw(src)), after = nodes(paintDiagram(draw(src), src, THEME));
  assert.ok(after.A.strokes.length && after.A.strokes.every((c) => c === pal[0]) && after.A.texts.every((c) => c === pal[0]));
  assert.ok(after.B.strokes.every((c) => c === pal[1]), "S took no colour, so B is second");
  assert.equal(after.S.body, before.S.body);
  const all = "flowchart LR\n  A-->B\n  classDef default fill:#222222";
  assert.equal(paintDiagram(draw(all), all, THEME), draw(all));
});

test("paintDiagram: state start and end markers keep their colours", () => {
  const src = "stateDiagram-v2\n  [*] --> Idle\n  Idle --> [*]";
  const before = nodes(draw(src)), after = nodes(paintDiagram(draw(src), src, THEME));
  for (const id of Object.keys(before).filter((k) => /^_(start|end)/.test(k))) assert.equal(after[id].body, before[id].body);
  assert.ok(after.Idle.strokes.every((c) => c === pal[0]));
});

test("paintDiagram: sequence participants, class boxes and ER entities are painted too", () => {
  for (const src of ["sequenceDiagram\n  participant S\n  participant I\n  S->>I: hi",
    "classDiagram\n  class Pool\n  class Conn\n  Pool --> Conn",
    "erDiagram\n  TANK ||--o{ READING : posts"]) {
    const n = Object.values(nodes(paintDiagram(draw(src), src, THEME)));
    assert.ok(n.length >= 2 && n[0].strokes.every((c) => c === pal[0]) && n[1].strokes.every((c) => c === pal[1]), src);
  }
});

test("paintDiagram: the series of a multi-series chart take palette colours; no values printed", () => {
  const src = "xychart-beta\n  x-axis [a, b, c]\n  bar [3, 5, 2]\n  line [1, 4, 3]";
  const out = paintDiagram(draw(src), src, THEME);
  for (const a of tagsWith(out, "xychart-bar").filter((a) => a.class.includes("xychart-color-0"))) assert.match(a.style, new RegExp(`stroke:${pal[0]}`));
  for (const a of tagsWith(out, "xychart-line").filter((a) => a.class.includes("xychart-color-1"))) assert.match(a.style, new RegExp(`stroke:${pal[1]}`));
  assert.ok(!/render-bar-value/.test(out));
});

test("paintDiagram: a single-series bar chart prints each value above its bar (below a negative one); the tallest takes the accent", () => {
  const src = "xychart-beta\n  x-axis [a, b, c]\n  bar [46, 2029, -5]";
  const out = paintDiagram(draw(src), src, THEME);
  const labels = [...out.matchAll(/<text\b([^>]*class="render-bar-value"[^>]*)>([^<]*)<\/text>/g)].map(([, a, v]) => ({ ...attrs(a), v }));
  assert.deepEqual(labels.map((l) => l.v), ["46", "2029", "-5"]);
  const bars = tagsWith(out, "xychart-bar").filter((a) => a["data-value"] !== undefined);
  for (const l of labels) {
    const box = barBox(bars.find((b) => b["data-value"] === l.v));
    if (Number(l.v) >= 0) assert.ok(Number(l.y) < box.top, `${l.v} above its bar`); else assert.ok(Number(l.y) > box.bottom, `${l.v} below its bar`);
  }
  assert.match(bars.find((b) => b["data-value"] === "2029").style, new RegExp(`stroke:${THEME.accent}`));
  assert.match(bars.find((b) => b["data-value"] === "46").style, new RegExp(`stroke:${THEME.muted}`));
});

test("paintDiagram: bar values stay inside the drawing; horizontal charts get none", () => {
  const src = "xychart-beta\n  x-axis [a, b]\n  bar [10, 100]";
  const out = paintDiagram(draw(src), src, THEME);
  const [, vy] = attrs(/<svg\b[^>]*>/.exec(out)[0]).viewBox.split(/\s+/).map(Number);
  for (const m of out.matchAll(/<text\b([^>]*class="render-bar-value"[^>]*)>/g)) assert.ok(Number(attrs(m[1]).y) - 12 >= vy);
  const h = "xychart-beta horizontal\n  x-axis [a, b]\n  bar [10, 100]";
  assert.ok(!/render-bar-value/.test(paintDiagram(draw(h), h, THEME)));
});

test("paintDiagram: anything unexpected gives the SVG back unchanged", () => {
  assert.equal(paintDiagram("<svg broken", "flowchart LR\n  A-->B", THEME), "<svg broken");
  const src = "flowchart LR\n  A-->B";
  assert.equal(typeof paintDiagram(draw(src), src, {}), "string");
});

test("paintDiagram: a chart's legend, line shadows and dots take their series' colour too", () => {
  const src = "xychart-beta\n  x-axis [a, b, c]\n  line [10, 30, 20]\n  line [25, 15, 35]";
  const out = paintDiagram(draw(src), src, THEME);
  const tags = [...out.matchAll(/<([a-z]+)\b[^>]*>/g)].map((m) => ({ tag: m[1], ...attrs(m[0]) }))
    .filter((a) => /\bxychart-color-\d+\b/.test(a.class ?? ""));
  assert.ok(tags.some((a) => (a.class ?? "").includes("xychart-legend-line")), "the chart has legend swatches");
  for (const a of tags) {
    const n = Number(/xychart-color-(\d+)/.exec(a.class)[1]);
    const want = a.tag === "circle" ? `fill:${pal[n]}` : `stroke:${pal[n]}`;
    assert.ok((a.style ?? "").includes(want), `${a.tag}.${a.class} has ${want}`);
  }
});

test("styledIds: a classed node after an unspaced open link (--- or -.-) is the node, not the arrow", () => {
  const ids = (line) => [...styledIds("flowchart LR\n  " + line).ids].sort();
  assert.deepEqual(ids("A:::hot---B:::cold"), ["A", "B"]);
  assert.deepEqual(ids("A:::hot-.-B:::cold"), ["A", "B"]);
  assert.deepEqual(ids("A---B:::cold"), ["B"]);
  assert.deepEqual(ids("A[x]---B:::cold"), ["B"]);
  assert.deepEqual(ids("A:::hot-->B:::cold"), ["A", "B"]);
  assert.deepEqual(ids("A-->B:::cold"), ["B"]);
  assert.deepEqual(ids("my-node:::x --- B"), ["my-node"]);
  assert.deepEqual(ids("A --- my-node:::x"), ["my-node"]);
});

test("paintDiagram: a stick-figure actor's name takes its colour too (its group holds a nested <g>)", () => {
  const src = "sequenceDiagram\n  actor U as User\n  participant S\n  U->>S: hi";
  const out = paintDiagram(draw(src), src, THEME);
  assert.match(out, new RegExp(`<text\\b[^>]*fill="${pal[0]}"[^>]*>User</text>`));
});

test("paintDiagram: with one palette colour, a chart's series keep beautiful-mermaid's colours", () => {
  const one = { background: "#101010", foreground: "#eeeeee", muted: "#888888", border: "#3f4147", accent: "#7aa2f7", dark: true };
  const src = "xychart-beta\n  x-axis [a, b, c]\n  bar [3, 5, 2]\n  line [1, 4, 3]";
  const out = paintDiagram(draw(src), src, one);
  assert.ok(tagsWith(out, "xychart-line").every((a) => !a.style), "lines unstyled");
  assert.ok(tagsWith(out, "xychart-bar").every((a) => !a.style), "bars unstyled");
});

test("paintDiagram: in an all-negative bar chart the bar of largest magnitude takes the accent", () => {
  const src = "xychart-beta\n  x-axis [a, b, c]\n  bar [-10, -100, -5]";
  const bars = tagsWith(paintDiagram(draw(src), src, THEME), "xychart-bar").filter((a) => a["data-value"] !== undefined);
  assert.match(bars.find((b) => b["data-value"] === "-100").style, new RegExp(`stroke:${THEME.accent}`));
  assert.match(bars.find((b) => b["data-value"] === "-10").style, new RegExp(`stroke:${THEME.muted}`));
});

test("styledIds: a hyphenated id right after an unspaced open link is read whole", () => {
  assert.deepEqual([...styledIds("flowchart LR\n  A---my-node:::x").ids], ["my-node"]);
});
