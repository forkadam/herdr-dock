# Render panel: prismantis's look — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Render panel's diagrams get a colour per node, values on bar charts, drawn ```` ```figure ```` blocks, and
a minimum size, so they hold up next to prismantis's.

**Architecture:** Two new pure modules: `figure.js` (prismantis's figure syntax and checks, ported, drawn as SVG) and
`paint.js` (recolours beautiful-mermaid's flattened SVG). The helper sends figures and diagrams through the same
cache, with a look version in the theme id. The panel shows both with `image()`, never below 70% of natural size,
scrolling sideways when wider.

**Tech Stack:** Node 22 ESM, `node:test`, beautiful-mermaid 1.1.3, esbuild (the build), Herdr mod API
(`gpui-kit`, `gpui-base`, `herdr`).

**Spec:** `docs/superpowers/specs/2026-11-23-render-prismantis-look-design.md`

## Global Constraints

- Branch `render-prismantis-look` (cut from `main`). Finish by fast-forwarding `main` with `git fetch . HEAD:main`.
  Never `git checkout main`: the main checkout is in use by another agent.
- Modules in `src/shared/render/` are pure: no `herdr`, `gpui-*` or `node:fs` imports (header comment says so, as in
  the existing files).
- Cache file names stay `^[0-9a-f]{8}-[0-9a-f]{8}\.svg$`. `cache.js`'s tidy only deletes names matching that pattern.
- `app/` is generated. Before every commit that touches `src/`, run `npm run build:app` and commit what it changes
  in `app/`. Never edit `app/` by hand, except `app/RECIPE.md`, which build:app keeps.
- Baseline: `npm test` has exactly one failure before this work, `tests/dock-core-class.test.mjs`. It fails because
  Node 22.14 has no `registerHooks` in `node:module`. It is not this work's to fix. Every "full suite" step expects that
  one failure and no other.
- Credit line for ported prismantis code: `Ported from prismantis's hooks/figure.tsx (MIT, (c) 2026 Nahum Litvin:
  https://github.com/NahumLitvin/prismantis).`
- Spec values: minimum scale `0.7`; figures at most `100` columns and `80` lines; node palette
  `ansi4, ansi6, ansi2, ansi5, ansi3, accent` with no red; figure roles `accent→accent, warn→ansi1, ok→ansi2,
  note→ansi3, dim→dim, strong→foreground bold`, unmarked text `foreground`.
- Commit messages follow the repo's style, `feat(render): …` (lower case, says what the user gets), ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A theme without `dim` or `ansi*`** (the helper tests' `THEME`, or any partial theme). The palette falls back to
   `accent`; `dim` falls back to `muted`; `warn`, `ok` and `note` fall back to `foreground`, with `warn` bold.
   Tests in Task 1 and Task 2.
2. **A light theme whose yellow or cyan can't be read on white.** Those colours are dropped from the palette.
   Test in Task 2.
3. **Figure text with `<`, `&` or `"`.** It is escaped, and the SVG stays valid. Test in Task 1.
4. **An answer still streaming, ending inside an open ```` ```figure ```` fence.** It stays text, with no error box
   flashing. Test in Task 3.
5. **The same text in a Mermaid block and a figure block.** They get two ids and two cache files, and the Diagrams
   view lists both. Test in Task 3.

---

### Task 1: Figures, pure (`figure.js`)

**Files:**
- Create: `src/shared/render/figure.js`
- Test: `tests/render-figure.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `FIGURE_ROLES: string[]`, `FIGURE_MAX_COLUMNS = 100`, `FIGURE_MAX_LINES = 80`
  - `FIGURE_FONT = 13`, `FIGURE_CELL = 7.8`, `FIGURE_LINE = 18`, `FIGURE_PAD = 10` (px)
  - `graphemes(s: string): string[]`, `width(s: string): number`
  - `figureRuns(line: string): { text: string, role?: string }[]`
  - `checkFigure(lines: string[], first = 0): { line: number, message: string }[]`
  - `decideFigure(source: string): { lines: string[] } | { note: string }`
  - `figureSvg(lines: string[], theme): { svg: string, w: number, h: number }`. `theme` has `background, foreground,
    muted, accent`, and optionally `dim, ansi1, ansi2, ansi3`.

- [ ] **Step 1: Write the failing tests** in `tests/render-figure.test.mjs`

```js
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
  assert.deepEqual(msg("a​b"), ["invisible character, use plain text"]);
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
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/render-figure.test.mjs`
Expected: FAIL. Cannot find module `src/shared/render/figure.js`.

- [ ] **Step 3: Implement `src/shared/render/figure.js`**

- Port `figureRuns`, `checkFigure` (with `markupMessages`, `swapsTwoLetters`, `quoted`, `lineMessages`), and
  prismantis's `decide` (as `decideFigure`, taking the source string and splitting it on `\n`), from prismantis's
  `hooks/figure.tsx` (`~/.claude/plugins/cache/prismantis/prismantis/0.20.0/hooks/figure.tsx`). Also port
  `graphemes`, `width` and the `WIDE` regex from its `hooks/render.tsx`. TypeScript types become plain JS.
- Leave out prismantis's Ink element, its `figureRoleColors` hue picking and its "wider than the terminal" check.
  Put the credit line from Global Constraints in the file header.
- `figureSvg`:
  - Cell `(row, col)` has its top-left at `(FIGURE_PAD + col × FIGURE_CELL, FIGURE_PAD + row × FIGURE_LINE)`.
  - `█` is a `<rect>` of exactly that cell, in its run's colour.
  - Every other non-space character is drawn by a `<text>` per run of consecutive non-space, non-`█` graphemes with
    the same role. Its `x` holds one position per character, and its `y` is the row's baseline (the builder picks the
    offset in the cell). It also has `font-family="monospace"`, `font-size` = `FIGURE_FONT`, `fill`, and
    `font-weight="bold"` for `strong`, or for `warn` when there's no `ansi1`.
  - Spaces draw nothing.
  - The root is `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 w h" width="w" height="h">`, followed by the
    background rect.
  - Escape `&`, `<`, `>` and `"`.
  - Colours are as in Global Constraints, with the fallbacks from Review Focus 1.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/render-figure.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/render/figure.js tests/render-figure.test.mjs
git commit -m "feat(render): figures in prismantis's syntax, checked and drawn as SVG (pure)"
```

---

### Task 2: Painting, pure (`paint.js`)

**Files:**
- Create: `src/shared/render/paint.js`
- Test: `tests/render-paint.test.mjs`

**Interfaces:**
- Consumes: `mix(a, p, b)` from `src/shared/render/flatten.js`.
- Produces:
  - `mermaidColors(theme): { bg, fg, line, accent, muted, surface, border, font }`. This moves `colors()` out of
    `src/app/render-helper.js` unchanged, so the tests draw exactly what the helper draws.
  - `nodePalette(theme): string[]`
  - `styledIds(source: string): { all: boolean, ids: Set<string> }`
  - `paintDiagram(svg: string, source: string, theme): string`. This is the helper's only entry. It never throws; on
    any trouble it returns `svg` unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/render-paint.test.mjs`

```js
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
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/render-paint.test.mjs`
Expected: FAIL. Cannot find module `src/shared/render/paint.js`.

- [ ] **Step 3: Implement `src/shared/render/paint.js`**

- `nodePalette`: take `[ansi4, ansi6, ansi2, ansi5, ansi3, accent]` in that order. Drop missing and non-hex values,
  then duplicates (case-insensitive), then any colour whose WCAG contrast ratio against `background` is below `3`. If
  none are left, return `[accent]`, or `[]` when there's no accent.
- `styledIds`:
  - Ids come from `style <id>`; from `class <id>[,<id>…] <name>` unless the source starts with `classDiagram`; from
    `cssClass "<id>[,<id>…]" <name>`; and from `<id>…:::<name>`, the node token before `:::`.
  - `all` is true when there's a `classDef default`.
- `paintDiagram(svg, source, theme)`:
  1. **Nodes.** Walk the `<g class="node|class-node|entity|actor" data-id=…>` groups in document order. Skip ids
     starting with `_start` or `_end`, skip styled ids, and skip every group when `all` is set. Each remaining distinct
     id gets the next palette colour (cycling). Inside the group, every `stroke="#…"` and every `<text>` `fill`
     becomes the colour. Every other `fill="#…"` becomes `mix(colour, t, thatFill)`, so ER and class row shades are
     kept (the builder picks `t`).
  2. **Series.** Only when the source has two or more `bar`/`line` lines. Elements of class `xychart-color-N` get an
     inline `style` that overrides beautiful-mermaid's CSS: `xychart-bar` gets `fill:<tint>;stroke:<pal[N]>`,
     `xychart-line` gets `stroke:<pal[N]>`, and `xychart-dot` gets `fill:<pal[N]>`.
  3. **Bar values.** Only when the source has exactly one `bar`/`line` line, it is `bar`, and the source doesn't match
     `/^\s*xychart(-beta)?\s+horizontal/m`.
     - Each element with `data-value` gets its colour style: `stroke` is `accent` for the largest value and `muted`
       for the rest, with a tint fill.
     - Each also gets a `<text class="render-bar-value" text-anchor="middle" font-size="12" fill="<muted>">`, centred
       on the bar. It sits 6 px above the bar's top, or for a negative value 6 px plus the font size below its bottom.
     - If a label's top (`y − 12`) is above the viewBox, grow the viewBox upward, along with `height` and the
       background rect `flattenSvg` added (the `<rect>` whose x/y/width/height equal the old viewBox).
  4. Wrap all of it in `try`/`catch`. Return the input unchanged on a throw, when there's no `<svg`, or when the
     result matches `/var\(|color-mix|<foreignObject/i`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/render-paint.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/render/paint.js tests/render-paint.test.mjs
git commit -m "feat(render): paint diagrams after rendering: a colour per node and series, values on bar charts (pure)"
```

---

### Task 3: The helper draws figures and painted diagrams

**Files:**
- Modify: `src/shared/render/markdown.js` (`splitSegments`, new `blockId`, `pictureBlocks`)
- Modify: `src/shared/render/transcript.js:12-30` (`fold`)
- Modify: `src/shared/render/cache.js` (`LOOK_VERSION`, `themeKey`)
- Modify: `src/app/render-helper.js` (`colors` removed, `render`, `segments`, `fromLog`, `run`'s `file` case)
- Modify: `src/mods/dock-render/main.js` (`segments()`: one line)
- Test: `tests/render-core.test.mjs`, `tests/render-helper.test.mjs`
- Regenerated: `app/` (by `npm run build:app`)

**Interfaces:**
- Consumes: `decideFigure`, `figureSvg` (Task 1); `paintDiagram`, `mermaidColors`, `nodePalette` (Task 2).
- Produces:
  - `blockId(kind: "mermaid" | "figure", source: string): string`. Mermaid gives `hashText(source)`, as today; figure
    gives `hashText("figure\n" + source)`.
  - `splitSegments(text)` returns `{ kind: "md", text } | { kind: "mermaid" | "figure", source, id }`.
  - `pictureBlocks(text): { kind, source }[]`
  - `fold` / `readClaude` / `readCodex` return `diagrams: { kind, source, id, at }[]`.
  - `LOOK_VERSION = 2`; `themeKey(theme): string` = `hashText(\`look${LOOK_VERSION}|${JSON.stringify(theme)}\`)`.
  - The helper's picture segments and diagrams: `{ kind, source, id, svg, w, h }` or `{ kind, source, id, error }`.
    File name `${id}-${themeKey(theme)}.svg`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/render-core.test.mjs`:

```js
import { blockId, pictureBlocks } from "../src/shared/render/markdown.js";
import { themeKey } from "../src/shared/render/cache.js";

test("splitSegments: ```figure blocks (any case) are pictures; an open one (still streaming) stays text", () => {
  const s = splitSegments("a\n```figure\nA {ok:B}\n```\n```FIGURE\nx\n```");
  assert.deepEqual(s.map((x) => x.kind), ["md", "figure", "figure"]);
  assert.equal(s[1].source, "A {ok:B}");
  assert.equal(s[1].id, blockId("figure", "A {ok:B}"));
  assert.deepEqual(splitSegments("a\n```figure\nA {ok:B}").map((x) => x.kind), ["md"]);
});

test("blockId: the same text as Mermaid and as a figure gives two ids", () => {
  assert.equal(blockId("mermaid", "graph TD"), hashText("graph TD"));
  assert.notEqual(blockId("figure", "graph TD"), blockId("mermaid", "graph TD"));
  assert.deepEqual(pictureBlocks("```figure\nA\n```\n```mermaid\nA\n```"), [{ kind: "figure", source: "A" }, { kind: "mermaid", source: "A" }]);
});

test("readClaude: the session's pictures hold figures too, each with its kind", () => {
  const l = [JSON.stringify({ type: "user", message: { content: "draw" }, timestamp: "2026-11-23T10:00:00Z" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "```figure\nA\n```\n```mermaid\nA\n```" }] }, timestamp: "2026-11-23T10:00:01Z" })];
  assert.deepEqual(readClaude(l).diagrams.map((d) => [d.kind, d.source]), [["mermaid", "A"], ["figure", "A"]]);
});

test("themeKey: the look version is part of the theme id, so drawings from before a look change aren't reused", () => {
  const t = { background: "#000000" };
  assert.match(themeKey(t), /^[0-9a-f]{8}$/);
  assert.notEqual(themeKey(t), hashText(JSON.stringify(t)));
});
```

Add to `tests/render-helper.test.mjs` (import `themeKey` from `../src/shared/render/cache.js`):

```js
test("figures and painted diagrams: kinds, files named with the look version, a failed figure's reason", () => {
  const x = home();
  try {
    const f = join(x.h, "look.md");
    writeFileSync(f, "```figure\nA {ok:██} B\n```\n\n```mermaid\nflowchart LR\n  A-->B\n```\n\n```figure\nbad\tline\n```\n\n```mermaid\nA {ok:██} B\n```\n");
    const out = run({ ...x.base, mode: "file", path: f });
    const s = out.segments;
    assert.deepEqual(s.map((g) => g.kind), ["figure", "mermaid", "figure", "mermaid"]);
    assert.ok(s[0].svg.endsWith(`-${themeKey(THEME)}.svg`) && s[0].w > 0 && s[0].h > 0);
    assert.match(readFileSync(join(x.h, s[0].svg), "utf8"), /^<svg/);
    // Inside node A's own group (arrowheads are accent already, so a match anywhere would prove nothing).
    const groupA = /<g class="node" data-id="A"[^>]*>([\s\S]*?)<\/g>/.exec(readFileSync(join(x.h, s[1].svg), "utf8"))[1];
    assert.match(groupA, new RegExp(`stroke="${THEME.accent}"`));
    assert.equal(s[2].error, "figure line 1: tab, use spaces");
    assert.ok(!s[2].svg);
    assert.notEqual(s[0].id, s[3].id);
  } finally { x.done(); }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/render-core.test.mjs tests/render-helper.test.mjs`
Expected: FAIL. `blockId` / `pictureBlocks` / `themeKey` are not exported, and the helper test sees `["md", "mermaid", "md", "mermaid"]`.

- [ ] **Step 3: Implement**

- `markdown.js`:
  - In `splitSegments`, a fence whose lowercased info string is `mermaid` or `figure` becomes
    `{ kind, source, id: blockId(kind, source) }`.
  - Add `blockId` and `pictureBlocks`. Keep `mermaidBlocks` as it is.
- `transcript.js`: in `fold`, use `pictureBlocks`, so entries become `{ kind, source, id: blockId(kind, source), at }`.
- `cache.js`: add `LOOK_VERSION` and `themeKey` (import `hashText` from `./markdown.js`).
- `render-helper.js`:
  - Delete `colors()` and import `mermaidColors` from `paint.js`. `themeId` is now `themeKey(req.theme)` everywhere.
  - `render(seg, req, themeId)` takes the whole segment. It keeps the `MAX_SOURCE` check, the cache hit and touch,
    the temp-and-rename write, and the `w`/`h` read, and the file name is `${seg.id}-${themeId}.svg`.
  - Mermaid draws `paintDiagram(flattenSvg(renderMermaidSVG(source, mermaidColors(theme)), theme.background), source, theme)`.
  - A figure runs `decideFigure(source)`. A `note` returns `{ error: note }` without writing anything; otherwise it
    draws `figureSvg(lines, theme).svg`.
  - `segments()` and `fromLog` render every segment or diagram whose kind isn't `md`, keeping its `kind`, `source`
    and `id`.
- `main.js` `segments()`: test `s.kind === "md"` for Markdown and send everything else to `this.diagram(...)`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/render-core.test.mjs tests/render-helper.test.mjs tests/render-figure.test.mjs tests/render-paint.test.mjs`
Expected: PASS, every test, old and new.

- [ ] **Step 5: Rebuild `app/`, run the full suite, commit**

```bash
npm run build:app && npm test 2>&1 | tail -8
```
Expected: `# fail 1`, and that one is `tests/dock-core-class.test.mjs` (see Global Constraints).

```bash
git add src/shared/render src/app/render-helper.js src/mods/dock-render/main.js tests app
git commit -m "feat(render): the helper draws figures and painted diagrams, named with a look version"
```

---

### Task 4: The panel: minimum size, figure failures, theme colours, docs, tried live

**Files:**
- Create: `src/shared/render/size.js`
- Modify: `src/mods/dock-render/main.js` (`request()`, `diagram()`)
- Modify: `README.md:346-377` (Render section), `app/RECIPE.md:43` (the `dock-render` entry)
- Test: `tests/render-core.test.mjs`
- Regenerated: `app/`

**Interfaces:**
- Consumes: the helper's picture segments (Task 3).
- Produces: `MIN_SCALE = 0.7`; `shownSize(size: { w?, h? }, room: number): { w: number, h: number, scroll: boolean }`.

- [ ] **Step 1: Write the failing test** in `tests/render-core.test.mjs`

```js
import { shownSize } from "../src/shared/render/size.js";

test("shownSize: natural size when it fits; never below 70% (then it scrolls); never below 40; no size → the room", () => {
  assert.deepEqual(shownSize({ w: 300, h: 150 }, 332), { w: 300, h: 150, scroll: false });
  assert.deepEqual(shownSize({ w: 424, h: 280 }, 332), { w: 332, h: 219, scroll: false });
  assert.deepEqual(shownSize({ w: 750, h: 464 }, 332), { w: 525, h: 325, scroll: true });
  assert.deepEqual(shownSize({ w: 20, h: 10 }, 332), { w: 40, h: 20, scroll: false });
  assert.deepEqual(shownSize({}, 332), { w: 332, h: 199, scroll: false });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/render-core.test.mjs`
Expected: FAIL. Cannot find module `src/shared/render/size.js`.

- [ ] **Step 3: Implement `shownSize` in `src/shared/render/size.js`**

- `w = round(n)` when `n ≤ room`, else `round(max(room, MIN_SCALE × n))`; then at least `40`.
- `h = round(w × h / n)`; with no size, `w = room` and `h = round(room × 0.6)`.
- `scroll = w > room`.

- [ ] **Step 4: Run it and see it pass**

Run: `node --test tests/render-core.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire the panel** (`src/mods/dock-render/main.js`)

- `request()`: the `theme` object also sends `dim: t.dim` and `ansi1` to `ansi6` from `theme()`.
- `diagram()`:
  - Use `shownSize(s, maxW)` for the image's size.
  - When `scroll`, wrap the clickable bordered image in
    `div().id(\`${id}-scroll\`).w(maxW).overflow_x_scrollbar()`. Clicking the image still opens the zoom.
  - A failed figure (`s.kind === "figure" && s.error`) shows `s.error` in `t.dim` at `text_size(11.5)`, then
    `TextView.markdown(\`${id}-src\`, "```figure\n" + s.source + "\n```")`.
  - A failed Mermaid diagram stays as it is today.

- [ ] **Step 6: Docs**

- **README, Render section:**
  - **Answer** draws ```` ```figure ```` blocks too.
  - **Diagrams** lists figures as well.
  - A new bullet: each node, participant and chart series gets its own colour from your terminal's colours. A
    node styled in the source with `classDef`/`style` keeps its own colours. A single-series bar chart shows each
    value, with the tallest in the accent colour.
  - A new bullet: figures (prismantis's syntax: `{accent|warn|ok|note|dim|strong:text}`, at most 100 columns and 80
    lines). A figure that can't be drawn shows why, then its source. Credit prismantis (MIT) with a link, as
    herdr-chat is credited.
  - A new bullet: a picture is never shown below 70% of its size; a wider one scrolls sideways.
  - In "Where Render keeps its diagrams", the name's second hash is "of the theme and the look version".
- **`app/RECIPE.md`:** `dock-render`'s entry says "with Mermaid diagrams and figures drawn by a bundled helper".

- [ ] **Step 7: Rebuild, run the full suite, deploy (it runs `herdr-app check` on every mod)**

```bash
npm run build:app && npm test 2>&1 | tail -8 && npm run deploy
```
Expected: `# fail 1` (only `tests/dock-core-class.test.mjs`); deploy ends with every mod's check passing.

- [ ] **Step 8: Try it live**

Write the comparison sample from the design (a flowchart with a `style` node, a sequence diagram, a single-series bar
chart with one tall bar, a multi-series chart, and a figure with a `▏───▏` axis and `█` bars) to a `.md` file in the
repo's scratch area. Open it in Render → Files in a dark theme, then a light one. Ask Adam to confirm what he sees:

- nodes in distinct colours, with the styled one unchanged;
- values over the bars;
- the figure's columns lined up and its bars solid;
- the wide chart scrolling sideways;
- clicking any picture opens it large.

Herdr's SVG renderer must honour per-character `x` lists and inline `style`. If the figure's columns or the series
colours don't show, stop and report it before committing.

- [ ] **Step 9: Commit**

```bash
git add src/shared/render/size.js src/mods/dock-render/main.js tests/render-core.test.mjs README.md app
git commit -m "feat(render): pictures never shrink below 70% (wider ones scroll), figure failures show why, documented"
```
