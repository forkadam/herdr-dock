// src/mods/dock-where/main.js
import { View, div, svg } from "gpui-kit";
import { h_flex as h_flex2 } from "gpui-base";
import { spaces, theme } from "herdr";

// src/mods/_bar.js
import { h_flex } from "gpui-base";
function barRow(t) {
  return h_flex().size_full().min_w(0).px(14).gap(16).items_center().overflow_hidden().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted);
}

// src/mods/dock-where/main.js
var label = (icon, text, fixed) => h_flex2().min_w(0).gap(6).items_center().when(fixed, (el) => el.flex_none()).child(svg(`mods/workspace-chrome/${icon}.svg`).size(13).flex_none()).child(div().min_w(0).truncate().child(text));
var Where = class extends View {
  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const machine = space?.machine ?? "This computer";
    const tip = space?.branch ? `${space.branch} on ${machine}` : machine;
    return barRow(t).id("dock-where").flex_1().tooltip(tip).gap(12).child(label(space?.machine ? "server" : "monitor", machine, true)).when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch, false)));
  }
};
export {
  Where as default
};
