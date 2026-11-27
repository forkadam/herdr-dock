// src/mods/dock-footer/main.js
import { View, div as div2, svg as svg2 } from "gpui-kit";
import { h_flex, v_flex as v_flex2 } from "gpui-base";
import { theme, run, props, shared as shared2, updates } from "herdr";

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

// src/mods/dock-footer/main.js
var ITEMS = [
  { id: "settings", icon: "settings", label: "Settings", dim: false, action: () => run("app.settings") },
  { id: "layout", icon: "layout", label: "Dock layout", dim: false, action: () => run("mod.open", { name: "dock-config" }) },
  { id: "machine", icon: "plus", label: "Add machine", dim: true, action: () => run("mod.open", { name: "machine-add" }) }
];
var DockFooter = class extends View {
  render() {
    const t = theme();
    const p = props();
    const face = featureMode(shared2("dock.left.mode"), shared2("dock.left.focus"), p?.dockFeature, p?.dockRegion);
    const ready = Boolean(updates()?.app?.ready);
    const dot = () => div2().size(6).rounded_full().bg(t.accent);
    const iconButton = (item) => h_flex().id(item.id).relative().size(32).flex_none().items_center().justify_center().rounded(8).tooltip(item.label).cursor_pointer().text_color(item.dim ? t.dim : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(item.action).child(svg2(`mods/dock-footer/${item.icon}.svg`).size(14)).when(item.id === "settings" && ready, (el) => el.child(dot().absolute().top(5).right(6)));
    if (face === "icon") {
      return v_flex2().size_full().bg(t.chrome).border_t(1).border_color(t.border).items_center().justify_center().child(iconButton(ITEMS[0]));
    }
    if (face === "collapsed") {
      return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).gap(4).items_center().children(ITEMS.map(iconButton));
    }
    const [settings, layout, machine] = ITEMS;
    return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).items_center().justify_between().text_size(13).child(h_flex().gap(2).items_center().child(iconButton(settings)).child(iconButton(layout))).child(h_flex().id(machine.id).h(28).px(8).gap(9).items_center().rounded(8).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().on_click(machine.action).child(svg2(`mods/dock-footer/${machine.icon}.svg`).size(14)).child(machine.label));
  }
};
export {
  DockFooter as default
};
