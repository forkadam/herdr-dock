import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  appHome, checking, exec, nextCommand, props, readTextFile, run, setShared, shared, theme,
  watchFolder, window, writeTextFile,
} from "herdr";
import { planApply } from "../../shared/config.js";
import { leftFeatureIds } from "../../shared/layout.js";
import { nextMode, panelActions } from "../../shared/panel.js";
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
      try {
        await writeTextFile(this.layoutPath, plan.write, current);
      } catch (e) {
        // The file changed between read and write: the next batch retries.
        console.log(`dock-core: layout write skipped: ${e}`);
      }
      // A rewritten layout reloads its sizes and visibility: put the current mode back on it.
      await cx.sleep(RELOAD_SETTLE_MS);
      this.applied = null;
    }
    cx.notify();
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
    if (mode) setShared(MODE_KEY, mode); // render notices and applies it
  }

  // Called from render: notice a mode or focus change (ours or a feature's) and apply it once.
  sync(cx) {
    if (!this.merged) return;
    const mode = this.mode();
    const requested = shared(FOCUS_KEY) ?? null;
    let focus = mode === "expanded" ? requested : null;
    if (focus !== null && !leftFeatureIds(this.merged).includes(focus)) focus = null;
    const key = `${mode}|${focus}`;
    if (key === this.applied) return;
    this.applied = key;
    // A focus request is consumed only once the panel is expanded (a feature sets focus, then mode).
    const clearFocus = mode === "expanded" && requested !== null;
    cx.spawn(async (_cx) => this.apply(mode, focus, clearFocus));
  }

  apply(mode, focus, clearFocus) {
    if (!this.merged) return;
    for (const a of panelActions(mode, this.merged, focus)) {
      try { run(a.command, a.args); } catch (e) { console.log(`dock-core: ${a.command} failed: ${e}`); }
    }
    if (shared(MODE_KEY) !== mode) setShared(MODE_KEY, mode);
    if (clearFocus) {
      // Keep the focused arrangement: clearing the key must not re-apply plain "expanded".
      this.applied = `${mode}|null`;
      setShared(FOCUS_KEY, null);
    }
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
