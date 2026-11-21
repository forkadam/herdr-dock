# herdr-dock

A configurable dock layout for [Herdr](https://herdr.app): a top bar, a left panel, and optional right and
bottom regions around your main pane. It ships four mods:

- **dock-core**: the top-bar toggle. It cycles the left panel between expanded, icons and hidden, and it
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
`layouts/herdr-dock.json`, adds a `layout:herdr-dock` keys section (Ctrl+Alt+B runs `dock-core.cycle`), and runs
`herdr-app check` on each mod. It exits non-zero if any check fails. Run `npm test` for the unit tests.

- **App home.** Deploy writes to `~/.config/herdr-app`, or to `$HERDR_APP_HOME` when that is set. Pass
  `--app-home <dir>` to pick another one: `node scripts/deploy.mjs --app-home <dir>`. Add `--dry-run` to list what
  it would do without writing anything.
- **The key binding is skipped** (deploy still succeeds and says why) when `ctrl-alt-b` in `layout:herdr-dock` is
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
    "top":    { "size": 42, "features": [ { "mod": "dock-core", "size": 132 }, { "mod": "tabs" } ] },
    "left":   { "size": 268, "mode": "expanded",
                "features": [ { "mod": "dock-spaces" }, { "mod": "dock-agents" }, { "mod": "dock-quotas", "size": 150 } ] },
    "right":  { "size": 360, "hidden": true, "features": [] },
    "bottom": { "size": 28,  "hidden": true, "features": [] }
  },
  "machines": { "my-hostname": { "regions": { "left": { "size": 320 } } } }
}
```

- Each region has a `size` in px, an optional `hidden`, and a list of `features`. The left region also has `mode`;
  `"hidden": true` on the left region means mode `hidden`. Changing `mode` in the config switches the panel to it.
- The top bar must contain `dock-core` and can't be hidden (the toggle, Ctrl+Alt+B and config errors live there).
  `dock-spaces`, `dock-agents` and `dock-quotas` can only be placed in the left region.
- A feature is `{ "mod": string, "props"?: object, "size"?: px }`. With no `size`, it gets weight 1 and shares the
  remaining space.
- `machines.<hostname>` deep-merges into the base config for that machine. Hostnames match case-insensitively.
  Objects merge key by key, arrays (`features`) replace whole, and scalars replace.

### Add a third-party mod to a region

Put the mod's id in a region's `features` and make sure the region is not hidden. For example, to show Herdr's
shipped Files panel on the right:

```json
"right": { "size": 360, "hidden": false, "features": [ { "mod": "files" } ] }
```

Save the file. The panel appears with no other change.

## Prerequisite: the Claude status-line cache

Context and quota numbers come from the Claude status-line cache,
`~/.claude/statusline-cache/claude-statusline.json`, plus the session records in `~/.claude/sessions/`. The cache
is written by your Claude Code status line: `~/.claude/statusline.ps1` calls `~/.claude/herdr-statusline-cache.py`.
Set that up before you expect numbers. Without it, Quotas shows "no data" and agent rows show no context figure.
That writer currently needs Python on Windows. A cross-platform writer is future work. The mods themselves contain
no Python.

## Known limitations

- No config UI yet. Edit `config/dock.json`.
- macOS and Omarchy are untested. v1 was verified on Windows only.
- Per-agent context is available only for local Claude agents. Other and remote agents show no number.
- Third-party mods placed in the left panel are hidden in icons mode.
- Drag-resizes and collapses are machine-local and are not synced. They survive restarts, config edits and mode
  changes; a config edit to a size wins for that size.
- Layout regeneration re-applies the panel mode after a 400 ms wait, so you may see a brief flicker.
