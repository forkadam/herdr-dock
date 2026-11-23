# Styled node after an unspaced open link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `A:::hot---B:::cold`, `A:::hot-.-B:::cold`, `A---B:::cold` and `A[x]---B:::cold`, node B keeps `cold`'s colour
in the Render panel instead of being painted with a palette colour.

**Architecture:** `idBefore` in `src/shared/render/paint.js` cuts the id it finds at the last arrow-starting hyphen run,
so `styledIds` names B and `paintDiagram` leaves it as drawn. The look version goes to 6.

**Tech Stack:** Node 22 ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-23-render-prismantis-look-design.md` (its last Addendum)

## Global Constraints

- Branch `render-styled-open-link`, cut from `main` (60ab3aa). Before finishing, check `main` hasn't moved (rebase and
  regenerate `app/` if it has); fast-forward with `git fetch . HEAD:main`, or `git -C ~/Dev/Workspace/herdr-dock merge
  --ff-only` when `main` is checked out there and that checkout is clean.
- `app/` is generated: run `npm run build:app` before committing.
- Baseline: `npm test` has one known failure, `tests/dock-core-class.test.mjs`.
- The cut, verbatim: `token.split(/-(?=[-.>])[-.]*/).pop()`; an empty result means no id (`null`).
- Commit: `fix(render): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Hyphenated ids** (`my-node:::x`, `A --- my-node:::x`) keep their hyphen. Test in step 1.
2. **Arrows with `>`** (`A:::hot-->B:::cold`, `A-->B:::cold`) read as before. Test in step 1.
3. **A shape before the open link** (`A[x]---B:::cold`): B, not `---B`. Test in step 1.
4. **End to end through the patched build:** B's fill stays `cold`'s blue. Test in step 1. The unpatched library used
   by `tests/render-paint.test.mjs` can't draw these as two nodes.
5. **Cached drawings are redrawn:** `LOOK_VERSION` is 6. Set in step 3.

---

### Task 1: The id before `:::`, cut at the arrow

**Files:**
- Modify: `src/shared/render/paint.js` (`idBefore`)
- Modify: `src/shared/render/cache.js` (`LOOK_VERSION`)
- Test: `tests/render-paint.test.mjs`, `tests/render-mermaid-patch.test.mjs`
- Regenerated: `app/`

- [ ] **Step 1: Write the failing tests**

Append to `tests/render-paint.test.mjs`:

```js
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
```

Append to `tests/render-mermaid-patch.test.mjs`:

```js
test("the built Render helper keeps a classed node's colour after an unspaced open link", () => {
  const h = mkdtempSync(join(tmpdir(), "render-open-"));
  try {
    const cases = ["A:::hot---B:::cold", "A:::hot-.-B:::cold", "A---B:::cold", "A[x]---B:::cold"];
    const f = join(h, "open.md");
    writeFileSync(f, cases.map((c) => "```mermaid\nflowchart LR\n  " + c + "\n  classDef hot fill:#ff0000\n  classDef cold fill:#0000ff\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const segs = JSON.parse(r.stdout).segments;
    assert.equal(segs.length, cases.length);
    segs.forEach((s, i) => {
      const svg = readFileSync(join(h, s.svg), "utf8");
      assert.match(svg, /<g class="node" data-id="B"[^>]*>\s*<[a-z]+[^>]*fill="#0000ff"/, `${cases[i]}: B keeps cold's blue`);
    });
  } finally { rmSync(h, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/render-paint.test.mjs tests/render-mermaid-patch.test.mjs`
Expected: FAIL. `styledIds` gives `hot---B`, and the built helper paints B with a palette colour.

- [ ] **Step 3: Implement**

- `paint.js` `idBefore`: after its `[\w.-]+` match, return `token.split(/-(?=[-.>])[-.]*/).pop() || null`. Say why in
  a comment.
- `cache.js`: `LOOK_VERSION = 6`.

- [ ] **Step 4: Rebuild `app/` and see the tests pass**

```bash
npm run build:app && node --test tests/render-paint.test.mjs tests/render-mermaid-patch.test.mjs
```
Expected: PASS, every test.

- [ ] **Step 5: Full suite and deploy**

```bash
npm test 2>&1 | tail -8 && npm run deploy
```
Expected: `# fail 1` (only `tests/dock-core-class.test.mjs`); every deploy check passes.

- [ ] **Step 6: Commit**

```bash
git add src/shared/render/paint.js src/shared/render/cache.js tests/render-paint.test.mjs tests/render-mermaid-patch.test.mjs app
git commit -m "fix(render): a classed node after an unspaced open link (A---B:::cold) keeps its colour"
```
