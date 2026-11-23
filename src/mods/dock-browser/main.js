// Browser: the page an agent is driving with `browse`, in the right panel. This is the skeleton: it draws only the
// empty state; the live view comes with the later tasks.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";

export default class Browser extends View {
  render(_cx) {
    const t = theme();
    return v_flex().id("dock-browser").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(div().p(14).text_size(12.5).text_color(t.dim).child("No page yet. The agent opens one with browse open."));
  }
}
