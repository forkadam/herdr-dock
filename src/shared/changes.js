// Git status/diff parsing, parallel repo reads, and watch/refresh coordination for dock-changes.
// Pure / host-independent (no Node built-ins: bundled into Herdr mods).
import { slashPath } from "./path.js";

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
export const GIT_READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const FILE_LIMIT = 1000;
export const COALESCE_MS = 80;
export const EMPTY_WATCH_MS = 1000;
export const POLL_MS = 2500;
// A repo on another machine can't be watched; each check is git over the connection, so it's polled gently.
export const REMOTE_POLL_MS = 10000;
// Watch-triggered refreshes start at least this far apart, so a burst of changes (an install, a build)
// doesn't run git back to back.
export const MIN_GAP_MS = 500;
export const SAFETY_POLL_MS = 10000;
export const WATCH_RETRY_MS = 60000;

const norm = (p) => {
  const s = slashPath(p);
  return /^[A-Z]:\//.test(s) ? s.toLowerCase() : s;
};

// Parses `git rev-parse [--path-format=absolute] --show-toplevel [--git-dir]` output.
export function parseRepoPaths(stdout) {
  const lines = String(stdout ?? "").replace(/\r\n/g, "\n").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  return { root: lines[0], gitDir: lines[1] ?? null };
}

// Folders to watch for a local repo: always `root`, plus `gitDir` when it sits outside `root`
// (a linked git worktree, where `git add`/`commit`/`reset` write outside the worktree folder).
export function watchDirsFor(root, gitDir) {
  if (!root) return [];
  if (!gitDir) return [root];
  const r = norm(root), g = norm(gitDir);
  const inside = g === r || g.startsWith(r.endsWith("/") ? r : `${r}/`);
  return inside ? [root] : [root, gitDir];
}

// Parses `git diff ... --numstat -z --no-renames` output into { [path]: { add, del, binary } }.
export function parseNumstat(stdout, stats = {}) {
  for (const entry of String(stdout ?? "").split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
    stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
  }
  return stats;
}

// Parses `git status --porcelain=v1 -z --no-renames --untracked-files=all` output.
export function parsePorcelainStatus(stdout, stats = {}, limit = FILE_LIMIT) {
  const entries = String(stdout ?? "").split("\0").filter(Boolean);
  const files = [];
  for (const entry of entries.slice(0, limit)) {
    const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
    const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
    const status = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
    const stat = stats[path] ?? { add: 0, del: 0 };
    files.push({ path, status, fresh, ...stat });
  }
  return { files, limited: entries.length > limit };
}

// Resolves the repo's top-level folder and (for local repos) its absolute git dir.
// Falls back to `--show-toplevel` if an older git (< 2.31) doesn't know `--path-format=absolute`.
export async function resolveRepo(exec, { cwd, on }) {
  if (!on) {
    const r = await exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir"], { cwd, on });
    if (r.code === 0) return parseRepoPaths(r.stdout);
    if (!/path-format|unrecognized|unknown/i.test(r.stderr ?? "")) return null;
  }
  const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
  return r.code === 0 ? parseRepoPaths(r.stdout) : null;
}

// Reads changed files + line stats for a repo using parallel git commands.
// Reuses cached `root`/`gitDir` when provided; if `status` fails on a cached root, re-resolves once.
export async function fetchChanges({ exec, cwd, on, root = null, gitDir = null }) {
  let repo = root ? { root, gitDir } : await resolveRepo(exec, { cwd, on });
  if (!repo) return { notRepo: true };

  const runGit = (r, args) => exec("git", [...GIT_READ, ...args], { cwd: r.root, on });
  let [status, headDiff] = await Promise.all([
    runGit(repo, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]),
    runGit(repo, ["diff", "HEAD", "--numstat", "-z", "--no-renames"]),
  ]);

  if (status.code !== 0 && root) {
    repo = await resolveRepo(exec, { cwd, on });
    if (!repo) return { notRepo: true };
    [status, headDiff] = await Promise.all([
      runGit(repo, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]),
      runGit(repo, ["diff", "HEAD", "--numstat", "-z", "--no-renames"]),
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
      runGit(repo, ["diff", "--numstat", "-z", "--no-renames"]),
    ]);
    for (const r of [cached, unstaged]) {
      if (r.code !== 0) throw new Error(r.stderr || `git diff exited ${r.code}`);
      parseNumstat(r.stdout, stats);
    }
  }

  const { files, limited } = parsePorcelainStatus(status.stdout, stats);
  return { notRepo: false, root: repo.root, gitDir: repo.gitDir, hasHead, files, limited };
}

// Decides whether a periodic poll tick should run a refresh, and whether a previously failed
// folder watch is ready to retry.
export function pollDecision({
  visible, loading, busy, watchActive, lastRefreshAt, watchFailedAt, now, remote = false,
  pollMs = POLL_MS, safetyPollMs = SAFETY_POLL_MS, watchRetryMs = WATCH_RETRY_MS, remotePollMs = REMOTE_POLL_MS,
}) {
  if (!visible || loading || busy) return { refresh: false, retryWatch: false };
  const retryWatch = !watchActive && watchFailedAt != null && now - watchFailedAt >= watchRetryMs;
  const interval = watchActive ? safetyPollMs : remote ? remotePollMs : pollMs;
  const refresh = retryWatch || now - lastRefreshAt >= interval;
  return { refresh, retryWatch };
}

// Coordinates refreshes, burst coalescing, trailing re-runs, visibility pauses, and FolderWatch
// cancellation for dock-changes. Never retains `ctx`: every entry receives a fresh `{ spawn, sleep, notify }`.
export function createChangesSync({
  watchFolder,
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
  minGapMs = MIN_GAP_MS,
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
  let watchFailed = null; // { root, at }
  const watchHandles = new Set();

  function stopWatches() {
    watchGen++;
    for (const h of watchHandles) {
      try { h?.cancel?.(); } catch { /* ignore cancel errors */ }
    }
    watchHandles.clear();
    watchKey = null;
    watchActive = false;
  }

  function watchDir(dir, isPrimary, myWatchGen, ctx) {
    ctx.spawn(async (taskCtx) => {
      try {
        while (watchGen === myWatchGen) {
          const handle = watchFolder(dir);
          watchHandles.add(handle);
          let changed;
          try { changed = await handle; }
          finally { watchHandles.delete(handle); }
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
          notify: () => { if (gen === myGen) taskCtx.notify(); },
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
      visible, loading, busy, watchActive, lastRefreshAt,
      watchFailedAt: watchFailed?.at ?? null, now: now(), remote: Boolean(getLocation()?.on),
      pollMs, safetyPollMs, watchRetryMs, remotePollMs,
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
    get context() { return context; },
    get loading() { return loading; },
    get busy() { return busy; },
    get watchActive() { return watchActive; },
    get visible() { return visible; },
  };
}
