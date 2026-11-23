# Mermaid `:::class` before an unspaced arrow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `A:::hot-->B` draws A with class `hot`, then B and the edge. Today it draws one node with class `hot--`.

**Architecture:** `patchMermaidIds` (src/shared/render/mermaid-patch.js) also rewrites beautiful-mermaid's class-shorthand
line with the same arrow-aware rule. The build hook already applies it, so the build is unchanged. The look version
goes to 5.

**Tech Stack:** Node 22 ESM, `node:test`, esbuild, beautiful-mermaid 1.1.3.

**Spec:** `docs/superpowers/specs/2026-11-23-mermaid-arrow-ids-design.md` (its Addendum)

## Global Constraints

- Branch `mermaid-class-arrow`, cut from `main` (d37022f). Before finishing, check that `main` hasn't moved; if it has,
  rebase and regenerate `app/` on conflicts. Fast-forward `main` (`git fetch . HEAD:main`). If `main` is checked out
  in the main repo and that checkout is clean, use `git -C ~/Dev/Workspace/herdr-dock merge --ff-only`.
- `app/` is generated: run `npm run build:app` before committing.
- Baseline: `npm test` has one known failure, `tests/dock-core-class.test.mjs`.
- The two lines, verbatim. `var CLASS_SHORTHAND_REGEX = /^:::([\w][\w-]*)/;` becomes
  `var CLASS_SHORTHAND_REGEX = /^:::(\w(?:\w|-(?![-.>]))*)/;`, exactly once.
- The commit uses `fix(render): …` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The class line moved or changed in an upgrade:** the build fails and says so. Test in Task 1.
2. **A class with a hyphen in its name** (`A:::my-cls`): still read whole, because the hyphen is followed by a letter.
   Covered by the rule; the `classDef` side is out of scope.
3. **A styled node keeps its class colour after painting:** `styledIds` already treats `X:::name` as author-styled.
   Test in Task 1.
4. **Spaced forms and a bare `A:::hot` are unchanged.** Test in Task 1.
5. **Cached drawings of these diagrams are drawn again:** `LOOK_VERSION` is 5. Set in step 3.

---

### Task 1: The class shorthand, arrow-aware

**Files:**
- Modify: `src/shared/render/mermaid-patch.js` (new constants, `patchMermaidIds`)
- Modify: `src/shared/render/cache.js` (`LOOK_VERSION`)
- Test: `tests/render-mermaid-patch.test.mjs`
- Regenerated: `app/`

**Interfaces:**
- Produces: `CLASS_SHORTHAND = "var CLASS_SHORTHAND_REGEX = /^:::([\\w][\\w-]*)/;"` and
  `CLASS_SHORTHAND_BEFORE_ARROW = "var CLASS_SHORTHAND_REGEX = /^:::(\\w(?:\\w|-(?![-.>]))*)/;"`.
  `patchMermaidIds` also throws `beautiful-mermaid's class shorthand pattern changed` when `CLASS_SHORTHAND` isn't
  found exactly once.

- [ ] **Step 1: Write the failing tests** in `tests/render-mermaid-patch.test.mjs`

  - Import `CLASS_SHORTHAND, CLASS_SHORTHAND_BEFORE_ARROW` beside the existing imports.
  - In the first test, add these two lines and widen the length check:

```js
  assert.equal(count(out, CLASS_SHORTHAND_BEFORE_ARROW), 1);
  assert.equal(count(out, CLASS_SHORTHAND), 0);
  // and the length check becomes:
  assert.equal(out.length - src.length, 13 * (NODE_ID_BEFORE_ARROW.length - NODE_ID.length) + CLASS_SHORTHAND_BEFORE_ARROW.length - CLASS_SHORTHAND.length);
```

  - In the second test, add:

```js
  const noClass = "var NODE_PATTERNS = [" + "/^([\\w-]+)/,".repeat(13) + "];\nvar CLASS_SHORTHAND_REGEX = 1;";
  assert.throws(() => patchMermaidIds(noClass), /class shorthand pattern changed/);
```

  - Append a new test:

```js
test("the built Render helper draws a :::class node followed by an unspaced arrow as two nodes, the class kept", () => {
  const h = mkdtempSync(join(tmpdir(), "render-cls-"));
  try {
    const cases = [["A:::hot-->B", "A"], ["A-->B:::hot", "B"], ["A:::hot-->B:::cold", "A"], ["A[x]:::hot-.->B", "A"], ["A:::hot---B", "A"], ["A:::hot --> B", "A"]];
    const f = join(h, "cls.md");
    writeFileSync(f, cases.map(([c]) => "```mermaid\nflowchart LR\n  " + c + "\n  classDef hot fill:#ff0000\n  classDef cold fill:#0000ff\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const segs = JSON.parse(r.stdout).segments;
    assert.equal(segs.length, cases.length);
    segs.forEach((s, i) => {
      const svg = readFileSync(join(h, s.svg), "utf8");
      assert.equal((svg.match(/<g class="node"/g) ?? []).length, 2, cases[i][0]);
      assert.equal((svg.match(/class="edge"/g) ?? []).length, 1, cases[i][0]);
      const hot = new RegExp(`<g class="node" data-id="${cases[i][1]}"[^>]*>\\s*<[a-z]+[^>]*fill="#ff0000"`);
      assert.match(svg, hot, `${cases[i][0]}: ${cases[i][1]} keeps hot's red`);
    });
  } finally { rmSync(h, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/render-mermaid-patch.test.mjs`
Expected: FAIL. `CLASS_SHORTHAND` is not exported, and the built helper still draws `A:::hot-->B` as one node.

- [ ] **Step 3: Implement**

- `mermaid-patch.js`: add the two constants. After the node-id rewrite, check that the source holds `CLASS_SHORTHAND`
  exactly once (throw otherwise), then replace it with `CLASS_SHORTHAND_BEFORE_ARROW`. Mention the class shorthand in
  the header.
- `cache.js`: `LOOK_VERSION = 5`.

- [ ] **Step 4: Rebuild `app/` and see the tests pass**

```bash
npm run build:app && node --test tests/render-mermaid-patch.test.mjs
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Full suite and deploy**

```bash
npm test 2>&1 | tail -8 && npm run deploy
```
Expected: `# fail 1` (only `tests/dock-core-class.test.mjs`); every deploy check passes.

- [ ] **Step 6: Commit**

```bash
git add src/shared/render/mermaid-patch.js src/shared/render/cache.js tests/render-mermaid-patch.test.mjs app
git commit -m "fix(render): a :::class node followed by an unspaced arrow (A:::hot-->B) draws two nodes"
```
