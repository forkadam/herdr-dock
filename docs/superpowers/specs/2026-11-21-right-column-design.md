# herdr-dock right panel and rail — design (short)

Date: 2026-11-21. It replaces the earlier "one right column" iteration, in which every right mod was stacked
vertically with Herdr's Files/Changes panel underneath.

## Intent

The user wants the right side to show one mod at a time, switched from a vertical icon rail on the far right. A
stacked column doesn't work for them: third-party mods such as GitHub stay pinned at the top, and every newly
added mod is appended underneath.

Files and Changes become ordinary right mods. Herdr's own Files/Changes buttons in the tab bar go away. The
right-panel toggle sits in the top bar right beside "+".

## Approaches

- **Chosen: a vertical rail on the far right.** A strip at the top of the panel was the other option. It was
  rejected because many mods would overflow it, and it would be hidden together with the panel.
- **Chosen: copy Herdr's `tabs` mod as `dock-tabs`.** Its "+" lives inside that mod. In the copy, the
  Files/Changes buttons and their per-space panel restore are replaced by our right-panel button. Keeping `tabs`
  is not an option: its buttons drive ids (`panel`, `panel-body`) that no longer exist, and its per-space restore
  fights the per-PC state.

## Design

- **Layout** (`buildLayout(merged, state)`):
  - `dock-work` holds `[dock-top, dock-mid, dock-bottom]`.
  - `dock-mid` is a row of `[dock-body, dock-rail]`. `dock-body` (padding 8, gap 8) holds `[dock-main, dock-right]`.
  - `dock-right` is a column with the region's `size`, min 280 and max 900. It is hidden unless shown. It holds
    the stack `dock-right-stack`, whose children are the right feature blocks (`dock-right-<i>-<mod>`) and whose
    `active` is the selected block.
  - `dock-rail` is a 40 px block running the mod `dock-rail`.
  - When the right region has no mods, there is neither a panel nor a rail.
- **State per PC.** These are shared keys, which Herdr keeps in this PC's `shared.json`, never in git:
  - `dock.right.shown` (boolean). The config's `right.hidden` is the default, and a config change to it applies
    once (`dock.right.configHidden`), as `left.mode` does.
  - `dock.right.active`: the mod id showing. A missing or unknown id means the first mod.
- **Rail** (`dock-rail`, a new mod):
  - One icon per right mod, in config order, scrolling when there are many.
  - Icons: `files` and `changes` use Herdr's own svgs; `dock-*` mods use their manifest icon; any other mod uses
    `mods/<id>/icon.svg` when that file exists, otherwise a letter badge. The tooltip is the `mod.json` title, or
    the mod id.
  - Clicking a mod that isn't showing makes it active and shows the panel. Clicking the mod that is showing
    hides the panel.
- **dock-tabs.** A copy of Herdr's `tabs` (hash recorded in the file header):
  - The Files/Changes buttons and `syncPanel` are removed.
  - After "+" comes the right-panel button, which toggles `dock.right.shown`. It is hidden when the right region
    has no mods.
  - It replaces `tabs` in the default top bar.
- **dock-core:**
  - Back to just the left button, 44 px wide.
  - The command `dock-core.right` toggles the panel, bound to Ctrl+Alt+N.
  - On every render it brings the live `dock-right` (shown or hidden) and the stack's active child in line with
    the shared state.
  - Newly placed right mods show the panel with the first new mod active.
  - Layout rewrites, both dock-core's and deploy's, are built with this PC's state.
- **Default config:** `top: [dock-core 44, dock-tabs]`, `right: { size 360, hidden true, features [files, changes] }`.
- **Dialog:** `dock-rail` is not placeable.

## Constraints

- Per-PC state never goes into `config/dock.json`. The user's uncommitted `machines.<host>` section is never
  committed; only base-config lines are staged.
