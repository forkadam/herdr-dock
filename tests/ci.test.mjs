import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeStatus, gitlabPipeline, githubLatest, alertFor, ciInterval, gitInterval } from "../src/shared/ci.js";

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
