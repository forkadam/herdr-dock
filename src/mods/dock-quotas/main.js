// Agent quotas, grouped by provider: Claude's 5-hour and weekly windows (from the status-line cache) and
// Codex's (from its newest session log), each under its provider's icon.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, props, checking, home, readTextFile, watchFolder, exec, knownAgents, window } from "herdr";
import { featureMode, iconRail, requestFocus } from "../_feature.js";
import { parseStatusline } from "../../shared/claude.js";
import { codexSessionDirs, newestRollout, parseCodexUsage } from "../../shared/codex.js";
import { listFilesCommand, parseFileListing } from "../../shared/platform.js";
import { slashPath } from "../../shared/path.js";
import { quotaGroups, iconBadge, barLevel } from "./view.js";

const REFRESH_MS = 30000;
// A watch that resolves with no changed paths waits this long before re-arming (no tight loop).
const EMPTY_WATCH_MS = 1000;
const WARN = "#d29922";
const HIGH = "#f85149";

export default class Quotas extends View {
  init(_props, cx) {
    this.statusline = null;
    this.codex = null;
    this.icons = {}; // agent key -> { icon, tint } from Herdr's agent table
    if (checking()) return;
    cx.spawn(async (cx) => {
      try {
        for (const a of await knownAgents()) if (a?.key && a.icon) this.icons[a.key] = { icon: a.icon, tint: Boolean(a.tint) };
        cx.notify();
      } catch (e) { console.log(`dock-quotas: agent icons unavailable: ${e}`); }
    });
    cx.timer.every(REFRESH_MS, (cx) => this.reload(cx));
    const dir = slashPath(home()) + "/.claude/statusline-cache";
    this.reload(cx);
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const changed = await watchFolder(dir);
          if (!changed?.length) { await cx.sleep(EMPTY_WATCH_MS); continue; }
          this.reload(cx);
        }
      } catch (e) {
        console.log(`dock-quotas: watch ended, using the timer: ${e}`);
      }
    });
  }

  // One read at a time; a request meanwhile runs once more after it.
  reload(cx) {
    if (this.reading) { this.again = true; return; }
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        do {
          this.again = false;
          const text = await readTextFile(slashPath(home()) + "/.claude/statusline-cache/claude-statusline.json").catch(() => null);
          this.statusline = parseStatusline(text, Date.now());
          this.codex = await this.readCodex();
          cx.notify();
        } while (this.again);
      } catch (e) {
        console.log(`dock-quotas: read failed: ${e}`);
        this.statusline = null;
        cx.notify();
      } finally {
        this.reading = false;
      }
    });
  }

  // Codex's newest session log with rate limits, from the last 8 days' folders (~/.codex/sessions).
  // Folders that don't exist list nothing; the first log holding rate_limits wins (newest first).
  async readCodex() {
    const platform = window()?.platform;
    const now = Date.now();
    for (const dir of codexSessionDirs(slashPath(home()) + "/.codex", now)) {
      const { command, args } = listFilesCommand(platform, dir);
      const r = await exec(command, args).catch(() => null);
      if (!r || r.code !== 0) continue;
      let names = parseFileListing(platform, r.stdout);
      for (let i = 0; i < 3; i++) { // a brand-new session may have no rate_limits yet: try two older ones
        const name = newestRollout(names);
        if (!name) break;
        const usage = parseCodexUsage(await readTextFile(`${dir}/${name}`).catch(() => null), now);
        if (usage) return usage;
        names = names.filter((n) => n !== name);
      }
    }
    return null;
  }

  groupHeader(t, g, i) {
    const ic = this.icons[g.agent];
    const face = ic
      ? (ic.tint ? svg(ic.icon).size(13).text_color(t.muted) : image(ic.icon).size(13))
      : div().size(13).flex().items_center().justify_center().text_size(10).font_semibold().text_color(t.dim).child(g.title.slice(0, 1));
    return h_flex().id(`quota-group-${i}`).px(16).pt(i ? 8 : 2).pb(1).gap(6).flex_none().items_center()
      .child(face).child(div().text_size(11.5).font_medium().text_color(t.muted).child(g.title));
  }

  header(t, onTitle) {
    const title = div().text_size(11.5).font_medium().text_color(t.dim).child("Quotas");
    return h_flex().px(16).h(onTitle ? 31 : 41).pt(onTitle ? 0 : 14).pb(onTitle ? 0 : 5).flex_none().items_center()
      .child(onTitle
        ? title.id("dock-quotas-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Quotas").on_click(() => onTitle())
        : title);
  }

  row(t, r, i) {
    const color = { ok: t.accent, warn: WARN, high: t.blocked ?? HIGH }[barLevel(r.percent ?? 0)];
    const pct = Math.max(0, Math.min(100, r.percent ?? 0));
    return v_flex().id(`quota-${i}`).px(16).py(4).gap(3).flex_none().tooltip(r.tooltip)
      .when(r.stale, (el) => el.opacity(0.55))
      .child(h_flex().items_center().gap(6)
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(r.label))
        .when(r.stale, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child("stale")))
        .child(div().flex_none().text_size(12).text_color(r.percent == null ? t.dim : t.muted).child(r.value)))
      .when(r.percent != null, (el) => el.child(div().w_full().h(4).rounded(2).bg(t.border).overflow_hidden()
        .child(div().w(`${pct}%`).h(4).rounded(2).bg(color))))
      .child(div().truncate().text_size(11).text_color(t.dim).child(r.detail));
  }

  render(cx) {
    const t = theme();
    const myId = props()?.dockFeature ?? "dock-quotas";
    const face = featureMode(shared("dock.left.mode"), shared("dock.left.focus"), myId, props()?.dockRegion);
    if (face === "icon") {
      const b = iconBadge([this.statusline, this.codex]);
      const rail = iconRail(t, "mods/dock-quotas/icon.svg", "Quotas", () => requestFocus(myId));
      if (!b) return rail;
      const p = parseInt(b.text, 10);
      const color = barLevel(p) === "ok" ? t.muted : barLevel(p) === "warn" ? WARN : (t.blocked ?? HIGH);
      return rail.child(div().id("quota-badge").text_size(10).text_color(color)
        .when(b.stale, (el) => el.opacity(0.55))
        .tooltip(b.stale ? `${p}% used · stale` : `${p}% used`)
        .child(b.text));
    }
    if (face === "collapsed") {
      return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
        .child(this.header(t, () => requestFocus(myId)));
    }
    const groups = quotaGroups({ claude: this.statusline, codex: this.codex }, Date.now());
    let n = 0;
    return v_flex().id("dock-quotas-list").size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).overflow_y_scrollbar()
      .child(this.header(t, null))
      .when(!groups.length, (el) => el.child(div().px(16).py(4).text_size(12).text_color(t.dim)
        .tooltip("Claude: start Claude Code with the herdr-dock status line. Codex: use it once.")
        .child("no usage recorded yet")))
      .children(groups.flatMap((g, gi) => [this.groupHeader(t, g, gi), ...g.rows.map((r) => this.row(t, r, n++))]));
  }
}
