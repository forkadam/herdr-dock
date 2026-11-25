# Changes: the folder it follows, and a branch view — design (short) and plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Why (Adam).** Changes sometimes shows nothing when he expects changes: it shows only *uncommitted* work (agents
commit as they go, so it empties), and it never says which folder it follows ("last thing you did wins"). He asked
for both fixes: show the folder and branch, and add a branch view.

**Design.**
- **Header**: under "Changes · N files", a dim line `<repo folder name> · <branch>` (`detached` when HEAD isn't on
  a branch), and in the branch view `… · vs main`. The branch comes from `git status --branch` (no extra git call).
- **Two views**, a small toggle in the header: **Uncommitted** (today's) and **Branch**: everything on this branch that
  isn't on the default branch yet, committed or not — `git diff <merge-base>` (working tree vs the merge base) plus
  untracked files, with per-file diffs against the merge base. The choice is remembered (shared `dock.changes.view`).
- **The default branch**: `origin/HEAD`'s name (e.g. `main`), as the local branch when it exists, else
  `origin/<name>`; without `origin/HEAD`, local `main`, then `master`. *My call:* local first, because Adam merges
  locally before pushing, and a branch view against a stale `origin/main` would show already-merged work.
- On the default branch itself, or with no default branch found, the branch view says so ("On main: nothing to
  compare" / "No main or master branch to compare with") instead of a list.
- The Commit box still commits the uncommitted changes, in either view.

## Global Constraints
- Uncommitted view and its git calls unchanged except `status` gains `--branch` (its `## …` entry is skipped as a file).
- Works on remote machines (`on`) like the rest of Changes. No new dependency.
- `app/` is generated; `herdr-app check app/mods/dock-changes` must pass. Known baseline failure: `tests/dock-core-class.test.mjs`.

## Review Focus
- A branch whose merge base is HEAD itself (nothing committed yet): branch view = uncommitted list (Task 1 test).
- Untracked files in the branch view: listed as added (Task 1 test).
- Detached HEAD and a fresh repo (no commits): header and branch view don't throw (Task 1 test).
- `origin/HEAD` pointing at a branch with no local copy: compare with `origin/<name>` (Task 1 test).

---

### Task 1: data — branch name, default branch, branch view (`src/shared/changes.js`)

**Interfaces:** `parsePorcelainStatus(stdout, stats, limit)` also returns `branch: string | null` (from `## main...origin/main` → `main`; `## HEAD (no branch)` → `null`; `## No commits yet on main` → `main`); `fetchChanges({ ..., mode = "uncommitted" })` returns `branch`, and for `mode: "branch"` also `{ base, mergeBase, onBase }` with `files` from the branch diff; `defaultBranch(runGit): Promise<string|null>`.

- [ ] **Step 1: Failing tests** in `tests/changes.test.mjs` (fake `exec` keyed on args, as the file does):
  - `parsePorcelainStatus` with `## feat...origin/feat\0 M a.js\0` → `branch: "feat"`, files `[a.js]`; `## HEAD (no branch)\0` → `null`; `## No commits yet on main\0?? x\0` → `"main"`.
  - `fetchChanges({ mode: "branch" })` on `feat` with `origin/HEAD` → `origin/main` and local `main`: `base: "main"`, `mergeBase` from `merge-base HEAD main`, files from `diff <mb> --name-status` + `--numstat` (committed `b.js` A, modified `a.js` M) plus untracked `n.js` (A, fresh).
  - On `main` itself: `onBase: true`, no files. No `origin/HEAD`, only `master`: `base: "master"`. `origin/HEAD` → `origin/dev` with no local `dev`: `base: "origin/dev"`.
  - The two existing call-count tests still pass unchanged (uncommitted mode).
- [ ] **Step 2: Run** `node --test tests/changes.test.mjs` — Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement**, run again — Expected: all pass. **Commit** `feat(changes): branch name, default branch and a branch view's data`.

### Task 2: the panel (`src/mods/dock-changes/main.js`), README

- [ ] **Step 1:** Header line `<basename(root)> · <branch ?? "detached">` (+ ` · vs <base>` in the branch view), dim 11 px, truncated; a two-item toggle **Uncommitted / Branch** (shared `dock.changes.view`, default `uncommitted`) that switches the view and refreshes; `fetchChanges` gets `mode`; per-file diffs use `mergeBase` instead of `HEAD` in the branch view; empty states: "No uncommitted changes", "Nothing on <branch> that isn't on <base>", "On <base>: nothing to compare", "No main or master branch to compare with".
- [ ] **Step 2: README** (the Files/Changes bullet): what each view shows, the header line, how the default branch is found.
- [ ] **Step 3:** `npm run build:app && herdr-app check app/mods/dock-changes && npm test 2>&1 | tail -4` — Expected: check passes; suite passes except `dock-core-class`. **Commit** `feat(changes): the header says which folder and branch it follows; a Branch view`.
