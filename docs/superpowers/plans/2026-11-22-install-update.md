# Install and update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Per-PC settings in their own untracked file, an Updates strip in the Dock layout dialog (auto check, Check now, Update), `npm run update`, and an agent-readable `INSTALL.md`.

**Architecture:**
- Pure logic lives in `src/shared/config.js` (local merge and migration), `src/shared/update.js` (check state, notify rule, result file) and `scripts/update-steps.mjs` (the update script's decisions). It is unit-tested.
- dock-core owns git checks, the local-file watch, migration and the update state (`dock.update.state`).
- The dialog reads base + local, saves local, and draws the strip.
- Deploy migrates, records `repo` in `source.json`, and stays the one installer.

**Tech Stack:** Herdr mods, Node ≥ 22 scripts, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-22-install-update-design.md` (including "Calls made after the builder check").

## Global Constraints

- Local file: `<app home>/herdr-dock/local.json`, shape `{ "v": 1, "regions": { … } }`. App home is `$HERDR_APP_HOME` or `~/.config/herdr-app`, the same rule as `scripts/deploy.mjs`.
- Merge order: base, then `machines.<host>` (compatibility), then local.
- Migration only when the local file is missing and `machines.<host>` exists:
  - move that section to the local file and delete it from `config/dock.json`;
  - if the rest is JSON-equal to `git show HEAD:config/dock.json`, write git's exact text;
  - other hosts' sections stay.
- The shared default (`config/dock.json` base + `DEFAULT_CONFIG`) places only Herdr-shipped mods or `dock-*` mods. Herdr-shipped mods are the non-`dock-` keys of a fresh `installed.json`; pin the list in a test fixture.
- Update check:
  - `git -c credential.interactive=never fetch --quiet origin main` with a 30 s timeout, at dock-core start and every **6 h**, plus `update.check`;
  - "available" only on branch `main`, with 0 commits ahead and ≥ 1 behind;
  - one notification per new upstream sha (`dock.update.notified`).
- `dock.update.state = { status: "idle"|"checking"|"available"|"updating"|"updated"|"failed"|"blocked", current, latest, behind, subject, checkedAt, reason, startedAt }`.
- Update tab: `tab.new { name: "Update herdr-dock", folder: <repo>, argv: ["node", "scripts/update.mjs"] }`.
- Result file: `<app home>/herdr-dock/update-result.json` = `{ ok, from, to, commits, reason, at }`. dock-core consumes it (strip + notification) and deletes it. Still `updating` after **10 min** with no result → failed, reason `no result (was the update tab closed?)`.
- Never commit `machines.*`. After Task 2's migration this PC's `config/dock.json` should be clean.

## Review Focus

- **A local file that's corrupt JSON or has a bad region:**
  - the merged config ignores it with an error shown (as config errors are today);
  - the dialog opens read-only with that error;
  - nothing is overwritten.

  Task 1 test: `mergeWithLocal: an invalid local file is reported, not merged`.
- **Migration run twice, or by deploy and dock-core in a row:** the second run is a no-op. Task 1 test: `migrationPlan: nothing to do once the local file exists`.
- **`git fetch` hanging or asking for credentials:** times out in 30 s and shows `Can't check: …`, never a stuck "checking". Task 4 test on the state from a failed fetch result, plus the dock-core timeout.
- **The repo with local changes, on a branch, or ahead:** the strip says why it can't update and no notification is posted. Task 4 tests: `updateState: blocked when dirty / off main / ahead`.
- **A result file left by an update while Herdr was closed:** consumed on the next start and shown once, then deleted. Task 4 test: `resultToState: success and failure shapes`.

---

### Task 1: Local config file — merge and migration (pure)

**Files:** Modify `src/shared/config.js`. Test `tests/config-local.test.mjs`. Add an allowed-mods test in `tests/config-local.test.mjs`.

**Interfaces — Produces:**
- `parseLocal(text) -> { ok: true, local: { v, regions } | null } | { ok: false, error }`. Text `null` gives `{ ok: true, local: null }`. Regions are validated like a machines section.
- `mergeWithLocal(config, host, local) -> merged`: base, then `machines.<host>`, then local.
- `migrationPlan({ configText, host, localText, headText }) -> null | { localText, configText }`. `null` means nothing to do. `configText` is git's exact `headText` when the rest is JSON-equal to it.
- `LOCAL_REL = "herdr-dock/local.json"`.

- [ ] **Step 1: Write the failing tests.**
  - The merge order: local beats machines beats base.
  - `parseLocal(null)` gives `{ ok: true, local: null }`; junk gives `ok: false`.
  - `mergeWithLocal: an invalid local file is reported, not merged`: callers use `parseLocal` first; assert the error path.
  - `migrationPlan` moves this host's section (case-insensitive host) and keeps other hosts.
  - `migrationPlan` restores `headText` exactly when the rest equals it.
  - `migrationPlan: nothing to do once the local file exists`, and nothing when there's no section.
  - **Allowed mods:** every mod in `DEFAULT_CONFIG` and the base of `config/dock.json` is `dock-*` or in the pinned Herdr-shipped list.
- [ ] **Step 2: Run** `node --test tests/config-local.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** in `config.js`, reusing `parseConfig`'s region checks and `deepMerge`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(config): per-PC local file — merge and one-time migration`.

### Task 2: Deploy and dock-core use the local file

**Files:** Modify `scripts/deploy.mjs`, `src/mods/dock-core/main.js` (and `src/shared/config.js`'s `planApply` if it needs the local text). Tests: `tests/build.test.mjs` / deploy tests for `source.json.repo` and migration.

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `source.json` gains `repo` (the repo root, slash path).
  - dock-core merges base + local everywhere it merges today (`reload`, `planApply`).
  - dock-core watches `<app home>/herdr-dock/` as well as the config folder.
  - Shared key `dock.config.localPath`.

- [ ] **Step 1: Write the failing tests.** Deploy in a temp app home with a config that has `machines.<this host>`:
  - the local file is written;
  - the section is removed;
  - `source.json` has `repo`;
  - the layout built uses the local regions;
  - running deploy again changes nothing.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Deploy:** read the local file, run `migrationPlan` (headText via `git show HEAD:config/dock.json`; skip the exact-restore step if git fails), write both files, merge with local for the layout.
  - **dock-core:**
    - on start, the same migration through `exec("git", …, { cwd: repo })` and `writeTextFile`;
    - then `reload` reads the local file each time;
    - the watch loop also watches the local folder (create the folder if missing, with a `.keep` file).
- [ ] **Step 4: Run** `npm test`, then `npm run deploy` on this PC. Check:
  - `~/.config/herdr-app/herdr-dock/local.json` holds the old `machines.forkadam-pc` regions;
  - `git status` shows `config/dock.json` clean;
  - the right panel still has mission-control-github;
  - `herdr-app status` shows no errors.
- [ ] **Step 5: Commit** `feat(config): deploy and dock-core read the per-PC local file`.

### Task 3: The Dock layout dialog saves to the local file

**Files:** Modify `src/shared/edit.js` (`planSave`/`planReset` become local-file planners), `src/mods/dock-config/session.js`, `src/mods/dock-config/main.js` (the header comment and the "Reset this PC to shared" path). Tests: the existing edit and session tests, updated.

**Interfaces:**
- Consumes: Task 1, and `dock.config.localPath` (Task 2).
- Produces:
  - `planSave(baseText, localText, host, draft) -> { ok, text }`: the local file text with `machineSection`'s diff, against the base merged with `machines.<host>`.
  - `planReset() -> { ok, delete: true }`.
  - The session keeps `opened` for the **local** file (`null` when missing) and `baseText` for the shared file. Conflicts are checked against the local file.

- [ ] **Step 1: Update and add the failing tests:**
  - saving writes only the local file, never `config/dock.json`;
  - a save matching the base deletes the local file, or writes empty regions (pick one and test it);
  - Reset deletes it;
  - a local file changed on disk triggers the existing rebase path;
  - an invalid local file makes the session read-only with its error.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Deleting uses the host's file API if present; otherwise write an empty-regions file. Check `herdr.d.ts`.
- [ ] **Step 4: Run** `npm test`, then `npm run deploy`. In Herdr, open the dialog, make one change, Save, and confirm `local.json` changed and `config/dock.json` is untouched. Then undo it (Reset this PC, then restore `local.json` from the copy you made before testing).
- [ ] **Step 5: Commit** `feat(dock-config): save per-PC edits to the local file`.

### Task 4: Update check and state in dock-core

**Files:** Create `src/shared/update.js`. Modify `src/mods/dock-core/main.js`, and `src/shared/notifycmd.js` or `gitcmd.js` for the `update.check` command name. Test `tests/update.test.mjs`.

**Interfaces — Produces:**
- `UPDATE_KEY = "dock.update.state"`, `NOTIFIED_KEY = "dock.update.notified"`, `RESULT_REL = "herdr-dock/update-result.json"`.
- `updateState({ fetchOk, fetchError, branch, ahead, behind, latest, subject, current, dirty }, now) -> state`. Covers available, idle (up to date), blocked (dirty, off main, ahead) and failed (fetch).
- `shouldNotify(state, notifiedSha) -> boolean`: true only when available and `latest !== notifiedSha`.
- `resultToState(resultJson, prev, now) -> state`, for success and failure.
- `timedOut(state, now) -> state | null`: 10 min.
- Command `dock-core.update.check` (no args).

- [ ] **Step 1: Write the failing tests:**
  - `updateState: available` (on main, ahead 0, behind 3);
  - `updateState: up to date`;
  - `updateState: blocked when dirty / off main / ahead`;
  - `updateState: fetch failed → failed with "Can't check: <first line>"`;
  - `shouldNotify` (new sha yes, same sha no, not available no);
  - `resultToState: success and failure shapes`;
  - `timedOut` at 10 min and not before.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `update.js`. In dock-core:
  - a check runs at start (after migration) and every 6 h, plus on `update.check`;
  - each run does the fetch (30 s timeout), then `rev-list --count`, the `log -1` subject, `status --porcelain`, `rev-parse --abbrev-ref HEAD`, and `rev-list --count origin/main..HEAD`;
  - it publishes `UPDATE_KEY`;
  - when `shouldNotify`, it posts `notify({ title: "herdr-dock update available", body: "<N> new commits", level: "info", action: { name: "mod.open", args: { name: "dock-config" } } })` and sets `NOTIFIED_KEY`;
  - the local-folder watch (Task 2) also notices `update-result.json` and applies `resultToState`: notify success ("herdr-dock updated to <sha>") or failure (error level), then delete the file;
  - at start, consume any leftover result file;
  - each tick, apply `timedOut`.
- [ ] **Step 4: Run** `npm test`, `npm run deploy`, then `herdr-app do dock-core.update.check`. `dock.update.state` in `shared.json` should show `idle` (up to date) on this PC.
- [ ] **Step 5: Commit** `feat(update): dock-core checks for herdr-dock updates`.

### Task 5: `npm run update`

**Files:** Create `scripts/update.mjs` and `scripts/update-steps.mjs` (pure decisions). Modify `package.json` (`"update": "node scripts/update.mjs"`). Test `tests/update-steps.test.mjs`.

**Interfaces:**
- Consumes: `RESULT_REL` (Task 4), and the app-home rule from deploy (move it into a shared helper `scripts/app-home.mjs` if deploy has it inline).
- Produces:
  - `preflight({ dirty, branch }) -> { ok } | { ok: false, reason }`;
  - `needsInstall(changedFiles) -> boolean` (`package.json` or `package-lock.json`);
  - `resultOf({ from, to, commits, ok, reason }, now)`.

- [ ] **Step 1: Write the failing tests** for `preflight` (dirty → `local changes: <files>`, off main → `on branch X`), `needsInstall`, and `resultOf`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `update.mjs`. It prints each step, then runs:
  1. `git status --porcelain` and the branch, then `preflight`;
  2. `git pull --ff-only origin main`;
  3. `git diff --name-only <from> <to>`, then `npm install` only if `needsInstall`;
  4. `node scripts/deploy.mjs`.

  It writes the result file at every exit (success or the first failure), and exits non-zero on failure.
- [ ] **Step 4: Run** `npm test`. Then on this PC (up to date) run `npm run update`: it says "already up to date", writes an ok result with 0 commits, and dock-core shows `✓ Up to date`.
- [ ] **Step 5: Commit** `feat(update): npm run update — pull, install if needed, deploy, report`.

### Task 6: Updates strip in the Dock layout dialog

**Files:** Modify `src/mods/dock-config/main.js` (and `ui.js` if helpers belong there). Create `src/mods/dock-config/update-view.js` (pure). Test `tests/update-view.test.mjs`.

**Interfaces:**
- Consumes: `UPDATE_KEY` and the state shape (Task 4), the `dock-core.update.check` command, and `source.json.repo` / a shared key with the repo path (Task 2; publish `dock.config.repo` from dock-core if needed).
- Produces: `updateStrip(state, now) -> { text: string, tone: "dim"|"accent"|"ok"|"bad", action: null | { label: "Check now"|"Update", kind: "check"|"update" } }`.

- [ ] **Step 1: Write the failing tests** with the spec's wording:
  - `herdr-dock e0aa740 · up to date · checked 2h ago` with Check now;
  - `Update available · 3 new commits (latest: "<subject>")` with Update;
  - `Updating… see the "Update herdr-dock" tab` with no action;
  - `✓ Updated to 7f3c2a1 · 3 commits`, then Check now;
  - `Can't update: local changes in …`, `Can't update: on branch X`, `Can't check: <error>`, each with Check now;
  - `checking` shows `Checking…` with no action.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the strip above the tabs, in the header's style.
  - **Check now:** `run("dock-core.update.check")`.
  - **Update:** set the state to `updating` through a command `dock-core.update.start` (add it to Task 4's dock-core handling: it sets `status: "updating"` and `startedAt`), then `run("tab.new", { name: "Update herdr-dock", folder: repo, argv: ["node", "scripts/update.mjs"] })`.
- [ ] **Step 4: Run** `npm test` and `npm run deploy`. Open the dialog: the strip shows up to date, and Check now goes Checking… then back. Capture with `herdr-app shot`.
- [ ] **Step 5: Commit** `feat(dock-config): updates strip — check now and update`.

### Task 7: INSTALL.md and README

**Files:** Create `INSTALL.md`. Modify `README.md` (Install, Updating, Config: local file).

- [ ] **Step 1:** Write `INSTALL.md` as an agent checklist, following the spec's Goals item 8 and Call 7:
  - check prerequisites;
  - ask for the clone folder (suggest `~/herdr-dock`), then `gh repo clone forkadam/herdr-dock <dir>`;
  - `npm install`, then `npm run deploy`, then `herdr-app status`;
  - the status-line line, read from `~/.claude/settings.json` `statusLine.command`, and only after asking;
  - optional `gh`/`glab`, only after asking;
  - restart Herdr if a CLI was installed;
  - a closing summary for the user;
  - and what never to touch.
- [ ] **Step 2:** README:
  - Install points to INSTALL.md (the manual steps stay);
  - a new "Updating" section covering the strip, Check now, the 6 h check, `npm run update`, and the can't-update reasons;
  - Config says per-PC edits live in `~/.config/herdr-app/herdr-dock/local.json`, with the one-time move.
- [ ] **Step 3: Run** `npm test`. Commit `docs: INSTALL.md for agents; updating and the per-PC local file`.
