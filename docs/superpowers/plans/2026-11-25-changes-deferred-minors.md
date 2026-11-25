# Changes: the branch view's deferred minors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six minors the final review of the Changes branch view (main 4fc5ca1) left, as Adam asked ("fix the deferred minors too").

**Architecture:** Data fixes in `src/shared/changes.js` (tested with the file's fake git, plus a new real-git test file for the three cases a fake can't vouch for); two small panel changes in `src/mods/dock-changes/main.js`.

**Tech Stack:** JavaScript (ESM), `node --test`, git CLI.

**Spec:** the six minors, as reported to Adam (no separate doc):
1. Switching the view while a commit runs leaves the message in the box and hides a "Commit failed" note.
2. In the Branch view, the "first 1,000 files" note can show wrongly in its three early cases (on the default branch, no default branch, no shared history).
3. New files past the 1,000 limit drop out of the Branch view without the note.
4. Conflicted files show `M`, not `U`, in the Branch view.
5. No branch-view tests for detached HEAD, a repo with no commits, or a branch with no commits of its own (merge base = HEAD).
6. Every refresh asks git for ahead/behind counts and looks up the default branch again (slow on a remote machine).

## Global Constraints
- The mod runtime has no `Intl`: nothing `main.js` imports may use it.
- Every git call goes through `runGit` (works on a remote machine via `on`) and stays read-only (`GIT_READ`).
- `app/` is generated (`npm run build:app`); `herdr-app check app/mods/dock-changes` must pass. Known baseline failure: `tests/dock-core-class.test.mjs`.
- `--no-ahead-behind` needs git ≥ 2.17 (2018) on every machine the panel reads, remote ones included.

## Review Focus
- A cached default branch must not outlive its folder or view: switching either starts a fresh lookup (Task 2 wiring; Task 1 test for reuse).
- A repo with no commits yet must not cache "no default branch" for the rest of the session: only names that were found are reused (Task 1 test).
- More than 1,000 status entries in the uncommitted view: still capped at 1,000 with the note, unchanged (existing tests).
- Real-git tests must not depend on the machine's git config (`user.*`, `init.defaultBranch`) (Task 1 tests).

---

### Task 1: data (`src/shared/changes.js`) and tests

**Interfaces:**
- `fetchChanges({ ..., mode, bases = null })` — `bases: { name: string|null, remote: string|null } | null`, the lookups a previous call returned; in `mode: "branch"` the result carries `bases` for the next call. Only found values are reused: `name` skips `defaultBranch`, `remote` skips the `origin/<name>` check.
- `folderOf(context: string|null): string|null` — the panel's follow key (`JSON.stringify({ ...location, view })`) without `view`.

- [ ] **Step 1: Failing tests** in `tests/changes.test.mjs` (fake git, as the file does):
  - `folderOf`: two keys differing only in `view` → equal; differing `cwd` → not equal; `folderOf(null)` → `null`.
  - Early cases keep no stale note: 1,001 status entries, `mode: "branch"` → on `main`: `onBase`, `limited === false`; no default branch: `limited === false`; no shared history: `limited === false`.
  - 600 ` M` + 500 `??` status entries, branch diff lists the 600 → `files.length === 1000`, `limited === true` (today: `false`, untracked were cut at 1,000 before merging).
  - Branch `--name-status` `U\0a.js\0` → `a.js` has status `U`.
  - The status call's args include `--no-ahead-behind`.
  - A second `fetchChanges` with the first result's `bases` makes no `symbolic-ref` or `rev-parse --verify` calls and gets the same `base`; with `bases: { name: null, remote: null }` it looks them up again.
- [ ] **Step 2: Real-git tests** in a new `tests/changes-git.test.mjs`: temp repos made with `git` (commits use `-c user.name=t -c user.email=t@t`; the first branch set with `git symbolic-ref HEAD refs/heads/main`), read by `fetchChanges` through a real `exec` (`execFile`), `mode: "branch"`:
  - detached HEAD one commit past `main`: `branch === null`, `base === "main"`, that commit's file listed.
  - no commits yet (one untracked file): no throw, `base === null`, `files` empty.
  - branch with no commits of its own, one modified and one untracked file: `mergeBase` = HEAD's sha, files are exactly those two (`M`, and `A` fresh).
- [ ] **Step 3: Run** `node --test tests/changes.test.mjs tests/changes-git.test.mjs` — Expected: Step 1's tests FAIL; Step 2's PASS (they pin behaviour the reviewer saw working; break one on purpose once to see it can fail, then restore).
- [ ] **Step 4: Implement:** `limited: false` on the three early returns; in branch mode parse status with no cap (`parsePorcelainStatus(..., Infinity)`) so every untracked file reaches the merge, then cap the merged list at `FILE_LIMIT` (the uncommitted view keeps its cap); keep `U` from `--name-status`; add `--no-ahead-behind` to both status calls; `bases` as in Interfaces; `folderOf`.
- [ ] **Step 5: Run** the same command — Expected: all pass. **Commit** `fix(changes): branch view — no stale note, every new file counted, conflicts show U, fewer git calls per refresh`.

### Task 2: the panel (`src/mods/dock-changes/main.js`)

- [ ] **Step 1:** `commit()` clears the message and shows "Commit failed" when `folderOf(key()) === folderOf(context)` (was the full key, which includes the view); `onReset` uses `folderOf(nextContext)` for its keep-the-message check. Keep `this.bases`: pass it to `fetchChanges`, store `res.bases`, clear it in `onReset` and when the folder isn't a repo.
- [ ] **Step 2:** `npm run build:app && herdr-app check app/mods/dock-changes && npm test 2>&1 | tail -4` — Expected: check passes; suite passes except `dock-core-class`. **Commit** `fix(changes): a commit finishing after a view switch clears its message; the default branch is looked up once per folder and view`.
