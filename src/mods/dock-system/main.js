// System: this PC's CPU and RAM use (dock-core's sample), at the bar's right edge. Hidden when the sample is
// missing or older than 30 s; a value at 90% or more turns the warning colour.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, shared } from "herdr";
import { barRow, WARN } from "../_bar.js";
import { SAMPLE_KEY } from "../../shared/system.js";

const MAX_AGE_MS = 30000;
const HOT = 90;

export default class System extends View {
  init(_props, cx) {
    cx.timer.every(5000, (cx) => cx.notify()); // hides a sample that stopped coming
  }

  render() {
    const t = theme();
    const s = shared(SAMPLE_KEY);
    const fresh = s && typeof s.cpu === "number" && typeof s.mem === "number" && Date.now() - s.at < MAX_AGE_MS;
    const value = (name, n) => h_flex().flex_none().gap(4).child(name)
      .child(div().text_color(n >= HOT ? WARN : t.muted).child(`${Math.round(n)}%`));
    const row = barRow(t).gap(12).justify_end();
    if (!fresh) return row;
    return row.child(value("CPU", s.cpu)).child(value("RAM", s.mem));
  }
}
