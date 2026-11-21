// Shared pieces for left-panel feature mods (bundled into each mod).
import { div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { setShared } from "herdr";

export { featureMode } from "./_feature-mode.js";

const RAIL_PX = 48;

// A 48 px column with the feature's icon centered at the top; the title is its tooltip.
export function iconRail(t, iconPath, title, onClick) {
  return v_flex().size_full().w(RAIL_PX).min_h(0).bg(t.chrome).items_center().pt(8)
    .child(div().id("dock-feature-icon").size(32).flex_none().flex().items_center().justify_center()
      .rounded(6).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(title)
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); })
      .child(svg(iconPath).size(16)));
}

// Ask dock-core to expand the panel with this feature tall and the others collapsed.
// Focus first: dock-core treats a focus set while icons/hidden as a pending request.
export function requestFocus(myId) {
  setShared("dock.left.focus", myId);
  setShared("dock.left.mode", "expanded");
}
