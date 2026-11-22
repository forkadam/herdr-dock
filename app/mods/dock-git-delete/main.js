// src/mods/dock-git-delete/main.js
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, exec, window } from "herdr";

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
function gitCommandName(name, args = {}) {
  switch (name) {
    case "git.refresh":
    case "git.retry":
    case "git.open":
      return name;
    case "git.open.job":
      if (!Number.isInteger(args?.index) || args.index < 0) throw new Error("git.open.job needs { index }");
      return `${name}.${args.index}`;
    case "git.select":
    case "git.delete":
      if (typeof args?.worktree !== "string") throw new Error(`${name} needs { worktree }`);
      return `${name}.${b64urlEncode(args.worktree)}`;
    case "git.show":
      return typeof args?.worktree === "string" ? `${name}.${b64urlEncode(args.worktree)}` : name;
    default:
      throw new Error(`unknown git command: ${name}`);
  }
}

// src/shared/platform.js
function openFolderCommand(platform, path) {
  if (platform === "windows") return { command: "explorer", args: [String(path).replace(/\//g, "\\")] };
  if (platform === "macos") return { command: "open", args: [path] };
  return { command: "xdg-open", args: [path] };
}

// src/mods/dock-git-delete/main.js
var DeleteWorktree = class extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }
  close() {
    closeOverlay(props().overlay);
  }
  yes() {
    const p = props();
    this.close();
    run(`dock-core.${gitCommandName("git.delete", { worktree: p.worktree })}`);
  }
  openFolder() {
    const { command, args } = openFolderCommand(window()?.platform, props().path);
    exec(command, args).catch((e) => console.log(`dock-git-delete: open folder failed: ${e?.message ?? e}`));
  }
  render() {
    const t = theme();
    const p = props() ?? {};
    const red = "#c9302c";
    const local = p.machine == null;
    const button = (id, label, bg, fg, border, onClick) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(border).bg(bg).text_color(fg).cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
    const folder = div().id("folder").text_color(t.foreground).underline().tooltip(local ? `${p.path} \xB7 click to open` : `${p.path} \xB7 on ${p.machine}`).child(p.name ?? p.path ?? "");
    return v_flex().id("dock-git-delete").track_focus(this.handle).on_key_down((e, cx) => {
      if (e.key !== "escape") return;
      this.close();
      cx.stop_propagation();
    }).size_full().min_h(0).p(18).gap(12).rounded(8).bg(t.popover).text_size(13).child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Delete worktree?")).child(div().text_size(11).text_color(t.dim).child("Esc"))).child(div().text_color(t.muted).child("This deletes the worktree's folder from disk:")).child(h_flex().px(12).py(9).gap(6).items_center().rounded(6).bg(t.raised ?? t.chrome).border_1().border_color(t.border).child(div().flex_none().font_semibold().text_color(t.accent).child(p.branch ?? "")).child(div().flex_none().text_color(t.dim).child("/")).child(local ? folder.cursor_pointer().hover((s) => s.text_color(t.accent)).on_click(() => this.openFolder()) : folder)).child(div().flex_1().min_h(0).text_color(t.muted).child("Its branch is kept. Git refuses if the worktree has uncommitted or untracked files.")).child(h_flex().justify_end().gap(8).text_size(12).child(button("no", "Cancel", t.raised, t.foreground, t.input, () => this.close())).child(button("yes", "Delete", red, "#ffffff", red, () => this.yes())));
  }
};
export {
  DeleteWorktree as default
};
