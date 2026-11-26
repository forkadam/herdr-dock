import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeStatus, gitlabJob, gitlabBridge, gitlabCommitPipeline, gitlabPipeline, githubLatest, alertFor, alertKey, ciInterval, lastLogLine, gitInterval, nextAlerted } from "../src/shared/ci.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));

test("normalizeStatus: gitlab", () => {
  const m = { success: "passed", failed: "failed", running: "running", pending: "pending", created: "pending",
    waiting_for_resource: "pending", preparing: "pending", scheduled: "pending", canceled: "canceled",
    skipped: "skipped", manual: "pending" };
  for (const [raw, want] of Object.entries(m)) assert.equal(normalizeStatus("gitlab", { status: raw }), want, raw);
});

test("normalizeStatus: github", () => {
  const n = (status, conclusion) => normalizeStatus("github", { status, conclusion });
  assert.equal(n("in_progress"), "running");
  for (const s of ["queued", "waiting", "requested", "pending"]) assert.equal(n(s), "pending", s);
  assert.equal(n("completed", "success"), "passed");
  for (const c of ["failure", "timed_out", "startup_failure", "action_required"]) assert.equal(n("completed", c), "failed", c);
  assert.equal(n("completed", "cancelled"), "canceled");
  assert.equal(n("completed", "skipped"), "skipped");
  assert.equal(n("completed", "neutral"), "skipped");
});

test("gitlabPipeline: stages and failed jobs", () => {
  const p = gitlabPipeline(fx("gitlab-pipeline.json"), fx("gitlab-jobs.json"));
  assert.equal(p.id, 4821);
  assert.equal(p.status, "failed");
  assert.equal(p.ref, "feat/login");
  assert.equal(p.webUrl, "https://gitlab.example.com/team/api/-/pipelines/4821");
  assert.equal(p.createdAt, "2026-11-22T08:15:03.123Z");
  assert.deepEqual(p.stages, [
    { name: "build", status: "passed" },
    { name: "test", status: "failed" },
    { name: "deploy", status: "skipped" },
  ]);
  assert.deepEqual(p.failedJobs, [
    { name: "unit", stage: "test", webUrl: "https://gitlab.example.com/team/api/-/jobs/9002", duration: 93.5 },
  ]);
});

test("gitlabPipeline: null jobs, stage ranking", () => {
  const p = gitlabPipeline(fx("gitlab-pipeline.json"), null);
  assert.deepEqual(p.stages, []);
  assert.deepEqual(p.failedJobs, []);
  const j = (name, stage, status) => ({ name, stage, status });
  const q = gitlabPipeline({ id: 1, status: "running" }, [j("a", "s", "success"), j("b", "s", "skipped"), j("c", "t", "skipped"), j("d", "u", "running"), j("e", "u", "pending")]);
  assert.deepEqual(q.stages.map((s) => s.status), ["passed", "skipped", "running"]);
});

test("githubLatest: worst of newest sha's runs", () => {
  const p = githubLatest(fx("github-runs.json"), { 301: fx("github-jobs-301.json") });
  assert.equal(p.status, "failed");
  assert.equal(p.id, "bbbb000000000000000000000000000000000002");
  assert.equal(p.sha, p.id);
  assert.equal(p.ref, "main");
  assert.equal(p.webUrl, "https://github.com/o/r/actions/runs/301");
  assert.equal(p.createdAt, "2026-11-22T09:00:00Z");
  assert.deepEqual(p.stages, [{ name: "CI", status: "failed" }, { name: "Lint", status: "passed" }]);
  assert.deepEqual(p.failedJobs, [
    { name: "test", stage: "CI", webUrl: "https://github.com/o/r/actions/runs/301/job/7002", duration: 108 },
  ]);
});

test("githubLatest: older failing sha ignored; empty -> null", () => {
  const runs = fx("github-runs.json");
  runs.workflow_runs = runs.workflow_runs.filter((r) => r.id !== 301);
  const p = githubLatest(runs, {});
  assert.equal(p.status, "passed");
  assert.equal(p.id, "bbbb000000000000000000000000000000000002");
  assert.equal(githubLatest({ workflow_runs: [] }, {}), null);
});

const failed = { id: 5, status: "failed", createdAt: "2026-11-22T10:00:00Z",
  failedJobs: [{ name: "unit" }, { name: "lint" }, { name: "e2e" }] };
const who = { repo: "api", branch: "main" };
const t0 = Date.parse("2026-11-22T09:00:00Z");

test("alertFor rules", () => {
  const a = alertFor({ prev: { id: 5, status: "running" }, cur: failed, alerted: null, startedAt: t0, ...who });
  assert.deepEqual(a, { title: "api · main", body: "Pipeline failed: unit (+2 more)" });
  assert.equal(alertFor({ prev: undefined, cur: { ...failed, createdAt: "2026-11-22T08:00:00Z" }, alerted: null, startedAt: t0, ...who }), null);
  assert.ok(alertFor({ prev: undefined, cur: failed, alerted: null, startedAt: t0, ...who }));
  assert.equal(alertFor({ prev: undefined, cur: failed, alerted: 5, startedAt: t0, ...who }), null);
  assert.equal(alertFor({ prev: { id: 5, status: "failed" }, cur: failed, alerted: null, startedAt: t0, ...who }), null);
  assert.ok(alertFor({ prev: { id: 4, status: "failed" }, cur: failed, alerted: 4, startedAt: t0, ...who }));
  assert.equal(alertFor({ prev: undefined, cur: { ...failed, status: "passed" }, alerted: null, startedAt: t0, ...who }), null);
});

test("alertFor body variants", () => {
  const one = alertFor({ prev: { id: 5, status: "running" }, cur: { ...failed, failedJobs: [{ name: "unit" }] }, alerted: null, startedAt: t0, ...who });
  assert.equal(one.body, "Pipeline failed: unit");
  const none = alertFor({ prev: { id: 5, status: "running" }, cur: { ...failed, failedJobs: [] }, alerted: null, startedAt: t0, ...who });
  assert.equal(none.body, "Pipeline failed");
});

test("ciInterval and gitInterval", () => {
  const now = 1_000_000;
  assert.equal(ciInterval({ status: "running", upstreamChangedAt: 0, now }), 30000);
  assert.equal(ciInterval({ status: "pending", upstreamChangedAt: 0, now }), 30000);
  assert.equal(ciInterval({ status: "passed", upstreamChangedAt: now - 119999, now }), 15000);
  assert.equal(ciInterval({ status: "passed", upstreamChangedAt: now - 120000, now }), 300000);
  assert.equal(ciInterval({ status: "failed", upstreamChangedAt: undefined, now }), 300000);
  assert.equal(gitInterval({ open: true }), 15000);
  assert.equal(gitInterval({ open: false }), 60000);
});

test("unknown statuses stay unknown and never alert", () => {
  assert.equal(normalizeStatus("gitlab", { status: "bogus" }), "unknown");
  for (const c of ["stale", null, undefined]) {
    assert.equal(normalizeStatus("github", { status: "completed", conclusion: c }), "unknown", String(c));
  }
  const runs = { workflow_runs: [
    { id: 1, name: "CI", head_branch: "main", head_sha: "s1", status: "completed", conclusion: "stale", html_url: "u1", created_at: "2026-11-22T09:00:00Z" },
    { id: 2, name: "Lint", head_branch: "main", head_sha: "s1", status: "completed", conclusion: null, html_url: "u2", created_at: "2026-11-22T09:00:01Z" },
  ] };
  const jobs = { 1: { jobs: [{ id: 9, name: "j", status: "completed", conclusion: "stale", html_url: "ju" }] } };
  const p = githubLatest(runs, jobs);
  assert.equal(p.status, "unknown");
  assert.deepEqual(p.failedJobs, []);
  assert.equal(alertFor({ prev: { id: "s1", status: "running" }, cur: p, alerted: null, startedAt: 0, ...who }), null);
  const g = gitlabPipeline({ id: 1, status: "running" }, [{ name: "a", stage: "s", status: "canceling" }]);
  assert.deepEqual(g.failedJobs, []);
});

test("finishedAt: GitLab newest failed-job finished_at, else finished_at, never updated_at; GitHub newest updated_at of the failed runs", () => {
  assert.equal(gitlabPipeline({ id: 1, status: "failed", finished_at: "F", updated_at: "U" }, []).finishedAt, "F");
  // Never updated_at: the list endpoint has no finished_at, and updated_at moves on a still-failed pipeline.
  assert.equal(gitlabPipeline({ id: 1, status: "running", updated_at: "U" }, []).finishedAt, null);
  const j = (id, status, fin, more = {}) => ({ id, name: `j${id}`, stage: "s", status, finished_at: fin, ...more });
  assert.equal(gitlabPipeline({ id: 1, status: "failed", updated_at: "U" }, [j(1, "failed", "2026-11-22T10:05:00Z"), j(2, "failed", "2026-11-22T10:07:00Z"), j(3, "success", "2026-11-22T10:09:00Z"), j(4, "failed", "2026-11-22T10:08:00Z", { allow_failure: true })]).finishedAt, "2026-11-22T10:07:00Z");
  assert.equal(gitlabPipeline({ id: 1, status: "failed", finished_at: "F" }, [j(1, "failed", "2026-11-22T10:05:00Z")]).finishedAt, "2026-11-22T10:05:00Z");
  assert.equal(gitlabPipeline({ id: 1, status: "running" }, []).finishedAt, null);
  const runs = fx("github-runs.json");
  const at = { 301: "2026-11-22T09:03:00Z", 302: "2026-11-22T09:09:00Z", 201: "2026-11-21T09:05:00Z" };
  for (const r of runs.workflow_runs) r.updated_at = at[r.id];
  // Lint (passed) finishing later doesn't move it: only the failed run counts.
  assert.equal(githubLatest(runs, {}).finishedAt, "2026-11-22T09:03:00Z");
  runs.workflow_runs = runs.workflow_runs.filter((r) => r.id !== 301);
  assert.equal(githubLatest(runs, {}).finishedAt, "2026-11-22T09:09:00Z");
});

test("alertFor: the key is id + finishedAt; a retried pipeline failing again alerts; old bare ids still suppress", () => {
  const f1 = { ...failed, finishedAt: "2026-11-22T10:05:00Z" };
  const f2 = { ...failed, finishedAt: "2026-11-22T10:20:00Z" };
  assert.equal(alertKey(f1), "5|2026-11-22T10:05:00Z");
  assert.equal(alertKey({ id: 7 }), "7|null");
  // Same key -> no alert (restart safety).
  assert.equal(alertFor({ prev: undefined, cur: f1, alerted: alertKey(f1), startedAt: t0, ...who }), null);
  // Retry: running then failed again with a new finishedAt.
  assert.ok(alertFor({ prev: { ...f1, status: "running" }, cur: f2, alerted: alertKey(f1), startedAt: t0, ...who }));
  // Failed again between two polls (never seen running).
  assert.ok(alertFor({ prev: f1, cur: f2, alerted: alertKey(f1), startedAt: t0, ...who }));
  assert.equal(alertFor({ prev: f2, cur: f2, alerted: alertKey(f1), startedAt: t0, ...who }), null);
  // Old format: a bare id (number or string) suppresses that pipeline.
  assert.equal(alertFor({ prev: { id: 5, status: "running" }, cur: f1, alerted: 5, startedAt: t0, ...who }), null);
  assert.equal(alertFor({ prev: { id: 5, status: "running" }, cur: f1, alerted: "5", startedAt: t0, ...who }), null);
});

// --- final-review fixes -------------------------------------------------------------------------

test("fix 9: GitLab canceling is canceled; manual stays pending", () => {
  assert.equal(normalizeStatus("gitlab", { status: "canceling" }), "canceled");
  assert.equal(normalizeStatus("gitlab", { status: "manual" }), "pending");
});

test("fix 4: a display number: GitLab's pipeline id, GitHub's newest run_number (id stays the alert identity)", () => {
  const g = gitlabPipeline(fx("gitlab-pipeline.json"), null);
  assert.equal(g.number, 4821);
  assert.equal(g.id, 4821);
  const h = githubLatest(fx("github-runs.json"), {});
  assert.equal(h.number, 58); // run 302 is the newest of that sha
  assert.equal(h.id, "bbbb000000000000000000000000000000000002");
  const noNum = githubLatest({ workflow_runs: [{ id: 1, name: "CI", head_sha: "s", status: "completed", conclusion: "success", created_at: "2026-11-22T09:00:00Z" }] }, {});
  assert.equal(noNum.number, null);
});

test("fix 2: alerted per worktree is a capped list; any key in it suppresses; old string values still work", () => {
  const fa = { ...failed, id: 10, finishedAt: "A" };
  const fb = { ...failed, id: 20, finishedAt: "B" };
  // A branch switch forgets prev; the list still remembers a's failure.
  assert.equal(alertFor({ prev: undefined, cur: fa, alerted: [alertKey(fa), alertKey(fb)], startedAt: t0, ...who }), null);
  assert.equal(alertFor({ prev: undefined, cur: fb, alerted: [alertKey(fa), alertKey(fb)], startedAt: t0, ...who }), null);
  assert.ok(alertFor({ prev: undefined, cur: fb, alerted: [alertKey(fa)], startedAt: t0, ...who }));
  // An old bare id inside a list, or an old single string, still suppresses.
  assert.equal(alertFor({ prev: undefined, cur: fa, alerted: ["10"], startedAt: t0, ...who }), null);
  assert.equal(alertFor({ prev: undefined, cur: fa, alerted: alertKey(fa), startedAt: t0, ...who }), null);

  assert.deepEqual(nextAlerted(undefined, "k1"), ["k1"]);
  assert.deepEqual(nextAlerted("old|x", "k1"), ["old|x", "k1"]); // the old string format is kept
  assert.deepEqual(nextAlerted(["k1", "k2"], "k1"), ["k2", "k1"]); // no duplicates; newest last
  let list;
  for (let i = 0; i < 25; i++) list = nextAlerted(list, `k${i}`);
  assert.equal(list.length, 20);
  assert.equal(list[0], "k5");
  assert.equal(list[19], "k24");
});

test("gitlabJob maps status, label, duration, startedAt", () => {
  const m = gitlabJob({ status: "manual" }, "gl:1");
  assert.equal(m.status, "pending");
  assert.equal(m.label, "manual");
  const f = gitlabJob({ status: "failed", allow_failure: true }, "gl:1");
  assert.deepEqual([f.status, f.label, f.allowFailure], ["failed", "allowed to fail", true]);
  const r = gitlabJob({ status: "running", started_at: "2026-11-26T12:00:00Z", duration: 3 }, "gl:1");
  assert.deepEqual([r.startedAt, r.label, r.duration, r.group, r.bridge, r.step, r.logLine], ["2026-11-26T12:00:00Z", null, 3, "gl:1", false, null, null]);
  assert.equal(gitlabJob({ status: "waiting_for_resource" }, "g").label, "waiting");
  assert.equal(gitlabJob({ status: "preparing" }, "g").label, "waiting");
  assert.equal(gitlabJob({ status: "created" }, "g").label, "created");
  assert.equal(gitlabJob({ status: "scheduled" }, "g").label, "scheduled");
});

test("gitlabBridge uses the downstream pipeline", () => {
  const b = { id: 7, name: "child", stage: "deploy", status: "success", web_url: "B", pipeline: { project_id: 42 } };
  const same = gitlabBridge({ ...b, downstream_pipeline: { status: "running", web_url: "D", project_id: 42 } }, "gl:1");
  assert.deepEqual([same.status, same.webUrl, same.label, same.bridge], ["running", "D", "child pipeline", true]);
  const other = gitlabBridge({ ...b, downstream_pipeline: { status: "running", web_url: "D", project_id: 43 } }, "gl:1");
  assert.equal(other.label, "→ downstream");
  const path = gitlabBridge({ ...b, downstream_pipeline: { status: "running", web_url: "D", project_id: 43, project_path: "team/infra" } }, "gl:1");
  assert.equal(path.label, "→ team/infra");
  const none = gitlabBridge(b, "gl:1");
  assert.deepEqual([none.status, none.webUrl, none.bridge], ["passed", "B", true]);
});

test("gitlabCommitPipeline: two pipelines of one commit", () => {
  const jobs = fx("gitlab-jobs.json");
  const bridges = fx("gitlab-bridges.json");
  const tag = { id: 20, status: "running", ref: "v1.0", sha: "s", web_url: "T", created_at: "2026-11-26T11:00:00Z" };
  const branch = { id: 10, status: "failed", ref: "main", sha: "s", web_url: "M", created_at: "2026-11-26T10:00:00Z" };
  const p = gitlabCommitPipeline([{ pipeline: tag, jobs: [jobs[3], jobs[0]], bridges }, { pipeline: branch, jobs: jobs.slice(0, 3), bridges: null }]);
  // Failed: the alert identity is the newest failed pipeline; the display number stays the newest.
  assert.equal(p.id, 10);
  assert.equal(p.number, 20);
  assert.equal(p.status, "failed");
  assert.deepEqual(p.groups.map((g) => g.ref), ["v1.0", "main"]);
  assert.deepEqual(p.groups.map((g) => [g.key, g.name]), [["gl:20", "#20"], ["gl:10", "#10"]]);
  assert.deepEqual(p.jobs.map((j) => [j.id, j.group]), [
    [9001, "gl:20"], [9004, "gl:20"], [9102, "gl:20"], [9103, "gl:20"],
    [9001, "gl:10"], [9002, "gl:10"], [9003, "gl:10"],
  ]);
  assert.deepEqual(p.stages, gitlabPipeline(tag, [jobs[3], jobs[0]]).stages);
  assert.deepEqual(p.failedJobs.map((j) => j.name), ["unit"]);
  assert.equal(p.jobsTruncated, false);
});

test("gitlabCommitPipeline: 100 jobs sets jobsTruncated", () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `j${i}`, stage: "test", status: "success" }));
  const pl = { id: 1, status: "success", ref: "main", sha: "s" };
  assert.equal(gitlabCommitPipeline([{ pipeline: pl, jobs: many, bridges: [] }]).jobsTruncated, true);
  assert.equal(gitlabCommitPipeline([{ pipeline: pl, jobs: many.slice(1), bridges: [] }]).jobsTruncated, false);
});

test("githubLatest: jobs carry the run as group and the in-progress step", () => {
  const run = { id: 401, run_number: 1, name: "CI", head_branch: "main", head_sha: "x", status: "in_progress", conclusion: null, html_url: "R", created_at: "2026-11-26T09:00:00Z" };
  const p = githubLatest({ workflow_runs: [run] }, { 401: fx("github-jobs-steps.json") });
  assert.equal(p.jobs.length, 1);
  const j = p.jobs[0];
  assert.deepEqual(j.step, { index: 7, total: 12, name: "step 7" });
  assert.deepEqual([j.stage, j.group, j.status, j.startedAt, j.bridge], ["CI", "gh:401", "running", "2026-11-26T09:00:10Z", false]);
  assert.deepEqual(p.groups, [{ key: "gh:401", name: "CI", ref: "main", status: "running", webUrl: "R" }]);
  const two = githubLatest(fx("github-runs.json"), {});
  assert.deepEqual(two.groups.map((g) => g.key), ["gh:302", "gh:301"]);
  assert.deepEqual(two.jobs, []);
});

test("gitlabCommitPipeline: an empty list is null", () => {
  assert.equal(gitlabCommitPipeline([]), null);
});

test("gitlabCommitPipeline: a full page of bridges sets jobsTruncated", () => {
  const bridges = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `b${i}`, stage: "test", status: "success" }));
  const pl = { id: 1, status: "success", ref: "main", sha: "s" };
  assert.equal(gitlabCommitPipeline([{ pipeline: pl, jobs: [], bridges }]).jobsTruncated, true);
  assert.equal(gitlabCommitPipeline([{ pipeline: pl, jobs: [], bridges: bridges.slice(1) }]).jobsTruncated, false);
});

test("gitlabCommitPipeline: finishedAt is the latest over the entries, so an older pipeline failing later moves it", () => {
  const tag = { id: 20, status: "failed", ref: "v1", sha: "s", finished_at: "2026-11-26T10:00:00Z" };
  const branch = { id: 10, status: "failed", ref: "main", sha: "s" };
  const late = [{ id: 1, name: "unit", stage: "test", status: "failed", finished_at: "2026-11-26T11:00:00Z" }];
  assert.equal(gitlabCommitPipeline([{ pipeline: tag, jobs: [], bridges: [] }, { pipeline: branch, jobs: late, bridges: [] }]).finishedAt, "2026-11-26T11:00:00Z");
  const ok = { id: 5, status: "success", ref: "main", sha: "s" };
  assert.equal(gitlabCommitPipeline([{ pipeline: ok, jobs: [], bridges: [] }]).finishedAt, null);
});

test("lastLogLine strips ANSI, section markers and \\r redraws", () => {
  assert.equal(lastLogLine("a\n\x1b[32;1mok\x1b[0m\nsection_end:1700000000:step\r\x1b[0K\n"), "ok");
  assert.equal(lastLogLine("progress 10%\rprogress 55%\n"), "progress 55%");
  assert.equal(lastLogLine("x\n\n   \n"), "x");
  assert.equal(lastLogLine(""), null);
  assert.equal(lastLogLine(null), null);
  assert.equal(lastLogLine("\n\n"), null);
});

test("lastLogLine reads only the tail and caps at 200 chars", () => {
  assert.equal(lastLogLine("head\n" + "y".repeat(20000)), "y".repeat(200));
  assert.equal(lastLogLine("z".repeat(20000)), "z".repeat(200));
});

test("ciInterval: watched running polls every 10 s", () => {
  assert.equal(ciInterval({ status: "running", watched: true }), 10000);
  assert.equal(ciInterval({ status: "pending", watched: true }), 10000);
  assert.equal(ciInterval({ status: "running" }), 30000);
  assert.equal(ciInterval({ status: "passed", watched: true, upstreamChangedAt: -Infinity, now: 0 }), 300000);
});

test("finishedAt: an unparsable stamp never hides a later valid one", () => {
  const bad = { id: 20, status: "failed", ref: "v1", sha: "s", finished_at: "garbage" };
  const good = { id: 10, status: "failed", ref: "main", sha: "s", finished_at: "2026-11-26T10:00:00Z" };
  assert.equal(gitlabCommitPipeline([{ pipeline: bad, jobs: [], bridges: [] }, { pipeline: good, jobs: [], bridges: [] }]).finishedAt, "2026-11-26T10:00:00Z");
  assert.equal(gitlabCommitPipeline([{ pipeline: bad, jobs: [], bridges: [] }]).finishedAt, null);
  const run = (id, updated_at) => ({ id, name: "CI", head_branch: "main", head_sha: "x", status: "completed", conclusion: "failure", html_url: "R", created_at: "2026-11-26T09:00:00Z", updated_at });
  assert.equal(githubLatest({ workflow_runs: [run(1, "garbage"), run(2, "2026-11-26T09:30:00Z")] }, {}).finishedAt, "2026-11-26T09:30:00Z");
});

test("lastLogLine: CRLF lines keep their text, a redraw keeps its last draw", () => {
  assert.equal(lastLogLine("a\r\nb\r\n"), "b");
  assert.equal(lastLogLine("x\r\nprogress 10%\rprogress 55%\r\n"), "progress 55%");
});

test("lastLogLine: a cut tail keeps its first line, whose end is real log text", () => {
  assert.equal(lastLogLine("y".repeat(20000) + "\n"), "y".repeat(200));
  assert.equal(lastLogLine("n".repeat(20000) + "\nreal last"), "real last");
});

// --- Task 4 review fixes ----------------------------------------------------------------------------

test("gitlabCommitPipeline: while failed, the alert identity is the failed pipelines' (a tag pipeline starting or passing beside it moves nothing)", () => {
  const F = "2026-11-26T10:05:00Z";
  const failedJobs = [{ id: 1, name: "unit", stage: "test", status: "failed", finished_at: F }];
  const branch = { pipeline: { id: 10, status: "failed", ref: "main", sha: "s", web_url: "M", created_at: "2026-11-26T10:00:00Z" }, jobs: failedJobs, bridges: null };
  const tag = (status, o = {}) => ({ pipeline: { id: 20, status, ref: "v1", sha: "s", web_url: "T", created_at: "2026-11-26T10:10:00Z", ...o }, jobs: null, bridges: null });
  const alone = gitlabCommitPipeline([branch]);
  const running = gitlabCommitPipeline([tag("running"), branch]);
  const passed = gitlabCommitPipeline([tag("success", { finished_at: "2026-11-26T10:20:00Z" }), branch]);
  for (const p of [running, passed]) {
    assert.equal(p.status, "failed");
    assert.equal(p.id, 10);
    assert.equal(p.finishedAt, F);
    assert.equal(alertKey(p), alertKey(alone));
    // What the UI shows stays the newest pipeline's.
    assert.deepEqual([p.number, p.webUrl, p.createdAt], [20, "T", "2026-11-26T10:10:00Z"]);
  }
  // Not failed: the newest pipeline's id, the latest stamp of all (as before).
  const ok = gitlabCommitPipeline([tag("success", { finished_at: "2026-11-26T10:20:00Z" }), { ...branch, pipeline: { ...branch.pipeline, status: "success" }, jobs: [] }]);
  assert.deepEqual([ok.id, ok.finishedAt], [20, "2026-11-26T10:20:00Z"]);
});

test("githubLatest: a run starting or passing beside a failed run keeps the alert key", () => {
  const run = (id, name, status, conclusion, updated_at) => ({
    id, name, head_branch: "main", head_sha: "x", status, conclusion, html_url: `R${id}`, created_at: "2026-11-26T09:00:00Z", updated_at,
  });
  const failed = run(1, "CI", "completed", "failure", "2026-11-26T09:10:00Z");
  const key = alertKey(githubLatest({ workflow_runs: [failed] }, {}));
  const running = githubLatest({ workflow_runs: [run(2, "Release", "in_progress", null, "2026-11-26T09:20:00Z"), failed] }, {});
  const passed = githubLatest({ workflow_runs: [run(2, "Release", "completed", "success", "2026-11-26T09:30:00Z"), failed] }, {});
  assert.equal(alertKey(running), key);
  assert.equal(alertKey(passed), key);
});

test("busy: any group running or pending; status stays the worst", () => {
  const pl = (id, status, ref) => ({ pipeline: { id, status, ref, sha: "s" }, jobs: null, bridges: null });
  const mixed = gitlabCommitPipeline([pl(20, "running", "v1"), pl(10, "failed", "main")]);
  assert.deepEqual([mixed.status, mixed.busy], ["failed", true]);
  assert.equal(gitlabCommitPipeline([pl(20, "created", "v1"), pl(10, "success", "main")]).busy, true);
  assert.equal(gitlabCommitPipeline([pl(20, "success", "v1"), pl(10, "failed", "main")]).busy, false);
  assert.equal(gitlabPipeline({ id: 1, status: "running" }, null).busy, true);
  assert.equal(gitlabPipeline({ id: 1, status: "pending" }, null).busy, true);
  assert.equal(gitlabPipeline({ id: 1, status: "failed" }, null).busy, false);
  const run = (id, status, conclusion) => ({ id, name: `w${id}`, head_branch: "main", head_sha: "x", status, conclusion, created_at: "2026-11-26T09:00:00Z" });
  const gh = githubLatest({ workflow_runs: [run(1, "completed", "failure"), run(2, "in_progress", null)] }, {});
  assert.deepEqual([gh.status, gh.busy], ["failed", true]);
  assert.equal(githubLatest({ workflow_runs: [run(1, "completed", "failure"), run(2, "queued", null)] }, {}).busy, true);
  assert.equal(githubLatest({ workflow_runs: [run(1, "completed", "failure"), run(2, "completed", "success")] }, {}).busy, false);
});

test("lastLogLine: redact runs after the escape strip and before the 200-character cut", () => {
  const TOKEN = "glpat-secret123";
  const redact = (s) => s.split(TOKEN).join("***");
  assert.equal(lastLogLine("a\nuse glpat-sec\x1b[0mret123 now\n", redact), "use *** now");
  assert.equal(lastLogLine(`a\n${"x".repeat(190)}${TOKEN}\n`, redact), `${"x".repeat(190)}***`);
  // No redact given: the text as is.
  assert.equal(lastLogLine("a\nuse glpat-sec\x1b[0mret123\n"), `use ${TOKEN}`);
});
