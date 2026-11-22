// Where: the focused space's machine and branch, as Herdr's workspace-status shows them. It takes the bar's free
// width (flex_1), so the branch shows in full unless the window is out of room.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, theme } from "herdr";
import { barRow } from "../_bar.js";

// The machine keeps its width; a long branch is the one cut short.
const label = (icon, text, fixed) => h_flex().min_w(0).gap(6).items_center().when(fixed, (el) => el.flex_none())
  .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13).flex_none())
  .child(div().min_w(0).truncate().child(text));

export default class Where extends View {
  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const machine = space?.machine ?? "This computer";
    // The full names, for a branch cut short.
    const tip = space?.branch ? `${space.branch} on ${machine}` : machine;
    return barRow(t)
      .id("dock-where")
      .flex_1()
      .tooltip(tip)
      .gap(12)
      .child(label(space?.machine ? "server" : "monitor", machine, true))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch, false)));
  }
}
