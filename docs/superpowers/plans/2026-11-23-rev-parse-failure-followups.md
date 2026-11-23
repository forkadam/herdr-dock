# Rev-parse failure follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two minors the final review of `2670f15` deferred:
- a test that fails if `listAdded` stops clearing `commonDir` when `rev-parse` fails;
- the `applySkipAndAutoAdd` comment, which still says "whose listing failed".

**Architecture:** No behaviour changes.
- **The test:** an added repo lists fine, then its `rev-parse` fails 60 s later, then it recovers. Its row has to
  move from its common-dir id to its path id, and back again.
- **Why the reset matters:** without it (`src/shared/collector.js:118`), `e.commonDir` keeps the old value.
  `buildView` would then still key the error row by the repo's common dir, as if it were still that repo.
- **The comment:** describes the case `2670f15` left behind.

**Tech Stack:** plain ES modules in `src/shared`, `node --test`. The bundle strips comments, so `app/` does not
change.

**Spec:** `docs/superpowers/specs/2026-11-22-git-projects-design.md`. An added path that isn't a repo shows as an
error row.
`docs/superpowers/specs/2026-11-22-auto-add-repos-design.md` covers what the comment describes.

## Global Constraints

- Node 23.11 (`/opt/homebrew/bin/node`) for test runs. Node 22.14 fails `dock-core-class` (needs ≥ 22.15),
  which predates this work.
- No change to `src/` beyond the comment. No `app/` rebuild unless `npm run build:app` changes a tracked file
  other than `app/VERSION.json`'s `source`.

## Review Focus

- **A machine that stops answering** (exec throws, code -1) after a good listing goes through the same
  `rp.code !== 0` branch as code 128. The one test covers both, so no second test is needed.
- **Recovery:** when `rev-parse` answers again, the row goes back to its common-dir id with no error. This is
  pinned as the third phase of the task's test.

---

### Task 1: Guard the `commonDir` reset and fix the comment

**Files:**
- Test: `tests/collector-git.test.mjs`. Append after `auto-add (f)`, reusing `RP`, `ok`, `wtList`, `NO_ORIGIN`,
  `status` and `fakeIo`.
- Modify: `src/shared/collector.js:373`. Comment only.

**Interfaces:** none. Row ids are `idOf(machine, path)`: `"|/w/api/.git"` for the common dir and `"|/w/api"`
for the path, with machine `null` on Linux.

- [ ] **Step 1: Write the test**

```js
test("rev-parse failing after a good listing: the error row is keyed by its path, not the old common dir", async () => {
  const state = { gone: false };
  const io = fakeIo({
    platform: "linux", repos: [{ path: "/w/api", machine: null }],
    table: {
      [` -C /w/api ${RP}`]: () =>
        state.gone ? { code: 128, stdout: "", stderr: "fatal: not a git repository" } : ok("/w/api\n/w/api/.git\n"),
      " -C /w/api worktree list --porcelain": wtList(["/w/api", "main"]),
      " -C /w/api remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C /w/api status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await c.tick();
  assert.deepEqual(c.state().repos.map((r) => [r.id, r.error]), [["|/w/api/.git", null]]);
  state.gone = true; // the folder is deleted
  io.t = 60000;
  await c.tick();
  const rows = c.state().repos;
  assert.deepEqual(rows.map((r) => [r.id, r.added]), [["|/w/api", true]]);
  assert.match(rows[0].error, /not a git repository/);
  state.gone = false; // it comes back
  io.t = 120000;
  await c.tick();
  assert.deepEqual(c.state().repos.map((r) => [r.id, r.error]), [["|/w/api/.git", null]]);
});
```

- [ ] **Step 2: Prove it catches the regression**

Temporarily delete `commonDir: null, ` from `src/shared/collector.js:118`, then run:

```bash
/opt/homebrew/bin/node --test --test-name-pattern="rev-parse failing after a good listing" tests/collector-git.test.mjs
```

Expected: FAIL at the second `deepEqual`, with `'|/w/api/.git'` where `'|/w/api'` is expected.

Then restore the line with `git checkout -- src/shared/collector.js`, and confirm `git diff src/` is empty.

- [ ] **Step 3: Run the test file**

```bash
/opt/homebrew/bin/node --test tests/collector-git.test.mjs
```

Expected: PASS, 37 tests (36 before).

- [ ] **Step 4: Commit the test**

```bash
git add tests/collector-git.test.mjs
git commit -m "test(collector): an added repo whose rev-parse starts failing is keyed by its path, not its old common dir"
```

- [ ] **Step 5: Fix the comment at `src/shared/collector.js:373`**

In `// An added entry whose listing failed is keyed by its path`, change `listing failed` to `rev-parse failed`.
Nothing else on lines 373-375 changes.

- [ ] **Step 6: Check the build and the full suite**

```bash
npm run build:app && git status --short app/
/opt/homebrew/bin/node --test
```

- **Build expected:** no tracked file under `app/` changes, apart from `app/VERSION.json`'s `source` field.
  `tests/build-app.test.mjs` ignores that field, so `app/` is not committed (`git checkout -- app/`).
- **Suite expected:** 623/623 pass.

- [ ] **Step 7: Commit the comment**

```bash
git add src/shared/collector.js
git commit -m "docs(collector): the auto-add comment names rev-parse, the failure that still keys a repo by its path"
```
