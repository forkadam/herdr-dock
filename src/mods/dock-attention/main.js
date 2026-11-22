// Attention: a bell at the far right of the bar, coloured by what's in the notification history — red when
// something needs the user, the accent colour for unread only, dim when nothing. Hovering says what; clicking
// opens the history (dock-core's notify.show reveals it and marks everything read).
import { View, svg } from "gpui-kit";
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
      .child(svg("mods/dock-notifications/icon.svg").size(14).text_color(color));
  }
}
