import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { SAMPLE_KEY, sampleCommand, parseSample, warningsFor } from "../src/shared/system.js";

test("SAMPLE_KEY", () => assert.equal(SAMPLE_KEY, "dock.system.sample"));
test("parseSample: good line is clamped and rounded", () => {
  assert.deepEqual(parseSample('{"cpu":34.4,"mem":61.6,"diskFree":7.2}\n', 5), { cpu: 34, mem: 62, diskFree: 7, at: 5 });
  assert.deepEqual(parseSample('{"cpu":140,"mem":-3,"diskFree":null}', 1), { cpu: 100, mem: 0, diskFree: null, at: 1 });
});
test("parseSample: bad output is null", () => { for (const s of ["", "nope", "{}", '{"cpu":"x"}']) assert.equal(parseSample(s, 1), null); });
test("warningsFor: nothing on a normal day", () => {
  assert.deepEqual(warningsFor({ sample: { cpu: 5, mem: 40, diskFree: 50, at: 0 }, gitState: { repos: [] }, quotaTop: { p: 60, at: 0 }, now: 1000 }), []);
});
test("warningsFor: running only (not pending), quota at 90, disk under 10, in order", () => {
  const gitState = { repos: [{ worktrees: [{ pipeline: { status: "running" } }, { pipeline: { status: "pending" } }] }] };
  const w = warningsFor({ sample: { diskFree: 7, at: 0 }, gitState, quotaTop: { p: 92, at: 0 }, now: 1000 });
  assert.deepEqual(w.map((x) => x.text), ["⟳ 1", "⚠ quota 92%", "⚠ disk 7%"]);
  assert.deepEqual(w.map((x) => x.key), ["pipelines", "quota", "disk"]);
  assert.ok(w.every((x) => typeof x.tip === "string" && x.tip));
  assert.deepEqual(warningsFor({ sample: { diskFree: 7, at: 0 }, gitState: null, quotaTop: { p: 89, at: 0 }, now: 31000 }), []);
});
test("warningsFor: stale quota and null inputs are quiet", () => {
  assert.deepEqual(warningsFor({ sample: null, gitState: null, quotaTop: { p: 99, stale: true, at: 0 }, now: 1 }), []);
  assert.deepEqual(warningsFor({ sample: null, gitState: null, quotaTop: null, now: 1 }), []);
});
test("warningsFor: a quota reading counts only while fresh (at within 120 s)", () => {
  const q = (o) => warningsFor({ sample: null, gitState: null, quotaTop: { p: 95, ...o }, now: 200000 }).map((x) => x.key);
  assert.deepEqual(q({ at: 200000 }), ["quota"]);
  assert.deepEqual(q({ at: 80000 }), ["quota"]); // exactly 120 s old
  assert.deepEqual(q({ at: 79999 }), []); // older
  assert.deepEqual(q({}), []); // missing at
  assert.deepEqual(q({ at: "x" }), []);
});
test("warningsFor: the pipelines entry carries the running worktrees' ids", () => {
  const gitState = { repos: [{ worktrees: [{ id: "a", pipeline: { status: "running" } }, { id: "b", pipeline: { status: "failed" } }] },
    { worktrees: [{ id: "c", pipeline: { status: "running" } }] }] };
  const [p] = warningsFor({ sample: null, gitState, quotaTop: null, now: 1 });
  assert.equal(p.key, "pipelines");
  assert.deepEqual(p.worktrees, ["a", "c"]);
});
test("sampleCommand prints a parseable line on this machine", () => {
  const { command, args } = sampleCommand();
  assert.equal(command, "node");
  const out = execFileSync(command, args, { encoding: "utf8", timeout: 10000 });
  const s = parseSample(out, 1);
  assert.ok(s);
  assert.ok(s.diskFree === null || (s.diskFree >= 0 && s.diskFree <= 100));
});
