// The Browser panel's control rows: Take over / Hand back, the sizes, Enlarge (or Close in the big window), and the
// handoff bar (the agent's message, Done, Cancel, Open in a real window). Drawing only: the panel passes what to
// show and what each button does.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { SIZES } from "../../shared/browser/panel.js";

// A small text button; disabled (dimmed, no click) while something runs.
export function button(t, id, label, onClick, { busy = false, primary = false, tip = null } = {}) {
  return div().id(id).flex_none().px(8).h(22).flex().items_center().rounded(4).text_size(11.5)
    .when(primary, (el) => el.bg(t.accent).text_color(t.background))
    .when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.foreground))
    .when(!!tip, (el) => el.tooltip(tip))
    .when(busy, (el) => el.opacity(0.5))
    .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }))
    .child(label);
}

// The row under the header. state: { control: "view" | "takeover" | "handoff", big, busy }.
// on: { takeOver, handBack, size(kind), enlarge, close }.
export function controlBar(t, state, on) {
  const busy = !!state.busy;
  const row = h_flex().flex_none().flex_wrap().gap(4).px(12).py(6).items_center().border_b(1).border_color(t.border);
  if (state.control === "view") {
    row.child(button(t, "browser-takeover", "Take over", on.takeOver, { busy, tip: "Use the page yourself; the agent waits until you hand back" }));
  } else if (state.control === "takeover") {
    row.child(button(t, "browser-handback", "Hand back", on.handBack, { busy, primary: true, tip: "Give the page back to the agent" }));
  }
  row.child(div().flex_none().w(6));
  for (const [kind, s] of Object.entries(SIZES)) {
    row.child(button(t, `browser-size-${kind}`, s.label, (cx) => on.size(kind, cx), { busy, tip: `This page in a new tab at ${kind} size` }));
  }
  row.child(div().flex_1());
  row.child(state.big
    ? button(t, "browser-close", "Close", on.close, { tip: "Close this window" })
    : button(t, "browser-enlarge", "Enlarge", on.enlarge, { tip: "The page in a big window" }));
  if (state.busy) row.child(div().flex_none().text_size(11).text_color(t.dim).child(state.busy));
  return row;
}

// The handoff bar: the agent's message and the person's answers (what runs shows in the row below).
// state: { message, windowOpen, busy }.
// on: { done, cancel, openWindow }.
export function handoffBar(t, state, on) {
  const busy = !!state.busy;
  return v_flex().flex_none().gap(6).px(12).py(8).bg(t.raised ?? t.background).border_b(1).border_color(t.working)
    .child(div().text_size(11).font_semibold().text_color(t.working).child("The agent needs you"))
    .child(div().text_size(12.5).text_color(t.foreground).child(state.message || "The agent asked for your help in this page."))
    .when(!!state.windowOpen, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Finish in the window, then press Done")))
    .child(h_flex().flex_wrap().gap(4).items_center()
      .child(button(t, "browser-done", "Done", on.done, { busy, primary: true, tip: "Tell the agent you're done" }))
      .child(button(t, "browser-cancel", "Cancel", on.cancel, { busy, tip: "Tell the agent you won't do it" }))
      .when(!state.windowOpen, (el) => el.child(button(t, "browser-window", "Open in a real window", on.openWindow,
        { busy, tip: "For captchas and passkeys: a real browser window on this page" }))));
}

// A line saying an action failed.
export const errorLine = (t, text) => div().flex_none().px(12).py(4).text_size(11.5).text_color(t.blocked).child(text);
