// The warning dialog before Git projects deletes a worktree from disk. Opened by dock-git as a modal dialog
// with props { branch, name, path, machine, worktree }: the branch and folder name are shown on their own line;
// the folder name shows the full path on hover and, for this PC's worktrees, opens it in the file manager.
// Delete sends dock-core the git.delete command; Esc or Cancel closes it.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, exec, window } from "herdr";
import { gitCommandName } from "../../shared/gitcmd.js";
import { openFolderCommand } from "../../shared/platform.js";

export default class DeleteWorktree extends View {
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
    const red = "#c9302c"; // fixed: a theme's ansi red can be too pale for white text
    const local = p.machine == null;
    const button = (id, label, bg, fg, border, onClick) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(border).bg(bg).text_color(fg).cursor_pointer().hover((s) => s.opacity(0.88))
      .on_click(onClick).child(label);
    const folder = div().id("folder").text_color(t.foreground).underline()
      .tooltip(local ? `${p.path} · click to open` : `${p.path} · on ${p.machine}`)
      .child(p.name ?? p.path ?? "");
    return v_flex().id("dock-git-delete").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        this.close();
        cx.stop_propagation();
      })
      .size_full().min_h(0).p(18).gap(12).rounded(8).bg(t.popover).text_size(13)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Delete worktree?"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child("This deletes the worktree's folder from disk:"))
      .child(h_flex().px(12).py(9).gap(6).items_center().rounded(6).bg(t.raised ?? t.chrome).border_1().border_color(t.border)
        .child(div().flex_none().font_semibold().text_color(t.accent).child(p.branch ?? ""))
        .child(div().flex_none().text_color(t.dim).child("/"))
        .child(local
          ? folder.cursor_pointer().hover((s) => s.text_color(t.accent)).on_click(() => this.openFolder())
          : folder))
      .child(div().flex_1().min_h(0).text_color(t.muted)
        .child("Its branch is kept. Git refuses if the worktree has uncommitted or untracked files."))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(button("no", "Cancel", t.raised, t.foreground, t.input, () => this.close()))
        .child(button("yes", "Delete", red, "#ffffff", red, () => this.yes())));
  }
}
