# Work GitLab CI Panel in the Dock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The work `gitlab-ci` panel can be placed in the dock, and no machine breaks because a placed mod isn't installed.

**Architecture:** herdr-dock lists overlay mods that say `"dock": true`, and drops features whose mod isn't installed from the layout it writes (dock-core reload and deploy); the work repo marks `gitlab-ci` placeable, renames it, adds an icon and fits its board to a panel.

**Tech Stack:** JavaScript (ESM), gpui-kit, `node --test`; two repos: herdr-dock (this worktree) and `~/Dev/Workspace/my-qnap-claude-tools`.

**Spec:** `docs/superpowers/specs/2026-11-25-dock-gitlab-ci-design.md`

## Global Constraints

- herdr-dock gains nothing QNAP- or GitLab-specific: the rule is generic (`"dock": true`), and the guard applies to any mod.
- Installed means `<app home>/mods/<id>/mod.json` is readable. Core `dock-*` mods are never filtered.
- The placement goes in this Mac's `local.json` only; `config/dock.json` is not touched.
- Work repo: leave its untracked `docs/superpowers/*owed-fix-sweep*` files alone (another piece of work).
- `app/` is generated (`npm run build:app`). Known baseline failure: `tests/dock-core-class.test.mjs`.

## Review Focus

- A local.json naming a mod that isn't installed: the layout has no block for it, the rest of the region stays (Task 1 test).
- A right region whose only feature is missing: the region is drawn empty, not broken (Task 1 test).
- An overlay mod without `"dock": true` (e.g. `confirm`-like dialogs): still not listed (Task 1 test).
- The board at a narrow width (~340 px): nothing overflows the panel (Task 2 check).
- Cmd+Ctrl+6 still opens the floating window after the change (Task 2 check).

---

### Task 1: herdr-dock — list `"dock": true` overlays; leave out mods that aren't installed

**Files:**
- Modify: `src/shared/inventory.js` (`placeability`), `src/shared/config.js` (`withoutMissing`, `planApply`), `src/mods/dock-core/main.js` (`reload`), `scripts/deploy.mjs`
- Test: `tests/inventory.test.mjs`, `tests/config.test.mjs`

**Interfaces:**
- `placeability(id, modJson)`: returns `null` for an overlay whose `modJson.dock === true`.
- `withoutMissing(merged, missing: Set<string>): merged` — every region's `features` without those mods (`dock-*` never removed).
- `planApply(configText, hostname, currentLayoutText, lastGood, state = {}, localText = null, missing = new Set())` — filters with `withoutMissing` before `buildLayout`; returns the filtered `merged`.
- `missingMods(merged, installed: (id) => boolean): Set<string>` — non-`dock-*` feature mods that aren't installed.

- [ ] **Step 1: Write the failing tests**

`tests/inventory.test.mjs`:
```js
test("placeability: an overlay that says dock: true can be placed; other overlays can't", () => {
  assert.equal(placeability("gitlab-ci", { place: "none", overlay: { kind: "window" }, dock: true }), null);
  assert.equal(placeability("some-dialog", { place: "none", overlay: { kind: "dialog" } }), "overlay");
});
```

`tests/config.test.mjs` (using the file's existing config fixture helpers; `merged` from `mergeForHost`):
```js
test("withoutMissing / planApply: a placed mod that isn't installed is left out; dock-* never are", () => {
  const merged = { regions: { right: { features: [{ mod: "dock-pipelines" }, { mod: "gitlab-ci" }, { mod: "files" }] } } };
  assert.deepEqual(withoutMissing(merged, new Set(["gitlab-ci"])).regions.right.features.map((f) => f.mod), ["dock-pipelines", "files"]);
  assert.deepEqual(withoutMissing(merged, new Set(["dock-pipelines"])).regions.right.features.length, 3);
  assert.deepEqual([...missingMods(merged, (id) => id !== "gitlab-ci")], ["gitlab-ci"]);
});

test("planApply: a local.json naming a missing mod writes a layout without its block", () => {
  // configText: the repo's default config; localText puts gitlab-ci in the right region
  const configText = readFileSync("config/dock.json", "utf8");
  const local = JSON.stringify({ v: 1, regions: { right: { features: [{ mod: "dock-pipelines" }, { mod: "gitlab-ci" }] } } });
  const with_ = planApply(configText, "host", null, null, {}, local);
  assert.ok(with_.write.includes('"gitlab-ci"'));
  const without = planApply(configText, "host", null, null, {}, local, new Set(["gitlab-ci"]));
  assert.ok(!without.write.includes('"gitlab-ci"'));
  assert.ok(without.write.includes('"dock-pipelines"'));
  assert.ok(!without.merged.regions.right.features.some((f) => f.mod === "gitlab-ci"));
});
```

- [ ] **Step 2: Run** `node --test tests/inventory.test.mjs tests/config.test.mjs` — Expected: FAIL (not exported / still "overlay").
- [ ] **Step 3: Implement** the three pure pieces; in dock-core `reload`, after the first `planApply`, `missingMods(plan.merged, …)` with each candidate checked by `readTextFile(<app home>/mods/<id>/mod.json)` (cached per reload), and when any is missing, `planApply` again with them; in deploy, the same with `existsSync`. Log once per reload which mods were left out (`dock-core: left out of the layout (not installed): gitlab-ci`).
- [ ] **Step 4: Run** `node --test tests/inventory.test.mjs tests/config.test.mjs tests/build.test.mjs` — Expected: all pass.
- [ ] **Step 5: Build and check** `npm run build:app && herdr-app check app/mods/dock-core && herdr-app check app/mods/dock-config` — Expected: both pass.
- [ ] **Step 6: Commit** `git add src tests scripts app && git commit -m "feat(dock): overlay mods that say dock: true can be placed; mods that aren't installed are left out of the layout"`

### Task 2: the work repo — `gitlab-ci` placeable, renamed, with an icon, fitting a panel

**Files (in `~/Dev/Workspace/my-qnap-claude-tools`, on a branch from its `main`):**
- Modify: `herdr-mods/gitlab-ci/mod.json`, possibly `herdr-mods/gitlab-ci/main.js` / `model.js` for the panel width
- Create: `herdr-mods/gitlab-ci/icon.svg`
- Test: `mcp/gitlab-ci/test/model.test.mjs` (and the repo's existing tests)

- [ ] **Step 1:** `mod.json`: add `"dock": true`; `"title": "GitLab CI"`. `icon.svg`: a 16×16 `currentColor` pipeline glyph in the style of the other dock icons.
- [ ] **Step 2: Check the compact board at panel width** — run its `model.js` width helpers (`nameColumnWidth`, `branchColumnWidth`, `fitName`) at 340 px in a test; if a row overflows, write the failing test first, then fix the compact layout in `model.js` / `main.js`.
- [ ] **Step 3: Run** the repo's tests (`node --test mcp/gitlab-ci/test test`) — Expected: all pass.
- [ ] **Step 4: Install and check** `./setup` (copies the mod into the app home), then `herdr-app check ~/.config/herdr-app/mods/gitlab-ci` — Expected: passes; Cmd+Ctrl+6 still opens the window.
- [ ] **Step 5: Commit** in the work repo: `git add herdr-mods/gitlab-ci mcp/gitlab-ci/test && git commit -m "feat(gitlab-ci): can sit in herdr-dock's dock — dock: true, GitLab CI title, rail icon, fits a panel"`

### Task 3: place it on this Mac and look

- [ ] **Step 1:** After herdr-dock is merged and deployed (Adam's call), add `{ "mod": "gitlab-ci" }` to the right region in `<app home>/herdr-dock/local.json` (copy the file first), or let Adam add it in the Dock layout dialog.
- [ ] **Step 2:** Confirm in Herdr: the rail shows the GitLab CI icon; clicking it shows the board in the right panel; screenshot with `herdr-app shot` when that tab is on screen.
