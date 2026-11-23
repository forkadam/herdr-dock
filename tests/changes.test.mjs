import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRepoPaths,
  watchDirsFor,
  parseNumstat,
  parsePorcelainStatus,
  fetchChanges,
  pollDecision,
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

