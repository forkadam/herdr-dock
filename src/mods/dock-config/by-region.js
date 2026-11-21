// The "By region" view: each region's size and visibility, its mods in order, and "+ Add mod".
import { div } from "gpui-kit";
import { h_flex, v_flex, NumberInput, Popover } from "gpui-base";
import { allowedRegions } from "../../shared/edit.js";
import { icon, iconButton, segmented, tag, toggle } from "./ui.js";

const LEFT_MODES = [["expanded", "expanded"], ["icons", "icons"], ["hidden", "hidden"]];
const LABEL_W = 64;

const label = (t, text) => div().flex_none().text_size(12).text_color(t.dim).child(text);

function sizeInput(dlg, t, region) {
  const step = (h) => h_flex().w(18).h(11).items_center().justify_center().text_color(t.muted)
    .cursor_pointer().hover((s) => s.text_color(t.foreground)).child(icon(h).size(10));
  return NumberInput.new(dlg.sizes[region]).controls_right().disabled(!dlg.editable())
    .flex().flex_row().items_center().w(84).h(26).pl(8).pr(2).rounded(6).bg(t.background).border_1().border_color(t.border)
    .text_size(12.5)
    .on_step((action, cx) => dlg.step(region, action === "increment" ? 1 : -1, cx))
    .decrement_button(step("chevron-down"))
    .increment_button(step("chevron-up"));
}

function regionControls(dlg, t, region) {
  const r = dlg.session.draft.regions[region];
  const on = dlg.editable();
  const row = h_flex().h(32).gap(10).items_center()
    .child(div().w(LABEL_W).flex_none().text_size(11.5).font_semibold().text_color(t.muted).child(region.toUpperCase()))
    .child(label(t, "size")).child(sizeInput(dlg, t, region));
  if (region === "right" || region === "bottom") {
    // The right panel is shown or hidden per PC (the top-bar button, Ctrl+Alt+N); this switch is the default.
    const text = region === "right" ? "shown by default" : "shown";
    return row.child(label(t, text)).child(toggle(t, `dc-shown-${region}`, !r.hidden, on,
      (shown, cx) => dlg.act(cx, { type: "hidden", region, value: !shown })));
  }
  if (region === "left") {
    return row.child(label(t, "start as")).child(segmented(t, "dc-mode",
      LEFT_MODES.map(([value, text]) => ({ value, label: text, enabled: on })), r.mode,
      (value, cx) => dlg.act(cx, { type: "mode", value })));
  }
  return row;
}

function featureRow(dlg, t, region, list, i) {
  const f = list[i];
  const item = dlg.item(f.mod);
  const on = dlg.editable();
  const pinned = (m) => region === "top" && m === "dock-core";
  const canUp = on && i > 0 && !pinned(f.mod) && !pinned(list[i - 1].mod);
  const canDown = on && i < list.length - 1 && !pinned(f.mod) && !pinned(list[i + 1].mod);
  const controls = f.mod === "dock-core"
    ? [h_flex().id("dc-lock").size(22).items_center().justify_center().text_color(t.dim)
        .tooltip("dock-core stays first in the top bar").child(icon("lock").size(12))]
    : [
        iconButton(t, `dc-up-${region}-${i}`, "chevron-up", "Move up", canUp, (_e, cx) => dlg.act(cx, { type: "move", region, index: i, delta: -1 })),
        iconButton(t, `dc-down-${region}-${i}`, "chevron-down", "Move down", canDown, (_e, cx) => dlg.act(cx, { type: "move", region, index: i, delta: 1 })),
        iconButton(t, `dc-off-${region}-${i}`, "x", "Turn off", on, (_e, cx) => dlg.act(cx, { type: "place", mod: f.mod, region: "off" })),
      ];
  return h_flex().id(`dc-row-${region}-${f.mod}`).h(28).pl(LABEL_W + 10).pr(4).gap(8).items_center().rounded(6)
    .hover((s) => s.bg(t.hover))
    .child(div().w(200).flex_none().truncate().child(item?.title ?? f.mod))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(f.mod))
    .when(item && !item.installed, (el) => el.child(tag(t, "not installed")))
    .child(h_flex().flex_none().gap(2).children(controls));
}

function addMod(dlg, t, region) {
  const trigger = (enabled) => h_flex().id(`dc-add-${region}-trigger`).h(26).px(8).gap(6).items_center().rounded(6)
    .text_size(12.5).text_color(t.muted)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .when(!enabled, (el) => el.opacity(0.4))
    .child(icon("plus").size(12)).child("Add mod").child(icon("chevron-down").size(11));
  const wrap = (el) => h_flex().pl(LABEL_W + 6).child(el);
  if (!dlg.editable()) return wrap(trigger(false));
  const s = dlg.session;
  const candidates = s.inventory.filter((i) => i.reason === null && i.region !== region && allowedRegions(i.id).includes(region));
  const rows = candidates.map((i) => h_flex().id(`dc-add-${region}-${i.id}`).h(28).px(8).gap(8).items_center().rounded(6)
    .cursor_pointer().hover((st) => st.bg(t.hover))
    .on_click((_e, cx) => { dlg.addOpen = null; dlg.act(cx, { type: "place", mod: i.id, region }); })
    .child(div().flex_1().min_w(0).truncate().child(i.title))
    .child(div().flex_none().text_size(11.5).text_color(t.dim).child(i.region ? `in ${i.region}` : i.id)));
  const content = v_flex().id(`dc-add-${region}-list`).w(280).max_h(300).overflow_y_scrollbar().p(4).gap(1)
    .rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(12.5).text_color(t.foreground)
    .children(rows.length ? rows : [div().p(8).text_color(t.dim).child("Every mod that fits here is already in it")]);
  return wrap(Popover.new(`dc-add-${region}`).open(dlg.addOpen === region)
    .on_open_change((open, cx) => { dlg.addOpen = open ? region : null; cx.notify(); })
    .trigger(trigger(true)).content(content));
}

export function byRegion(dlg, t) {
  const regions = dlg.session.draft.regions;
  return ["top", "left", "right", "bottom"].map((region) => {
    const list = regions[region].features;
    return v_flex().gap(2).py(8).border_b(1).border_color(t.border)
      .child(regionControls(dlg, t, region))
      .children(list.map((_f, i) => featureRow(dlg, t, region, list, i)))
      .when(!list.length, (el) => el.child(div().pl(LABEL_W + 10).h(24).text_size(12).text_color(t.dim).child("no mods")))
      .child(addMod(dlg, t, region));
  });
}
