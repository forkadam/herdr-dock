# The work GitLab CI panel in the dock — design (short)

**Why.** Adam's work pipeline panel (`gitlab-ci`, in `~/Dev/Workspace/my-qnap-claude-tools/herdr-mods/gitlab-ci`: every
watched qif-gitlab project × branch, with Log / Retry / Open / Projects) opens only as a floating window on
Cmd+Ctrl+6. He wants it to sit in the dock. The Dock layout dialog skips it because it's an overlay mod
(`src/shared/inventory.js` `placeability`). And it must not break any machine that doesn't have the mod.

**Approach** (Adam picked "make it placeable", over leaving it a pop-up or merging it into herdr-dock's Pipelines):
- **herdr-dock**: an overlay mod whose `mod.json` says `"dock": true` is listed by the dialog and can be placed; other
  overlays are still skipped.
- **The guard (Adam: "make sure this doesn't break on other machines that don't have this mod")**: herdr-dock leaves
  out of the generated layout any feature whose mod isn't installed (no `<app home>/mods/<id>/mod.json`), at runtime
  (dock-core's reload) and at deploy. The placement also lives only in this Mac's `local.json` (the dialog never
  writes the shared `config/dock.json`), so other machines don't see it at all.
- **The work repo**: `gitlab-ci`'s `mod.json` gains `"dock": true` and the title **GitLab CI** (distinct from
  herdr-dock's Pipelines); an `icon.svg` for the rail (setup copies the whole folder); its compact (non-window) board
  checked at the right panel's width and fixed where it doesn't fit.
- **Cmd+Ctrl+6** stays the floating window (no herdr-dock command shows a given right-panel mod).

**Non-goals.** Anything QNAP-specific in herdr-dock; changing what the panel shows.

**Left to the builder.** The icon's drawing; the guard's exact shape (a pure filter in `config.js` used by
`planApply` and deploy); tests.
