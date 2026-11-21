import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollector } from "../src/shared/collector.js";

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
function fakeIo({ table = {}, repos = [], panes = [], spaces = [], platform = "windows" } = {}) {
  const store = new Map([["dock.git.repos", repos]]);
  const io = {
    t: 0,
    calls: [],
    sets: [],
    active: 0,
    maxActive: 0,
    platform,
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
      assert.equal(cmd, "git");
      const key = `${opts?.on ?? ""} ${args.join(" ")}`;
      io.calls.push({ key, on: opts?.on });
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
      " -C D:/work/api rev-parse --show-toplevel --git-common-dir": ok("D:/work/api\n.git\n"),
      " -C D:/work/api worktree list --porcelain": wtList(["D:/work/api", "main"], ["D:/work/api-login", "feature/login"]),
      " -C D:/work/api remote get-url origin": ok("git@gitlab.corp:grp/api.git\n"),
      " -C D:/work/api status --porcelain=v2 --branch": status("main", { ab: "+0 -2" }),
      " -C D:/work/api-login status --porcelain=v2 --branch": status("feature/login", { ab: "+1 -0", dirty: true }),
      "devbox -C /home/me/tool/lib rev-parse --show-toplevel --git-common-dir": ok("/home/me/tool\n/home/me/tool/.git\n"),
      "devbox -C /home/me/tool remote get-url origin": ok("https://github.com/me/tool.git\n"),
      "devbox -C /home/me/tool status --porcelain=v2 --branch": status("main"),
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
  assert.equal(api.provider, null);
  assert.equal(api.host, "gitlab.corp");
  assert.equal(api.path, "grp/api");
  assert.deepEqual(api.worktrees.map((w) => [w.path, w.branch, w.ahead, w.behind, w.dirty, w.open]), [
    ["D:/work/api", "main", 0, 2, false, false],
    ["D:/work/api-login", "feature/login", 1, 0, true, false],
  ]);
  assert.equal(api.worktrees[0].id, "|d:/work/api");
  assert.equal(api.worktrees[0].sha, "b".repeat(40));
  assert.equal(api.worktrees[0].upstream, "origin/main");
  assert.equal(api.worktrees[0].pipeline, null);

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
      " -C D:/work/api rev-parse --show-toplevel --git-common-dir": ok("D:/work/api\n.git\n"),
      " -C D:/work/api worktree list --porcelain": wtList(["D:/work/api", "main"]),
      " -C d:/work/api/src rev-parse --show-toplevel --git-common-dir": ok("d:/work/api\nd:/work/api/.git\n"),
      " -C D:/work/api remote get-url origin": NO_ORIGIN,
      " -C D:/work/api status --porcelain=v2 --branch": status("main"),
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
      " -C D:/gone rev-parse --show-toplevel --git-common-dir": { code: 128, stdout: "", stderr: "fatal: not a git repository" },
      " -C D:/local rev-parse --show-toplevel --git-common-dir": ok("D:/local\n.git\n"),
      " -C D:/local worktree list --porcelain": wtList(["D:/local", "main"]),
      " -C D:/local remote get-url origin": NO_ORIGIN,
      " -C D:/local status --porcelain=v2 --branch": status("main"),
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
      " -C D:/work/api rev-parse --show-toplevel --git-common-dir": ok("D:/work/api\n.git\n"),
      " -C D:/work/api worktree list --porcelain": wtList(["D:/work/api", "main"], ["D:/work/api-x", "x"]),
      " -C D:/work/api remote get-url origin": NO_ORIGIN,
      " -C D:/work/api status --porcelain=v2 --branch": status("main"),
      " -C D:/work/api-x status --porcelain=v2 --branch": status("x"),
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
    " -C D:/r rev-parse --show-toplevel --git-common-dir": ok("D:/r\n.git\n"),
    " -C D:/r remote get-url origin": NO_ORIGIN,
  };
  const wts = [];
  for (let i = 0; i < 10; i++) {
    const p = i ? `D:/r-${i}` : "D:/r";
    wts.push([p, `b${i}`]);
    table[` -C ${p} status --porcelain=v2 --branch`] = status(`b${i}`);
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
      " -C D:/local rev-parse --show-toplevel --git-common-dir": ok("D:/local\n.git\n"),
      " -C D:/local worktree list --porcelain": wtList(["D:/local", "main"]),
      " -C D:/local remote get-url origin": NO_ORIGIN,
      " -C D:/local status --porcelain=v2 --branch": () => st,
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
      " -C /w/api-fix rev-parse --show-toplevel --git-common-dir": ok("/w/api-fix\n/w/api/.git\n"),
      " -C /w/api-fix remote get-url origin": NO_ORIGIN,
      " -C /w/api-fix status --porcelain=v2 --branch": status("fix"),
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
      " -C /w/tool rev-parse --show-toplevel --git-common-dir": ok("/w/tool\n.git\n"),
      " -C /w/tool remote get-url origin": NO_ORIGIN,
      " -C /w/tool status --porcelain=v2 --branch": status("main"),
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
      " -C /w/a rev-parse --show-toplevel --git-common-dir": ok("/w/a\n.git\n"),
      " -C /w/b rev-parse --show-toplevel --git-common-dir": ok("/w/b\n.git\n"),
      " -C /w/a remote get-url origin": NO_ORIGIN,
      " -C /w/b remote get-url origin": NO_ORIGIN,
      " -C /w/a status --porcelain=v2 --branch": status("main"),
      " -C /w/b status --porcelain=v2 --branch": () => slowB.then(() => status("main")),
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
      " -C D:/local rev-parse --show-toplevel --git-common-dir": ok("D:/local\n.git\n"),
      " -C D:/local worktree list --porcelain": wtList(["D:/local", "main"]),
      " -C D:/local status --porcelain=v2 --branch": status("main"),
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
