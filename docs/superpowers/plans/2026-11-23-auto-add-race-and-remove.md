# Auto-add race and Remove bounce-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two follow-ups to `fc1b5db`:
- Auto-add checks the live `dock.git.repos`, so overlapping ticks can't append a path twice.
- Remove on a repo whose listing fails sticks while a terminal is in it, instead of coming back the next tick.

The second fix also shows that repo as one row instead of two, because both bugs have the same cause.

**Architecture:**
- **Task 1:** in `applySkipAndAutoAdd`, the `listed` set is built from `readAdded()` (the live key, the same list
  the next line appends to) instead of the tick's `addedList`.
- **Task 2:** `listAdded` keeps the common dir that `rev-parse` found even when `worktree list` then fails. When
  that common dir is known, `buildView` keys the error row by it, so the row merges with the terminal's row for
  the same repo. Remove then sees the open terminal and skips the repo, as the auto-add spec says.

**Tech Stack:** plain ES modules in `src/shared` (bundled into Herdr mods), `node --test`, esbuild via
`npm run build:app`.

**Spec:** `docs/superpowers/specs/2026-11-22-auto-add-repos-design.md`. The two rules that apply:
- "nothing is appended twice";
- Remove: "If a terminal is in any of its worktrees at that moment, the repo id is also put in
  `dock.git.skipped`", and skipped repos are hidden "terminal rows included, and are never auto-added".

## Root cause (reproduced 2026-11-23)

- **Race:** `applySkipAndAutoAdd` checks the tick's `addedList`, which was read when the tick started.
  - **Scenario:** tick A waits on a slow 60 s re-list. Meanwhile tick B auto-adds `/w/x`. A then finishes and
    appends `/w/x` again.
  - **Evidence:** the reviewer's `race.mjs` gave `[/w/y, /w/x, /w/x]`.
- **Remove bounce-back:** `listAdded` (`src/shared/collector.js:118-124`) throws away the common dir from a
  successful `rev-parse` when `worktree list` fails.
  - So `buildView` keys the error row by path (`|/w/api`), with no worktrees. The terminal's row for the same
    repo is `|/w/api/.git`, not added.
  - Remove on the error row finds no open terminal, so nothing is skipped. Auto-add then appends the path again
    from the terminal's row.
  - **Evidence:** scratch `repro-remove.mjs`. After Remove, `dock.git.repos` is `[/w/api]` again three ticks later.

## Global Constraints

- `src/shared/*.js`: no Node built-ins and no `setTimeout`. Time comes only from `io.now()`.
- Ids come only from `idOf(machine, path)`. Never compare raw path strings.
- When `rev-parse` itself fails (path gone, not a repo, machine unreachable), the error row stays keyed by its
  path, exactly as today. Only a failure *after* a successful `rev-parse` uses the common dir.
- Out of scope, per Adam's scope rule:
  - Minor 2 from the last review (only a row's first open worktree is checked);
  - cleaning up lists that already grew.
- `app/` is a committed build. Run `npm run build:app` and commit `app/` in the same commit as each task.
- Branch from `main` and merge back to `main` (project memory: fix-branches-base-on-main).
- Commit messages follow the repo's `fix(collector): …` style and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Baseline** (`main` = `fc1b5db`):
  - Node 23.11 (`/opt/homebrew/bin/node --test`): 619 of 619 pass.
  - Node 22.14 (`npm test`): 617 tests, 616 pass. The only failure is `dock-core-class`, which needs Node ≥ 22.15.

## Review Focus

1. **A repo nobody added** is still auto-added exactly once. Existing test "auto-add: a repo a terminal works in
   is added…".
2. **An added path that isn't a repo** (`rev-parse` fails) still shows its own error row with the git error.
   Existing test "(c) an added path that is no longer a repo".
3. **A failing repo that recovers** keeps the same row id, so its hidden and selected state don't jump. Test (e).
4. **Remove on a failing repo with a terminal in it** hides the repo until the terminal leaves, then forgets the
   skip. Test (f).
5. **Two ticks overlapping** around an auto-add append the path once. Test (d).

---

### Task 1: Auto-add checks the live list

**Files:**
- Modify: `src/shared/collector.js` (`applySkipAndAutoAdd`, the `listed` line, ~370)
- Modify: `app/` (regenerated)
- Test: `tests/collector-git.test.mjs`

**Interfaces:**
- Consumes: `readAdded()` and `idOf()` inside `createCollector`.
- Produces: nothing new.

- [ ] **Step 1: Confirm the baseline**

Run: `/opt/homebrew/bin/node --test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `ℹ tests 619`, `ℹ pass 619`, `ℹ fail 0`.

- [ ] **Step 2: Write the failing test** (append at the end of `tests/collector-git.test.mjs`)

```js
test("auto-add (d): a tick that read the list before another tick's auto-add doesn't append the same path again", async () => {
  let slow = false;
  let release;
  const yList = wtList(["/w/y", "main"]);
  const panes = [];
  const io = fakeIo({
    platform: "linux", autoAdd: true, spaces: oneSpace, panes, repos: [{ path: "/w/y", machine: null }],
    table: {
      [` -C /w/y ${RP}`]: ok("/w/y\n/w/y/.git\n"),
      " -C /w/y worktree list --porcelain": () => (slow ? new Promise((r) => { release = () => r(yList); }) : yList),
      [` -C /w/x ${RP}`]: ok("/w/x\n/w/x/.git\n"),
    },
  });
  const c = createCollector(io);
  await c.tick(); // t = 0: /w/y is listed
  io.t = 60000;
  slow = true;
  panes.push({ pane: "p1", tab: "t1", cwd: "/w/x" }); // a terminal opens in a repo nobody added
  const a = c.tick(); // A: its 60 s re-list of /w/y waits; /w/x resolves
  await new Promise((r) => setTimeout(r, 30));
  io.t = 61000;
  await c.tick(); // B: auto-adds /w/x
  release();
  await a; // A ends with the list it read before B's append
  assert.deepEqual(io.shared("dock.git.repos"), [{ path: "/w/y", machine: null }, { path: "/w/x", machine: null }]);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test --test-name-pattern="auto-add \(d\)" tests/collector-git.test.mjs`
Expected: FAIL, with `/w/x` listed twice (3 entries).

- [ ] **Step 4: Build `listed` from `readAdded()`**

In `applySkipAndAutoAdd`, build `listed` from `readAdded()` instead of `addedList`. Extend the comment: it is the
live list, because a tick that started earlier may finish after another tick has appended.

- [ ] **Step 5: Run the collector tests**

Run: `node --test tests/collector-git.test.mjs tests/collector-ci.test.mjs`
Expected: all pass, including `auto-add (a)`–`(d)`.

- [ ] **Step 6: Rebuild `app/`, run the suite, commit**

Run: `npm run build:app && git status --short app/ && /opt/homebrew/bin/node --test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected:
- Only `app/mods/dock-core/main.js` and the two `VERSION.json` files change.
- `ℹ tests 620`, `ℹ pass 620`, `ℹ fail 0`.

```bash
git add src/shared/collector.js tests/collector-git.test.mjs app/
git commit -m "fix(collector): auto-add checks the live repo list, so overlapping ticks can't append a path twice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: A failing added repo shares its row with its terminal

**Files:**
- Modify: `src/shared/collector.js` (`listAdded` ~113-128; the `if (e.error)` branch of `buildView` ~309-314)
- Modify: `app/` (regenerated)
- Test: `tests/collector-git.test.mjs` (plus one import at the top)

**Interfaces:**
- Consumes: `removeRepoPaths(list, repo, platform)` and `skipAfterRemove(skipped, repo)` from
  `src/mods/dock-git/view.js`, in the test only. That's what the panel's Remove runs.
- Produces: an added entry record now holds `commonDir` from its latest `rev-parse`: the common dir when it
  succeeded, `null` when it failed.

- [ ] **Step 1: Write the failing tests**

At the top of `tests/collector-git.test.mjs`, after the `createCollector` import:

```js
import { removeRepoPaths, skipAfterRemove } from "../src/mods/dock-git/view.js";
```

Append at the end of the file:

```js
const failingApi = (state) => ({
  [` -C /w/api ${RP}`]: ok("/w/api\n/w/api/.git\n"),
  " -C /w/api worktree list --porcelain": () => (state.refusing ? refused() : wtList(["/w/api", "main"])),
  " -C /w/api remote get-url origin": NO_ORIGIN,
  " --no-optional-locks -C /w/api status --porcelain=v2 --branch": status("main"),
});

test("auto-add (e): a repo whose listing fails shares one row with its terminal, and keeps its id when it recovers", async () => {
  const state = { refusing: true };
  const io = fakeIo({
    platform: "linux", autoAdd: true, spaces: oneSpace, repos: [{ path: "/w/api", machine: null }],
    panes: [{ pane: "p1", tab: "t1", cwd: "/w/api" }], table: failingApi(state),
  });
  const c = createCollector(io);
  await ticks(io, c, 3);
  let rows = c.state().repos;
  assert.deepEqual(rows.map((r) => [r.id, r.added]), [["|/w/api/.git", true]]);
  assert.match(rows[0].error, /connection refused/);
  assert.deepEqual(rows[0].worktrees.map((w) => [w.path, w.open]), [["/w/api", true]]);
  state.refusing = false;
  io.t = 60000;
  await c.tick();
  rows = c.state().repos;
  assert.deepEqual(rows.map((r) => [r.id, r.error]), [["|/w/api/.git", null]]);
});

test("auto-add (f): Remove on a failing repo with a terminal in it sticks until the terminal leaves", async () => {
  const panes = [{ pane: "p1", tab: "t1", cwd: "/w/api" }];
  const io = fakeIo({
    platform: "linux", autoAdd: true, spaces: oneSpace, repos: [{ path: "/w/api", machine: null }],
    panes, table: failingApi({ refusing: true }),
  });
  const c = createCollector(io);
  await ticks(io, c, 3);
  const row = c.state().repos.find((r) => r.error); // the row with the red Remove button
  // What dock-git's Remove does (src/mods/dock-git/main.js, removeRepo).
  io.setShared("dock.git.repos", removeRepoPaths(io.shared("dock.git.repos"), row, "linux"));
  const skipped = skipAfterRemove(io.shared("dock.git.skipped"), row);
  if (skipped) io.setShared("dock.git.skipped", skipped);
  for (let t = 3000; t <= 6000; t += 1000) { io.t = t; await c.tick(); }
  assert.deepEqual(io.shared("dock.git.repos"), []);
  assert.deepEqual(c.state().repos, []);
  panes.length = 0; // the terminal leaves
  io.t = 7000;
  await c.tick();
  assert.deepEqual(io.shared("dock.git.skipped"), []);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-name-pattern="auto-add \((e|f)\)" tests/collector-git.test.mjs`
Expected:
- (e) FAILS on its first assertion with two rows: `["|/w/api", true]` and `["|/w/api/.git", false]`.
- (f) FAILS because `dock.git.repos` is `[/w/api]` again.

- [ ] **Step 3: Implement it**

- **`listAdded`:**
  - When `rev-parse` fails, set `commonDir: null` along with `error` and `list: []`.
  - When `worktree list` fails, keep the `commonDir` this `rev-parse` found.
- **`buildView`, the `if (e.error)` branch:** key the row with `idOf(a.machine, e.commonDir ?? a.path)`. Its
  `mainPath` is `mainFromCommonDir(e.commonDir)` when the common dir is known, else `a.path`. Everything else in
  the branch stays the same.

- [ ] **Step 4: Run the collector tests**

Run: `node --test tests/collector-git.test.mjs tests/collector-ci.test.mjs`
Expected: all pass, including `auto-add (a)`–`(f)`, "(c) an added path that is no longer a repo" and "(c2) exec
throwing".

- [ ] **Step 5: Rebuild `app/`, run the whole suite on both Node versions, commit**

Run: `npm run build:app && git status --short app/ && /opt/homebrew/bin/node --test 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected:
- Only `app/mods/dock-core/main.js` and the two `VERSION.json` files change.
- Node 23.11: `ℹ tests 622`, `ℹ pass 622`, `ℹ fail 0`.
- Node 22.14: `# tests 620`, `# pass 619`, `# fail 1`. The only failure is `dock-core-class`.

```bash
git add src/shared/collector.js tests/collector-git.test.mjs app/
git commit -m "fix(collector): a failing added repo shares its terminal's row, so Remove sticks while a terminal is in it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
