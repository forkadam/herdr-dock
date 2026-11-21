# herdr-dock

A configurable dock layout for [Herdr](https://herdr.app): a top bar, a left panel, and optional right and
bottom regions around your main pane. It ships four mods:

- **dock-core**: the two top-bar toggles. The first cycles the left panel between expanded, icons and hidden; the
  second shows or hides the right column. It also
  rewrites the layout when `config/dock.json` changes.
- **dock-spaces**: your spaces. Click one to select it.
- **dock-agents**: your agents. Click one to focus it. Each local Claude agent shows its context as "NN% used"
  (dimmed when the reading is older than 2 minutes).
- **dock-quotas**: Claude 5-hour and weekly quota as "% used", with reset time, age, and a stale mark.

Herdr's shipped `tabs` mod sits in the top bar. Only `config/dock.json` is meant to be synced between machines.
The generated `layouts/herdr-dock.json` is never committed.

## Install

Requires Node 22 or newer and the `herdr-app` CLI on your PATH.

```
npm install
npm run deploy
```

`npm run deploy` builds the `dock-*` mods, installs them into the Herdr app home, writes
`layouts/herdr-dock.json`, adds a `layout:herdr-dock` keys section (Ctrl+Alt+B runs `dock-core.cycle`, Ctrl+Alt+N runs `dock-core.right`, Ctrl+Alt+, runs `dock-core.config`), and runs
`herdr-app check` on each mod. It exits non-zero if any check fails. Run `npm test` for the unit tests.

- **App home.** Deploy writes to `~/.config/herdr-app`, or to `$HERDR_APP_HOME` when that is set. Pass
  `--app-home <dir>` to pick another one: `node scripts/deploy.mjs --app-home <dir>`. Add `--dry-run` to list what
  it would do without writing anything.
- **A key binding is skipped** (deploy still succeeds and says why) when `ctrl-alt-b` or `ctrl-alt-,` in `layout:herdr-dock` is
  already bound to something else, or when `keys.json` doesn't exist yet. Herdr writes `keys.json` on its first
  start: start Herdr once, then re-run `npm run deploy`.
- **Editing keys.json.** On upgrade, Herdr refreshes a `keys.json` you have never touched with its current default
  shortcuts. Any edit, including the section deploy adds, makes the file yours: new default shortcuts from later
  Herdr releases then have to be added by hand.
- **source.json.** Deploy writes `mods/dock-core/source.json`, which points dock-core at this repo's
  `config/dock.json` (and records this computer's hostname as a fallback). If you move or re-clone the repo, re-run
  `npm run deploy`.

## Switching layouts

```
herdr-app do layout.switch '{"name":"herdr-dock"}'
herdr-app do layout.switch '{"name":"main"}'
```

In Windows PowerShell 5.1 the inner quotes need escaping:

```powershell
herdr-app do layout.switch '{\"name\":\"herdr-dock\"}'
```

Or press Ctrl+Shift+L and pick the layout.

The keys section applies while the `herdr-dock` layout is active, so Ctrl+Alt+B works even when the left panel is
hidden.

## The right column

The right column holds the right region's mods with Herdr's Files/Changes panel under them, so the right side is
one column. The second button at the start of the tab bar, or Ctrl+Alt+N (`dock-core.right`), shows or hides it.

- Herdr's Files and Changes buttons at the end of the tab bar open and close the Files/Changes part. Opening one
  while the column is hidden shows the column.
- With no mods in the right region, closing Files/Changes closes the column, and showing the column opens
  Files/Changes on the last tab you used.
- Whether the column is shown, and whether Files/Changes is open and on which tab, is remembered per PC in
  Herdr's own state (`dock.right.shown`, `dock.panel`). It is never written to `config/dock.json`, and a
  config save or restart keeps it.
- The config's `right.hidden` (the dialog's right "shown" switch) is the default. Changing it applies once, the
  same way `left.mode` does.

## Panel modes

The left panel has three modes. Ctrl+Alt+B (or the top-bar toggle) cycles through them:

| Mode | What you see |
| --- | --- |
| `expanded` | Spaces, Agents and Quotas in full. |
| `icons` | A 48 px rail of feature icons. Click one to expand the panel with that feature tall and the others collapsed to headers. That focus lasts until the mode changes; Ctrl+Alt+B from a focused panel goes back to plain expanded. |
| `hidden` | No left panel. |

You can also run the commands directly: `herdr-app do dock-core.cycle`, `.expanded`, `.icons`, `.hidden`, and
`.reload` (re-read the config).

## Config

Edit `config/dock.json`. dock-core watches it and rewrites the layout live. An invalid config keeps the last good
layout and shows a red dot on the toggle, so a half-saved file never breaks your window.

```json
{
  "v": 1,
  "regions": {
    "top":    { "size": 42, "features": [ { "mod": "dock-core", "size": 76 }, { "mod": "tabs" } ] },
    "left":   { "size": 268, "mode": "expanded",
                "features": [ { "mod": "dock-header", "size": 46, "drag": true },
                              { "mod": "dock-spaces" }, { "mod": "dock-agents" }, { "mod": "dock-quotas", "size": 150 }, { "mod": "dock-footer", "size": 40 } ] },
    "right":  { "size": 360, "hidden": true, "features": [] },
    "bottom": { "size": 28,  "features": [ { "mod": "workspace-status" } ] }
  },
  "machines": { "my-hostname": { "regions": { "left": { "size": 320 } } } }
}
```

- Each region has a `size` in px, an optional `hidden`, and a list of `features`. The left region also has `mode`;
  `"hidden": true` on the left region means mode `hidden`. Changing `mode` in the config switches the panel to it.
- The top bar must contain `dock-core` and can't be hidden (the toggle, Ctrl+Alt+B and config errors live there).
  `dock-spaces`, `dock-agents` and `dock-quotas` can only be placed in the left region.
- A feature is `{ "mod": string, "props"?: object, "size"?: px, "drag"?: boolean }`. With no `size`, it gets
  weight 1 and shares the remaining space. With `"drag": true`, dragging the feature moves the window.
- The left panel starts with `dock-header` (46 px), like the header in Herdr's `main` layout: the Herdr
  brand and search, copied from Herdr's `workspace-chrome` without its collapse button. The left panel is
  toggled by the button at the start of the tab bar and by Ctrl+Alt+B. In icons mode the header shows the
  Herdr logo.
- The left panel ends with `dock-footer` (40 px): the Settings gear and the Dock layout button on the left and
  + Add machine on the right, on one line. A dot on the gear means an update is ready. In icons mode it shows the
  gear.
- `machines.<hostname>` deep-merges into the base config for that machine. Hostnames match case-insensitively.
  Objects merge key by key, arrays (`features`) replace whole, and scalars replace.

### Add a third-party mod to a region

Put the mod's id in a region's `features` and make sure the region is not hidden, or use the Dock layout dialog.
For example, to show Mission Control's GitHub panel at the top of the right column:

```json
"right": { "size": 360, "hidden": false, "features": [ { "mod": "mission-control-github" } ] }
```

Save the file. The panel appears with no other change. Files and Changes are already in the right column (see
above), so they don't need to be placed.

## Config UI

The "Dock layout" dialog edits the config without hand-editing JSON. Open it any of these ways:

- the layout button in the left panel footer (next to the Settings gear),
- `herdr-app do dock-core.config`,
- Ctrl+Alt+, while the `herdr-dock` layout is active.

Run the command again to close it.

- **Saves go to this PC only.** The dialog writes to `machines.<hostname>` in `config/dock.json`. The shared base
  config is never changed by it, so other machines keep their own layout.
- **Two views.** "By region" lists each region with its features; "By mod" lists each mod with where it is
  placed. Both edit the same draft, and nothing is written until you save.
- **Placement rules are enforced.** The same rules as in Config: the top bar keeps `dock-core`, and `dock-header`,
  `dock-footer`, `dock-spaces`, `dock-agents` and `dock-quotas` only go in the left region. An edit that would
  break them is refused, so the saved config always passes the same checks as a hand edit.
- **Reset this PC to shared** removes this PC's `machines.<hostname>` section, so it follows the shared config again.
- **If `dock.json` changed on disk since the dialog opened** (for example, you edited it by hand), the next Save or
  Reset writes nothing: it loads the file's new version, re-applies only the fields you changed on top (a region's
  size, its shown setting, the left mode, or a region's whole mod list), and shows "dock.json changed on disk; your
  edits were re-applied, check and save again". Check and save again. Everything you didn't change keeps the file's
  new values. If the new version isn't valid JSON or config, your edits are kept and the error is shown; fix the file
  and save again.
- **The first save may reformat `dock.json`.** The writer uses a stable format: 2-space indent, each feature
  object on one line. Content and key order are unchanged, so later saves give small diffs.

## Prerequisite: the Claude status-line cache

Context and quota numbers come from the Claude status-line cache,
`~/.claude/statusline-cache/claude-statusline.json`, plus the session records in `~/.claude/sessions/`. The cache
is written by your Claude Code status line: `~/.claude/statusline.ps1` calls `~/.claude/herdr-statusline-cache.py`.
Set that up before you expect numbers. Without it, Quotas shows "no data" and agent rows show no context figure.
That writer currently needs Python on Windows. A cross-platform writer is future work. The mods themselves contain
no Python.

## Known limitations

- macOS and Omarchy are untested. v1 was verified on Windows only.
- Per-agent context is available only for local Claude agents. Other and remote agents show no number.
- Third-party mods placed in the left panel are hidden in icons mode.
- Drag-resizes and collapses are machine-local and are not synced. They survive restarts, config edits and mode
  changes; a config edit to a size wins for that size.
- Layout regeneration re-applies the panel mode after a 400 ms wait, so you may see a brief flicker.
