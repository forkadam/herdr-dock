# Spaces Fold + Two Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the leftover-drag space move and the reveal after the narrow rail, then let each space
fold its children.

**Architecture:** Everything is in `src/mods/dock-spaces/main.js`, plus one pure helper in
`src/shared/agent-rows.js`:
- `foldRows` works on the rows `withAgents` returns. It counts each space row's children, leaves out
  a folded space's children, and marks what the folded row stands for.
- The class keeps `foldedSpaces` (a Set) in `localStorage` key `spaces.folded`.

**Tech Stack:** Herdr mod JS.
- Tests: `node --test`, with the full suite run under `/opt/homebrew/bin/node` (v23).
- Class tests use `tests/fixtures/host-stubs.mjs`: `handlers()` gives an element's handlers by
  `"<id>:<on_x>[:<button>]"`, and `scrolls()` gives `scroll_to_item` calls.
- Every mod change runs `npm run build:app` and commits `app/`.

**Spec:** `docs/superpowers/specs/2026-11-26-spaces-fold-design.md`

## Global Constraints

- **Name:** `this.folded` already holds folded *machines*. Space folds use `this.foldedSpaces`.
- **Chevron clicks:** a click on the chevron never selects or drags the space, and runs no
  `space.select` or `space.move`.
- **No folding in the narrow rail:** it draws compact cells only, so `foldRows` doesn't apply there.
- **Default:** unfolded. Folds persist in `localStorage["spaces.folded"]` as a JSON array of space
  ids.
- **Icons:** `mods/workspace-chrome/chevron-down.svg` while open, `chevron-right.svg` while folded,
  size 11, `t.dim`. The folded count is in `t.dim` at size 11. The urgent mark is
  `agentStatus(t, { status: top }, true)`, shown only when `top` is `blocked`, `done` or `working`.

## Review Focus

1. **Every handler that runs on a redraw or layout** must not scroll, focus or run commands when
   nothing changed. Toggling a fold redraws, and the reviewer re-audits this (the lesson from
   46333df).
2. **The active worktree inside a folded parent.** The parent row is highlighted and is the scroll
   target. Unfolding returns the highlight to the worktree. Task 3, class test.
3. **Folding the space above the active one.** The active space moves up in the list. One scroll is
   fine; repeated scrolls on later redraws are not. Task 3, class test (redraws after the fold).
4. **A folded id that isn't a space any more.** It's pruned the next time folds change, never
   crashes, and never hides another space. Task 3, persistence test.
5. **A leftover press, then a click on an agent row.** No space moves. Task 1 test.

---

### Task 1: A press on an agent row clears a leftover space drag

**Files:** Modify `src/mods/dock-spaces/main.js` (`agentRow`, ~line 600). Test:
`tests/dock-spaces-class.test.mjs`. Rebuild `app/`.

- [ ] **Step 1: Failing test** (append; it uses the file's `three()` and `moves()`)

```js
test("dock-spaces: a drag let go outside the list doesn't turn a later agent-row click into a move", () => {
  three();
  handlers()["space-C:on_mouse_down:left"]();
  handlers()["space-agent-t1:on_mouse_move"]({}, cx); // dragged over A's agent rows…
  // …and let go outside the list: no handler of this panel sees the release.
  handlers()["space-agent-t1:on_mouse_down:left"]?.({}, cx); // later: a click on that agent row
  handlers()["space-agent-t1:on_mouse_up:left"]({}, cx);
  handlers()["space-agent-t1:on_click"]({}, cx);
  assert.deepEqual(moves(), []);
  assert.deepEqual(herdr.data.runs.filter(([c]) => c === "pane.focus"), [["pane.focus", { pane: "p1" }]]);
});
```

- [ ] **Step 2: Run it.** `node --test tests/dock-spaces-class.test.mjs`. Expected: FAIL, with
  `moves()` equal to `[["space.move", { id: "C", index: 1 }]]`.
- [ ] **Step 3: Implement.** In `agentRow`, add `.on_mouse_down("left", () => { this.pressed = null; this.over = null; })`.
- [ ] **Step 4: Run it.** The same command. Expected: PASS.
- [ ] **Step 5: Commit.** Run `npm run build:app` first, then:

```bash
git add src/mods/dock-spaces/main.js tests/dock-spaces-class.test.mjs app/ docs/superpowers/specs/2026-11-26-spaces-fold-design.md docs/superpowers/plans/2026-11-26-spaces-fold.md
git commit -m "fix(spaces): a press on an agent row clears a leftover space drag, so a later click never moves a space"
```

### Task 2: Coming back from the narrow rail reveals the active space

**Files:** Modify `src/mods/dock-spaces/main.js` (the reveal in `render`, ~line 683). Test: the same
file.

- [ ] **Step 1: Failing test**

```js
test("dock-spaces: switching between the narrow rail and full brings the active space into view", () => {
  three();
  scrolls().length = 0;
  herdr.data.layout = left(100);
  s3.render(cx);
  herdr.data.layout = left(300);
  s3.render(cx);
  assert.deepEqual(scrolls(), [1, 3]);
});
```

Change `three()` to also keep its instance in a module-level `let s3`. This is the smallest change
to the helper, and earlier tests keep working.

- [ ] **Step 2: Run it.** Expected: FAIL, `[]` vs `[1, 3]`.
- [ ] **Step 3: Implement.** Add `|| collapsed !== this.revealedNarrow` to the reveal condition, and
  set `this.revealedNarrow = collapsed` inside it.
- [ ] **Step 4: Run it, then rerun the whole file.** Expected: PASS. The earlier scroll tests
  (`[3]`, `[3, 3]`, `[5]`) still hold, because the first render sets `revealedNarrow`.
- [ ] **Step 5: Commit.** Run `npm run build:app` first, then:
  `git commit -m "fix(spaces): coming back from the narrow rail brings the active space into view again"`.

### Task 3: Each space folds its children

**Files:**
- Modify: `src/shared/agent-rows.js` (add `foldRows`).
- Modify: `src/mods/dock-spaces/main.js`:
  - `init`: load `foldedSpaces`;
  - `toggleFold`;
  - `grouped`: apply `foldRows` when not collapsed, and set `activeAt` from `r.w.active || r.holdsActive`;
  - `row`: the chevron, the count, the urgent mark, and the highlight when `holdsActive`.
- Test: `tests/agent-rows.test.mjs`, `tests/dock-spaces-class.test.mjs`.

**Interfaces:**
- `foldRows(rows, folded: Set<spaceId>) -> rows`. The input is `withAgents` output: space rows
  `{w, tree}` and agent rows `{w, agent, depth}`.
- **Whose children:**
  - a top-level space row's children are every following row up to the next top-level space row:
    its agents, worktree rows and their agents;
  - a worktree row's children are the agent rows right after it whose `w` is its `w`.
- **Every space row gets:**
  - `children` (number);
  - `folded` (boolean, true only when it's in `folded` and has children).
- **A folded row also gets:**
  - `hidden` (the number of rows left out);
  - `top` (the most urgent `agent.status` among the hidden agents, by blocked > done > working >
    idle, or null when none);
  - `holdsActive` (true when a hidden space row has `w.active`).
- **Agent rows** pass through unchanged when shown.
- **`toggleFold(id, cx)`:**
  - flips the id in `this.foldedSpaces`;
  - drops ids not in `spaces()`;
  - writes `localStorage["spaces.folded"]`;
  - notifies.
- **Chevron:** element id `space-fold-${w.id}`. On `on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.toggleFold(w.id, cx); })`.

- [ ] **Step 1: Failing pure tests** (in `tests/agent-rows.test.mjs`)

```js
const fr = () => {
  const A = { id: "A" }, Aw = { id: "Aw" }, B = { id: "B" };
  return [{ w: A, tree: null }, { w: A, agent: { status: "idle" }, depth: 1 }, { w: Aw, tree: "└─" },
          { w: Aw, agent: { status: "done" }, depth: 2 }, { w: B, tree: null }];
};
const ids = (out) => out.map((r) => r.w.id + (r.agent ? "@" : ""));
test("foldRows: a folded space hides its agents, worktrees and theirs; says how many and the most urgent", () => {
  const out = foldRows(fr(), new Set(["A"]));
  assert.deepEqual(ids(out), ["A", "B"]);
  assert.deepEqual([out[0].folded, out[0].children, out[0].hidden, out[0].top], [true, 3, 3, "done"]);
  assert.deepEqual([out[1].folded, out[1].children], [false, 0]);
});
test("foldRows: a folded worktree hides only its own agents; nothing folded shows everything", () => {
  const out = foldRows(fr(), new Set(["Aw"]));
  assert.deepEqual(ids(out), ["A", "A@", "Aw", "B"]);
  assert.deepEqual([out[0].children, out[2].folded, out[2].hidden, out[2].top], [3, true, 1, "done"]);
  assert.deepEqual(ids(foldRows(fr(), new Set())), ["A", "A@", "Aw", "Aw@", "B"]);
  assert.equal(foldRows(fr(), new Set(["B"]))[4].folded, false); // nothing to fold
});
test("foldRows: a folded parent holds the active worktree hidden inside it", () => {
  const rows = fr(); rows[2].w.active = true;
  assert.equal(foldRows(rows, new Set(["A"]))[0].holdsActive, true);
  assert.ok(!foldRows(rows, new Set())[0].holdsActive);
});
```

- [ ] **Step 2: Failing class tests** (in `tests/dock-spaces-class.test.mjs`)

```js
test("dock-spaces: the chevron folds a space's agents and never selects or moves it", () => {
  localStorage.removeItem("spaces.folded");
  three();
  handlers()["space-fold-A:on_mouse_down:left"]({}, cx);
  s3.render(cx);
  assert.equal(s3.activeAt, 1); // A's two agent rows are hidden
  assert.deepEqual(moves(), []);
  assert.deepEqual(JSON.parse(localStorage.getItem("spaces.folded")), ["A"]);
  scrolls().length = 0;
  s3.render(cx); s3.render(cx); // later redraws at rest
  assert.deepEqual(scrolls(), []);
});
test("dock-spaces: folds come back with a new panel; an id that's gone is dropped at the next change", () => {
  localStorage.setItem("spaces.folded", JSON.stringify(["A", "GONE"]));
  three();
  assert.equal(s3.activeAt, 1);
  handlers()["space-fold-C:on_mouse_down:left"]?.({}, cx); // C has no children: no chevron
  s3.toggleFold("B", cx);
  assert.deepEqual(JSON.parse(localStorage.getItem("spaces.folded")), ["A", "B"]);
  localStorage.removeItem("spaces.folded");
});
test("dock-spaces: the active worktree inside a folded parent: the parent is highlighted and scrolled to", () => {
  localStorage.setItem("spaces.folded", JSON.stringify(["R"]));
  resetHost();
  herdr.data.layout = left(300);
  herdr.data.spaces = [{ id: "R", name: "repo", folder: "/r", tabs: [{ id: "tr" }], active: false },
                       { id: "W", name: "repo", folder: "/r-wt", tabs: [{ id: "tw" }], active: true }];
  const s = new Spaces(); s.init({}, cx);
  s.git['[null,"/r"]'] = { name: "repo", branch: "main", ahead: 0, behind: 0, repo: '[null,"/r/.git"]', linked: false };
  s.git['[null,"/r-wt"]'] = { name: "repo", branch: "feat", ahead: 0, behind: 0, repo: '[null,"/r/.git"]', linked: true };
  s.render(cx);
  assert.equal(s.activeAt, 0);
  assert.ok(scrolls().includes(0));
  localStorage.removeItem("spaces.folded");
});
```

- [ ] **Step 3: Run them.**
  `node --test tests/agent-rows.test.mjs tests/dock-spaces-class.test.mjs`. Expected: FAIL. The
  `foldRows` export is missing, and `handlers()["space-fold-A:on_mouse_down:left"]` is not a
  function.
- [ ] **Step 4: Implement** `foldRows`, `foldedSpaces`, `toggleFold`, the `grouped` changes and the
  `row` changes, as the Interfaces block and Global Constraints say.
  - **In `row`, the highlight:** `on = w.active || holdsActive`.
  - **In `row`, after the git tail:**
    - when folded and `hidden > 0`, the count, then the urgent mark when `top` isn't idle;
    - then the chevron, only when `children > 0`.
  - **Init:** read the folds with the same try/catch shape as `machines.folded`.
- [ ] **Step 5: Run them.** The same command. Expected: PASS.
- [ ] **Step 6: Whole suite, build, check.**
  `npm run build:app && /opt/homebrew/bin/node --test && npm run build && herdr-app check dist/mods/dock-spaces`.
  Expected: 0 failed, and `check passed`.
- [ ] **Step 7: Commit.**
  `git commit -m "feat(spaces): each space folds its agents and worktrees; a folded row says how many and the most urgent"`.
