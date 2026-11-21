// Based on Herdr's shipped workspace-chrome mod (installed.json main.js hash 2209012f93fc170c):
// its header row only (brand + search). The collapse button is left out: herdr-dock's left panel is
// toggled by dock-core's button at the start of the tab bar and by Ctrl+Alt+B.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared } from "herdr";
import { featureMode } from "../_feature.js";

const LOGO = "frame/welcome/herdr.png";

export default class DockHeader extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }

  render() {
    const t = theme();
    const p = props();
    const face = featureMode(shared("dock.left.mode"), shared("dock.left.focus"), p?.dockFeature, p?.dockRegion);
    // The 48 px icon rail: just the logo, centered like the other features' icons.
    if (face === "icon") {
      return v_flex().size_full().bg(t.chrome).items_center().justify_center()
        .child(image(LOGO).size(20).rounded(5));
    }
    // Full and collapsed look the same: the row already fits the 32 px collapsed slot.
    return h_flex().size_full().bg(t.chrome).pl(14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen, el => el.pl(76))
      .child(h_flex().flex_1().gap(8).items_center().child(image(LOGO).size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr")))
      .child(this.button("search", svg("mods/dock-header/search.svg").size(15), () => run("mod.open", { name: "picker" })));
  }
}
