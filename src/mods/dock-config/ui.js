// Small styled controls for the dock-config dialog (gpui-base's controls are unstyled).
import { div, svg } from "gpui-kit";
import { h_flex, Switch } from "gpui-base";

export const icon = (name) => svg(`mods/dock-config/${name}.svg`);

// An icon-only button; dim and inert when not enabled.
export function iconButton(t, id, name, tip, enabled, onClick) {
  return h_flex().id(id).size(22).flex_none().items_center().justify_center().rounded(6).tooltip(tip)
    .when(enabled, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick))
    .when(!enabled, (el) => el.text_color(t.dim).opacity(0.35))
    .child(icon(name).size(12));
}

// A text button; `primary` draws the theme's solid button.
export function button(t, id, label, { primary = false, enabled = true } = {}, onClick) {
  return h_flex().id(id).h(28).px(12).flex_none().items_center().rounded(7).text_size(12.5)
    .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground))
    .when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.foreground))
    .when(enabled, (el) => el.cursor_pointer().on_click(onClick)
      .hover((s) => (primary ? s.opacity(0.9) : s.bg(t.hover))))
    .when(!enabled, (el) => el.opacity(0.4))
    .child(label);
}

// A switch drawn as a track with a knob.
export function toggle(t, id, on, enabled, onChange) {
  return Switch.new(id).checked(on).disabled(!enabled).on_change(onChange)
    .flex().flex_row().items_center().flex_none().w(28).h(16).p(2).rounded_full().bg(on ? t.accent : t.border)
    .when(enabled, (el) => el.cursor_pointer())
    .when(!enabled, (el) => el.opacity(0.4))
    .child(div().size(12).rounded_full().bg(on ? t.accent_foreground : t.muted).when(on, (el) => el.ml(12)));
}

// A segmented control. options: [{ value, label, enabled, tip? }]; the selected one is drawn raised.
export function segmented(t, id, options, selected, onPick) {
  return h_flex().flex_none().p(2).gap(2).rounded(7).bg(t.background).border_1().border_color(t.border)
    .children(options.map((o) => {
      const on = o.value === selected;
      return h_flex().id(`${id}-${o.value}`).h(22).px(8).items_center().rounded(5).text_size(12)
        .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
        .when(on, (el) => el.bg(t.selected).text_color(t.foreground))
        .when(!on && o.enabled, (el) => el.text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => onPick(o.value, cx)))
        .when(!on && !o.enabled, (el) => el.text_color(t.dim).opacity(0.4))
        .child(o.label);
    }));
}

// A small rounded tag ("not installed", a reason).
export const tag = (t, text) =>
  div().flex_none().px(6).py(1).rounded(4).text_size(11).text_color(t.dim).border_1().border_color(t.border).child(text);
