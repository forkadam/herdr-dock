# Render follow-ups: long links and the deferred minors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long Mermaid links (`A---->B`, `A-..->B`, `A====>B`, with labels) draw two nodes and one edge in their style,
and every deferred minor from the four reviews is closed.

**Architecture:** `patchMermaidIds` gains a list of exact-line rewrites (the class shorthand moves into it) that widen
beautiful-mermaid's two arrow patterns and normalise long operators in `arrowStyleFromOp`. `paint.js` walks node groups
by depth, skips series painting with one colour, and highlights the largest magnitude. `figure.js` checks role colour
contrast, flags noncharacters, and draws all blocks of a colour as one path. The rest is wording and missing tests.

**Tech Stack:** Node 22 ESM, `node:test`, esbuild, beautiful-mermaid 1.1.3.

**Spec:** `docs/superpowers/specs/2026-11-23-render-followups-design.md`

## Global Constraints

- Branch `render-followups`, cut from `main` (8a0edf5). Before finishing, check whether `main` moved. If it did,
  rebase and regenerate `app/` on conflicts, then rerun. Fast-forward `main` with `git fetch . HEAD:main`, or with
  `git -C ~/Dev/Workspace/herdr-dock merge --ff-only` when `main` is checked out there and that checkout is clean.
  Deploy from the merged state. Push only if Adam asks.
- `app/` is generated: run `npm run build:app` before any commit that touches `src/`.
- Baseline: `npm test` has one known failure, `tests/dock-core-class.test.mjs`.
- `\u` escapes (U+FFFE, U+FFFF, U+D800) go into files through a heredoc or a script, never the file editor. The editor
  turns them into raw characters, and a raw lone surrogate can't be stored.
- `LOOK_VERSION` = 7, set once in Task 1 for the whole branch, which is deployed once at the end.
- The rewrites, verbatim. In each pair the first line is what beautiful-mermaid ships today; the second is what it becomes.
  - Arrow pattern:
    - `var ARROW_REGEX = /^(<)?(-->|-.->|==>|---|-\.-|===)(?:\|([^|]*)\|)?/;`
    - `var ARROW_REGEX = /^(<)?(-{2,}>|-\.+->|={2,}>|-{3,}|-\.+-|={3,})(?:\|([^|]*)\|)?/;`
  - Text-arrow pattern:
    - `var TEXT_ARROW_REGEX = /^(<)?(--|-\.|==)\s+(.+?)\s+(-->|---|\.\->|-\.\-|==>|===)/;`
    - `var TEXT_ARROW_REGEX = /^(<)?(--|-\.|==)\s+(.+?)\s+(-{2,}>|-{3,}|\.+->|-\.+-|={2,}>|={3,})/;`
  - Arrow style: `function arrowStyleFromOp(op) {` becomes itself, followed on its next line by
    `  op = op.replace(/^-{2,}>$/, "-->").replace(/^-{3,}$/, "---").replace(/^-\.+->$/, "-.->").replace(/^-\.+-$/, "-.-").replace(/^={2,}>$/, "==>").replace(/^={3,}$/, "===");`
- Commits use `fix(render): …` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Short arrows** (`-->`, `-.->`, `==>`, `---`) draw exactly as before. Covered by the existing arrow tests, which
   must stay green.
2. **An upgrade that changes any rewritten line fails the build.** Test in Task 1.
3. **Mixed-sign bar charts** still highlight the tallest (`[46, 2029, -5]` → 2029). Covered by the existing test.
4. **Box-drawing lines** (stroked paths with `fill="none"`) never merge into the block paths. Test in Task 3.
5. **Blocks of one colour in different rows, or separated by spaces,** are one path with several rectangles. Test in
   Task 3.

---

### Task 1: Long links (bundle-time rewrites)

**Files:**
- Modify: `src/shared/render/mermaid-patch.js`
- Modify: `src/shared/render/cache.js` (`LOOK_VERSION = 7`)
- Test: `tests/render-mermaid-patch.test.mjs`
- Regenerated: `app/`

**Interfaces:**
- Produces: `LINE_REWRITES: { name, from, to }[]`, in this order:
  - class shorthand: `name` "class shorthand pattern", `from` `CLASS_SHORTHAND`, `to` `CLASS_SHORTHAND_BEFORE_ARROW`;
  - `name` "arrow pattern";
  - `name` "text arrow pattern";
  - `name` "arrow style", whose `to` is `from` plus the normalising line.

  Every `from` must occur exactly once in the source, or `patchMermaidIds` throws `beautiful-mermaid's ${name} changed`.
  The existing message "beautiful-mermaid's class shorthand pattern changed" is kept.

- [ ] **Step 1: Write the failing tests** (in `tests/render-mermaid-patch.test.mjs`)

  Replace the first test with this, and import `LINE_REWRITES`:

```js
test("patchMermaidIds: the 13 node-id patterns and each line rewrite, applied once; nothing else changes", () => {
  const src = readFileSync(DIST, "utf8");
  const out = patchMermaidIds(src);
  assert.equal(count(out, NODE_ID_BEFORE_ARROW) - count(src, NODE_ID_BEFORE_ARROW), 13);
  assert.equal(count(src, NODE_ID) - count(out, NODE_ID), 13);
  let grow = 13 * (NODE_ID_BEFORE_ARROW.length - NODE_ID.length);
  assert.equal(LINE_REWRITES.length, 4);
  for (const { name, from, to } of LINE_REWRITES) {
    assert.equal(count(src, from), 1, name);
    assert.equal(count(out, to), 1, name);
    grow += to.length - from.length;
  }
  assert.equal(out.length - src.length, grow);
});
```

  Add to the second test:

```js
  const noArrow = "var NODE_PATTERNS = [" + "/^([\\w-]+)/,".repeat(13) + "];\n" + LINE_REWRITES[0].from;
  assert.throws(() => patchMermaidIds(noArrow), /arrow pattern changed/);
```

  Append:

```js
const edgeStyle = (svg) => {
  const e = /<polyline class="edge"[^>]*>/.exec(svg)[0];
  return /stroke-dasharray/.test(e) ? "dotted" : Number(/stroke-width="([\d.]+)"/.exec(e)[1]) > 1 ? "thick" : "solid";
};

test("the built Render helper draws long links as two nodes and one edge, in their style", () => {
  const h = mkdtempSync(join(tmpdir(), "render-long-"));
  try {
    const cases = [["A---->B", "solid"], ["A-----B", "solid"], ["A-..->B", "dotted"], ["A-...-B", "dotted"], ["A====>B", "thick"],
      ["A=====B", "thick"], ["A<---->B", "solid"], ["A---->|x|B", "solid"], ["A-- text --->B", "solid"], ["A-. text ..->B", "dotted"],
      ["A== text ===>B", "thick"], ["A-->B", "solid"], ["A-.->B", "dotted"], ["A==>B", "thick"]];
    const f = join(h, "long.md");
    writeFileSync(f, cases.map(([c]) => "```mermaid\nflowchart LR\n  " + c + "\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const segs = JSON.parse(r.stdout).segments;
    assert.equal(segs.length, cases.length);
    segs.forEach((s, i) => {
      const svg = readFileSync(join(h, s.svg), "utf8");
      assert.equal((svg.match(/<g class="node"/g) ?? []).length, 2, cases[i][0]);
      assert.equal((svg.match(/class="edge"/g) ?? []).length, 1, cases[i][0]);
      assert.equal(edgeStyle(svg), cases[i][1], cases[i][0]);
    });
  } finally { rmSync(h, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/render-mermaid-patch.test.mjs`
Expected: FAIL. `LINE_REWRITES` is not exported.

- [ ] **Step 3: Implement**

- `mermaid-patch.js`: add `ARROW`, `ARROW_WIDE`, `TEXT_ARROW`, `TEXT_ARROW_WIDE`, `ARROW_STYLE_HEAD` and
  `ARROW_STYLE_NORMALISE` as the verbatim strings in Global Constraints, and `LINE_REWRITES`. After the node-id
  rewrite, apply each line rewrite with the exactly-once guard. The class shorthand moves into the list. Say why in
  the header.
- `cache.js`: `LOOK_VERSION = 7`.

- [ ] **Step 4: Rebuild `app/` and see the tests pass**

```bash
npm run build:app && node --test tests/render-mermaid-patch.test.mjs
```
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add src/shared/render/mermaid-patch.js src/shared/render/cache.js tests/render-mermaid-patch.test.mjs app
git commit -m "fix(render): long Mermaid links (A---->B, A-..->B, A====>B) draw two nodes and an edge in their style"
```

---

### Task 2: Painting minors (`paint.js`)

**Files:**
- Modify: `src/shared/render/paint.js` (the node walk, `paintDiagram`'s series step, `labelBars`)
- Test: `tests/render-paint.test.mjs`
- Regenerated: `app/`

- [ ] **Step 1: Write the failing tests** (append to `tests/render-paint.test.mjs`)

```js
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
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/render-paint.test.mjs`
Expected: 3 FAIL. The name keeps the default fill, the series are styled, and -5 is highlighted.

- [ ] **Step 3: Implement**

- **Node walk:** replace the `NODE_GROUP` regex walk with a scan that finds each node group's opening tag (same
  classes, `data-id`) and its matching `</g>`, counting nested `<g` and `</g>`.
- **Series step:** in `paintDiagram`, call it only when `palette.length >= 2`.
- **Bar highlight:** in `labelBars`, the highlighted bar is the first with the largest `Math.abs(value)`.

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/render-paint.test.mjs`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
npm run build:app
git add src/shared/render/paint.js tests/render-paint.test.mjs app
git commit -m "fix(render): a stick-figure actor's name is painted; one colour keeps series apart; all-negative charts highlight the largest bar"
```

---

### Task 3: Figure minors (`figure.js`)

**Files:**
- Modify: `src/shared/render/figure.js` (`roleStyle`, the checks, block drawing)
- Modify: `src/shared/render/paint.js` (export `contrast`)
- Test: `tests/render-figure.test.mjs`
- Regenerated: `app/`

**Interfaces:**
- Consumes: `contrast(a, b): number` (the WCAG ratio), now exported from `paint.js`.

- [ ] **Step 1: Write the failing tests** in `tests/render-figure.test.mjs`. Use a heredoc for anything with `\u`.

  Add a helper beside `texts`:

```js
// The rectangles of the █ path of one colour: [x, y, w, h] per run (box lines are stroked paths, fill="none").
const blocks = (svg, fill) => [...svg.matchAll(/<path\b([^>]*)\/>/g)].map((m) => attrs(m[1])).filter((p) => p.fill === fill)
  .flatMap((p) => [...p.d.matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)h-[\d.]+z/g)].map((r) => r.slice(1, 5).map(Number)));
```

  In the main `figureSvg` test, the block assertion becomes:

```js
  assert.deepEqual(blocks(svg, THEME.accent), [[X(0), FIGURE_PAD, 2 * FIGURE_CELL, FIGURE_LINE]]);
```

  The "bar of blocks" test becomes:

```js
  assert.deepEqual(blocks(figureSvg(["{ok:██}{ok:█} █"], THEME).svg, THEME.ansi2), [[X(0), FIGURE_PAD, 3 * FIGURE_CELL, FIGURE_LINE]]);
  assert.deepEqual(blocks(figureSvg(["{ok:██}{ok:█} █"], THEME).svg, THEME.foreground), [[X(4), FIGURE_PAD, FIGURE_CELL, FIGURE_LINE]]);
  assert.deepEqual(blocks(figureSvg(["{accent:█}{ok:█}"], THEME).svg, THEME.accent), [[X(0), FIGURE_PAD, FIGURE_CELL, FIGURE_LINE]]);
  assert.deepEqual(blocks(figureSvg(["{accent:█}{ok:█}"], THEME).svg, THEME.ansi2), [[X(1), FIGURE_PAD, FIGURE_CELL, FIGURE_LINE]]);
```

  Append:

```js
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
  for (const ch of ["￾", "￿", "\uD800"]) assert.deepEqual(checkFigure([`a${ch}b`]).map((f) => f.message), ["noncharacter, use plain text"]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/render-figure.test.mjs`
Expected: FAIL. Blocks are still `<rect>`s, faint colours are used, and noncharacters pass.

- [ ] **Step 3: Implement**

- **Blocks:** collect every block run in the figure (the row merging stays), group the runs by colour, and emit one
  `<path d="M{x} {y}h{w}v{h}h-{w}z …" fill="{colour}"/>` per colour after the text.
- **Role colours:** in `roleStyle`, `warn`/`ok`/`note` use `ansi1`/`ansi2`/`ansi3` only when they are hex and
  `contrast(colour, background) >= 3`. Otherwise they use `foreground`, and `warn` is bold.
- **Noncharacters:** add `NONCHARACTER = /[￾￿]|\p{Cs}/u` to the checks, after the invisible-character
  check, with the message `noncharacter, use plain text`. Write it with a script, not the editor.
- **`paint.js`:** export `contrast`.

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/render-figure.test.mjs tests/render-paint.test.mjs`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
npm run build:app
git add src/shared/render/figure.js src/shared/render/paint.js tests/render-figure.test.mjs app
git commit -m "fix(render): figure blocks of a colour are one shape, faint role colours fall back, noncharacters are flagged"
```

---

### Task 4: Wording, the missing tests, deploy

**Files:**
- Modify: `src/mods/dock-render/main.js` (header comment lines 2-3, the empty note at ~275)
- Modify: `src/shared/render/mermaid-patch.js` (header)
- Test: `tests/render-mermaid-patch.test.mjs`, `tests/render-paint.test.mjs`
- Regenerated: `app/`

- [ ] **Step 1: Add the pins.** They test behaviour that already works, so they pass when added; that is expected.

  - In "draws an arrow without spaces as two nodes and an edge", add `"A-. text .->B"` to `cases`, and add
    `assert.equal(JSON.parse(r.stdout).segments.length, cases.length);`.
  - Append to `tests/render-mermaid-patch.test.mjs`:

```js
test("the built Render helper: a bare classed node keeps its class; a hyphen inside a class name stays in it", () => {
  const h = mkdtempSync(join(tmpdir(), "render-pins-"));
  try {
    const f = join(h, "pins.md");
    writeFileSync(f, "```mermaid\nflowchart LR\n  A:::hot\n  classDef hot fill:#ff0000\n```\n\n```mermaid\nflowchart LR\n  A:::my-cls-->B\n```\n");
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const [bare, hyphen] = JSON.parse(r.stdout).segments.map((s) => readFileSync(join(h, s.svg), "utf8"));
    assert.equal((bare.match(/<g class="node"/g) ?? []).length, 1);
    assert.match(bare, /<g class="node" data-id="A"[^>]*>\s*<[a-z]+[^>]*fill="#ff0000"/);
    assert.equal((hyphen.match(/<g class="node"/g) ?? []).length, 2);
    assert.equal((hyphen.match(/class="edge"/g) ?? []).length, 1);
  } finally { rmSync(h, { recursive: true, force: true }); }
});
```

  - Append to `tests/render-paint.test.mjs`:

```js
test("styledIds: a hyphenated id right after an unspaced open link is read whole", () => {
  assert.deepEqual([...styledIds("flowchart LR\n  A---my-node:::x").ids], ["my-node"]);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/render-mermaid-patch.test.mjs tests/render-paint.test.mjs`
Expected: PASS.

- [ ] **Step 3: Wording**

- `main.js` header: "Answer … with its Mermaid diagrams and figures drawn"; "Diagrams  every Mermaid diagram and
  figure of the session, newest first".
- `main.js` empty note: `"No diagrams or figures in this session yet."`.
- `mermaid-patch.js` header: "As in Mermaid, an id can't contain `--`, `-.` or `->`: `my--node` reads as `my`."

- [ ] **Step 4: Rebuild, full suite, deploy**

```bash
npm run build:app && npm test 2>&1 | tail -8 && npm run deploy
```
Expected: `# fail 1` (only `tests/dock-core-class.test.mjs`); every deploy check passes.

- [ ] **Step 5: Commit**

```bash
git add src/mods/dock-render/main.js src/shared/render/mermaid-patch.js tests/render-mermaid-patch.test.mjs tests/render-paint.test.mjs app
git commit -m "fix(render): wording says diagrams and figures; tests pin the remaining arrow and class cases"
```
