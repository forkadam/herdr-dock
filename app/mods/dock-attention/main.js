// src/mods/dock-attention/main.js
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, shared } from "herdr";

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
var FILTERS = ["needs", "agents", "ci", "updates", "other"];
function counts(list) {
  let needYou = 0, unread = 0;
  for (const x of list) {
    if (x.needs && !x.resolved) needYou++;
    else if (!x.read) unread++;
  }
  return { needYou, unread };
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
    case "notify.clearfilter":
      if (!FILTERS.includes(args?.filter)) throw new Error(`notify.clearfilter needs { filter } of ${FILTERS.join(", ")}`);
      return `${name}.${args.filter}`;
    default:
      throw new Error(`unknown notify command: ${name}`);
  }
}

// src/mods/_notify-command.js
function notifyCommand(name, args) {
  run(`dock-core.${notifyCommandName(name, args)}`);
}

// src/mods/dock-attention/view.js
function attentionText({ needYou, unread }) {
  const out = [];
  if (needYou > 0) out.push({ text: `\u26A0 ${needYou} need you`, tone: "bad" });
  if (unread > 0) out.push({ text: `${unread} unread`, tone: "dim" });
  return out.length ? out : [{ text: "No notifications", tone: "dim" }];
}
function attentionBell(c) {
  const tone = c.needYou > 0 ? "bad" : c.unread > 0 ? "unread" : "none";
  return { tone, dot: tone !== "none", tip: attentionText(c).map((p) => p.text).join(" \xB7 ") };
}

// src/mods/dock-attention/main.js
var Attention = class extends View {
  render() {
    const t = theme();
    const bell = attentionBell(counts(historyOf(shared(HISTORY_KEY))));
    const color = bell.tone === "bad" ? t.blocked : bell.tone === "unread" ? t.accent : t.dim;
    return h_flex().id("dock-attention").size_full().items_center().justify_center().bg(t.chrome).border_t(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(`${bell.tip} \xB7 click to open`).on_click(() => notifyCommand("notify.show")).child(div().relative().size(14).child(svg("mods/dock-notifications/icon.svg").size(14).text_color(color)).when(bell.dot, (el) => el.child(div().absolute().top(-2).right(-2).size(7).rounded_full().bg(color).border_1().border_color(t.chrome))));
  }
};
export {
  Attention as default
};
