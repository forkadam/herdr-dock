import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { HERDR_KEY, SAMPLE_KEY, herdrSampleCommand, herdrUsage, parseHerdrProcs, sampleCommand, parseSample, warningsFor, macUsedPercent } from "../src/shared/system.js";

test("SAMPLE_KEY", () => assert.equal(SAMPLE_KEY, "dock.system.sample"));
test("parseSample: good line is clamped and rounded", () => {
  assert.deepEqual(parseSample('{"cpu":34.4,"mem":61.6,"diskFree":7.2}\n', 5), { cpu: 34, mem: 62, diskFree: 7, cores: null, at: 5 });
  assert.deepEqual(parseSample('{"cpu":140,"mem":-3,"diskFree":null}', 1), { cpu: 100, mem: 0, diskFree: null, cores: null, at: 1 });
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

test("parseSample keeps cores", () => {
  assert.equal(parseSample('{"cpu":1,"mem":2,"diskFree":3,"cores":8}', 1).cores, 8);
  assert.equal(parseSample('{"cpu":1,"mem":2,"cores":"x"}', 1).cores, null);
});
test("HERDR_KEY", () => assert.equal(HERDR_KEY, "dock.system.herdr"));
test("parseHerdrProcs: windows lines are summed", () => {
  const out = "herdr-app,10,160000000,5000\r\nherdr-core,11,40000000,1500\r\n";
  assert.deepEqual(parseHerdrProcs("windows", out), { cpuMs: 6500, mem: 200000000 });
});
test("parseHerdrProcs: mac ps line", () => {
  const out = "  123  163840 1:02.50 /Applications/Herdr.app/Contents/MacOS/herdr-app\n  9 100 0:01.00 /usr/bin/other\n";
  assert.deepEqual(parseHerdrProcs("macos", out), { cpuMs: 62500, mem: 163840 * 1024 });
});
test("parseHerdrProcs: linux hh:mm:ss and dd-hh:mm:ss", () => {
  assert.deepEqual(parseHerdrProcs("linux", "1 1024 01:02:03 /opt/herdr/herdr-core\n"), { cpuMs: 3723000, mem: 1048576 });
  assert.equal(parseHerdrProcs("linux", "1 1024 1-00:00:01 herdr-core\n").cpuMs, 86401000);
});
test("parseHerdrProcs: ignores non-herdr, empty is null", () => {
  assert.equal(parseHerdrProcs("linux", "1 1024 00:00:01 /usr/bin/node\n"), null);
  assert.equal(parseHerdrProcs("windows", "node,1,5,5\n"), null);
  assert.equal(parseHerdrProcs("windows", ""), null);
  assert.equal(parseHerdrProcs("windows", "herdr-app,x,y,z\n"), null);
});
test("herdrUsage: no previous sample gives cpu null", () => {
  assert.deepEqual(herdrUsage(null, { cpuMs: 5, mem: 7 }, 10000, 4, 9), { cpu: null, mem: 7, at: 9 });
});
test("herdrUsage: clamps to 0-100", () => {
  assert.equal(herdrUsage({ cpuMs: 500 }, { cpuMs: 100, mem: 1 }, 10000, 4, 1).cpu, 0);
  assert.equal(herdrUsage({ cpuMs: 0 }, { cpuMs: 1e9, mem: 1 }, 10000, 4, 1).cpu, 100);
});
test("herdrUsage: 1000 ms over 10 s on 4 cores is 2.5", () => {
  assert.deepEqual(herdrUsage({ cpuMs: 0 }, { cpuMs: 1000, mem: 5 }, 10000, 4, 2), { cpu: 2.5, mem: 5, at: 2 });
});
test("herdrUsage: a small share keeps one decimal", () => {
  assert.equal(herdrUsage({ cpuMs: 0 }, { cpuMs: 300, mem: 1 }, 10000, 32, 1).cpu, 0.1);
});
test("herdrSampleCommand runs on this machine and parses (skips without herdr)", (t) => {
  const platform = { win32: "windows", darwin: "macos" }[process.platform] ?? "linux";
  const { command, args } = herdrSampleCommand(platform);
  const out = execFileSync(command, args, { encoding: "utf8", timeout: 10000 });
  const r = parseHerdrProcs(platform, out);
  if (!r) return t.skip("no herdr process running");
  assert.ok(r.mem > 0 && r.cpuMs >= 0);
});

// A real macOS `vm_stat` (16 KiB pages). Activity Monitor's "Memory Used" = app memory (anonymous minus
// purgeable) + wired + compressed: (258839 - 9157 + 125468 + 176870) × 16384 = 9.04 GB of 16 GiB → 53%.
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3264.
Pages active:                            178383.
Pages inactive:                          175936.
Pages speculative:                         2236.
Pages throttled:                              0.
Pages wired down:                        125468.
Pages purgeable:                           9157.
"Translation faults":                 1056195046.
Pages copy-on-write:                   38693958.
File-backed pages:                       97716.
Anonymous pages:                         258839.
Pages stored in compressor:              592316.
Pages occupied by compressor:            176870.
`;
const GIB16 = 16 * 2 ** 30;

test("macUsedPercent: app memory + wired + compressed, like Activity Monitor", () => {
  assert.equal(macUsedPercent(VM_STAT, GIB16), 53);
});

test("macUsedPercent: falls back to active + wired + compressed without anonymous pages; null on junk", () => {
  const noAnon = VM_STAT.split("\n").filter((l) => !l.startsWith("Anonymous") && !l.startsWith("Pages purgeable")).join("\n");
  assert.equal(macUsedPercent(noAnon, GIB16), Math.round(100 * (178383 + 125468 + 176870) * 16384 / GIB16));
  assert.equal(macUsedPercent("", GIB16), null);
  assert.equal(macUsedPercent(VM_STAT, 0), null);
  assert.equal(macUsedPercent("Pages wired down: 5.", GIB16), null); // no page size line
});

test("parseSample: on macOS the memory comes from vm_stat, not freemem", () => {
  const line = JSON.stringify({ cpu: 10, mem: 97, diskFree: 40, cores: 8, vm: VM_STAT, total: GIB16 });
  assert.equal(parseSample(line, 1).mem, 53);
  // vm_stat unreadable → keep the freemem figure
  assert.equal(parseSample(JSON.stringify({ cpu: 10, mem: 97, diskFree: 40, cores: 8, vm: "", total: GIB16 }), 1).mem, 97);
});

test("warningsFor: the quota tip names the limit and when it resets", () => {
  const now = 1_000_000;
  const tip = (top) => warningsFor({ sample: null, gitState: null, quotaTop: { p: 91, at: now, ...top }, now })[0].tip;
  assert.equal(tip({ what: "Antigravity 5-hour", resetsMs: now + (3 * 60 + 27) * 60_000 }), "Antigravity 5-hour limit at 91% · resets in 3h 27m");
  assert.equal(tip({ what: "Claude weekly" }), "Claude weekly limit at 91%");
  assert.equal(tip({}), "Agent quota at 91%");
});
