import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollector } from "../src/shared/collector.js";
import { removeRepoPaths, skipAfterRemove } from "../src/mods/dock-git/view.js";

const ok = (stdout) => ({ code: 0, stdout, stderr: "" });
const wtList = (...wts) =>
  ok(wts.map(([path, branch]) => `worktree ${path}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/${branch}\n`).join("\n"));
const status = (branch, { ab = "+0 -0", dirty = false, oid = "b".repeat(40) } = {}) =>
  ok([
    `# branch.oid ${oid}`,
    `# branch.head ${branch}`,
    `# branch.upstream origin/${branch}`,
    `# branch.ab ${ab}`,
    ...(dirty ? ["? new.txt"] : []),
  ].join("\n"));

// A fake host. `table` answers exec calls keyed by `${on ?? ""} ${args.join(" ")}`.
function fakeIo({ table = {}, repos = [], panes = [], spaces = [], platform = "windows", autoAdd = false } = {}) {
  const store = new Map([["dock.git.repos", repos]]);
  const io = {
    t: 0,
    calls: [],
    sets: [],
    active: 0,
    maxActive: 0,
    platform,
    autoAdd,
    now: () => io.t,
    panes: () => panes,
    spaces: () => spaces,
    shared: (k) => store.get(k),
    setShared: (k, v) => { store.set(k, v); io.sets.push(k); },
    notify() {},
    playSound() {},
    log() {},
    fetch: async () => { throw new Error("no fetch in git tests"); },
    async exec(cmd, args, opts) {
      if (cmd !== "git") throw new Error(`spawn ${cmd} ENOENT`); // no glab/gh here: CI shows "not logged in"
      const key = `${opts?.on ?? ""} ${args.join(" ")}`;
      io.calls.push({ key, on: opts?.on, timeout: opts?.timeout });
      io.active++;
      io.maxActive = Math.max(io.maxActive, io.active);
      await new Promise((r) => setTimeout(r, 1));
      io.active--;
      const a = table[key];
      if (a === undefined) return { code: 128, stdout: "", stderr: `fatal: no answer for ${key}` };
      return typeof a === "function" ? a() : a;
    },
  };
  return io;
}

const NO_ORIGIN = { code: 2, stdout: "", stderr: "error: No such remote 'origin'" };
const callsTo = (io, frag) => io.calls.filter((c) => c.key.includes(frag)).length;

test("(a) an added repo with two worktrees, plus a terminal repo on a second machine", async () => {
  const io = fakeIo({
    repos: [{ path: "D:/work/api", machine: null }],
    spaces: [{ id: "s1", name: "dev", machine: "devbox", tabs: [{ id: "t1" }] }],
    panes: [
      { pane: "p1", tab: "t1", cwd: "/home/me/tool/lib", branch: "main" },
      { pane: "m1", tab: "t1", cwd: null },
    ],
    table: {
      " -C D:/work/api rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/work/api\nD:/work/api/.git\n"),
      " -C D:/work/api worktree list --porcelain": wtList(["D:/work/api", "main"], ["D:/work/api-login", "feature/login"]),
      " -C D:/work/api remote get-url origin": ok("git@gitlab.corp:grp/api.git\n"),
      " --no-optional-locks -C D:/work/api status --porcelain=v2 --branch": status("main", { ab: "+0 -2" }),
      " --no-optional-locks -C D:/work/api-login status --porcelain=v2 --branch": status("feature/login", { ab: "+1 -0", dirty: true }),
      "devbox -C /home/me/tool/lib rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("/home/me/tool\n/home/me/tool/.git\n"),
      "devbox -C /home/me/tool remote get-url origin": ok("https://github.com/me/tool.git\n"),
      "devbox --no-optional-locks -C /home/me/tool status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await c.tick();
  const s = c.state();
  assert.equal(s.repos.length, 2);
  const [api, tool] = s.repos;
  assert.equal(api.name, "api");
  assert.equal(api.machine, null);
  assert.equal(api.added, true);
  assert.equal(api.error, null);
  assert.equal(api.provider, "gitlab"); // assumed for a non-github host, with a login hint (no glab here)
  assert.equal(api.host, "gitlab.corp");
  assert.equal(api.path, "grp/api");
  assert.deepEqual(api.worktrees.map((w) => [w.path, w.branch, w.ahead, w.behind, w.dirty, w.open]), [
    ["D:/work/api", "main", 0, 2, false, false],
    ["D:/work/api-login", "feature/login", 1, 0, true, false],
  ]);
  assert.equal(api.worktrees[0].id, "|d:/work/api");
  assert.equal(api.worktrees[0].sha, "b".repeat(40));
  assert.equal(api.worktrees[0].upstream, "origin/main");
  assert.equal(api.worktrees[0].pipeline.status, "unknown");
  assert.equal(api.worktrees[0].pipeline.error, "not logged in");

  assert.equal(tool.name, "tool · devbox");
  assert.equal(tool.machine, "devbox");
  assert.equal(tool.added, false);
  assert.equal(tool.host, "github.com");
  assert.equal(tool.worktrees.length, 1);
  assert.equal(tool.worktrees[0].id, "devbox|/home/me/tool");
  assert.equal(tool.worktrees[0].open, true);
  assert.equal(tool.worktrees[0].space, "s1");
  // Every devbox call ran on devbox; local calls carry on: undefined.
  for (const call of io.calls) assert.equal(call.on, call.key.includes("/home/me") ? "devbox" : undefined);
});

test("(b) the same worktree added and reached from a terminal is one row", async () => {
  const io = fakeIo({
    repos: [{ path: "D:\\work\\api", machine: null }],
    spaces: [{ id: "s9", name: "main", machine: null, tabs: [{ id: "t1" }] }],
    panes: [{ pane: "p1", tab: "t1", cwd: "d:/work/api/src", branch: "main" }],
    table: {
      " -C D:/work/api rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/work/api\nD:/work/api/.git\n"),
      " -C D:/work/api worktree list --porcelain": wtList(["D:/work/api", "main"]),
      " -C d:/work/api/src rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/work/api\nD:/work/api/.git\n"),
      " -C D:/work/api remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C D:/work/api status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await c.tick();
  const s = c.state();
  assert.equal(s.repos.length, 1);
  assert.equal(s.repos[0].added, true);
  assert.equal(s.repos[0].worktrees.length, 1);
  assert.equal(s.repos[0].worktrees[0].open, true);
  assert.equal(s.repos[0].worktrees[0].space, "s9");
});

test("(c) an added path that is no longer a repo, and a repo with no origin", async () => {
  const io = fakeIo({
    repos: [{ path: "D:/gone", machine: null }, { path: "D:/local", machine: null }],
    table: {
      " -C D:/gone rev-parse --path-format=absolute --show-toplevel --git-common-dir": { code: 128, stdout: "", stderr: "fatal: not a git repository" },
      " -C D:/local rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/local\nD:/local/.git\n"),
      " -C D:/local worktree list --porcelain": wtList(["D:/local", "main"]),
      " -C D:/local remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C D:/local status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await c.tick();
  const [gone, local] = c.state().repos;
  assert.equal(gone.name, "gone");
  assert.equal(gone.added, true);
  assert.match(gone.error, /not a git repository/);
  assert.deepEqual(gone.worktrees, []);
  assert.equal(local.error, null);
  assert.equal(local.host, null);
  assert.equal(local.provider, null);
  assert.equal(local.worktrees.length, 1);
  assert.equal(local.worktrees[0].branch, "main");
});

test("(c2) exec throwing (e.g. an unreachable machine) is an error, not a crash", async () => {
  const io = fakeIo({ repos: [{ path: "/srv/x", machine: "devbox" }] });
  io.exec = async () => { throw new Error("ssh: connect refused"); };
  const c = createCollector(io);
  await c.tick();
  const [r] = c.state().repos;
  assert.equal(r.name, "x · devbox");
  assert.match(r.error, /connect refused/);
});

test("(d) git cadence: open worktrees every 15 s, others every 60 s; refresh polls now", async () => {
  const io = fakeIo({
    repos: [{ path: "D:/work/api", machine: null }],
    spaces: [{ id: "s1", name: "dev", machine: null, tabs: [{ id: "t1" }] }],
    panes: [{ pane: "p1", tab: "t1", cwd: "D:/work/api", branch: "main" }],
    table: {
      " -C D:/work/api rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/work/api\nD:/work/api/.git\n"),
      " -C D:/work/api worktree list --porcelain": wtList(["D:/work/api", "main"], ["D:/work/api-x", "x"]),
      " -C D:/work/api remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C D:/work/api status --porcelain=v2 --branch": status("main"),
      " --no-optional-locks -C D:/work/api-x status --porcelain=v2 --branch": status("x"),
    },
  });
  const c = createCollector(io);
  const openPolls = () => callsTo(io, "D:/work/api status");
  const otherPolls = () => callsTo(io, "D:/work/api-x status");
  await c.tick();
  assert.deepEqual([openPolls(), otherPolls()], [1, 1]);
  io.t = 10000; await c.tick();
  assert.deepEqual([openPolls(), otherPolls()], [1, 1]);
  io.t = 15000; await c.tick();
  assert.deepEqual([openPolls(), otherPolls()], [2, 1]);
  io.t = 59000; await c.tick();
  assert.equal(otherPolls(), 1);
  io.t = 60000; await c.tick();
  assert.equal(otherPolls(), 2);
  assert.equal(callsTo(io, "remote get-url"), 1, "origin is read once per repo");
  c.refresh();
  io.t = 61000; await c.tick();
  assert.deepEqual([openPolls(), otherPolls()], [4, 3]);
});

test("(e) never more than 4 git processes at once", async () => {
  const table = {
    " -C D:/r rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/r\nD:/r/.git\n"),
    " -C D:/r remote get-url origin": NO_ORIGIN,
  };
  const wts = [];
  for (let i = 0; i < 10; i++) {
    const p = i ? `D:/r-${i}` : "D:/r";
    wts.push([p, `b${i}`]);
    table[` --no-optional-locks -C ${p} status --porcelain=v2 --branch`] = status(`b${i}`);
  }
  table[" -C D:/r worktree list --porcelain"] = wtList(...wts);
  const io = fakeIo({ repos: [{ path: "D:/r", machine: null }], table });
  const c = createCollector(io);
  await c.tick();
  assert.equal(c.state().repos[0].worktrees.length, 10);
  assert.equal(callsTo(io, "status"), 10);
  assert.ok(io.maxActive <= 4, `max ${io.maxActive}`);
  assert.equal(io.maxActive, 4);
});

test("(f) publishes dock.git.state only when it changed", async () => {
  let st = status("main");
  const io = fakeIo({
    repos: [{ path: "D:/local", machine: null }],
    table: {
      " -C D:/local rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/local\nD:/local/.git\n"),
      " -C D:/local worktree list --porcelain": wtList(["D:/local", "main"]),
      " -C D:/local remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C D:/local status --porcelain=v2 --branch": () => st,
    },
  });
  const c = createCollector(io);
  await c.tick();
  const count = () => io.sets.filter((k) => k === "dock.git.state").length;
  assert.equal(count(), 1);
  assert.equal(io.shared("dock.git.state"), c.state());
  io.t = 60000; await c.tick();
  assert.equal(count(), 1, "same state, no write");
  st = status("main", { dirty: true });
  io.t = 120000; await c.tick();
  assert.equal(count(), 2);
  assert.equal(c.state().repos[0].worktrees[0].dirty, true);
  assert.equal(c.state().updatedAt, 120000);
});

test("a terminal in a linked worktree of a non-added repo lists only that worktree", async () => {
  const io = fakeIo({
    platform: "linux",
    spaces: [{ id: "s1", name: "a", machine: null, tabs: [{ id: "t1" }] }],
    panes: [{ pane: "p1", tab: "t1", cwd: "/w/api-fix", branch: "fix" }],
    table: {
      " -C /w/api-fix rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("/w/api-fix\n/w/api/.git\n"),
      " -C /w/api-fix remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C /w/api-fix status --porcelain=v2 --branch": status("fix"),
    },
  });
  const c = createCollector(io);
  await c.tick();
  const [r] = c.state().repos;
  assert.equal(r.name, "api");
  assert.equal(r.id, "|/w/api/.git");
  assert.deepEqual(r.worktrees.map((w) => w.path), ["/w/api-fix"]);
  assert.equal(callsTo(io, "worktree list"), 0);
});

test("a closed terminal drops its non-added worktree; a cwd outside any repo shows nothing", async () => {
  let panes = [{ pane: "p1", tab: "t1", cwd: "/w/tool", branch: "main" }, { pane: "p2", tab: "t1", cwd: "/tmp" }];
  const io = fakeIo({
    platform: "linux",
    spaces: [{ id: "s1", name: "a", machine: null, tabs: [{ id: "t1" }] }],
    table: {
      " -C /w/tool rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("/w/tool\n/w/tool/.git\n"),
      " -C /w/tool remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C /w/tool status --porcelain=v2 --branch": status("main"),
    },
  });
  io.panes = () => panes;
  const c = createCollector(io);
  await c.tick();
  assert.equal(c.state().repos.length, 1);
  io.t = 1000; await c.tick();
  assert.equal(callsTo(io, "/tmp rev-parse"), 1, "a non-repo cwd is cached too");
  panes = [];
  io.t = 2000; await c.tick();
  assert.deepEqual(c.state().repos, []);
});

test("overlapping ticks: a slow status from an older tick doesn't republish a stale list", async () => {
  let releaseB;
  const slowB = new Promise((r) => { releaseB = r; });
  let panes = [{ pane: "p1", tab: "t1", cwd: "/w/a" }, { pane: "p2", tab: "t1", cwd: "/w/b" }];
  const io = fakeIo({
    platform: "linux",
    spaces: [{ id: "s1", name: "x", machine: null, tabs: [{ id: "t1" }] }],
    table: {
      " -C /w/a rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("/w/a\n/w/a/.git\n"),
      " -C /w/b rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("/w/b\n/w/b/.git\n"),
      " -C /w/a remote get-url origin": NO_ORIGIN,
      " -C /w/b remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C /w/a status --porcelain=v2 --branch": status("main"),
      " --no-optional-locks -C /w/b status --porcelain=v2 --branch": () => slowB.then(() => status("main")),
    },
  });
  io.panes = () => panes;
  const published = [];
  const set = io.setShared;
  io.setShared = (k, v) => { set(k, v); if (k === "dock.git.state") published.push(v.repos.map((r) => r.name).join(",")); };
  const c = createCollector(io);
  const first = c.tick();
  while (!io.calls.some((x) => x.key.includes("/w/b status"))) await new Promise((r) => setTimeout(r, 1));
  panes = [panes[0]]; // terminal b closes while b's status is still running
  io.t = 1000;
  await c.tick();
  releaseB();
  await first;
  assert.deepEqual(published, ["a"]);
  assert.deepEqual(c.state().repos.map((r) => r.name), ["a"]);
});

test("a transient remote get-url failure is retried; only exit 2 means no origin", async () => {
  let fail = true;
  const io = fakeIo({
    repos: [{ path: "D:/local", machine: null }],
    table: {
      " -C D:/local rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/local\nD:/local/.git\n"),
      " -C D:/local worktree list --porcelain": wtList(["D:/local", "main"]),
      " --no-optional-locks -C D:/local status --porcelain=v2 --branch": status("main"),
    },
  });
  const exec = io.exec;
  io.exec = async (cmd, args, opts) => {
    if (args.includes("get-url")) {
      io.calls.push({ key: args.join(" ") });
      if (fail) throw new Error("ssh: connection reset");
      return ok("git@gitlab.corp:grp/local.git\n");
    }
    return exec(cmd, args, opts);
  };
  const c = createCollector(io);
  await c.tick();
  assert.equal(c.state().repos[0].host, null);
  io.t = 1000; await c.tick();
  assert.equal(callsTo(io, "get-url"), 1, "not retried every tick");
  fail = false;
  io.t = 60000; await c.tick();
  assert.equal(callsTo(io, "get-url"), 2);
  assert.equal(c.state().repos[0].host, "gitlab.corp");
  assert.equal(c.state().repos[0].path, "grp/local");
  io.t = 120000; await c.tick();
  assert.equal(callsTo(io, "get-url"), 2, "a found origin is read once");
});

test("overlapping ticks: an older tick finishing after a newer one pruned (but before it published) stays quiet", async () => {
  const hold = () => { let release; const p = new Promise((r) => { release = r; }); return { p, release }; };
  let holdA = null; // gates /w/a status
  let holdB = null; // gates /w/b status
  let panes = [{ pane: "p1", tab: "t1", cwd: "/w/a" }];
  const io = fakeIo({
    platform: "linux",
    spaces: [{ id: "s1", name: "x", machine: null, tabs: [{ id: "t1" }] }],
    table: {
      " -C /w/a rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("/w/a\n/w/a/.git\n"),
      " -C /w/b rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("/w/b\n/w/b/.git\n"),
      " -C /w/a remote get-url origin": NO_ORIGIN,
      " -C /w/b remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C /w/a status --porcelain=v2 --branch": () => (holdA ? holdA.p : Promise.resolve()).then(() => status("main")),
      " --no-optional-locks -C /w/b status --porcelain=v2 --branch": () => (holdB ? holdB.p : Promise.resolve()).then(() => status("main")),
    },
  });
  io.panes = () => panes;
  const published = [];
  const set = io.setShared;
  io.setShared = (k, v) => { set(k, v); if (k === "dock.git.state") published.push(v.repos.map((r) => r.name).join(",")); };
  const waitCall = async (frag, n) => {
    while (callsTo(io, frag) < n) await new Promise((r) => setTimeout(r, 1));
  };
  const c = createCollector(io);
  await c.tick(); // tick0 publishes "a"
  // Tick A: pane b opens; b's status is held.
  holdB = hold();
  panes = [panes[0], { pane: "p2", tab: "t1", cwd: "/w/b" }];
  io.t = 1000;
  const tickA = c.tick();
  await waitCall("/w/b status", 1);
  // Tick B: pane b closes; B prunes b, and its due status for a is held.
  holdA = hold();
  panes = [panes[0]];
  io.t = 15000;
  const tickB = c.tick();
  await waitCall("/w/a status", 2);
  // A finishes after B pruned, before B published.
  holdB.release();
  await tickA;
  holdA.release();
  await tickB;
  assert.deepEqual(published, ["a"]);
  assert.deepEqual(c.state().repos.map((r) => r.name), ["a"]);
});

// --- final-review fixes -------------------------------------------------------------------------

const RP = "rev-parse --path-format=absolute --show-toplevel --git-common-dir";
const siblings = (answer) => fakeIo({
  spaces: [{ id: "s1", name: "dev", machine: null, tabs: [{ id: "t1" }] }],
  panes: [{ pane: "p1", tab: "t1", cwd: "D:/work/api/src" }, { pane: "p2", tab: "t1", cwd: "D:/work/web/src" }],
  table: {
    [` -C D:/work/api/src ${RP}`]: answer("api"),
    [` -C D:/work/web/src ${RP}`]: answer("web"),
    " -C D:/work/api remote get-url origin": ok("git@gitlab.corp:grp/api.git\n"),
    " -C D:/work/web remote get-url origin": ok("git@gitlab.corp:grp/web.git\n"),
    " --no-optional-locks -C D:/work/api status --porcelain=v2 --branch": status("main"),
    " --no-optional-locks -C D:/work/web status --porcelain=v2 --branch": status("dev"),
  },
});
const assertSiblings = (c) => {
  const repos = c.state().repos;
  assert.deepEqual(repos.map((r) => [r.id, r.name, r.host, r.path]), [
    ["|d:/work/api/.git", "api", "gitlab.corp", "grp/api"],
    ["|d:/work/web/.git", "web", "gitlab.corp", "grp/web"],
  ]);
  assert.deepEqual(repos.map((r) => r.worktrees.map((w) => [w.path, w.branch, w.open])), [
    [["D:/work/api", "main", true]], [["D:/work/web", "dev", true]],
  ]);
};

test("fix 1: sibling repos opened from terminals in their src/ subfolders are two repos, each with its origin", async () => {
  // Real `git -C <sub> rev-parse --path-format=absolute ...` output.
  const io = siblings((n) => ok(`D:/work/${n}\nD:/work/${n}/.git\n`));
  const c = createCollector(io);
  await c.tick();
  assertSiblings(c);
});

test("fix 1: a relative common dir (git without --path-format) resolves against the -C folder, not top", async () => {
  // What git prints without --path-format=absolute: relative to the -C folder.
  const io = siblings((n) => ok(`D:/work/${n}\n../.git\n`));
  const c = createCollector(io);
  await c.tick();
  assertSiblings(c);
});

test("fix 1: an added repo folder plus a terminal in its subfolder is one row, open", async () => {
  const io = fakeIo({
    repos: [{ path: "D:\\work\\api", machine: null }],
    spaces: [{ id: "s9", name: "main", machine: null, tabs: [{ id: "t1" }] }],
    panes: [{ pane: "p1", tab: "t1", cwd: "d:/work/api/src" }],
    table: {
      [` -C D:/work/api ${RP}`]: ok("D:/work/api\nD:/work/api/.git\n"),
      " -C D:/work/api worktree list --porcelain": wtList(["D:/work/api", "main"]),
      [` -C d:/work/api/src ${RP}`]: ok("D:/work/api\nD:/work/api/.git\n"),
      " -C D:/work/api remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C D:/work/api status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await c.tick();
  const { repos } = c.state();
  assert.equal(repos.length, 1);
  assert.equal(repos[0].worktrees.length, 1);
  assert.equal(repos[0].worktrees[0].open, true);
  assert.equal(repos[0].worktrees[0].id, "|d:/work/api");
});

test("fix 3: git status runs with --no-optional-locks (never takes index.lock)", async () => {
  const io = fakeIo({
    repos: [{ path: "D:/local", machine: null }],
    table: {
      [` -C D:/local ${RP}`]: ok("D:/local\nD:/local/.git\n"),
      " -C D:/local worktree list --porcelain": wtList(["D:/local", "main"]),
      " -C D:/local remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C D:/local status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await c.tick();
  const st = io.calls.filter((x) => x.key.includes(" status "));
  assert.equal(st.length, 1);
  assert.ok(st[0].key.startsWith(" --no-optional-locks -C D:/local status"), st[0].key);
  assert.equal(c.state().repos[0].worktrees[0].branch, "main");
});

test("fix 6: a cwd whose rev-parse couldn't run (code -1) isn't cached; it retries on the git cadence", async () => {
  let down = true;
  const io = fakeIo({
    platform: "linux",
    spaces: [{ id: "s1", name: "a", machine: null, tabs: [{ id: "t1" }] }],
    panes: [{ pane: "p1", tab: "t1", cwd: "/w/tool" }],
    table: {
      [` -C /w/tool ${RP}`]: () => { if (down) throw new Error("ssh: connect refused"); return ok("/w/tool\n/w/tool/.git\n"); },
      " -C /w/tool remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C /w/tool status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await c.tick();
  assert.deepEqual(c.state().repos, []);
  down = false;
  io.t = 1000; await c.tick();
  assert.equal(callsTo(io, "/w/tool rev-parse"), 1, "not retried every second");
  io.t = 15000; await c.tick();
  assert.equal(callsTo(io, "/w/tool rev-parse"), 2);
  assert.deepEqual(c.state().repos.map((r) => r.name), ["tool"]);
  io.t = 30000; await c.tick();
  assert.equal(callsTo(io, "/w/tool rev-parse"), 2, "a resolved cwd is cached");
});

test("fix 8: each repo publishes the added paths that produced it (a subfolder, or a broken path)", async () => {
  const io = fakeIo({
    repos: [{ path: "D:/work/api/src", machine: null }, { path: "D:/gone", machine: null }],
    table: {
      [` -C D:/work/api/src ${RP}`]: ok("D:/work/api\nD:/work/api/.git\n"),
      " -C D:/work/api worktree list --porcelain": wtList(["D:/work/api", "main"]),
      " -C D:/work/api remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C D:/work/api status --porcelain=v2 --branch": status("main"),
      [` -C D:/gone ${RP}`]: { code: 128, stdout: "", stderr: "fatal: not a git repository" },
    },
  });
  const c = createCollector(io);
  await c.tick();
  const [api, gone] = c.state().repos;
  assert.equal(api.id, "|d:/work/api/.git");
  assert.deepEqual(api.addedPaths, [{ path: "D:/work/api/src", machine: null }]);
  assert.deepEqual(gone.addedPaths, [{ path: "D:/gone", machine: null }]);
});

// --- auto-add (docs/superpowers/specs/2026-11-22-auto-add-repos-design.md) ---
const TOOL = {
  "devbox -C /home/me/tool/lib rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("/home/me/tool\n/home/me/tool/.git\n"),
  "devbox -C /home/me/tool rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("/home/me/tool\n/home/me/tool/.git\n"),
  "devbox -C /home/me/tool worktree list --porcelain": wtList(["/home/me/tool", "main"]),
  "devbox -C /home/me/tool remote get-url origin": NO_ORIGIN,
  "devbox --no-optional-locks -C /home/me/tool status --porcelain=v2 --branch": status("main"),
};
const TOOL_SPACE = [{ id: "s1", name: "dev", machine: "devbox", tabs: [{ id: "t1" }] }];

test("auto-add: a repo a terminal works in is added (with its machine) and stays after the terminal closes", async () => {
  const panes = [{ pane: "p1", tab: "t1", cwd: "/home/me/tool/lib" }];
  const io = fakeIo({ spaces: TOOL_SPACE, panes, table: TOOL, autoAdd: true });
  const c = createCollector(io);
  await c.tick();
  assert.deepEqual(io.shared("dock.git.repos"), [{ path: "/home/me/tool", machine: "devbox" }]);
  io.t += 1000; await c.tick();
  io.t += 1000; await c.tick();
  // Exactly one entry, never appended twice.
  assert.equal(io.shared("dock.git.repos").length, 1);
  panes.length = 0; // the terminal closes
  io.t += 61000; await c.tick();
  const s = c.state();
  assert.equal(s.repos.length, 1);
  assert.equal(s.repos[0].added, true);
  assert.equal(s.repos[0].worktrees[0].open, false);
});

test("auto-add: a terminal in a repo already added adds nothing", async () => {
  const io = fakeIo({
    repos: [{ path: "/home/me/tool", machine: "devbox" }],
    spaces: TOOL_SPACE, panes: [{ pane: "p1", tab: "t1", cwd: "/home/me/tool/lib" }], table: TOOL, autoAdd: true,
  });
  const c = createCollector(io);
  await c.tick(); io.t += 1000; await c.tick();
  assert.deepEqual(io.shared("dock.git.repos"), [{ path: "/home/me/tool", machine: "devbox" }]);
});

test("skipped: a removed repo with a terminal in it is hidden and not re-added until its terminals leave", async () => {
  const panes = [{ pane: "p1", tab: "t1", cwd: "/home/me/tool/lib" }];
  const io = fakeIo({ spaces: TOOL_SPACE, panes, table: TOOL, autoAdd: true });
  io.setShared("dock.git.skipped", ["devbox|/home/me/tool/.git"]);
  const c = createCollector(io);
  await c.tick(); io.t += 1000; await c.tick();
  assert.deepEqual(io.shared("dock.git.repos"), []);
  assert.equal(c.state().repos.length, 0);
  assert.deepEqual(io.shared("dock.git.skipped"), ["devbox|/home/me/tool/.git"]);
  panes.length = 0; // every terminal leaves
  io.t += 1000; await c.tick();
  assert.deepEqual(io.shared("dock.git.skipped"), []);
  panes.push({ pane: "p2", tab: "t1", cwd: "/home/me/tool/lib" }); // a terminal comes back
  io.t += 1000; await c.tick();
  assert.deepEqual(io.shared("dock.git.repos"), [{ path: "/home/me/tool", machine: "devbox" }]);
});

// --- hidden worktrees and Delete worktree (docs/superpowers/specs/2026-11-22-worktree-hide-delete-design.md) ---
const API = {
  " -C D:/work/api rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/work/api\nD:/work/api/.git\n"),
  " -C D:/work/api worktree list --porcelain": wtList(["D:/work/api", "main"], ["D:/work/api-login", "feature/login"]),
  " -C D:/work/api remote get-url origin": NO_ORIGIN,
  " --no-optional-locks -C D:/work/api status --porcelain=v2 --branch": status("main"),
  " --no-optional-locks -C D:/work/api-login status --porcelain=v2 --branch": status("feature/login"),
  " -C D:/work/api-login rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/work/api-login\nD:/work/api/.git\n"),
};
const wtPaths = (c) => c.state().repos[0].worktrees.map((w) => w.path);

test("hidden: a hidden worktree is left out of the list; the entry goes once the worktree is gone", async () => {
  const table = { ...API };
  const io = fakeIo({ repos: [{ path: "D:/work/api", machine: null }], table });
  io.setShared("dock.git.hidden", [{ id: "|d:/work/api-login", held: false }]);
  const c = createCollector(io);
  await c.tick();
  assert.deepEqual(wtPaths(c), ["D:/work/api"]);
  assert.deepEqual(io.shared("dock.git.hidden"), [{ id: "|d:/work/api-login", held: false }]);
  table[" -C D:/work/api worktree list --porcelain"] = wtList(["D:/work/api", "main"]); // removed outside
  io.t += 61000; await c.tick();
  assert.deepEqual(io.shared("dock.git.hidden"), []);
});

test("hidden: hidden while a terminal is in it, it shows again only when a terminal comes back after they left", async () => {
  const panes = [{ pane: "p1", tab: "t1", cwd: "D:/work/api-login" }];
  const io = fakeIo({ repos: [{ path: "D:/work/api", machine: null }], table: API, panes,
    spaces: [{ id: "s1", name: "dev", machine: null, tabs: [{ id: "t1" }] }] });
  io.setShared("dock.git.hidden", [{ id: "|d:/work/api-login", held: true }]);
  const c = createCollector(io);
  await c.tick(); io.t += 1000; await c.tick();
  assert.deepEqual(wtPaths(c), ["D:/work/api"]);
  assert.deepEqual(io.shared("dock.git.hidden"), [{ id: "|d:/work/api-login", held: true }]);
  panes.length = 0; // the terminal leaves: still hidden, now waiting for one to come back
  io.t += 1000; await c.tick();
  assert.deepEqual(wtPaths(c), ["D:/work/api"]);
  assert.deepEqual(io.shared("dock.git.hidden"), [{ id: "|d:/work/api-login", held: false }]);
  panes.push({ pane: "p2", tab: "t1", cwd: "D:/work/api-login" }); // a terminal comes back
  io.t += 1000; await c.tick();
  assert.deepEqual(io.shared("dock.git.hidden"), []);
  assert.deepEqual(wtPaths(c), ["D:/work/api", "D:/work/api-login"]);
});

test("deleteWorktree: runs git worktree remove from the main checkout, never --force; refuses the main checkout", async () => {
  const table = { ...API, " -C D:/work/api worktree remove D:/work/api-login": ok("") };
  const io = fakeIo({ repos: [{ path: "D:/work/api", machine: null }], table });
  const c = createCollector(io);
  await c.tick();
  assert.deepEqual(await c.deleteWorktree("|d:/work/api-login"), { ok: true });
  assert.equal(callsTo(io, "worktree remove D:/work/api-login"), 1);
  assert.equal(io.calls.some((x) => x.key.includes("--force")), false);
  const main = await c.deleteWorktree("|d:/work/api");
  assert.equal(main.ok, false);
  assert.match(main.error, /main checkout/);
  assert.equal(callsTo(io, "worktree remove D:/work/api "), 0);
});

test("deleteWorktree: git's refusal (uncommitted changes) comes back as the error and as a notification", async () => {
  const table = { ...API, " -C D:/work/api worktree remove D:/work/api-login":
    { code: 128, stdout: "", stderr: "fatal: 'D:/work/api-login' contains modified or untracked files, use --force to delete it\n" } };
  const io = fakeIo({ repos: [{ path: "D:/work/api", machine: null }], table });
  const notes = [];
  io.notify = (n) => notes.push(n);
  const c = createCollector(io);
  await c.tick();
  const r = await c.deleteWorktree("|d:/work/api-login");
  assert.equal(r.ok, false);
  assert.match(r.error, /modified or untracked files/);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].level, "error");
  assert.match(notes[0].body, /modified or untracked files/);
});

// --- git calls that never answer (docs/superpowers/plans/2026-11-23-git-call-deadline.md) ---
// A tick waiting on a lost call never ends, so these tests don't await tick(): tickAt runs it at fake time t and
// lets its git calls (1 ms each in fakeIo) and the follow-up work settle.
const lost = () => new Promise(() => {});
async function tickAt(io, c, t) {
  io.t = t;
  c.tick();
  await new Promise((r) => setTimeout(r, 20));
}
const oneSpace = [{ id: "s1", name: "a", machine: null, tabs: [{ id: "t1" }] }];
const LOCAL_TOOL = {
  " -C /w/tool remote get-url origin": NO_ORIGIN,
  " --no-optional-locks -C /w/tool status --porcelain=v2 --branch": status("main"),
};

test("lost git call (a): gives up after 30 s and frees its slot, so the call queued behind it runs", async () => {
  const dead = ["/w/l1", "/w/l2", "/w/l3", "/w/l4"];
  const io = fakeIo({
    platform: "linux", spaces: oneSpace,
    panes: [...dead, "/w/tool"].map((cwd, i) => ({ pane: `p${i}`, tab: "t1", cwd })),
    table: { ...Object.fromEntries(dead.map((d) => [` -C ${d} ${RP}`, lost])), [` -C /w/tool ${RP}`]: ok("/w/tool\n/w/tool/.git\n"), ...LOCAL_TOOL },
  });
  const c = createCollector(io);
  for (let t = 0; t <= 29000; t += 1000) await tickAt(io, c, t);
  assert.equal(callsTo(io, "/w/tool rev-parse"), 0, "queued behind the four lost calls");
  assert.deepEqual(c.state().repos, []);
  await tickAt(io, c, 30000);
  assert.deepEqual(c.state().repos.map((r) => r.name), ["tool"], "its own 30 s start when it runs, not when queued");
  for (const call of io.calls) assert.equal(call.timeout, 30000, call.key);
});

test("lost git call (b): a rev-parse that gave up is tried again, not cached as 'not a repo'", async () => {
  let n = 0;
  const io = fakeIo({
    platform: "linux", spaces: oneSpace, panes: [{ pane: "p1", tab: "t1", cwd: "/w/tool" }],
    table: { [` -C /w/tool ${RP}`]: () => (n++ ? ok("/w/tool\n/w/tool/.git\n") : lost()), ...LOCAL_TOOL },
  });
  const logs = [];
  io.log = (m) => logs.push(m);
  const c = createCollector(io);
  for (let t = 0; t <= 31000; t += 1000) await tickAt(io, c, t);
  assert.equal(callsTo(io, "/w/tool rev-parse"), 2);
  assert.deepEqual(c.state().repos.map((r) => r.name), ["tool"]);
  assert.ok(logs.some((m) => m.includes("/w/tool") && m.includes("timeout")), logs.join("\n"));
});

test("lost git call (c): a slow answer inside 30 s is used, never given up", async () => {
  let answer;
  const io = fakeIo({
    platform: "linux", spaces: oneSpace, panes: [{ pane: "p1", tab: "t1", cwd: "/w/tool" }],
    table: { [` -C /w/tool ${RP}`]: () => new Promise((r) => { answer = r; }), ...LOCAL_TOOL },
  });
  const logs = [];
  io.log = (m) => logs.push(m);
  const c = createCollector(io);
  for (let t = 0; t <= 20000; t += 1000) await tickAt(io, c, t);
  answer(ok("/w/tool\n/w/tool/.git\n"));
  for (let t = 21000; t <= 45000; t += 1000) await tickAt(io, c, t);
  assert.deepEqual(c.state().repos.map((r) => r.name), ["tool"]);
  assert.equal(callsTo(io, "/w/tool rev-parse"), 1);
  assert.equal(logs.some((m) => m.includes("timeout")), false, logs.join("\n"));
});

test("lost git call (d): a status poll that gave up is polled again, and its worktree updates", async () => {
  let s = 0;
  const io = fakeIo({
    platform: "linux", spaces: oneSpace, panes: [{ pane: "p1", tab: "t1", cwd: "/w/tool" }],
    table: {
      ...LOCAL_TOOL,
      [` -C /w/tool ${RP}`]: ok("/w/tool\n/w/tool/.git\n"),
      " --no-optional-locks -C /w/tool status --porcelain=v2 --branch": () => (s++ ? status("main", { ab: "+1 -0" }) : lost()),
    },
  });
  const c = createCollector(io);
  for (let t = 0; t <= 29000; t += 1000) await tickAt(io, c, t);
  assert.equal(c.state().repos[0].worktrees[0].branch, null, "no status yet");
  for (let t = 30000; t <= 31000; t += 1000) await tickAt(io, c, t);
  assert.equal(callsTo(io, "/w/tool status"), 2);
  assert.equal(c.state().repos[0].worktrees[0].branch, "main");
  assert.equal(c.state().repos[0].worktrees[0].ahead, 1);
});

test("lost git call (e): a worktree delete that never answers ends in an error notification after 30 s", async () => {
  const io = fakeIo({ repos: [{ path: "D:/work/api", machine: null }], table: { ...API, " -C D:/work/api worktree remove D:/work/api-login": lost } });
  const notes = [];
  io.notify = (n) => notes.push(n);
  const c = createCollector(io);
  await c.tick();
  const done = c.deleteWorktree("|d:/work/api-login");
  await new Promise((r) => setTimeout(r, 5)); // the limiter starts the call (and its 30 s) at t = 0
  for (let t = 1000; t <= 30000; t += 1000) await tickAt(io, c, t);
  const r = await Promise.race([done, new Promise((res) => setTimeout(() => res("still waiting"), 100))]);
  assert.deepEqual(r, { ok: false, error: "timeout" });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].body, "timeout");
});

// --- auto-add never appends a path already listed (docs/superpowers/plans/2026-11-23-auto-add-no-duplicates.md) ---
const refused = () => { throw new Error("ssh: connection refused"); };
const ticks = async (io, c, n) => { for (let i = 0; i < n; i++) { io.t = i * 1000; await c.tick(); } };

test("auto-add (a): a repo whose listing keeps failing isn't appended again every tick", async () => {
  const io = fakeIo({
    platform: "linux", autoAdd: true, spaces: oneSpace, repos: [{ path: "/w/api", machine: null }],
    panes: [{ pane: "p1", tab: "t1", cwd: "/w/api" }],
    table: {
      [` -C /w/api ${RP}`]: ok("/w/api\n/w/api/.git\n"),
      " -C /w/api worktree list --porcelain": refused,
      " -C /w/api remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C /w/api status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await ticks(io, c, 11);
  assert.deepEqual(io.shared("dock.git.repos"), [{ path: "/w/api", machine: null }]);
});

test("auto-add (b): on Windows, an added path in another case counts as listed", async () => {
  const io = fakeIo({
    platform: "windows", autoAdd: true, spaces: oneSpace, repos: [{ path: "D:/Work/Api", machine: null }],
    panes: [{ pane: "p1", tab: "t1", cwd: "D:/work/api" }],
    table: {
      [` -C D:/Work/Api ${RP}`]: ok("D:/work/api\nD:/work/api/.git\n"),
      [` -C D:/work/api ${RP}`]: ok("D:/work/api\nD:/work/api/.git\n"),
      " -C D:/work/api worktree list --porcelain": refused,
      " -C D:/work/api remote get-url origin": NO_ORIGIN,
      " --no-optional-locks -C D:/work/api status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await ticks(io, c, 5);
  assert.deepEqual(io.shared("dock.git.repos"), [{ path: "D:/Work/Api", machine: null }]);
});

test("auto-add (c): the same path on another machine is a different repo, still added once", async () => {
  const io = fakeIo({
    platform: "linux", autoAdd: true, repos: [{ path: "/w/api", machine: null }],
    spaces: [{ id: "s1", name: "a", machine: "devbox", tabs: [{ id: "t1" }] }],
    panes: [{ pane: "p1", tab: "t1", cwd: "/w/api" }],
    table: {
      [` -C /w/api ${RP}`]: ok("/w/api\n/w/api/.git\n"),
      " -C /w/api worktree list --porcelain": refused,
      [`devbox -C /w/api ${RP}`]: ok("/w/api\n/w/api/.git\n"),
      "devbox -C /w/api worktree list --porcelain": refused,
      "devbox -C /w/api remote get-url origin": NO_ORIGIN,
      "devbox --no-optional-locks -C /w/api status --porcelain=v2 --branch": status("main"),
    },
  });
  const c = createCollector(io);
  await ticks(io, c, 5);
  assert.deepEqual(io.shared("dock.git.repos"), [{ path: "/w/api", machine: null }, { path: "/w/api", machine: "devbox" }]);
});

test("auto-add (d): a tick that read the list before another tick's auto-add doesn't append the same path again", async () => {
  let slow = false;
  let release;
  const yList = wtList(["/w/y", "main"]);
  const panes = [];
  const io = fakeIo({
    platform: "linux", autoAdd: true, spaces: oneSpace, panes, repos: [{ path: "/w/y", machine: null }],
    table: {
      [` -C /w/y ${RP}`]: ok("/w/y\n/w/y/.git\n"),
      " -C /w/y worktree list --porcelain": () => (slow ? new Promise((r) => { release = () => r(yList); }) : yList),
      [` -C /w/x ${RP}`]: ok("/w/x\n/w/x/.git\n"),
    },
  });
  const c = createCollector(io);
  await c.tick(); // t = 0: /w/y is listed
  io.t = 60000;
  slow = true;
  panes.push({ pane: "p1", tab: "t1", cwd: "/w/x" }); // a terminal opens in a repo nobody added
  const a = c.tick(); // A: its 60 s re-list of /w/y waits; /w/x resolves
  await new Promise((r) => setTimeout(r, 30));
  io.t = 61000;
  await c.tick(); // B: auto-adds /w/x
  release();
  await a; // A ends with the list it read before B's append
  assert.deepEqual(io.shared("dock.git.repos"), [{ path: "/w/y", machine: null }, { path: "/w/x", machine: null }]);
});

const failingApi = (state) => ({
  [` -C /w/api ${RP}`]: ok("/w/api\n/w/api/.git\n"),
  " -C /w/api worktree list --porcelain": () => (state.refusing ? refused() : wtList(["/w/api", "main"])),
  " -C /w/api remote get-url origin": NO_ORIGIN,
  " --no-optional-locks -C /w/api status --porcelain=v2 --branch": status("main"),
});

test("auto-add (e): a repo whose listing fails shares one row with its terminal, and keeps its id when it recovers", async () => {
  const state = { refusing: true };
  const io = fakeIo({
    platform: "linux", autoAdd: true, spaces: oneSpace, repos: [{ path: "/w/api", machine: null }],
    panes: [{ pane: "p1", tab: "t1", cwd: "/w/api" }], table: failingApi(state),
  });
  const c = createCollector(io);
  await ticks(io, c, 3);
  let rows = c.state().repos;
  assert.deepEqual(rows.map((r) => [r.id, r.added]), [["|/w/api/.git", true]]);
  assert.match(rows[0].error, /connection refused/);
  assert.deepEqual(rows[0].worktrees.map((w) => [w.path, w.open]), [["/w/api", true]]);
  state.refusing = false;
  io.t = 60000;
  await c.tick();
  rows = c.state().repos;
  assert.deepEqual(rows.map((r) => [r.id, r.error]), [["|/w/api/.git", null]]);
});

test("auto-add (f): Remove on a failing repo with a terminal in it sticks until the terminal leaves", async () => {
  const panes = [{ pane: "p1", tab: "t1", cwd: "/w/api" }];
  const io = fakeIo({
    platform: "linux", autoAdd: true, spaces: oneSpace, repos: [{ path: "/w/api", machine: null }],
    panes, table: failingApi({ refusing: true }),
  });
  const c = createCollector(io);
  await ticks(io, c, 3);
  const row = c.state().repos.find((r) => r.error); // the row with the red Remove button
  // What dock-git's Remove does (src/mods/dock-git/main.js, removeRepo).
  io.setShared("dock.git.repos", removeRepoPaths(io.shared("dock.git.repos"), row, "linux"));
  const skipped = skipAfterRemove(io.shared("dock.git.skipped"), row);
  if (skipped) io.setShared("dock.git.skipped", skipped);
  for (let t = 3000; t <= 6000; t += 1000) { io.t = t; await c.tick(); }
  assert.deepEqual(io.shared("dock.git.repos"), []);
  assert.deepEqual(c.state().repos, []);
  panes.length = 0; // the terminal leaves
  io.t = 7000;
  await c.tick();
  assert.deepEqual(io.shared("dock.git.skipped"), []);
});
