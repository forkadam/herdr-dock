# Dock config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Dock layout" dialog mod (`dock-config`) that places installed mods in the top, left, right or bottom
region, or switches them off. It shows the edits grouped by region or by mod, and saves them to this PC's
`machines.<hostname>` section of `config/dock.json`.

**Architecture:** All editing and saving logic lives in pure, tested modules:
- `src/shared/edit.js`: rules, draft edits, machine section, formatter.
- `src/shared/inventory.js`: which mods are placeable.
- `src/mods/dock-config/session.js`: load and save over injected I/O.

`dock-config/main.js` is a thin gpui-kit view. dock-core publishes the hostname and config path as shared keys
and gains a `config` command. Deploy binds Ctrl+Alt+, to it. Saving only writes the file; dock-core's existing
watch redraws the layout.

**Tech Stack:** Herdr app mods (gpui-kit JS, `herdr` module), esbuild bundling per mod, `node --test`, Node 22+.

**Spec:** `docs/superpowers/specs/2026-11-21-dock-config-ui-design.md`

## Global Constraints

- Saves write only `machines.<host>` in `config/dock.json`. The base and other machines' sections keep their
  content. Whitespace may change through the formatter.
- A save writes a config that `parseConfig` accepts, or writes nothing and shows why.
- Saves use `writeTextFile(path, text, expected)` with the text read at open. A rejection means "changed on
  disk": re-read, re-apply the draft, show "dock.json changed on disk; your edits were re-applied, check and save
  again", and do not write.
- Placement rules:
  - `dock-core`: top only, can't be switched off, and stays first in top.
  - `LEFT_ONLY` (`dock-header`, `dock-footer`, `dock-spaces`, `dock-agents`, `dock-quotas`): left or off.
  - Every other mod: any region, or off.
  - One region per mod.
  - The top bar can't be hidden.
- Where a newly placed mod goes: at the end of the region, except in left, where it goes just above
  `dock-footer` when that is present. Moving a mod keeps its `size`, `drag` and `props`.
- `HELPER_MODS` = `confirm`, `prompt`, `toast`, `menu`, `new-menu`, `help`, `peek`, `pane`, `terminals-pane`,
  `worktree`.
- Overlay-only means an `overlay` key with `place` of `"none"` or missing. Those mods are not placeable.
- Shared keys:
  - `dock.host` (lowercase hostname, or null),
  - `dock.config.path` (slash path),
  - `dock.config.view` (`"region"` | `"mod"`),
  - `dock.config.applied` (the regions dock-core last applied),
  - `dock.config.error` (existing).
- Dialog: `mod.json` `{ "place": "none", "title": "Dock layout", "overlay": { "kind": "dialog", "width": 760, "height": 0.8 } }`.
- Key: `ctrl-alt-,` → `dock-core.config` in `keys.json` section `layout:herdr-dock`, with the same skip rules as
  `ctrl-alt-b`. Herdr's own `global` section already binds `ctrl-,`, so the syntax is valid.
- Mods contain no platform-specific code except through `src/shared/platform.js`. No Python.

## Review Focus

1. **Hostname spelling.** The config has `machines["Forkadam-PC"]` and the host is `forkadam-pc`. A save must
   update that key, not add a second one. Test in Task 3.
2. **Nothing else changes.** After a save, the base regions and every other machine's section deep-equal what
   they were before. Test in Task 3.
3. **No empty leftovers.** A draft equal to the base removes `machines.<host>`. It must not leave
   `"forkadam-pc": {}` or `"regions": {}` behind. Test in Task 3.
4. **Hand edit while the dialog is open.** `writeTextFile` rejects: nothing is written, the draft is re-applied
   to the fresh file, and the message is shown. Test in Task 4.
5. **Odd mod folders.** A folder with a broken or missing `mod.json`, Windows CRLF listing output, or a mod named
   in the config but not installed. None of these crash, and each is listed as described. Tests in Task 2.

---

### Task 1: Placement rules and draft edits (`edit.js`)

**Files:**
- Create: `src/shared/edit.js`
- Test: `tests/edit.test.mjs`
- Modify: `src/shared/config.js`: export `LEFT_ONLY`, so `edit.js` imports it rather than copying it.

**Interfaces:**
- Consumes: `mergeForHost`, `parseConfig`, `REGION_NAMES` from `src/shared/config.js`.
- Produces:
  - `allowedRegions(mod: string) -> string[]`
  - `canTurnOff(mod: string) -> boolean`
  - `draftFromConfig(config: object, host: string) -> Draft`, where
    `Draft = { regions: { top, left, right, bottom } }`:
    - Each region is `{ size?, hidden: boolean, features: Feature[] }`.
    - `left` also has `mode`, and its `hidden` is always `false`, because the mode carries "hidden".
    - The draft is a deep copy, so mutating it never touches `config`.
  - `regionOf(draft, mod) -> string | null`
  - `applyEdit(draft, op) -> { draft: Draft, error: string | null }`. It never mutates its input, and on error
    returns the input draft unchanged. The ops are:
    - `{ type: "place", mod, region }`, where `region` is a region name or `"off"`
    - `{ type: "move", region, index, delta }`, with `delta` -1 or 1
    - `{ type: "size", region, value }`
    - `{ type: "hidden", region, value }`
    - `{ type: "mode", value }`, for left only
  - `sameDraft(a: Draft, b: Draft) -> boolean`

- [ ] **Step 1: Write the failing tests** in `tests/edit.test.mjs`, using `tests/fixtures/dock.json` as the base
  config.
  - **allowedRegions:**
    - `allowedRegions("dock-core")` → `["top"]`.
    - `allowedRegions("dock-spaces")` → `["left"]`.
    - `allowedRegions("files")` → `["top","left","right","bottom"]`.
    - `canTurnOff("dock-core") === false`, and `canTurnOff("tabs") === true`.
  - **Agreement with `parseConfig`.** For each mod in `["dock-core","dock-header","dock-footer","dock-spaces","dock-agents","dock-quotas","files","tabs"]`
    and each region, put the mod into that region's features in a copy of the fixture, also keeping `dock-core`
    in top. `parseConfig(...).ok` must equal `allowedRegions(mod).includes(region)`.
  - **place, moving a mod:** `place files right` on the fixture:
    - `regionOf → "right"`,
    - files is gone from wherever it was,
    - it is appended last in right.
  - **place, footer stays last:** `place workspace-status left` lands at index `features.length - 2` of left, just
    above `dock-footer`. With no `dock-footer` in left, it goes last.
  - **place, settings kept:** placing a feature that had `{ size: 150, props: { a: 1 } }` into another region
    keeps both.
  - **Errors:**
    - `place dock-spaces right` returns an error naming `regions.left`, and the draft is unchanged
      (`sameDraft` with the input).
    - `place dock-core off` returns an error.
    - `place dock-core left` returns an error.
  - **place off** removes the mod from its region.
  - **move:**
    - `move top index 1 delta -1` (onto dock-core at 0) returns an error. dock-core stays first.
    - Moving past either end is a no-op with no error.
  - **size:**
    - `size left 300` sets 300.
    - `size left 0`, `size left 2.5` and `size left "x"` each return an error.
  - **hidden:**
    - `hidden top true` returns an error.
    - `hidden right false` sets `hidden: false`.
  - **mode:**
    - `mode icons` sets `left.mode`.
    - `mode bogus` returns an error.
  - **Left hidden in the base:**
    - `draftFromConfig` of a config whose base left has `hidden: true` gives `left.mode === "hidden"` and
      `left.hidden === false`.
    - `draftFromConfig` applies `machines.<host>` (it uses `mergeForHost`).

- [ ] **Step 2: Run the tests and confirm they fail.** `node --test tests/edit.test.mjs` fails because
  `src/shared/edit.js` doesn't exist.

- [ ] **Step 3: Implement `src/shared/edit.js`.** It stays pure, with no Node built-ins, like the other
  `src/shared` modules. Error strings use the same `regions.<name>...` style as `parseConfig`.

- [ ] **Step 4: Run all the tests.** `npm test` passes, all 83 existing tests included.

- [ ] **Step 5: Commit.** `git commit -m "feat(edit): placement rules and draft edits for the config UI"`

### Task 2: Mod inventory (`inventory.js`, `platform.js`)

**Files:**
- Create: `src/shared/inventory.js`
- Modify: `src/shared/platform.js`
- Test: `tests/inventory.test.mjs`, `tests/platform.test.mjs` (add cases)

**Interfaces:**
- Consumes: `allowedRegions`, `regionOf` (Task 1).
- Produces:
  - `listDirCommand(platform: "windows"|"macos"|"linux", dir: string) -> { command, args }`:
    - Windows: `{ command: "cmd", args: ["/c", "dir", "/b", "/ad", dir.replaceAll("/", "\\")] }`.
    - Otherwise: `{ command: "ls", args: ["-1", "-p", dir] }`.
  - `parseDirListing(platform, stdout: string) -> string[]`:
    - splits on `\r?\n`, trims, and drops empty lines;
    - on macOS and Linux, keeps only names ending in `/` and strips it.
  - `HELPER_MODS: string[]`, from Global Constraints.
  - `placeability(id: string, modJson: object | null) -> null | "helper" | "overlay" | "self" | "hidden-name" | "broken"`.
    It returns null when the mod is placeable; otherwise it returns the reason.
  - `installedFallbackIds(installedJsonText: string | null) -> string[]`: the keys without the `layout:`
    prefix; `[]` on bad input.
  - `buildInventory(entries: { id, modJson }[], draft: Draft) -> Item[]`, where
    `Item = { id, title, reason, installed, region }`:
    - `title` is `modJson.title`, else `id`.
    - Config mods missing from `entries` come out as `installed: false`.
    - Placeable items are sorted first, then by `title` (case-insensitive).

- [ ] **Step 1: Write the failing tests.**
  - **listDirCommand:**
    - `listDirCommand("windows","C:/Users/a/.config/herdr-app/mods")` gives
      `args[4] === "C:\\Users\\a\\.config\\herdr-app\\mods"`.
    - On `macos`, the command is `ls`.
  - **parseDirListing:**
    - `parseDirListing("windows","tabs\r\nfiles\r\n\r\n")` → `["tabs","files"]`.
    - `parseDirListing("linux","tabs/\nREADME.md\nfiles/\n")` → `["tabs","files"]`.
  - **placeability:**
    - `placeability("picker", {place:"none", overlay:{}})` → `"overlay"`.
    - `placeability("mission-control-github", {place:"right", overlay:{}})` → `null`.
    - `placeability("confirm", {place:"none"})` → `"helper"`.
    - `placeability("dock-config", {...})` → `"self"`.
    - `placeability("_x", {})` and `placeability(".git", {})` → `"hidden-name"`.
    - `placeability("weird", null)` → `"broken"`.
    - `placeability("tabs", {place:"none", title:"Tabs"})` → `null`.
  - **installedFallbackIds:**
    - `installedFallbackIds('{"tabs":{},"layout:main":{}}')` → `["tabs"]`.
    - `installedFallbackIds("not json")` → `[]`.
  - **buildInventory**, with the fixture's draft and entries for `tabs`, `files`, `confirm` and
    `broken (modJson null)`:
    - `files` has `region: null` and `reason: null`.
    - `tabs` has `region: "top"`.
    - `confirm` has `reason: "helper"`.
    - `workspace-status` (in the fixture config, not in the entries) has `installed: false` and
      `region: "bottom"`.
    - Placeable items come before non-placeable ones.

- [ ] **Step 2: Run the tests and confirm they fail.** `node --test tests/inventory.test.mjs tests/platform.test.mjs` fails.

- [ ] **Step 3: Implement** the functions in `src/shared/platform.js` and `src/shared/inventory.js`.

- [ ] **Step 4: Run all the tests.** `npm test` passes.

- [ ] **Step 5: Commit.** `git commit -m "feat(inventory): list placeable mods across platforms"`

### Task 3: Saving: machine section and formatter (`edit.js`)

**Files:**
- Modify: `src/shared/edit.js`
- Test: `tests/edit-save.test.mjs`

**Interfaces:**
- Consumes: Task 1's `Draft`, `draftFromConfig`; `parseConfig`, `mergeForHost`.
- Produces:
  - `machineSection(config: object, draft: Draft) -> object | null`: the `regions` object for this host, or null
    when the draft equals the base. The base is `mergeForHost({ ...config, machines: {} }, "")`.
  - `formatConfig(obj: object) -> string`: `JSON.stringify(obj, null, 2)` layout, except that every object
    directly inside a `features` array prints on one line as `{ "mod": "tabs", "size": 44 }` (`": "` after
    keys, `", "` between entries, spaces inside the braces; nested values inline with the same spacing). It
    ends with `"\n"`.
  - `planSave(openedText: string, host: string, draft: Draft) -> { ok: true, text } | { ok: false, error }`
  - `planReset(openedText: string, host: string) -> { ok: true, text } | { ok: false, error }`

- [ ] **Step 1: Write the failing tests.**
  - **machineSection:**
    - With the draft equal to the base → `null`.
    - With `size left 300` → `{ left: { size: 300 } }`, and nothing else.
    - With `place files right` → `right.features` is the whole new array, `left.features` is the whole array
      with files removed, and no `size` keys appear.
    - With `hidden right false` when the base right is hidden → `{ right: { hidden: false } }`.
    - With `mode icons` → `{ left: { mode: "icons" } }`, with no `hidden` key.
    - With a base whose left has `hidden: true` and the draft mode `expanded` →
      `{ left: { mode: "expanded", hidden: false } }`.
  - **planSave:**
    - For host `forkadam-pc` with config `machines: { "Forkadam-PC": { regions: {left:{size:320}}, note: "x" } }`,
      `size left 300` → the result has `machines["Forkadam-PC"].regions.left.size === 300` and
      `machines["Forkadam-PC"].note === "x"`, with no `forkadam-pc` key.
    - **Nothing else changes.** With `machines: { other: {...} }`, after a save
      `parsed.regions` deep-equals the input regions, and `parsed.machines.other` deep-equals the input.
    - **No empty leftovers.** A draft equal to the base on a config with `machines["forkadam-pc"]` gives no
      `forkadam-pc` key, while `machines` stays as `{}`. When the host's section has other keys (`note`), only
      `regions` is removed.
    - Invalid `openedText` → `{ ok: false }`, with the `parseConfig` error.
  - **planReset** removes the host's section (case-insensitive match) and leaves the rest as it was.
  - **formatConfig:**
    - `formatConfig(x)` round-trips: `JSON.parse(formatConfig(x))` deep-equals `x`, for the fixture and for
      `config/dock.json`.
    - The output for the fixture contains the line `{ "mod": "dock-core", "size": 44 },` (with its
      indentation), and no line holding only `"mod": ...`.
    - Key order is kept: the first key of `JSON.parse` output equals the input's first key.

- [ ] **Step 2: Run the tests and confirm they fail.** `node --test tests/edit-save.test.mjs` fails.

- [ ] **Step 3: Implement the functions in `src/shared/edit.js`.** In `planSave`, before returning the text:
  - parse `openedText` with `parseConfig`,
  - pick the host key (an existing key that matches case-insensitively, else `host`),
  - set or delete `machines[key].regions` (deleting `machines[key]` when it ends up empty),
  - run `parseConfig(formatted)`; it must be ok, otherwise return `{ ok: false, error }`.

- [ ] **Step 4: Run all the tests.** `npm test` passes.

- [ ] **Step 5: Commit.** `git commit -m "feat(edit): save to this machine's section with a stable formatter"`

### Task 4: dock-core shared keys and command, the deploy key, and the editing session

**Files:**
- Modify: `src/mods/dock-core/main.js`:
  - After the hostname resolves (or fails), `setShared("dock.host", this.host ?? null)`.
  - After the config path is read, `setShared("dock.config.path", this.configPath)`.
  - After each successful apply, `setShared("dock.config.applied", <the merged config's regions, with left.hidden false and left.mode kept>)`.
    This is the "last good config" that a read-only dialog shows.
  - In `command(c)`: `"config"` → `run("mod.open", { name: "dock-config" })`.
- Create: `scripts/keys.mjs`, with
  `mergeKeys(keys: object, section: string, bindings: [key, action][]) -> { keys, added: string[], skipped: { key, reason }[] }`.
  It is pure and returns a new object.
- Modify: `scripts/deploy.mjs`:
  - Use `mergeKeys` with `[["ctrl-alt-b","dock-core.cycle"],["ctrl-alt-,","dock-core.config"]]`.
  - Keep the "no keys.json" skip, and print one line per added or skipped key.
- Create: `src/mods/dock-config/session.js`, with the editing session over injected I/O (no gpui).
- Test: `tests/keys.test.mjs`, `tests/session.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3, and `listDirCommand`/`parseDirListing`/`buildInventory`/`installedFallbackIds` (Task 2).
- Produces:
  - `io = { readTextFile(path) -> Promise<string|null>, writeTextFile(path, text, expected) -> Promise, exec(cmd, args) -> Promise<{stdout}>, appHome: string, platform: string, shared(key) -> unknown }`
  - `loadSession(io) -> Promise<Session>`, where
    `Session = { path, host, opened, draft, inventory, readOnly: boolean, notice: string | null, error: string | null }`:
    - `path` and `host` come from `shared("dock.config.path")` and `shared("dock.host")`, else from
      `${appHome}/mods/dock-core/source.json` (`config` and `hostname`, lowercased).
    - `readOnly` is true when the file fails `parseConfig`. `draft` is then `{ regions: shared("dock.config.applied") }`
      when that is set; otherwise it is `draftFromConfig(DEFAULT_CONFIG, host)`. `error` is set to the parse
      error plus " — fix config/dock.json by hand, then reopen".
    - With no `host`, `readOnly` is true and `error` is "this computer's hostname is unknown: run npm run deploy".
    - When the listing `exec` rejects, the inventory uses `installedFallbackIds` and
      `notice = "mod list may be incomplete"`.
  - `saveSession(session, io) -> Promise<Session>`. It calls `planSave`:
    - On ok, it writes with `expected = session.opened`. On success it returns `opened = text`, `error: null`.
    - When `writeTextFile` rejects, it re-reads the file and returns
      `opened = fresh text, draft unchanged, notice = "dock.json changed on disk; your edits were re-applied, check and save again"`,
      and writes nothing more.
  - `resetSession(session, io) -> Promise<Session>`: `planReset`, then the same write path, then the draft
    rebuilt from the new text.
  - `isDirty(session) -> boolean`: `!sameDraft(session.draft, draftFromConfig(parse(session.opened), host))`.

- [ ] **Step 1: Write the failing tests.**
  - **keys.test.mjs:**
    - Merging into `{}` adds both bindings.
    - When the section already has `ctrl-alt-,: "x"` → that key is in `skipped` with a reason, and the other one
      is added.
    - An identical existing binding is neither added nor skipped.
    - The input isn't mutated.
  - **session.test.mjs**, with a fake `io` over an in-memory file map whose
    `writeTextFile` rejects when `expected !== current`:
    - load → save `size left 300` → the file now has `machines["forkadam-pc"].regions.left.size === 300`, and
      `isDirty` is false.
    - **Hand edit:** load, then change the file in the map (add `"machines": {"other": {}}`), then save → the
      write is refused, the stored text is still the hand-edited one, `notice` matches /changed on disk/, the
      draft still has size 300, and `opened` equals the hand-edited text. A second save succeeds and keeps
      `machines.other`.
    - An invalid file → `readOnly: true`, and `error` contains "fix config/dock.json by hand".
    - The shared keys are missing, but `source.json` has them → the path and host come from it.
    - The listing `exec` rejects → `notice` is "mod list may be incomplete", and the inventory comes from
      `installed.json`.

- [ ] **Step 2: Run the tests and confirm they fail.** `node --test tests/keys.test.mjs tests/session.test.mjs` fails.

- [ ] **Step 3: Implement** `scripts/keys.mjs` and `session.js`, wire `deploy.mjs`, and make the dock-core
  changes. dock-core's `cycle`/`expanded`/... handling is unchanged.

- [ ] **Step 4: Run the tests and a dry-run deploy.**
  - `npm test` passes.
  - `node scripts/deploy.mjs --dry-run` prints a merge or skip line for both `ctrl-alt-b` and `ctrl-alt-,`.

- [ ] **Step 5: Commit.** `git commit -m "feat: dock-core config command, Ctrl+Alt+, binding, config editing session"`

### Task 5: The `dock-config` dialog mod

**Files:**
- Create: `src/mods/dock-config/mod.json` (exact text from Global Constraints), `manifest.json`
  `{ "id": "dock-config", "name": "Dock layout", "icon": "icon.svg", "regions": [], "settings": {} }`,
  `icon.svg`, `main.js`, and any svgs it uses (`chevron-up.svg`, `chevron-down.svg`, `x.svg`, `lock.svg`).
  Copy them from `~/.config/herdr-app/mods/workspace-chrome/` where it has them, and record the source in a
  comment as the other dock mods do.
- Test: none new. `main.js` is a view over `session.js`. The check is `herdr-app check` plus screenshots.

**Interfaces:**
- Consumes: `loadSession`, `saveSession`, `resetSession`, `isDirty` (Task 4); `applyEdit`, `allowedRegions`,
  `canTurnOff`, `regionOf` (Task 1); the `Item` list (Task 2).
- Produces: the dialog, opened by `mod.open {name:"dock-config"}`.

The dialog is laid out as in the spec's "The dialog" sketch:

- **Header.** "Dock layout", "this PC: <host>", and an error banner showing `shared("dock.config.error")` or
  `session.error`, plus the `session.notice` line.
- **Tabs.** "By region" and "By mod". The choice is stored in `setShared("dock.config.view", ...)` and defaults
  to `"region"`.
- **By region.** Four sections in the order TOP, LEFT, RIGHT, BOTTOM. Each has:
  - a `NumberInput` for size; for right and bottom a "shown" `Switch`; for left a three-way mode choice;
  - rows of `title` + `id`, each with ↑ ↓ ✕. `dock-core` shows a lock instead.
  - "+ Add mod ▾", which lists placeable items that `allowedRegions` permits here and that aren't already in
    this region.
- **By mod.** One row per placeable item: title, id, and a segmented control Off/Top/Left/Right/Bottom.
  Disallowed segments are greyed, with a tooltip giving the `applyEdit` error text. A "Show all mods" `Switch`
  adds non-placeable items, greyed and marked with their reason. Items with `installed: false` are marked
  "not installed".
- **Footer.**
  - "Reset this PC to shared" asks an inline "Reset? Yes / No" before calling `resetSession`.
  - Cancel runs `closeOverlay(props().overlay)`.
  - Save is disabled unless `isDirty`.
  - A "● unsaved" marker shows while dirty.
  - With `readOnly`, Save, Reset and all edit controls are disabled.
- **Every edit** goes through `applyEdit`. An error from it shows in the banner.

- [ ] **Step 1: Build the mod.** Write the files.
  - `npm run build` lists `dock-config`.
  - `herdr-app check dist/mods/dock-config` passes.

- [ ] **Step 2: Deploy and check it opens.**
  - Run `npm run deploy`, switch to the `herdr-dock` layout, and run `herdr-app do dock-core.config`.
  - `herdr-app status` shows the `dock-config` overlay and no errors.
  - `herdr-app shot` shows the By region view with the current config.

- [ ] **Step 3: Check it end to end.**
  - In the dialog, switch `files` on in Right (By mod), then Save.
  - `config/dock.json` gains `machines["forkadam-pc"].regions.right` with `features` `[{"mod":"files"}]` and
    `hidden: false` (the base right is hidden).
  - The Files panel appears behind the dialog.
  - Then click "Reset this PC to shared" and confirm. The host's section is gone, and the panel disappears.
  - Restore `config/dock.json` with `git checkout config/dock.json` if the formatter changed it in a way you
    don't want to commit. Otherwise commit the reformatted file separately.

- [ ] **Step 4: Commit.** `git commit -m "feat(dock-config): dialog to place mods by region or by mod"`

### Task 6: Footer entry point and docs

**Files:**
- Modify: `src/mods/dock-footer/main.js`: add a `layout` item `{ id: "layout", icon: "layout", label: "Dock layout", dim: false, action: () => run("mod.open", { name: "dock-config" }) }`.
  - Expanded face: gear and layout button on the left (both `iconButton`), "+ Add machine" on the right.
  - Collapsed face: all three icons.
  - Icon rail: the gear only (unchanged).
- Create: `src/mods/dock-footer/layout.svg`, copied from `workspace-chrome` (`sidebar.svg` or `layers.svg`).
- Modify: `README.md`:
  - Add a "Config UI" section: how to open it (button, `dock-core.config`, Ctrl+Alt+,), that it saves only to
    this PC's `machines.<hostname>`, Reset, and the first-save reformat.
  - Remove "No config UI yet" from Known limitations.
  - Update the footer bullet and the deploy keys bullet.
- Modify: `docs/superpowers/specs/2026-11-21-herdr-dock-design.md`, only if it lists the config UI as future
  work. Point it at the new spec.

- [ ] **Step 1: Make the edits.** Run `npm test`, then `npm run deploy`. Both pass.
- [ ] **Step 2: Check the footer.**
  - `herdr-app shot`: the footer shows the gear and the layout icon on the left, and "+ Add machine" on the
    right.
  - Clicking the layout icon, or `herdr-app do dock-core.config`, opens the dialog. Doing it again closes it.
  - Ctrl+Alt+, opens it (the human partner confirms the key by hand).
- [ ] **Step 3: Commit.** `git commit -m "feat(footer): Dock layout button; docs for the config UI"`
