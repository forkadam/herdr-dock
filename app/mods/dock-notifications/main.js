// src/mods/dock-notifications/main.js
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, props, closeOverlay, run as run2 } from "herdr";

// src/mods/_notify-command.js
import { run } from "herdr";

// src/shared/gitcmd.js
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function utf8(str2) {
  const out = [];
  for (const ch of str2) {
    const c = ch.codePointAt(0);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return out;
}
function b64urlEncode(str2) {
  const b = utf8(String(str2));
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = b[i] << 16 | (b[i + 1] ?? 0) << 8 | (b[i + 2] ?? 0);
    s += ALPHABET[n >> 18 & 63] + ALPHABET[n >> 12 & 63];
    if (i + 1 < b.length) s += ALPHABET[n >> 6 & 63];
    if (i + 2 < b.length) s += ALPHABET[n & 63];
  }
  return s;
}

// src/shared/notify.js
var HISTORY_KEY = "dock.notify.history";
var isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
var str = (v) => typeof v === "string" ? v : null;
function actionOf(a) {
  if (!isObj(a) || typeof a.name !== "string") return null;
  return a.args === void 0 ? { name: a.name } : { name: a.name, args: a.args };
}
function itemOf(x) {
  if (!isObj(x) || typeof x.id !== "string") return null;
  const needs = isObj(x.needs) && (x.needs.kind === "agent" && typeof x.needs.terminal === "string" || x.needs.kind === "pipeline" && typeof x.needs.worktree === "string") ? x.needs : null;
  return {
    id: x.id,
    at: Number.isFinite(x.at) ? x.at : 0,
    title: typeof x.title === "string" ? x.title : "",
    body: str(x.body),
    level: str(x.level),
    icon: str(x.icon),
    action: actionOf(x.action),
    read: x.read === true,
    needs,
    resolved: needs != null && x.resolved === true
  };
}
function historyOf(raw) {
  return Array.isArray(raw) ? raw.map(itemOf).filter(Boolean) : [];
}

// src/shared/notifycmd.js
var isObj2 = (v) => v != null && typeof v === "object" && !Array.isArray(v);
function notifyCommandName(name, args = {}) {
  switch (name) {
    case "notify.clearall":
    case "notify.read":
    case "notify.show":
      return name;
    case "notify.add":
      if (!isObj2(args?.n)) throw new Error("notify.add needs { n }");
      return `${name}.${b64urlEncode(JSON.stringify(args.n))}`;
    case "notify.clear":
      if (typeof args?.id !== "string") throw new Error("notify.clear needs { id }");
      return `${name}.${b64urlEncode(args.id)}`;
    default:
      throw new Error(`unknown notify command: ${name}`);
  }
}

// src/mods/_notify-command.js
function notifyCommand(name, args) {
  run(`dock-core.${notifyCommandName(name, args)}`);
}

// src/shared/layout.js
function rightActiveOf(active, features) {
  if (!features.length) return null;
  return features.some((f) => f.mod === active) ? active : features[0].mod;
}

// src/shared/panel.js
function rightShownOf(sharedShown, applied) {
  if (typeof sharedShown === "boolean") return sharedShown;
  return applied?.right?.hidden === false;
}

// src/shared/claude.js
function formatAge(ms) {
  if (ms < 6e4) return "just now";
  const m = Math.floor(ms / 6e4);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// src/mods/dock-notifications/view.js
var when = (ms) => formatAge(Math.max(0, ms)).replace(/ ago$/, "");
function notificationRows(list, now) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => ({
    id: x.id,
    title: x.title ?? "",
    body: x.body ?? "",
    level: x.level ?? "info",
    when: when(now - (x.at ?? 0)),
    needs: x.needs != null,
    resolved: x.needs != null && x.resolved === true,
    read: x.read === true,
    hasAction: typeof x.action?.name === "string"
  }));
}

// src/mods/dock-notifications/main.js
var ID = "dock-notifications";
var DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
var Notifications = class extends View {
  init(_props, cx) {
    this.readSent = null;
    cx.timer.every(3e4, (cx2) => cx2.notify());
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
    if (!this.visible() || !unread) {
      if (!unread) this.readSent = null;
      return;
    }
    if (this.readSent === unread.id) return;
    this.readSent = unread.id;
    notifyCommand("notify.read");
  }
  // Closes the dialog (no-op in the right panel); also after a row's action runs.
  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }
  header(t, empty, overlay) {
    return h_flex().flex_none().px(16).pt(overlay ? 14 : 12).pb(8).gap(6).items_center().child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child("Notifications")).child(div().id("nt-clearall").flex_none().px(6).h(20).rounded(5).flex().items_center().text_size(11.5).tooltip(empty ? "Nothing to clear" : "Remove every notification").when(!empty, (el) => el.text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
      cx.stop_propagation();
      notifyCommand("notify.clearall");
    })).when(empty, (el) => el.text_color(t.dim).opacity(0.45)).child("Clear all")).when(overlay, (el) => el.child(div().id("nt-close").flex_none().size(22).rounded(5).flex().items_center().justify_center().text_size(15).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close").on_click(() => this.close()).child("\xD7")));
  }
  row(t, r, action) {
    const red = t.ansi1 ?? "#e5484d";
    const green = t.ansi2 ?? "#46a758";
    const edge = r.needs && !r.resolved;
    return h_flex().id(`nt-row-${r.id}`).flex_none().mx(8).px(8).py(6).gap(10).items_start().rounded(6).border_l(3).border_color(edge ? red : t.chrome).when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => {
      run2(action.name, action.args ?? {});
      this.close();
    })).child(div().mt(5).size(8).rounded(4).flex_none().bg(t[DOT[r.level] ?? "accent"] ?? t.accent)).child(v_flex().flex_1().min_w(0).gap(2).child(div().truncate().text_size(12.5).text_color(t.foreground).when(!r.read, (el) => el.font_semibold()).child(r.title || "(no title)")).when(Boolean(r.body), (el) => el.child(div().id(`nt-body-${r.id}`).truncate().text_size(12).text_color(t.muted).tooltip(r.body).child(r.body))).when(r.resolved, (el) => el.child(div().text_size(11.5).text_color(green).child("\u2713 resolved")))).child(div().flex_none().text_size(11.5).text_color(t.dim).child(r.when)).child(div().id(`nt-clear-${r.id}`).flex_none().size(18).rounded(4).flex().items_center().justify_center().text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove").on_click((_e, cx) => {
      cx.stop_propagation();
      notifyCommand("notify.clear", { id: r.id });
    }).child("\u2715"));
  }
  render() {
    const t = theme();
    const overlay = Boolean(props()?.overlay);
    const history = historyOf(shared(HISTORY_KEY));
    this.markRead(history);
    const actions = new Map(history.map((x) => [x.id, x.action]));
    const rows = notificationRows(history, Date.now());
    const body = rows.length ? rows.map((r) => this.row(t, r, r.hasAction ? actions.get(r.id) : null)) : [div().px(16).py(6).text_size(12).text_color(t.dim).child("No notifications")];
    return v_flex().id(ID).size_full().min_h(0).bg(overlay ? t.popover ?? t.chrome : t.chrome).text_size(13).text_color(t.foreground).child(this.header(t, rows.length === 0, overlay)).child(v_flex().id("nt-body").flex_1().min_h(0).pb(12).gap(2).overflow_y_scrollbar().children(body));
  }
};
export {
  Notifications as default
};
