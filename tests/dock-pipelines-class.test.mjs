// Loads dock-pipelines' real class against stubbed host modules: the job rows, the live loop and the heartbeat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resetHost, handlers, texts, clearTexts } from "./fixtures/host-stubs.mjs";
import { githubLatest } from "../src/shared/ci.js";

const herdr = await import("herdr");
const { default: Pipelines } = await import("../src/mods/dock-pipelines/main.js");
const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

// A cx whose sleep waits until the test calls tick(): each tick ends every pending sleep and lets the loops run on.
function loopCx() {
  const waiting = [];
  const cx = {
    notified: 0,
    spawn: (f) => { f(cx); },
    notify() { cx.notified += 1; },
    stop_propagation() {},
    sleep: () => new Promise((resolve) => waiting.push(resolve)),
    async tick(n = 1) {
      for (let i = 0; i < n; i++) {
        for (const wake of waiting.splice(0)) wake(); // a second passes for every sleeper
        await new Promise((r) => setImmediate(r));
      }
    },
  };
  return cx;
}

// Task 4's GitHub tag case: commit 72aae06 has a running Release run for tag v0.4.0-alpha.0 and a passed CI run
// for main.
function tagDetail() {
  const pipeline = githubLatest(fx("github-runs-tag.json"), {
    45823655383: fx("github-jobs-45823655383.json"),
    45822438336: fx("github-jobs-45822438336.json"),
  });
  return { worktree: "wt1", repo: "app", branch: "main", provider: "github", via: "fetch", pipeline, olderThanHead: false,
    error: null, hint: null, retryError: null };
}

const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString();

// A GitLab pipeline of one commit: a running job with a log line and a running job with nothing known yet.
function gitlabDetail() {
  const job = (id, name, extra) => ({ id, name, stage: "test", group: "gl:4821", status: "running", label: null,
    allowFailure: false, duration: null, startedAt: ago(94), webUrl: `https://gitlab.example/j/${id}`, step: null,
    logLine: null, bridge: false, ...extra });
  return {
    worktree: "wt1", repo: "app", branch: "feat/x", provider: "gitlab", via: "fetch", olderThanHead: false,
    error: null, hint: null, retryError: null,
    pipeline: {
      id: 4821, number: 4821, status: "running", busy: true, ref: "feat/x", sha: "a1b2c3d4e5", webUrl: "https://gitlab.example/p/4821",
      createdAt: ago(180), stages: [], failedJobs: [], jobsTruncated: false,
      groups: [{ key: "gl:4821", name: "#4821", ref: "feat/x", status: "running", webUrl: "https://gitlab.example/p/4821" }],
      jobs: [job(11, "e2e", { logLine: "> 112/340 specs passed" }), job(12, "integration")],
    },
  };
}

const plainCx = { spawn() {}, notify() {}, stop_propagation() {} };
function draw(detail, props = { overlay: "pl" }) {
  resetHost();
  herdr.data.props = props;
  herdr.data.shared.set("dock.git.detail", detail);
  const v = new Pipelines();
  v.init({}, plainCx);
  clearTexts();
  v.render(plainCx);
  return v;
}

// The strings drawn from `first` up to (not including) `next`.
function between(first, next) {
  const all = texts();
  const a = all.indexOf(first);
  assert.ok(a >= 0, `${first} is drawn`);
  const b = next == null ? all.length : all.indexOf(next, a + 1);
  return all.slice(a, b);
}

// A job row's strings from its name to the end of the row. Every row starts with its glyph, drawn just before its
// name, so the row ends one string before the next row's name.
function rowOf(name, nextRowName) {
  const all = texts();
  const a = all.indexOf(name);
  const b = all.indexOf(nextRowName, a + 1);
  assert.ok(a >= 0 && b > a, `${name} is drawn before ${nextRowName}`);
  return all.slice(a, b - 1);
}

test("dock-pipelines: renders the count line and one row per job under its group/stage", () => {
  draw(tagDetail());
  const all = texts();
  assert.ok(all.includes("4 jobs · 1 running · 3 passed"), all.join(" | "));
  assert.ok(all.includes("step 9/12 · Build and sign Tauri desktop bundle"), all.join(" | "));
  const at = (s) => { const i = all.indexOf(s); assert.ok(i >= 0, `${s} is drawn`); return i; };
  // Release (newest) first with its two jobs, then CI (built from the worktree's own branch: no ref) with its two.
  const order = ["Release · v0.4.0-alpha.0", "publish (ubuntu-22.04, appimage)", "publish (windows-latest, nsis)", "CI",
    "check-and-test (ubuntu-latest)", "check-and-test (windows-latest)"].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // A GitHub workflow is its own only stage: no stage header repeats its name.
  assert.equal(all.filter((s) => s === "Release").length, 0);
});

test("dock-pipelines: a GitLab running job shows its log line in the second row", () => {
  draw(gitlabDetail());
  assert.deepEqual(rowOf("e2e", "integration"), ["e2e", "1m34s", "↗", "> 112/340 specs passed"]);
});

test("dock-pipelines: a job with no logLine or step draws no second row", () => {
  draw(gitlabDetail());
  assert.deepEqual(between("integration", "Retry"), ["integration", "1m34s", "↗"]);
});

test("dock-pipelines: before the first full poll (no jobs yet) the stage strip shows; with jobs it does not", () => {
  const d = gitlabDetail();
  d.pipeline.jobs = [];
  d.pipeline.stages = [{ name: "build", status: "passed" }, { name: "test", status: "running" }];
  draw(d);
  const all = texts();
  assert.ok(all.includes("build") && all.includes("test"), all.join(" | "));
  // Each name is followed by its status glyph (badgeOf: passed ✓, running ⟳).
  assert.deepEqual(between("build", "Retry"), ["build", "✓", "test", "⟳"]);
  // Jobs present: the job list's own stage header is the only "test"; the strip's "build" is gone.
  d.pipeline.jobs = gitlabDetail().pipeline.jobs;
  draw(d);
  assert.equal(texts().filter((s) => s === "test").length, 1);
  assert.equal(texts().includes("build"), false);
  // Neither: nothing between the pipeline line's sha and Retry.
  d.pipeline.jobs = [];
  d.pipeline.stages = [];
  draw(d);
  assert.deepEqual(between("a1b2c3d4", "Retry"), ["a1b2c3d4"]);
});

test("dock-pipelines: init running again on the same instance starts no second loop", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.props = { overlay: "pl" };
  herdr.data.shared.set("dock.git.detail", tagDetail());
  const cx = loopCx();
  let spawns = 0;
  const spawn = cx.spawn;
  cx.spawn = (f) => { spawns += 1; spawn(f); };
  const v = new Pipelines();
  v.init({}, cx);
  v.init({}, cx);
  assert.equal(spawns, 1);
  await cx.tick(2);
  assert.equal(cx.notified, 2);
});

test("dock-pipelines: clicking a job's open link sends git.open.job with its pipeline.jobs index", () => {
  draw(tagDetail());
  // pipeline.jobs[1] is publish (windows-latest, nsis).
  handlers()["pl-job-open-1:on_click"]({}, plainCx);
  assert.deepEqual(herdr.data.runs.map(([c]) => c), ["dock-core.git.open.job.1"]);
});

test("dock-pipelines: while a job runs the loop notifies each second; with none running it does not", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.props = { overlay: "pl" };
  const detail = tagDetail();
  herdr.data.shared.set("dock.git.detail", detail);
  const cx = loopCx();
  new Pipelines().init({}, cx);
  assert.equal(cx.notified, 0);
  await cx.tick(3);
  assert.equal(cx.notified, 3);
  const done = structuredClone(detail);
  for (const j of done.pipeline.jobs) j.status = "passed";
  herdr.data.shared.set("dock.git.detail", done);
  await cx.tick(3);
  assert.equal(cx.notified, 3);
});

test("dock-pipelines: heartbeat: written when shown in the dialog (props().overlay set), not written when the right panel shows another feature", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.props = { overlay: "pl" };
  const cx = loopCx();
  new Pipelines().init({}, cx);
  assert.equal(typeof herdr.data.shared.get("dock.git.watching")?.at, "number");
  // Every 5 s after that.
  herdr.data.shared.delete("dock.git.watching");
  await cx.tick(4);
  assert.equal(herdr.data.shared.get("dock.git.watching"), undefined);
  await cx.tick(1);
  assert.equal(typeof herdr.data.shared.get("dock.git.watching")?.at, "number");

  resetHost();
  herdr.data.checking = false;
  herdr.data.props = { dockRegion: "right" };
  herdr.data.shared.set("dock.config.applied", { right: { hidden: false, features: [{ mod: "dock-pipelines" }, { mod: "dock-browser" }] } });
  herdr.data.shared.set("dock.right.shown", true);
  herdr.data.shared.set("dock.right.active", "dock-browser");
  const cx2 = loopCx();
  new Pipelines().init({}, cx2);
  await cx2.tick(10);
  assert.equal(herdr.data.shared.get("dock.git.watching"), undefined);
  // The same panel once it shows Pipelines.
  herdr.data.shared.set("dock.right.active", "dock-pipelines");
  await cx2.tick(5);
  assert.equal(typeof herdr.data.shared.get("dock.git.watching")?.at, "number");
});

test("dock-pipelines: the × click closes the overlay once and clears the heartbeat", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.props = { overlay: "pl" };
  herdr.data.shared.set("dock.git.detail", tagDetail());
  const cx = loopCx();
  const v = new Pipelines();
  v.init({}, cx);
  assert.equal(typeof herdr.data.shared.get("dock.git.watching")?.at, "number");
  v.render(cx);
  handlers()["pl-close:on_click"]({}, cx);
  assert.deepEqual(herdr.data.closedOverlays, ["pl"]);
  assert.equal(herdr.data.shared.get("dock.git.watching"), null);
});

test("dock-pipelines: Herdr's lifecycle close() clears the heartbeat and stops the loop, never closing the overlay", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.props = { overlay: "pl" };
  herdr.data.shared.set("dock.git.detail", tagDetail());
  const cx = loopCx();
  const v = new Pipelines();
  v.init({}, cx);
  assert.equal(typeof herdr.data.shared.get("dock.git.watching")?.at, "number");
  await v.close(cx);
  assert.equal(herdr.data.shared.get("dock.git.watching"), null);
  assert.deepEqual(herdr.data.closedOverlays, [], "the overlay is already going");
  // The loop stops: no heartbeat and no redraw after close, though a job is still running.
  const notified = cx.notified;
  await cx.tick(10);
  assert.equal(herdr.data.shared.get("dock.git.watching"), null);
  assert.equal(cx.notified, notified);
  assert.equal(v.looping, false);
});

test("dock-pipelines: a running job redraws each second only while the panel is on screen", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.props = { dockRegion: "right" };
  herdr.data.shared.set("dock.git.detail", tagDetail());
  herdr.data.shared.set("dock.config.applied", { right: { hidden: false, features: [{ mod: "dock-pipelines" }, { mod: "dock-browser" }] } });
  herdr.data.shared.set("dock.right.shown", true);
  herdr.data.shared.set("dock.right.active", "dock-browser");
  const cx = loopCx();
  new Pipelines().init({}, cx);
  await cx.tick(3);
  assert.equal(cx.notified, 0, "hidden behind another feature: no redraws");
  herdr.data.shared.set("dock.right.active", "dock-pipelines");
  await cx.tick(3);
  assert.equal(cx.notified, 3);
});

test("dock-pipelines: the budget line is drawn right under the pipeline line, before the job list", () => {
  const d = gitlabDetail();
  d.budget = { provider: "gitlab", remaining: 1987, limit: 2000, limitedUntil: null };
  draw(d);
  assert.deepEqual(between("a1b2c3d4", "2 jobs · 2 running"), ["a1b2c3d4", "GitLab API: 1,987 of 2,000 left"]);
});

test("dock-pipelines: no budget, or no readable numbers, draws no budget line", () => {
  const d = gitlabDetail();
  draw(d);
  assert.equal(texts().some((s) => s.includes("API")), false);
  d.budget = { provider: "gitlab", remaining: null, limit: null, limitedUntil: null };
  draw(d);
  assert.equal(texts().some((s) => s.includes("API")), false);
});

test("dock-pipelines: while a limit pause lasts the warn line shows and the job list is still drawn", () => {
  const d = gitlabDetail();
  d.budget = { provider: "gitlab", remaining: null, limit: null, limitedUntil: Date.now() + 10 * 60 * 1000 };
  draw(d);
  const all = texts();
  const warn = all.find((s) => s.startsWith("GitLab API limit reached — resumes at "));
  assert.match(warn, /\d\d:\d\d$/);
  assert.equal(all.some((s) => s.includes("left")), false);
  assert.ok(all.indexOf(warn) < all.indexOf("2 jobs · 2 running"), "the warn line is above the job list");
  assert.deepEqual(rowOf("e2e", "integration"), ["e2e", "1m34s", "↗", "> 112/340 specs passed"]);
});

test("dock-pipelines: a limit pause redraws each second with no job running, once more after it ends, then stops", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.props = { overlay: "pl" };
  const d = gitlabDetail();
  for (const j of d.pipeline.jobs) j.status = "passed";
  d.budget = { provider: "gitlab", remaining: null, limit: null, limitedUntil: Date.now() + 2000 };
  herdr.data.shared.set("dock.git.detail", d);
  const cx = loopCx();
  const v = new Pipelines();
  v.init({}, cx);
  await cx.tick(2);
  assert.equal(cx.notified, 2);
  // The pause ends: one more redraw so the warn line goes, then the loop is quiet again.
  d.budget = { ...d.budget, limitedUntil: Date.now() - 1 };
  await cx.tick(1);
  assert.equal(cx.notified, 3);
  await cx.tick(3);
  assert.equal(cx.notified, 3);
  clearTexts();
  v.render(plainCx);
  assert.equal(texts().some((s) => s.includes("API")), false);
});

test("dock-pipelines: a limit pause redraws only while the panel is on screen", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.props = { dockRegion: "right" };
  const d = gitlabDetail();
  d.budget = { provider: "gitlab", remaining: null, limit: null, limitedUntil: Date.now() + 60000 };
  for (const j of d.pipeline.jobs) j.status = "passed";
  herdr.data.shared.set("dock.git.detail", d);
  herdr.data.shared.set("dock.config.applied", { right: { hidden: false, features: [{ mod: "dock-pipelines" }, { mod: "dock-browser" }] } });
  herdr.data.shared.set("dock.right.shown", true);
  herdr.data.shared.set("dock.right.active", "dock-browser");
  const cx = loopCx();
  new Pipelines().init({}, cx);
  await cx.tick(3);
  assert.equal(cx.notified, 0);
});

test("dock-pipelines: a limit that has already passed draws the dim line with the numbers, not the warn line", () => {
  const d = gitlabDetail();
  d.budget = { provider: "gitlab", remaining: 15, limit: 2000, limitedUntil: Date.now() - 5000 };
  draw(d);
  const all = texts();
  assert.ok(all.includes("GitLab API: 15 of 2,000 left"), all.join(" | "));
  assert.equal(all.some((s) => s.includes("limit reached")), false);
});
