// Limits: the bottom bar's compact strip of usage limits, after nozikov/herdr-usage-limits (MIT). Per provider its
// icon, then each window short ("5h ▬| 15%", "wk", a model's name), with the time to reset from amber up. Resting the
// pointer on it opens the full panel: plan, one line per window, hover a line for the detail.
// It asks nothing itself: Quotas (left panel) collects the readings and shares them (dock.quotas.readings), so the
// claude CLI isn't asked twice.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { checking, knownAgents, shared, theme } from "herdr";
import { barRow } from "../_bar.js";
import { quotaGroups, stripItems } from "../dock-quotas/view.js";
import { groupHeaderEl, levelColor, providerFace, quotaBar, quotaRowEl } from "../dock-quotas/draw.js";

const READINGS_KEY = "dock.quotas.readings";

export default class Limits extends View {
  init(_props, cx) {
    this.icons = {};
    if (checking()) return;
    cx.spawn(async (cx) => {
      try {
        for (const a of await knownAgents()) if (a?.key && a.icon) this.icons[a.key] = { icon: a.icon, tint: Boolean(a.tint) };
        cx.notify();
      } catch (e) { console.log(`dock-limits: agent icons unavailable: ${e}`); }
    });
    // The time to reset counts down even when no new reading arrives.
    cx.timer.every(30000, (cx) => cx.notify());
  }

  item(t, it, key) {
    return h_flex().id(key).gap(5).flex_none().items_center().when(it.stale, (el) => el.opacity(0.55))
      .child(div().text_color(t.dim).child(it.short))
      .child(quotaBar(t, it, 26))
      .child(div().text_color(it.level === "ok" ? t.muted : levelColor(t, it.level)).child(it.usage ?? ""))
      .when(Boolean(it.reset), (el) => el.child(div().text_color(t.dim).child(`· ${it.reset}`)));
  }

  panel(t, groups) {
    let n = 0;
    return v_flex().id("dock-limits-panel").w(380).py(8).gap(2).rounded(10).bg(t.popover).border_1().border_color(t.border)
      .text_size(13).text_color(t.foreground)
      .children(groups.flatMap((g, gi) => [
        groupHeaderEl(t, g, gi, this.icons, { id: `limits-group-${gi}`, px: 14 }),
        ...g.rows.map((r) => quotaRowEl(t, r, `limits-row-${n++}`, { px: 14 })),
      ]))
      .child(div().px(14).pt(6).text_size(11).text_color(t.dim).child("Hover a line for its reset time, age and source."));
  }

  render() {
    const t = theme();
    const groups = quotaGroups(shared(READINGS_KEY) ?? {}, Date.now());
    const strips = stripItems(groups);
    const row = barRow(t).id("dock-limits").flex_1().gap(12);
    if (!strips.length) {
      return row.child(div().text_color(t.dim).tooltip("Usage limits appear here once Quotas (left panel) has a reading.").child("no limits yet"));
    }
    const strip = h_flex().id("dock-limits-strip").min_w(0).gap(12).items_center().overflow_hidden()
      .children(strips.flatMap((g, gi) => [
        ...(gi ? [div().w(1).h(12).flex_none().bg(t.border)] : []),
        h_flex().gap(8).flex_none().items_center()
          .child(providerFace(t, g, this.icons, 12))
          .children(g.items.map((it, i) => this.item(t, it, `limits-${g.id}-${i}`))),
      ]));
    return row.child(HoverCard.new("dock-limits-card").anchor("bottom_left").open_delay(250).close_delay(300)
      .trigger(strip).content(this.panel(t, groups)));
  }
}
