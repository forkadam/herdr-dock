// src/mods/dock-changes/main.js
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, Tabs, Tab } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, shared, setShared, props, checking } from "herdr";

// src/shared/follow.js
function selectedLocation(state, selected) {
  if (!selected || !state?.repos) return null;
  for (const repo of state.repos) {
    const wt = (repo.worktrees ?? []).find((w) => w.id === selected);
    if (wt) return { cwd: wt.path, on: repo.machine ?? null };
  }
  return null;
}
function followLocation(memo, { focus, selected, state }) {
  const focusKey = JSON.stringify([focus?.cwd ?? null, focus?.on ?? null]);
  const sel = selected ?? null;
  let mode = memo?.mode ?? "focus";
  if (memo) {
    if (sel !== memo.selected && sel !== null) mode = "selection";
    if (focusKey !== memo.focusKey) mode = "focus";
  }
  const next = { focusKey, selected: sel, mode };
  const picked = mode === "selection" ? selectedLocation(state, sel) : null;
  return { loc: picked ? { ...focus, ...picked } : focus, memo: next };
}

// src/shared/layout.js
function rightActiveOf(active, features) {
  if (!features.length) return null;
  return features.some((f) => f.mod === active) ? active : features[0].mod;
}

// src/shared/panel.js
function rightShownOf(sharedShown, applied) {
  if (typeof sharedShown === "boolean") return sharedShown;
  return applied?.right?.hidden === false;
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/shared/changes.js
var GIT_READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
var FILE_LIMIT = 1e3;
var COALESCE_MS = 80;
var EMPTY_WATCH_MS = 1e3;
var POLL_MS = 2500;
var REMOTE_POLL_MS = 1e4;
var MIN_GAP_MS = 500;
var SAFETY_POLL_MS = 1e4;
var WATCH_RETRY_MS = 6e4;
var norm = (p) => {
  const s = slashPath(p);
  return /^[A-Z]:\//.test(s) ? s.toLowerCase() : s;
};
function parseRepoPaths(stdout) {
  const lines = String(stdout ?? "").replace(/\r\n/g, "\n").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  return { root: lines[0], gitDir: lines[1] ?? null };
}
function watchDirsFor(root, gitDir) {
  if (!root) return [];
  if (!gitDir) return [root];
  const r = norm(root), g = norm(gitDir);
  const inside = g === r || g.startsWith(r.endsWith("/") ? r : `${r}/`);
  return inside ? [root] : [root, gitDir];
}
function parseNumstat(stdout, stats = {}) {
  for (const entry of String(stdout ?? "").split("\0")) {
    const [a, d, ...parts] = entry.split("	");
    if (!parts.length) continue;
    const path = parts.join("	"), old = stats[path] ?? { add: 0, del: 0 };
    stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
  }
  return stats;
}
function headerBranch(entry) {
  const h = entry.slice(3);
  if (/^HEAD \(no branch\)/.test(h)) return null;
  const fresh = /^(?:No commits yet|Initial commit) on (.+)$/.exec(h);
  return fresh ? fresh[1] : h.split("...")[0].trim() || null;
}
function parsePorcelainStatus(stdout, stats = {}, limit = FILE_LIMIT) {
  let entries = String(stdout ?? "").split("\0").filter(Boolean);
  let branch = null;
  if (entries[0]?.startsWith("## ")) {
    branch = headerBranch(entries[0]);
    entries = entries.slice(1);
  }
  const files = [];
  for (const entry of entries.slice(0, limit)) {
    const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
    const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
    const status = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
    const stat = stats[path] ?? { add: 0, del: 0 };
    files.push({ path, status, fresh, ...stat });
  }
  return { files, limited: entries.length > limit, branch };
}
async function resolveRepo(exec2, { cwd, on }) {
  if (!on) {
    const r2 = await exec2("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir"], { cwd, on });
    if (r2.code === 0) return parseRepoPaths(r2.stdout);
    if (!/path-format|unrecognized|unknown/i.test(r2.stderr ?? "")) return null;
  }
  const r = await exec2("git", ["rev-parse", "--show-toplevel"], { cwd, on });
  return r.code === 0 ? parseRepoPaths(r.stdout) : null;
}
async function fetchChanges({ exec: exec2, cwd, on, root = null, gitDir = null, mode = "uncommitted", bases = null }) {
  let repo = root ? { root, gitDir } : await resolveRepo(exec2, { cwd, on });
  if (!repo) return { notRepo: true };
  const runGit = (r, args) => exec2("git", [...GIT_READ, ...args], { cwd: r.root, on });
  let [status, headDiff] = await Promise.all([
    runGit(repo, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--branch", "--no-ahead-behind"]),
    runGit(repo, ["diff", "HEAD", "--numstat", "-z", "--no-renames"])
  ]);
  if (status.code !== 0 && root) {
    repo = await resolveRepo(exec2, { cwd, on });
    if (!repo) return { notRepo: true };
    [status, headDiff] = await Promise.all([
      runGit(repo, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--branch", "--no-ahead-behind"]),
      runGit(repo, ["diff", "HEAD", "--numstat", "-z", "--no-renames"])
    ]);
  }
  if (status.code !== 0) throw new Error(status.stderr || `git status exited ${status.code}`);
  const hasHead = headDiff.code === 0;
  const stats = {};
  if (hasHead) {
    parseNumstat(headDiff.stdout, stats);
  } else {
    const check = await runGit(repo, ["rev-parse", "--verify", "HEAD"]);
    if (check.code === 0) throw new Error(headDiff.stderr || `git diff exited ${headDiff.code}`);
    const [cached, unstaged] = await Promise.all([
      runGit(repo, ["diff", "--cached", "--numstat", "-z", "--no-renames"]),
      runGit(repo, ["diff", "--numstat", "-z", "--no-renames"])
    ]);
    for (const r of [cached, unstaged]) {
      if (r.code !== 0) throw new Error(r.stderr || `git diff exited ${r.code}`);
      parseNumstat(r.stdout, stats);
    }
  }
  const { files, limited, branch } = parsePorcelainStatus(status.stdout, stats);
  const out = { notRepo: false, root: repo.root, gitDir: repo.gitDir, hasHead, files, limited, branch };
  return mode === "branch" ? { ...out, ...await branchView((args) => runGit(repo, args), { branch, hasHead, statusText: status.stdout, bases }) } : out;
}
async function defaultBranch(runGit) {
  const exists = async (name) => (await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`])).code === 0;
  const head = await runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0 && head.stdout.trim()) {
    const remote = head.stdout.trim(), name = remote.replace(/^origin\//, "");
    return await exists(name) ? name : remote;
  }
  for (const name of ["main", "master"]) if (await exists(name)) return name;
  return null;
}
function parseNameStatus(stdout) {
  const parts = String(stdout ?? "").split("\0").filter((x) => x !== "");
  const out = {};
  for (let i = 0; i + 1 < parts.length; i += 2) out[parts[i + 1]] = parts[i][0];
  return out;
}
async function branchView(runGit, { branch, hasHead, statusText, bases }) {
  const none = { mergeBase: null, onBase: false, files: [], limited: false };
  const name = bases?.name ?? await defaultBranch(runGit);
  if (!name) return { ...none, base: null, bases: { name: null, remote: null } };
  if (branch && (branch === name || `origin/${branch}` === name)) return { ...none, base: name, onBase: true, bases: { name, remote: bases?.remote ?? null } };
  if (!hasHead) return { ...none, base: name, bases: { name, remote: bases?.remote ?? null } };
  const found = { name, remote: bases?.remote ?? await remoteOf(runGit, name) };
  const near = await nearestBase(runGit, name, found.remote);
  if (!near.mergeBase) return { ...none, base: near.base, bases: found };
  return { ...await branchFiles(runGit, near.mergeBase, statusText), base: near.base, mergeBase: near.mergeBase, onBase: false, bases: found };
}
async function remoteOf(runGit, name) {
  if (name.startsWith("origin/")) return null;
  return (await runGit(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`])).code === 0 ? `origin/${name}` : null;
}
async function nearestBase(runGit, name, remote) {
  const [local, other] = await Promise.all([name, remote].map(async (ref) => {
    if (!ref) return null;
    const r = await runGit(["merge-base", "HEAD", ref]);
    return r.code === 0 ? r.stdout.trim() || null : null;
  }));
  if (other && other !== local && (!local || (await runGit(["merge-base", "--is-ancestor", local, other])).code === 0)) return { base: remote, mergeBase: other };
  return { base: name, mergeBase: local };
}
async function branchFiles(runGit, mergeBase, statusText) {
  const [numstat, names] = await Promise.all([
    runGit(["diff", mergeBase, "--numstat", "-z", "--no-renames"]),
    runGit(["diff", mergeBase, "--name-status", "-z", "--no-renames"])
  ]);
  if (numstat.code !== 0) throw new Error(numstat.stderr || `git diff exited ${numstat.code}`);
  const stats = {};
  parseNumstat(numstat.stdout, stats);
  const letters = parseNameStatus(names.stdout), paths = Object.keys(letters);
  const listed = (path) => Object.prototype.hasOwnProperty.call(letters, path);
  const { conflicts, fresh } = branchStatus(statusText, Math.max(0, FILE_LIMIT + 1 - paths.length), listed);
  const files = paths.map((path) => ({ path, status: conflicts.has(path) ? "U" : letters[path] === "D" ? "D" : letters[path] === "A" ? "A" : "M", fresh: false, ...stats[path] ?? { add: 0, del: 0 } }));
  files.push(...fresh);
  return { files: files.slice(0, FILE_LIMIT), limited: files.length > FILE_LIMIT };
}
function branchStatus(stdout, limit, skip = () => false) {
  const text = String(stdout ?? ""), conflicts = /* @__PURE__ */ new Set(), fresh = [];
  for (let at = 0; at < text.length; ) {
    let end = text.indexOf("\0", at);
    if (end < 0) end = text.length;
    const x = text[at], y = text[at + 1];
    if (end > at + 3 && !(x === "#" && y === "#")) {
      if (x === "?" && y === "?") {
        if (fresh.length < limit) {
          const path = text.slice(at + 3, end);
          if (!skip(path)) fresh.push({ path, status: "A", fresh: true, add: 0, del: 0 });
        }
      } else if (x === "U" || y === "U" || x === "A" && y === "A" || x === "D" && y === "D") conflicts.add(text.slice(at + 3, end));
    }
    at = end + 1;
  }
  return { conflicts, fresh };
}
function followsLine({ root, branch, view, base }) {
  if (!root) return "";
  const name = String(root).replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return [name, branch ?? "detached", ...view === "branch" && base ? [`vs ${base}`] : []].join(" \xB7 ");
}
function folderOf(context) {
  if (context == null) return null;
  const { view: _view, ...place } = JSON.parse(context);
  return JSON.stringify(place);
}
function emptyText({ view, error, loading, root, branch, base, mergeBase, onBase }) {
  if (error) return error;
  if (loading) return "Loading changes\u2026";
  if (!root) return "No folder";
  if (view !== "branch") return "No uncommitted changes";
  if (!base) return "No main or master branch to compare with";
  if (onBase) return `On ${base}: nothing to compare`;
  if (!mergeBase) return `No history shared with ${base}`;
  return `Nothing on ${branch ?? "HEAD"} that isn't on ${base}`;
}
function pollDecision({
  visible,
  loading,
  busy,
  watchActive,
  lastRefreshAt,
  watchFailedAt,
  now,
  remote = false,
  pollMs = POLL_MS,
  safetyPollMs = SAFETY_POLL_MS,
  watchRetryMs = WATCH_RETRY_MS,
  remotePollMs = REMOTE_POLL_MS
}) {
  if (!visible || loading || busy) return { refresh: false, retryWatch: false };
  const retryWatch = !watchActive && watchFailedAt != null && now - watchFailedAt >= watchRetryMs;
  const interval = watchActive ? safetyPollMs : remote ? remotePollMs : pollMs;
  const refresh = retryWatch || now - lastRefreshAt >= interval;
  return { refresh, retryWatch };
}
function createChangesSync({
  watchFolder: watchFolder2,
  now = Date.now,
  getLocation,
  onReset,
  onRun,
  onWatchError,
  coalesceMs = COALESCE_MS,
  emptyWatchMs = EMPTY_WATCH_MS,
  pollMs = POLL_MS,
  safetyPollMs = SAFETY_POLL_MS,
  watchRetryMs = WATCH_RETRY_MS,
  remotePollMs = REMOTE_POLL_MS,
  minGapMs = MIN_GAP_MS
}) {
  let visible = true;
  let lastStartAt = -Infinity;
  let context = null;
  let gen = 0;
  let loading = false;
  let busy = false;
  let dirty = false;
  let coalescing = false;
  let lastRefreshAt = -Infinity;
  let watchGen = 0;
  let watchKey = null;
  let watchActive = false;
  let watchFailed = null;
  const watchHandles = /* @__PURE__ */ new Set();
  function stopWatches() {
    watchGen++;
    for (const h of watchHandles) {
      try {
        h?.cancel?.();
      } catch {
      }
    }
    watchHandles.clear();
    watchKey = null;
    watchActive = false;
  }
  function watchDir(dir, isPrimary, myWatchGen, ctx) {
    ctx.spawn(async (taskCtx) => {
      try {
        while (watchGen === myWatchGen) {
          const handle = watchFolder2(dir);
          watchHandles.add(handle);
          let changed;
          try {
            changed = await handle;
          } finally {
            watchHandles.delete(handle);
          }
          if (watchGen !== myWatchGen) return;
          if (!changed?.length) {
            await taskCtx.sleep(emptyWatchMs);
            continue;
          }
          scheduleRefresh(taskCtx);
        }
      } catch (e) {
        if (watchGen !== myWatchGen) return;
        if (isPrimary) {
          watchActive = false;
          watchFailed = { root: dir, at: now() };
        }
        onWatchError?.(dir, e);
      }
    });
  }
  function ensureWatch(root, gitDir, on, ctx) {
    if (!visible || on || !root) {
      stopWatches();
      return;
    }
    const retryReady = watchFailed && now() - watchFailed.at >= watchRetryMs;
    if (retryReady) watchFailed = null;
    const primaryBlocked = watchFailed?.root === root;
    const allDirs = watchDirsFor(root, gitDir);
    const dirs = primaryBlocked ? allDirs.filter((d) => d !== root) : allDirs;
    const nextKey = JSON.stringify({ dirs, primaryBlocked });
    if (watchKey === nextKey) return;
    stopWatches();
    watchKey = nextKey;
    watchActive = !primaryBlocked && dirs.includes(root);
    const myWatchGen = watchGen;
    for (const dir of dirs) watchDir(dir, dir === root, myWatchGen, ctx);
  }
  function scheduleRefresh(ctx) {
    if (!visible) return;
    dirty = true;
    if (loading || busy || coalescing) return;
    coalescing = true;
    const myGen = gen;
    ctx.spawn(async (taskCtx) => {
      try {
        await taskCtx.sleep(Math.max(coalesceMs, lastStartAt + minGapMs - now()));
      } finally {
        if (gen !== myGen) return;
        coalescing = false;
        if (dirty && visible && !loading && !busy) refresh(taskCtx);
      }
    });
  }
  function refresh(ctx) {
    const loc = getLocation();
    const nextContext = JSON.stringify(loc);
    const contextChanged = nextContext !== context;
    if (contextChanged) {
      context = nextContext;
      gen++;
      loading = false;
      dirty = false;
      coalescing = false;
      lastRefreshAt = -Infinity;
      lastStartAt = -Infinity;
      watchFailed = null;
      stopWatches();
      onReset?.(nextContext, loc);
    }
    if (!visible || !loc?.cwd) return;
    if (loading || busy) {
      dirty = true;
      return;
    }
    dirty = false;
    loading = true;
    lastStartAt = now();
    const myGen = gen;
    ctx.spawn(async (taskCtx) => {
      try {
        const res = await onRun({
          loc,
          context: nextContext,
          isCurrent: () => gen === myGen && visible && JSON.stringify(getLocation()) === nextContext,
          notify: () => {
            if (gen === myGen) taskCtx.notify();
          }
        });
        if (gen !== myGen || !visible) return;
        if (res?.root) ensureWatch(res.root, res.gitDir ?? null, loc.on ?? null, taskCtx);
        else stopWatches();
      } finally {
        if (gen !== myGen) return;
        loading = false;
        lastRefreshAt = now();
        taskCtx.notify();
        if (dirty && visible && !busy) scheduleRefresh(taskCtx);
      }
    });
  }
  function setVisible(nextVisible, ctx) {
    const v = Boolean(nextVisible);
    if (v === visible) return;
    visible = v;
    if (!visible) {
      gen++;
      loading = false;
      dirty = false;
      coalescing = false;
      stopWatches();
      return;
    }
    refresh(ctx);
  }
  function setBusy(nextBusy, ctx) {
    busy = Boolean(nextBusy);
    if (!busy && visible && ctx) refresh(ctx);
  }
  function tick(ctx) {
    const decision = pollDecision({
      visible,
      loading,
      busy,
      watchActive,
      lastRefreshAt,
      watchFailedAt: watchFailed?.at ?? null,
      now: now(),
      remote: Boolean(getLocation()?.on),
      pollMs,
      safetyPollMs,
      watchRetryMs,
      remotePollMs
    });
    if (decision.retryWatch) watchFailed = null;
    if (decision.refresh) refresh(ctx);
  }
  function close() {
    visible = false;
    gen++;
    loading = false;
    dirty = false;
    coalescing = false;
    stopWatches();
  }
  return {
    refresh,
    scheduleRefresh,
    setVisible,
    setBusy,
    tick,
    close,
    get context() {
      return context;
    },
    get loading() {
      return loading;
    },
    get busy() {
      return busy;
    },
    get watchActive() {
      return watchActive;
    },
    get visible() {
      return visible;
    }
  };
}

// src/mods/dock-changes/main.js
var MOD = "dock-changes";
var VIEW_KEY = "dock.changes.view";
var VIEWS = [["uncommitted", "Uncommitted"], ["branch", "Branch"]];
var viewOf = (value) => value === "branch" ? "branch" : "uncommitted";
function focusLocation() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? f.terminal?.includes("/") ? f.terminal.split("/")[0] : null : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
var followMemo = null;
function location() {
  const r = followLocation(followMemo, { focus: focusLocation(), selected: shared("dock.git.selected"), state: shared("dock.git.state") });
  followMemo = r.memo;
  return r.loc;
}
var where = () => ({ ...location(), view: viewOf(shared(VIEW_KEY)) });
var key = () => JSON.stringify(where());
var countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
var untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd(s.length - 1 - (s.length - 1) % 4 + 4));
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) {
      old = +match[1];
      next = +match[2];
      return { kind: "@", text: line };
    }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") {
      old++;
      return { kind, number: next++, text: untab(line.slice(1)) || " " };
    }
    return { kind: "", text: line };
  });
}
var runCtx = (cx) => ({
  spawn: (fn) => cx.spawn(async (taskCx) => fn(runCtx(taskCx))),
  sleep: (ms) => cx.sleep(ms),
  notify: () => cx.notify()
});
var Changes = class extends View {
  init(_props, cx) {
    this.files = [];
    this.rows = [];
    this.diffWidth = 0;
    this.message = "";
    this.handle = cx.focus_handle();
    this.root = null;
    this.gitDir = null;
    this.on = null;
    this.context = null;
    this.folder = null;
    this.branch = null;
    this.base = null;
    this.mergeBase = null;
    this.onBase = false;
    this.bases = null;
    this.open = null;
    this.closed = false;
    this.limited = false;
    this.error = null;
    this.note = null;
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx2) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx2.notify();
    });
    this.input.on("submit", (_e, cx2) => this.commit(cx2));
    this.input.on("focus", (_e, cx2) => {
      this.typing = true;
      cx2.notify();
    });
    this.input.on("blur", (_e, cx2) => {
      this.typing = false;
      cx2.notify();
    });
    this.sync = createChangesSync({
      watchFolder,
      getLocation: where,
      onReset: (nextContext) => {
        this.context = nextContext;
        this.root = null;
        this.gitDir = null;
        this.on = null;
        this.files = [];
        this.open = null;
        this.setLines([]);
        this.branch = null;
        this.base = null;
        this.mergeBase = null;
        this.onBase = false;
        this.bases = null;
        const folder = folderOf(nextContext);
        if (folder !== this.folder) {
          this.message = "";
          this.input.set_value("");
        }
        this.folder = folder;
        this.error = null;
        this.note = null;
        this.closed = false;
        this.limited = false;
      },
      onRun: async ({ loc, context, isCurrent, notify }) => {
        try {
          const res = await fetchChanges({ exec, cwd: loc.cwd, on: loc.on, root: this.root, gitDir: this.gitDir, mode: loc.view, bases: this.bases });
          if (!isCurrent()) return null;
          if (res.notRepo) {
            this.root = null;
            this.gitDir = null;
            this.files = [];
            this.setLines([]);
            this.open = null;
            this.branch = null;
            this.base = null;
            this.mergeBase = null;
            this.onBase = false;
            this.bases = null;
            this.error = "Not a git repository";
            return null;
          }
          this.root = res.root;
          this.gitDir = res.gitDir;
          this.on = loc.on;
          this.hasHead = res.hasHead;
          this.files = res.files;
          this.limited = res.limited;
          this.error = null;
          this.branch = res.branch ?? null;
          this.base = res.base ?? null;
          this.mergeBase = res.mergeBase ?? null;
          this.onBase = Boolean(res.onBase);
          this.bases = res.bases ?? null;
          if (this.open && !res.files.some((f) => f.path === this.open)) {
            this.open = null;
            this.setLines([]);
          }
          if (!this.open && !this.closed && res.files.length) this.open = res.files[0].path;
          notify();
          if (this.open) {
            try {
              await this.load(this.open, context);
            } catch {
              if (isCurrent()) this.setLines(["Cannot preview this diff (too large or unreadable)"]);
            }
          }
          return { root: res.root, gitDir: res.gitDir };
        } catch (e) {
          if (isCurrent()) this.error = String(e);
          return this.root ? { root: this.root, gitDir: this.gitDir } : null;
        }
      },
      onWatchError: (dir, e) => {
        console.log(`dock-changes: watch of ${dir} failed, polling: ${e?.message ?? e}`);
      }
    });
    if (checking()) return;
    if (this.shown()) this.sync.refresh(runCtx(cx));
    else this.sync.setVisible(false, runCtx(cx));
    cx.timer.every(POLL_MS, (cx2) => this.sync.tick(runCtx(cx2)));
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
    const against = this.mergeBase ? [this.mergeBase] : this.hasHead ? ["HEAD"] : [];
    if (!file) return;
    let lines;
    if (file.fresh || !this.hasHead && file.status === "A") {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file \xB7 no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 4e5).replace(/\n$/, "").split("\n").slice(0, 1500).map((l) => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...GIT_READ, "diff", ...against, "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map((line) => line.length > 4e3 ? line.slice(0, 4e3) + "\u2026 (line truncated)" : line));
  }
  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...this.rows.map((row) => (row.text.length + 1) * 7 + 50));
  }
  pick(path, cx) {
    this.open = this.open === path ? null : path;
    this.setLines([]);
    this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx2) => {
      try {
        await this.load(path, context);
      } catch (e) {
        if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`;
      }
      cx2.notify();
    });
    cx.notify();
  }
  commit(cx) {
    if (!this.message.trim() || !this.root || this.sync.busy || this.sync.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.sync.setBusy(true);
    this.note = null;
    cx.spawn(async (cx2) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (folderOf(key()) === folderOf(context)) {
          this.message = "";
          this.input.set_value("");
        }
      } catch (e) {
        if (folderOf(key()) === folderOf(context)) this.note = `Commit failed: ${e}`;
      } finally {
        this.sync.setBusy(false, runCtx(cx2));
        cx2.notify();
      }
    });
    cx.notify();
  }
  viewTabs(t, view) {
    return h_flex().flex_none().child(Tabs.new("changes-view").flex().flex_row().gap(2).p(2).rounded(7).bg(t.background).border_1().border_color(t.border).children(VIEWS.map(([value, text], i) => Tab.new(`changes-view-${value}`).selected(view === value).set_position(i + 1, VIEWS.length).flex().flex_row().items_center().h(18).px(8).rounded(5).text_size(11).when(view === value, (el) => el.bg(t.selected).text_color(t.foreground)).when(view !== value, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))).on_click(() => setShared(VIEW_KEY, value)).child(text))));
  }
  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18")).child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === void 0 ? "" : String(number))).child(div().flex_1().min_w(0).truncate().child(text));
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
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle).on_key_down((e, cx2) => {
      if (e.key === "escape" && this.typing) {
        this.typing = false;
        this.handle.focus();
        cx2.stop_propagation();
        cx2.notify();
      }
    }).child(v_flex().flex_none().px(14).py(8).gap(6).border_b(1).border_color(t.border).child(h_flex().h(24).gap(8).items_center().child(div().font_semibold().child("Changes")).child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`)).child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`\u2212${del}`))).child(h_flex().h(24).gap(8).items_center().child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(followsLine({ root: this.root, branch: this.branch, view, base: this.base }))).child(this.viewTabs(t, view)))).child(div().flex_1().min_h(44).max_h(this.files.length * 28 + 12).relative().border_b(1).border_color(t.border).child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f) => {
      const parts = f.path.split("/"), name = parts.pop();
      return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx2) => this.pick(f.path, cx2)).child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status)).child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name))).when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`\u2212${f.del}`)));
    })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(emptyText({ view, error: this.error, loading, root: this.root, branch: this.branch, base: this.base, mergeBase: this.mergeBase, onBase: this.onBase }))))).child(Scrollbar.vertical("changes-list").absolute().inset_0())).when(this.limited, (el) => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files"))).child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11).child(div().id("changes-diff-x").size_full().overflow_x_scrollbar().child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list(
      "changes-diff",
      this.rows.length,
      20,
      (i) => String(i),
      (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))
    ).size_full()))).child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0()).when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes")))).when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note))).child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border).child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx2) => cx2.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground))).child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx2) => this.commit(cx2)).child(busy ? "Committing\u2026" : "Commit")));
  }
};
export {
  Changes as default
};
