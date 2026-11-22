import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  agents, appHome, checking, exec, layout, nextCommand, notify, openOverlay, panes, playSound, props, readTextFile, run,
  setShared, shared, spaces, theme, watchFolder, window, writeTextFile,
} from "herdr";
import { createCollector } from "../../shared/collector.js";
import { planApply } from "../../shared/config.js";
import { leftFeatureIds } from "../../shared/layout.js";
import {
  liveRight, liveSizes, modeFromConfig, nextMode, planPanel, planRight, planSync, rightConfigUpdate, rightShownOf, sizesSnapshot,
  sizeChanges,
} from "../../shared/panel.js";
import { slashPath } from "../../shared/path.js";
import { parseGitCommand, revealPlan, showPlan } from "../../shared/gitcmd.js";
import { HISTORY_KEY, historyOf, markAllRead, resolveItems } from "../../shared/notify.js";
import { NOTIFY_DIALOG, applyNotifyCommand, parseNotifyCommand } from "../../shared/notifycmd.js";
import { hostnameCommand, openUrlCommand } from "../../shared/platform.js";

const MODES = ["expanded", "icons", "hidden"];
const MODE_KEY = "dock.left.mode";
const FOCUS_KEY = "dock.left.focus";
const ERROR_KEY = "dock.config.error";
// Read by the config dialog: where dock.json lives, this computer's host, and the last good
// merged regions (what a read-only dialog shows when dock.json is invalid).
const HOST_KEY = "dock.host";
const PATH_KEY = "dock.config.path";
const APPLIED_KEY = "dock.config.applied";
// The person's left-panel sizes, saved while the panel is at the icon rail or focused (null
// while the live tree holds them). Machine-local, like the drag-resizes it keeps.
const RESTORE_KEY = "dock.left.restore";
// The config's left mode when dock-core last read it, so an edit to it is noticed once.
const CONFIG_MODE_KEY = "dock.left.configMode";
// This PC's right panel (never in the config): whether it is shown, which right mod it shows
// (the rail and dock-tabs set these), and the config's right.hidden when last read (so an edit to
// it applies once).
// The left sizes last applied (sizesSnapshot): a config size edit made while dock-core wasn't running applies on start.
const SIZES_KEY = "dock.left.appliedSizes";
const RIGHT_KEY = "dock.right.shown";
const ACTIVE_KEY = "dock.right.active";
const RIGHT_CONFIG_KEY = "dock.right.configHidden";
// After writing the layout file, give Herdr time to reload it before re-applying the mode.
const RELOAD_SETTLE_MS = 400;
// Fallback when watchFolder rejects (too many watches, etc.).
const POLL_MS = 3000;
// A watch that resolves with no changed paths waits this long before re-arming (no tight loop).
const EMPTY_WATCH_MS = 1000;
// The git/CI collector's tick: it compares io.now() each tick, so this is its scheduling resolution.
const TICK_MS = 1000;

const isTop = () => props()?.dockRegion === "top";

export default class DockCore extends View {
  init(_props, cx) {
    this.merged = null; // last good merged config
    this.applied = null; // "<mode>|<focus>" last applied, so each change is applied once
    this.changes = null; // config size edits (sizeChanges) not applied yet
    this.host = "";
    this.hostError = null; // set when neither the hostname command nor source.json gave one
    this.configPath = null;
    this.layoutPath = null;
    this.collector = null;
    this.notifySeq = 0; // with Date.now(), makes this PC's history item ids unique
    if (checking() || !isTop()) return;
    cx.spawn(async (cx) => this.start(cx));
    this.startCollector(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        // No command, however malformed, may end this loop: dock-core would stop taking every command.
        try { this.command(c, cx); } catch (e) { console.log(`dock-core: command ${c} failed: ${e?.message ?? e}`); }
        cx.notify();
      }
    });
  }

  async start(cx) {
    const home = slashPath(appHome());
    this.layoutPath = `${home}/layouts/herdr-dock.json`;
    let src = null;
    try { src = JSON.parse((await readTextFile(`${home}/mods/dock-core/source.json`)) ?? "null"); } catch { src = null; }
    if (typeof src?.config !== "string") {
      setShared(ERROR_KEY, "mods/dock-core/source.json is missing: run npm run deploy");
      cx.notify();
      return;
    }
    this.configPath = slashPath(src.config);
    setShared(PATH_KEY, this.configPath);
    // The hostname picks the machines.<host> section: ask the OS, else use the one deploy saved.
    try {
      const { command, args } = hostnameCommand(window()?.platform);
      this.host = (await exec(command, args)).stdout.trim().toLowerCase();
    } catch (e) {
      console.log(`dock-core: hostname failed, using source.json: ${e}`);
    }
    if (!this.host && typeof src.hostname === "string" && src.hostname.trim()) this.host = src.hostname.trim().toLowerCase();
    setShared(HOST_KEY, this.host || null);
    if (!this.host) this.hostError = "could not read this computer's hostname: machines sections are ignored (re-run npm run deploy)";
    await this.reload(cx);
    const dir = this.configPath.slice(0, this.configPath.lastIndexOf("/")) || "/";
    for (;;) {
      try {
        const changed = await watchFolder(dir);
        if (!changed?.length) { await cx.sleep(EMPTY_WATCH_MS); continue; }
      } catch (e) {
        console.log(`dock-core: watch failed, polling: ${e}`);
        await cx.sleep(POLL_MS);
      }
      await this.reload(cx);
    }
  }

  // The git/CI collector runs here, in the one top copy: it publishes dock.git.* for dock-git and
  // dock-pipelines. Ticks are not awaited: a tick waits on its CI requests, and the next tick is what times
  // them out (the collector's busy flags keep overlapping ticks from repeating work).
  startCollector(cx) {
    const platform = window()?.platform;
    this.platform = platform;
    // A collector that fails to start leaves Git projects empty but never takes dock-core (layout, panels) down.
    // The tick still runs: it also resolves the notification history.
    try {
      this.collector = createCollector({
        exec, fetch: (url, init) => globalThis.fetch(url, init), panes, spaces, shared, setShared, notify, playSound,
        platform, now: Date.now, log: (m) => console.log(`dock-core: ${m}`),
      });
    } catch (e) {
      this.collector = null;
      console.log(`dock-core: git collector failed to start: ${e?.message ?? e}`);
    }
    cx.spawn(async (cx) => {
      for (;;) {
        this.collector?.tick().catch((e) => console.log(`dock-core: git tick failed: ${e?.message ?? e}`));
        try { this.resolveNotify(); } catch (e) { console.log(`dock-core: notify resolve failed: ${e?.message ?? e}`); }
        await cx.sleep(TICK_MS);
      }
    });
  }

  // A git.* command (see src/mods/_git-command.js). Returns false when c isn't one.
  gitCommand(c) {
    const g = parseGitCommand(c);
    if (!g) return false;
    const col = this.collector;
    if (!col) return true;
    const fail = (what) => (e) => console.log(`dock-core: git.${what} failed: ${e?.message ?? e}`);
    const open = (url) => {
      if (!url) return;
      const { command, args } = openUrlCommand(this.platform, url);
      exec(command, args).catch(fail("open"));
    };
    if (g.cmd === "refresh") col.refresh();
    else if (g.cmd === "retry") col.retry().catch(fail("retry"));
    else if (g.cmd === "open") open(col.urlFor("pipeline"));
    else if (g.cmd === "open.job") open(col.urlFor({ job: g.index }));
    else if (g.cmd === "select") col.select(g.worktree).catch(fail("select"));
    else if (g.cmd === "delete") col.deleteWorktree(g.worktree).catch(fail("delete"));
    else if (g.cmd === "show") {
      const worktree = g.worktree ?? shared("dock.git.selected") ?? null;
      if (worktree) col.select(worktree).catch(fail("select"));
      this.reveal(showPlan(this.merged), fail("show"));
    }
    return true;
  }

  // Applies a revealPlan: the right panel's shared keys, else the dialog.
  reveal(plan, fail) {
    if (plan.set) for (const [k, v] of Object.entries(plan.set)) setShared(k, v);
    else {
      try { openOverlay(plan.overlay); } catch (e) { fail(e); }
    }
  }

  // A notify.* command (see src/mods/_notify-command.js): dock-core is the one writer of the history.
  // Returns false when c isn't one.
  notifyCommand(c) {
    const cmd = parseNotifyCommand(c);
    if (!cmd) return false;
    const history = historyOf(shared(HISTORY_KEY));
    if (cmd.cmd === "show") {
      setShared(HISTORY_KEY, markAllRead(history));
      this.reveal(revealPlan(this.merged, "dock-notifications", NOTIFY_DIALOG),
        (e) => console.log(`dock-core: notify.show failed: ${e?.message ?? e}`));
      return true;
    }
    const id = `${Date.now().toString(36)}-${(this.notifySeq++).toString(36)}`;
    setShared(HISTORY_KEY, applyNotifyCommand(history, cmd, Date.now(), id));
    return true;
  }

  // Each tick: mark needs-you items whose cause is fixed, writing the history only when one changed.
  resolveNotify() {
    const history = historyOf(shared(HISTORY_KEY));
    if (!history.length) return;
    let list;
    try { list = agents(); } catch { list = undefined; } // unknown agents leave agent items unresolved
    const next = resolveItems(history, { agents: list, gitState: shared("dock.git.state") });
    if (next !== history) setShared(HISTORY_KEY, next);
  }

  // Re-read the config; write the layout only when it changed and the config is valid.
  async reload(cx) {
    if (!this.configPath || checking()) return;
    const configText = await readTextFile(this.configPath).catch(() => null);
    const current = await readTextFile(this.layoutPath).catch(() => null);
    // Parse first, decide this PC's right panel state from the new config, then build the layout
    // file with it, so the file already matches what the panel should be.
    let plan = planApply(configText, this.host, current, this.merged);
    if (!plan.error && plan.merged) {
      const active = shared(ACTIVE_KEY);
      const u = rightConfigUpdate({
        prev: this.merged, merged: plan.merged,
        saved: { shown: shared(RIGHT_KEY), active, configHidden: shared(RIGHT_CONFIG_KEY) },
      });
      for (const [key, value] of Object.entries(u.set)) setShared(key, value);
      plan = planApply(configText, this.host, current, this.merged, u.state);
    }
    const error = plan.error ?? this.hostError;
    if ((shared(ERROR_KEY) ?? null) !== error) setShared(ERROR_KEY, error);
    // Compare with the sizes last applied, which survive dock-core not running (another layout shown), so a
    // config size edit made meanwhile still applies.
    const before = this.merged ?? shared(SIZES_KEY) ?? null;
    const changes = plan.error ? null : sizeChanges(before, plan.merged);
    this.merged = plan.merged;
    if (!plan.error && plan.merged) {
      const snap = sizesSnapshot(plan.merged);
      if (JSON.stringify(shared(SIZES_KEY) ?? null) !== JSON.stringify(snap)) setShared(SIZES_KEY, snap);
      const regions = JSON.parse(JSON.stringify(plan.merged.regions));
      regions.left.hidden = false;
      if (JSON.stringify(shared(APPLIED_KEY) ?? null) !== JSON.stringify(regions)) setShared(APPLIED_KEY, regions);
      // A changed regions.left.mode (or left.hidden) in a valid config becomes the panel mode.
      const m = modeFromConfig(shared(CONFIG_MODE_KEY), shared(MODE_KEY), plan.merged.regions.left.mode);
      if (m) {
        setShared(CONFIG_MODE_KEY, m.record);
        if (m.mode) {
          if ((shared(FOCUS_KEY) ?? null) !== null) setShared(FOCUS_KEY, null);
          setShared(MODE_KEY, m.mode);
        }
      }
    }
    if (plan.write) {
      const err = await this.writeLayout(plan.write, current);
      if (err) setShared(ERROR_KEY, err);
      // A rewritten layout reloads its sizes and visibility: put the current mode back on it.
      // Risk: if Herdr's layout reload takes longer than this wait, the mode is re-applied to the
      // old tree and the reload then wins, leaving the panel out of sync with dock.left.mode until
      // the next toggle or config change.
      await cx.sleep(RELOAD_SETTLE_MS);
      this.applied = null;
    }
    if (changes) {
      this.changes = changes;
      this.applied = null;
    }
    cx.notify();
  }

  // writeTextFile rejects when the file changed since `current` was read (a stale snapshot):
  // re-read it and try once more. Returns an error message, or null when written.
  async writeLayout(text, current) {
    try {
      await writeTextFile(this.layoutPath, text, current);
      return null;
    } catch (first) {
      console.log(`dock-core: layout write failed, retrying: ${first}`);
      try {
        const fresh = await readTextFile(this.layoutPath).catch(() => null);
        if (fresh !== text) await writeTextFile(this.layoutPath, text, fresh);
        return null;
      } catch (e) {
        return `could not write layout: ${e}`;
      }
    }
  }

  rightShown() {
    return rightShownOf(shared(RIGHT_KEY), this.merged?.regions);
  }


  mode() {
    const m = shared(MODE_KEY);
    if (MODES.includes(m)) return m;
    return this.merged?.regions.left.mode ?? "expanded";
  }

  command(c, cx) {
    if (this.gitCommand(c)) return;
    if (this.notifyCommand(c)) return;
    if (c === "reload") {
      cx.spawn(async (cx) => this.reload(cx));
      return;
    }
    if (c === "right") {
      setShared(RIGHT_KEY, !this.rightShown());
      return;
    }
    if (c === "config") {
      run("mod.open", { name: "dock-config" });
      return;
    }
    // From a focused expanded panel, the cycle first goes back to plain expanded.
    const mode = c === "cycle" ? nextMode(this.mode(), shared(FOCUS_KEY) ?? null) : MODES.includes(c) ? c : null;
    if (!mode) return;
    // A mode change by the person ends any feature's focus request; render applies the result.
    if ((shared(FOCUS_KEY) ?? null) !== null) setShared(FOCUS_KEY, null);
    setShared(MODE_KEY, mode);
  }

  // Called from render: notice a mode or focus change (ours or a feature's) and apply it once.
  // The focus stays in shared state while the panel is expanded (features read it to collapse).
  sync(cx) {
    if (!this.merged) return;
    const mode = this.mode();
    const plan = planSync({
      mode, focus: shared(FOCUS_KEY) ?? null, leftIds: leftFeatureIds(this.merged), applied: this.applied,
    });
    if (!plan) return;
    this.applied = plan.key;
    cx.spawn(async (_cx) => this.apply(plan.key, mode, plan.focus, plan.clearFocus));
  }

  // Called from render: keep the live right panel (shown, which mod) in line with this PC's state.
  syncRight(cx) {
    if (!this.merged) return;
    let live;
    try { live = liveRight(layout()); } catch (e) { console.log(`dock-core: layout() failed: ${e}`); return; }
    const actions = planRight({
      shown: this.rightShown(), active: shared(ACTIVE_KEY), features: this.merged.regions.right.features, live,
    });
    if (!actions.length) return;
    cx.spawn(async (_cx) => {
      for (const a of actions) {
        try { run(a.command, a.args); } catch (e) { console.log(`dock-core: ${a.command} failed: ${e}`); }
      }
    });
  }

  apply(key, mode, focus, clearFocus) {
    // A newer change was planned before this task ran: its own task applies it.
    if (!this.merged || this.applied !== key) return;
    let live = null;
    try { live = liveSizes(layout(), this.merged); } catch (e) { console.log(`dock-core: layout() failed: ${e}`); }
    const restore = shared(RESTORE_KEY) ?? null;
    const plan = planPanel({ mode, focus, merged: this.merged, live, restore, changes: this.changes });
    this.changes = null;
    for (const a of plan.actions) {
      try { run(a.command, a.args); } catch (e) { console.log(`dock-core: ${a.command} failed: ${e}`); }
    }
    if (JSON.stringify(plan.restore) !== JSON.stringify(restore)) setShared(RESTORE_KEY, plan.restore);
    if (shared(MODE_KEY) !== mode) setShared(MODE_KEY, mode);
    if (clearFocus) setShared(FOCUS_KEY, null);
  }

  render(cx) {
    if (!isTop()) return div();
    this.sync(cx);
    this.syncRight(cx);
    const t = theme();
    const mode = this.mode();
    const err = shared(ERROR_KEY);
    const stop = (_e, cx) => cx.stop_propagation();
    return h_flex().size_full().items_center().justify_center()
      .child(div().relative().size(28).flex_none()
        .child(div().id("dock-toggle").size_full().flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
          .tooltip(`Left panel: ${mode} (Ctrl+Alt+B)`)
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.command("cycle", cx); })
          .child(svg(`mods/dock-core/panel-${mode}.svg`).size(16)))
        .when(typeof err === "string" && err !== "", (el) => el.child(
          div().id("dock-error").absolute().top(-2).right(-2).size(10).flex().items_center().justify_center()
            .tooltip(`Config error: ${err}`)
            .on_mouse_down("left", stop)
            .child(div().size(8).rounded_full().bg(t.ansi1 ?? "#e5484d")))));
  }
}
