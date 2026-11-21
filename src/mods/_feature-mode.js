// Pure: which face a left-panel feature shows (no herdr/gpui imports, so node --test can load it).
// "icon" in icons mode; "collapsed" (header only) while expanded with another feature focused;
// otherwise "full". dock-core keeps dock.left.focus while expanded and clears it on mode changes.
export function featureMode(sharedMode, focus, myId) {
  if (sharedMode === "icons") return "icon";
  if (sharedMode === "expanded" && focus != null && focus !== myId) return "collapsed";
  return "full";
}
