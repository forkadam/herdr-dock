import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeStatus, gitlabPipeline, githubLatest, alertFor, alertKey, ciInterval, gitInterval } from "../src/shared/ci.js";

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
  assert.equal(normalizeStatus("gitlab", { status: "canceling" }), "unknown");
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
