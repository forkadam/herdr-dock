// The Browser section of the Dock layout dialog, below the Updates strip: the browser's state with Turn on, Turn off
// or Set up, the Chrome to use (while off) and the production hosts (while on). It draws browser-view.js's model;
// main.js holds the status, the choice and the actions. A read-only dialog shows the state only.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { chosenChrome, chromeChoices } from "./browser-view.js";
import { button } from "./ui.js";

const HOSTS_NOTE = "Agents get a warning on these sites; nothing is blocked.";

function chromeRow(dlg, t, choices, picked, enabled) {
  return h_flex().gap(10).items_center().min_h(24)
    .child(div().flex_none().text_color(t.muted).child("Chrome:"))
    .children(choices.map((c, i) => {
      const on = c.value === picked;
      return h_flex().id(`dc-chrome-${i}`).flex_none().h(22).px(4).gap(6).items_center().rounded(5)
        .text_color(on ? t.foreground : t.muted)
        .when(enabled && !on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => dlg.pickChrome(c.value, cx)))
        .when(!enabled, (el) => el.opacity(0.5))
        .child(div().flex_none().text_color(on ? t.accent : t.dim).child(on ? "●" : "○"))
        .child(c.label);
    }));
}

function hostsRow(dlg, t, enabled) {
  const error = dlg.hostsError;
  return v_flex().gap(4)
    .child(h_flex().gap(8).items_center()
      .child(div().flex_none().text_color(t.muted).child("Production hosts"))
      .child(Input.new(dlg.hostsInput).disabled(!enabled).flex_1().min_w(0).h(26).px(8).rounded(6).bg(t.background)
        .border_1().border_color(error ? t.blocked : t.border).text_size(12.5).text_color(t.foreground)))
    .child(div().text_size(12).text_color(error ? t.blocked : t.dim).child(error ?? HOSTS_NOTE));
}

export function browserSectionView(dlg, t) {
  const m = dlg.browserModel();
  const label = div().flex_none().text_size(12.5).text_color(t.muted).child("Browser");
  const row = h_flex().id("dc-browser").gap(8).items_start().text_size(12.5);
  if (!m) return row.child(label.mt(6)).child(div().min_h(28).flex().items_center().text_color(t.dim).child("Checking…"));
  // editable: not a read-only dialog; enabled: the buttons work now (no write, setup run or update going on).
  const { copy, status, editable, enabled } = m;
  const tone = { ok: t.done ?? t.accent, bad: t.blocked, accent: t.accent, dim: t.dim }[copy.tone] ?? t.dim;
  const draw = (b) => button(t, `dc-browser-${b.action}`, dlg.busy === "browser" && dlg.browserDoing === b.action ? "Working…" : b.label,
    { primary: b.primary, enabled }, (_e, cx) => dlg.browserAction(b.action, cx));
  const act = copy.button && editable ? draw(copy.button) : null;
  // A failed set-up: Turn off beside Set up again.
  const second = copy.secondary && editable ? draw(copy.secondary) : null;
  const choices = chromeChoices(status);
  const picked = chosenChrome(choices, dlg.chromePick);
  // Off: the button goes under the Chrome choice; every other state has it at the end of the first line.
  const head = h_flex().gap(10).items_center().min_h(28)
    .child(div().flex_none().text_color(tone).child(copy.head))
    .child(div().flex_1().min_w(0).text_color(t.muted).child(copy.intro))
    .when(Boolean(second), (el) => el.child(second))
    .when(Boolean(act) && !copy.chrome, (el) => el.child(act));
  return row.child(label.mt(6)).child(v_flex().flex_1().min_w(0).gap(4)
    .child(head)
    .when(Boolean(copy.note), (el) => el.child(div().text_color(t.dim).child(copy.note)))
    .when(Boolean(status.problem), (el) => el.child(div().text_color(t.dim).child(status.problem)))
    .when(copy.chrome && editable, (el) => el.child(chromeRow(dlg, t, choices, picked, enabled)))
    .when(Boolean(act) && copy.chrome, (el) => el.child(h_flex().child(act)))
    .when(copy.hosts && editable, (el) => el.child(hostsRow(dlg, t, dlg.editable()))));
}
