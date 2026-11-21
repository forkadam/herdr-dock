# herdr-dock v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Herdr layout (`herdr-dock`) generated from a git-synced config: a left panel with Spaces,
Agents and Agent quotas (expanded / icons / hidden), a top bar (panel toggle + Herdr's `tabs`) and the
terminals, working on Windows.

**Architecture:** Pure, Herdr-independent modules in `src/shared/` (config merge, layout generation,
panel modes, Claude data) are unit-tested with `node --test` and bundled by esbuild into every mod.
The `dock-core` mod watches the config and rewrites `layouts/herdr-dock.json`. Feature mods
(`dock-spaces`, `dock-agents`, `dock-quotas`) read the panel mode from shared state. A Node deploy
script builds, installs into `~/.config/herdr-app`, writes the first layout and runs `herdr-app check`.

**Tech Stack:** JavaScript ES modules, gpui-kit / gpui-base / `herdr` module (Herdr mod runtime),
Node ≥ 22 (`node --test`, build/deploy scripts), esbuild `0.24.0` (dev dependency only).

**Spec:** `docs/superpowers/specs/2026-11-21-herdr-dock-design.md`

## Global Constraints

- No Python (or any runtime besides Herdr's) inside mods. Node only in build/deploy scripts.
- Every mod folder name starts with `dock-`. Every `mod.json` has `"place": "none"`.
- Mods import only `gpui-kit`, `gpui-base`, `herdr` and their own bundled code (esbuild `external` for
  the three host modules).
- Every built mod passes `herdr-app check <folder>`.
- Only `config/dock.json` is synced. The generated `layouts/herdr-dock.json` is never committed.
- Paths from Herdr on Windows use backslashes. Normalize with `slashPath` (Task 1) before comparing.
- Percentages shown to the user are **used** percentages, labelled "used".
- Layout name: `herdr-dock`. Shared-state keys: `dock.left.mode` (`"expanded" | "icons" | "hidden"`),
  `dock.left.focus` (left feature block id or `null`), `dock.config.error` (string or `null`).
- Statusline cache: `~/.claude/statusline-cache/claude-statusline.json`. Claude PID records:
  `~/.claude/sessions/<pid>.json`.
- Herdr API reference: `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, `gpui-kit.d.ts`.

## Review Focus

1. **Invalid or half-saved config** (editor saves mid-write, JSON syntax error, an unknown region):
   the window keeps the last good layout and the toggle shows the error. It never writes a broken
   layout. Owned by Task 1 (`parseConfig` errors) and Task 5 (keep-last-good).
2. **Hostname with no override, or with different case** (`FORKADAM-PC` vs `forkadam-pc`): the base
   config is used, and overrides match case-insensitively. Owned by Task 1.
3. **An agent whose session record is missing or stale** (Claude restarted in the same terminal, a
   non-Claude agent, a remote agent): its row shows no context number rather than a wrong one. Owned
   by Task 3.
4. **Stale or missing statusline cache** (Claude not running, file absent, old `fetched_at_unix`):
   Quotas says "no data" or shows the age with a stale mark, never a fresh-looking number. Owned by
   Task 3.
5. **Hidden left panel while the top bar is the only toggle:** the key binding still restores it.
   `<mod>.<command>` reaches only shown copies, so the core lives in the top bar, which is never hidden
   in v1. Owned by Task 4 (keys) and Task 5.

---

## File Structure

```
herdr-dock/
  package.json                 scripts: test, build, deploy; devDependency esbuild 0.24.0
  .gitignore                   node_modules/, dist/
  config/dock.json             the synced config (base + machines overrides)
  src/shared/
    path.js                    slashPath, isAbsolutePath
    config.js                  parseConfig, mergeForHost, DEFAULT_CONFIG
    layout.js                  buildLayout, leftFeatureIds
    panel.js                   nextMode, panelActions
    claude.js                  readSessionRecord, matchSession, parseStatusline, formatPercent, formatAge
  src/mods/dock-core/          main.js, mod.json, manifest.json, icon.svg
  src/mods/dock-spaces/        main.js (from shipped spaces), mod.json, manifest.json, icon.svg
  src/mods/dock-agents/        main.js (from shipped agents), mod.json, manifest.json, icon.svg
  src/mods/dock-quotas/        main.js, mod.json, manifest.json, icon.svg
  src/mods/_feature.js         featureMode(), iconRail(), requestFocus() for feature mods
  scripts/build.mjs            bundle every src/mods/dock-* into dist/mods/<name>/
  scripts/deploy.mjs           install dist into app home, write source.json + first layout, keys, check
  tests/*.test.mjs             node --test
```

Feature manifest (`manifest.json`, copied into the built mod):
`{ "id": "dock-spaces", "name": "Spaces", "icon": "icon.svg", "regions": ["left"], "settings": {} }`.

Config shape (`config/dock.json`):

```json
{
  "v": 1,
  "regions": {
    "top":    { "size": 42, "features": [ { "mod": "dock-core", "size": 132 }, { "mod": "tabs" } ] },
    "left":   { "size": 268, "mode": "expanded",
                "features": [ { "mod": "dock-spaces" }, { "mod": "dock-agents" }, { "mod": "dock-quotas", "size": 150 } ] },
    "right":  { "size": 360, "hidden": true, "features": [] },
    "bottom": { "size": 28,  "hidden": true, "features": [] }
  },
  "machines": { "forkadam-pc": { "regions": { "left": { "size": 280 } } } }
}
```

Feature entry: `{ mod: string, props?: object, size?: number (px) }`. With no `size`, the feature
gets weight 1. Merge rule: `machines[host]` deep-merges into the base. Objects merge key by key,
arrays (`features`) replace whole, and scalars replace.

---

### Task 1: Repo scaffold, path helpers and config

**Files:**
- Create: `package.json`, `.gitignore`, `config/dock.json` (content above, with `machines` holding
  only `{}`), `src/shared/path.js`, `src/shared/config.js`
- Test: `tests/path.test.mjs`, `tests/config.test.mjs`

**Interfaces:**
- Produces:
  - `slashPath(p: string): string`: backslashes become `/`, the drive letter is uppercased, and
    trailing `/` is removed except for a root.
  - `isAbsolutePath(p: string): boolean`: `/x` or `C:/x` / `C:\x`.
  - `DEFAULT_CONFIG`: the object above, minus `machines`.
  - `parseConfig(text: string): { ok: true, config } | { ok: false, error: string }`.
  - `mergeForHost(config, hostname: string): MergedConfig`: no `machines` key in the result.
    `MergedConfig.regions.{top,left,right,bottom}` are always present, with `features` defaulting to
    `[]`, `hidden` to `false`, and `mode` (left only) to `"expanded"`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/path.test.mjs
test("slashPath normalizes Windows paths", () => {
  assert.equal(slashPath("c:\\Users\\Adam Cheng\\.claude\\"), "C:/Users/Adam Cheng/.claude");
  assert.equal(slashPath("/home/a/"), "/home/a");
  assert.equal(slashPath("C:\\"), "C:/");
});
test("isAbsolutePath", () => {
  assert.ok(isAbsolutePath("D:\\workspace")); assert.ok(isAbsolutePath("/x"));
  assert.ok(!isAbsolutePath("rel\\x"));
});
// tests/config.test.mjs
test("parseConfig rejects bad JSON with a message", () => {
  const r = parseConfig("{ \"v\": 1, "); assert.equal(r.ok, false); assert.match(r.error, /JSON/);
});
test("parseConfig rejects unknown region and wrong version", () => {
  assert.match(parseConfig('{"v":1,"regions":{"middle":{}}}').error, /middle/);
  assert.match(parseConfig('{"v":2,"regions":{}}').error, /version/);
});
test("parseConfig rejects a feature without mod and a bad left mode", () => {
  assert.equal(parseConfig('{"v":1,"regions":{"left":{"features":[{}]}}}').ok, false);
  assert.equal(parseConfig('{"v":1,"regions":{"left":{"mode":"tiny"}}}').ok, false);
});
test("mergeForHost applies override case-insensitively; arrays replace", () => {
  const c = parseConfig(JSON.stringify({ v: 1,
    regions: { left: { size: 268, features: [{ mod: "dock-spaces" }, { mod: "dock-agents" }] } },
    machines: { "ForkAdam-PC": { regions: { left: { size: 300, features: [{ mod: "dock-quotas" }] } } } } })).config;
  const m = mergeForHost(c, "forkadam-pc");
  assert.equal(m.regions.left.size, 300);
  assert.deepEqual(m.regions.left.features, [{ mod: "dock-quotas" }]);
  assert.equal(m.regions.left.mode, "expanded");
  assert.deepEqual(m.regions.right.features, []);
  assert.equal("machines" in m, false);
});
test("mergeForHost without a matching host returns the base", () => {
  const c = parseConfig(JSON.stringify({ v: 1, regions: { left: { size: 268 } } })).config;
  assert.equal(mergeForHost(c, "other").regions.left.size, 268);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (script: `node --test tests/`)
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/shared/path.js` and `src/shared/config.js`**

Allowed region names: `top`, `left`, `right`, `bottom`. `size` must be a positive integer. `features`
must be an array of objects, each with a non-empty string `mod`. Error messages name the offending key
(for example `regions.middle: unknown region`). `package.json`: `"type": "module"`, `engines.node >= 22`,
devDependency `esbuild` pinned at `0.24.0`. Run `npm install`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`. Expected: all PASS.

- [ ] **Step 5: Commit**: `feat: config parsing, per-host merge and path helpers`

---

### Task 2: Layout generation

**Files:**
- Create: `src/shared/layout.js`
- Test: `tests/layout.test.mjs`

**Interfaces:**
- Consumes: `MergedConfig` (Task 1).
- Produces:
  - `buildLayout(merged: MergedConfig): object`: the Herdr layout tree.
  - `leftFeatureIds(merged): string[]`: block ids of left features, in order.
  - Block id rule: `dock-<region>-<index>-<mod>` (index from 0), for example `dock-left-0-dock-spaces`.
  - Region node ids: `dock-top`, `dock-left`, `dock-right`, `dock-bottom`. Terminal block id:
    `dock-main`.
  - Every feature block's `content.props` = `{ ...feature.props, dockFeature: <block id>, dockRegion: <region> }`.

Tree (regions with no features are omitted):

```
root column  { titlebar: "none", background: "canvas", terminal_padding: [14, 12], divider: {width:1,color:"border"} }
  dock-top     row  { size: {px: top.size}, window_drag: true, hidden?: top.hidden }   feature blocks
  dock-body    row  { divider: {width:1,color:"border"} }
    dock-left  column { size: {px: left.size}, min: 44, max: 480, background: "chrome",
                        hidden: left.hidden || left.mode === "hidden" }               feature blocks
    dock-main  block  { content: { tab: "active", pane: <same pane object as shipped layouts/main.json "main" block> }, padding: 8 }
    dock-right column { size: {px: right.size}, hidden: right.hidden }                 feature blocks
  dock-bottom  row  { size: {px: bottom.size}, hidden: bottom.hidden }                 feature blocks
```

A feature block's size: `{px: feature.size}` if given, else `{weight: 1}`. In the left column each
block also gets `min: 32`. In icon mode the left column's width is 48 px, but that is applied at run
time by Task 4's `panelActions`, not here (this keeps resizes machine-local).

- [ ] **Step 1: Write the failing tests**

```js
test("buildLayout places features with ids, props and sizes", () => {
  const m = mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "nohost");
  const t = buildLayout(m);
  const left = find(t, "dock-left");
  assert.deepEqual(left.children.map((c) => c.id),
    ["dock-left-0-dock-spaces", "dock-left-1-dock-agents", "dock-left-2-dock-quotas"]);
  assert.deepEqual(left.children[2].size, { px: 150 });
  assert.deepEqual(left.children[0].size, { weight: 1 });
  assert.equal(left.children[0].content.props.dockFeature, "dock-left-0-dock-spaces");
  assert.equal(find(t, "dock-top").window_drag, true);
  assert.equal(find(t, "dock-main").content.tab, "active");
  assert.equal(find(t, "dock-right"), undefined);   // no features
});
test("left mode hidden sets hidden on the column", () => {
  const m = mergeForHost(parseConfig('{"v":1,"regions":{"left":{"mode":"hidden","features":[{"mod":"x"}]}}}').config, "h");
  assert.equal(find(buildLayout(m), "dock-left").hidden, true);
});
test("ids are unique even with the same mod twice", () => {
  const m = mergeForHost(parseConfig('{"v":1,"regions":{"right":{"features":[{"mod":"x"},{"mod":"x"}]}}}').config, "h");
  const ids = allIds(buildLayout(m)); assert.equal(new Set(ids).size, ids.length);
});
test("buildLayout is deterministic", () => {
  const m = mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "h");
  assert.equal(JSON.stringify(buildLayout(m)), JSON.stringify(buildLayout(m)));
});
```

(`find(tree, id)` and `allIds(tree)` are small test helpers defined in the test file.)

- [ ] **Step 2: Run to verify it fails**. `npm test` → FAIL, `buildLayout` not defined.
- [ ] **Step 3: Implement `buildLayout`, `leftFeatureIds` in `src/shared/layout.js`.** Copy the
  `pane` object for `dock-main` from the `main` block of `~/.config/herdr-app/layouts/main.json` into
  a constant.
- [ ] **Step 4: Run to verify it passes**. `npm test` → PASS.
- [ ] **Step 5: Commit**: `feat: generate the five-region layout tree`

---

### Task 3: Claude data (session matching and statusline)

**Files:**
- Create: `src/shared/claude.js`
- Test: `tests/claude.test.mjs`

**Interfaces:**
- Produces (all pure; callers pass in file text and process facts):
  - `matchSession(recordText: string | null, fg: { pid: number }, terminalCreatedMs: number, nowMs: number): string | null`:
    the sessionId when the record parses, `record.pid === fg.pid`, `record.kind === "interactive"`, the
    sessionId is a UUID, and `terminalCreatedMs - 5000 <= record.startedAt <= nowMs + 60000`.
    Otherwise `null`.
  - `parseStatusline(text: string | null, nowMs: number): Statusline | null` where
    `Statusline = { fetchedMs, stale: boolean, sessions: Map<string, { usedPercent: number, seenMs: number, stale: boolean }>, windows: { kind: "five_hour" | "weekly", usedPercent: number, resetsMs: number | null }[] }`.
    `stale` means older than 120000 ms. Unknown `kind`s are dropped. `null` if the text is missing,
    invalid, or `provider !== "claude"` / `source !== "claude-statusline"`.
  - `formatPercent(p: number): string` → `"31% used"` (rounded).
  - `formatAge(ms: number): string` → `"just now"` (< 60 s), `"5m ago"`, `"2h ago"`, `"3d ago"`.
  - `formatReset(resetsMs: number, nowMs: number): string` → `"resets in 2h 05m"`, or `"resets in 3d 4h"` for ≥ 24 h.

- [ ] **Step 1: Write the failing tests**

```js
const rec = (o) => JSON.stringify({ pid: 16604, sessionId: "73636264-03cb-4b62-bb2d-36ccfbcbee15",
  kind: "interactive", startedAt: 1_000_000, pidDomain: "win32:forkadam-pc", ...o });
test("matchSession accepts a live record in the terminal's lifetime", () => {
  assert.equal(matchSession(rec(), { pid: 16604 }, 999_000, 2_000_000), "73636264-03cb-4b62-bb2d-36ccfbcbee15");
});
test("matchSession rejects wrong pid, non-interactive, older than terminal, missing", () => {
  assert.equal(matchSession(rec({ pid: 1 }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession(rec({ kind: "bg" }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession(rec({ startedAt: 100 }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession(null, { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession("{oops", { pid: 16604 }, 999_000, 2_000_000), null);
});
const cache = { provider: "claude", source: "claude-statusline", fetched_at_unix: 1000,
  session_contexts: { "s1": { used_percent: 31, cache: { session_id: "s1", last_activity_unix: 990 } } },
  windows: [{ kind: "five_hour", used_percent: 5, remaining_percent: 95, resets_at: 8200 },
            { kind: "weekly", used_percent: 1, remaining_percent: 99, resets_at: 600000 },
            { kind: "monthly", used_percent: 9 }] };
test("parseStatusline reads sessions and known windows", () => {
  const s = parseStatusline(JSON.stringify(cache), 1_000_000 + 30_000);
  assert.equal(s.sessions.get("s1").usedPercent, 31);
  assert.equal(s.sessions.get("s1").stale, false);
  assert.deepEqual(s.windows.map((w) => [w.kind, w.usedPercent, w.resetsMs]),
    [["five_hour", 5, 8_200_000], ["weekly", 1, 600_000_000]]);
});
test("parseStatusline marks stale and rejects foreign files", () => {
  assert.equal(parseStatusline(JSON.stringify(cache), 1_000_000 + 600_000).stale, true);
  assert.equal(parseStatusline(JSON.stringify({ ...cache, provider: "codex" }), 0), null);
  assert.equal(parseStatusline(null, 0), null);
});
test("formatters", () => {
  assert.equal(formatPercent(30.6), "31% used");
  assert.equal(formatAge(30_000), "just now"); assert.equal(formatAge(5 * 60_000), "5m ago");
  assert.equal(formatReset(1000 + (2 * 60 + 5) * 60_000, 1000), "resets in 2h 05m");
});
```

- [ ] **Step 2: Run to verify it fails**. `npm test` → FAIL.
- [ ] **Step 3: Implement `src/shared/claude.js`.**
- [ ] **Step 4: Run to verify it passes**. `npm test` → PASS.
- [ ] **Step 5: Commit**: `feat: Claude session matching and statusline parsing`

---

### Task 4: Panel modes, build and deploy

**Files:**
- Create: `src/shared/panel.js`, `scripts/build.mjs`, `scripts/deploy.mjs`,
  `src/mods/dock-core/mod.json`, `src/mods/dock-core/manifest.json`, `src/mods/dock-core/icon.svg`,
  and a placeholder `src/mods/dock-core/main.js` (renders the text "dock"; Task 5 replaces it)
- Test: `tests/panel.test.mjs`, `tests/build.test.mjs`

**Interfaces:**
- Consumes: `buildLayout`, `leftFeatureIds` (Task 2), `parseConfig`, `mergeForHost` (Task 1).
- Produces:
  - `nextMode(mode): mode`: expanded → icons → hidden → expanded.
  - `panelActions(mode, merged, focusId: string | null): { command: string, args: object }[]`: the
    Herdr commands that put the left panel into `mode`.
    - `hidden` → `[layout.hide {id:"dock-left"}]`.
    - `icons` → `[layout.show {id:"dock-left"}, layout.resize {id:"dock-left", px: 48}]`, plus
      `layout.hide` for every left block whose mod does not start with `dock-`. A third-party mod can't
      draw an icon, so it is hidden in icon mode. `expanded` sends `layout.show` for those blocks.
    - `expanded` → show, then resize to `merged.regions.left.size`. With a `focusId`, every left feature
      block gets `layout.resize` (focused: `{weight: 1}`, others: `{px: 32}`). Without one, every block
      goes back to its configured size.
  - `npm run build`: `dist/mods/<name>/` for each `src/mods/dock-*`. `main.js` is bundled by esbuild
    (format `esm`, `external: ["gpui-kit","gpui-base","herdr"]`). `mod.json`, `manifest.json` and
    `*.svg` are copied. The build fails if `manifest.json` lacks `id`, `name`, `icon` or `regions`, or if
    `mod.json.place !== "none"`.
  - `npm run deploy` (options `--app-home <dir>`, default `~/.config/herdr-app`; `--dry-run`):
    1. Run build.
    2. For each `dist/mods/dock-*`, replace `<app>/mods/<name>/`. Refuse any target folder without a
       `dock-` prefix.
    3. Write `<app>/mods/dock-core/source.json` = `{ "config": slashPath(<repo>/config/dock.json) }`.
    4. Write `<app>/layouts/herdr-dock.json` = `buildLayout(mergeForHost(config, os.hostname()))`, pretty
       JSON. Abort with the parse error if the config is invalid.
    5. Merge into `<app>/keys.json` section `"layout:herdr-dock"`: `"ctrl-alt-b": "dock-core.cycle"`.
       If the key is already bound to something else there, print it and skip.
    6. Run `herdr-app check` on each installed mod, and exit non-zero on any failure.

- [ ] **Step 1: Write the failing tests**

```js
test("nextMode cycles", () => {
  assert.equal(nextMode("expanded"), "icons"); assert.equal(nextMode("icons"), "hidden");
  assert.equal(nextMode("hidden"), "expanded");
});
test("panelActions for icons and hidden", () => {
  const m = mergeForHost(parseConfig(readFileSync("config/dock.json","utf8")).config, "h");
  assert.deepEqual(panelActions("hidden", m, null), [{ command: "layout.hide", args: { id: "dock-left" } }]);
  assert.deepEqual(panelActions("icons", m, null).at(-1), { command: "layout.resize", args: { id: "dock-left", px: 48 } });
});
test("panelActions expanded with focus collapses the others", () => {
  const m = mergeForHost(parseConfig(readFileSync("config/dock.json","utf8")).config, "h");
  const a = panelActions("expanded", m, "dock-left-1-dock-agents");
  assert.deepEqual(a.find((x) => x.args.id === "dock-left-1-dock-agents").args, { id: "dock-left-1-dock-agents", weight: 1 });
  assert.deepEqual(a.find((x) => x.args.id === "dock-left-0-dock-spaces").args, { id: "dock-left-0-dock-spaces", px: 32 });
});
test("deploy --dry-run into a temp app home writes nothing and lists actions", () => {
  // spawnSync("node", ["scripts/deploy.mjs", "--app-home", tmp, "--dry-run"]) → status 0, stdout mentions
  // "layouts/herdr-dock.json" and "mods/dock-core", and tmp stays empty.
});
test("deploy into a temp app home installs, writes source.json, layout and keys", () => {
  // tmp app home with keys.json {"global":{}}; run with an env var DOCK_SKIP_CHECK=1 (skips herdr-app check in tests);
  // assert tmp/mods/dock-core/main.js exists, source.json.config ends with "/config/dock.json",
  // layouts/herdr-dock.json parses and has id "dock-left", keys.json["layout:herdr-dock"]["ctrl-alt-b"] === "dock-core.cycle".
});
```

- [ ] **Step 2: Run to verify it fails**. `npm test` → FAIL.
- [ ] **Step 3: Implement `src/shared/panel.js`, `scripts/build.mjs`, `scripts/deploy.mjs`, and the
  dock-core placeholder.**
- [ ] **Step 4: Run to verify it passes**. `npm test` → PASS. Then run `npm run deploy` for real and
  expect exit 0, with `check passed` printed for `dock-core`.
- [ ] **Step 5: Commit**: `feat: panel mode actions, build and deploy scripts`

---

### Task 5: dock-core mod (config watch, apply, toggle)

**Files:**
- Modify: `src/mods/dock-core/main.js`
- Test: `tests/core-apply.test.mjs` (for the pure part)

**Interfaces:**
- Consumes: `parseConfig`, `mergeForHost`, `buildLayout` (Tasks 1–2), `nextMode`, `panelActions`
  (Task 4), `slashPath`.
- Produces:
  - `planApply(configText, hostname, currentLayoutText, lastGood): { write: string | null, error: string | null, merged }`
    in `src/shared/config.js`.
    - When the config is valid: `write` is the new layout JSON, or `null` when it equals
      `currentLayoutText`.
    - When it's invalid: `write: null`, `error` is the parse message, and `merged` is `lastGood`.
  - The mod commands (`nextCommand()`): `cycle`, `expanded`, `icons`, `hidden`, `reload`.
  - Shared state written: `dock.left.mode`, `dock.left.focus` (set to `null` after applying),
    `dock.config.error`.

Behavior:
- `init`:
  1. Read `source.json`. Get the hostname once with `exec("hostname")` (Windows and macOS) or
     `exec("uname", ["-n"])` (Linux), chosen by `window().platform`. Lowercase and trim it.
  2. Read the config, call `planApply`, and if `write` is set, write `appHome()/layouts/herdr-dock.json`
     with `writeTextFile(path, text, currentText)`.
  3. Start `watchFolder(<config dir>)` and re-run step 2 on each batch.
- `dock.left.mode` defaults to `merged.regions.left.mode` when unset.
- Mode change (command, toggle click, or a feature's focus request seen in `dock.left.focus`): run each
  entry of `panelActions(mode, merged, focus)` with `run(command, args)`, then `setShared("dock.left.mode", mode)`.
- Render (`props().dockRegion === "top"`): an `h_flex` with
  - a toggle button whose icon matches the mode (three SVGs: `panel-expanded.svg`, `panel-icons.svg`,
    `panel-hidden.svg`). Click → `cycle`. Tooltip: "Left panel: <mode> (Ctrl+Alt+B)".
  - when `dock.config.error` is set, a red dot with the error in its tooltip.
  - Clicks inside use `cx.stop_propagation()` on mouse down, because the bar has `window_drag`.
- Use `if (checking()) return;` before starting the watch or writing files.

- [ ] **Step 1: Write the failing test for `planApply`**

```js
test("planApply writes only when changed and keeps last good on error", () => {
  const good = readFileSync("config/dock.json", "utf8");
  const first = planApply(good, "h", null, null);
  assert.ok(first.write); assert.equal(first.error, null);
  assert.equal(planApply(good, "h", first.write, first.merged).write, null);
  const bad = planApply("{", "h", first.write, first.merged);
  assert.equal(bad.write, null); assert.match(bad.error, /JSON/); assert.equal(bad.merged, first.merged);
});
```

- [ ] **Step 2: Run to verify it fails**. `npm test` → FAIL.
- [ ] **Step 3: Implement `planApply`, then the mod.**
- [ ] **Step 4: Verify**:
  - `npm test` → PASS.
  - `npm run deploy` → exit 0.
  - `herdr-app do layout.switch '{"name":"herdr-dock"}'`, then `herdr-app shot`. Expect the top bar
    with the toggle and tabs, the left column with placeholders, and the terminals.
  - Press Ctrl+Alt+B three times and take a shot each time: expanded → 48 px rail → hidden → expanded.
  - Put a syntax error in `config/dock.json`: the window is unchanged and a red dot appears. Fix it:
    the dot disappears.
  - Change `left.size` to 300: the panel widens without a restart.
- [ ] **Step 5: Commit**: `feat: dock-core applies config live and owns the left panel mode`

---

### Task 6: dock-spaces and dock-agents (from the shipped mods)

**Files:**
- Create: `src/mods/dock-spaces/{main.js,mod.json,manifest.json,icon.svg}`,
  `src/mods/dock-agents/{main.js,mod.json,manifest.json,icon.svg}`, `src/mods/_feature.js`
- Test: `tests/feature.test.mjs`

**Interfaces:**
- Consumes: `matchSession`, `parseStatusline`, `formatPercent` (Task 3), `slashPath`.
- Produces in `src/mods/_feature.js`:
  - `featureMode(sharedMode: unknown, focus: unknown, myId: string): "full" | "icon" | "collapsed"`:
    `icons` → `icon`; `expanded` with a non-null focus other than `myId` → `collapsed`; otherwise `full`.
  - `iconRail(t, iconPath, title, onClick)`: element. A 48 px wide column with the feature's icon
    centered at the top, the title as tooltip, and `onClick` on press.
  - `requestFocus(myId)`: `setShared("dock.left.focus", myId)` then `setShared("dock.left.mode", "expanded")`.
    dock-core sees the change and applies `panelActions` (Task 5).

Steps for each of the two mods:
1. Copy `~/.config/herdr-app/mods/<spaces|agents>/main.js` as the starting point. Add a header comment
   saying it comes from Herdr's shipped mod and its version (`installed.json`).
2. At the top of `render`, branch on
   `featureMode(shared("dock.left.mode"), shared("dock.left.focus"), props().dockFeature)`:
   - `icon` → `iconRail(...)`.
   - `collapsed` → only the existing header row.
   - `full` → the original UI.
3. `dock-agents` only: per row, show the session's context `formatPercent(...)` in the dim text color
   after the title, for agents where `app === "claude-code"` or `program.key === "claude"`, the address
   has no `/` (local), and a session matches. Data path, refreshed by `cx.timer.every(15000)` and on
   agent list change, not in render:
   - `hc(["get", address, "--json"])` gives `foreground.pid` and `created_ms`.
   - `readTextFile(slashPath(home()) + "/.claude/sessions/" + pid + ".json")`, then `matchSession`.
   - `parseStatusline(readTextFile(<cache>))` gives `sessions.get(id)`.
   - Show nothing when any step fails or the reading is stale.

- [ ] **Step 1: Write the failing test for `featureMode`**

```js
test("featureMode", () => {
  assert.equal(featureMode("icons", null, "a"), "icon");
  assert.equal(featureMode("expanded", "b", "a"), "collapsed");
  assert.equal(featureMode("expanded", "a", "a"), "full");
  assert.equal(featureMode(undefined, undefined, "a"), "full");
});
```

- [ ] **Step 2: Run to verify it fails**. `npm test` → FAIL.
- [ ] **Step 3: Implement `_feature.js`, then both mods.**
- [ ] **Step 4: Verify**:
  - `npm test` → PASS.
  - `npm run deploy` → `check passed` for both.
  - Take shots: in expanded mode, Spaces and Agents look like the shipped ones, and this Claude agent's
    row shows `NN% used` matching Claude's own status bar (within 2%). In icon mode, each shows its icon.
    Clicking the Agents icon expands the panel with Agents tall and Spaces collapsed to its header.
  - A plain PowerShell tab, which is not an agent, shows no number.
- [ ] **Step 5: Commit**: `feat: Spaces and Agents features with icon mode and per-agent context`

---

### Task 7: dock-quotas

**Files:**
- Create: `src/mods/dock-quotas/{main.js,mod.json,manifest.json,icon.svg}`
- Test: `tests/quotas-view.test.mjs`

**Interfaces:**
- Consumes: `parseStatusline`, `formatPercent`, `formatAge`, `formatReset` (Task 3), `featureMode`,
  `iconRail`, `requestFocus` (Task 6).
- Produces: `quotaRows(statusline: Statusline | null, nowMs): { label: string, value: string, detail: string, stale: boolean }[]`
  in `src/mods/dock-quotas/view.js` (pure, tested).
  - Labels: `"Claude · 5-hour"` and `"Claude · weekly"`. Value: `formatPercent`. Detail:
    `formatReset(...) + " · " + formatAge(now - fetchedMs)`.
  - `null` input → one row `{ label: "Claude", value: "no data", detail: "start Claude Code to report usage", stale: false }`.

Render:
- `full`: a header "Quotas", then one row per `quotaRows` entry, each with a thin bar filled to the
  used %. The bar uses accent color under 70%, amber 70–90%, red ≥ 90%. Stale rows are dimmed and show
  "stale".
- `icon`: `iconRail`, plus a small badge with the highest used % across windows.
- `collapsed`: the header only.
- Refresh: `watchFolder(<home>/.claude/statusline-cache)` plus `cx.timer.every(30000)` so the age text
  stays current. Re-read the file on either.

- [ ] **Step 1: Write the failing tests**

```js
test("quotaRows formats windows", () => {
  const s = { fetchedMs: 1_000_000, stale: false, sessions: new Map(),
    windows: [{ kind: "five_hour", usedPercent: 5, resetsMs: 1_000_000 + 7_500_000 }] };
  const [r] = quotaRows(s, 1_000_000 + 30_000);
  assert.equal(r.label, "Claude · 5-hour"); assert.equal(r.value, "5% used");
  assert.match(r.detail, /^resets in 2h 04m · just now$/);
});
test("quotaRows with no data", () => {
  assert.deepEqual(quotaRows(null, 0), [{ label: "Claude", value: "no data", detail: "start Claude Code to report usage", stale: false }]);
});
```

- [ ] **Step 2: Run to verify it fails**. `npm test` → FAIL.
- [ ] **Step 3: Implement `view.js` and `main.js`.**
- [ ] **Step 4: Verify**:
  - `npm test` → PASS.
  - `npm run deploy` → `check passed`.
  - Take a shot: the 5-hour and weekly used % match the `windows` in
    `~/.claude/statusline-cache/claude-statusline.json`.
  - Rename the cache file temporarily: Quotas shows "no data". Restore it.
- [ ] **Step 5: Commit**: `feat: Agent quotas feature`

---

### Task 8: End-to-end on Windows and README

**Files:**
- Create: `README.md` (what herdr-dock is, `npm install && npm run deploy`, switching layouts, the
  config shape, the Ctrl+Alt+B key, and how to add a third-party mod to a region)

- [ ] **Step 1:** `npm test` → all PASS. `npm run deploy` → exit 0 with all four checks passed.
- [ ] **Step 2:** Switch to `herdr-dock`. Then check:
  - `herdr-app status` shows `"errors": []`.
  - Take shots of each panel mode. Each feature works: clicking a space selects it, and clicking an
    agent focuses it.
  - `layouts/cockpit.json` and `main.json` are unchanged (compare to their hashes before deploy).
- [ ] **Step 3:** Add `{ "mod": "files" }` (shipped) to `regions.right.features` with `hidden: false`.
  It appears on the right with no other change. Revert.
- [ ] **Step 4:** Add a `machines.<this hostname>` override `{ "regions": { "left": { "size": 320 } } }`.
  The panel goes to 320 px. Revert.
- [ ] **Step 5: Commit**: `docs: README for herdr-dock v1`
