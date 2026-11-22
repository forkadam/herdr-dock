// System: this PC's CPU and RAM use (dock-core's sample) as a chip and a memory icon, each with its %. Hidden
// when the sample is missing or older than 30 s; a value at 90% or more turns the warning colour. Hovering one
// adds Herdr's own use (dock-core's herdr sample) to the system figure.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, shared } from "herdr";
import { barRow, WARN } from "../_bar.js";
import { SAMPLE_KEY, HERDR_KEY } from "../../shared/system.js";
import { systemTips } from "./view.js";

const MAX_AGE_MS = 30000;
const HOT = 90;

export default class System extends View {
  init(_props, cx) {
    cx.timer.every(5000, (cx) => cx.notify()); // hides a sample that stopped coming
  }

  render() {
    const t = theme();
    const s = shared(SAMPLE_KEY);
    const now = Date.now();
    const fresh = s && typeof s.cpu === "number" && typeof s.mem === "number" && now - s.at < MAX_AGE_MS;
    const row = barRow(t).gap(12).justify_end();
    if (!fresh) return row;
    const tips = systemTips(s, shared(HERDR_KEY), now);
    const value = (id, icon, n, tip) => h_flex().id(id).tooltip(tip).flex_none().gap(4).items_center()
      .text_color(n >= HOT ? WARN : t.muted)
      .child(svg(`mods/dock-system/${icon}.svg`).size(13).flex_none())
      .child(div().child(`${Math.round(n)}%`));
    return row.child(value("dock-system-cpu", "cpu", s.cpu, tips.cpu))
      .child(value("dock-system-mem", "memory", s.mem, tips.mem));
  }
}
