# Spaces Stops Jumping to the Active Space on Hover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering agent rows in Spaces no longer scrolls the list back to the active space.

**Architecture:**
- **What happens today:** the list's `on_size_change` handler (`src/mods/dock-spaces/main.js:693`)
  scrolls to the active space every time it runs. The list has no stable id.
- **What sets it off:** agent rows (be87008) redraw Spaces on hover, and each redraw reaches the
  handler.
- **The change:** give the list a stable id, and scroll only when its height really changed, which is
  the pattern dock-browser and dock-render use.

**Tech Stack:** Herdr mod JS. `node --test` (run the suite with `/opt/homebrew/bin/node`, v23).
`npm run build:app` commits `app/`.

**Spec:**
- Adam's report: "after selecting an agent from the Agents panel, hovering in Spaces makes the list
  jump to that space … it makes the space unusable."
- Cause and fix: `docs/superpowers/specs/2026-11-26-spaces-fold-design.md`, section "Also on this
  branch". That file is untracked here; this plan carries what it needs.

## Global Constraints

- **Still reveals on selection:** selecting an agent in another space still brings that space into
  view once (the render-time reveal at `main.js:683-688` is unchanged).
- **Resizes still scroll:** a real resize still scrolls, e.g. a block above growing so the list
  shrinks. "Real" means the height moved by more than 2 px since the last report.

## Review Focus

1. **A redraw at the same size, from any source** (a hover, a name pass, a git refresh, a timer).
   No scroll. Pinned by the Task 1 test.
2. **The list's height changing while no space is active** (`activeAt` -1). The height is still
   recorded, so the next real change compares against it. Covered by the same test: a resize after
   an unchanged report.
3. **Anything else that runs on every redraw** and could move the list or the focus. The reviewer
   checks every `on_size_change`, `scroll_to_item` and `run(` in dock-spaces against "fires on a
   redraw with nothing changed".

---

### Task 1: The list scrolls only on a real resize

**Files:**
- Modify: `src/mods/dock-spaces/main.js:691-693` (the list `v_flex`).
- Test: `tests/dock-spaces-class.test.mjs`.
- Rebuild: `app/` (`npm run build:app`).

**Interfaces:** the list gets `.id("spaces-list")`. The test stub records its handler as
`handlers()["spaces-list:on_size_change"]`.

- [ ] **Step 1: Write the failing test** (append; it reuses the file's `three()` helper)

```js
test("dock-spaces: the list scrolls to the active space only when its height really changes", () => {
  three();
  scrolls().length = 0;
  const resized = handlers()["spaces-list:on_size_change"];
  resized({ width: 250, height: 400 }, cx);
  assert.deepEqual(scrolls(), [3]);
  resized({ width: 250, height: 400 }, cx); // a redraw at the same size (hovering an agent row)
  resized({ width: 250, height: 401 }, cx); // under 2 px
  assert.deepEqual(scrolls(), [3]);
  resized({ width: 250, height: 300 }, cx); // a block above grew: the list shrank
  assert.deepEqual(scrolls(), [3, 3]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/dock-spaces-class.test.mjs`
Expected: FAIL with "resized is not a function", because the list has no id. If that's fixed alone,
the failure becomes the second `deepEqual`: `[3, 3, 3]` vs `[3]`.

- [ ] **Step 3: Implement**
  - Add `.id("spaces-list")` to the list `v_flex`.
  - The handler records `this.listHeight` and scrolls (and notifies) only when
    `Math.abs(size.height - (this.listHeight ?? -Infinity)) > 2`.
  - The height is updated on every real change, even while `activeAt` is -1.

- [ ] **Step 4: Verify**

Run:
`node --test tests/dock-spaces-class.test.mjs && npm run build:app && /opt/homebrew/bin/node --test && npm run build && herdr-app check dist/mods/dock-spaces`
Expected: everything passes, with 0 failed in the suite and `check passed: dist/mods/dock-spaces`.

- [ ] **Step 5: Commit**

```bash
git add src/mods/dock-spaces/main.js tests/dock-spaces-class.test.mjs app/ docs/superpowers/plans/2026-11-26-spaces-scroll-fix.md
git commit -m "fix(spaces): the list scrolls to the active space only on a real resize, not on every redraw (hovering an agent row)"
```
