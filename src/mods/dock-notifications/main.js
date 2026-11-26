// Notifications: the history dock-core keeps (shared dock.notify.history), newest first. Shown in the right
// panel when placed there, else as a dialog opened by dock-core's notify.show (props().overlay set, so it gets
// a close ×). dock-core is the only writer: ✕, Clear all and marking read go to it through notifyCommand.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, props, closeOverlay, run } from "herdr";
import { notifyCommand } from "../_notify-command.js";
import { FILTERS, HISTORY_KEY, historyOf } from "../../shared/notify.js";
import { rightActiveOf, rightShownOf } from "../../shared/panel.js";
import { notificationRows, filterRows, filterCounts } from "./view.js";

const ID = "dock-notifications";
// Same level colours as the toast (dock-toast's DOT).
const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
const FILTER_LABEL = { needs: "Needs you", agents: "Agents", ci: "CI", updates: "Updates", other: "Other" };
const FILTER_STORE = "filter"; // this PC's chosen filter (localStorage), or none

export default class Notifications extends View {
  init(_props, cx) {
    this.readSent = null; // the newest unread item notify.read was sent for
    try {
      const saved = localStorage.getItem(FILTER_STORE);
      this.filter = FILTERS.includes(saved) ? saved : null;
    } catch { this.filter = null; }
    cx.timer.every(30000, (cx) => cx.notify()); // keeps the "5m" times current
  }

  // Open as a dialog, or the right panel's shown tab.
  visible() {
    if (props()?.overlay) return true;
    const applied = shared("dock.config.applied");
    const features = applied?.right?.features ?? [];
    return rightShownOf(shared("dock.right.shown"), applied) && rightActiveOf(shared("dock.right.active"), features) === ID;
  }

  // While visible, unread items are marked read (once per newest unread item).
  markRead(history) {
    const unread = history.find((x) => !x.read);
    if (!this.visible() || !unread) { if (!unread) this.readSent = null; return; }
    if (this.readSent === unread.id) return;
    this.readSent = unread.id;
    notifyCommand("notify.read");
  }

  // Closes the dialog (no-op in the right panel); also after a row's action runs.
  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  // Picks a filter (null: all); the same chip again clears it. Remembered on this PC.
  pick(filter, cx) {
    this.filter = filter && filter !== this.filter ? filter : null;
    try {
      if (this.filter) localStorage.setItem(FILTER_STORE, this.filter);
      else localStorage.removeItem(FILTER_STORE);
    } catch { /* no storage: the choice lasts until the panel closes */ }
    cx.notify();
  }

  // All, then one chip per filter that has items; the active one is filled.
  chips(t, counts, active) {
    const chip = (id, label, on, filter) => div().id(`nt-filter-${id}`).flex_none().px(8).h(22).rounded(11).flex()
      .items_center().text_size(11.5).cursor_pointer()
      .when(on, (el) => el.bg(t.accent).text_color(t.background ?? t.chrome))
      .when(!on, (el) => el.border(1).border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { cx.stop_propagation(); this.pick(filter, cx); })
      .child(label);
    return h_flex().flex_none().flex_wrap().px(16).pb(8).gap(6)
      .child(chip("all", `All ${counts.all}`, !active, null))
      .children(FILTERS.filter((f) => counts[f] > 0).map((f) => chip(f, `${FILTER_LABEL[f]} ${counts[f]}`, active === f, f)));
  }

  header(t, empty, overlay, filter) {
    return h_flex().flex_none().px(16).pt(overlay ? 14 : 12).pb(8).gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child("Notifications"))
      .child(div().id("nt-clearall").flex_none().px(6).h(20).rounded(5).flex().items_center().text_size(11.5)
        .tooltip(empty ? "Nothing to clear"
          : filter ? `Remove the ${FILTER_LABEL[filter]} notifications shown` : "Remove every notification")
        .when(!empty, (el) => el.text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (filter) notifyCommand("notify.clearfilter", { filter });
            else notifyCommand("notify.clearall");
          }))
        .when(empty, (el) => el.text_color(t.dim).opacity(0.45))
        .child(filter ? "Clear shown" : "Clear all"))
      .when(overlay, (el) => el.child(div().id("nt-close").flex_none().size(22).rounded(5).flex().items_center()
        .justify_center().text_size(15).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close")
        .on_click(() => this.close()).child("×")));
  }

  row(t, r, action) {
    const red = t.ansi1 ?? "#e5484d";
    const green = t.ansi2 ?? "#46a758";
    const edge = r.needs && !r.resolved;
    return h_flex().id(`nt-row-${r.id}`).flex_none().mx(8).px(8).py(6).gap(10).items_start().rounded(6)
      .border_l(3).border_color(edge ? red : t.chrome)
      .when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => { run(action.name, action.args ?? {}); this.close(); }))
      .child(div().mt(5).size(8).rounded(4).flex_none().bg(t[DOT[r.level] ?? "accent"] ?? t.accent))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(12.5).text_color(t.foreground).when(!r.read, (el) => el.font_semibold())
          .child(r.title || "(no title)"))
        .when(Boolean(r.body), (el) => el.child(div().id(`nt-body-${r.id}`).truncate().text_size(12)
          .text_color(t.muted).tooltip(r.body).child(r.body)))
        .when(r.resolved, (el) => el.child(div().text_size(11.5).text_color(green).child("✓ resolved"))))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(r.when))
      .child(div().id(`nt-clear-${r.id}`).flex_none().size(18).rounded(4).flex().items_center().justify_center()
        .text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Remove")
        .on_click((_e, cx) => { cx.stop_propagation(); notifyCommand("notify.clear", { id: r.id }); })
        .child("✕"));
  }

  render() {
    const t = theme();
    const overlay = Boolean(props()?.overlay);
    const history = historyOf(shared(HISTORY_KEY));
    this.markRead(history);
    const actions = new Map(history.map((x) => [x.id, x.action]));
    const all = notificationRows(history, Date.now());
    const counts = filterCounts(all);
    // A remembered filter whose items are all gone shows everything (its chip is hidden too).
    const filter = this.filter && counts[this.filter] > 0 ? this.filter : null;
    const rows = filterRows(all, filter);
    const body = rows.length
      ? rows.map((r) => this.row(t, r, r.hasAction ? actions.get(r.id) : null))
      : [div().px(16).py(6).text_size(12).text_color(t.dim).child("No notifications")];
    return v_flex().id(ID).size_full().min_h(0).bg(overlay ? (t.popover ?? t.chrome) : t.chrome)
      .text_size(13).text_color(t.foreground)
      .child(this.header(t, rows.length === 0, overlay, filter))
      .when(all.length > 0, (el) => el.child(this.chips(t, counts, filter)))
      .child(v_flex().id("nt-body").flex_1().min_h(0).pb(12).gap(2).overflow_y_scrollbar().children(body));
  }
}
