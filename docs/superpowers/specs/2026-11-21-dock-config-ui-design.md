# herdr-dock config UI — design

Date: 2026-11-21. Builds on `2026-11-21-herdr-dock-design.md` (herdr-dock v1, merged).

## Intent

Today the only way to change which mods the dock shows, and where, is editing `config/dock.json` by hand. The
config UI lets the user do that from inside Herdr: switch mods on in a region (top, left, right, bottom) or off,
reorder them, and set the region sizes and modes, then save.

Changes are **per machine**. Saving on this PC writes only this PC's `machines.<hostname>` section, so Mac and
Omarchy don't pick it up. The shared base stays a hand-edited, git-synced file.

## Goals

- Show every installed mod that can be placed, and let the user put each one in a region or switch it off.
- Two views of the same edits, switchable: **by region** (four lists, in order) and **by mod** (one row per mod,
  with the region it's in or "off").
- Reorder mods within a region.
- Show each mod's name (`title` from its `mod.json`, else its id) next to its id.
- Region settings: size in px for every region, shown/hidden for right and bottom, and the left panel's starting
  mode (expanded, icons, hidden).
- Show the current config error in plain words. Today it is only a red dot on the top-bar toggle.
- "Reset this PC to shared": drop this PC's section and go back to the base.
- Saving takes effect live through dock-core's existing file watch.

## Non-goals (this version)

- Per-feature details: fixed height vs "share the space", `drag`, and `props` (raw JSON for third-party mods).
  Existing values are kept unchanged when a feature moves.
- "Copy to all machines" (promote this PC's setup to the shared base).
- A label for "this differs from shared" on each setting.
- Editing the shared base from the UI.
- Settings belonging to a feature itself (which quotas, agent display), and keyboard shortcuts (Herdr has its own
  keys editor).

## Anti-goals

- The UI must never leave `dock.json` invalid or half-written. A save either writes a config that `parseConfig`
  accepts, or writes nothing and says why.
- It must never silently overwrite a hand edit made while the dialog was open.
- It must not touch the base, or other machines' sections, beyond reformatting (see Saving).

## Approaches considered

- **A. A `dock-config` dialog mod (chosen).** It opens over the window like Herdr's "Add machine" dialog and
  writes `dock.json`; dock-core redraws on the file change. It is native gpui-kit and works the same on all
  three platforms. Its cost is a fixed dialog size.
- **B. The editor in the right region.** This gives more room and a live view beside it, but it rewrites the
  layout it is drawn in, so it redraws under the user on every save, and dock-core would need a config mode.
  Rejected.
- **C. A local web page served by Node.** It is the easiest UI to build, but it lives outside Herdr and needs
  Node running on every machine. Rejected.

## Design

### Pieces

- **`dock-config` mod** (`src/mods/dock-config/`): `mod.json`
  `{ "place": "none", "title": "Dock layout", "overlay": { "kind": "dialog", "width": 760, "height": 0.8 } }`.
  It holds the dialog UI and the state of an editing session.
- **`src/shared/edit.js`**: a pure module, tested with `node --test`, holding all the editing logic:
  - building the effective regions for this host,
  - applying an edit (move, reorder, turn on, turn off, size, hidden, mode),
  - the per-mod allowed-region rules,
  - computing the machine section to save,
  - serializing.
  The mod is a thin view over it.
- **`src/shared/platform.js`**: gains `listDirCommand(platform, dir)`, which returns the command that lists the
  folder names in `dir`:
  - Windows: `cmd /c dir /b /ad "<dir>"`.
  - macOS and Linux: `ls -1 -p` (keep the names that end in `/`, and strip the `/`).
- **dock-core**:
  - gains a `dock-core.config` command, which runs `mod.open {name: "dock-config"}`.
  - publishes the hostname it resolved as shared key `dock.host`, so the dialog edits exactly the section
    dock-core applies.
  - publishes the config path as `dock.config.path`.
- **Entry points**:
  - a layout button next to the gear in `dock-footer` (expanded and collapsed faces; the 48 px rail keeps only
    the gear),
  - the `dock-core.config` command,
  - the key Ctrl+Alt+, (`ctrl-alt-,`), added by deploy to `keys.json` section `layout:herdr-dock`. The existing
    Ctrl+Alt+B merge code is generalized to take a list of bindings, with the same skip rules (key taken, or no
    `keys.json`). The builder checks that `ctrl-alt-,` parses in Herdr's key syntax (`herdr-app check`, or a
    Herdr default that uses `,`). If it doesn't, use `ctrl-alt-.` and note that in the README.

### Mod inventory

- On open, the dialog lists `appHome()/mods/` with `listDirCommand` and reads each `mod.json`.
- `place` can't tell a panel from a helper, because almost every mod, `tabs` and `workspace-status` included,
  says `"place": "none"`. A mod is listed when:
  - its `mod.json` parses,
  - its folder name doesn't start with `_` or `.`,
  - it isn't `dock-config` itself,
  - it isn't overlay-only: an `overlay` key together with `place` of `"none"` or missing. Examples are `picker`,
    `machine-add` and `mission-control-tabs`. A mod with both an `overlay` and a `place` of `"left"` or `"right"`
    (such as `mission-control-github`) is a panel too, and is listed.
  - it isn't one of Herdr's shipped helpers. These have no `overlay` key but are opened by Herdr itself, never
    placed: `confirm`, `prompt`, `toast`, `menu`, `new-menu`, `help`, `peek`, `pane`, `terminals-pane` and
    `worktree`. This list (`HELPER_MODS`) is exported from `edit.js`.
- A "Show all mods" switch in the by-mod view lists the hidden ones too, greyed and marked "helper". Third-party
  mods are placed as-is, so the user can still place one we guessed wrong about.
- Mods named in the config but not installed still show in both views, marked "not installed". They can be
  removed or kept as they are.
- If the listing fails, the dialog falls back to:
  - the keys of `installed.json` (Herdr's shipped mods; `layout:*` keys dropped), with the same filter applied,
  - plus the mods named in the config.
  It then says the list may be incomplete.

### Placement rules

These are the existing `parseConfig` rules, enforced in the UI rather than reported after the fact:

- `dock-core`: top only, and can't be switched off.
- `dock-header`, `dock-footer`, `dock-spaces`, `dock-agents`, `dock-quotas` (`LEFT_ONLY` in `config.js`): left or
  off. In the by-mod view, the other regions are greyed out with a tooltip that gives the reason.
- Every other mod: any region, or off.
- One region per mod. Turning a mod on in another region moves it, keeping its `size`, `drag` and `props`.
- The top bar can't be hidden, so it has no show/hide switch.

`edit.js` exports the rule (`allowedRegions(modId) -> string[]`). `config.js` keeps its own validation, and a test
checks that the two agree.

### Where a mod lands

- A mod turned on, or moved into a region, goes at the end, except that in the left region it goes just above
  `dock-footer` when that is present, so the footer stays last.
- In the top region, `dock-core` stays first.
- Reorder is up/down buttons on each row in the by-region view. Drag-and-drop is left to the builder if gpui-kit
  makes it cheap; buttons are required either way.

### The dialog

```
┌ Dock layout ── this PC: forkadam-pc ───────────────────────────┐
│ ⚠ regions.left.features[2].mod: … (only when there's an error) │
│ [ By region | By mod ]                                         │
│                                                                │
│  By region:                                                    │
│  TOP     size [42]                                             │
│    dock-core   Dock            🔒                              │
│    tabs        Tabs            ↑ ↓ ✕                           │
│    + Add mod ▾                                                 │
│  LEFT    size [268]   start as (expanded|icons|hidden)         │
│    dock-header Header          ↑ ↓ ✕   …                       │
│  RIGHT   size [360]   shown ○                                  │
│  BOTTOM  size [28]    shown ●                                  │
│                                                                │
│  By mod:                                                       │
│    Files       files       ( Off | Top | Left | Right | Bottom )│
│    Spaces      dock-spaces ( Off | ░░░ | Left | ░░░░░ | ░░░░░░ )│
│                                                                │
│ Reset this PC to shared          [Cancel]  [Save]  ● unsaved   │
└────────────────────────────────────────────────────────────────┘
```

- **Views.**
  - The by-region / by-mod switch is a `Tabs` control.
  - Both views edit one in-memory draft, so switching views keeps pending edits.
  - The last-used view is remembered with `setShared("dock.config.view", …)`.
- **Region rows.**
  - Size is a `NumberInput` (positive integers only).
  - Right and bottom get a `Switch` for shown.
  - Left gets a three-way choice of starting mode.
- **Add mod.** "+ Add mod ▾" lists the mods allowed in that region that aren't already in it. Picking one from
  another region moves it.
- **Error banner.** It shows `shared("dock.config.error")` live, plus any error from the last save attempt.
- **Footer.** It shows a dirty marker when the draft differs from the file, plus Cancel and Save. Esc and Cancel
  close the dialog and drop the draft. There is no confirm, because Herdr closes the dialog on Esc itself.
- **Reset this PC to shared.** It asks for confirmation inside the dialog, then removes `machines.<host>` and
  saves straight away.

### Saving

1. Start from the file text read when the dialog opened (`opened`), parsed.
2. Compute this host's section from the draft (`machineSection(base, draftRegions)`):
   - For each region, keep each of `size`, `hidden`, `mode`, `features` only where it differs from the base.
   - `features` is written whole when it differs, because arrays replace in `mergeForHost`.
   - The left panel's mode is written as `mode`. In `mergeForHost`, a left `hidden: true` beats `mode`. So when
     the merged base has left `hidden: true` and the draft mode isn't `hidden`, the section also writes
     `hidden: false`. Otherwise left `hidden` isn't written.
   - Regions with nothing different are dropped.
   - If nothing differs, the host's section is deleted.
   - Keys in the host's section other than `regions` are kept as they are.
3. The host key reuses the existing key's spelling when one matches case-insensitively. Otherwise it uses
   `dock.host` (lowercase).
4. Validate the whole result with `parseConfig`. If it fails, write nothing and show the error.
5. Serialize with a stable formatter in `edit.js`. It keeps every key, top-level, region and feature (unknown
   ones included), in the order they appear in the parsed object. `dock.json` is strict JSON, so there are no
   comments to keep. The formatter uses:
   - 2-space indent,
   - each feature object on one line,
   - each region object's scalars on the region's line where they fit.
   The base's content is unchanged, but its whitespace follows this formatter. The first save may reformat the
   file once.
6. Call `writeTextFile(path, text, opened)`. If it rejects because the file changed on disk:
   - re-read the file,
   - recompute the section from the same draft against the fresh base,
   - show "dock.json changed on disk; your edits were re-applied, check and save again",
   - and do not write. The user saves again.
7. After a successful write:
   - `opened` becomes the new text and the dirty marker clears.
   - The dialog stays open, so the user sees the layout change behind it. Any `dock.config.error` that dock-core
     raises shows in the banner.

### When dock.json is already invalid

If the file doesn't parse or fails `parseConfig` when the dialog opens:

- The dialog shows the error and "fix config/dock.json by hand, then reopen".
- Both views are drawn from the last good config dock-core applied, read-only.
- Save and Reset are disabled. The UI never builds a save on top of a file it can't read.

### Opening twice

`mod.open` toggles: running it again closes the dialog. So the footer button, the command and the key all
toggle it, which is the intended behavior.

### Hostname and paths

- The dialog reads `shared("dock.host")` and `shared("dock.config.path")`.
- If either is missing (dock-core hasn't started yet, or its hostname failed), the dialog:
  - says so,
  - falls back to `mods/dock-core/source.json` for the path and hostname,
  - disables Save when no hostname is known.

## Constraints

- Same toolchain as v1:
  - esbuild bundles per mod.
  - `scripts/deploy.mjs` installs, adds keys and runs `herdr-app check`.
  - `node --test`.
  - Node 22+.
- No Python and no platform-specific code in mods, except through `src/shared/platform.js`.
- Windows is the verified platform. The macOS/Linux listing command is written but untested, as in v1.
- `config/dock.json` stays the single source. The generated layout is never committed.

## Left to the builder

- Exact spacing, colors and icons, following the existing dock mods' theme usage (`t.chrome`, `t.border`,
  `t.dim`, `t.hover`).
- The layout button's icon, a "layout" or "panels" svg.
- Whether the by-mod view also sorts or groups placed mods first.
- Drag-and-drop reorder, only if cheap.
