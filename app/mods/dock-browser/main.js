// src/mods/dock-browser/main.js
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";
var Browser = class extends View {
  render(_cx) {
    const t = theme();
    return v_flex().id("dock-browser").size_full().min_h(0).bg(t.background).text_color(t.foreground).child(div().p(14).text_size(12.5).text_color(t.dim).child("No page yet. The agent opens one with browse open."));
  }
};
export {
  Browser as default
};
