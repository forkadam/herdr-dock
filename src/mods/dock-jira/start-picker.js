// The Start / Finish picker, drawn over the Jira page: "Start <key> in…" (or "Finish <key> in…"), the folders this
// computer's spaces work in (start-in.js pickerChoices: a folder's last part, its path dimmed, the spaces in it),
// then Here and Other folder…, and the Remember for this ticket box; under the title, one dim line when a plain Start
// or Finish had a folder it couldn't use (pickerReason). `page` is the Jira view: it keeps the state
// (`page.picker`, `page.pickerFocus`) and acts: pickEntry(i, cx), pickerKeyDown(e, cx), toggleRemember(cx),
// closePicker(cx). Arrows move, Enter picks; Escape or a press outside the box closes it and starts nothing.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { fitHeight, textHeight } from "../../shared/fit-height.js";

const SCRIM = "#00000059";
const BOX_W = 540;
const ROWS_MAX_H = 300; // the folders' list height at most (it scrolls past that)
const NO_SPACE = "No space on this computer is working in a folder yet.";
const ICONS = { folder: "mods/workspace-chrome/folder.svg", here: "mods/workspace-chrome/terminal.svg", other: "mods/workspace-chrome/folder-plus.svg" };

export function startPicker(page, t) {
  const p = page.picker;
  const n = p.rows.length;
  const verb = p.action === "finish" ? "Finish" : "Start";
  // One entry: the rows' index `i` (the rows, then Here, then Other folder…), as the keys count them.
  const entry = (i, icon, label, path, spaces) => h_flex().id(`jira-pick-${i}`).h(34).px(10).gap(10).flex_none().items_center().rounded(6)
    .cursor_pointer().bg(i === p.selected ? t.selected : t.popover).hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => page.pickEntry(i, cx))
    .child(svg(icon).size(14).flex_none().text_color(t.dim))
    .child(div().flex_none().max_w(180).truncate().text_size(12.8).text_color(t.foreground).child(label))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(path ?? ""))
    .when(Boolean(spaces), (el) => el.child(div().flex_none().max_w(150).truncate().text_size(11).text_color(t.muted).child(spaces)));
  const rows = n
    ? p.rows.map((r, i) => entry(i, ICONS.folder, r.label, r.path, r.spaces.join(", ")))
    : [div().px(10).py(8).text_size(12).text_color(t.dim).child(NO_SPACE)];
  // The folders' list gets a definite height (as tall as it draws, ROWS_MAX_H at most) and scrolls in it: a list sized
  // only by a max-height doesn't scroll in Herdr (src/shared/fit-height.js). Rows are 34 with 1 between; the empty line
  // is px 10, py 8 (12px) in the box less its padding 6 each side.
  const rowsHeight = fitHeight({ rows: n, rowH: 34, gap: 1, max: ROWS_MAX_H,
    extra: n ? 0 : textHeight(NO_SPACE, { width: BOX_W - 12 - 20, size: 12 }) + 16 });
  const line = () => div().h(1).mx(6).my(3).flex_none().bg(t.border);
  const tick = p.remember;
  const remember = h_flex().id("jira-pick-remember").gap(8).items_center().cursor_pointer()
    .tooltip(`${p.issue.key}'s next Start and Finish open in the folder picked, without asking`)
    .on_click((_e, cx) => page.toggleRemember(cx))
    .child(div().size(14).flex_none().flex().items_center().justify_center().rounded(3).border_1()
      .border_color(tick ? t.accent : t.border).bg(tick ? t.accent : t.background)
      .when(tick, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(11).text_color(t.accent_foreground ?? t.background))))
    .child(div().text_size(12).text_color(t.foreground).child("Remember for this ticket"));
  const box = v_flex().id("jira-start-picker").track_focus(page.pickerFocus).on_key_down((e, cx) => page.pickerKeyDown(e, cx))
    // A press inside the box is the box's: it never reaches the scrim (which closes) or the page under it.
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .w(BOX_W).max_w_full().p(6).gap(1).rounded(10).bg(t.popover).border_1().border_color(t.border).text_color(t.foreground)
    .child(h_flex().h(34).px(10).gap(8).flex_none().items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_semibold().child(`${verb} ${p.issue.key} in…`))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
    .when(Boolean(p.reason), (el) => el.child(div().px(10).pb(4).flex_none().truncate().text_size(11.5).text_color(t.dim).child(p.reason ?? "")))
    .child(v_flex().flex_none().h(rowsHeight).min_h(0)
      .child(v_flex().id("jira-start-picker-rows").flex_1().min_h(0).overflow_y_scrollbar().gap(1).children(rows)))
    .child(line())
    .child(entry(n, ICONS.here, "Here", p.here?.path ?? "where the focused terminal is"))
    .child(entry(n + 1, ICONS.other, "Other folder…", p.choosing ? "Choosing in the folder dialog…" : ""))
    .child(line())
    .child(h_flex().h(32).px(10).gap(8).flex_none().items_center()
      .child(remember)
      .child(div().flex_1())
      .child(div().flex_none().text_size(11).text_color(t.dim).child("↑ ↓ to move · Enter to pick")));
  // Over the whole page: a press outside the box closes the picker, and nothing under it gets that press.
  return v_flex().id("jira-start-picker-scrim").absolute().inset_0().items_center().pt(64).px(16).bg(SCRIM)
    .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); page.closePicker(cx); })
    .child(box);
}
