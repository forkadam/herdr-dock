import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRepoPaths,
  watchDirsFor,
  parseNumstat,
  parsePorcelainStatus,
  fetchChanges,
  pollDecision,
  REMOTE_POLL_MS,
  MIN_GAP_MS,
  COALESCE_MS,
  createChangesSync,
} from "../src/shared/changes.js";

const flush = () => new Promise((r) => setImmediate(r));

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeWatchHarness() {
  const active = []; // { dir, resolve, reject, cancelled, settled }
  const watchFolder = (dir) => {
    const d = deferred();
    const rec = {
      dir,
      cancelled: false,
      settled: false,
      resolve: (v) => { rec.settled = true; d.resolve(v); },
      reject: (e) => { rec.settled = true; d.reject(e); },
    };
    d.promise.cancel = () => {
      if (rec.cancelled) return;
      rec.cancelled = true;
      rec.settled = true;
      d.resolve([]);
    };
    active.push(rec);
    return d.promise;
  };
  const latest = (dir) => [...active].reverse().find((w) => w.dir === dir && !w.settled);
  const open = () => active.filter((w) => !w.settled);
  return { watchFolder, active, latest, open };
}

function makeCtx() {
  let notifies = 0;
  const sleeps = []; // { ms, resolve }
  const ctx = {
    spawn: (fn) => { Promise.resolve().then(() => fn(ctx)); },
    sleep: (ms) => new Promise((resolve) => sleeps.push({ ms, resolve })),
    notify: () => { notifies++; },
  };
  const drainSleeps = async () => {
    while (sleeps.length) {
      const s = sleeps.shift();
      s.resolve();
      await flush();
    }
  };
  return { ctx, sleeps, drainSleeps, get notifies() { return notifies; } };
}

test("parseRepoPaths & watchDirsFor handle normal repos and linked worktrees", () => {
  assert.deepEqual(parseRepoPaths("/repo\n/repo/.git\n"), { root: "/repo", gitDir: "/repo/.git" });
  assert.deepEqual(parseRepoPaths("C:\\work\\app\r\nC:\\work\\app\\.git\r\n"), { root: "C:\\work\\app", gitDir: "C:\\work\\app\\.git" });
  assert.equal(parseRepoPaths(""), null);

  assert.deepEqual(watchDirsFor("/repo", "/repo/.git"), ["/repo"]);
  assert.deepEqual(watchDirsFor("C:\\work\\app", "c:/work/app/.git"), ["C:\\work\\app"]);
  assert.deepEqual(
    watchDirsFor("/wt/feat", "/repo/.git/worktrees/feat"),
    ["/wt/feat", "/repo/.git/worktrees/feat"],
  );
  assert.deepEqual(watchDirsFor("/repo", null), ["/repo"]);
});

test("parseNumstat & parsePorcelainStatus preserve status codes, binary flags, tabs, and limit", () => {
  const stats = parseNumstat("10\t2\tsrc/a.js\x00-\t-\timg.png\x003\t0\tdir/with\ttab.txt\x00");
  assert.deepEqual(stats, {
    "src/a.js": { add: 10, del: 2, binary: false },
    "img.png": { add: 0, del: 0, binary: true },
    "dir/with\ttab.txt": { add: 3, del: 0, binary: false },
  });
  const out = parsePorcelainStatus(" M src/a.js\x00?? new.js\x00 D gone.js\x00UU conf.js\x00", stats, 3);
  assert.equal(out.limited, true);
  assert.deepEqual(out.files, [
    { path: "src/a.js", status: "M", fresh: false, add: 10, del: 2, binary: false },
    { path: "new.js", status: "A", fresh: true, add: 0, del: 0 },
    { path: "gone.js", status: "D", fresh: false, add: 0, del: 0 },
  ]);
});

test("fetchChanges runs status and diff HEAD in parallel and skips rev-parse when root is cached", async () => {
  const calls = [];
  const exec = async (_cmd, args) => {
    calls.push(args);
    if (args.includes("--show-toplevel")) return { code: 0, stdout: "/repo\n/repo/.git\n", stderr: "" };
    if (args.includes("status")) return { code: 0, stdout: " M a.js\0", stderr: "" };
    if (args.includes("diff") && args.includes("HEAD")) return { code: 0, stdout: "4\t1\ta.js\0", stderr: "" };
    throw new Error(`unexpected: ${args.join(" ")}`);
  };

  const first = await fetchChanges({ exec, cwd: "/repo/sub", on: null });
  assert.equal(first.notRepo, false);
  assert.equal(first.root, "/repo");
  assert.equal(first.gitDir, "/repo/.git");
  assert.equal(first.hasHead, true);
  assert.deepEqual(first.files, [{ path: "a.js", status: "M", fresh: false, add: 4, del: 1, binary: false }]);
  assert.equal(calls.length, 3);

  calls.length = 0;
  const second = await fetchChanges({ exec, cwd: "/repo/sub", on: null, root: first.root, gitDir: first.gitDir });
  assert.equal(second.files.length, 1);
  // Cached root skips rev-parse completely: only status + diff HEAD --numstat.
  assert.equal(calls.length, 2);
});

test("fetchChanges handles unborn HEAD (fresh git init) and deleted cached repo", async () => {
  let exists = true;
  const exec = async (_cmd, args) => {
    if (args.includes("--show-toplevel")) return exists ? { code: 0, stdout: "/fresh\n/fresh/.git\n", stderr: "" } : { code: 128, stdout: "", stderr: "not a git repo" };
    if (args.includes("status")) return exists ? { code: 0, stdout: "A  init.js\0", stderr: "" } : { code: 128, stdout: "", stderr: "not a git repo" };
    if (args.includes("HEAD") && args.includes("diff")) return { code: 128, stdout: "", stderr: "ambiguous argument 'HEAD'" };
    if (args.includes("--verify")) return { code: 128, stdout: "", stderr: "Needed a single revision" };
    if (args.includes("--cached")) return { code: 0, stdout: "5\t0\tinit.js\0", stderr: "" };
    if (args.includes("diff")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected: ${args.join(" ")}`);
  };

  const r = await fetchChanges({ exec, cwd: "/fresh", on: null });
  assert.equal(r.hasHead, false);
  assert.deepEqual(r.files, [{ path: "init.js", status: "A", fresh: false, add: 5, del: 0, binary: false }]);

  exists = false;
  const gone = await fetchChanges({ exec, cwd: "/fresh", on: null, root: "/fresh", gitDir: "/fresh/.git" });
  assert.equal(gone.notRepo, true);
});

test("createChangesSync queues a trailing refresh when watch events arrive during an in-flight load", async () => {
  const { watchFolder, latest } = makeWatchHarness();
  const { ctx, drainSleeps } = makeCtx();
  const runs = [];
  let inFlight = null;

  const sync = createChangesSync({
    watchFolder,
    getLocation: () => ({ cwd: "/repo", on: null }),
    onRun: async () => {
      const idx = runs.length + 1;
      runs.push(idx);
      inFlight = deferred();
      await inFlight.promise;
      return { root: "/repo", gitDir: "/repo/.git" };
    },
  });

  // Initial load finishes and starts watching /repo.
  sync.refresh(ctx);
  await flush();
  assert.deepEqual(runs, [1]);
  inFlight.resolve();
  await flush();
  await flush();
  assert.ok(latest("/repo"), "started watching /repo");

  // File 1 changes → coalesce → starts run #2.
  latest("/repo").resolve(["/repo/a.js"]);
  await flush();
  await drainSleeps();
  assert.deepEqual(runs, [1, 2]);
  assert.equal(sync.loading, true);

  // Files 2 & 3 change WHILE run #2 is still in flight!
  latest("/repo").resolve(["/repo/b.js"]);
  await flush();
  latest("/repo").resolve(["/repo/c.js"]);
  await flush();
  assert.deepEqual(runs, [1, 2], "does not overlap run #2");

  // Run #2 finishes → automatically schedules run #3 (no 10 s timer wait!).
  inFlight.resolve();
  await flush();
  await drainSleeps();
  assert.deepEqual(runs, [1, 2, 3]);

  inFlight.resolve();
  await flush();
  assert.equal(sync.loading, false);
  sync.close();
});

test("createChangesSync cancels watches on repo switch and panel hide, and refreshes when shown again", async () => {
  const { watchFolder, active } = makeWatchHarness();
  const { ctx } = makeCtx();
  let loc = { cwd: "/repo-a", on: null };
  const runs = [];

  const sync = createChangesSync({
    watchFolder,
    getLocation: () => loc,
    onRun: async ({ loc: l }) => {
      runs.push(l.cwd);
      return { root: l.cwd, gitDir: `${l.cwd}/.git` };
    },
  });

  sync.refresh(ctx);
  await flush();
  await flush();
  assert.deepEqual(runs, ["/repo-a"]);
  assert.equal(active.length, 1);
  assert.equal(active[0].cancelled, false);

  // Switch repo → cancels old watch and watches new repo.
  loc = { cwd: "/repo-b", on: null };
  sync.refresh(ctx);
  await flush();
  await flush();
  assert.equal(active[0].cancelled, true);
  assert.deepEqual(runs, ["/repo-a", "/repo-b"]);
  assert.equal(active[1].dir, "/repo-b");
  assert.equal(active[1].cancelled, false);

  // Hide panel → cancels active watch.
  sync.setVisible(false, ctx);
  assert.equal(active[1].cancelled, true);

  // Show panel again → immediately refreshes even though context didn't change.
  sync.setVisible(true, ctx);
  await flush();
  await flush();
  assert.deepEqual(runs, ["/repo-a", "/repo-b", "/repo-b"]);
  sync.close();
});

test("createChangesSync watches both root and external gitDir for linked worktrees", async () => {
  const { watchFolder, active, latest } = makeWatchHarness();
  const { ctx, drainSleeps } = makeCtx();
  let runs = 0;

  const sync = createChangesSync({
    watchFolder,
    getLocation: () => ({ cwd: "/wt/feat", on: null }),
    onRun: async () => {
      runs++;
      return { root: "/wt/feat", gitDir: "/repo/.git/worktrees/feat" };
    },
  });

  sync.refresh(ctx);
  await flush();
  await flush();
  assert.deepEqual(active.map((w) => w.dir).sort(), ["/repo/.git/worktrees/feat", "/wt/feat"]);

  // A git operation writing to the external gitDir wakes Changes immediately.
  latest("/repo/.git/worktrees/feat").resolve(["/repo/.git/worktrees/feat/index"]);
  await flush();
  await drainSleeps();
  assert.equal(runs, 2);
  sync.close();
});

test("createChangesSync falls back to fast polling when watchFolder rejects, without spamming watch retries", async () => {
  let watchCalls = 0;
  const watchFolder = () => {
    watchCalls++;
    const p = Promise.reject(new Error("too many directories"));
    p.cancel = () => {};
    return p;
  };
  let t = 1000;
  let runs = 0;
  const errors = [];
  const { ctx } = makeCtx();

  const sync = createChangesSync({
    watchFolder,
    now: () => t,
    getLocation: () => ({ cwd: "/huge", on: null }),
    onRun: async () => { runs++; return { root: "/huge", gitDir: "/huge/.git" }; },
    onWatchError: (dir, e) => errors.push([dir, e.message]),
    pollMs: 2500,
    safetyPollMs: 10000,
    watchRetryMs: 60000,
  });

  sync.refresh(ctx);
  await flush();
  await flush();
  assert.equal(runs, 1);
  assert.equal(watchCalls, 1);
  assert.equal(sync.watchActive, false);
  assert.equal(errors.length, 1);

  // 2.5 s later: polls immediately, does NOT re-call watchFolder yet.
  t += 2500;
  sync.tick(ctx);
  await flush();
  await flush();
  assert.equal(runs, 2);
  assert.equal(watchCalls, 1);

  // After 60 s cooldown: retries watchFolder once.
  t += 60000;
  sync.tick(ctx);
  await flush();
  await flush();
  assert.equal(runs, 3);
  assert.equal(watchCalls, 2);
  sync.close();
});

test("pollDecision uses fast poll when unwatched and safety poll when watched, and pauses when hidden", () => {
  assert.deepEqual(
    pollDecision({ visible: false, loading: false, busy: false, watchActive: false, lastRefreshAt: 0, watchFailedAt: null, now: 99999 }),
    { refresh: false, retryWatch: false },
  );
  assert.deepEqual(
    pollDecision({ visible: true, loading: false, busy: false, watchActive: true, lastRefreshAt: 1000, watchFailedAt: null, now: 5000 }),
    { refresh: false, retryWatch: false },
  );
  assert.deepEqual(
    pollDecision({ visible: true, loading: false, busy: false, watchActive: true, lastRefreshAt: 1000, watchFailedAt: null, now: 11000 }),
    { refresh: true, retryWatch: false },
  );
  assert.deepEqual(
    pollDecision({ visible: true, loading: false, busy: false, watchActive: false, lastRefreshAt: 1000, watchFailedAt: null, now: 3500 }),
    { refresh: true, retryWatch: false },
  );
});

test("createChangesSync ignores empty watch batches without tight-looping and handles busy + mid-flight context switch", async () => {
  const { watchFolder, latest, open } = makeWatchHarness();
  const { ctx, sleeps } = makeCtx();
  let loc = { cwd: "/repo-a", on: null };
  const gates = {};
  const runs = [];

  const sync = createChangesSync({
    watchFolder,
    getLocation: () => loc,
    onRun: async ({ loc: l }) => {
      runs.push(l.cwd);
      const g = deferred();
      gates[l.cwd] = g;
      await g.promise;
      return { root: l.cwd, gitDir: `${l.cwd}/.git` };
    },
    emptyWatchMs: 1000,
  });

  sync.refresh(ctx);
  await flush();
  gates["/repo-a"].resolve();
  await flush();
  await flush();
  assert.equal(runs.length, 1);

  // Empty batch from watchFolder sleeps emptyWatchMs instead of refreshing.
  latest("/repo-a").resolve([]);
  await flush();
  assert.equal(runs.length, 1);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0].ms, 1000);
  sleeps.shift().resolve();
  await flush();
  assert.equal(runs.length, 1);

  // Busy (commit in progress) defers watch events until setBusy(false, ctx).
  sync.setBusy(true);
  latest("/repo-a").resolve(["/repo-a/x.js"]);
  await flush();
  assert.equal(runs.length, 1);
  sync.setBusy(false, ctx);
  await flush();
  assert.equal(runs.length, 2);

  // Context switch while run #2 for /repo-a is still in flight starts /repo-b immediately.
  loc = { cwd: "/repo-b", on: null };
  sync.refresh(ctx);
  await flush();
  assert.deepEqual(runs, ["/repo-a", "/repo-a", "/repo-b"]);
  assert.equal(sync.loading, true);

  // Stale /repo-a finishing does NOT clear /repo-b's loading flag or re-watch /repo-a.
  gates["/repo-a"].resolve();
  await flush();
  assert.equal(sync.loading, true);

  gates["/repo-b"].resolve();
  await flush();
  await flush();
  assert.equal(sync.loading, false);
  assert.deepEqual(open().map((w) => w.dir), ["/repo-b"]);
  sync.close();
  assert.deepEqual(open(), []);
});


test("pollDecision polls a repo on another machine every 10 s, not every 2.5 s", () => {
  const base = { visible: true, loading: false, busy: false, watchActive: false, lastRefreshAt: 1000, watchFailedAt: null, remote: true };
  assert.deepEqual(pollDecision({ ...base, now: 3500 }), { refresh: false, retryWatch: false });
  assert.deepEqual(pollDecision({ ...base, now: 10999 }), { refresh: false, retryWatch: false });
  assert.deepEqual(pollDecision({ ...base, now: 11000 }), { refresh: true, retryWatch: false });
  assert.equal(REMOTE_POLL_MS, 10000);
});

test("createChangesSync keeps watch-triggered refreshes at least MIN_GAP_MS apart", async () => {
  const { watchFolder, latest } = makeWatchHarness();
  const { ctx, sleeps } = makeCtx();
  let t = 0;
  const runs = [];
  const sync = createChangesSync({
    watchFolder,
    now: () => t,
    getLocation: () => ({ cwd: "/repo", on: null }),
    onRun: async () => { runs.push(t); return { root: "/repo", gitDir: "/repo/.git" }; },
  });

  sync.refresh(ctx); // run 1 starts at t = 0
  await flush(); await flush(); await flush();
  assert.deepEqual(runs, [0]);
  assert.ok(latest("/repo"), "watching /repo");

  // A change 100 ms after run 1 started waits out the rest of the gap, not just the 80 ms coalesce.
  t = 100;
  latest("/repo").resolve(["/repo/a.js"]);
  await flush(); await flush();
  const wait = sleeps.at(-1);
  assert.equal(wait.ms, MIN_GAP_MS - 100);

  t = 500;
  wait.resolve(); await flush(); await flush(); await flush();
  assert.deepEqual(runs, [0, 500]);

  // Long after, a change only waits the coalesce window.
  t = 5000;
  latest("/repo").resolve(["/repo/b.js"]);
  await flush(); await flush();
  assert.equal(sleeps.at(-1).ms, COALESCE_MS);
  assert.equal(MIN_GAP_MS, 500);
  sync.close();
});

// ---- The branch it follows, and the branch view ----
import { parsePorcelainStatus as parseStatus, fetchChanges as fetchBranch } from "../src/shared/changes.js";

test("parsePorcelainStatus: the ## header gives the branch and isn't a file", () => {
  const a = parseStatus("## feat...origin/feat\0 M a.js\0", {});
  assert.equal(a.branch, "feat");
  assert.deepEqual(a.files.map((f) => f.path), ["a.js"]);
  assert.equal(parseStatus("## HEAD (no branch)\0", {}).branch, null);
  const fresh = parseStatus("## No commits yet on main\0?? x\0", {});
  assert.equal(fresh.branch, "main");
  assert.deepEqual(fresh.files.map((f) => f.path), ["x"]);
});

// A fake git: `branch` checked out; refs: which local branches exist; originHead: origin/HEAD's target (or null).
const fakeGit = ({ branch = "feat", refs = ["main"], originHead = "origin/main" } = {}) => async (_cmd, args) => {
  const has = (x) => args.includes(x);
  if (has("--show-toplevel")) return { code: 0, stdout: "/repo\n/repo/.git\n", stderr: "" };
  if (has("status")) return { code: 0, stdout: `## ${branch}...origin/${branch}\0 M a.js\0?? n.js\0`, stderr: "" };
  if (has("symbolic-ref")) return originHead ? { code: 0, stdout: `${originHead}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" };
  if (has("--verify")) { const ref = args.at(-1).replace("refs/heads/", ""); return { code: refs.includes(ref) ? 0 : 1, stdout: "", stderr: "" }; }
  if (has("merge-base")) return { code: 0, stdout: "abc123\n", stderr: "" };
  if (has("diff") && has("abc123") && has("--name-status")) return { code: 0, stdout: "M\0a.js\0A\0b.js\0", stderr: "" };
  if (has("diff") && has("abc123")) return { code: 0, stdout: "4\t1\ta.js\0" + "10\t0\tb.js\0", stderr: "" };
  if (has("diff") && has("HEAD")) return { code: 0, stdout: "4\t1\ta.js\0", stderr: "" };
  throw new Error(`unexpected: ${args.join(" ")}`);
};

test("fetchChanges: uncommitted view reports the branch it follows", async () => {
  const r = await fetchBranch({ exec: fakeGit(), cwd: "/repo", on: null });
  assert.equal(r.branch, "feat");
  assert.deepEqual(r.files.map((f) => f.path).sort(), ["a.js", "n.js"]);
});

test("fetchChanges branch view: committed and uncommitted since the merge base, plus untracked", async () => {
  const r = await fetchBranch({ exec: fakeGit(), cwd: "/repo", on: null, mode: "branch" });
  assert.equal(r.base, "main");
  assert.equal(r.mergeBase, "abc123");
  assert.equal(r.onBase, false);
  const by = Object.fromEntries(r.files.map((f) => [f.path, [f.status, f.add, f.del, f.fresh]]));
  assert.deepEqual(by, { "a.js": ["M", 4, 1, false], "b.js": ["A", 10, 0, false], "n.js": ["A", 0, 0, true] });
});

test("fetchChanges branch view: on the default branch there's nothing to compare; base found by origin/HEAD, local first", async () => {
  const on = await fetchBranch({ exec: fakeGit({ branch: "main" }), cwd: "/repo", on: null, mode: "branch" });
  assert.equal(on.onBase, true);
  assert.deepEqual(on.files, []);
  const master = await fetchBranch({ exec: fakeGit({ refs: ["master"], originHead: null }), cwd: "/repo", on: null, mode: "branch" });
  assert.equal(master.base, "master");
  const remote = await fetchBranch({ exec: fakeGit({ refs: [], originHead: "origin/dev" }), cwd: "/repo", on: null, mode: "branch" });
  assert.equal(remote.base, "origin/dev");
  const none = await fetchBranch({ exec: fakeGit({ refs: [], originHead: null }), cwd: "/repo", on: null, mode: "branch" });
  assert.equal(none.base, null);
  assert.deepEqual(none.files, []);
});

// ---- The panel's header line and empty states ----
import { followsLine, emptyText, FILE_LIMIT as LIMIT } from "../src/shared/changes.js";

test("followsLine: folder and branch, detached, and the base in the branch view", () => {
  assert.equal(followsLine({ root: "/Users/a/dev/herdr-dock", branch: "feat", view: "uncommitted", base: "main" }), "herdr-dock · feat");
  assert.equal(followsLine({ root: "/r/repo", branch: null, view: "uncommitted" }), "repo · detached");
  assert.equal(followsLine({ root: "C:/w/repo/", branch: "feat", view: "branch", base: "origin/dev" }), "repo · feat · vs origin/dev");
  assert.equal(followsLine({ root: "/r/repo", branch: "main", view: "branch", base: null }), "repo · main");
  assert.equal(followsLine({ root: null, branch: null, view: "uncommitted" }), "");
});

test("emptyText: says why the list is empty, in each view", () => {
  const at = { root: "/r/repo", branch: "feat", loading: false, error: null };
  assert.equal(emptyText({ ...at, view: "uncommitted" }), "No uncommitted changes");
  assert.equal(emptyText({ ...at, view: "branch", base: "main", mergeBase: "abc", onBase: false }), "Nothing on feat that isn't on main");
  assert.equal(emptyText({ ...at, branch: null, view: "branch", base: "main", mergeBase: "abc", onBase: false }), "Nothing on HEAD that isn't on main");
  assert.equal(emptyText({ ...at, branch: "main", view: "branch", base: "main", mergeBase: null, onBase: true }), "On main: nothing to compare");
  assert.equal(emptyText({ ...at, view: "branch", base: null }), "No main or master branch to compare with");
  assert.equal(emptyText({ ...at, view: "branch", base: "main", mergeBase: null, onBase: false }), "No history shared with main");
  assert.equal(emptyText({ ...at, root: null, view: "branch" }), "No folder");
  assert.equal(emptyText({ ...at, loading: true, view: "branch" }), "Loading changes…");
  assert.equal(emptyText({ ...at, error: "Not a git repository", view: "branch" }), "Not a git repository");
});

test("fetchChanges branch view: a branch with more files than the limit lists the first ones and says so", async () => {
  const many = Array.from({ length: LIMIT + 5 }, (_, i) => `f${i}.js`);
  const base = fakeGit();
  const exec = async (cmd, args) => {
    if (args.includes("diff") && args.includes("abc123")) {
      return { code: 0, stdout: args.includes("--name-status") ? many.map((p) => `M\0${p}\0`).join("") : many.map((p) => `1\t0\t${p}\0`).join(""), stderr: "" };
    }
    return base(cmd, args);
  };
  const r = await fetchBranch({ exec, cwd: "/repo", on: null, mode: "branch" });
  assert.equal(r.files.length, LIMIT);
  assert.equal(r.limited, true);
});
