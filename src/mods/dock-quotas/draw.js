// How a quota window and a provider are drawn: shared by Quotas (the left panel) and the bottom-bar strip's hover
// panel (dock-limits), so the two always look the same.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { barLevel } from "./view.js";

export const WARN = "#d29922";
export const HIGH = "#f85149";

export const levelColor = (t, level) => ({ ok: t.accent, warn: WARN, high: t.blocked ?? HIGH })[level] ?? t.accent;

// A provider's icon from Herdr's agent table (icons: agent key -> { icon, tint }), else its first letter.
export function providerFace(t, g, icons, size = 13) {
  const ic = icons?.[g.agent];
  if (ic) return ic.tint ? svg(ic.icon).size(size).text_color(t.muted) : image(ic.icon).size(size);
  return div().size(size).flex().items_center().justify_center().text_size(size - 3).font_semibold().text_color(t.dim).child(g.title.slice(0, 1));
}

// A bar with its fill and the pace tick (how much of the window's time has passed: a fill past it is being used up
// too fast). `w`: a width (px) or null to fill the space.
export function quotaBar(t, r, w = null) {
  const level = barLevel(r.percent ?? 0);
  const pct = Math.max(0, Math.min(100, r.percent ?? 0));
  return div().h(4).relative().rounded(2).bg(t.border)
    .when(w == null, (el) => el.flex_1().min_w(24)).when(w != null, (el) => el.w(w).flex_none())
    .when(r.percent != null, (bar) => bar.child(div().w(`${pct}%`).h(4).rounded(2).bg(levelColor(t, level))))
    .when(r.pace != null, (bar) => bar.child(div().absolute().top(-2).left(`${Math.round(r.pace * 100)}%`).w(2).h(8).rounded(1).bg(t.foreground).opacity(0.7)));
}

export function groupHeaderEl(t, g, i, icons, { id = `quota-group-${i}`, px = 16 } = {}) {
  return h_flex().id(id).px(px).pt(i ? 8 : 2).pb(1).gap(6).flex_none().items_center()
    .child(providerFace(t, g, icons)).child(div().text_size(11.5).font_medium().text_color(t.muted).child(g.title))
    .when(Boolean(g.plan), (el) => el.child(div().px(5).rounded(4).bg(t.border).text_size(10).text_color(t.muted).child(g.plan)));
}

// One line per window: label, bar, usage, time to reset; the rest is in its tooltip.
export function quotaRowEl(t, r, id, { px = 16 } = {}) {
  const level = barLevel(r.percent ?? 0);
  return h_flex().id(id).px(px).h(24).gap(8).flex_none().items_center().tooltip(r.tooltip)
    .when(r.stale, (el) => el.opacity(0.55))
    .child(div().w(92).flex_none().truncate().text_size(12).text_color(t.foreground).child(r.label))
    .child(quotaBar(t, r))
    .child(div().w(34).flex_none().flex().justify_end().text_size(12)
      .text_color(r.percent == null ? t.dim : level === "ok" ? t.muted : levelColor(t, level)).child(r.usage ?? r.value))
    .child(div().w(46).flex_none().flex().justify_end().text_size(11).text_color(t.dim).child(r.stale ? "stale" : r.reset ?? ""));
}
