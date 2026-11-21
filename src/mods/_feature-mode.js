// Pure: which face a left-panel feature shows (no herdr/gpui imports, so node --test can load it).
// "icon" in icons mode; "collapsed" (header only) while expanded with another feature focused;
// otherwise "full". dock-core keeps dock.left.focus while expanded and clears it on mode changes.
// `region` is the block's props().dockRegion: outside the left panel the panel mode doesn't apply.
export function featureMode(sharedMode, focus, myId, region) {
  if (region !== "left") return "full";
  if (sharedMode === "icons") return "icon";
  if (sharedMode === "expanded" && focus != null && focus !== myId) return "collapsed";
  return "full";
}
