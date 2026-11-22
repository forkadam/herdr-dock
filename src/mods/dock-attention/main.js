// Attention: how many notifications need the user (red) and how many are unread (dim). Clicking opens the
// history (dock-core's notify.show reveals it and marks everything read).
import { View, div } from "gpui-kit";
import { theme, shared } from "herdr";
import { barRow } from "../_bar.js";
import { notifyCommand } from "../_notify-command.js";
import { HISTORY_KEY, historyOf, counts } from "../../shared/notify.js";
import { attentionText } from "./view.js";

export default class Attention extends View {
  render() {
    const t = theme();
    const parts = attentionText(counts(historyOf(shared(HISTORY_KEY))));
    return barRow(t).id("dock-attention").gap(10).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip("Open notifications")
      .on_click(() => notifyCommand("notify.show"))
      .children(parts.map((p) => div().flex_none().text_color(p.tone === "bad" ? t.blocked : t.dim).child(p.text)));
  }
}
