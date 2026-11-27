// src/mods/dock-header/main.js
import { View, div as div2, image, svg as svg2 } from "gpui-kit";
import { h_flex, v_flex as v_flex2 } from "gpui-base";
import { theme, run, props, window, shared as shared2 } from "herdr";

// src/mods/_feature.js
import { div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { setShared, shared } from "herdr";

// src/mods/_feature-mode.js
function featureMode(sharedMode, focus, myId, region) {
  if (region !== "left") return "full";
  if (sharedMode === "icons") return "icon";
  if (sharedMode === "expanded" && focus != null && focus !== myId) return "collapsed";
  return "full";
}

// src/mods/dock-header/main.js
var LOGO = "frame/welcome/herdr.png";
var DockHeader = class extends View {
  button(id, label, action) {
    const t = theme();
    return div2().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const p = props();
    const face = featureMode(shared2("dock.left.mode"), shared2("dock.left.focus"), p?.dockFeature, p?.dockRegion);
    if (face === "icon") {
      return v_flex2().size_full().bg(t.chrome).items_center().justify_center().child(image(LOGO).size(20).rounded(5));
    }
    return h_flex().size_full().bg(t.chrome).pl(14).pr(10).gap(4).items_center().text_size(13.5).when(window()?.platform === "macos" && !window()?.fullscreen, (el) => el.pl(76)).child(h_flex().flex_1().gap(8).items_center().child(image(LOGO).size(20).rounded(5)).child(div2().font_semibold().text_color(t.foreground).child("Herdr"))).child(this.button("search", svg2("mods/dock-header/search.svg").size(15), () => run("mod.open", { name: "picker" })));
  }
};
export {
  DockHeader as default
};
