// The "By mod" view: one row per placeable mod with Off/Top/Left/Right/Bottom.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { applyEdit } from "../../shared/edit.js";
import { segmented, tag, toggle } from "./ui.js";

const SEGMENTS = [["off", "Off"], ["top", "Top"], ["left", "Left"], ["right", "Right"], ["bottom", "Bottom"]];
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

function placeableRow(dlg, t, item) {
  const s = dlg.session;
  const options = SEGMENTS.map(([value, text]) => {
    const error = applyEdit(s.draft, { type: "place", mod: item.id, region: value }).error;
    return { value, label: text, enabled: dlg.editable() && !error, tip: error };
  });
  return h_flex().id(`dc-mod-${item.id}`).h(34).px(4).gap(8).items_center().rounded(6).hover((st) => st.bg(t.hover))
    .children(names(t, item))
    .when(!item.installed, (el) => el.child(tag(t, "not installed")))
    .child(segmented(t, `dc-seg-${item.id}`, options, item.region ?? "off",
      (region, cx) => dlg.act(cx, { type: "place", mod: item.id, region })));
}

const otherRow = (t, item) => h_flex().id(`dc-mod-${item.id}`).h(30).px(4).gap(8).items_center().opacity(0.5)
  .children(names(t, item)).child(tag(t, REASONS[item.reason] ?? item.reason));

export function byMod(dlg, t) {
  const items = dlg.session.inventory;
  const placeable = items.filter((i) => i.reason === null);
  const others = items.filter((i) => i.reason !== null);
  return [
    h_flex().h(36).gap(8).items_center()
      .child(div().flex_1().text_size(12).text_color(t.dim).child(`${placeable.length} mods can be placed`))
      .child(div().text_size(12).text_color(t.muted).child("Show all mods"))
      .child(toggle(t, "dc-show-all", dlg.showAll, true, (on, cx) => { dlg.showAll = on; cx.notify(); })),
    v_flex().gap(1).children(placeable.map((i) => placeableRow(dlg, t, i))),
    ...(dlg.showAll && others.length
      ? [v_flex().gap(1).pt(8).mt(6).border_t(1).border_color(t.border).children(others.map((i) => otherRow(t, i)))]
      : []),
  ];
}
