// Based on Herdr's shipped workspace-chrome mod (installed.json main.js hash 2209012f93fc170c):
// its footer (props.footer) with Settings and Add machine. Faces follow the left panel mode:
// full rows, icon-only rows on the 48 px rail, and one compact row in a 32 px collapsed slot.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, shared, updates } from "herdr";
import { featureMode } from "../_feature.js";

const ITEMS = [
  { id: "settings", icon: "settings", label: "Settings", dim: false, action: () => run("app.settings") },
  { id: "machine", icon: "plus", label: "Add machine", dim: true, action: () => run("mod.open", { name: "machine-add" }) },
];

export default class DockFooter extends View {
  render() {
    const t = theme();
    const p = props();
    const face = featureMode(shared("dock.left.mode"), shared("dock.left.focus"), p?.dockFeature, p?.dockRegion);
    const ready = Boolean(updates()?.app?.ready);
    const dot = () => div().size(6).rounded_full().bg(t.accent);

    // Icon-only button, used on the rail and in the collapsed row.
    const iconButton = (item) => h_flex().id(item.id).relative().size(32).flex_none().items_center().justify_center()
      .rounded(8).tooltip(item.label).cursor_pointer()
      .text_color(item.dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click(item.action).child(svg(`mods/dock-footer/${item.icon}.svg`).size(14))
      .when(item.id === "settings" && ready, el => el.child(dot().absolute().top(5).right(6)));

    if (face === "icon") {
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).pt(4).pb(8).items_center()
        .children(ITEMS.map(iconButton));
    }
    if (face === "collapsed") {
      return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).gap(4).items_center()
        .children(ITEMS.map(iconButton));
    }
    const row = (item) => h_flex().id(item.id).h(28).px(8).gap(9).items_center().rounded(8)
      .text_color(item.dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
      .on_click(item.action).child(svg(`mods/dock-footer/${item.icon}.svg`).size(14)).child(item.label)
      .when(item.id === "settings" && ready, el => el.child(dot()));
    return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
      .children(ITEMS.map(row));
  }
}
