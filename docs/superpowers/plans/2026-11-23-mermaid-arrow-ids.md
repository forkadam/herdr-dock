# Mermaid arrows without spaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Render panel, `A-->B` (and the other unspaced arrows) draws two nodes and an edge, not one node `A--`.

**Architecture:** A pure function rewrites beautiful-mermaid's 13 node-id patterns in its `dist/index.js` from
`[\w-]+` to `(?:\w|-(?![-.>]))+`. `scripts/build.mjs` applies it with an esbuild `onLoad` when it bundles the Render
helper. The look version goes to 4, so wrong drawings already cached are drawn again.

**Tech Stack:** Node 22 ESM, `node:test`, esbuild, beautiful-mermaid 1.1.3.

**Spec:** `docs/superpowers/specs/2026-11-23-mermaid-arrow-ids-design.md`

## Global Constraints

- Branch `mermaid-arrow-ids`, cut from `main`. Finish with `git fetch . HEAD:main`, and never `git checkout main`.
- `app/` is generated. Run `npm run build:app` before any commit that touches `src/` or `scripts/build.mjs`.
- Baseline `npm test` has one known failure, `tests/dock-core-class.test.mjs` (Node 22.14 has no
  `module.registerHooks`). Every full-suite step expects that one failure and no other.
- The rule, verbatim: `[\w-]+` becomes `(?:\w|-(?![-.>]))+`, between `var NODE_PATTERNS = [` and
  `var CLASS_SHORTHAND_REGEX`, exactly 13 times.
- Credit line: `The id rule is prismantis's (scripts/build-vendor.mjs, MIT, (c) 2026 Nahum Litvin:
  https://github.com/NahumLitvin/prismantis).`
- Commits use `fix(render): …` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A beautiful-mermaid upgrade that moves or changes the patterns.** The build fails with a message saying what
   moved; it never ships unpatched. Test in Task 1.
2. **Hyphenated ids** (`my-node-->other-node`, `A-B-->C`) keep their hyphens. Test in Task 2.
3. **Spaced arrows and `==>`** draw as before. Test in Task 2.
4. **A diagram cached before the fix** is drawn again: `LOOK_VERSION` is 4. Checked by Task 2's step 3.
5. **Running the helper from `src/` directly** stays unpatched, by design. The new behaviour is tested on the built
   bundle, which `tests/build-app.test.mjs` keeps equal to a fresh build.

---

### Task 1: The rewrite, pure (`mermaid-patch.js`)

**Files:**
- Create: `src/shared/render/mermaid-patch.js`
- Test: `tests/render-mermaid-patch.test.mjs`

**Interfaces:**
- Produces: `NODE_ID = "[\\w-]+"`, `NODE_ID_BEFORE_ARROW = "(?:\\w|-(?![-.>]))+"`, and
  `patchMermaidIds(source: string): string`. It throws `Error` when an anchor is missing, or when the region doesn't
  hold exactly 13 `NODE_ID`s.

- [ ] **Step 1: Write the failing tests** in `tests/render-mermaid-patch.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NODE_ID, NODE_ID_BEFORE_ARROW, patchMermaidIds } from "../src/shared/render/mermaid-patch.js";

const DIST = fileURLToPath(import.meta.resolve("beautiful-mermaid"));
const count = (s, sub) => s.split(sub).length - 1;

test("patchMermaidIds: the 13 node-id patterns get the arrow-aware id; nothing else changes", () => {
  const src = readFileSync(DIST, "utf8");
  const out = patchMermaidIds(src);
  assert.equal(count(out, NODE_ID_BEFORE_ARROW) - count(src, NODE_ID_BEFORE_ARROW), 13);
  assert.equal(count(src, NODE_ID) - count(out, NODE_ID), 13);
  assert.equal(out.length - src.length, 13 * (NODE_ID_BEFORE_ARROW.length - NODE_ID.length));
});

test("patchMermaidIds: fails loudly when beautiful-mermaid's node patterns move or change", () => {
  assert.throws(() => patchMermaidIds("var x = 1;"), /NODE_PATTERNS/);
  const twelve = "var NODE_PATTERNS = [" + "/^([\\w-]+)/,".repeat(12) + "];\nvar CLASS_SHORTHAND_REGEX = 1;";
  assert.throws(() => patchMermaidIds(twelve), /12 node-id patterns, expected 13/);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/render-mermaid-patch.test.mjs`
Expected: FAIL. Cannot find module `src/shared/render/mermaid-patch.js`.

- [ ] **Step 3: Implement `patchMermaidIds` in `src/shared/render/mermaid-patch.js`**

The file is pure, with no imports. Its header says why the rewrite exists and carries the credit line. If either
anchor is missing, throw `beautiful-mermaid no longer declares NODE_PATTERNS before CLASS_SHORTHAND_REGEX`. If the
count is wrong, throw `beautiful-mermaid has ${n} node-id patterns, expected 13`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/render-mermaid-patch.test.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/render/mermaid-patch.js tests/render-mermaid-patch.test.mjs
git commit -m "fix(render): a rewrite of beautiful-mermaid's node ids so a hyphen that starts an arrow isn't part of the id (pure)"
```

---

### Task 2: Applied when the helper is bundled; redrawn; documented

**Files:**
- Modify: `scripts/build.mjs` (the `dock-render` helper's `build({...})`)
- Modify: `src/shared/render/cache.js` (`LOOK_VERSION`)
- Modify: `README.md` (Render section, the beautiful-mermaid bullet)
- Test: `tests/render-mermaid-patch.test.mjs`
- Regenerated: `app/`

**Interfaces:**
- Consumes: `patchMermaidIds` (Task 1).

- [ ] **Step 1: Write the failing test** (append to `tests/render-mermaid-patch.test.mjs`)

```js
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUILT = join(import.meta.dirname, "..", "app", "mods", "dock-render", "herdr-render.mjs");
const THEME = { background: "#1e1f22", foreground: "#d4d4d8", muted: "#8b8d94", border: "#3f4147", accent: "#7aa2f7", dark: true };

test("the built Render helper draws an arrow without spaces as two nodes and an edge", () => {
  const h = mkdtempSync(join(tmpdir(), "render-ids-"));
  try {
    const cases = ["A-->B", "A-->|x|B", "A---B", "A-.->B", "A-- text -->B", "my-node-->other-node", "A-B-->C", "A --> B", "A==>B"];
    const f = join(h, "ids.md");
    writeFileSync(f, cases.map((c) => "```mermaid\nflowchart LR\n  " + c + "\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    JSON.parse(r.stdout).segments.forEach((s, i) => {
      const svg = readFileSync(join(h, s.svg), "utf8");
      assert.equal((svg.match(/<g class="node"/g) ?? []).length, 2, cases[i]);
      assert.equal((svg.match(/class="edge"/g) ?? []).length, 1, cases[i]);
    });
    assert.match(readFileSync(join(h, JSON.parse(r.stdout).segments[5].svg), "utf8"), /data-id="my-node"/);
  } finally { rmSync(h, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/render-mermaid-patch.test.mjs`
Expected: FAIL on `A-->B`. The committed bundle is unpatched, so it finds 1 node, not 2.

- [ ] **Step 3: Implement**

- `scripts/build.mjs`: in the `dock-render` helper's `build({...})`, add
  `plugins: [{ name: "beautiful-mermaid-ids", setup(b) { b.onLoad({ filter: /beautiful-mermaid[\\/]dist[\\/]index\.js$/ }, (a) => ({ contents: patchMermaidIds(readFileSync(a.path, "utf8")), loader: "js" })); } }]`.
  Import `patchMermaidIds` from `../src/shared/render/mermaid-patch.js`, and `readFileSync` if it isn't imported yet.
  Add a one-line comment on why.
- `src/shared/render/cache.js`: `LOOK_VERSION = 4`.
- `README.md`: append to the "Diagrams are drawn by `beautiful-mermaid`…" bullet: "Its node ids are patched as it is
  bundled, so an arrow written without spaces (`A-->B`) isn't read as part of the id (the rule
  [prismantis](https://github.com/NahumLitvin/prismantis) uses, MIT)."

- [ ] **Step 4: Rebuild `app/` and see the test pass**

```bash
npm run build:app && node --test tests/render-mermaid-patch.test.mjs
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Full suite and deploy**

```bash
npm test 2>&1 | tail -8 && npm run deploy
```
Expected: `# fail 1` (only `tests/dock-core-class.test.mjs`); deploy's checks all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/build.mjs src/shared/render/cache.js README.md tests/render-mermaid-patch.test.mjs app
git commit -m "fix(render): arrows written without spaces (A-->B) draw two nodes, not one"
```
