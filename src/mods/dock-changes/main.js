// Based on Herdr's shipped changes mod (installed.json main.js hash 61d1b51d29eb8660).
// herdr-dock changes:
// - location() follows the Git projects selection when it is the most recent thing the person did
//   (see src/shared/follow.js); otherwise the focused terminal, as Herdr's own panel does.
// - Coalesced trailing refresh: file-change events arriving while a refresh is in flight trigger a
//   follow-up refresh instead of being dropped until the 10 s timer (src/shared/changes.js).
// - Parallel git status/diff reads with cached repo root and immediate file-list paint before diff load.
// - Proper FolderWatch lifecycle: cancels watches on repo switch, panel hide, and close; watches a
//   linked worktree's git dir too; polls faster (2.5 s) while visible if watching is unavailable.
// - The header says which folder and branch it follows; a Branch view lists everything on the branch
//   that isn't on the default branch yet, committed or not, with diffs against the merge base.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, Tabs, Tab } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, shared, setShared, props, checking } from "herdr";
import { followLocation } from "../../shared/follow.js";
import { rightActiveOf, rightShownOf } from "../../shared/panel.js";
import { GIT_READ, POLL_MS, createChangesSync, emptyText, fetchChanges, folderOf, followsLine } from "../../shared/changes.js";

const MOD = "dock-changes";
// Uncommitted: what isn't committed yet. Branch: everything on this branch that isn't on the
// default branch, committed or not (src/shared/changes.js). Shared, so every copy shows the same.
const VIEW_KEY = "dock.changes.view";
const VIEWS = [["uncommitted", "Uncommitted"], ["branch", "Branch"]];
const viewOf = (value) => value === "branch" ? "branch" : "uncommitted";

function focusLocation() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

// herdr-dock: "last thing you did wins" between the focused terminal and the Git projects
// selection (src/shared/follow.js). Module scope is fine: every copy applies the same rule to
// the same inputs.
let followMemo = null;
function location() {
  const r = followLocation(followMemo, { focus: focusLocation(), selected: shared("dock.git.selected"), state: shared("dock.git.state") });
  followMemo = r.memo;
  return r.loc;
}
// The view is part of what the panel follows: switching it starts a fresh list, as a new folder does.
const where = () => ({ ...location(), view: viewOf(shared(VIEW_KEY)) });
const key = () => JSON.stringify(where());
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

// Wraps a live GPUI `cx` without retaining it across callbacks: every spawned task gets its own `cx`.
const runCtx = (cx) => ({
  spawn: (fn) => cx.spawn(async (taskCx) => fn(runCtx(taskCx))),
  sleep: (ms) => cx.sleep(ms),
  notify: () => cx.notify(),
});

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.root = null; this.gitDir = null; this.on = null; this.context = null; this.folder = null;
    this.branch = null; this.base = null; this.mergeBase = null; this.onBase = false; this.bases = null;
    this.open = null; this.closed = false; this.limited = false; this.error = null; this.note = null;
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.sync = createChangesSync({
      watchFolder,
      getLocation: where,
      onReset: (nextContext) => {
        this.context = nextContext; this.root = null; this.gitDir = null; this.on = null;
        this.files = []; this.open = null; this.setLines([]);
        // A new folder or view looks the default branch up again.
        this.branch = null; this.base = null; this.mergeBase = null; this.onBase = false; this.bases = null;
        // Switching the view keeps a commit message being written; following another folder doesn't.
        const folder = folderOf(nextContext);
        if (folder !== this.folder) { this.message = ""; this.input.set_value(""); }
        this.folder = folder; this.error = null; this.note = null;
        this.closed = false; this.limited = false;
      },
      onRun: async ({ loc, context, isCurrent, notify }) => {
        try {
          const res = await fetchChanges({ exec, cwd: loc.cwd, on: loc.on, root: this.root, gitDir: this.gitDir, mode: loc.view, bases: this.bases });
          if (!isCurrent()) return null;
          if (res.notRepo) {
            this.root = null; this.gitDir = null; this.files = []; this.setLines([]); this.open = null;
            this.branch = null; this.base = null; this.mergeBase = null; this.onBase = false; this.bases = null;
            this.error = "Not a git repository";
            return null;
          }
          this.root = res.root; this.gitDir = res.gitDir; this.on = loc.on; this.hasHead = res.hasHead;
          this.files = res.files; this.limited = res.limited; this.error = null;
          this.branch = res.branch ?? null; this.base = res.base ?? null; this.mergeBase = res.mergeBase ?? null; this.onBase = Boolean(res.onBase);
          this.bases = res.bases ?? null;
          if (this.open && !res.files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
          // The first file's diff shows until you pick another.
          if (!this.open && !this.closed && res.files.length) this.open = res.files[0].path;
          // Paint the updated file list immediately before loading the open file's diff.
          notify();
          if (this.open) {
            try { await this.load(this.open, context); }
            catch { if (isCurrent()) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
          }
          return { root: res.root, gitDir: res.gitDir };
        } catch (e) {
          if (isCurrent()) this.error = String(e);
          return this.root ? { root: this.root, gitDir: this.gitDir } : null;
        }
      },
      onWatchError: (dir, e) => {
        console.log(`dock-changes: watch of ${dir} failed, polling: ${e?.message ?? e}`);
      },
    });
    if (checking()) return;
    if (this.shown()) this.sync.refresh(runCtx(cx));
    else this.sync.setVisible(false, runCtx(cx));
    cx.timer.every(POLL_MS, (cx) => this.sync.tick(runCtx(cx)));
  }

  close() {
    this.sync?.close();
  }

  // While it is the right panel's shown mod (or placed anywhere else).
  shown() {
    if (props()?.dockRegion !== "right") return true;
    const applied = shared("dock.config.applied");
    return rightShownOf(shared("dock.right.shown"), applied) && rightActiveOf(shared("dock.right.active"), applied?.right?.features ?? []) === MOD;
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    // The branch view compares with the merge base; the uncommitted view with HEAD.
    const against = this.mergeBase ? [this.mergeBase] : this.hasHead ? ["HEAD"] : [];
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map((l) => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...GIT_READ, "diff", ...against, "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map((line) => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...this.rows.map((row) => (row.text.length + 1) * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.sync.busy || this.sync.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.sync.setBusy(true); this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        // Still the same folder, whichever view is showing now.
        if (folderOf(key()) === folderOf(context)) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (folderOf(key()) === folderOf(context)) this.note = `Commit failed: ${e}`; }
      finally { this.sync.setBusy(false, runCtx(cx)); cx.notify(); }
    });
    cx.notify();
  }

  viewTabs(t, view) {
    return h_flex().flex_none().child(Tabs.new("changes-view").flex().flex_row().gap(2).p(2).rounded(7).bg(t.background)
      .border_1().border_color(t.border)
      .children(VIEWS.map(([value, text], i) => Tab.new(`changes-view-${value}`).selected(view === value).set_position(i + 1, VIEWS.length)
        .flex().flex_row().items_center().h(18).px(8).rounded(5).text_size(11)
        .when(view === value, (el) => el.bg(t.selected).text_color(t.foreground))
        .when(view !== value, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click(() => setShared(VIEW_KEY, value))
        .child(text))));
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    const visible = this.shown();
    if (!checking()) {
      const ctx = runCtx(cx);
      this.sync.setVisible(visible, ctx);
      if (visible && key() !== this.context) this.sync.refresh(ctx);
    }
    if (!visible) return div();
    const loading = this.sync.loading, busy = this.sync.busy;
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !busy && !loading);
    const view = viewOf(shared(VIEW_KEY));
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(v_flex().flex_none().px(14).py(8).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().h(24).gap(8).items_center()
          .child(div().font_semibold().child("Changes"))
          .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
          .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
        .child(h_flex().h(24).gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(followsLine({ root: this.root, branch: this.branch, view, base: this.base })))
          .child(this.viewTabs(t, view))))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).max_h(this.files.length * 28 + 12).relative().border_b(1).border_color(t.border)
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f) => {
          const parts = f.path.split("/"), name = parts.pop();
          return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
            .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
            .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
            .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
        })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(emptyText({ view, error: this.error, loading, root: this.root, branch: this.branch, base: this.base, mergeBase: this.mergeBase, onBase: this.onBase })))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, (el) => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(busy ? "Committing…" : "Commit")));
  }
}
