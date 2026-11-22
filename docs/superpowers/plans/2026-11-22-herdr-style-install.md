# Herdr-style install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A committed `app/` folder that Herdr's "add this layout: <link>" convention can install. dock-core gets an app mode that needs no clone, and updates go through `update-app.mjs` in a visible tab.

**Architecture:**
- **Pure helpers, unit-tested:**
  - `src/shared/appver.js`: the content hash and the version compare;
  - `src/shared/keys.js`: `mergeKeys`, moved from `scripts/keys.mjs`, which re-exports it;
  - `src/shared/update.js`: gains an app-mode state builder;
  - `src/app/update-app-steps.js`: the updater's decisions.
- **`src/app/update-app.js`** is bundled by esbuild into one file, `app/mods/dock-core/update-app.mjs`, which runs without the repo.
- **`scripts/build-app.mjs`** produces `app/` from `buildAll()` plus the app-only files. A drift test keeps `app/` honest.
- **dock-core** detects the mode from `source.json`. The dialog picks the update action by mode.

**Tech Stack:** Herdr mods, Node ≥ 22, esbuild 0.24, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-22-herdr-style-install-design.md` (including "Calls made after the builder check").

## Global Constraints

- **`app/` layout:**
  - `layouts/herdr-dock.json`;
  - `mods/dock-*/`;
  - `keys.json`, holding only the `layout:herdr-dock` section with deploy's 3 bindings;
  - `RECIPE.md`, `preview.png` (both written by hand);
  - `VERSION.json` = `{ repo: "forkadam/herdr-dock", branch: "main", version, source, mods: [...] }`.
- **`version`** is the first 12 hex digits of a sha256 over every file in `app/` except `VERSION.json`, `mods/dock-core/VERSION.json` (its copy), `RECIPE.md` and `preview.png`, in sorted path order. Hash each entry as path, a NUL byte, the byte length, a NUL byte, then the content (length framing, so entries can't run into each other). **`source`** is the short sha of HEAD at build time and is for display only.
- **App-only files:**
  - in `mods/dock-core/`: `source.json` `{ "mode": "app" }`, `config.json` (a copy of `config/dock.json`), `VERSION.json` (a copy of `app/VERSION.json`), `update-app.mjs`;
  - `mods/dock-quotas/herdr-statusline-cache.mjs`.
- **Clone installs are unchanged:** `buildAll()` and deploy stay as they are.
- **App-mode check:** first a plain download of `https://raw.githubusercontent.com/<repo>/<branch>/app/VERSION.json`, then `gh api repos/<repo>/contents/app/VERSION.json -H "Accept: application/vnd.github.raw"`. It runs at start, every 6 h and on Check now. It notifies once per new published `version`.
- **`update-app.mjs` steps, in order:**
  1. `git clone --depth 1 --branch <branch> <url>` into a temp folder; the url is `https://github.com/<repo>.git`, or `$DOCK_APP_REMOTE` (test override);
  2. `herdr-app check` every `app/mods/<name>`; stop on any failure, before anything is replaced;
  3. replace each `mods/<name>` listed in the new `VERSION.json`;
  4. remove a `dock-*` mod only if the old list has it and the new list doesn't;
  5. never touch `layouts/herdr-dock.json`, `local.json`, other mods, or existing keys; add only missing bindings to the `layout:herdr-dock` section;
  6. write `<app home>/herdr-dock/update-result.json` `{ ok, from: <old source>, to: <new source>, commits: null, reason, at }`;
  7. delete the temp folder.
- **App home** for `update-app.mjs` is the folder two levels above its own file (`<home>/mods/dock-core/`), or `--app-home`.
- **RECIPE "Watch out":** don't rename; stop and ask if any `dock-*` mod or `layouts/herdr-dock.json` exists; list what the mods run and read.

## Review Focus

- **An app-mode update where one new mod fails `herdr-app check`:** no file is replaced; the result is failed with that mod named. Task 2 test: `update-app: a failing check replaces nothing`.
- **The published `VERSION.json` can't be read** (no network, gh not logged in): `Can't check: …`, never stuck on checking, no notification. Task 4 test: `appUpdateState: fetch failure`.
- **`app/` out of date with the source:** the drift test fails with the differing paths named. Task 3 test.
- **The person already uses Ctrl+Alt+B for something else:** the update leaves it and reports it skipped. Task 2 test: `update-app: keeps a key the person uses`.
- **An app install with a per-PC `local.json`:** after an update, dock-core's rebuilt layout still applies it. Task 4: dock-core reads `local.json` in app mode (the same code path as clone mode); test that `planApply` is fed `config.json`'s text in app mode.

---

### Task 1: Pure pieces — content hash, keys merge, app-mode state

**Files:**
- Create `src/shared/appver.js` and `src/shared/keys.js`.
- Modify `scripts/keys.mjs` (re-export from `src/shared/keys.js`) and `src/shared/update.js`.
- Test `tests/appver.test.mjs`, plus additions to `tests/update.test.mjs`.

**Interfaces — Produces:**
- `contentVersion(files) -> string`. `files` is `[{ path, bytes }]`; the result is 12 hex digits. Paths use forward slashes and are sorted inside the function.
- `appVersionFiles(paths) -> paths`: leaves out `VERSION.json`, `RECIPE.md` and `preview.png` at the root of `app/`.
- `mergeKeys` moves unchanged; its signature stays what deploy uses.
- `appUpdateState({ fetchOk, fetchError, installed, published }, now, prev) -> state`, with `mode: "app"`:
  - available when `published.version !== installed.version`, showing `current: installed.source`, `latest: published.source`;
  - idle when they're equal;
  - failed with reason `Can't check: <first line>` on a fetch failure;
  - keeps `updated` the way `updateState` does.
- `shouldNotify` works for app mode, keyed on `published.version`.

- [ ] **Step 1: Write the failing tests:**
  - `contentVersion`: the same bytes in a different order give the same hash; one changed byte gives a different hash; a path rename changes it.
  - `appVersionFiles` leaves out the three root files and keeps `mods/x/VERSION.json`.
  - `appUpdateState`: available, idle, fetch failure, and keeps updated.
  - `shouldNotify` in app mode.
  - The existing keys tests pass when imported from `src/shared/keys.js`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Hash with `node:crypto` in `appver.js`; it's only used by Node scripts. dock-core never hashes; it compares strings.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): content version, shared keys merge, app-mode update state`.

### Task 2: `update-app` — the app-mode updater

**Files:**
- Create `src/app/update-app-steps.js` (pure) and `src/app/update-app.js` (I/O; bundled in Task 3).
- Test `tests/update-app.test.mjs`.

**Interfaces:**
- Consumes: `mergeKeys`, `RESULT_REL` (`src/shared/update.js`), `contentVersion` (optional sanity check).
- Produces:
  - `planSwap(oldVersion, newVersion) -> { replace: [names], remove: [names] }`;
  - `addMissingKeys(keysText, appKeysText) -> { text, skipped: [key] }`;
  - `resultFor({ ok, from, to, reason }, now)`;
  - `runUpdateApp({ appHome, remote, branch, io })`, with an injectable `io` for tests (exec, fs).

- [ ] **Step 1: Write the failing tests:**
  - **Pure:** `planSwap` (removed, replaced and never-touched mods); `addMissingKeys` (adds a missing binding; keeps an existing one and reports it skipped; leaves other sections alone).
  - **Sandbox, with a temp app home and a temp git repo as `DOCK_APP_REMOTE` that contains an `app/` folder:**
    1. happy path: mods replaced, `layouts/` untouched, `local.json` untouched, result ok;
    2. `update-app: a failing check replaces nothing`: use a fake `herdr-app` via the injectable io;
    3. `update-app: keeps a key the person uses`;
    4. the temp folder is deleted in every case.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Print each step. Exit non-zero on failure, always after writing the result file. Run the real `herdr-app check` through `exec`, resolved from PATH.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): update-app — clone, check every mod, swap, report`.

### Task 3: `npm run build:app` and the committed `app/`

**Files:**
- Create `scripts/build-app.mjs`.
- Modify `package.json` (`"build:app": "node scripts/build-app.mjs"`) and `.gitattributes` if needed (built files are LF).
- Create `app/`, generated, except `RECIPE.md` and `preview.png`, which Task 5 adds.
- Test `tests/build-app.test.mjs`.

**Interfaces:**
- Consumes: `buildAll()`, `buildLayout`, `parseConfig`/`mergeForHost` (no host, no local), `contentVersion`, `appVersionFiles`; deploy's `BINDINGS` and `SECTION` (export them from deploy, or move them to `scripts/keys.mjs`).
- Produces: `buildApp(outDir) -> { version, source }`.

- [ ] **Step 1: Write the failing tests:**
  - `buildApp(tmp)` produces every Global Constraints file;
  - `VERSION.json` `mods` matches the folders;
  - `version` equals `contentVersion` over `appVersionFiles`;
  - **drift:** `buildApp(tmp)` compared with the committed `app/` (except `RECIPE.md`, `preview.png` and `VERSION.json` `source`) is equal, with differing paths named on failure;
  - two builds give identical bytes.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Bundle `src/app/update-app.js` with esbuild (platform node, format esm, all deps inlined) to `app/mods/dock-core/update-app.mjs`.
  - Copy `scripts/herdr-statusline-cache.mjs` into `app/mods/dock-quotas/`.
  - `app/layouts/herdr-dock.json` comes from `buildLayout(mergeForHost(config, ""), {})`.
  - Run `npm run build:app` and commit `app/`.
- [ ] **Step 4: Run** `npm test` (drift included). Expected: PASS. Then `herdr-app check` each `app/mods/*`.
- [ ] **Step 5: Commit** `feat(app): build:app and the committed app/ folder`.

### Task 4: dock-core app mode and the strip

**Files:**
- Modify `src/mods/dock-core/main.js` and `src/mods/dock-config/main.js`.
- Modify `src/mods/dock-config/update-view.js` (app-mode wording, if any differs).
- Tests: `tests/update-view.test.mjs`, plus a small pure helper test for mode detection (`modeOf(source) -> "app"|"clone"|null`).

**Interfaces:**
- Consumes: Task 1's `appUpdateState`, `shouldNotify`, `RESULT_REL`.
- Produces:
  - `dock.update.state.mode`;
  - in app mode, `dock.config.repo` is unset;
  - the dialog's Update runs `run("dock-core.update.start")` and then `tab.new { name: "Update herdr-dock", folder: <app home>, argv: ["node", "<app home>/mods/dock-core/update-app.mjs"] }`.

- [ ] **Step 1: Write the failing tests:**
  - `modeOf({repo})` gives clone, `modeOf({mode:"app"})` gives app, junk gives null;
  - `updateStrip` for an app-mode idle state reads `herdr-dock <source> · up to date · checked …`;
  - app-mode available reads `Update available · <installed> → <published>`;
  - app mode never shows blocked or redeploy.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** In dock-core app mode:
  - the config path is `mods/dock-core/config.json`, read-only;
  - no migration and no git;
  - the version check does a `fetch` of the raw URL, falling back to `exec("gh", […])`, with a 30 s timeout each;
  - the installed version comes from `mods/dock-core/VERSION.json`;
  - result-file consumption and the 10-minute timeout are shared with clone mode.

  The dialog picks the action by `state.mode`.
- [ ] **Step 4: Run** `npm test`. Then simulate an app install in a temp app home: copy `app/` contents, run `herdr-app check`, and confirm `mods/dock-core/source.json` there is app mode. On this PC, `npm run deploy`: clone mode is unchanged (strip idle, `mode: "clone"`).
- [ ] **Step 5: Commit** `feat(app): dock-core app mode — shipped config, published-version check, update-app action`.

### Task 5: RECIPE, preview and docs

**Files:**
- Create `app/RECIPE.md` and `app/preview.png`.
- Modify `README.md` (a new "Install the Herdr way" subsection under Install, with both status-line lines and the update behaviour in app mode).
- Modify `INSTALL.md` (one line: the Herdr-style link is the alternative).

- [ ] **Step 1:** Write `RECIPE.md` per AGENTS.md's five sections, from the real files:
  - what you see (all regions);
  - how it behaves;
  - built from (the node tree, each mod, the shipped mods used, the programs run, the files read);
  - Watch out: don't rename; stop and ask on clashes; it runs git, gh, node, and ps or PowerShell; it reads Claude/Codex usage files; a clone install already exists means use `npm run update`; the status-line line for app mode;
  - the update path.
- [ ] **Step 2:** `preview.png`: a `herdr-app shot` of herdr-dock with the right panel shown, saved to `app/preview.png`.
- [ ] **Step 3:** README and INSTALL.md. Run `npm test`, then `npm run build:app` (it must leave `app/` unchanged apart from the hand-written files). Commit `docs(app): RECIPE, preview and the Herdr-style install`.
