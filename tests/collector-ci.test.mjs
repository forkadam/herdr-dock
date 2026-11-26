import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCollector } from "../src/shared/collector.js";
import { createCiClient } from "../src/shared/ci-client.js";
import { b64urlEncode } from "../src/shared/gitcmd.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const ok = (stdout, stderr = "") => ({ code: 0, stdout, stderr });
const T0 = Date.parse("2026-11-22T10:00:00Z");
const TOKEN = "glpat-secret123";
const WT = "|d:/work/api";
const GL = "https://gitlab.corp/api/v4/projects/grp%2Fapi";
const PIPES = `${GL}/pipelines?ref=main&per_page=1&order_by=id&sort=desc`;
// The HEAD-commit query beside the branch one (the harness's HEAD is c...c). Unrouted, it answers 404 and the
// client falls back to the branch's pipeline.
const HEAD_SHA = "c".repeat(40);
const SHAQ = `${GL}/pipelines?sha=${HEAD_SHA}&order_by=id&sort=desc&per_page=5`;

const status = (branch, { ab = "+0 -0", oid = "c".repeat(40) } = {}) =>
  ok([`# branch.oid ${oid}`, `# branch.head ${branch}`, `# branch.upstream origin/${branch}`, `# branch.ab ${ab}`].join("\n"));
const res = (status, body) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => body, text: async () => JSON.stringify(body),
});
const pipeline = (o = {}) => ({
  id: 48213, status: "failed", ref: "main", sha: "c".repeat(40),
  web_url: "https://gitlab.corp/grp/api/-/pipelines/48213", created_at: "2026-11-22T09:00:00Z", ...o,
});
// Newest first, as GitLab may return them.
const JOBS = [
  { id: 903, name: "release", stage: "deploy", status: "skipped", web_url: "https://gitlab.corp/grp/api/-/jobs/903" },
  { id: 902, name: "unit", stage: "test", status: "failed", duration: 93.5, web_url: "https://gitlab.corp/grp/api/-/jobs/902" },
  { id: 901, name: "compile", stage: "build", status: "success", web_url: "https://gitlab.corp/grp/api/-/jobs/901" },
];

// One added repo D:/work/api with one worktree. `routes` answers fetch by exact URL (a value, or a function of
// (url, init, n) where n counts calls to that URL). `cli` answers glab/gh by `${cmd} ${args.join(" ")}`.
function ciIo({
  origin = "git@gitlab.corp:grp/api.git", branch = "main", st, routes = {}, cli = {}, store,
} = {}) {
  const shared = store ?? new Map();
  if (!shared.has("dock.git.repos")) shared.set("dock.git.repos", [{ path: "D:/work/api", machine: null }]);
  const io = {
    t: T0, platform: "windows", calls: [], fetches: [], logs: [], notes: [], sounds: [], sets: [],
    st: st ?? status(branch),
    now: () => io.t,
    panes: () => [],
    spaces: () => [],
    shared: (k) => shared.get(k),
    setShared: (k, v) => { shared.set(k, v); io.sets.push([k, v]); },
    notify: (n) => io.notes.push(n),
    playSound: (s) => io.sounds.push(s),
    log: (m) => io.logs.push(String(m)),
    async fetch(url, init) {
      io.fetches.push({ url, init });
      const n = io.fetches.filter((f) => f.url === url).length;
      const r = routes[url];
      if (r === undefined) return res(404, { message: "404 Not found" });
      return typeof r === "function" ? r(url, init, n) : r;
    },
    async exec(cmd, args, opts) {
      const key = `${cmd} ${args.join(" ")}`;
      io.calls.push({ cmd, args, key, opts });
      await new Promise((r) => setTimeout(r, 1));
      if (cmd === "git") {
        const git = {
          "-C D:/work/api rev-parse --path-format=absolute --show-toplevel --git-common-dir": ok("D:/work/api\nD:/work/api/.git\n"),
          "-C D:/work/api worktree list --porcelain": ok(`worktree D:/work/api\nHEAD ${"c".repeat(40)}\nbranch refs/heads/${branch}\n`),
          "-C D:/work/api remote get-url origin": ok(`${origin}\n`),
          "--no-optional-locks -C D:/work/api status --porcelain=v2 --branch": io.st,
        };
        return git[args.join(" ")] ?? { code: 128, stdout: "", stderr: "fatal" };
      }
      const table = {
        "glab auth status --hostname gitlab.corp": ok("", "✓ Logged in to gitlab.corp as me"),
        "glab config get token --host gitlab.corp": ok(`${TOKEN}\n`),
        "gh auth token --hostname github.com": ok("gho_tok123\n"),
        ...cli,
      };
      const a = table[key];
      if (a === undefined) return { code: 1, stdout: "", stderr: `no answer for ${key}` };
      return typeof a === "function" ? a(args) : a;
    },
  };
  return { io, shared };
}

const wtOf = (c) => c.state().repos[0].worktrees[0];
const detailOf = (io) => [...io.sets].reverse().find(([k]) => k === "dock.git.detail")?.[1];
const until = async (cond) => {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setTimeout(r, 2));
  assert.ok(cond(), "condition not reached");
};
const noToken = (io, c, token = TOKEN) => {
  const all = JSON.stringify([c.state(), io.sets, io.logs, io.notes]);
  assert.ok(!all.includes(token), "token leaked");
};

test("(a) GitLab failed pipeline: state, detail, token header, no token anywhere; jobs sorted by id", async () => {
  const { io } = ciIo({ routes: { [PIPES]: res(200, [pipeline()]), [`${GL}/pipelines/48213/jobs?per_page=100`]: res(200, JOBS) } });
  const c = createCollector(io);
  await c.tick();
  const repo = c.state().repos[0];
  assert.equal(repo.provider, "gitlab");
  const w = wtOf(c);
  assert.equal(w.pipeline.status, "failed");
  assert.equal(w.pipeline.id, 48213);
  assert.equal(w.pipeline.webUrl, "https://gitlab.corp/grp/api/-/pipelines/48213");
  assert.equal(w.pipeline.stale, false);
  assert.equal(w.pipeline.error, null);
  assert.equal(io.fetches[0].url, PIPES);
  assert.equal(io.fetches[0].init.headers["PRIVATE-TOKEN"], TOKEN);
  assert.equal(io.fetches[0].init.headers["User-Agent"], "herdr-dock");

  await c.select(WT);
  assert.equal(io.shared("dock.git.selected"), WT);
  const d = detailOf(io);
  assert.equal(d.worktree, WT);
  assert.equal(d.repo, "api");
  assert.equal(d.branch, "main");
  assert.equal(d.provider, "gitlab");
  assert.equal(d.via, "fetch");
  assert.equal(d.olderThanHead, false);
  assert.equal(d.error, null);
  assert.equal(d.hint, null);
  assert.deepEqual(d.pipeline.stages.map((s) => s.name), ["build", "test", "deploy"]);
  assert.equal(d.pipeline.failedJobs[0].name, "unit");
  assert.equal(c.urlFor("pipeline"), "https://gitlab.corp/grp/api/-/pipelines/48213");
  // An index into pipeline.jobs (every job, sorted by id), not into failedJobs.
  assert.equal(c.urlFor({ job: 1 }), "https://gitlab.corp/grp/api/-/jobs/902");
  assert.equal(c.urlFor({ job: 0 }), "https://gitlab.corp/grp/api/-/jobs/901");
  assert.equal(c.urlFor({ job: 5 }), null);
  noToken(io, c);
});

test("(b) nested group path and an awkward branch are URL-encoded", async () => {
  const { io } = ciIo({ origin: "git@gitlab.corp:grp/sub/proj.git", branch: "feature/a b#c+d" });
  const c = createCollector(io);
  await c.tick();
  const u = io.fetches[0].url;
  assert.ok(u.includes("projects/grp%2Fsub%2Fproj/"), u);
  assert.ok(u.includes("ref=feature%2Fa%20b%23c%2Bd"), u);
});

for (const [name, cli] of [
  ["glab missing", { "glab auth status --hostname gitlab.corp": () => { throw new Error("spawn glab ENOENT"); } }],
  ["auth status exit 1", { "glab auth status --hostname gitlab.corp": { code: 1, stdout: "", stderr: "not logged in" } }],
]) {
  test(`(c) ${name}: unknown with a login hint, git fields still filled`, async () => {
    const { io } = ciIo({ cli, st: status("main", { ab: "+2 -1" }) });
    const c = createCollector(io);
    await c.tick();
    const w = wtOf(c);
    assert.equal(w.pipeline.status, "unknown");
    assert.equal(w.pipeline.error, "not logged in");
    assert.equal(w.branch, "main");
    assert.equal(w.ahead, 2);
    assert.equal(w.behind, 1);
    assert.equal(io.fetches.length, 0);
    await c.select(WT);
    const d = detailOf(io);
    assert.equal(d.error, "not logged in");
    assert.equal(d.hint, "glab auth login --hostname gitlab.corp");
    assert.equal(d.pipeline, null);
  });
}

test("(d) a keyring login: the token comes from auth status --show-token", async () => {
  const { io } = ciIo({
    cli: {
      "glab config get token --host gitlab.corp": ok("\n"),
      "glab auth status --hostname gitlab.corp --show-token": ok("", "gitlab.corp\n  ✓ Logged in\n  ✓ Token: glpat-xyz\n"),
    },
    routes: { [PIPES]: res(200, [pipeline({ status: "success" })]) },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.fetches[0].init.headers["PRIVATE-TOKEN"], "glpat-xyz");
  assert.equal(wtOf(c).pipeline.status, "passed");
  noToken(io, c, "glpat-xyz");
});

test("(e) a TLS error switches the host to glab api for the session", async () => {
  const path = "projects/grp%2Fapi/pipelines?ref=main&per_page=1&order_by=id&sort=desc";
  const { io } = ciIo({
    routes: {
      [PIPES]: () => { throw new TypeError("fetch failed", { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } }); },
    },
    cli: {
      [`glab api --hostname gitlab.corp ${path}`]: ok(JSON.stringify([pipeline()])),
      "glab api --hostname gitlab.corp projects/grp%2Fapi/pipelines/48213/jobs?per_page=100": ok(JSON.stringify(JOBS)),
      [`glab api --hostname gitlab.corp projects/grp%2Fapi/pipelines?sha=${HEAD_SHA}&order_by=id&sort=desc&per_page=5`]: ok("[]"),
    },
  });
  const c = createCollector(io);
  await c.tick();
  const api = io.calls.filter((x) => x.cmd === "glab" && x.args[0] === "api");
  assert.deepEqual(api[0].args, ["api", "--hostname", "gitlab.corp", path]);
  assert.equal(wtOf(c).pipeline.status, "failed");
  await c.select(WT);
  assert.equal(detailOf(io).via, "glab");
  assert.equal(detailOf(io).pipeline.failedJobs[0].name, "unit");
  // The next poll for that host goes straight to glab (the commit query, already sent by fetch on the first poll,
  // too): branch, commit and jobs.
  const fetched = io.fetches.length;
  io.t += 300000;
  await c.tick();
  assert.equal(io.fetches.length, fetched);
  assert.equal(io.calls.filter((x) => x.cmd === "glab" && x.args[0] === "api").length, 5);
  assert.equal(detailOf(io).pipeline.failedJobs[0].name, "unit");
  noToken(io, c);
});

test("(f) a 401 re-reads the token once and retries once", async () => {
  const { io } = ciIo({ routes: { [PIPES]: (u, i, n) => (n === 1 ? res(401, { message: "401 Unauthorized" }) : res(200, [pipeline({ status: "success" })])) } });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.calls.filter((x) => x.key === "glab config get token --host gitlab.corp").length, 2);
  assert.equal(io.fetches.filter((f) => f.url === PIPES).length, 2);
  assert.equal(wtOf(c).pipeline.status, "passed");
});

test("(f2) a second 401 is 'not logged in', with the hint", async () => {
  const { io } = ciIo({ routes: { [PIPES]: res(401, { message: "401 Unauthorized" }) } });
  const c = createCollector(io);
  await c.tick();
  // The branch query twice (the 401 retry), and the HEAD-commit query once.
  assert.deepEqual(io.fetches.map((f) => f.url).sort(), [PIPES, PIPES, SHAQ].sort());
  assert.equal(wtOf(c).pipeline.status, "unknown");
  assert.equal(wtOf(c).pipeline.error, "not logged in");
});

test("(g) a request that never resolves times out after 15 s of fake time", async () => {
  let signal;
  const { io } = ciIo({ routes: { [PIPES]: (u, init) => { signal = init.signal; return new Promise(() => {}); } } });
  const c = createCollector(io);
  const n = () => io.fetches.filter((f) => f.url === PIPES).length;
  const first = c.tick();
  await until(() => n() === 1);
  io.t += 14999;
  await c.tick();
  assert.equal(wtOf(c).pipeline, null);
  io.t += 1;
  await c.tick();
  await first;
  const w = wtOf(c);
  assert.equal(w.pipeline.status, "unknown");
  assert.equal(w.pipeline.error, "timeout");
  assert.equal(signal?.aborted, true);
  // The host backs off 30 s before the next try: nothing more than the first poll's two queries.
  io.t += 29000;
  await c.tick();
  assert.deepEqual(io.fetches.map((f) => f.url), [PIPES, SHAQ]);
  io.t += 1000;
  c.tick();
  await until(() => n() === 2);
});

test("(h) alerts: running -> failed alerts once; no repeat on the next tick or after a restart", async () => {
  let pl = pipeline({ status: "running", created_at: "2026-11-22T10:01:00Z" });
  const routes = { [PIPES]: () => res(200, [pl]), [`${GL}/pipelines/48213/jobs?per_page=100`]: res(200, JOBS) };
  const { io, shared } = ciIo({ routes });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.notes.length, 0);
  pl = pipeline({ status: "failed", created_at: "2026-11-22T10:01:00Z" });
  io.t += 30000;
  await c.tick();
  assert.equal(io.notes.length, 1);
  assert.deepEqual(io.notes[0], {
    title: "api · main", body: "Pipeline failed: unit", level: "error",
    // Herdr drops mod-command args, so the worktree rides in the name too.
    action: { name: `dock-core.git.show.${b64urlEncode(WT)}`, args: { worktree: WT } },
  });
  assert.deepEqual(io.sounds, ["blocked"]);
  assert.deepEqual(shared.get("dock.git.alerted"), { [WT]: ["48213|null"] });
  // alerted is written before notify.
  const iAlerted = io.sets.findIndex(([k]) => k === "dock.git.alerted");
  assert.ok(iAlerted >= 0);
  io.t += 300000;
  await c.tick();
  assert.equal(io.notes.length, 1);

  // Restart: a new collector (started before the pipeline was created) over the same shared store.
  const { io: io2 } = ciIo({ routes, store: shared });
  const c2 = createCollector(io2);
  await c2.tick();
  assert.equal(wtOf(c2).pipeline.status, "failed");
  assert.equal(io2.notes.length, 0);
  assert.equal(io2.sounds.length, 0);
});

test("(h2) a failure that already existed at startup doesn't alert", async () => {
  const { io } = ciIo({ routes: { [PIPES]: res(200, [pipeline()]), [`${GL}/pipelines/48213/jobs?per_page=100`]: res(200, JOBS) } });
  const c = createCollector(io);
  await c.tick();
  assert.equal(wtOf(c).pipeline.status, "failed");
  assert.equal(io.notes.length, 0);
});

test("(i) cadence: running every 30 s, passed every 5 min, 15 s for 2 min after a push", async () => {
  let pl = pipeline({ status: "running" });
  const { io } = ciIo({ routes: { [PIPES]: () => res(200, [pl]), [`${GL}/pipelines/48213/jobs?per_page=100`]: res(200, []) } });
  const c = createCollector(io);
  const n = () => io.fetches.filter((f) => f.url === PIPES).length;
  const at = async (dt) => { io.t = T0 + dt; await c.tick(); };
  await at(0);
  assert.equal(n(), 1);
  await at(29000); assert.equal(n(), 1);
  await at(30000); assert.equal(n(), 2);
  pl = pipeline({ status: "success" });
  await at(60000); assert.equal(n(), 3); // passed now
  await at(359000); assert.equal(n(), 3);
  await at(360000); assert.equal(n(), 4);
  // A push: ahead goes 1 -> 0 between two status polls (the worktree isn't open: git every 60 s).
  io.st = status("main", { ab: "+1 -0" });
  await at(420000); assert.equal(n(), 4);
  io.st = status("main", { ab: "+0 -0" });
  await at(480000); assert.equal(n(), 5); // upstream changed: due now
  await at(494000); assert.equal(n(), 5);
  await at(495000); assert.equal(n(), 6);
  for (let s = 496; s <= 600; s++) await at(s * 1000);
  assert.equal(n(), 12); // 510, 525, ..., 585; at 600 the 2 min are over: back to 5 min
  await at(615000); assert.equal(n(), 12);
  await at(885000); assert.equal(n(), 13);
});

test("(j) retry() on GitLab posts to .../pipelines/48213/retry", async () => {
  const RETRY = `${GL}/pipelines/48213/retry`;
  const { io } = ciIo({ routes: {
    [PIPES]: res(200, [pipeline()]), [`${GL}/pipelines/48213/jobs?per_page=100`]: res(200, JOBS),
    [RETRY]: res(201, { id: 48213, status: "running" }),
  } });
  const c = createCollector(io);
  await c.tick();
  await c.select(WT);
  const r = await c.retry();
  assert.deepEqual(r, { ok: true, error: null });
  const post = io.fetches.find((f) => f.url === RETRY);
  assert.equal(post.init.method, "POST");
  assert.equal(post.init.headers["PRIVATE-TOKEN"], TOKEN);
});

test("(k) GitHub: two workflows on one sha, one failed; rerun-failed-jobs for the failed run", async () => {
  const RUNS = "https://api.github.com/repos/o/r/actions/runs?branch=main&per_page=20";
  const RERUN = "https://api.github.com/repos/o/r/actions/runs/301/rerun-failed-jobs";
  const SHA = "bbbb000000000000000000000000000000000002";
  const HEAD_RUNS = `https://api.github.com/repos/o/r/actions/runs?head_sha=${SHA}&per_page=20`;
  const all = fx("github-runs.json");
  const { io } = ciIo({
    origin: "https://github.com/o/r.git",
    st: status("main", { oid: SHA }),
    routes: {
      [RUNS]: res(200, all),
      [HEAD_RUNS]: res(200, { total_count: 2, workflow_runs: all.workflow_runs.filter((r) => r.head_sha === SHA) }),
      "https://api.github.com/repos/o/r/actions/runs/301/jobs?per_page=100": res(200, fx("github-jobs-301.json")),
      [RERUN]: res(201, {}),
    },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(c.state().repos[0].provider, "github");
  const w = wtOf(c);
  assert.equal(w.pipeline.status, "failed");
  assert.equal(w.pipeline.id, "bbbb000000000000000000000000000000000002");
  assert.equal(io.fetches[0].init.headers.Authorization, "Bearer gho_tok123");
  assert.equal(io.fetches[0].init.headers.Accept, "application/vnd.github+json");
  // GitHub refuses API requests with no User-Agent (HTTP 403), and Herdr's fetch sends none.
  assert.equal(io.fetches[0].init.headers["User-Agent"], "herdr-dock");
  // The branch's runs, HEAD's runs, and only the failed run's jobs.
  assert.deepEqual(io.fetches.map((f) => f.url), [RUNS, HEAD_RUNS, "https://api.github.com/repos/o/r/actions/runs/301/jobs?per_page=100"]);
  await c.select(WT);
  assert.deepEqual(detailOf(io).pipeline.failedJobs.map((j) => j.name), ["test"]);
  assert.deepEqual(await c.retry(), { ok: true, error: null });
  assert.deepEqual(io.fetches.filter((f) => f.init?.method === "POST").map((f) => f.url), [RERUN]);
  noToken(io, c, "gho_tok123");
});

test("detached HEAD queries by sha, and an older pipeline is marked stale", async () => {
  const head = "d".repeat(40);
  const url = `${GL}/pipelines?sha=${head}&per_page=1&order_by=id&sort=desc`;
  const { io } = ciIo({
    st: ok([`# branch.oid ${head}`, "# branch.head (detached)"].join("\n")),
    routes: { [url]: res(200, [pipeline({ status: "success", sha: "e".repeat(40) })]) },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.fetches[0].url, url);
  assert.equal(io.fetches.length, 1, "detached: the sha query only");
  assert.equal(wtOf(c).pipeline.stale, true);
  await c.select(WT);
  assert.equal(detailOf(io).olderThanHead, true);
});

test("no pipelines -> none; dock.git.hosts can turn a host off", async () => {
  const { io, shared } = ciIo({ routes: { [PIPES]: res(200, []) } });
  const c = createCollector(io);
  await c.tick();
  assert.equal(wtOf(c).pipeline.status, "none");
  shared.set("dock.git.hosts", { "gitlab.corp": "none" });
  const { io: io2 } = ciIo({ store: shared });
  const c2 = createCollector(io2);
  await c2.tick();
  assert.equal(c2.state().repos[0].provider, null);
  assert.equal(wtOf(c2).pipeline, null);
  assert.equal(io2.calls.filter((x) => x.cmd === "glab").length, 0);
});

test("at most 4 HTTP requests at once", async () => {
  const repos = Array.from({ length: 8 }, (_, i) => ({ path: `D:/w/r${i}`, machine: null }));
  let active = 0, max = 0;
  const { io } = ciIo();
  io.shared = ((orig) => (k) => (k === "dock.git.repos" ? repos : orig(k)))(io.shared);
  io.exec = async (cmd, args) => {
    await new Promise((r) => setTimeout(r, 1));
    const a = args.join(" ");
    let m;
    if ((m = /^-C (\S+) rev-parse/.exec(a))) return ok(`${m[1]}\n${m[1]}/.git\n`);
    if ((m = /^-C (\S+) worktree list/.exec(a))) return ok(`worktree ${m[1]}\nHEAD ${"c".repeat(40)}\nbranch refs/heads/main\n`);
    if ((m = /^-C D:\/w\/(r\d) remote/.exec(a))) return ok(`git@gitlab.corp:grp/${m[1]}.git\n`);
    if (/status --porcelain/.test(a)) return status("main");
    if (cmd === "glab" && args[1] === "status") return ok("");
    if (cmd === "glab") return ok(`${TOKEN}\n`);
    return { code: 1, stdout: "", stderr: "" };
  };
  io.fetch = async () => {
    active++; max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return res(200, [pipeline({ status: "success" })]);
  };
  const c = createCollector(io);
  await c.tick();
  assert.equal(max, 4);
  assert.ok(c.state().repos.every((r) => r.worktrees[0].pipeline.status === "passed"));
});

test("fix: one short outage backs off 30 s, however many requests were in flight or queued", async () => {
  let t = 0;
  let mode = "hang";
  let fetches = 0;
  const io = {
    now: () => t,
    shared: () => ({}),
    exec: async (cmd, args) => (args[0] === "config" ? ok(`${TOKEN}\n`) : ok("")),
    fetch: () => { fetches++; return mode === "hang" ? new Promise(() => {}) : Promise.resolve(res(200, [])); },
  };
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  const flush = () => new Promise((r) => setTimeout(r, 5));
  const ps = Array.from({ length: 8 }, (_, i) => c.request("gitlab.corp", "GET", `projects/x${i}`));
  await flush();
  t = 15000; c.sweep(t);
  const out = await Promise.all(ps);
  assert.deepEqual(out.map((r) => r.error), Array(8).fill("timeout"));
  assert.equal(fetches, 4); // the 4 queued requests failed fast, no network call
  assert.equal(c.blocked("gitlab.corp", 44999), true);
  assert.equal(c.blocked("gitlab.corp", 45000), false);
  // A request while blocked fails fast too.
  assert.equal((await c.request("gitlab.corp", "GET", "projects/y")).error, "timeout");
  assert.equal(fetches, 4);
  // The next failure after the window: 60 s.
  t = 45000;
  const p = c.request("gitlab.corp", "GET", "projects/z");
  await flush();
  t = 60000; c.sweep(t);
  await p;
  assert.equal(c.blocked("gitlab.corp", 119999), true);
  assert.equal(c.blocked("gitlab.corp", 120000), false);
  // A success resets: the next failure is 30 s again.
  t = 120000; mode = "ok";
  assert.equal((await c.request("gitlab.corp", "GET", "projects/z")).ok, true);
  mode = "hang";
  const q = c.request("gitlab.corp", "GET", "projects/z");
  await flush();
  t = 135000; c.sweep(t);
  await q;
  assert.equal(c.blocked("gitlab.corp", 164999), true);
  assert.equal(c.blocked("gitlab.corp", 165000), false);
});

test("fix: a login check that can't reach the host recovers on the CI cadence, without refresh()", async () => {
  let up = false;
  const { io } = ciIo({
    cli: {
      "glab auth status --hostname gitlab.corp": () => { if (!up) throw new Error("connect ETIMEDOUT"); return ok(""); },
      "glab config get token --host gitlab.corp": () => ok(up ? `${TOKEN}\n` : "\n"),
      "glab auth status --hostname gitlab.corp --show-token": () => { throw new Error("connect ETIMEDOUT"); },
    },
    routes: { [PIPES]: res(200, [pipeline({ status: "success" })]) },
  });
  const c = createCollector(io);
  await c.tick();
  let w = wtOf(c);
  assert.equal(w.pipeline.status, "unknown");
  assert.equal(w.pipeline.error, "cannot reach gitlab.corp");
  assert.equal(w.pipeline.hint, null);
  up = true;
  io.t += 29000;
  await c.tick();
  assert.equal(wtOf(c).pipeline.status, "unknown");
  io.t += 1000; // the 30 s backoff is over
  await c.tick();
  w = wtOf(c);
  assert.equal(w.pipeline.status, "passed");
  assert.equal(w.pipeline.error, null);
  assert.equal(io.fetches[0].init.headers["PRIVATE-TOKEN"], TOKEN);
});

test("fix: auth status failing on the network, but a token in glab config: the token is used", async () => {
  const { io } = ciIo({
    cli: { "glab auth status --hostname gitlab.corp": { code: 1, stdout: "", stderr: "API call failed: dial tcp: lookup gitlab.corp: no such host" } },
    routes: { [PIPES]: res(200, [pipeline({ status: "success" })]) },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.fetches[0].init.headers["PRIVATE-TOKEN"], TOKEN);
  assert.equal(wtOf(c).pipeline.status, "passed");
});

// The pipelines LIST endpoint has no finished_at: the key comes from the failed jobs.
const jobsDone = (fin) => JOBS.map((j) => (j.status === "failed" ? { ...j, finished_at: fin } : j));
const listed = (o) => pipeline({ created_at: "2026-11-22T10:01:00Z", updated_at: "2026-11-22T10:06:00Z", ...o });

test("fix (R4): a Retry that fails again alerts once more; a restart with the same key doesn't", async () => {
  const F1 = "2026-11-22T10:05:00Z", F2 = "2026-11-22T10:20:00Z";
  let pl = listed({ status: "running" });
  let jobs = JOBS;
  const RETRY = `${GL}/pipelines/48213/retry`;
  const routes = {
    [PIPES]: () => res(200, [pl]), [`${GL}/pipelines/48213/jobs?per_page=100`]: () => res(200, jobs),
    [RETRY]: res(201, { id: 48213, status: "running" }),
  };
  const { io, shared } = ciIo({ routes });
  const c = createCollector(io);
  await c.tick();
  pl = listed({ status: "failed" });
  jobs = jobsDone(F1);
  io.t += 30000; await c.tick();
  assert.equal(io.notes.length, 1);
  assert.deepEqual(shared.get("dock.git.alerted"), { [WT]: [`48213|${F1}`] });
  await c.select(WT);
  assert.deepEqual(await c.retry(), { ok: true, error: null });
  pl = listed({ status: "running", updated_at: "2026-11-22T10:15:00Z" });
  jobs = JOBS.map((j) => (j.status === "failed" ? { ...j, status: "running" } : j));
  io.t += 1000; await c.tick();
  assert.equal(wtOf(c).pipeline.status, "running");
  pl = listed({ status: "failed", updated_at: "2026-11-22T10:21:00Z" });
  jobs = jobsDone(F2);
  io.t += 30000; await c.tick();
  assert.equal(io.notes.length, 2);
  assert.deepEqual(io.sounds, ["blocked", "blocked"]);
  assert.deepEqual(shared.get("dock.git.alerted"), { [WT]: [`48213|${F1}`, `48213|${F2}`] });
  io.t += 300000; await c.tick();
  assert.equal(io.notes.length, 2);
  // Restart (started before the pipeline was created) over the same store: same key, no alert.
  const { io: io2 } = ciIo({ routes, store: shared });
  const c2 = createCollector(io2);
  await c2.tick();
  assert.equal(io2.notes.length, 0);
});

test("fix: a still-failed GitLab pipeline whose updated_at changes doesn't alert again", async () => {
  let pl = listed({ status: "running" });
  let jobs = JOBS;
  const routes = { [PIPES]: () => res(200, [pl]), [`${GL}/pipelines/48213/jobs?per_page=100`]: () => res(200, jobs) };
  const { io } = ciIo({ routes });
  const c = createCollector(io);
  await c.tick();
  pl = listed({ status: "failed" });
  jobs = jobsDone("2026-11-22T10:05:00Z");
  io.t += 30000; await c.tick();
  assert.equal(io.notes.length, 1);
  for (const u of ["2026-11-22T11:00:00Z", "2026-11-22T12:00:00Z"]) {
    pl = listed({ status: "failed", updated_at: u });
    io.t += 300000; await c.tick();
  }
  assert.equal(io.notes.length, 1);
});

test("fix: a success during an outage clears the window, so the next failure blocks again", async () => {
  let t = 0;
  let release;
  const io = {
    now: () => t,
    shared: () => ({}),
    exec: async (cmd, args) => (args[0] === "config" ? ok(`${TOKEN}\n`) : ok("")),
    fetch: (url) => (url.endsWith("/late") ? new Promise((r) => { release = () => r(res(200, [])); }) : new Promise(() => {})),
  };
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  const flush = () => new Promise((r) => setTimeout(r, 5));
  const a = c.request("gitlab.corp", "GET", "projects/hang");
  await flush();
  t = 5000; // b starts later, so its own deadline (20 s) isn't reached by the sweep at 15 s
  const b = c.request("gitlab.corp", "GET", "projects/late");
  await flush();
  t = 15000; c.sweep(t);
  assert.equal((await a).error, "timeout");
  assert.equal(c.blocked("gitlab.corp", 15000), true);
  release();
  assert.equal((await b).ok, true); // started before the outage, succeeds during it
  assert.equal(c.blocked("gitlab.corp", 15000), false);
  t = 16000;
  const d = c.request("gitlab.corp", "GET", "projects/hang");
  await flush();
  t = 31000; c.sweep(t);
  await d;
  assert.equal(c.blocked("gitlab.corp", 60999), true);
  assert.equal(c.blocked("gitlab.corp", 61000), false);
});

// --- final-review fixes -------------------------------------------------------------------------

const pipesOf = (ref) => `${GL}/pipelines?ref=${ref}&per_page=1&order_by=id&sort=desc`;
const jobsOf = (id, fin) => JOBS.map((j) => (j.status === "failed" ? { ...j, finished_at: fin } : j));

test("fix 2: switching branches back and forth doesn't re-alert an old failure", async () => {
  const routes = {
    [pipesOf("a")]: res(200, [pipeline({ id: 100, ref: "a", created_at: "2026-11-22T10:01:00Z" })]),
    [`${GL}/pipelines/100/jobs?per_page=100`]: res(200, jobsOf(100, "2026-11-22T10:05:00Z")),
    [pipesOf("b")]: res(200, [pipeline({ id: 200, ref: "b", created_at: "2026-11-22T10:02:00Z" })]),
    [`${GL}/pipelines/200/jobs?per_page=100`]: res(200, jobsOf(200, "2026-11-22T10:06:00Z")),
  };
  const { io, shared } = ciIo({ branch: "a", routes });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.notes.length, 1, "a fails: alert");
  const step = async (branch) => { io.st = status(branch); io.t += 300000; await c.tick(); };
  await step("b");
  assert.equal(wtOf(c).branch, "b");
  assert.equal(io.notes.length, 2, "b fails: alert");
  await step("a");
  assert.equal(wtOf(c).pipeline.id, 100);
  assert.equal(io.notes.length, 2, "back on a, same failed pipeline: no alert");
  await step("b");
  assert.equal(io.notes.length, 2, "back on b: no alert");
  assert.deepEqual(shared.get("dock.git.alerted"), { [WT]: ["100|2026-11-22T10:05:00Z", "200|2026-11-22T10:06:00Z"] });
});

test("fix 2: an old single-string dock.git.alerted value still suppresses, and becomes a list", async () => {
  const store = new Map([["dock.git.alerted", { [WT]: "200|2026-11-22T10:06:00Z" }]]);
  const routes = {
    [pipesOf("b")]: res(200, [pipeline({ id: 200, ref: "b", created_at: "2026-11-22T10:02:00Z" })]),
    [`${GL}/pipelines/200/jobs?per_page=100`]: res(200, jobsOf(200, "2026-11-22T10:06:00Z")),
    [pipesOf("a")]: res(200, [pipeline({ id: 100, ref: "a", created_at: "2026-11-22T10:01:00Z" })]),
    [`${GL}/pipelines/100/jobs?per_page=100`]: res(200, jobsOf(100, "2026-11-22T10:05:00Z")),
  };
  const { io, shared } = ciIo({ branch: "b", routes, store });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.notes.length, 0);
  io.st = status("a"); io.t += 300000; await c.tick();
  assert.equal(io.notes.length, 1);
  assert.deepEqual(shared.get("dock.git.alerted"), { [WT]: ["200|2026-11-22T10:06:00Z", "100|2026-11-22T10:05:00Z"] });
});

test("fix 4: the published summary carries the display number", async () => {
  const { io } = ciIo({ routes: { [PIPES]: res(200, [pipeline()]), [`${GL}/pipelines/48213/jobs?per_page=100`]: res(200, JOBS) } });
  const c = createCollector(io);
  await c.tick();
  assert.equal(wtOf(c).pipeline.number, 48213);
});

test("fix 5: a failed Retry is published in the detail (retryError); a later good Retry clears it", async () => {
  let retry = res(403, { message: "403 Forbidden" });
  const routes = {
    [PIPES]: res(200, [pipeline()]), [`${GL}/pipelines/48213/jobs?per_page=100`]: res(200, JOBS),
    [`${GL}/pipelines/48213/retry`]: () => retry,
  };
  const { io } = ciIo({ routes });
  const c = createCollector(io);
  await c.tick();
  await c.select(WT);
  assert.equal(detailOf(io).retryError, null);
  const r = await c.retry();
  assert.equal(r.ok, false);
  assert.equal(detailOf(io).retryError, "pipeline 48213: HTTP 403");
  retry = res(201, { id: 48213, status: "running" });
  assert.equal((await c.retry()).ok, true);
  assert.equal(detailOf(io).retryError, null);
});

test("fix 11: glab/gh CLI calls pass a 15 s exec timeout", async () => {
  const { io } = ciIo({ routes: { [PIPES]: res(200, [pipeline({ status: "success" })]) } });
  const c = createCollector(io);
  await c.tick();
  const cliCalls = io.calls.filter((x) => x.cmd === "glab" || x.cmd === "gh");
  assert.ok(cliCalls.length > 0);
  for (const x of cliCalls) assert.deepEqual(x.opts, { timeout: 15000 }, x.key);
});

test("leftover fix: a Retry error clears once the pipeline changes (a new run or status)", async () => {
  let pipes = res(200, [pipeline()]);
  const routes = {
    [PIPES]: () => pipes, [`${GL}/pipelines/48213/jobs?per_page=100`]: res(200, JOBS),
    [`${GL}/pipelines/48213/retry`]: res(403, { message: "403 Forbidden" }),
  };
  const { io } = ciIo({ routes });
  const c = createCollector(io);
  await c.tick();
  await c.select(WT);
  await c.retry();
  assert.equal(detailOf(io).retryError, "pipeline 48213: HTTP 403");
  pipes = res(200, [pipeline({ id: 48214, status: "running" })]); // retried elsewhere (e.g. in GitLab)
  c.refresh();
  await c.tick();
  assert.equal(detailOf(io).retryError, null);
});

test("leftover fix: Retry on a canceled GitHub run re-runs that run (no failed jobs to re-run)", async () => {
  const SHA = "bbbb000000000000000000000000000000000002";
  const RUNS = "https://api.github.com/repos/o/r/actions/runs?branch=main&per_page=20";
  const RERUN = "https://api.github.com/repos/o/r/actions/runs/401/rerun";
  const { io } = ciIo({
    origin: "https://github.com/o/r.git",
    st: status("main", { oid: SHA }),
    routes: {
      [RUNS]: res(200, { total_count: 1, workflow_runs: [{
        id: 401, name: "ci", run_number: 7, head_sha: SHA, head_branch: "main", status: "completed", conclusion: "cancelled",
        html_url: "https://github.com/o/r/actions/runs/401", created_at: "2026-11-22T10:00:00Z", updated_at: "2026-11-22T10:05:00Z" }] }),
      [RERUN]: res(201, {}),
    },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(wtOf(c).pipeline.status, "canceled");
  await c.select(WT);
  assert.deepEqual(await c.retry(), { ok: true, error: null });
  assert.deepEqual(io.fetches.filter((f) => f.init?.method === "POST").map((f) => f.url), [RERUN]);
});

// --- text, header, timeout and no-backoff requests ------------------------------------------------

const textRes = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => body });
const TRACE = "projects/grp%2Fapi/jobs/902/trace";
const RANGE = { Range: "bytes=-16384" };
const flush5 = () => new Promise((r) => setTimeout(r, 5));

test("request text mode returns the body as a string (fetch), with extra headers merged", async () => {
  const { io } = ciIo({ routes: { ["https://gitlab.corp/api/v4/" + TRACE]: textRes(200, "log\n") } });
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  const r = await c.request("gitlab.corp", "GET", TRACE, { text: true, headers: RANGE });
  // The fetch route carries the status too (206 vs 200 tells whether Range was honoured).
  assert.deepEqual(r, { ok: true, data: "log\n", status: 200 });
  const h = io.fetches[0].init.headers;
  assert.equal(h.Range, "bytes=-16384");
  assert.equal(h["PRIVATE-TOKEN"], TOKEN);
  assert.equal(h["User-Agent"], "herdr-dock");
});

test("request text mode on the glab route", async () => {
  const url = "https://gitlab.corp/api/v4/" + TRACE;
  const key = `glab api --hostname gitlab.corp -H Range: bytes=-16384 ${TRACE}`;
  const { io } = ciIo({
    routes: { [url]: () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } }); } },
    cli: { [key]: ok("not { json\n") },
  });
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  const r = await c.request("gitlab.corp", "GET", TRACE, { text: true, headers: RANGE, timeout: 8000 });
  assert.deepEqual(r, { ok: true, data: "not { json\n" });
  const call = io.calls.find((x) => x.cmd === "glab" && x.args[0] === "api");
  assert.deepEqual(call.args, ["api", "--hostname", "gitlab.corp", "-H", "Range: bytes=-16384", TRACE]);
  assert.equal(call.opts.timeout, 8000);
});

test("noBackoff: a timeout does not block the host; without it the host is blocked", async () => {
  const io = { t: 0, now: () => io.t, shared: () => ({}), exec: async (c, a) => (a[0] === "config" ? ok(`${TOKEN}\n`) : ok("")), fetch: () => new Promise(() => {}) };
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  const p = c.request("gitlab.corp", "GET", TRACE, { text: true, noBackoff: true, timeout: 8000 });
  await flush5();
  io.t = 8001; c.sweep(io.t);
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.error, "timeout");
  assert.equal(c.blocked("gitlab.corp", io.t), false);
  const q = c.request("gitlab.corp", "GET", "projects/x");
  await flush5();
  io.t = 8001 + 15001; c.sweep(io.t);
  assert.equal((await q).error, "timeout");
  assert.equal(c.blocked("gitlab.corp", io.t), true);
});

test("noBackoff: HTTP 503 does not block the host; a 416 comes back with its status", async () => {
  const base = "https://gitlab.corp/api/v4/";
  const { io } = ciIo({ routes: { [base + TRACE]: textRes(503, ""), [base + "projects/r"]: textRes(416, "") } });
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  const r = await c.request("gitlab.corp", "GET", TRACE, { text: true, noBackoff: true });
  assert.equal(r.ok, false);
  assert.equal(r.error, "HTTP 503");
  assert.equal(c.blocked("gitlab.corp", io.t), false);
  const s = await c.request("gitlab.corp", "GET", "projects/r", { text: true, noBackoff: true, headers: RANGE });
  assert.equal(s.ok, false);
  assert.equal(s.status, 416);
  assert.equal(s.hostFailure, false);
});

test("request: a caller's headers never replace the provider's auth headers", async () => {
  const { io } = ciIo({ routes: { ["https://gitlab.corp/api/v4/" + TRACE]: textRes(200, "x") } });
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  await c.request("gitlab.corp", "GET", TRACE, { text: true, headers: { "PRIVATE-TOKEN": "x", "User-Agent": "evil", Range: "bytes=-1" } });
  const h = io.fetches[0].init.headers;
  assert.equal(h["PRIVATE-TOKEN"], TOKEN);
  assert.equal(h["User-Agent"], "herdr-dock");
  assert.equal(h.Range, "bytes=-1");
});

test("request text mode: a body that can't be read is a bad response, not a switch to the CLI", async () => {
  const url = "https://gitlab.corp/api/v4/" + TRACE;
  const { io } = ciIo({ routes: { [url]: { status: 200, ok: true, text: async () => { throw new Error("body read failed"); } } } });
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  const r = await c.request("gitlab.corp", "GET", TRACE, { text: true });
  assert.deepEqual([r.ok, r.error, r.hostFailure], [false, "bad response", false]);
  assert.equal(c.via("gitlab.corp"), "fetch");
  assert.equal(io.calls.filter((x) => x.args[0] === "api").length, 0);
});

test("request on the CLI route: noBackoff skips backoff, a 4xx sets status, text is not redacted", async () => {
  const url = "https://gitlab.corp/api/v4/";
  const tls = () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "CERT" } }); };
  const k = (p) => `glab api --hostname gitlab.corp ${p}`;
  const { io } = ciIo({
    routes: { [url + "projects/a"]: tls },
    cli: {
      [k("projects/a")]: { code: 1, stdout: "", stderr: "connection refused" },
      [k("projects/b")]: { code: 1, stdout: "", stderr: "glab: HTTP 416 Range Not Satisfiable" },
      [k("projects/c")]: ok(`token ${TOKEN} end`),
    },
  });
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  const a = await c.request("gitlab.corp", "GET", "projects/a", { text: true, noBackoff: true });
  assert.deepEqual([a.ok, a.hostFailure], [false, true]);
  assert.equal(c.blocked("gitlab.corp", io.t), false);
  const b = await c.request("gitlab.corp", "GET", "projects/b", { text: true, noBackoff: true });
  assert.deepEqual([b.ok, b.status, b.hostFailure], [false, 416, false]);
  const d = await c.request("gitlab.corp", "GET", "projects/c", { text: true });
  assert.equal(d.data, `token ${TOKEN} end`);
});

// --- every build of the HEAD commit; full mode -----------------------------------------------------

const glJobs = (id) => `${GL}/pipelines/${id}/jobs?per_page=100`;
const glBridges = (id) => `${GL}/pipelines/${id}/bridges?per_page=100`;
const traceUrl = (id) => `${GL}/jobs/${id}/trace`;
const MAIN = { branch: "main", sha: HEAD_SHA };
// A client of its own (no collector), for full mode until the collector passes it.
async function clientOf(host, opts) {
  const { io } = ciIo(opts);
  const c = createCiClient(io, (m) => io.logs.push(String(m)));
  await c.resolve(host);
  return { io, c };
}

const TAG_SHA = "72aae06acf525dfbdb5f50e749a2af205b6b36ee";
const GH = "https://api.github.com/repos/acme/app/actions/runs";
const GH_BRANCH = `${GH}?branch=main&per_page=20`;
const GH_HEAD = (sha) => `${GH}?head_sha=${sha}&per_page=20`;
const ghTag = { origin: "https://github.com/acme/app.git", st: status("main", { oid: TAG_SHA }) };
const ciOnly = () => {
  const all = fx("github-runs-tag.json");
  return { total_count: 1, workflow_runs: all.workflow_runs.filter((r) => r.name === "CI") };
};

test("GitHub: a tag run of HEAD shows beside the branch run", async () => {
  const { io } = ciIo({ ...ghTag, routes: { [GH_BRANCH]: res(200, ciOnly()), [GH_HEAD(TAG_SHA)]: res(200, fx("github-runs-tag.json")) } });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.fetches[0].url, GH_BRANCH);
  assert.equal(wtOf(c).pipeline.status, "running");
  await c.select(WT);
  const d = detailOf(io);
  assert.equal(d.pipeline.status, "running");
  assert.deepEqual(d.pipeline.groups.map((g) => [g.name, g.ref]), [["Release", "v0.4.0-alpha.0"], ["CI", "main"]]);
  assert.equal(d.olderThanHead, false);
  assert.equal(io.logs.filter((l) => l.includes("HEAD commit query")).length, 0);
});

test("GitHub: no run for HEAD yet -> the branch's newest commit, older than HEAD", async () => {
  const { io } = ciIo({
    origin: "https://github.com/o/r.git", st: status("main", { oid: "f".repeat(40) }),
    routes: {
      "https://api.github.com/repos/o/r/actions/runs?branch=main&per_page=20": res(200, fx("github-runs.json")),
      [`https://api.github.com/repos/o/r/actions/runs?head_sha=${"f".repeat(40)}&per_page=20`]: res(200, { total_count: 0, workflow_runs: [] }),
      "https://api.github.com/repos/o/r/actions/runs/301/jobs?per_page=100": res(200, fx("github-jobs-301.json")),
    },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(wtOf(c).pipeline.id, "bbbb000000000000000000000000000000000002");
  await c.select(WT);
  assert.equal(detailOf(io).olderThanHead, true);
});

test("GitLab: the HEAD-commit query failing falls back to the branch pipeline", async () => {
  const { io } = ciIo({ routes: { [PIPES]: res(200, [pipeline()]), [glJobs(48213)]: res(200, JOBS) } });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.fetches[0].url, PIPES);
  assert.ok(io.fetches.some((f) => f.url === SHAQ), "the commit query was asked");
  assert.equal(wtOf(c).pipeline.id, 48213);
  assert.equal(wtOf(c).pipeline.status, "failed");
  const lines = io.logs.filter((l) => l.includes("HEAD commit query"));
  assert.deepEqual(lines, ["CI: gitlab.corp/grp/api: HEAD commit query: HTTP 404"]);
});

test("GitLab: a tag pipeline of HEAD", async () => {
  const tag = pipeline({ id: 20, ref: "v1.0.0", status: "running", web_url: "https://gitlab.corp/grp/api/-/pipelines/20" });
  const branch = pipeline({ id: 10, ref: "main", status: "success", web_url: "https://gitlab.corp/grp/api/-/pipelines/10" });
  const { io } = ciIo({
    routes: {
      [PIPES]: res(200, [branch]), [SHAQ]: res(200, [tag, branch]),
      [glJobs(20)]: res(200, [{ id: 950, name: "build", stage: "build", status: "running" }]),
    },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.fetches[0].url, PIPES);
  assert.equal(wtOf(c).pipeline.id, 20);
  assert.equal(wtOf(c).pipeline.status, "running");
  await c.select(WT);
  const d = detailOf(io);
  assert.deepEqual(d.pipeline.groups.map((g) => [g.name, g.ref]), [["#20", "v1.0.0"], ["#10", "main"]]);
  assert.equal(d.olderThanHead, false);
  // Not full: the passed branch pipeline's jobs aren't fetched (today's rule), nor any bridges.
  assert.ok(!io.fetches.some((f) => f.url === glJobs(10) || f.url.includes("/bridges")));
});

test("GitLab: the commit's newest pipeline per ref, at most 3 groups", async () => {
  const p = (id, ref) => pipeline({ id, ref, status: "success" });
  const { c } = await clientOf("gitlab.corp", {
    routes: { [PIPES]: res(200, [p(30, "main")]), [SHAQ]: res(200, [p(50, "a"), p(40, "b"), p(30, "a"), p(20, "c"), p(10, "d")]) },
  });
  const r = await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipeline.groups.map((g) => [g.name, g.ref]), [["#50", "a"], ["#40", "b"], ["#20", "c"]]);
});

const passedJobs = JOBS.map((j) => ({ ...j, status: "success" }));
const BRIDGE = {
  id: 904, name: "child", stage: "deploy", status: "success", web_url: "https://gitlab.corp/grp/api/-/jobs/904",
  pipeline: { id: 48213, project_id: 1 },
  downstream_pipeline: { id: 7, project_id: 1, status: "success", web_url: "https://gitlab.corp/grp/api/-/pipelines/7" },
};

test("GitLab full: a passed pipeline still fetches its jobs and bridges; not full fetches none", async () => {
  const routes = {
    [PIPES]: res(200, [pipeline({ status: "success" })]), [SHAQ]: res(200, [pipeline({ status: "success" })]),
    [glJobs(48213)]: res(200, passedJobs), [glBridges(48213)]: res(200, [BRIDGE]),
  };
  const full = await clientOf("gitlab.corp", { routes });
  const r = await full.c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.equal(r.ok, true);
  assert.equal(r.pipeline.status, "passed");
  assert.deepEqual(r.pipeline.jobs.map((j) => [j.id, j.bridge]), [[901, false], [902, false], [903, false], [904, true]]);
  assert.deepEqual(full.io.fetches.map((f) => f.url).sort(), [PIPES, SHAQ, glBridges(48213), glJobs(48213)].sort());

  const plain = await clientOf("gitlab.corp", { routes });
  const q = await plain.c.latest("gitlab.corp", "gitlab", "grp/api", MAIN);
  assert.equal(q.pipeline.status, "passed");
  assert.deepEqual(q.pipeline.jobs, []);
  assert.deepEqual(plain.io.fetches.map((f) => f.url), [PIPES, SHAQ]);
});

const running = (o = {}) => pipeline({ status: "running", ...o });
const RUNNING_JOBS = [
  { id: 911, name: "a", stage: "test", status: "running", started_at: "2026-11-22T09:01:00Z" },
  { id: 912, name: "b", stage: "test", status: "running", started_at: "2026-11-22T09:03:00Z" },
  { id: 913, name: "c", stage: "test", status: "running", started_at: "2026-11-22T09:02:00Z" },
];
const RUNNING_BRIDGE = { ...BRIDGE, id: 914, status: "running", started_at: "2026-11-22T09:09:00Z",
  downstream_pipeline: { ...BRIDGE.downstream_pipeline, status: "running" } };
const fullRoutes = (o = {}) => ({
  [PIPES]: res(200, [running()]), [SHAQ]: res(200, [running()]),
  [glJobs(48213)]: res(200, RUNNING_JOBS), [glBridges(48213)]: res(200, []), ...o,
});
const lineOf = (r, id) => r.pipeline.jobs.find((j) => j.id === id).logLine;

test("GitLab full: log lines for the 2 newest running jobs only", async () => {
  const { io, c } = await clientOf("gitlab.corp", {
    routes: fullRoutes({
      [glBridges(48213)]: res(200, [RUNNING_BRIDGE]),
      [traceUrl(911)]: textRes(206, "step\nat 911\n"),
      [traceUrl(912)]: textRes(206, "step\nat 912\n"),
      [traceUrl(913)]: textRes(206, "step\nat 913\n"),
    }),
  });
  const r = await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.equal(lineOf(r, 912), "at 912");
  assert.equal(lineOf(r, 913), "at 913");
  assert.equal(lineOf(r, 911), null);
  assert.equal(lineOf(r, 914), null, "no log line for a bridge");
  const traces = io.fetches.filter((f) => f.url.endsWith("/trace"));
  assert.deepEqual(traces.map((f) => f.url).sort(), [traceUrl(912), traceUrl(913)]);
  for (const t of traces) assert.equal(t.init.headers.Range, "bytes=-16384");
  assert.deepEqual(io.logs.filter((l) => l.includes("trace Range")), ["CI: gitlab.corp trace Range honoured"]);
  await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.equal(io.logs.filter((l) => l.includes("trace Range")).length, 1, "once per host");
});

test("GitLab full: a 416 trace retries once without Range", async () => {
  const { io, c } = await clientOf("gitlab.corp", {
    routes: fullRoutes({
      [glJobs(48213)]: res(200, [RUNNING_JOBS[1]]),
      [traceUrl(912)]: (u, init) => (init.headers.Range ? textRes(416, "") : textRes(200, "whole\nlast line\n")),
    }),
  });
  const r = await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.equal(lineOf(r, 912), "last line");
  const traces = io.fetches.filter((f) => f.url === traceUrl(912));
  assert.equal(traces.length, 2);
  assert.equal(traces[0].init.headers.Range, "bytes=-16384");
  assert.equal(traces[1].init.headers.Range, undefined);
});

test("GitLab full: a failed trace keeps the job's previous logLine, logged once", async () => {
  let trace = textRes(206, "one\ntwo\n");
  const { io, c } = await clientOf("gitlab.corp", {
    routes: fullRoutes({ [glJobs(48213)]: res(200, [RUNNING_JOBS[1]]), [traceUrl(912)]: () => trace }),
  });
  assert.equal(lineOf(await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true }), 912), "two");
  trace = textRes(500, "");
  assert.equal(lineOf(await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true }), 912), "two");
  assert.equal(lineOf(await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true }), 912), "two");
  assert.deepEqual(io.logs.filter((l) => l.includes("trace of")), ["CI: trace of gitlab.corp/grp/api job 912: HTTP 500"]);
  // A failed trace never blocks the host.
  assert.equal(c.blocked("gitlab.corp", io.t), false);
});

test("GitLab full: the log line is redacted, even where the 200-character cut splits the token", async () => {
  const { io, c } = await clientOf("gitlab.corp", {
    routes: fullRoutes({
      [glJobs(48213)]: res(200, RUNNING_JOBS.slice(1)),
      [traceUrl(912)]: textRes(200, `start\ncurl -H "PRIVATE-TOKEN: ${TOKEN}" https://x\n`),
      [traceUrl(913)]: textRes(200, `start\n${"x".repeat(190)}${TOKEN}\n`),
    }),
  });
  const r = await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.equal(lineOf(r, 912), 'curl -H "PRIVATE-TOKEN: ***" https://x');
  assert.equal(lineOf(r, 913), `${"x".repeat(190)}***`);
  assert.ok(!JSON.stringify(r).includes("glpat-"), "no token, whole or cut");
  assert.deepEqual(io.logs.filter((l) => l.includes("trace Range")), ["CI: gitlab.corp trace Range ignored"]);
});

test("GitHub full: jobs of every run of HEAD are fetched; not full only failed runs'", async () => {
  const routes = {
    [GH_BRANCH]: res(200, ciOnly()), [GH_HEAD(TAG_SHA)]: res(200, fx("github-runs-tag.json")),
    [`${GH}/45823655383/jobs?per_page=100`]: res(200, fx("github-jobs-45823655383.json")),
    [`${GH}/45822438336/jobs?per_page=100`]: res(200, fx("github-jobs-45822438336.json")),
  };
  const head = { branch: "main", sha: TAG_SHA };
  const full = await clientOf("github.com", { ...ghTag, routes });
  const r = await full.c.latest("github.com", "github", "acme/app", head, { full: true });
  assert.equal(r.ok, true);
  assert.equal(r.pipeline.status, "running");
  assert.deepEqual(r.pipeline.groups.map((g) => g.name), ["Release", "CI"]);
  assert.deepEqual(r.pipeline.jobs.map((j) => [j.group, j.name, j.status]), [
    ["gh:45823655383", "publish (ubuntu-22.04, appimage)", "passed"],
    ["gh:45823655383", "publish (windows-latest, nsis)", "running"],
    ["gh:45822438336", "check-and-test (ubuntu-latest)", "passed"],
    ["gh:45822438336", "check-and-test (windows-latest)", "passed"],
  ]);
  assert.equal(r.pipeline.jobs[1].step.index, 9);
  assert.equal(r.pipeline.jobs[1].step.total, 12);
  assert.deepEqual(full.io.fetches.slice(0, 2).map((f) => f.url), [GH_BRANCH, GH_HEAD(TAG_SHA)]);
  assert.equal(full.io.fetches.filter((f) => f.url.endsWith("/jobs?per_page=100")).length, 2);

  const plain = await clientOf("github.com", { ...ghTag, routes });
  const q = await plain.c.latest("github.com", "github", "acme/app", head);
  assert.equal(q.pipeline.status, "running");
  assert.deepEqual(q.pipeline.jobs, []);
  assert.deepEqual(plain.io.fetches.map((f) => f.url), [GH_BRANCH, GH_HEAD(TAG_SHA)]);
});

// --- Task 4 review fixes ----------------------------------------------------------------------------

test("GitLab: a tag pipeline of HEAD starting, then passing, beside a failed branch pipeline doesn't alert again", async () => {
  const F = "2026-11-22T10:05:00Z";
  const p10 = (status) => pipeline({ id: 10, ref: "main", status, created_at: "2026-11-22T10:01:00Z", web_url: "https://gitlab.corp/grp/api/-/pipelines/10" });
  const p20 = (status, o = {}) => pipeline({ id: 20, ref: "v1.0.0", status, created_at: "2026-11-22T10:10:00Z", web_url: "https://gitlab.corp/grp/api/-/pipelines/20", ...o });
  let pipes = [p10("running")];
  const { io, shared } = ciIo({
    routes: {
      [PIPES]: () => res(200, [pipes.find((p) => p.id === 10)]),
      [SHAQ]: () => res(200, pipes),
      [glJobs(10)]: () => res(200, jobsDone(F)),
      [glJobs(20)]: res(200, [{ id: 960, name: "pack", stage: "build", status: "running" }]),
    },
  });
  const c = createCollector(io);
  const step = async (next) => { pipes = next; io.t += 300000; await c.tick(); };
  await c.tick();
  assert.equal(io.notes.length, 0);
  await step([p10("failed")]);
  assert.equal(io.notes.length, 1, "the branch pipeline fails: alert");
  await step([p20("running"), p10("failed")]);
  assert.equal(wtOf(c).pipeline.status, "failed");
  assert.equal(wtOf(c).pipeline.number, 20, "the newest pipeline is what the UI shows");
  assert.equal(io.notes.length, 1, "a tag pipeline starting: no new alert");
  await step([p20("success", { finished_at: "2026-11-22T10:20:00Z" }), p10("failed")]);
  assert.equal(wtOf(c).pipeline.status, "failed");
  assert.equal(io.notes.length, 1, "the tag pipeline passing: no new alert");
  assert.deepEqual(shared.get("dock.git.alerted"), { [WT]: [`10|${F}`] });
});

// Answers after the branch query has, so its success cannot clear a backoff the commit query set.
const later = (r) => () => new Promise((ok) => setTimeout(() => ok(r), 5));

test("the HEAD-commit query never backs off the host (GitLab): a 502 still lets the jobs through", async () => {
  const { io, c } = await clientOf("gitlab.corp", {
    routes: { [PIPES]: res(200, [pipeline()]), [SHAQ]: later(res(502, { message: "502 Bad Gateway" })), [glJobs(48213)]: res(200, JOBS) },
  });
  const r = await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN);
  assert.equal(r.ok, true);
  assert.equal(r.pipeline.status, "failed");
  assert.deepEqual(r.pipeline.failedJobs.map((j) => j.name), ["unit"]);
  assert.ok(io.fetches.some((f) => f.url === glJobs(48213)), "jobs fetched");
  assert.equal(c.blocked("gitlab.corp", io.t), false);
  assert.deepEqual(io.logs.filter((l) => l.includes("HEAD commit query")), ["CI: gitlab.corp/grp/api: HEAD commit query: HTTP 502"]);
  assert.equal(io.logs.length, 1, "no 'blocked' jobs log");
});

test("the HEAD-commit query never backs off the host (GitHub)", async () => {
  const SHA = "bbbb000000000000000000000000000000000002";
  const { io, c } = await clientOf("github.com", {
    origin: "https://github.com/o/r.git",
    routes: {
      "https://api.github.com/repos/o/r/actions/runs?branch=main&per_page=20": res(200, fx("github-runs.json")),
      [`https://api.github.com/repos/o/r/actions/runs?head_sha=${SHA}&per_page=20`]: later(res(503, { message: "busy" })),
      "https://api.github.com/repos/o/r/actions/runs/301/jobs?per_page=100": res(200, fx("github-jobs-301.json")),
    },
  });
  const r = await c.latest("github.com", "github", "o/r", { branch: "main", sha: SHA });
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipeline.failedJobs.map((j) => j.name), ["test"]);
  assert.equal(c.blocked("github.com", io.t), false);
  assert.deepEqual(io.logs, ["CI: github.com/o/r: HEAD commit query: HTTP 503"]);
});

test("GitLab full: a token split by an escape sequence is redacted in the log line", async () => {
  const { c } = await clientOf("gitlab.corp", {
    routes: fullRoutes({
      [glJobs(48213)]: res(200, [RUNNING_JOBS[1]]),
      [traceUrl(912)]: textRes(206, "start\nexport T=glpat-sec\x1b[0mret123 done\n"),
    }),
  });
  const r = await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.equal(lineOf(r, 912), "export T=*** done");
});

test("GitLab full: a job that stops running drops its kept line", async () => {
  let jobs = [RUNNING_JOBS[1]];
  let trace = textRes(206, "a\nold line\n");
  const { c } = await clientOf("gitlab.corp", {
    routes: fullRoutes({ [glJobs(48213)]: () => res(200, jobs), [traceUrl(912)]: () => trace }),
  });
  const poll = () => c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.equal(lineOf(await poll(), 912), "old line");
  jobs = [{ ...RUNNING_JOBS[1], status: "success" }];
  assert.equal(lineOf(await poll(), 912), null);
  jobs = [RUNNING_JOBS[1]];
  trace = textRes(500, "");
  assert.equal(lineOf(await poll(), 912), null, "not the old line");
});

// --- Task 5: watched polls ----------------------------------------------------------------------------

const passedRoutes = (o = {}) => ({
  [PIPES]: res(200, [pipeline({ status: "success" })]), [SHAQ]: res(200, [pipeline({ status: "success" })]),
  [glJobs(48213)]: res(200, passedJobs), [glBridges(48213)]: res(200, []), ...o,
});
const jobsFetched = (io) => io.fetches.filter((f) => f.url === glJobs(48213)).length;
const polls = (io) => io.fetches.filter((f) => f.url === PIPES).length;
// Discovers the worktree, selects it, and ticks once more (a watched selection polls full at once).
const boot = async (c) => { await c.tick(); await c.select(WT); await c.tick(); };

test("watched: a fresh heartbeat makes the selected worktree's poll full", async () => {
  const { io, shared } = ciIo({ routes: passedRoutes() });
  shared.set("dock.git.watching", { at: io.t });
  const c = createCollector(io);
  await c.tick();
  await c.select(WT);
  await c.tick();
  assert.ok(jobsFetched(io) >= 1, "jobs fetched for a passed pipeline");
  assert.ok(io.fetches.some((f) => f.url === glBridges(48213)));
});

test("watched: a heartbeat 15 s old is not watched", async () => {
  const { io, shared } = ciIo({ routes: passedRoutes() });
  shared.set("dock.git.watching", { at: io.t - 15000 });
  const c = createCollector(io);
  await boot(c);
  assert.equal(jobsFetched(io), 0);
});

test("watched: becoming watched polls at once when the last poll wasn't full", async () => {
  const { io, shared } = ciIo({ routes: passedRoutes() });
  const c = createCollector(io);
  await boot(c);
  assert.equal(polls(io), 1);
  assert.equal(jobsFetched(io), 0);
  io.t += 1000;
  shared.set("dock.git.watching", { at: io.t });
  await c.tick();
  assert.equal(polls(io), 2, "a new poll ran");
  assert.equal(jobsFetched(io), 1, "and it was full");
  io.t += 1000;
  await c.tick();
  assert.equal(polls(io), 2, "the last poll was full: back on the cadence");
});

test("watched: only the selected worktree is watched", async () => {
  const { io, shared } = ciIo({ routes: passedRoutes() });
  shared.set("dock.git.watching", { at: io.t });
  const c = createCollector(io);
  await c.tick();
  await c.select("|d:/work/elsewhere"); // another worktree is on screen; this one is not
  io.t += 1000;
  await c.tick();
  assert.equal(jobsFetched(io), 0);
  await c.select(WT);
  await c.tick();
  assert.equal(jobsFetched(io), 1, "selected, the same heartbeat makes it full");
});

test("watched: a failing poll is not retried every tick", async () => {
  const { io, shared } = ciIo({ routes: { [PIPES]: res(403, { message: "403 Forbidden" }), [SHAQ]: res(403, { message: "403 Forbidden" }) } });
  const c = createCollector(io);
  await c.tick();
  await c.select(WT);
  const beat = async () => { io.t += 1000; shared.set("dock.git.watching", { at: io.t }); await c.tick(); };
  await beat(); // becoming watched: the one full attempt
  const base = polls(io);
  assert.equal(base, 2);
  await beat(); await beat(); await beat();
  assert.equal(polls(io), base, "the normal interval applies after a failure");
});

test("watched: reselecting a worktree whose jobs went stale polls at once", async () => {
  const { io, shared } = ciIo({ routes: passedRoutes() });
  const beat = () => shared.set("dock.git.watching", { at: io.t });
  const c = createCollector(io);
  beat();
  await boot(c);
  assert.equal(jobsFetched(io), 1);
  await c.select("|d:/work/elsewhere");
  io.t += 1000; beat();
  await c.select(WT);
  await c.tick();
  assert.equal(jobsFetched(io), 2, "polled full again at once");
});

test("watched running pipeline re-polls after 10 s, unwatched after 30 s", async () => {
  const run = async (watch) => {
    const { io, shared } = ciIo({ routes: fullRoutes() });
    const beat = () => { if (watch) shared.set("dock.git.watching", { at: io.t }); };
    const c = createCollector(io);
    beat();
    await boot(c);
    const base = polls(io);
    const out = [];
    for (const dt of [9999, 10000, 19999, 20000, 29999, 30000]) { io.t = T0 + dt; beat(); await c.tick(); out.push(polls(io) - base); }
    return out;
  };
  assert.deepEqual(await run(true), [0, 1, 1, 2, 2, 3]); // every 10 s
  assert.deepEqual(await run(false), [0, 0, 0, 0, 0, 1]); // 30 s
});

test("the selected worktree without a heartbeat polls like any other", async () => {
  const { io } = ciIo({ routes: { ...fullRoutes(), [glBridges(48213)]: res(200, []) } });
  const c = createCollector(io);
  await boot(c);
  const bridges = () => io.fetches.filter((f) => f.url === glBridges(48213)).length;
  assert.equal(bridges(), 0, "no full poll");
  const base = polls(io);
  io.t = T0 + 10000; await c.tick();
  assert.equal(polls(io), base, "running: not due at 10 s");
  io.t = T0 + 30000; await c.tick();
  assert.equal(polls(io), base + 1, "running: due at 30 s");
  assert.equal(bridges(), 0, "still not full");
});

const busyRoutes = () => {
  const tag = pipeline({ id: 20, ref: "v1.0.0", status: "running", web_url: "https://gitlab.corp/grp/api/-/pipelines/20" });
  const branch = pipeline({ id: 10, ref: "main", status: "failed", web_url: "https://gitlab.corp/grp/api/-/pipelines/10" });
  return {
    [PIPES]: res(200, [branch]), [SHAQ]: res(200, [tag, branch]),
    [glJobs(10)]: res(200, JOBS), [glJobs(20)]: res(200, [{ id: 950, name: "pack", stage: "build", status: "running" }]),
    [glBridges(10)]: res(200, []), [glBridges(20)]: res(200, []),
    [`${GL}/pipelines/10/retry`]: res(201, { id: 10, status: "running" }),
    [`${GL}/pipelines/20/retry`]: res(201, { id: 20, status: "running" }),
  };
};

test("cadence: a failed branch pipeline beside a running tag pipeline is busy: 30 s unwatched, 10 s watched", async () => {
  for (const [watch, wait] of [[false, 30000], [true, 10000]]) {
    const { io, shared } = ciIo({ routes: busyRoutes() });
    const beat = () => { if (watch) shared.set("dock.git.watching", { at: io.t }); };
    const c = createCollector(io);
    beat();
    await boot(c);
    assert.equal(wtOf(c).pipeline.status, "failed");
    const base = polls(io);
    io.t = T0 + wait - 1; beat(); await c.tick();
    assert.equal(polls(io), base, `${wait - 1} ms: not yet`);
    io.t = T0 + wait; beat(); await c.tick();
    assert.equal(polls(io), base + 1, `${wait} ms: due`);
  }
});

test("retry() on a failed commit with a running tag pipeline posts to the failed pipeline's retry", async () => {
  const { io } = ciIo({ routes: busyRoutes() });
  const c = createCollector(io);
  await c.tick();
  await c.select(WT);
  assert.deepEqual(await c.retry(), { ok: true, error: null });
  assert.ok(io.fetches.some((f) => f.url === `${GL}/pipelines/10/retry` && f.init.method === "POST"));
  assert.ok(!io.fetches.some((f) => f.url === `${GL}/pipelines/20/retry`));
});

// --- final whole-branch review: alerts and Retry across several failed pipelines / runs of one commit ------

// A tag pipeline 20 and a branch pipeline 10 of HEAD, each with one test job (unit20 / unit10).
function twoFailed({ created = "2026-11-22T10:01:00Z" } = {}) {
  const pl = (id, ref) => (status) => pipeline({ id, ref, status, created_at: created, web_url: `https://gitlab.corp/grp/api/-/pipelines/${id}` });
  const p10 = pl(10, "main");
  const p20 = pl(20, "v1.0.0");
  const failJobs = (id, fin) => [{ id: id * 10 + 1, name: `unit${id}`, stage: "test", status: "failed", finished_at: fin }];
  const runJobs = (id) => [{ id: id * 10 + 1, name: `unit${id}`, stage: "test", status: "running" }];
  const s = { pipes: [p20("failed"), p10("failed")], jobs: { 10: failJobs(10, "2026-11-22T10:05:00Z"), 20: failJobs(20, "2026-11-22T10:06:00Z") } };
  const routes = {
    [PIPES]: () => res(200, [s.pipes.find((p) => p.id === 10)]),
    [SHAQ]: () => res(200, s.pipes),
    [glJobs(10)]: () => res(200, s.jobs[10]),
    [glJobs(20)]: () => res(200, s.jobs[20]),
    [`${GL}/pipelines/10/retry`]: res(201, { id: 10, status: "running" }),
    [`${GL}/pipelines/20/retry`]: res(201, { id: 20, status: "running" }),
  };
  return { s, routes, p10, p20, failJobs, runJobs };
}
const posts = (io) => io.fetches.filter((f) => f.init?.method === "POST").map((f) => f.url);

test("F1 (a): tag 20 and branch 10 both failed: one alert at start-up for a fresh failure, Retry posts to both, no alert while 20 runs", async () => {
  const { s, routes, p10, p20, runJobs } = twoFailed();
  const { io, shared } = ciIo({ routes });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.notes.length, 1, "one alert for both");
  assert.equal(io.notes[0].body, "Pipeline failed: unit20 (+1 more)");
  assert.deepEqual(shared.get("dock.git.alerted"), { [WT]: ["20|2026-11-22T10:06:00Z", "10|2026-11-22T10:05:00Z"] });
  await c.select(WT);
  assert.deepEqual(await c.retry(), { ok: true, error: null });
  assert.deepEqual(posts(io).sort(), [`${GL}/pipelines/10/retry`, `${GL}/pipelines/20/retry`]);
  s.pipes = [p20("running"), p10("failed")];
  s.jobs[20] = runJobs(20);
  io.t += 1000; await c.tick();
  assert.equal(wtOf(c).pipeline.status, "failed");
  assert.equal(io.notes.length, 1, "20 running, 10 still failed: no new alert");
});

test("F1 (a2): the same two failures, old at start-up: no alert", async () => {
  const { routes } = twoFailed({ created: "2026-11-22T09:00:00Z" });
  const { io } = ciIo({ routes });
  const c = createCollector(io);
  await c.tick();
  assert.equal(wtOf(c).pipeline.status, "failed");
  assert.equal(io.notes.length, 0);
});

test("F1 (b, c): 20 retried from the web while 10 stays failed: no alert; 20 failing again: exactly one, naming its job", async () => {
  const { s, routes, p10, p20, failJobs, runJobs } = twoFailed({ created: "2026-11-22T09:00:00Z" });
  const { io, shared } = ciIo({ routes });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.notes.length, 0, "old failures at start-up");
  s.pipes = [p20("running"), p10("failed")];
  s.jobs[20] = runJobs(20);
  io.t += 300000; await c.tick();
  assert.equal(io.notes.length, 0, "(b) 20 running from the web: no alert");
  s.pipes = [p20("failed"), p10("failed")];
  s.jobs[20] = failJobs(20, "2026-11-22T10:20:00Z");
  io.t += 30000; await c.tick();
  assert.equal(io.notes.length, 1, "(c) 20 failed again: one alert");
  assert.equal(io.notes[0].body, "Pipeline failed: unit20");
  assert.deepEqual(shared.get("dock.git.alerted"), { [WT]: ["20|2026-11-22T10:20:00Z"] });
  io.t += 300000; await c.tick();
  assert.equal(io.notes.length, 1);
});

test("F1 (d): GitHub, two failed runs of a sha, one rerun from the web and running: no new alert", async () => {
  const SHA = "bbbb000000000000000000000000000000000002";
  const run = (id, name, status, conclusion, updated_at) => ({
    id, name, run_number: id, head_branch: "main", head_sha: SHA, status, conclusion,
    html_url: `https://github.com/o/r/actions/runs/${id}`, created_at: "2026-11-22T10:01:00Z", updated_at,
  });
  let runs = [run(1, "CI", "completed", "failure", "2026-11-22T10:09:00Z"), run(2, "Lint", "completed", "failure", "2026-11-22T10:04:00Z")];
  const body = () => res(200, { total_count: runs.length, workflow_runs: runs });
  const { io, shared } = ciIo({
    origin: "https://github.com/o/r.git", st: status("main", { oid: SHA }),
    routes: {
      "https://api.github.com/repos/o/r/actions/runs?branch=main&per_page=20": body,
      [`https://api.github.com/repos/o/r/actions/runs?head_sha=${SHA}&per_page=20`]: body,
    },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(io.notes.length, 1, "both runs failed after start-up: one alert");
  assert.deepEqual(shared.get("dock.git.alerted"), { [WT]: ["1|2026-11-22T10:09:00Z", "2|2026-11-22T10:04:00Z"] });
  runs = [run(1, "CI", "in_progress", null, "2026-11-22T10:12:00Z"), runs[1]];
  io.t += 300000; await c.tick();
  assert.equal(wtOf(c).pipeline.status, "failed");
  assert.equal(io.notes.length, 1, "run 1 rerun from the web: no alert");
});

test("F1 (e): start-up: an old failed branch pipeline beside a tag pipeline created after start doesn't alert", async () => {
  const old = pipeline({ id: 10, ref: "main", status: "failed", created_at: "2026-11-22T09:00:00Z" });
  const tag = pipeline({ id: 20, ref: "v1.0.0", status: "running", created_at: "2026-11-22T10:01:00Z" });
  const { io } = ciIo({
    routes: {
      [PIPES]: res(200, [old]), [SHAQ]: res(200, [tag, old]),
      [glJobs(10)]: res(200, jobsDone("2026-11-22T09:05:00Z")),
      [glJobs(20)]: res(200, [{ id: 950, name: "pack", stage: "build", status: "running" }]),
    },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(wtOf(c).pipeline.status, "failed");
  assert.equal(io.notes.length, 0);
});

test("F1: GitLab Retry with no failed or canceled pipeline is an error, with no POST", async () => {
  const { io } = ciIo({ routes: { [PIPES]: res(200, [pipeline({ status: "success" })]) } });
  const c = createCollector(io);
  await c.tick();
  await c.select(WT);
  const r = await c.retry();
  assert.equal(r.ok, false);
  assert.match(r.error, /no failed or canceled/);
  assert.deepEqual(posts(io), []);
});

// --- final whole-branch review: client minors ---------------------------------------------------------

// A client whose fetch always fails with a TLS error, so every call goes through glab api (answered by `cli`,
// keyed by the path relative to the API root).
async function cliClientOf(answers) {
  const tls = () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "CERT" } }); };
  const cli = {};
  for (const [path, a] of Object.entries(answers)) cli[`glab api --hostname gitlab.corp ${path}`] = a;
  return clientOf("gitlab.corp", { routes: new Proxy({}, { get: () => tls }), cli });
}
const P = "projects/grp%2Fapi";
const cliRunning = (trace) => ({
  [`${P}/pipelines?ref=main&per_page=1&order_by=id&sort=desc`]: ok(JSON.stringify([running()])),
  [`${P}/pipelines?sha=${HEAD_SHA}&order_by=id&sort=desc&per_page=5`]: ok(JSON.stringify([running()])),
  [`${P}/pipelines/48213/jobs?per_page=100`]: ok(JSON.stringify([RUNNING_JOBS[1]])),
  [`${P}/pipelines/48213/bridges?per_page=100`]: ok("[]"),
  [`-H Range: bytes=-16384 ${P}/jobs/912/trace`]: ok(trace),
});

test("M1: on the glab route a trace up to 16384 characters logs Range honoured (by size), once per host", async () => {
  const { io, c } = await cliClientOf(cliRunning("a\nlast\n"));
  const r = await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.equal(c.via("gitlab.corp"), "glab");
  assert.equal(lineOf(r, 912), "last");
  await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.deepEqual(io.logs.filter((l) => l.includes("trace Range")), ["CI: gitlab.corp trace Range honoured (by size)"]);
});

test("M1: on the glab route a trace over 16384 characters logs Range ignored (by size)", async () => {
  const { io, c } = await cliClientOf(cliRunning(`${"x".repeat(20000)}\nlast\n`));
  const r = await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.equal(lineOf(r, 912), "last");
  assert.deepEqual(io.logs.filter((l) => l.includes("trace Range")), ["CI: gitlab.corp trace Range ignored (by size)"]);
});

test("M2: a failing HEAD-commit query logs once until it succeeds again", async () => {
  let shaq = res(404, { message: "404 Not found" });
  const { io, c } = await clientOf("gitlab.corp", { routes: { [PIPES]: res(200, [pipeline()]), [SHAQ]: () => shaq, [glJobs(48213)]: res(200, JOBS) } });
  const lines = () => io.logs.filter((l) => l.includes("HEAD commit query"));
  await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN);
  await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN);
  assert.equal(lines().length, 1, "two failing polls: one line");
  shaq = res(200, []);
  await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN);
  shaq = res(404, { message: "404 Not found" });
  await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN);
  assert.equal(lines().length, 2, "success then failure: a second line");
});

test("M2: a failing bridges call (an older GitLab) logs once until it succeeds again", async () => {
  let bridges = res(404, { message: "404 Not found" });
  const { io, c } = await clientOf("gitlab.corp", { routes: passedRoutes({ [glBridges(48213)]: () => bridges }) });
  const lines = () => io.logs.filter((l) => l.includes("bridges of"));
  const poll = () => c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  await poll(); await poll();
  assert.deepEqual(lines(), ["CI: bridges of gitlab.corp/grp/api pipeline 48213: HTTP 404"]);
  bridges = res(200, []);
  await poll();
  bridges = res(404, { message: "404 Not found" });
  await poll();
  assert.equal(lines().length, 2, "success then failure: a second line");
});

test("M4: GitLab commit-query rows of another sha are dropped; with none left the branch result stands", async () => {
  const other = pipeline({ id: 99, ref: "other", sha: "d".repeat(40), status: "success" });
  const { c } = await clientOf("gitlab.corp", { routes: { [PIPES]: res(200, [pipeline()]), [SHAQ]: res(200, [other]), [glJobs(48213)]: res(200, JOBS) } });
  const r = await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN);
  assert.equal(r.pipeline.id, 48213);
  assert.deepEqual(r.pipeline.groups.map((g) => g.key), ["gl:48213"]);
  const tag = pipeline({ id: 20, ref: "v1.0.0", status: "success" });
  const mixed = await clientOf("gitlab.corp", { routes: { [PIPES]: res(200, [pipeline()]), [SHAQ]: res(200, [other, tag]) } });
  const m = await mixed.c.latest("gitlab.corp", "gitlab", "grp/api", MAIN);
  assert.deepEqual(m.pipeline.groups.map((g) => g.key), ["gl:20"]);
});

test("M4: GitHub commit-query runs of another sha are dropped; with none left the branch result stands", async () => {
  const SHA = "bbbb000000000000000000000000000000000002";
  const otherRun = { id: 900, run_number: 9, name: "CI", head_branch: "other", head_sha: "e".repeat(40), status: "completed", conclusion: "success",
    html_url: "https://github.com/o/r/actions/runs/900", created_at: "2026-11-23T09:00:00Z" };
  const { c } = await clientOf("github.com", {
    origin: "https://github.com/o/r.git",
    routes: {
      "https://api.github.com/repos/o/r/actions/runs?branch=main&per_page=20": res(200, fx("github-runs.json")),
      [`https://api.github.com/repos/o/r/actions/runs?head_sha=${SHA}&per_page=20`]: res(200, { total_count: 1, workflow_runs: [otherRun] }),
      "https://api.github.com/repos/o/r/actions/runs/301/jobs?per_page=100": res(200, fx("github-jobs-301.json")),
    },
  });
  const r = await c.latest("github.com", "github", "o/r", { branch: "main", sha: SHA });
  assert.equal(r.pipeline.id, SHA);
  assert.deepEqual(r.pipeline.groups.map((g) => g.key), ["gh:302", "gh:301"]);
});

test("F1: an old failed tag pipeline that drops out for one poll (commit query failing) and comes back doesn't alert", async () => {
  const old = (id, ref) => pipeline({ id, ref, status: "failed", created_at: "2026-11-22T09:00:00Z" });
  let shaq = res(200, [old(20, "v1.0.0"), old(10, "main")]);
  const { io } = ciIo({
    routes: {
      [PIPES]: res(200, [old(10, "main")]), [SHAQ]: () => shaq,
      [glJobs(10)]: res(200, jobsDone("2026-11-22T09:05:00Z")), [glJobs(20)]: res(200, jobsDone("2026-11-22T09:06:00Z")),
    },
  });
  const c = createCollector(io);
  await c.tick();
  await c.select(WT);
  assert.equal(io.notes.length, 0, "old failures at start-up");
  shaq = res(502, { message: "502 Bad Gateway" });
  io.t += 300000; await c.tick();
  assert.deepEqual(detailOf(io).pipeline.groups.map((g) => g.key), ["gl:10"], "the branch result only");
  shaq = res(200, [old(20, "v1.0.0"), old(10, "main")]);
  io.t += 300000; await c.tick();
  assert.equal(io.notes.length, 0, "20 is back, still the same old failure");
});

// --- re-review follow-ups ------------------------------------------------------------------------------

test("re-review 1: git pull to a commit whose pipeline failed before the dock started alerts once", async () => {
  const A = "a".repeat(40), B = "b".repeat(40);
  const shaq = (sha) => `${GL}/pipelines?sha=${sha}&order_by=id&sort=desc&per_page=5`;
  const pA = pipeline({ id: 30, sha: A, status: "success", created_at: "2026-11-22T08:00:00Z" });
  const pB = pipeline({ id: 40, sha: B, status: "failed", created_at: "2026-11-22T09:00:00Z" });
  let newest = pA;
  const { io } = ciIo({
    st: status("main", { oid: A }),
    routes: {
      [PIPES]: () => res(200, [newest]), [shaq(A)]: res(200, [pA]), [shaq(B)]: res(200, [pB]),
      [glJobs(40)]: res(200, jobsDone("2026-11-22T09:05:00Z")),
    },
  });
  const c = createCollector(io);
  await c.tick();
  assert.equal(wtOf(c).pipeline.id, 30);
  io.st = status("main", { oid: B });
  newest = pB;
  for (let i = 0; i < 2; i++) { io.t += 300000; await c.tick(); }
  assert.equal(wtOf(c).pipeline.id, 40);
  assert.equal(io.notes.length, 1, "the newly checked-out commit's failed build alerts once");
  io.t += 300000; await c.tick();
  assert.equal(io.notes.length, 1);
});

test("re-review 2: a Retry whose POST to the older pipeline fails names it, and the error survives the re-poll", async () => {
  const p = (id, ref, status) => pipeline({ id, ref, status, web_url: `https://gitlab.corp/grp/api/-/pipelines/${id}` });
  let pipes = [p(20, "v1.0.0", "failed"), p(10, "main", "failed")];
  const { io } = ciIo({
    routes: {
      [PIPES]: () => res(200, [pipes[1]]), [SHAQ]: () => res(200, pipes),
      [glJobs(10)]: res(200, JOBS), [glJobs(20)]: () => res(200, pipes[0].status === "failed" ? JOBS : [{ id: 950, name: "pack", stage: "build", status: "running" }]),
      [`${GL}/pipelines/20/retry`]: res(201, { id: 20, status: "running" }),
      [`${GL}/pipelines/10/retry`]: res(500, { message: "500" }),
    },
  });
  const c = createCollector(io);
  await c.tick();
  await c.select(WT);
  const r = await c.retry();
  assert.equal(r.ok, false);
  assert.match(r.error, /pipeline 10: HTTP 500/);
  assert.ok(!/pipeline 20/.test(r.error), "the POST that worked isn't named");
  pipes = [p(20, "v1.0.0", "running"), p(10, "main", "failed")];
  io.t += 30000; await c.tick(); // the 500 backed the host off for 30 s: this is the next poll
  assert.equal(wtOf(c).pipeline.id, 10, "re-polled: the merged id moved to the still-failed pipeline");
  assert.equal(wtOf(c).pipeline.status, "failed");
  assert.match(detailOf(io).retryError, /pipeline 10: HTTP 500/, "still failed: the error stays");
  pipes = [p(20, "v1.0.0", "running"), p(10, "main", "running")];
  c.refresh(); io.t += 1000; await c.tick();
  assert.equal(detailOf(io).retryError, null, "the status changed: cleared");
});

test("re-review 3: one pipeline's failing bridges call beside a working one logs once", async () => {
  const p = (id, ref) => pipeline({ id, ref, status: "success" });
  const { io, c } = await clientOf("gitlab.corp", {
    routes: {
      [PIPES]: res(200, [p(10, "main")]), [SHAQ]: res(200, [p(20, "v1.0.0"), p(10, "main")]),
      [glJobs(10)]: res(200, passedJobs), [glJobs(20)]: res(200, passedJobs),
      [glBridges(10)]: res(200, []), [glBridges(20)]: res(404, { message: "404 Not found" }),
    },
  });
  for (let i = 0; i < 3; i++) await c.latest("gitlab.corp", "gitlab", "grp/api", MAIN, { full: true });
  assert.deepEqual(io.logs.filter((l) => l.includes("bridges of")), ["CI: bridges of gitlab.corp/grp/api pipeline 20: HTTP 404"]);
});
