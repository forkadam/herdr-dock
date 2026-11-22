// Claude's limits from the claude CLI (get_usage, as /usage shows them): the helper and the pure model.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { CLI_STALE_MS, mergeClaude, paceOf, parseUsageOutput, planLabel } from "../src/shared/claude-usage.js";

const HELPER = join(import.meta.dirname, "..", "scripts", "herdr-claude-usage.mjs");
const FAKE = join(import.meta.dirname, "fixtures", "claude", "fake-claude.mjs");
const runHelper = (env = {}) => spawnSync(process.execPath, [HELPER], { encoding: "utf8", timeout: 30000,
  env: { ...process.env, HERDR_DOCK_CLAUDE: `${process.execPath} ${FAKE}`, ...env } });
const NOW = Date.parse("2026-11-22T14:00:00Z");

test("helper: asks the CLI and prints only the limits (one JSON line), nothing else from the answer", () => {
  const r = runHelper();
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.plan, "team");
  assert.deepEqual(Object.keys(out.limits).sort(), ["five_hour", "model_scoped", "seven_day", "seven_day_opus", "seven_day_sonnet"]);
  assert.deepEqual(out.limits.five_hour, { utilization: 14, resets_at: "2026-11-22T16:09:59.773743+00:00" });
  assert.ok(!r.stdout.includes("secret") && !r.stdout.includes("spend"));
});

test("helper: an error answer, no claude, and a claude that never answers all end with ok:false", () => {
  assert.match(JSON.parse(runHelper({ FAKE_CLAUDE: "error" }).stdout).error, /not logged in/);
  const missing = JSON.parse(runHelper({ HERDR_DOCK_CLAUDE: "/nonexistent/claude" }).stdout);
  assert.equal(missing.ok, false);
  const t = Date.now();
  const silent = JSON.parse(runHelper({ FAKE_CLAUDE: "silent", HERDR_DOCK_CLAUDE_TIMEOUT_MS: "1500" }).stdout);
  assert.equal(silent.ok, false);
  assert.match(silent.error, /no answer/);
  assert.ok(Date.now() - t < 10000);
});

test("parseUsageOutput: windows with durations, model windows, the plan", () => {
  const r = parseUsageOutput(runHelper().stdout, NOW);
  assert.equal(r.source, "cli");
  assert.equal(r.plan, "team");
  assert.equal(r.fetchedMs, NOW);
  assert.deepEqual(r.windows.map((w) => [w.kind, w.label ?? null, w.usedPercent]),
    [["five_hour", null, 14], ["weekly", null, 20], ["model", "Sonnet", 5], ["model", "Fable", 0]]);
  assert.equal(r.windows[0].resetsMs, Date.parse("2026-11-22T16:09:59.773743+00:00"));
  assert.equal(r.windows[0].durationMs, 5 * 3600e3);
  assert.equal(r.windows[1].durationMs, 7 * 86400e3);
  assert.equal(r.windows[3].durationMs, 7 * 86400e3);
  assert.equal(parseUsageOutput('{"ok":false,"error":"x"}', NOW), null);
  assert.equal(parseUsageOutput("junk", NOW), null);
  assert.equal(parseUsageOutput("", NOW), null);
});

test("mergeClaude: the CLI's reading, with a fresher status line's 5-hour and weekly numbers", () => {
  const cli = { source: "cli", plan: "team", fetchedMs: NOW - 4 * 60e3, stale: false, windows: [
    { kind: "five_hour", usedPercent: 14, resetsMs: 1, durationMs: 5 * 3600e3 },
    { kind: "weekly", usedPercent: 20, resetsMs: 2, durationMs: 7 * 86400e3 },
    { kind: "model", label: "Fable", usedPercent: 0, resetsMs: 3, durationMs: 7 * 86400e3 }] };
  const sl = { fetchedMs: NOW - 30e3, stale: false, windows: [{ kind: "five_hour", usedPercent: 18, resetsMs: 1 }, { kind: "weekly", usedPercent: 21, resetsMs: 2 }] };
  const m = mergeClaude(cli, sl, NOW);
  assert.deepEqual(m.windows.map((w) => [w.kind, w.usedPercent]), [["five_hour", 18], ["weekly", 21], ["model", 0]]);
  assert.equal(m.windows[0].durationMs, 5 * 3600e3);
  assert.equal(m.plan, "team");
  assert.equal(m.fetchedMs, NOW - 30e3);
  // An older status line doesn't override the CLI.
  assert.equal(mergeClaude(cli, { ...sl, fetchedMs: NOW - 10 * 60e3 }, NOW).windows[0].usedPercent, 14);
  // Either alone.
  assert.equal(mergeClaude(null, sl, NOW).windows[0].usedPercent, 18);
  assert.equal(mergeClaude(cli, null, NOW).windows[2].label, "Fable");
  assert.equal(mergeClaude(null, null, NOW), null);
  // A CLI reading goes stale only after CLI_STALE_MS (it's asked every few minutes, not live).
  assert.equal(mergeClaude({ ...cli, fetchedMs: NOW - CLI_STALE_MS - 1 }, null, NOW).stale, true);
  assert.equal(mergeClaude(cli, null, NOW).stale, false);
});

test("paceOf: how much of the window's time has passed (the tick)", () => {
  const w = { durationMs: 5 * 3600e3, resetsMs: NOW + 3600e3 };
  assert.equal(paceOf(w, NOW), 0.8);
  assert.equal(paceOf({ ...w, resetsMs: NOW + 6 * 3600e3 }, NOW), 0);
  assert.equal(paceOf({ ...w, resetsMs: NOW - 1 }, NOW), 1);
  assert.equal(paceOf({ resetsMs: NOW }, NOW), null);
  assert.equal(paceOf({ durationMs: 5, resetsMs: null }, NOW), null);
});

test("planLabel", () => {
  assert.equal(planLabel("team"), "Team");
  assert.equal(planLabel("max"), "Max");
  assert.equal(planLabel("claude_max_20x"), "Max 20x");
  assert.equal(planLabel(null), null);
  assert.equal(planLabel(""), null);
});
