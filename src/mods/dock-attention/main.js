// Attention: a bell at the far right of the bar, coloured by what's in the notification history — red when
// something needs the user, the accent colour for unread only, dim when nothing, with a dot when there's
// anything to see. Hovering says what; clicking
// opens the history (dock-core's notify.show reveals it and marks everything read).
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, shared } from "herdr";
import { notifyCommand } from "../_notify-command.js";
import { HISTORY_KEY, historyOf, counts } from "../../shared/notify.js";
import { attentionBell } from "./view.js";

export default class Attention extends View {
  render() {
    const t = theme();
    const bell = attentionBell(counts(historyOf(shared(HISTORY_KEY))));
    const color = bell.tone === "bad" ? t.blocked : bell.tone === "unread" ? t.accent : t.dim;
    return h_flex().id("dock-attention").size_full().items_center().justify_center()
      .bg(t.chrome).border_t(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(`${bell.tip} · click to open`)
      .on_click(() => notifyCommand("notify.show"))
      .child(div().relative().size(14)
        .child(svg("mods/dock-notifications/icon.svg").size(14).text_color(color))
        // A dot on the bell's top right whenever there's something to see; ringed in the bar colour so it
        // reads against the bell.
        .when(bell.dot, (el) => el.child(div().absolute().top(-2).right(-2).size(7).rounded_full()
          .bg(color).border_1().border_color(t.chrome))));
  }
}
