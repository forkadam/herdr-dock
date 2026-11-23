// The Pick and Notes bar under the controls: what to do, the picked elements with their note fields (and in Notes
// their intent, priority and a remove button), Copy and Send. Drawing only: the panel passes the state and actions.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { INTENTS, NOTES_MAX, PRIORITIES } from "../../shared/browser/feedback.js";
import { button } from "./controls.js";

function choice(t, id, values, current, onPick) {
  return h_flex().flex_none().gap(2).children(values.map((v) => div().id(`${id}-${v}`).px(6).h(18).flex().items_center()
    .rounded(4).text_size(10.5).cursor_pointer()
    .when(v === current, (e) => e.bg(t.accent).text_color(t.background))
    .when(v !== current, (e) => e.border_1().border_color(t.border).text_color(t.muted).hover((s) => s.bg(t.hover)))
    .on_click((_e, cx) => { cx.stop_propagation(); onPick(v, cx); })
    .child(v)));
}

function noteField(t, input) {
  return div().flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(6).border_1().border_color(t.border)
    .bg(t.background).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(Input.new(input).w_full().h(20).text_size(12).text_color(t.foreground));
}

const label = (it) => `${it.tag || "element"}${it.text ? ` "${it.text.slice(0, 40)}"` : ""}`;

// state: { picking: { kind, items } | null, inputs, busy, flash, elsewhere: "pick" | "notes" | null }.
// on: { send, copy, leave, remove(i), field(i, name, value) }.
export function pickBar(t, state, on) {
  const busy = !!state.busy;
  const bar = v_flex().flex_none().gap(6).px(12).py(8).border_b(1).border_color(t.accent);
  const p = state.picking;
  if (!p) {
    const what = state.elsewhere === "notes" ? "Notes" : "Pick";
    return bar.child(div().text_size(11.5).text_color(t.dim).child(`${what} is running in another copy of this panel.`))
      .child(h_flex().child(button(t, "browser-pick-leave", "Cancel", on.leave, { busy, tip: "End it and hand the page back; nothing is sent" })));
  }
  const items = p.items;
  if (p.kind === "pick") {
    const it = items[0];
    bar.child(div().text_size(11.5).text_color(t.dim).child(it
      ? `Picked ${label(it)}. Say what should change, then Send (Enter). Click another element to pick it instead.`
      : "Point at an element in the page and click it. The page doesn't get the click."));
    if (it) bar.child(div().truncate().text_size(11).text_color(t.muted).child(it.selector));
    if (it) bar.child(h_flex().gap(4).items_center().child(noteField(t, state.inputs[it.slot])));
  } else {
    bar.child(div().text_size(11.5).text_color(t.dim).child(items.length
      ? `${items.length} of ${NOTES_MAX}. Click more elements, write a note on each, then Send them together.`
      : `Click elements in the page (up to ${NOTES_MAX}); each gets a numbered badge and a note here.`));
    if (items.length) {
      bar.child(v_flex().id("browser-notes").max_h(320).overflow_y_scrollbar().gap(8).children(items.map((it, i) =>
        v_flex().gap(3)
          .child(h_flex().gap(6).items_center()
            .child(div().flex_none().min_w(18).h(18).px(4).rounded(9).bg(t.working).text_color(t.background).text_size(10.5)
              .font_semibold().flex().items_center().justify_center().child(String(i + 1)))
            .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.foreground).child(label(it)))
            .child(div().id(`browser-note-remove-${i}`).flex_none().px(5).h(18).flex().items_center().rounded(4).text_size(11)
              .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove this element")
              .on_click((_e, cx) => { cx.stop_propagation(); on.remove(i, cx); }).child("✕")))
          .child(div().truncate().text_size(10.5).text_color(t.dim).child(it.selector))
          .child(noteField(t, state.inputs[it.slot]))
          .child(h_flex().flex_wrap().gap(6).items_center()
            .child(choice(t, `browser-note-intent-${i}`, INTENTS, it.intent, (v, cx) => on.field(i, "intent", v, cx)))
            .child(choice(t, `browser-note-priority-${i}`, PRIORITIES, it.priority, (v, cx) => on.field(i, "priority", v, cx)))))));
    }
  }
  const row = h_flex().flex_wrap().gap(4).items_center()
    .child(button(t, "browser-pick-send", "Send", on.send, { busy: busy || !items.length, primary: true, tip: "Send to the agent as its next prompt, then hand the page back" }));
  if (p.kind === "notes") row.child(button(t, "browser-pick-copy", "Copy", on.copy, { busy: busy || !items.length, tip: "Copy the Design Feedback as Markdown" }));
  row.child(button(t, "browser-pick-leave", "Cancel", on.leave, { busy, tip: "Stop pointing and hand the page back; nothing is sent" }));
  if (state.flash) row.child(div().text_size(11).text_color(t.dim).child(state.flash));
  return bar.child(row);
}
