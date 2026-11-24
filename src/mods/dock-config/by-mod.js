// The "By mod" view: one row per placeable or placed mod with Off/Top/Left/Right/Bottom; "Show all mods"
// adds the rest, dimmed with why we think they don't belong in a region, but still placeable.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { applyEdit } from "../../shared/edit.js";
import { modRows } from "../../shared/inventory.js";
import { BROWSER_OFF_TIP } from "./browser-view.js";
import { segmented, tag, toggle } from "./ui.js";

const SEGMENTS = [["off", "Off"], ["top", "Top"], ["left", "Left"], ["right", "Right"], ["bottom", "Bottom"], ["pages", "Page"]];
const REASONS = {
  self: "this dialog",
  "hidden-name": "hidden folder",
  broken: "broken mod.json",
  helper: "used by other mods",
  overlay: "dialog or popup",
};

const names = (t, item) => [
  div().w(200).flex_none().truncate().child(item.title),
  div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(item.id),
];

function modRow(dlg, t, item, dimmed) {
  const s = dlg.session;
  const options = SEGMENTS.map(([value, text]) => {
    if (value === "off" && item.id === "dock-browser") return { value, label: text, enabled: false, tip: BROWSER_OFF_TIP };
    const error = applyEdit(s.draft, { type: "place", mod: item.id, region: value }).error;
    return { value, label: text, enabled: dlg.editable() && !error, tip: error };
  });
  return h_flex().id(`dc-mod-${item.id}`).h(34).px(4).gap(8).items_center().rounded(6).hover((st) => st.bg(t.hover))
    .children(names(t, item).map((el) => (dimmed ? el.opacity(0.5) : el)))
    .when(!item.installed, (el) => el.child(tag(t, "not installed")))
    .when(item.reason !== null, (el) => el.child(tag(t, REASONS[item.reason] ?? item.reason)))
    .child(segmented(t, `dc-seg-${item.id}`, options, item.region ?? "off",
      (region, cx) => dlg.act(cx, { type: "place", mod: item.id, region })));
}

export function byMod(dlg, t) {
  const { normal, others } = modRows(dlg.session.inventory);
  return [
    h_flex().h(36).gap(8).items_center()
      .child(div().flex_1().text_size(12).text_color(t.dim).child(`${normal.length} mods can be placed`))
      .child(div().text_size(12).text_color(t.muted).child("Show all mods"))
      .child(toggle(t, "dc-show-all", dlg.showAll, true, (on, cx) => { dlg.showAll = on; cx.notify(); })),
    v_flex().gap(1).children(normal.map((i) => modRow(dlg, t, i, false))),
    ...(dlg.showAll && others.length
      ? [v_flex().gap(1).pt(8).mt(6).border_t(1).border_color(t.border).children(others.map((i) => modRow(dlg, t, i, true)))]
      : []),
  ];
}
