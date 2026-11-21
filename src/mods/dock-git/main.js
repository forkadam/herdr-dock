// Git projects: the repos and worktrees dock-core's collector publishes (dock.git.state), each with its
// pipeline badge. Clicking a worktree selects it (and its space when open); the badge shows its pipeline.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, props, run, exec, pickFolder, window } from "herdr";
import { featureMode, iconRail, requestFocus } from "../_feature.js";
import { gitCommand } from "../_git-command.js";
import { openUrlCommand } from "../../shared/platform.js";
import { slashPath } from "../../shared/path.js";
import { gitRows, gitSummary, addRepoPath, removeRepoPaths } from "./view.js";

const REPOS_KEY = "dock.git.repos";
const WARN = "#d29922";

export default class Git extends View {
  init() {
    this.menu = null; // the repo id whose right-click menu is open
  }

  tones(t) {
    return { ok: t.ansi2 ?? "#46a758", bad: t.ansi1 ?? "#e5484d", busy: t.accent, dim: t.dim, warn: WARN };
  }

  repoById(id) {
    const repos = shared("dock.git.state")?.repos;
    return Array.isArray(repos) ? repos.find((r) => r.id === id) ?? null : null;
  }

  addRepo(cx) {
    cx.spawn(async () => {
      const picked = await pickFolder({ prompt: "Add a repo" }).catch(() => null);
      if (!picked) return;
      const next = addRepoPath(shared(REPOS_KEY), slashPath(picked), window()?.platform);
      if (next) setShared(REPOS_KEY, next);
      gitCommand("git.refresh");
    });
  }

  removeRepo(id) {
    const repo = this.repoById(id);
    if (repo) setShared(REPOS_KEY, removeRepoPaths(shared(REPOS_KEY), repo, window()?.platform));
    this.menu = null;
  }

  openWeb(url) {
    const { command, args } = openUrlCommand(window()?.platform, url);
    exec(command, args).catch((e) => console.log(`dock-git: open failed: ${e?.message ?? e}`));
  }

  header(t, onTitle, summary) {
    const title = div().text_size(11.5).font_medium().text_color(t.dim).child("Git projects");
    const button = (id, tip, child, action) => div().id(id).size(22).flex_none().flex().items_center().justify_center()
      .rounded(5).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(child);
    return h_flex().px(16).pr(onTitle ? 16 : 10).h(onTitle ? 31 : 41).pt(onTitle ? 0 : 14).pb(onTitle ? 0 : 5)
      .flex_none().items_center().gap(2)
      .child(onTitle
        ? title.id("dock-git-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Git projects").on_click(() => onTitle())
        : title.flex_1())
      .when(Boolean(summary), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(summary)))
      .when(!onTitle, (el) => el
        .child(button("git-refresh", "Refresh repos and pipelines", div().text_size(15).child("⟳"), () => gitCommand("git.refresh")))
        .child(button("git-add", "Add a repo", svg("mods/workspace-chrome/plus.svg").size(14), (cx) => this.addRepo(cx))));
  }

  repoRow(t, r, i) {
    const red = t.ansi1 ?? "#e5484d";
    const detail = [r.machine && `@${r.machine}`, r.provider].filter(Boolean).join(" · ");
    return h_flex().id(`git-repo-${i}`).h(24).px(16).gap(6).flex_none().items_center().mt(i ? 6 : 0)
      .tooltip(r.tooltip)
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu = this.menu === r.id ? null : r.id; cx.notify(); })
      .child(div().flex_none().text_size(12.5).font_medium().text_color(t.foreground).child(r.name))
      .when(Boolean(detail), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`· ${detail}`)))
      .child(div().flex_1())
      .when(Boolean(r.error), (el) => el
        .child(div().flex_none().text_size(12).text_color(WARN).child("⚠"))
        .child(div().id(`git-remove-${i}`).flex_none().px(6).h(18).rounded(5).text_size(11).text_color(red)
          .flex().items_center().cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); this.removeRepo(r.id); cx.notify(); })
          .child("Remove")));
  }

  menuFor(t, r, i) {
    const items = [];
    if (r.added) items.push(["remove", "Remove repo", (cx) => { this.removeRepo(r.id); cx.notify(); }]);
    if (r.webUrl) items.push(["web", r.webLabel, () => this.openWeb(r.webUrl)]);
    if (r.mainPath) items.push(["copy", "Copy path", (cx) => cx.write_to_clipboard(r.mainPath)]);
    if (!items.length) items.push(["none", "No actions", () => {}]);
    return v_flex().id(`git-menu-${i}`).mx(12).my(2).p(4).flex_none().rounded(7).bg(t.popover ?? t.chrome)
      .border(1).border_color(t.border).text_size(12)
      .on_mouse_down_out((_e, cx) => { this.menu = null; cx.notify(); })
      .children(items.map(([key, label, action]) => div().id(`git-menu-${i}-${key}`).h(26).px(8).rounded(5)
        .flex().items_center().text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); action(cx); this.menu = null; cx.notify(); })
        .child(label)));
  }

  worktreeRow(t, w, i) {
    const tones = this.tones(t);
    const select = () => {
      if (w.open && w.space) run("space.select", { id: w.space });
      gitCommand("git.select", { worktree: w.id });
    };
    return h_flex().id(`git-wt-${i}`).h(24).mx(8).pl(10).pr(8).gap(6).flex_none().items_center().rounded(6)
      .text_size(12.5).cursor_pointer()
      .when(w.selected, (el) => el.bg(t.selected ?? t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click(() => select())
      .child(div().size(6).flex_none().rounded_full().bg(w.open ? tones.ok : (t.dim + "00")))
      .child(div().id(`git-branch-${i}`).flex_1().min_w(0).truncate().text_color(w.open ? t.foreground : t.muted)
        .tooltip(w.tooltip).child(w.branch))
      .when(Boolean(w.badge.glyph), (el) => el.child(div().id(`git-badge-${i}`).flex_none().w(18).h(18).rounded(4)
        .flex().items_center().justify_center().text_size(12).text_color(tones[w.badge.tone] ?? t.dim)
        .hover((s) => s.bg(t.border)).tooltip(w.badgeTip)
        .on_click((_e, cx) => { cx.stop_propagation(); gitCommand("git.show", { worktree: w.id }); })
        .child(w.badge.glyph)))
      .when(Boolean(w.ahead), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(w.ahead)))
      .when(Boolean(w.behind), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(w.behind)))
      .when(w.noUpstream, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child("no upstream")))
      .when(w.dirty, (el) => el.child(div().flex_none().text_size(12).text_color(WARN).child("•")));
  }

  render() {
    const t = theme();
    const myId = props()?.dockFeature ?? "dock-git";
    const face = featureMode(shared("dock.left.mode"), shared("dock.left.focus"), myId, props()?.dockRegion);
    const state = shared("dock.git.state");
    const sum = gitSummary(state);
    if (face === "icon") {
      const rail = iconRail(t, "mods/dock-git/icon.svg", "Git projects", () => requestFocus(myId));
      if (!sum.failing) return rail;
      return rail.child(div().id("git-failing").mt(2).size(7).rounded_full().bg(t.ansi1 ?? "#e5484d")
        .tooltip(`${sum.failing} failing`));
    }
    if (face === "collapsed") {
      return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
        .child(this.header(t, () => requestFocus(myId), sum.text));
    }
    const rows = gitRows(state, shared("dock.git.selected") ?? null);
    const children = [];
    rows.forEach((r, i) => {
      if (r.kind === "empty") children.push(div().px(16).py(4).text_size(12).text_color(t.dim).child(r.text));
      else if (r.kind === "repo") {
        children.push(this.repoRow(t, r, i));
        if (this.menu === r.id) children.push(this.menuFor(t, r, i));
      } else children.push(this.worktreeRow(t, r, i));
    });
    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .child(this.header(t, null, null))
      .child(v_flex().id("git-list").flex_1().min_h(0).pb(6).overflow_y_scrollbar().children(children));
  }
}
