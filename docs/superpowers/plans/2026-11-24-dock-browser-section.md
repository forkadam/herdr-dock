# Dock layout dialog: a Browser section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can find the Browser panel in the Dock layout dialog and turn it on or off there, see whether setup worked, and set production hosts.

**Architecture:** Setup runs record their outcome in a small result file (like Update's). Pure decisions — the section's state, the Chrome candidates, the setup command, the `local.json` edit, host validation, the draft's production hosts, Reset — are tested functions; the dialog draws them and runs the setup in a Herdr tab, like the Updates strip.

**Tech Stack:** Node 22 ESM, `node --test`, esbuild via `npm run build:app`.

**Spec:** `docs/superpowers/specs/2026-11-24-dock-browser-section-design.md`

## Global Constraints

- Pure logic never imports `herdr`, `gpui-kit` or `gpui-base` (in `src/shared/` or a pure file beside the mod, like `src/mods/dock-config/update-view.js`); tests in `tests/*.test.mjs` (`node:test`, `node:assert/strict`).
- After any change under `src/`, `npm run build:app` and commit `app/` in the same commit (drift test). `npm test` passes except the known `tests/dock-core-class.test.mjs` (Node 22.14).
- Nothing is downloaded without the user's click. The dialog never writes `config/dock.json`, never loses or silently saves unsaved layout edits, and refuses to overwrite a `local.json` changed on disk (the dialog's existing guard and message).
- No company specifics in code, tests, README, RECIPE or INSTALL.
- No deploy without the user's yes. Commits `feat(…)`/`fix(…)`/`docs(…)`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A setup whose Chrome step fails → the section shows Failed with the message, never "On". (Task 1, Task 2)
2. The setup tab closed mid-run → after 15 minutes the section shows Failed "the setup tab was closed or stopped". (Task 2)
3. Turn on while an update is running → the buttons are disabled. (Task 2)
4. Reset this PC to shared with the browser on → the `browser` block survives. (Task 3)
5. `local.json` edited on disk between opening the dialog and Turn on → refused with the dialog's changed-on-disk message. (Task 4, review)

---

### Task 1: Setup runs record their outcome

**Files:**
- Create: `src/shared/browser/setup-result.js`
- Modify: `src/app/browser-install.js` (`main`), `scripts/deploy.mjs` (the browser step, ~lines 162–182)
- Test: `tests/browser-setup-result.test.mjs`, `tests/browser-install.test.mjs`

**Interfaces:**
- Produces (`setup-result.js`):
  - `SETUP_RESULT_REL = "herdr-dock/browser/setup-result.json"`, `ABANDON_MS = 15 * 60e3`
  - `startResult(action: "on" | "off", now) -> { state: "running", startedAt: now, action }`
  - `endResult(action, outcome: "ok" | "failed" | "unsupported", message: string, now) -> { state: outcome, at: now, action, message }`
  - `parseSetupResult(text) -> result | null` (junk → null)
  - `runState(result, now) -> "running" | "abandoned" | "ok" | "failed" | "unsupported" | null` — `running` older than `ABANDON_MS` is `abandoned`.
- Writers: `main()` in `browser-install.js` and the deploy browser step write `startResult` before installing/removing and `endResult` after: `installAgentBrowser` "unsupported" → `unsupported` ("no agent-browser build for this computer"); `ensureChrome` "failed" → `failed` ("Chrome couldn't be set up"); a thrown error → `failed` (its first line); removal → `ok` with action `off`; otherwise `ok`. `--check` and `--dry-run` write nothing.

- [ ] **Step 1: Write the failing tests**

```js
// tests/browser-setup-result.test.mjs
test("runState: running, abandoned after 15 minutes, outcomes, junk", () => {
  const t0 = 1_000_000;
  assert.equal(runState(startResult("on", t0), t0 + ABANDON_MS - 1), "running");
  assert.equal(runState(startResult("on", t0), t0 + ABANDON_MS), "abandoned");
  for (const o of ["ok", "failed", "unsupported"]) assert.equal(runState(endResult("on", o, "", t0), t0), o);
  assert.equal(runState(parseSetupResult("{nope"), t0), null);
  assert.deepEqual(parseSetupResult(JSON.stringify(endResult("off", "ok", "", 5))), { state: "ok", at: 5, action: "off", message: "" });
});
```

  In `tests/browser-install.test.mjs`, run `main()` with stubbed dependencies against a temp app home (as its existing tests do) for: an unsupported platform → the result file's `state` is `unsupported`; a Chrome step that fails → `failed` with "Chrome couldn't be set up"; `--check` → no result file.
- [ ] **Step 2:** `node --test tests/browser-setup-result.test.mjs tests/browser-install.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `setup-result.js`; write the results from `main()` and from deploy's browser step (whole-file writes under `<app home>/herdr-dock/browser/`, creating the folder).
- [ ] **Step 4:** `npm test` → PASS. **Step 5:** `npm run build:app` (the setup script is bundled into `app/`), commit `feat(browser): setup runs record their outcome`.

### Task 2: The section's model

**Files:**
- Create: `src/mods/dock-config/browser-view.js`
- Test: `tests/browser-view.test.mjs`

**Interfaces:**
- Consumes: `runState`, `ABANDON_MS` (Task 1); `checkBrowser` (`src/shared/browser/config.js`); `formatConfig`, `parseLocal` (`src/shared/config.js`).
- Produces:
  - `chromeCandidates(platform, env = {}) -> string[]` — darwin: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `/Applications/Chromium.app/Contents/MacOS/Chromium`, `/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary`; win32: `<base>\Google\Chrome\Application\chrome.exe` for each defined `env.ProgramFiles`, `env["ProgramFiles(x86)"]`, `env.LOCALAPPDATA`; linux: `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/snap/bin/chromium`.
  - `browserSection({ enabled, modInstalled, binInstalled, result, updateRunning, now }) -> { state, action, busy, message }` — `state` per the design's table: `"off" | "running" | "on" | "failed" | "unsupported" | "notSetUp"`; `action`: `"on"` (off), `"off"` (on, unsupported), `"setup"` (failed, notSetUp), `null` (running); `busy` = running or `updateRunning`; `message` = the result's message, or "the setup tab was closed or stopped" when abandoned (abandoned shows as `failed`).
  - `browserRun({ mode, repo, home }) -> { command: "tab.new", args: { name: "Set up the browser", folder, argv } }` — clone (`mode !== "app"`): `folder: repo`, `argv: ["npm", "run", "deploy"]`; app: `folder: home`, `argv: ["node", "<home>/mods/dock-browser/herdr-browser-setup.mjs"]`.
  - `withBrowserSetting(localText, { enabled, chrome }) -> string` — `local.json` text with `browser.enabled` set and `browser.chrome` set (string) or removed (`null`), every other key kept; no file → `{ v: 1, regions: {} }` plus `browser`.
  - `parseHosts(text) -> { ok: true, hosts: string[] } | { ok: false, error: string }` — split on commas and whitespace, empties dropped, lower-cased; valid when `checkBrowser({ production: hosts })` reports no problem for `production`.

- [ ] **Step 1: Write the failing tests**

```js
const t0 = 1_000_000;
const s = (o) => browserSection({ enabled: false, modInstalled: false, binInstalled: false, result: null, updateRunning: false, now: t0, ...o });
test("browserSection: the design's states", () => {
  assert.deepEqual(s({}), { state: "off", action: "on", busy: false, message: "" });
  assert.equal(s({ result: startResult("on", t0) }).state, "running");
  assert.equal(s({ result: startResult("on", t0) }).busy, true);
  assert.deepEqual(s({ result: startResult("on", t0 - ABANDON_MS) }), { state: "failed", action: "setup", busy: false, message: "the setup tab was closed or stopped" });
  assert.equal(s({ enabled: true, modInstalled: true, binInstalled: true, result: endResult("on", "ok", "", t0) }).state, "on");
  assert.deepEqual(s({ enabled: true, modInstalled: true, binInstalled: true, result: endResult("on", "failed", "Chrome couldn't be set up", t0) }),
    { state: "failed", action: "setup", busy: false, message: "Chrome couldn't be set up" });
  assert.equal(s({ enabled: true, result: endResult("on", "unsupported", "x", t0) }).action, "off");
  assert.equal(s({ enabled: true }).state, "notSetUp");
  assert.equal(s({ updateRunning: true }).busy, true);
});
test("browserRun: deploy in a clone, the setup script in an app install", () => {
  assert.deepEqual(browserRun({ mode: "clone", repo: "/r", home: "/h" }).args, { name: "Set up the browser", folder: "/r", argv: ["npm", "run", "deploy"] });
  assert.deepEqual(browserRun({ mode: "app", repo: null, home: "/h" }).args.argv, ["node", "/h/mods/dock-browser/herdr-browser-setup.mjs"]);
});
test("withBrowserSetting keeps everything else", () => {
  const t = withBrowserSetting('{"v":1,"regions":{"left":{"size":200}},"browser":{"production":["a.com"]}}', { enabled: true, chrome: "/c" });
  assert.deepEqual(JSON.parse(t), { v: 1, regions: { left: { size: 200 } }, browser: { production: ["a.com"], enabled: true, chrome: "/c" } });
  assert.equal(JSON.parse(withBrowserSetting(t, { enabled: false, chrome: null })).browser.chrome, undefined);
  assert.deepEqual(JSON.parse(withBrowserSetting(null, { enabled: true, chrome: null })), { v: 1, regions: {}, browser: { enabled: true } });
});
test("parseHosts", () => {
  assert.deepEqual(parseHosts(" Example.com, *.example.com  shop.example.org "), { ok: true, hosts: ["example.com", "*.example.com", "shop.example.org"] });
  assert.equal(parseHosts("").ok, true);
  assert.equal(parseHosts("http://x.com/path").ok, false);
});
test("chromeCandidates per platform", () => {
  assert.equal(chromeCandidates("darwin")[0], "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.deepEqual(chromeCandidates("win32", { ProgramFiles: "C:\\PF" }), ["C:\\PF\\Google\\Chrome\\Application\\chrome.exe"]);
  assert.ok(chromeCandidates("linux").includes("/usr/bin/chromium"));
});
```

- [ ] **Step 2:** `node --test tests/browser-view.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `browser-view.js`. If `checkBrowser` accepts `http://x.com/path` as a production pattern, `parseHosts` adds its own check (a host or `*.host`, letters, digits, dots, dashes) and the test stays.
- [ ] **Step 4:** `npm test` → PASS. **Step 5: Commit** `feat(dock-config): the Browser section's model` (no `app/` change expected; confirm the drift test).

### Task 3: Production hosts in the draft; Reset keeps the browser

**Files:**
- Modify: `src/shared/edit.js` (`draftFromConfig`, `sameDraft`, `applyEdit`, `planSave`, `planReset`), `src/mods/dock-config/session.js` (the reset path)
- Test: `tests/edit.test.mjs`, `tests/edit-save.test.mjs`

**Interfaces:**
- Consumes: `browserOf` (`src/shared/browser/config.js`).
- Produces:
  - The draft gains `production: string[]` (from the merged config's `browser.production`); `sameDraft` compares it; `applyEdit(draft, { type: "production", hosts })` sets it.
  - `planSave(...)` writes `browser.production` into `local.json` when the draft's differs from the shared config's, keeping the local file's other `browser` keys (`enabled`, `chrome`); when it equals the shared value, the local `production` key is dropped.
  - `planReset(localText) -> { ok: true, delete: true } | { ok: true, text }` — a local file with a `browser` block becomes `{ v: 1, regions: {}, browser }` (formatted like the rest); otherwise delete as today. `session.js` writes `text` when given.

- [ ] **Step 1: Write the failing tests** — in `tests/edit.test.mjs`: a draft from a config with `browser.production: ["a.com"]` has `production: ["a.com"]`; `applyEdit` with `{ type: "production", hosts: ["b.com"] }` changes it and `sameDraft` sees the difference. In `tests/edit-save.test.mjs`: saving a draft with `production: ["b.com"]` over a local `{ "v":1, "regions":{}, "browser": { "enabled": true } }` yields `browser: { enabled: true, production: ["b.com"] }`; `planReset('{"v":1,"regions":{"left":{"size":9}},"browser":{"enabled":true}}')` → `{ ok: true, text }` whose JSON is `{ v: 1, regions: {}, browser: { enabled: true } }`; `planReset('{"v":1,"regions":{}}')` → `{ ok: true, delete: true }`.
- [ ] **Step 2:** run them → FAIL. **Step 3: Implement.** Existing callers of `planReset()` pass the local text.
- [ ] **Step 4:** `npm test` → PASS. **Step 5:** `npm run build:app` (the dialog bundles `edit.js`), commit `feat(dock-config): production hosts in the draft; Reset keeps the browser`.

### Task 4: The Browser section in the dialog

**Files:**
- Modify: `src/mods/dock-config/main.js` (render the section below the Updates strip; actions; polling), `src/mods/dock-config/session.js` (read status: `enabled` from the merged settings, whether `<app home>/mods/dock-browser` and `binRel(platform)` exist, the result file, which Chrome candidate exists), `src/mods/dock-config/by-mod.js`, `by-region.js` (and `src/shared/inventory.js` if needed), `README.md` (Browser → Turning it on), `app/RECIPE.md`, `INSTALL.md` (step 6)
- Test: pure helpers added for this task get tests in `tests/browser-view.test.mjs` or `tests/inventory.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–3; the dialog's existing `run(command, args)`, on-disk guard (`writeTextFile(path, text, expected)` with `session.opened`), `UPDATE_KEY` state for `updateRunning`.

- [ ] **Step 1:** Draw the section per the design's sketch and states (`browserSection`), with the Chrome choice (the found candidate preselected; a `chrome` already in the settings shown when it exists; "Download Chrome for Testing" always offered) and, when on, the production hosts field bound to the draft (`parseHosts` → `applyEdit({ type: "production" })`, the field's error shown and Save refused while it's invalid).
- [ ] **Step 2:** **Turn on / Turn off / Set up:** `withBrowserSetting(<the local file's current text>, { enabled, chrome })` written with the on-disk guard (a changed file → the dialog's changed-on-disk message, nothing run), then `run` the `browserRun(...)` command; buttons disabled while `busy`. Poll the status every few seconds while the result is `running`.
- [ ] **Step 3:** By mod / By region: `dock-browser`'s **Off** disabled with the tip "Turn the browser off in the Browser section"; while the browser is off, `dock-browser` isn't offered for placing (a pure, tested inventory rule).
- [ ] **Step 4:** README, `app/RECIPE.md`, `INSTALL.md` step 6: the Dock layout dialog's Browser section is the first way to turn it on; the file setting still works.
- [ ] **Step 5:** `npm test`, `npm run build:app`, `herdr-app check app/mods/dock-config` → pass. Commit `feat(dock-config): a Browser section in the Dock layout dialog`.

### After the tasks (controller, with the user's yes)

- [ ] Deploy and turn the browser on from the dialog on the user's Mac (their Google Chrome), then picture the section and the Browser panel.
