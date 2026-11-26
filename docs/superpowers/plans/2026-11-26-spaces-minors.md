# Spaces Deferred Minors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four minors deferred from the Spaces agent-rows and fold releases (be87008, ebe831b).

**Architecture:**
- **Task 1:** the test stub rejects element methods Herdr doesn't declare.
- **Task 2:** tests pin the chevron and highlight behaviour that ebe831b left untested.
- **Tasks 3 and 4** are two small `dock-spaces` changes:
  - folds of an offline machine survive;
  - a worktree keeps its place while its git answer is pending.

**Tech Stack:** Herdr mod JS. Tests: `node --test`, with the full suite under `/opt/homebrew/bin/node`
(v23). Class tests use `tests/fixtures/host-stubs.mjs`. Every mod change runs `npm run build:app`
and commits `app/`.

**Spec:** the deferred-minor lines from the two final reviews (recorded in memory
`spaces-agents.md`), Adam: "fix the deferred minors too".
1. **Agent-row typos:** the tests can't catch a typo in the agent row's element chain. The stub
   accepts any method, and `herdr-app check` renders an empty list.
2. **Untested chevron and highlight:** nothing pins the chevron's press reset or its
   `stop_propagation`, or the stand-in highlight (`on = w.active || holdsActive`).
3. **Offline machine's folds:** folding while a remote machine is offline prunes that machine's
   folds.
4. **Worktree flicker:** a nested worktree whose git answer is briefly missing (after a `cd`)
   un-nests. Under a folded parent it shows, hides again, and scrolls each way.

## Global Constraints

- **Remote ids:** remote space ids are `<machine>/<id>`. `machines()` gives
  `{ name, layout: "loading" | "ready" | "unavailable" }` (`herdr.d.ts:104,154`).
- **No new scrolls, focus changes or commands on a redraw where nothing changed.** This is the lesson
  from 46333df, and every task's review checks it.
- **Element-method list:** comes from Herdr's `gpui-kit.d.ts`, every
  `name<Self extends Element>(this: Self` declaration (3,308 today). It's committed as
  `tests/fixtures/gpui-element-methods.json` (a sorted array). `scripts/gpui-element-methods.mjs`
  regenerates it from `$HERDR_APP_HOME` (default `~/.config/herdr-app`) or a path argument.

## Review Focus

1. **Valid methods on hidden branches.** The strict stub must not reject a valid method used on a
   branch the tests don't draw. Unknown methods only throw when called, so untested branches are
   simply unchecked, not falsely failed. Task 1 confirms the whole suite stays green.
2. **What `lastGit` remembers.** It must never keep a space's old git after a *real* answer
   (including "not a repo"). It only stands in while that space's current place has no answer at
   all. A space that's gone is never looked up. Task 4 tests both.
3. **Local ids.** Local space ids (no "/") are pruned as before, whatever the remote machines'
   states. Task 3 test.
4. **Removed machines.** A remote machine not in `machines()` at all keeps its folds. It may only be
   connecting, and a few stale ids cost nothing.
5. **Redraw audit** (as in Global Constraints).

---

### Task 1: The test stub rejects element methods Herdr doesn't declare

**Files:**
- Create: `scripts/gpui-element-methods.mjs`, `tests/fixtures/gpui-element-methods.json`.
- Modify: `tests/fixtures/host-stubs-loader.mjs` (the chain's fallback `get`).
- Test: new `tests/host-stubs.test.mjs`.

**Interfaces:**
- `node scripts/gpui-element-methods.mjs [path/to/gpui-kit.d.ts]` writes the JSON. With no path it
  reads `${HERDR_APP_HOME ?? ~/.config/herdr-app}/mods/dock-core/gpui-kit.d.ts`.
- In the stub chain:
  - `child`, `when`, `id` and `on_*` keep their current handling;
  - any other string key must be in the list, or the call throws
    `TypeError("<name> is not an element method in gpui-kit.d.ts")`.

- [ ] **Step 1: Failing test** (`tests/host-stubs.test.mjs`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import "./fixtures/host-stubs.mjs";
const { div, svg } = await import("gpui-kit");
test("host stubs: an element method Herdr doesn't declare throws; declared ones chain", () => {
  assert.doesNotThrow(() => div().id("x").px(8).text_color("red").truncate().when(true, (el) => el.bg("blue")));
  assert.doesNotThrow(() => svg("a.svg").size(12).spin(900));
  assert.throws(() => div().text_colr("red"), /text_colr is not an element method/);
});
```

- [ ] **Step 2: Run it.** `node --test tests/host-stubs.test.mjs`. Expected: FAIL, because
  `text_colr` doesn't throw.
- [ ] **Step 3: Implement.**
  - Write the generator, run it, and commit the JSON.
  - The loader reads the JSON and embeds it in the stub source, as a `Set`.
- [ ] **Step 4: Run it, then the whole suite.** `node --test tests/host-stubs.test.mjs`, then
  `/opt/homebrew/bin/node --test`. Expected: PASS, and the suite has 0 failed. Every class test
  still draws.
- [ ] **Step 5: Prove it catches a typo.**
  - Temporarily change `.text_color(` in `agentRow` to `.text_colr(`.
  - Run `node --test tests/dock-spaces-class.test.mjs`. Expected: FAIL.
  - Restore the original.
- [ ] **Step 6: Commit.** Commit the scripts, the fixture JSON, the loader, the new test and this
  plan:
  `git commit -m "test: the host stub rejects element methods gpui-kit.d.ts doesn't declare, so a typo in a drawn row fails"`.

### Task 2: Tests pin the chevron's press handling and the stand-in highlight

**Files:**
- Modify: `tests/fixtures/host-stubs-loader.mjs`:
  - `theme()` returns a Proxy whose every token is its own name, so `t.selected === "selected"`;
  - the chain records `.bg(x)` per element id in `globalThis.__bgs`.
- Modify: `tests/fixtures/host-stubs.mjs`: `bgs()`, reset in `resetHost`.
- Test: `tests/dock-spaces-class.test.mjs`.

- [ ] **Step 1: Write the tests** (they pin existing code, so prove each one in Step 2)

```js
test("dock-spaces: a chevron press drops a leftover drag, so the row's release moves nothing", () => {
  localStorage.removeItem("spaces.folded");
  three();
  handlers()["space-C:on_mouse_down:left"]();
  handlers()["space-agent-t1:on_mouse_move"]({}, cx); // over A, then let go outside the list
  const spy = { ...cx, stops: 0, stop_propagation() { this.stops++; } };
  handlers()["space-fold-A:on_mouse_down:left"]({}, spy);
  handlers()["space-A:on_mouse_up:left"]({}, cx); // the release reaches the row (the chevron has no mouse-up)
  assert.deepEqual(moves(), []);
  assert.equal(spy.stops, 1);
  localStorage.removeItem("spaces.folded");
});
test("dock-spaces: a folded parent wears the active highlight for its hidden worktree; unfolding gives it back", () => {
  const s = repoAndWorktree("W", true);
  assert.equal(bgs()["space-R"], "selected");
  handlers()["space-fold-R:on_mouse_down:left"]({}, cx);
  s.render(cx);
  assert.equal(bgs()["space-W"], "selected");
  assert.notEqual(bgs()["space-R"], "selected");
  localStorage.removeItem("spaces.folded");
});
```

`bgs()` keeps the last `.bg()` per id from the latest render: the stub clears `__bgs` when
`Spaces.render` begins. Ruling for the implementer: clear it in `resetHost`, and have tests clear it
before a render that matters. The test above does this through the fresh `render` after the fold.

- [ ] **Step 2: Prove each test can fail.**
  - Temporarily delete `this.pressed = null; this.over = null;` from the chevron handler. The first
    test fails. Restore it.
  - Temporarily change `const on = w.active || holdsActive;` to `const on = w.active;`. The second
    test fails. Restore it.
- [ ] **Step 3: Run the file and the whole suite.** Expected: PASS.
- [ ] **Step 4: Commit.**
  `git commit -m "test(spaces): pin the chevron's press handling and the folded parent's stand-in highlight"`.

### Task 3: Folds of an offline machine survive a toggle

**Files:** Modify `src/mods/dock-spaces/main.js` (`toggleFold`). Test:
`tests/dock-spaces-class.test.mjs`.

**Interfaces:** in `toggleFold`, an id is pruned when either holds:
- it has no "/" and isn't in `spaces()`;
- its machine (the part before the first "/") is in `machines()` with `layout === "ready"`, and the
  id isn't in `spaces()`.

Every other id is kept.

- [ ] **Step 1: Failing test**

```js
test("dock-spaces: folding while a machine is offline keeps that machine's folds; local gone ids still go", () => {
  localStorage.setItem("spaces.folded", JSON.stringify(["m1/X", "GONE"]));
  three();
  herdr.data.machines = [{ name: null, layout: "ready" }, { name: "m1", layout: "unavailable" }];
  s3.toggleFold("A", cx);
  assert.deepEqual(JSON.parse(localStorage.getItem("spaces.folded")), ["m1/X", "A"]);
  herdr.data.machines = [{ name: null, layout: "ready" }, { name: "m1", layout: "ready" }];
  s3.toggleFold("A", cx);
  assert.deepEqual(JSON.parse(localStorage.getItem("spaces.folded")), []);
  localStorage.removeItem("spaces.folded");
});
```

- [ ] **Step 2: Run it.** Expected: FAIL. The first `deepEqual` gets `["A"]`, because `m1/X` was
  pruned.
- [ ] **Step 3: Implement** the prune rule above.
- [ ] **Step 4: Run the file, then the whole suite.** Expected: PASS.
- [ ] **Step 5: Commit.** Run `npm run build:app` first, then:
  `git commit -m "fix(spaces): folding while a machine is offline keeps that machine's folds"`.

### Task 4: A worktree keeps its place while its git answer is pending

**Files:** Modify `src/mods/dock-spaces/main.js`:
- `init`: `this.lastGit = {}`;
- `ordered()` at `:403`, where `g` is read.

Test: `tests/dock-spaces-class.test.mjs`.

**Interfaces:** in `ordered()`, a space's `g` is decided as follows.
- **An answer exists:** when `where(w, ps) in this.git`, `g` is that answer, which may be `null` for
  "not a repo". `this.lastGit[w.id]` is set to it.
- **No answer yet:** otherwise `g` is `this.lastGit[w.id] ?? null`. This is a cd or a new folder
  being looked up; the space keeps its last nesting until git answers.
- **Pruning:** `lastGit` entries for ids not in `spaces()` are dropped in `ordered()`.

- [ ] **Step 1: Failing test**

```js
test("dock-spaces: a worktree whose git answer is pending (after a cd) stays nested; no scroll, no flicker", () => {
  const s = repoAndWorktree("W", true); // R folded, holding the active W
  assert.equal(s.activeAt, 0);
  scrolls().length = 0;
  herdr.data.spaces[1].folder = "/r-wt/sub"; // a cd: no git answer for the new place yet
  s.render(cx);
  assert.equal(s.activeAt, 0);
  assert.deepEqual(scrolls(), []);
  s.git['[null,"/r-wt/sub"]'] = null; // the answer: not a repo after all
  s.render(cx);
  assert.equal(s.activeAt, 1); // W is its own row now, and R no longer holds it
  localStorage.removeItem("spaces.folded");
});
```

- [ ] **Step 2: Run it.** Expected: FAIL at the second `activeAt` (1 vs 0). W un-nests, so R has
  no children and no longer holds it.
- [ ] **Step 3: Implement** as the Interfaces block says.
- [ ] **Step 4: Run the file, then the whole suite, build and check.**
  `npm run build:app && /opt/homebrew/bin/node --test && npm run build && herdr-app check dist/mods/dock-spaces`.
  Expected: 0 failed, and `check passed`.
- [ ] **Step 5: Commit.**
  `git commit -m "fix(spaces): a worktree keeps its place while its git answer is pending, so a cd doesn't flicker it out from under a folded parent"`.
