// The bottom bar's look, shared by its items (bundled into each): Herdr's workspace-status row style.
import { h_flex } from "gpui-base";

export const WARN = "#d29922";

export function barRow(t) {
  return h_flex().size_full().min_w(0).px(14).gap(16).items_center().overflow_hidden()
    .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted);
}
