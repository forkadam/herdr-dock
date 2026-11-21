# herdr-dock right column — design (short)

Date: 2026-11-21. Builds on the dock design and the config UI.

## Intent

The right side should be one column, not two:
- Today the dock's right region (for example GitHub) and Herdr's Files/Changes panel sit side by side, which gives
  four columns.
- The user wants Files/Changes inside the right region, and a button to show or hide the whole column.
- Whether the column is open is remembered per PC, like the left panel's mode, and is never written to the git
  config.

## Approaches

- **A (chosen).** Herdr's Files/Changes panel lives inside the right column, stacked under the right region's
  mods. One toggle shows or hides the column.
- **B (rejected).** Keep four columns and give Files/Changes its own per-PC memory.

## Design

- **Layout** (`buildLayout`):
  - `dock-right` is always built.
  - Its children are the right region's feature blocks, then Herdr's `panel`.
  - `panel` contains the `panel-body` stack with `files` and `changes`, the ids Herdr's tab bar buttons drive.
    It has weight 1 and is hidden until opened.
  - `panel` is no longer a child of `dock-body`.
- **State per PC.** State lives in shared keys, which Herdr keeps in this PC's `shared.json`, not in git:
  - `dock.right.shown` (boolean). The config's `right.hidden` is the default. A config change to it wins once,
    the same way `left.mode` works (`dock.right.configHidden` records the last value applied).
  - `dock.panel` = `{ shown, active }`, recorded from the live layout.
  - When dock-core rewrites the layout (after a config save, a deploy or a restart), it builds the column, the
    panel and the active tab from these keys. Saving a layout change no longer closes Files/Changes.
- **Rules** (pure, tested, in `src/shared/panel.js`):
  - Opening Files or Changes from the tab bar while the column is hidden shows the column.
  - Closing Files/Changes when the right region has no mods hides the column (no empty column).
  - Showing the column when the region has no mods opens Files/Changes on its last tab (default `files`).
- **Button.** dock-core draws a second button, the right-panel icon, beside the left-panel button:
  - Tooltip: "Right panel (Ctrl+Alt+N)".
  - The command is `dock-core.right`.
  - dock-core's default top width goes from 44 to 76 px in `DEFAULT_CONFIG` and the base `config/dock.json`.
- **Key.** Deploy binds `ctrl-alt-n` to `dock-core.right` in `layout:herdr-dock`, with the same skip rules as the
  other keys. It is currently unbound.
- **Dialog.** The right region's "shown" switch keeps editing the config default.

## Constraints

- Per-PC state never goes into `config/dock.json`.
- The user's uncommitted `machines.forkadam-pc` section in `config/dock.json` is not committed. Only the base
  `dock-core` size change is staged, hunk by hunk.

## Left to the builder

- Exact icon states (filled when shown), and the behavior of the 400 ms re-apply timing.
