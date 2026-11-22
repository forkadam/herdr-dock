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
  assert.deepEqual(warningsFor({ sample: { cpu: 5, mem: 40, diskFree: 50, at: 0 }, gitState: { repos: [] }, quotaTop: { p: 60 }, now: 1000 }), []);
});
test("warningsFor: running only (not pending), quota at 90, disk under 10, in order", () => {
  const gitState = { repos: [{ worktrees: [{ pipeline: { status: "running" } }, { pipeline: { status: "pending" } }] }] };
  const w = warningsFor({ sample: { diskFree: 7, at: 0 }, gitState, quotaTop: { p: 92 }, now: 1000 });
  assert.deepEqual(w.map((x) => x.text), ["⟳ 1", "⚠ quota 92%", "⚠ disk 7%"]);
  assert.deepEqual(w.map((x) => x.key), ["pipelines", "quota", "disk"]);
  assert.ok(w.every((x) => typeof x.tip === "string" && x.tip));
  assert.deepEqual(warningsFor({ sample: { diskFree: 7, at: 0 }, gitState: null, quotaTop: { p: 89 }, now: 31000 }), []);
});
test("warningsFor: stale quota and null inputs are quiet", () => {
  assert.deepEqual(warningsFor({ sample: null, gitState: null, quotaTop: { p: 99, stale: true }, now: 1 }), []);
  assert.deepEqual(warningsFor({ sample: null, gitState: null, quotaTop: null, now: 1 }), []);
});
test("sampleCommand prints a parseable line on this machine", () => {
  const { command, args } = sampleCommand();
  assert.equal(command, "node");
  const out = execFileSync(command, args, { encoding: "utf8", timeout: 10000 });
  const s = parseSample(out, 1);
  assert.ok(s);
  assert.ok(s.diskFree === null || (s.diskFree >= 0 && s.diskFree <= 100));
});
