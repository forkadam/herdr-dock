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
  assert.equal(c.urlFor({ job: 0 }), "https://gitlab.corp/grp/api/-/jobs/902");
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
  // The next poll for that host goes straight to glab.
  const fetched = io.fetches.length;
  io.t += 300000;
  await c.tick();
  assert.equal(io.fetches.length, fetched);
  assert.equal(io.calls.filter((x) => x.cmd === "glab" && x.args[0] === "api").length, 4);
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
  assert.equal(io.fetches.length, 2);
  assert.equal(wtOf(c).pipeline.status, "unknown");
  assert.equal(wtOf(c).pipeline.error, "not logged in");
});

test("(g) a request that never resolves times out after 15 s of fake time", async () => {
  let signal;
  const { io } = ciIo({ routes: { [PIPES]: (u, init) => { signal = init.signal; return new Promise(() => {}); } } });
  const c = createCollector(io);
  const first = c.tick();
  await until(() => io.fetches.length === 1);
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
  // The host backs off 30 s before the next try.
  io.t += 29000;
  await c.tick();
  assert.equal(io.fetches.length, 1);
  io.t += 1000;
  c.tick();
  await until(() => io.fetches.length === 2);
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
  const { io } = ciIo({
    origin: "https://github.com/o/r.git",
    st: status("main", { oid: "bbbb000000000000000000000000000000000002" }),
    routes: {
      [RUNS]: res(200, fx("github-runs.json")),
      "https://api.github.com/repos/o/r/actions/runs/301/jobs": res(200, fx("github-jobs-301.json")),
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
  // Only the failed run's jobs are fetched.
  assert.deepEqual(io.fetches.map((f) => f.url), [RUNS, "https://api.github.com/repos/o/r/actions/runs/301/jobs"]);
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
  assert.equal(detailOf(io).retryError, "HTTP 403");
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
  assert.equal(detailOf(io).retryError, "HTTP 403");
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
  const { io } = ciIo({ routes: { [`${GL.replace("/projects/grp%2Fapi", "")}/${TRACE}`]: textRes(200, "log\n") } });
  const c = createCiClient(io, () => {});
  await c.resolve("gitlab.corp");
  const r = await c.request("gitlab.corp", "GET", TRACE, { text: true, headers: RANGE });
  assert.deepEqual(r, { ok: true, data: "log\n" });
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
