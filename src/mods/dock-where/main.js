// Where: the focused space's machine and branch, as Herdr's workspace-status shows them.
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
    return barRow(t)
      .gap(12)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer", true))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch, false)));
  }
}
