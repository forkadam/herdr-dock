import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  appHome, checking, exec, nextCommand, props, readTextFile, run, setShared, shared, theme,
  watchFolder, window, writeTextFile,
} from "herdr";
import { planApply } from "../../shared/config.js";
import { leftFeatureIds } from "../../shared/layout.js";
import { nextMode, panelActions, planSync } from "../../shared/panel.js";
import { slashPath } from "../../shared/path.js";

const MODES = ["expanded", "icons", "hidden"];
const MODE_KEY = "dock.left.mode";
const FOCUS_KEY = "dock.left.focus";
const ERROR_KEY = "dock.config.error";
// After writing the layout file, give Herdr time to reload it before re-applying the mode.
const RELOAD_SETTLE_MS = 400;
// Fallback when watchFolder rejects (too many watches, etc.).
const POLL_MS = 3000;

const isTop = () => props()?.dockRegion === "top";

export default class DockCore extends View {
  init(_props, cx) {
    this.merged = null; // last good merged config
    this.applied = null; // "<mode>|<focus>" last applied, so each change is applied once
    this.host = "";
    this.configPath = null;
    this.layoutPath = null;
    if (checking() || !isTop()) return;
    cx.spawn(async (cx) => this.start(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        this.command(c, cx);
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
    try {
      const linux = window()?.platform === "linux";
      const r = linux ? await exec("uname", ["-n"]) : await exec("hostname");
      this.host = r.stdout.trim().toLowerCase();
    } catch (e) {
      console.log(`dock-core: hostname failed, using the base config: ${e}`);
    }
    await this.reload(cx);
    const dir = this.configPath.slice(0, this.configPath.lastIndexOf("/")) || "/";
    for (;;) {
      try {
        await watchFolder(dir);
      } catch (e) {
        console.log(`dock-core: watch failed, polling: ${e}`);
        await cx.sleep(POLL_MS);
      }
      await this.reload(cx);
    }
  }

  // Re-read the config; write the layout only when it changed and the config is valid.
  async reload(cx) {
    if (!this.configPath || checking()) return;
    const configText = await readTextFile(this.configPath).catch(() => null);
    const current = await readTextFile(this.layoutPath).catch(() => null);
    const plan = planApply(configText, this.host, current, this.merged);
    if ((shared(ERROR_KEY) ?? null) !== plan.error) setShared(ERROR_KEY, plan.error);
    this.merged = plan.merged;
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

  mode() {
    const m = shared(MODE_KEY);
    if (MODES.includes(m)) return m;
    return this.merged?.regions.left.mode ?? "expanded";
  }

  command(c, cx) {
    if (c === "reload") {
      cx.spawn(async (cx) => this.reload(cx));
      return;
    }
    const mode = c === "cycle" ? nextMode(this.mode()) : MODES.includes(c) ? c : null;
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

  apply(key, mode, focus, clearFocus) {
    // A newer change was planned before this task ran: its own task applies it.
    if (!this.merged || this.applied !== key) return;
    for (const a of panelActions(mode, this.merged, focus)) {
      try { run(a.command, a.args); } catch (e) { console.log(`dock-core: ${a.command} failed: ${e}`); }
    }
    if (shared(MODE_KEY) !== mode) setShared(MODE_KEY, mode);
    if (clearFocus) setShared(FOCUS_KEY, null);
  }

  render(cx) {
    if (!isTop()) return div();
    this.sync(cx);
    const t = theme();
    const mode = this.mode();
    const err = shared(ERROR_KEY);
    const stop = (_e, cx) => cx.stop_propagation();
    return h_flex().size_full().px(8).gap(6).items_center()
      .child(div().id("dock-toggle").size(28).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .tooltip(`Left panel: ${mode} (Ctrl+Alt+B)`)
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.command("cycle", cx); })
        .child(svg(`mods/dock-core/panel-${mode}.svg`).size(16)))
      .when(typeof err === "string" && err !== "", (el) => el.child(
        div().id("dock-error").size(18).flex_none().flex().items_center().justify_center()
          .tooltip(`Config error: ${err}`)
          .on_mouse_down("left", stop)
          .child(div().size(8).rounded_full().bg(t.ansi1 ?? "#e5484d"))));
  }
}
