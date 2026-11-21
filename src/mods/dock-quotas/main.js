// Agent quotas: the Claude account's 5-hour and weekly usage windows, from the statusline cache.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, props, checking, home, readTextFile, watchFolder } from "herdr";
import { featureMode, iconRail, requestFocus } from "../_feature.js";
import { parseStatusline } from "../../shared/claude.js";
import { slashPath } from "../../shared/path.js";
import { quotaRows, iconBadge, barLevel } from "./view.js";

const REFRESH_MS = 30000;
// A watch that resolves with no changed paths waits this long before re-arming (no tight loop).
const EMPTY_WATCH_MS = 1000;
const WARN = "#d29922";
const HIGH = "#f85149";

export default class Quotas extends View {
  init(_props, cx) {
    this.statusline = null;
    if (checking()) return;
    cx.timer.every(REFRESH_MS, (cx) => this.reload(cx));
    const dir = slashPath(home()) + "/.claude/statusline-cache";
    this.reload(cx);
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const changed = await watchFolder(dir);
          if (!changed?.length) { await cx.sleep(EMPTY_WATCH_MS); continue; }
          this.reload(cx);
        }
      } catch (e) {
        console.log(`dock-quotas: watch ended, using the timer: ${e}`);
      }
    });
  }

  // One read at a time; a request meanwhile runs once more after it.
  reload(cx) {
    if (this.reading) { this.again = true; return; }
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        do {
          this.again = false;
          const text = await readTextFile(slashPath(home()) + "/.claude/statusline-cache/claude-statusline.json").catch(() => null);
          this.statusline = parseStatusline(text, Date.now());
          cx.notify();
        } while (this.again);
      } catch (e) {
        console.log(`dock-quotas: read failed: ${e}`);
        this.statusline = null;
        cx.notify();
      } finally {
        this.reading = false;
      }
    });
  }

  header(t, onTitle) {
    const title = div().text_size(11.5).font_medium().text_color(t.dim).child("Quotas");
    return h_flex().px(16).h(onTitle ? 31 : 41).pt(onTitle ? 0 : 14).pb(onTitle ? 0 : 5).flex_none().items_center()
      .child(onTitle
        ? title.id("dock-quotas-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Quotas").on_click(() => onTitle())
        : title);
  }

  row(t, r, i) {
    const color = { ok: t.accent, warn: WARN, high: t.blocked ?? HIGH }[barLevel(r.percent ?? 0)];
    const pct = Math.max(0, Math.min(100, r.percent ?? 0));
    return v_flex().id(`quota-${i}`).px(16).py(4).gap(3).flex_none().tooltip(r.tooltip)
      .when(r.stale, (el) => el.opacity(0.55))
      .child(h_flex().items_center().gap(6)
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(r.label))
        .when(r.stale, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child("stale")))
        .child(div().flex_none().text_size(12).text_color(r.percent == null ? t.dim : t.muted).child(r.value)))
      .when(r.percent != null, (el) => el.child(div().w_full().h(4).rounded(2).bg(t.border).overflow_hidden()
        .child(div().w(`${pct}%`).h(4).rounded(2).bg(color))))
      .child(div().truncate().text_size(11).text_color(t.dim).child(r.detail));
  }

  render(cx) {
    const t = theme();
    const myId = props()?.dockFeature ?? "dock-quotas";
    const face = featureMode(shared("dock.left.mode"), shared("dock.left.focus"), myId, props()?.dockRegion);
    if (face === "icon") {
      const b = iconBadge(this.statusline);
      const rail = iconRail(t, "mods/dock-quotas/icon.svg", "Quotas", () => requestFocus(myId));
      if (!b) return rail;
      const p = parseInt(b.text, 10);
      const color = barLevel(p) === "ok" ? t.muted : barLevel(p) === "warn" ? WARN : (t.blocked ?? HIGH);
      return rail.child(div().id("quota-badge").text_size(10).text_color(color)
        .when(b.stale, (el) => el.opacity(0.55))
        .tooltip(b.stale ? `${p}% used · stale` : `${p}% used`)
        .child(b.text));
    }
    if (face === "collapsed") {
      return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
        .child(this.header(t, () => requestFocus(myId)));
    }
    const rows = quotaRows(this.statusline, Date.now());
    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .child(this.header(t, null))
      .children(rows.map((r, i) => this.row(t, r, i)));
  }
}
