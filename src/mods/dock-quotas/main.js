// Agent quotas, grouped by provider: Claude's 5-hour and weekly windows (from the status-line cache) and
// Codex's (from its newest session log), each under its provider's icon.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, props, checking, home, appHome, readTextFile, watchFolder, exec, knownAgents, window } from "herdr";
import { exitTitle, featureMode, focusedNow, iconRail, requestFocus } from "../_feature.js";
import { parseStatusline } from "../../shared/claude.js";
import { mergeClaude, parseUsageOutput } from "../../shared/claude-usage.js";
import { codexSessionDirs, parseCodexUsage, pickNewestUsage } from "../../shared/codex.js";
import { AGY_MARK, WRITER_MARK, scriptPaths, statuslinePlan } from "../../shared/statusline.js";
import { listDirCommand, listFilesByTimeCommand, parseFileListing, rateLimitLinesCommand } from "../../shared/platform.js";
import { slashPath } from "../../shared/path.js";
import { quotaGroups, iconBadge, topQuota, barLevel, setupNotice, agySetupNotice, publishable } from "./view.js";
import { AGY_CACHE_REL, parseAgyCache } from "../../shared/antigravity.js";
import { WARN, HIGH, groupHeaderEl, quotaRowEl } from "./draw.js";

const REFRESH_MS = 30000;
// No ~/.codex/sessions: look again after this long (a few processes per check on Windows).
const CODEX_ABSENT_MS = 300000;
// A watch that resolves with no changed paths waits this long before re-arming (no tight loop).
const EMPTY_WATCH_MS = 1000;
const TOP_KEY = "dock.quotas.top";
// Quotas' readings for the bottom-bar strip (dock-limits): { claude, codex }, each publishable() or null.
const READINGS_KEY = "dock.quotas.readings";
// The tools whose status line feeds Quotas: where their settings live, the writer that line runs, how it's recognised,
// the setup script's extra argument, and the self-check's wording.
const TOOLS = {
  claude: { dir: ".claude", writer: "herdr-statusline-cache.mjs", mark: WRITER_MARK, args: [], notice: setupNotice },
  agy: { dir: ".gemini/antigravity-cli", writer: "herdr-agy-statusline.mjs", mark: AGY_MARK, args: ["--agy"], notice: agySetupNotice },
};
// Claude's limits from the claude CLI (get_usage, what /usage shows): asked this often. Cheap (~1 s), no model use.
const CLI_EVERY_MS = 5 * 60e3;
// dock.quotas.top's `at` is refreshed once it is this old (with the 30 s timer: at most ~60 s old).
const TOP_REFRESH_MS = 55000;
// With no Claude reading, the status-line self-check runs at most this often (and right after Set up).
const SETUP_CHECK_MS = 60000;

export default class Quotas extends View {
  init(_props, cx) {
    this.statusline = null; // the status-line cache (5-hour and weekly, fresh on every Claude reply)
    this.cli = null; // the claude CLI's reading (plan, per-model limits), every CLI_EVERY_MS
    this.cliAt = 0;
    this.codex = null;
    this.icons = {}; // agent key -> { icon, tint } from Herdr's agent table
    // The status-line self-checks, per tool (TOOLS): Claude Code's and Antigravity's.
    this.setups = { claude: { state: null, busy: false, error: null, nextAt: 0 }, agy: { state: null, busy: false, error: null, nextAt: 0 } };
    this.agy = null; // Antigravity's reading (its status-line cache)
    if (checking()) return;
    cx.spawn(async (cx) => {
      try {
        for (const a of await knownAgents()) if (a?.key && a.icon) this.icons[a.key] = { icon: a.icon, tint: Boolean(a.tint) };
        cx.notify();
      } catch (e) { console.log(`dock-quotas: agent icons unavailable: ${e}`); }
    });
    this.codexNextAt = 0;
    // Claude reloads on every status-line write (the watch below) and on the timer; Codex only on the timer.
    cx.timer.every(REFRESH_MS, (cx) => { this.reload(cx); this.reloadCodex(cx); this.reloadCli(cx); this.reloadAgy(cx); });
    this.reloadCli(cx);
    this.reloadAgy(cx);
    // Antigravity's cache changes on every status-line update while agy runs: follow it (the timer covers a folder
    // that doesn't exist yet).
    cx.spawn(async (cx) => {
      const dir = `${slashPath(home())}/${AGY_CACHE_REL}`.replace(/\/[^/]+$/, "");
      for (;;) {
        try {
          const changed = await watchFolder(dir);
          if (!changed?.length) { await cx.sleep(EMPTY_WATCH_MS); continue; }
          this.reloadAgy(cx);
        } catch { await cx.sleep(REFRESH_MS); }
      }
    });
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
          if (!this.claude()) this.checkSetup(cx, "claude");
          this.publishTop();
          cx.notify();
        } while (this.again);
      } catch (e) {
        console.log(`dock-quotas: read failed: ${e}`);
        this.statusline = null; // the status-line cache (5-hour and weekly, fresh on every Claude reply)
    this.cli = null; // the claude CLI's reading (plan, per-model limits), every CLI_EVERY_MS
    this.cliAt = 0;
        this.publishTop();
        cx.notify();
      } finally {
        this.reading = false;
      }
    });
  }

  // Asks the claude CLI for your limits (scripts/herdr-claude-usage.mjs, shipped in this mod). No claude, not logged
  // in, or no answer: the last reading stays and goes stale; the status line still works on its own.
  reloadCli(cx) {
    if (this.cliReading || Date.now() - this.cliAt < CLI_EVERY_MS) return;
    this.cliReading = true;
    this.cliAt = Date.now();
    cx.spawn(async (cx) => {
      try {
        const helper = slashPath(appHome()) + "/mods/dock-quotas/herdr-claude-usage.mjs";
        const r = await exec("node", [helper], { timeout: 40000 });
        const reading = parseUsageOutput(r.stdout, Date.now());
        if (reading) this.cli = reading;
        else console.log(`dock-quotas: claude usage: ${(r.stdout || r.stderr || "").trim().slice(0, 200)}`);
      } catch (e) {
        console.log(`dock-quotas: claude usage failed: ${e}`);
      } finally {
        this.cliReading = false;
        this.publishTop();
        cx.notify();
      }
    });
  }

  // The readings for the bottom-bar strip (dock-limits), in shared state, written only when they change (a write
  // re-renders every mod). The strip asks nothing itself, so the claude CLI isn't asked twice.
  publishReadings() {
    const next = { claude: publishable(this.claude()), codex: publishable(this.codex), antigravity: publishable(this.agy) };
    const text = JSON.stringify(next);
    if (text === this.lastPublished) return;
    this.lastPublished = text;
    setShared(READINGS_KEY, next);
  }

  // What Quotas shows for Claude: the CLI's reading, with a fresher status line's 5-hour and weekly numbers.
  claude() { return mergeClaude(this.cli, this.statusline, Date.now()); }

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

  // No reading from a tool: is its status line wired to herdr-dock's writer? Reads its settings.json (and the script
  // its command runs, for a line added by hand); no settings folder means the tool isn't used here.
  checkSetup(cx, tool = "claude", force = false) {
    const st = this.setups[tool], def = TOOLS[tool];
    if (st.checking || st.busy || (!force && Date.now() < st.nextAt)) return;
    st.checking = true;
    cx.spawn(async (cx) => {
      try {
        const root = slashPath(home());
        const dir = `${root}/${def.dir}`;
        const text = await readTextFile(`${dir}/settings.json`).catch(() => null);
        let state;
        if (text == null) {
          const probe = listDirCommand(window()?.platform, dir);
          const r = await exec(probe.command, probe.args).catch(() => null);
          state = r && r.code === 0 ? "missing" : "no-claude";
        } else {
          const writer = this.writerPath(tool);
          const first = statuslinePlan(text, writer, [], def.mark);
          state = first.command
            ? statuslinePlan(text, writer, await Promise.all(scriptPaths(first.command, root).map((p) => readTextFile(p).catch(() => null))), def.mark).state
            : first.state;
        }
        st.state = state;
      } catch (e) {
        console.log(`dock-quotas: ${tool} status line check failed: ${e}`);
      } finally {
        st.checking = false;
        st.nextAt = Date.now() + SETUP_CHECK_MS;
        cx.notify();
      }
    });
  }

  writerPath(tool = "claude") { return `${slashPath(appHome())}/mods/dock-quotas/${TOOLS[tool].writer}`; }

  // Set up: runs the setup script shipped with this mod (it backs up the settings file, then writes it).
  runSetup(cx, tool = "claude") {
    const st = this.setups[tool];
    if (st.busy) return;
    st.busy = true;
    st.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const script = slashPath(appHome()) + "/mods/dock-quotas/herdr-statusline-setup.mjs";
        const r = await exec("node", [script, ...TOOLS[tool].args, "--writer", this.writerPath(tool)], { timeout: 30000 });
        if (r.code !== 0) st.error = (r.stderr || r.stdout || `exit ${r.code}`).trim();
        else { st.state = "fed"; console.log(`dock-quotas: ${r.stdout.trim()}`); } // "waiting" at once
      } catch (e) {
        st.error = `couldn't run node: ${e}`;
      } finally {
        st.busy = false;
        this.checkSetup(cx, tool, true);
        cx.notify();
      }
    });
  }

  // A tool's self-check line, while it has no reading: what's wrong, and Set up when that fixes it.
  setupRow(t, tool = "claude") {
    const reading = tool === "claude" ? this.claude() : this.agy;
    const n = reading ? null : TOOLS[tool].notice(this.setups[tool].state, this.setups[tool]);
    if (!n) return null;
    return h_flex().id(`quota-setup-${tool}`).px(16).py(4).gap(8).flex_none().items_center().tooltip(n.tip)
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(this.setups[tool].error ? (t.blocked ?? HIGH) : t.muted).child(n.text))
      .when(n.action === "setup", (el) => el.child(h_flex().id(`quota-setup-run-${tool}`).h(22).px(8).flex_none().items_center().rounded(6)
        .border_1().border_color(t.border).text_size(11.5).text_color(t.foreground).cursor_pointer()
        .hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.runSetup(cx, tool)).child("Set up")));
  }

  // Antigravity's limits, from its status-line cache (herdr-agy-statusline.mjs): fresh while an agy session runs.
  reloadAgy(cx) {
    if (this.agyReading) return;
    this.agyReading = true;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${slashPath(home())}/${AGY_CACHE_REL}`).catch(() => null);
        this.agy = parseAgyCache(text, Date.now());
        if (!this.agy) this.checkSetup(cx, "agy");
      } catch (e) {
        console.log(`dock-quotas: Antigravity read failed: ${e}`);
      } finally {
        this.agyReading = false;
        this.publishTop();
        cx.notify();
      }
    });
  }

  // The highest used % across Claude, Codex and Antigravity, for the bottom bar's warnings: shared dock.quotas.top =
  // { p, stale, what, resetsMs, at } (what: "Antigravity 5-hour"; at: when it was published), or null with no reading.
  // Written when any of p, stale, what or resetsMs changes,
  // and again once `at` is TOP_REFRESH_MS old (the 30 s timer calls this), so a reading that stops being
  // refreshed (this mod unmounted or stuck) ages out of the warnings after 120 s.
  publishTop() {
    this.publishReadings();
    const now = Date.now();
    const top = topQuota({ claude: this.claude(), codex: this.codex, antigravity: this.agy }, now);
    const prev = shared(TOP_KEY) ?? null;
    if (!top) { if (prev !== null) setShared(TOP_KEY, null); return; }
    const same = prev && prev.p === top.p && prev.stale === top.stale && prev.what === top.what && prev.resetsMs === top.resetsMs
      && Number.isFinite(prev.at) && now - prev.at < TOP_REFRESH_MS;
    if (!same) setShared(TOP_KEY, { ...top, at: now });
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

  groupHeader(t, g, i) { return groupHeaderEl(t, g, i, this.icons); }


  // `onTitle` (collapsed): the title takes focus. `exit`: this is the focused feature, so the title brings the other
  // sections back.
  header(t, onTitle, exit = false) {
    const title = div().text_size(11.5).font_medium().text_color(t.dim).child("Quotas");
    return h_flex().px(16).h(onTitle ? 31 : 41).pt(onTitle ? 0 : 14).pb(onTitle ? 0 : 5).flex_none().items_center()
      .child(onTitle
        ? title.id("dock-quotas-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Quotas").on_click(() => onTitle())
        : exit ? exitTitle(title.flex_1(), t, "dock-quotas-title") : title);
  }

  // One line per window (drawn by draw.js, shared with the bottom-bar strip's hover panel).
  row(t, r, i) { return quotaRowEl(t, r, `quota-${i}`); }



  render(cx) {
    const t = theme();
    const myId = props()?.dockFeature ?? "dock-quotas";
    const face = featureMode(shared("dock.left.mode"), shared("dock.left.focus"), myId, props()?.dockRegion);
    if (face === "icon") {
      const b = iconBadge([this.claude(), this.codex, this.agy], Date.now());
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
    const groups = quotaGroups({ claude: this.claude(), codex: this.codex, antigravity: this.agy }, Date.now());
    const setup = this.setupRow(t, "claude");
    const agySetup = this.setupRow(t, "agy");
    let n = 0;
    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .child(this.header(t, null, focusedNow(myId, props()?.dockRegion)))
      .child(v_flex().id("dock-quotas-list").flex_1().min_h(0).overflow_y_scrollbar()
      .when(Boolean(setup), (el) => el.child(setup))
      .when(Boolean(agySetup), (el) => el.child(agySetup))
      .when(!groups.length && !setup, (el) => el.child(div().px(16).py(4).text_size(12).text_color(t.dim)
        .tooltip("Claude: arrives after a Claude Code reply. Codex: use it once.")
        .child("no usage recorded yet")))
      .children(groups.flatMap((g, gi) => [this.groupHeader(t, g, gi), ...g.rows.map((r) => this.row(t, r, n++))])));
  }
}
