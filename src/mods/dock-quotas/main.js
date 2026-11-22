// Agent quotas, grouped by provider: Claude's 5-hour and weekly windows (from the status-line cache) and
// Codex's (from its newest session log), each under its provider's icon.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, props, checking, home, readTextFile, watchFolder, exec, knownAgents, window } from "herdr";
import { featureMode, iconRail, requestFocus } from "../_feature.js";
import { parseStatusline } from "../../shared/claude.js";
import { codexSessionDirs, parseCodexUsage, pickNewestUsage } from "../../shared/codex.js";
import { listDirCommand, listFilesByTimeCommand, parseFileListing, rateLimitLinesCommand } from "../../shared/platform.js";
import { slashPath } from "../../shared/path.js";
import { quotaGroups, iconBadge, barLevel } from "./view.js";

const REFRESH_MS = 30000;
// No ~/.codex/sessions: look again after this long (a few processes per check on Windows).
const CODEX_ABSENT_MS = 300000;
// A watch that resolves with no changed paths waits this long before re-arming (no tight loop).
const EMPTY_WATCH_MS = 1000;
const TOP_KEY = "dock.quotas.top";
// dock.quotas.top's `at` is refreshed once it is this old (with the 30 s timer: at most ~60 s old).
const TOP_REFRESH_MS = 55000;
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
    this.codexNextAt = 0;
    // Claude reloads on every status-line write (the watch below) and on the timer; Codex only on the timer.
    cx.timer.every(REFRESH_MS, (cx) => { this.reload(cx); this.reloadCodex(cx); });
    const dir = slashPath(home()) + "/.claude/statusline-cache";
    this.reload(cx);
    this.reloadCodex(cx);
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
          this.publishTop();
          cx.notify();
        } while (this.again);
      } catch (e) {
        console.log(`dock-quotas: read failed: ${e}`);
        this.statusline = null;
        this.publishTop();
        cx.notify();
      } finally {
        this.reading = false;
      }
    });
  }

  reloadCodex(cx) {
    if (this.codexReading || Date.now() < this.codexNextAt) return;
    this.codexReading = true;
    cx.spawn(async (cx) => {
      try {
        this.codex = await this.readCodex();
      } catch (e) {
        console.log(`dock-quotas: Codex read failed: ${e}`);
        this.codex = null;
      } finally {
        this.codexReading = false;
        this.publishTop();
        cx.notify();
      }
    });
  }

  // The highest used % across Claude and Codex, for the bottom bar's warnings: shared dock.quotas.top =
  // { p, stale, at } (at: when it was published), or null with no reading. Written when p or stale changes,
  // and again once `at` is TOP_REFRESH_MS old (the 30 s timer calls this), so a reading that stops being
  // refreshed (this mod unmounted or stuck) ages out of the warnings after 120 s.
  publishTop() {
    const now = Date.now();
    const b = iconBadge([this.statusline, this.codex], now);
    const prev = shared(TOP_KEY) ?? null;
    if (!b) { if (prev !== null) setShared(TOP_KEY, null); return; }
    const p = parseInt(b.text, 10), stale = b.stale;
    const same = prev && prev.p === p && prev.stale === stale && Number.isFinite(prev.at) && now - prev.at < TOP_REFRESH_MS;
    if (!same) setShared(TOP_KEY, { p, stale, at: now });
  }

  // Codex's latest rate limits: in each of the last 8 days' session folders (newest first), the most
  // recently modified logs; only their "rate_limits" lines are read (logs can be many MB). The newest
  // reading among the first 3 folders that have logs wins, so a long or resumed session in an older
  // folder still counts. No ~/.codex/sessions: nothing, and no look again for 5 minutes.
  async readCodex() {
    const platform = window()?.platform;
    const now = Date.now();
    const root = slashPath(home()) + "/.codex";
    const probe = listDirCommand(platform, root + "/sessions");
    const has = await exec(probe.command, probe.args).catch(() => null);
    if (!has || has.code !== 0) {
      this.codexNextAt = now + CODEX_ABSENT_MS;
      return null;
    }
    const found = [];
    let folders = 0;
    for (const dir of codexSessionDirs(root, now)) {
      if (folders >= 3) break;
      const ls = listFilesByTimeCommand(platform, dir);
      const r = await exec(ls.command, ls.args).catch(() => null);
      if (!r || r.code !== 0) continue;
      const logs = parseFileListing(platform, r.stdout).filter((n) => /^rollout-.*\.jsonl$/.test(n));
      if (!logs.length) continue;
      folders++;
      for (const name of logs.slice(0, 3)) { // a brand-new session may have no rate_limits yet
        const g = rateLimitLinesCommand(platform, `${dir}/${name}`);
        const lines = await exec(g.command, g.args).catch(() => null);
        const usage = lines && lines.code === 0 ? parseCodexUsage(lines.stdout, now) : null;
        if (usage) { found.push(usage); break; }
      }
    }
    return pickNewestUsage(found);
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
      const b = iconBadge([this.statusline, this.codex], Date.now());
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
    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .child(this.header(t, null))
      .child(v_flex().id("dock-quotas-list").flex_1().min_h(0).overflow_y_scrollbar()
      .when(!groups.length, (el) => el.child(div().px(16).py(4).text_size(12).text_color(t.dim)
        .tooltip("Claude: start Claude Code with the herdr-dock status line. Codex: use it once.")
        .child("no usage recorded yet")))
      .children(groups.flatMap((g, gi) => [this.groupHeader(t, g, gi), ...g.rows.map((r) => this.row(t, r, n++))])));
  }
}
