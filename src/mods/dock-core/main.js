import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  agents, appHome, checking, exec, focused, layout, nextCommand, notify, openOverlay, panes, playSound, props, readTextFile, run,
  setShared, shared, spaces, theme, watchFolder, window, writeTextFile,
} from "herdr";
import { createCollector } from "../../shared/collector.js";
import { LOCAL_REL, migrateLocal, planApply } from "../../shared/config.js";
import { leftFeatureIds } from "../../shared/layout.js";
import {
  PAGE_KEY, focusLeavesPage, liveRight, liveSizes, liveWork, modeFromConfig, nextMode, nextPage, planPage, planPanel, planRight,
  planSync, rightConfigUpdate, rightShownOf, sizesSnapshot, sizeChanges,
} from "../../shared/panel.js";
import { slashPath } from "../../shared/path.js";
import { parseGitCommand, revealPlan, showPlan } from "../../shared/gitcmd.js";
import { HISTORY_KEY, historyOf, markAllRead, resolveItems } from "../../shared/notify.js";
import { NOTIFY_DIALOG, applyNotifyCommand, parseNotifyCommand } from "../../shared/notifycmd.js";
import { fixHint, ghVersionArgs, installOf, modeOf, parseVersionJson, publishedUrl } from "../../shared/install.js";
import { hostnameCommand, openUrlCommand } from "../../shared/platform.js";
import { HERDR_KEY, SAMPLE_KEY, herdrSampleCommand, herdrUsage, parseHerdrProcs, parseSample, sampleCommand } from "../../shared/system.js";
import {
  CHECK_EVERY_MS, FETCH_TIMEOUT_MS, NOTIFIED_KEY, OPEN_DIALOG, RESULT_REL, UPDATE_KEY, appUpdateState, availableNote,
  parseUpdateCommand, resultNote, resultToState, shouldNotify, startState, timedOut, updateState,
} from "../../shared/update.js";

const MODES = ["expanded", "icons", "hidden"];
const MODE_KEY = "dock.left.mode";
const FOCUS_KEY = "dock.left.focus";
const ERROR_KEY = "dock.config.error";
// Read by the config dialog: where dock.json lives, this computer's host, and the last good
// merged regions (what a read-only dialog shows when dock.json is invalid).
const HOST_KEY = "dock.host";
const PATH_KEY = "dock.config.path";
// Where this PC's local file lives (<app home>/herdr-dock/local.json), for the dialog.
const LOCAL_PATH_KEY = "dock.config.localPath";
// The herdr-dock repo, for the dialog's Update button (the update tab's folder). Unset in app mode (no repo).
const REPO_KEY = "dock.config.repo";
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
// After dock-core starts, agent items are not resolved for this long (agents() may not be complete yet).
const AGENT_GRACE_MS = 30000;
// The CPU/memory/disk sample: its node child takes ~250 ms, and 4 s is the most it may take.
const SAMPLE_MS = 5000;
const SAMPLE_TIMEOUT_MS = 4000;
// Herdr's own processes (CPU % and memory, for the bar tooltips): a ps / Get-Process call every 10 s.
const HERDR_MS = 10000;
const HERDR_TIMEOUT_MS = 5000;
// While an update runs, the result file is looked for every this many ticks (besides the folder watch).
const RESULT_EVERY_TICKS = 5;

const isTop = () => props()?.dockRegion === "top";

export default class DockCore extends View {
  init(_props, cx) {
    this.merged = null; // last good merged config
    this.applied = null; // "<mode>|<focus>" last applied, so each change is applied once
    this.changes = null; // config size edits (sizeChanges) not applied yet
    this.host = "";
    this.hostError = null; // set when neither the hostname command nor source.json gave one
    this.configPath = null;
    this.localPath = null;
    this.layoutPath = null;
    this.installMode = null; // "clone" | "app" (installOf), once source.json is read
    this.repo = null; // the herdr-dock repo, for the clone update check
    this.versionPath = null; // app mode: <app home>/mods/dock-core/VERSION.json (the installed version)
    this.resultPath = null; // <app home>/herdr-dock/update-result.json
    this.updateBusy = false; // an update check is running
    this.consuming = false; // the result file is being read
    this.sourcePath = null; // <app home>/mods/dock-core/source.json (its commit: what was last deployed)
    this.updateTicks = 0; // ticks while "updating", to look for the result file every RESULT_EVERY_TICKS
    this.collector = null;
    this.notifySeq = 0; // with Date.now(), makes this PC's history item ids unique
    this.startedAt = Date.now(); // agents() can be [] just after start, before programs re-report
    if (checking() || !isTop()) return;
    cx.spawn(async (cx) => this.start(cx));
    this.startCollector(cx);
    this.startSampler(cx);
    this.startHerdrSampler(cx);
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
    // A clone install (deploy's source.json) or an app install (app/'s { "mode": "app" }, with the shared config
    // shipped as mods/dock-core/config.json, read only).
    const install = installOf(src, home);
    if (!install) {
      setShared(ERROR_KEY, `mods/dock-core/source.json is missing or unreadable: ${fixHint(modeOf(src))}`);
      cx.notify();
      return;
    }
    this.installMode = install.mode;
    this.configPath = install.configPath;
    setShared(PATH_KEY, this.configPath);
    // The hostname picks the machines.<host> section: ask the OS, else use the one deploy saved.
    try {
      const { command, args } = hostnameCommand(window()?.platform);
      this.host = (await exec(command, args)).stdout.trim().toLowerCase();
    } catch (e) {
      console.log(`dock-core: hostname failed, using source.json: ${e}`);
    }
    if (!this.host && typeof src?.hostname === "string" && src.hostname.trim()) this.host = src.hostname.trim().toLowerCase();
    setShared(HOST_KEY, this.host || null);
    if (!this.host) {
      this.hostError = "could not read this computer's hostname: machines sections are ignored"
        + (install.mode === "clone" ? " (re-run npm run deploy)" : "");
    }
    this.localPath = `${home}/${LOCAL_REL}`;
    setShared(LOCAL_PATH_KEY, this.localPath);
    const localDir = this.localPath.slice(0, this.localPath.lastIndexOf("/"));
    await this.ensureFolder(localDir);
    // Clone mode: the repo (for migration, git and the dialog's Update). App mode has no repo: nothing to migrate.
    if (install.mode === "clone") await this.migrate(install.repo);
    await this.reload(cx);
    if (install.mode === "clone") {
      this.repo = install.repo;
      setShared(REPO_KEY, install.repo);
    } else {
      this.versionPath = install.versionPath;
      if ((shared(REPO_KEY) ?? null) !== null) setShared(REPO_KEY, null);
    }
    this.resultPath = `${home}/${RESULT_REL}`;
    this.sourcePath = `${home}/mods/dock-core/source.json`;
    // A result left from an update (deploy restarted dock-core before it was seen), then the 6 h check.
    await this.consumeResult(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        await this.checkUpdate(cx);
        await cx.sleep(CHECK_EVERY_MS);
      }
    });
    cx.spawn(async (cx) => this.watch(localDir, cx, () => this.consumeResult(cx)));
    // App mode's config.json changes only through update-app, which reloads dock-core anyway: not watching
    // mods/dock-core keeps Herdr's watch off the folder the update swaps.
    if (install.mode === "clone") await this.watch(this.configPath.slice(0, this.configPath.lastIndexOf("/")) || "/", cx);
  }

  // The one-time move of machines.<host> from config/dock.json to the local file (deploy does the
  // same; whichever runs first wins, the other finds the local file and does nothing).
  async migrate(repo) {
    if (!this.host) return;
    const rel = this.configPath.startsWith(`${repo}/`) ? this.configPath.slice(repo.length + 1) : null;
    try {
      const moved = await migrateLocal({
        configPath: this.configPath, localPath: this.localPath, host: this.host,
        read: (path) => readTextFile(path).catch(() => null),
        write: (path, text, expected) => writeTextFile(path, text, expected),
        headText: async () => {
          if (!rel) return undefined;
          const r = await exec("git", ["show", `HEAD:${rel}`], { cwd: repo });
          return r.code === 0 ? r.stdout : undefined;
        },
      });
      if (moved) console.log(`dock-core: moved machines.${this.host} to ${this.localPath}`);
    } catch (e) {
      console.log(`dock-core: local file migration failed: ${e?.message ?? e}`);
    }
  }

  // Creates a folder (with a .keep file) so it can be watched before anything is saved in it.
  async ensureFolder(dir) {
    const keep = `${dir}/.keep`;
    try {
      if ((await readTextFile(keep).catch(() => null)) !== null) return;
      try {
        await writeTextFile(keep, "", null);
      } catch {
        // writeTextFile may not create missing parent folders: node (required by herdr-dock) can.
        await exec("node", ["-e", "require('fs').mkdirSync(process.argv[1], { recursive: true })", dir]);
        await writeTextFile(keep, "", null);
      }
    } catch (e) {
      console.log(`dock-core: could not create ${dir}: ${e?.message ?? e}`);
    }
  }

  // Reloads whenever something in dir changes (the config's folder and the local file's folder), then runs
  // after (the local folder also receives the update script's result file).
  async watch(dir, cx, after = null) {
    for (;;) {
      try {
        const changed = await watchFolder(dir);
        if (!changed?.length) { await cx.sleep(EMPTY_WATCH_MS); continue; }
      } catch (e) {
        console.log(`dock-core: watch of ${dir} failed, polling: ${e}`);
        await cx.sleep(POLL_MS);
      }
      await this.reload(cx);
      if (after) await after();
    }
  }

  // One update check: clone mode fetches main (30 s) and compares; app mode compares the installed VERSION.json
  // with the published one. Publishes UPDATE_KEY (with mode) and notifies once per new upstream sha (app mode: per
  // new published version). Never leaves the state on "checking"; never overwrites an update in progress.
  async checkUpdate(cx) {
    if (!(this.installMode === "app" ? this.versionPath : this.repo) || this.updateBusy) return;
    const prev = shared(UPDATE_KEY) ?? null;
    if (prev?.status === "updating") return;
    this.updateBusy = true;
    setShared(UPDATE_KEY, { ...(prev ?? {}), mode: this.installMode, status: "checking" });
    cx.notify();
    let next;
    try {
      next = this.installMode === "app"
        ? appUpdateState(await this.appUpdateInfo(cx), Date.now(), prev)
        : { mode: "clone", ...updateState({ ...(await this.gitUpdateInfo()), deployed: await this.deployedCommit() }, Date.now(), prev) };
    } catch (e) {
      next = this.installMode === "app"
        ? appUpdateState({ fetchOk: false, fetchError: e?.message ?? String(e) }, Date.now(), prev)
        : { mode: "clone", ...updateState({ fetchOk: false, fetchError: e?.message ?? String(e) }, Date.now(), prev) };
    } finally {
      this.updateBusy = false;
    }
    // update.start or a result arrived while git ran: that state wins.
    if ((shared(UPDATE_KEY) ?? null)?.status !== "checking") return;
    setShared(UPDATE_KEY, next);
    if (shouldNotify(next, shared(NOTIFIED_KEY) ?? null)) {
      try { notify(availableNote(next)); } catch (e) { console.log(`dock-core: update notify failed: ${e?.message ?? e}`); }
      setShared(NOTIFIED_KEY, next.mode === "app" ? next.version : next.latest);
    }
    cx.notify();
  }

  // What appUpdateState needs: the installed mods/dock-core/VERSION.json and the published app/VERSION.json, a plain
  // download first, then gh api (the repo may be private), each bounded by FETCH_TIMEOUT_MS.
  async appUpdateInfo(cx) {
    const installed = parseVersionJson(await readTextFile(this.versionPath).catch(() => null));
    if (!installed) return { fetchOk: false, fetchError: "mods/dock-core/VERSION.json is missing or unreadable" };
    // The losing timer's rejection is swallowed (the race already settled).
    const bounded = (p) => {
      const timer = cx.sleep(FETCH_TIMEOUT_MS).then(() => { throw new Error(`timed out after ${FETCH_TIMEOUT_MS / 1000} s`); });
      timer.catch(() => {});
      return Promise.race([p, timer]);
    };
    let published = null;
    let why = null;
    try {
      const r = await bounded(globalThis.fetch(publishedUrl(installed), { headers: { "User-Agent": "herdr-dock" } }));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      published = parseVersionJson(await bounded(r.text()));
      if (!published) throw new Error("not a VERSION.json");
    } catch (e) {
      why = `download: ${e?.message ?? e}`;
    }
    if (!published) {
      try {
        const r = await bounded(exec("gh", ghVersionArgs(installed), { timeout: FETCH_TIMEOUT_MS }));
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim());
        published = parseVersionJson(r.stdout);
        if (!published) throw new Error("not a VERSION.json");
      } catch (e) {
        const first = String(e?.message ?? e).split(/\r?\n/)[0];
        return { fetchOk: false, fetchError: `${first} (${why})`, installed };
      }
    }
    return { fetchOk: true, installed, published };
  }

  // The commit the last deploy recorded in source.json (re-read each check), or null.
  async deployedCommit() {
    try {
      const src = JSON.parse((await readTextFile(this.sourcePath)) ?? "null");
      return typeof src?.commit === "string" && src.commit.trim() ? src.commit.trim() : null;
    } catch { return null; }
  }

  // What updateState needs, from git in the repo. A failed fetch returns fetchOk false; any other failed git
  // command throws (shown as a failed check).
  async gitUpdateInfo() {
    const git = (args, timeout) => exec("git", args, { cwd: this.repo, ...(timeout ? { timeout } : {}) });
    let current = null;
    try {
      const r = await git(["rev-parse", "--short", "HEAD"]);
      if (r.code === 0) current = r.stdout.trim();
    } catch { /* the fetch below reports it */ }
    let fetch;
    try {
      fetch = await git(["-c", "credential.interactive=never", "fetch", "--quiet", "origin", "main"], FETCH_TIMEOUT_MS);
    } catch (e) {
      return { fetchOk: false, fetchError: e?.message ?? String(e), current };
    }
    if (fetch.code !== 0) return { fetchOk: false, fetchError: fetch.stderr || fetch.stdout, current };
    const out = async (args) => {
      const r = await git(args);
      if (r.code !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || r.stdout || "").trim()}`);
      return r.stdout;
    };
    const [behind, log, status, branch, ahead] = await Promise.all([
      out(["rev-list", "--count", "HEAD..origin/main"]),
      out(["log", "-1", "--format=%h%x09%s", "origin/main"]),
      out(["status", "--porcelain"]),
      out(["rev-parse", "--abbrev-ref", "HEAD"]),
      out(["rev-list", "--count", "origin/main..HEAD"]),
    ]);
    const line = log.replace(/\r?\n$/, "");
    const tab = line.indexOf("\t");
    return {
      fetchOk: true, current, branch: branch.trim(), behind: Number(behind.trim()) || 0, ahead: Number(ahead.trim()) || 0,
      latest: (tab < 0 ? line : line.slice(0, tab)).trim() || null, subject: tab < 0 ? null : line.slice(tab + 1),
      dirty: status.trim() !== "",
    };
  }

  // Applies and deletes the update script's result file, if there is one.
  async consumeResult(cx) {
    if (!this.resultPath || this.consuming) return;
    this.consuming = true;
    try {
      const text = await readTextFile(this.resultPath).catch(() => null);
      if (text == null || text.trim() === "") return;
      let result;
      try { result = JSON.parse(text); } catch { result = undefined; }
      const next = resultToState(result, shared(UPDATE_KEY) ?? null, Date.now());
      // Not readable yet (still being written): the next change in the folder tries again.
      if (!next) { console.log("dock-core: update-result.json is not a result yet"); return; }
      // Delete first, so the same result is never applied twice.
      await exec("node", ["-e", "require('fs').rmSync(process.argv[1], { force: true })", this.resultPath])
        .catch((e) => console.log(`dock-core: could not delete ${this.resultPath}: ${e?.message ?? e}`));
      setShared(UPDATE_KEY, next);
      try { notify(resultNote(result)); } catch (e) { console.log(`dock-core: update notify failed: ${e?.message ?? e}`); }
      cx.notify();
    } catch (e) {
      console.log(`dock-core: update result failed: ${e?.message ?? e}`);
    } finally {
      this.consuming = false;
    }
  }

  // Each tick while "updating": every RESULT_EVERY_TICKS ticks, look for the result file (the folder watch
  // can miss one written before it started), and once more right before an update with no result for
  // 10 minutes becomes a failure.
  updateTick(cx) {
    const state = shared(UPDATE_KEY) ?? null;
    if (state?.status !== "updating") { this.updateTicks = 0; return; }
    this.updateTicks = (this.updateTicks + 1) % RESULT_EVERY_TICKS;
    const late = timedOut(state, Date.now());
    if (!late && this.updateTicks !== 0) return;
    cx.spawn(async (cx) => {
      await this.consumeResult(cx);
      if (!late) return;
      const next = timedOut(shared(UPDATE_KEY) ?? null, Date.now());
      if (!next) return;
      setShared(UPDATE_KEY, next);
      try {
        notify({ title: "herdr-dock update failed", body: next.reason, level: "error", action: OPEN_DIALOG });
      } catch (e) { console.log(`dock-core: update notify failed: ${e?.message ?? e}`); }
      cx.notify();
    });
  }

  // An update.* command: check now, or the dialog opening the update tab. Returns false when c isn't one.
  updateCommand(c, cx) {
    const u = parseUpdateCommand(c);
    if (!u) return false;
    if (u.cmd === "check") cx.spawn(async (cx) => this.checkUpdate(cx));
    else setShared(UPDATE_KEY, startState(shared(UPDATE_KEY) ?? null, Date.now()));
    return true;
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
        try { this.updateTick(cx); } catch (e) { console.log(`dock-core: update tick failed: ${e?.message ?? e}`); }
        await cx.sleep(TICK_MS);
      }
    });
  }

  // The system sampler: one node child every SAMPLE_MS publishes dock.system.sample. A failure is
  // logged once, then again only after a success, so a missing node does not flood the log.
  startSampler(cx) {
    let failed = false;
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          const { command, args } = sampleCommand();
          const { stdout } = await exec(command, args, { timeout: SAMPLE_TIMEOUT_MS });
          const sample = parseSample(stdout, Date.now());
          if (!sample) throw new Error("unreadable sample output");
          setShared(SAMPLE_KEY, sample);
          failed = false;
        } catch (e) {
          if (!failed) console.log(`dock-core: system sample failed: ${e?.message ?? e}`);
          failed = true;
        }
        await cx.sleep(SAMPLE_MS);
      }
    });
  }

  // Herdr's own CPU % (of the whole machine, over the time between samples) and memory, published as
  // dock.system.herdr every HERDR_MS. The first sample has no cpu. Failures are logged once, like the system sampler.
  startHerdrSampler(cx) {
    let failed = false;
    let prev = null; // { cpuMs, mem, t }
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          const platform = window()?.platform;
          const { command, args } = herdrSampleCommand(platform);
          const { stdout } = await exec(command, args, { timeout: HERDR_TIMEOUT_MS });
          const t = Date.now();
          const cur = parseHerdrProcs(platform, stdout);
          if (!cur) throw new Error("no herdr process in the output");
          const cores = shared(SAMPLE_KEY)?.cores;
          setShared(HERDR_KEY, herdrUsage(prev, cur, prev ? t - prev.t : 0, cores, t));
          prev = { ...cur, t };
          failed = false;
        } catch (e) {
          prev = null;
          if (!failed) console.log(`dock-core: herdr sample failed: ${e?.message ?? e}`);
          failed = true;
        }
        await cx.sleep(HERDR_MS);
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
      if (history.some((x) => !x.read)) setShared(HISTORY_KEY, markAllRead(history));
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
    // Unknown agents (undefined) leave agent items unresolved: so does the first AGENT_GRACE_MS after start,
    // when agents() can briefly be [] and would resolve every agent item as gone.
    let list;
    if (Date.now() - this.startedAt >= AGENT_GRACE_MS) {
      try { list = agents(); } catch { list = undefined; }
    }
    const next = resolveItems(history, { agents: list, gitState: shared("dock.git.state") });
    if (next !== history) setShared(HISTORY_KEY, next);
  }

  // Re-read the config; write the layout only when it changed and the config is valid.
  async reload(cx) {
    if (!this.configPath || checking()) return;
    const configText = await readTextFile(this.configPath).catch(() => null);
    const localText = this.localPath ? await readTextFile(this.localPath).catch(() => null) : null;
    const current = await readTextFile(this.layoutPath).catch(() => null);
    // Parse first, decide this PC's right panel state from the new config, then build the layout
    // file with it, so the file already matches what the panel should be.
    let plan = planApply(configText, this.host, current, this.merged, {}, localText);
    if (!plan.error && plan.merged) {
      const active = shared(ACTIVE_KEY);
      const u = rightConfigUpdate({
        prev: this.merged, merged: plan.merged,
        saved: { shown: shared(RIGHT_KEY), active, configHidden: shared(RIGHT_CONFIG_KEY) },
      });
      for (const [key, value] of Object.entries(u.set)) setShared(key, value);
      plan = planApply(configText, this.host, current, this.merged, { ...u.state, page: shared(PAGE_KEY) ?? undefined }, localText);
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
    if (this.updateCommand(c, cx)) return;
    if (c === "reload") {
      cx.spawn(async (cx) => this.reload(cx));
      return;
    }
    if (c === "right") {
      setShared(RIGHT_KEY, !this.rightShown());
      return;
    }
    // Ctrl+Alt+P: the terminal, then each page, then the terminal again. "terminals": back to the terminal.
    if (c === "page" || c === "terminals") {
      const next = c === "page" ? nextPage(shared(PAGE_KEY), this.merged?.regions.pages?.features) : null;
      if ((shared(PAGE_KEY) ?? null) !== next) setShared(PAGE_KEY, next);
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

  // Called from render: show this PC's page (or the terminal) in the work stack. Another space or tab
  // getting focus (a click, a key, a new tab) while a page shows brings the terminal back.
  syncPage(cx) {
    if (!this.merged) return;
    const features = this.merged.regions.pages?.features ?? [];
    if (!features.length) return;
    let where = null;
    try { const f = focused(); where = f ? `${f.space}|${f.tab}` : null; } catch { where = null; }
    if (where !== null) {
      const leave = focusLeavesPage(this.focusKey ?? null, where);
      this.focusKey = where;
      if (leave && (shared(PAGE_KEY) ?? null) !== null) setShared(PAGE_KEY, null);
    }
    let live;
    try { live = liveWork(layout()); } catch (e) { console.log(`dock-core: layout() failed: ${e}`); return; }
    const actions = planPage({ active: shared(PAGE_KEY), features, live });
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
    this.syncPage(cx);
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
