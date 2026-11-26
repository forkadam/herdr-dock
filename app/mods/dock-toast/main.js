// src/mods/dock-toast/main.js
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run as run2, theme, checking } from "herdr";

// src/mods/_notify-command.js
import { run } from "herdr";

// src/shared/gitcmd.js
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function utf8(str) {
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return out;
}
function b64urlEncode(str) {
  const b = utf8(String(str));
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
var FILTERS = ["needs", "agents", "ci", "updates", "other"];

// src/shared/notifycmd.js
var isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
function notifyCommandName(name, args = {}) {
  switch (name) {
    case "notify.clearall":
    case "notify.read":
    case "notify.show":
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

// src/mods/_notify-command.js
function notifyCommand(name, args) {
  run(`dock-core.${notifyCommandName(name, args)}`);
}

// src/mods/dock-toast/main.js
var DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
var Toast = class extends View {
  init() {
    if (checking()) return;
    try {
      const { title, body, level, icon, action } = props() ?? {};
      notifyCommand("notify.add", { n: { title, body, level, icon, action } });
    } catch (e) {
      console.log(`dock-toast: recording failed: ${e?.message ?? e}`);
    }
  }
  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    return h_flex().id("toast").size_full().px(18).gap(12).items_center().bg(t.popover).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => {
      if (p.action?.name) run2(p.action.name, p.action.args ?? {});
      closeOverlay(p.overlay);
    }).child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"])).child(
      v_flex().flex_1().overflow_hidden().child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : p.title ?? "")).when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? ""))).when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command)).child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised).text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx2) => {
        cx2.stop_propagation();
        cx2.write_to_clipboard(command);
        this.copied = true;
        cx2.notify();
      }).child(this.copied ? "Copied" : "Copy"))))
    );
  }
};
export {
  Toast as default
};
