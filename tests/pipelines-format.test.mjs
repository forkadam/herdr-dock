import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, duration, bucketOf, countLine, stageSummary, elapsed, viewGroups, budgetLine } from "../src/mods/dock-pipelines/format.js";

const NOW = Date.parse("2026-11-22T12:00:00Z");

test("ago: seconds, minutes, hours and days before now", () => {
  assert.equal(ago("2026-11-22T11:59:30Z", NOW), "just now");
  assert.equal(ago("2026-11-22T11:59:00Z", NOW), "1m ago");
  assert.equal(ago("2026-11-22T11:57:00Z", NOW), "3m ago");
  assert.equal(ago("2026-11-22T11:00:30Z", NOW), "59m ago");
  assert.equal(ago("2026-11-22T11:00:00Z", NOW), "1h ago");
  assert.equal(ago("2026-11-21T13:00:00Z", NOW), "23h ago");
  assert.equal(ago("2026-11-21T12:00:00Z", NOW), "1d ago");
  assert.equal(ago("2026-11-12T12:00:00Z", NOW), "10d ago");
});

test("ago: a time a little ahead of now (clock skew) is just now", () => {
  assert.equal(ago("2026-11-22T12:00:20Z", NOW), "just now");
});

test("ago: missing or unparsable times give an empty string", () => {
  assert.equal(ago(null, NOW), "");
  assert.equal(ago(undefined, NOW), "");
  assert.equal(ago("not a date", NOW), "");
});

test("duration: seconds, m:ss and h:mm", () => {
  assert.equal(duration(0), "0s");
  assert.equal(duration(45), "45s");
  assert.equal(duration(45.7), "45s");
  assert.equal(duration(134), "2m14s");
  assert.equal(duration(302), "5m02s");
  assert.equal(duration(3600), "1h00m");
  assert.equal(duration(3780), "1h03m");
});

test("duration: missing or negative gives an empty string", () => {
  assert.equal(duration(null), "");
  assert.equal(duration(undefined), "");
  assert.equal(duration(-1), "");
  assert.equal(duration(NaN), "");
});

test("fix 5: Retry is enabled only for failed or canceled pipelines", async () => {
  const { canRetry } = await import("../src/mods/dock-pipelines/format.js");
  for (const s of ["failed", "canceled"]) assert.equal(canRetry(s), true, s);
  for (const s of ["passed", "running", "pending", "skipped", "unknown", "none", undefined]) assert.equal(canRetry(s), false, String(s));
});

const job = (over = {}) => ({ id: 1, name: "j", stage: "build", group: "g", status: "passed", label: null, allowFailure: false, ...over });

test("bucketOf: manual and scheduled labels, allowed failures and unknown status", () => {
  assert.equal(bucketOf(job({ status: "skipped", label: "manual" })), "manual");
  assert.equal(bucketOf(job({ status: "pending", label: "scheduled" })), "manual");
  assert.equal(bucketOf(job({ status: "failed", allowFailure: true })), "warn");
  assert.equal(bucketOf(job({ status: "failed" })), "failed");
  assert.equal(bucketOf(job({ status: "unknown" })), "pending");
  for (const s of ["running", "pending", "passed", "canceled", "skipped"]) assert.equal(bucketOf(job({ status: s })), s);
});

test("countLine: bucket order, singular, truncation and empty", () => {
  const jobs = [
    ...Array(7).fill(0).map(() => job({ status: "passed" })),
    ...Array(4).fill(0).map(() => job({ status: "pending" })),
    job({ status: "running" }),
  ];
  assert.equal(countLine(jobs, false), "12 jobs · 1 running · 4 pending · 7 passed");
  assert.equal(countLine(jobs, true), "12+ jobs · 1 running · 4 pending · 7 passed");
  assert.equal(countLine([job()], false), "1 job · 1 passed");
  assert.equal(countLine([], false), "");
  const all = ["skipped", "canceled", "passed", "failed", "running", "pending"].map((status) => job({ status }));
  all.push(job({ status: "failed", allowFailure: true }), job({ status: "skipped", label: "manual" }));
  assert.equal(countLine(all, false), "8 jobs · 1 failed · 1 running · 1 pending · 1 manual · 1 warn · 1 passed · 1 canceled · 1 skipped");
});

test("countLine: a passed pipeline with a manual deploy", () => {
  const jobs = [job(), job({ stage: "deploy", status: "skipped", label: "manual" })];
  assert.equal(countLine(jobs, false), "2 jobs · 1 manual · 1 passed");
});

test("stageSummary: manual-only stage, allowed failure and worst bucket", () => {
  assert.deepEqual(stageSummary([job({ status: "skipped", label: "manual" })]), { bucket: "manual", done: 0, total: 0 });
  assert.deepEqual(stageSummary([job(), job({ status: "skipped", label: "manual" })]), { bucket: "passed", done: 1, total: 1 });
  const warn = stageSummary([job(), job({ status: "failed", allowFailure: true })]);
  assert.deepEqual(warn, { bucket: "warn", done: 2, total: 2 });
  assert.deepEqual(stageSummary([job(), job({ status: "failed" }), job({ status: "running" })]), { bucket: "failed", done: 2, total: 3 });
  assert.deepEqual(stageSummary([job(), job({ status: "pending" })]), { bucket: "pending", done: 1, total: 2 });
});

test("elapsed: via duration, empty when missing", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  assert.equal(elapsed("2026-11-22T11:57:46Z", now), "2m14s");
  assert.equal(elapsed(null, now), "");
  assert.equal(elapsed("nope", now), "");
});

test("viewGroups: GitHub groups titled by ref only when it differs, workflow stage unnamed", () => {
  const pipeline = {
    groups: [
      { key: "gh:2", name: "Release", ref: "v0.4.0-alpha.0", webUrl: "u2" },
      { key: "gh:1", name: "CI", ref: "main", webUrl: "u1" },
    ],
    jobs: [
      job({ id: 1, group: "gh:1", stage: "CI", name: "lint" }),
      job({ id: 2, group: "gh:2", stage: "Release", name: "pack" }),
      job({ id: 3, group: "gh:1", stage: "CI", name: "test", status: "failed" }),
    ],
  };
  const v = viewGroups(pipeline, "main");
  assert.deepEqual(v.map((g) => [g.key, g.title, g.webUrl]), [["gh:2", "Release · v0.4.0-alpha.0", "u2"], ["gh:1", "CI", "u1"]]);
  assert.equal(v[1].stages.length, 1);
  assert.equal(v[1].stages[0].name, null);
  assert.deepEqual(v[1].stages[0].jobs.map((x) => [x.job.name, x.index]), [["lint", 0], ["test", 2]]);
  assert.equal(v[1].stages[0].summary.bucket, "failed");
});

test("viewGroups: GitLab titles and stages in first-appearance order", () => {
  const pipeline = {
    groups: [
      { key: "gl:20", name: "#20", ref: "v1.0", webUrl: "a" },
      { key: "gl:19", name: "#19", ref: "main", webUrl: "b" },
    ],
    jobs: [
      job({ id: 1, group: "gl:19", stage: "test" }),
      job({ id: 2, group: "gl:20", stage: "build" }),
      job({ id: 3, group: "gl:19", stage: "build" }),
      job({ id: 4, group: "gl:20", stage: "deploy", status: "skipped", label: "manual" }),
    ],
  };
  const v = viewGroups(pipeline, "main");
  assert.deepEqual(v.map((g) => g.title), ["#20 · v1.0", "#19"]);
  assert.deepEqual(v[1].stages.map((s) => s.name), ["test", "build"]);
  assert.deepEqual(v[0].stages.map((s) => [s.name, s.summary.bucket]), [["build", "passed"], ["deploy", "manual"]]);
});

test("viewGroups: jobs without a matching group go in a trailing Jobs group", () => {
  const jobs = [job({ id: 1, group: "a", stage: "x" }), job({ id: 2, group: "b", stage: "y" }), job({ id: 3, group: "a", stage: "y" })];
  for (const groups of [[], undefined]) {
    const v = viewGroups({ groups, jobs }, "main");
    assert.equal(v.length, 1);
    assert.deepEqual([v[0].key, v[0].title, v[0].webUrl], ["", "Jobs", null]);
    assert.deepEqual(v[0].stages.map((s) => [s.name, s.jobs.map((r) => r.index)]), [["x", [0]], ["y", [1, 2]]]);
  }
  const v = viewGroups({ groups: [{ key: "gl:1", name: "#1", ref: "main", webUrl: "u" }], jobs: [job({ group: "gl:1" }), job({ group: "gl:99" })] }, "main");
  assert.deepEqual(v.map((g) => g.title), ["#1", "Jobs"]);
  assert.deepEqual(v[0].stages[0].jobs.map((r) => r.index), [0]);
  assert.deepEqual(v[1].stages[0].jobs.map((r) => r.index), [1]);
});

test("viewGroups: no Jobs group when every job matches", () => {
  const v = viewGroups({ groups: [{ key: "g", name: "#1", ref: "main", webUrl: "u" }], jobs: [job({ group: "g" })] }, "main");
  assert.deepEqual(v.map((g) => g.key), ["g"]);
});

test("bucketOf: unrecognized status is pending; bridges and unknown", () => {
  assert.equal(bucketOf(job({ status: "weird" })), "pending");
  assert.equal(countLine([job(), job({ status: "weird" })], false), "2 jobs · 1 pending · 1 passed");
  assert.equal(bucketOf(job({ label: "child pipeline", status: "running" })), "running");
  assert.equal(bucketOf(job({ status: "unknown", group: "gh:1" })), "pending");
});

test("stageSummary: no jobs", () => {
  assert.deepEqual(stageSummary([]), { bucket: "pending", done: 0, total: 0 });
});

test("viewGroups: two builds with the same title (a push and a pull_request run of one workflow) say their event", () => {
  const pipeline = {
    groups: [
      { key: "gh:2", name: "CI", ref: "main", event: "pull_request", webUrl: "u2" },
      { key: "gh:1", name: "CI", ref: "main", event: "push", webUrl: "u1" },
      { key: "gh:3", name: "Lint", ref: "main", event: "push", webUrl: "u3" },
    ],
    jobs: [job({ id: 1, group: "gh:1", stage: "CI" }), job({ id: 2, group: "gh:2", stage: "CI" }), job({ id: 3, group: "gh:3", stage: "Lint" })],
  };
  const v = viewGroups(pipeline, "main");
  assert.deepEqual(v.map((g) => g.title), ["CI · pull_request", "CI · push", "Lint"]);
  // The stage header is still left out: the stage carries the workflow's name, not the title.
  assert.equal(v[0].stages[0].name, null);
});

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

test("budgetLine: a dim line with thousands separators, the provider's name for each host", () => {
  assert.deepEqual(budgetLine({ provider: "github", remaining: 4321, limit: 5000, limitedUntil: null }, NOW),
    { tone: "dim", text: "GitHub API: 4,321 of 5,000 left" });
  assert.deepEqual(budgetLine({ provider: "gitlab", remaining: 12, limit: 2000, limitedUntil: null }, NOW),
    { tone: "dim", text: "GitLab API: 12 of 2,000 left" });
  assert.equal(budgetLine({ provider: "github", remaining: 1234567, limit: 2000000 }, NOW).text, "GitHub API: 1,234,567 of 2,000,000 left");
});

test("budgetLine: a limit still ahead gives the warn line with the local HH:MM, whatever the numbers are", () => {
  const until = NOW + 20 * 60 * 1000;
  const want = `GitHub API limit reached — resumes at ${hhmm(until)}`;
  assert.deepEqual(budgetLine({ provider: "github", remaining: 0, limit: 5000, limitedUntil: until }, NOW), { tone: "warn", text: want });
  assert.deepEqual(budgetLine({ provider: "github", remaining: null, limit: null, limitedUntil: until }, NOW), { tone: "warn", text: want });
  assert.match(budgetLine({ provider: "gitlab", remaining: null, limit: null, limitedUntil: until }, NOW).text, /^GitLab API limit reached — resumes at \d\d:\d\d$/);
});

test("budgetLine: a limit in the past gives the dim line; no usable numbers or no budget gives null", () => {
  assert.deepEqual(budgetLine({ provider: "github", remaining: 10, limit: 5000, limitedUntil: NOW - 1 }, NOW),
    { tone: "dim", text: "GitHub API: 10 of 5,000 left" });
  assert.equal(budgetLine({ provider: "github", remaining: null, limit: null, limitedUntil: NOW - 1 }, NOW), null);
  assert.equal(budgetLine({ provider: "github", remaining: 5, limit: null, limitedUntil: null }, NOW), null);
  assert.equal(budgetLine(null, NOW), null);
  assert.equal(budgetLine(undefined, NOW), null);
});

test("M5: budgetLine rounds the resume time up to the next minute (never shows a time before the pause ends)", () => {
  const at = (h, m, s, ms = 0) => new Date(2026, 10, 27, h, m, s, ms).getTime();
  const now = at(15, 0, 0);
  const text = (until) => budgetLine({ provider: "github", remaining: 0, limit: 5000, limitedUntil: until }, now).text;
  assert.equal(text(at(15, 46, 50)), "GitHub API limit reached — resumes at 15:47");
  assert.equal(text(at(15, 46, 0, 1)), "GitHub API limit reached — resumes at 15:47");
  assert.equal(text(at(15, 46, 0)), "GitHub API limit reached — resumes at 15:46");
  assert.equal(text(at(23, 59, 30)), "GitHub API limit reached — resumes at 00:00");
});

test("M6: limitTip says the limit and its resume time while the pause lasts; null otherwise", async () => {
  const { limitTip } = await import("../src/mods/dock-pipelines/format.js");
  const at = (h, m, s) => new Date(2026, 10, 27, h, m, s).getTime();
  const now = at(15, 0, 0);
  assert.equal(limitTip({ provider: "github", limitedUntil: at(15, 46, 50) }, now), "API limit reached — resumes at 15:47");
  assert.equal(limitTip({ provider: "github", limitedUntil: now - 1 }, now), null);
  assert.equal(limitTip({ provider: "github", limitedUntil: null }, now), null);
  assert.equal(limitTip(null, now), null);
});
