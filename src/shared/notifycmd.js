// The notify.* commands that mods send to dock-core, the one writer of the notification history (pure; no
// host imports). Herdr drops run()'s args for mod commands, so arguments ride in the command name: a toast's
// props as base64url JSON, an item id as base64url.

import { b64urlDecode, b64urlEncode } from "./gitcmd.js";
import { FILTERS, addItem, clearAll, clearItem, clearMatching, markAllRead } from "./notify.js";

// Where notify.show opens dock-notifications when the right panel doesn't hold it.
export const NOTIFY_DIALOG = { mod: "dock-notifications", kind: "dialog", width: 520, height: 0.7 };

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

// The dock-core command for a notify.* request (without the "dock-core." prefix). Throws on a bad request.
export function notifyCommandName(name, args = {}) {
  switch (name) {
    case "notify.clearall": case "notify.read": case "notify.show":
      return name;
    case "notify.add":
      if (!isObj(args?.n)) throw new Error("notify.add needs { n }");
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

// What dock-core's nextCommand() string asks for, or null when it isn't a valid notify.* command.
export function parseNotifyCommand(c) {
  if (typeof c !== "string" || !c.startsWith("notify.")) return null;
  const rest = c.slice(7);
  if (rest === "clearall" || rest === "read" || rest === "show") return { cmd: rest };
  const f = /^clearfilter\.([a-z]+)$/.exec(rest);
  if (f) return FILTERS.includes(f[1]) ? { cmd: "clearfilter", filter: f[1] } : null;
  const m = /^(add|clear)\.([A-Za-z0-9_-]+)$/.exec(rest);
  if (!m) return null;
  const text = b64urlDecode(m[2]);
  if (text == null) return null;
  if (m[1] === "clear") return { cmd: "clear", id: text };
  let n;
  try { n = JSON.parse(text); } catch { return null; }
  return isObj(n) ? { cmd: "add", n } : null;
}

// The history after cmd (pure). newId names an added item; show changes nothing here (dock-core reveals).
export function applyNotifyCommand(list, cmd, now, newId) {
  switch (cmd?.cmd) {
    case "add": return addItem(list, cmd.n, now, newId);
    case "clear": return clearItem(list, cmd.id);
    case "clearall": return clearAll();
    case "clearfilter": return clearMatching(list, cmd.filter);
    case "read": return markAllRead(list);
    default: return list;
  }
}
