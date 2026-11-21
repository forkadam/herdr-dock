import test from "node:test";
import assert from "node:assert/strict";
import { codexSessionDirs, newestRollout, parseCodexUsage } from "../src/shared/codex.js";
import { listFilesCommand, parseFileListing } from "../src/shared/platform.js";

const line = (ts, rl) => JSON.stringify({ timestamp: ts, type: "event_msg", payload: { type: "token_count", info: null, rate_limits: rl } });
const NOW = Date.parse("2026-11-22T12:00:00Z");

test("codexSessionDirs: today's and the 7 previous days' folders, newest first (local and UTC dates both covered)", () => {
  const dirs = codexSessionDirs("C:/Users/a/.codex", NOW);
  assert.ok(dirs.length >= 8 && dirs.length <= 9);
  assert.ok(dirs.every((d) => /^C:\/Users\/a\/\.codex\/sessions\/\d{4}\/\d{2}\/\d{2}$/.test(d)));
  assert.ok(dirs.includes("C:/Users/a/.codex/sessions/2026/11/22") || dirs.includes("C:/Users/a/.codex/sessions/2026/11/21"));
  assert.equal(new Set(dirs).size, dirs.length);
});

test("newestRollout picks the latest rollout-*.jsonl by name", () => {
  assert.equal(newestRollout(["rollout-2026-11-21T09-00-00-aaa.jsonl", "notes.txt", "rollout-2026-11-21T17-30-02-bbb.jsonl"]),
    "rollout-2026-11-21T17-30-02-bbb.jsonl");
  assert.equal(newestRollout(["x.json"]), null);
  assert.equal(newestRollout([]), null);
});

test("parseCodexUsage: the last rate_limits wins; 300/10080-minute windows map to 5-hour/weekly", () => {
  const text = [
    line("2026-11-22T11:00:00Z", { primary: { used_percent: 5, window_minutes: 300, resets_in_seconds: 100 } }),
    "{ not json",
    line("2026-11-22T11:59:00Z", {
      primary: { used_percent: 15.5, window_minutes: 300, resets_in_seconds: 3600 },
      secondary: { used_percent: 31, window_minutes: 10080, resets_at: 1900000000 },
    }),
    JSON.stringify({ timestamp: "2026-11-22T11:59:30Z", type: "event_msg", payload: { type: "agent_message", message: "hi" } }),
  ].join("\n");
  const u = parseCodexUsage(text, NOW);
  assert.equal(u.fetchedMs, Date.parse("2026-11-22T11:59:00Z"));
  assert.equal(u.stale, false);
  assert.deepEqual(u.windows, [
    { kind: "five_hour", usedPercent: 15.5, resetsMs: Date.parse("2026-11-22T11:59:00Z") + 3600 * 1000 },
    { kind: "weekly", usedPercent: 31, resetsMs: 1900000000 * 1000 },
  ]);
});

test("parseCodexUsage: unknown window lengths fall back to primary=5-hour, secondary=weekly; old data is stale", () => {
  const text = line("2026-11-22T10:00:00Z", {
    primary: { used_percent: 1, window_minutes: 299 }, secondary: { used_percent: 2 },
  });
  const u = parseCodexUsage(text, NOW);
  assert.deepEqual(u.windows.map((w) => [w.kind, w.usedPercent, w.resetsMs]), [["five_hour", 1, null], ["weekly", 2, null]]);
  assert.equal(u.stale, true);
});

test("parseCodexUsage: nothing usable gives null", () => {
  assert.equal(parseCodexUsage("", NOW), null);
  assert.equal(parseCodexUsage(null, NOW), null);
  assert.equal(parseCodexUsage(line("2026-11-22T11:00:00Z", null), NOW), null);
  assert.equal(parseCodexUsage(line("2026-11-22T11:00:00Z", { primary: { used_percent: 140 } }), NOW), null);
});

test("listFilesCommand / parseFileListing: files only, per platform", () => {
  assert.deepEqual(listFilesCommand("windows", "C:/Users/a/.codex/sessions/2026/11/22"),
    { command: "cmd", args: ["/c", "dir", "/b", "/a-d", "C:\\Users\\a\\.codex\\sessions\\2026\\11\\22"] });
  assert.deepEqual(listFilesCommand("linux", "/home/a/x"), { command: "ls", args: ["-1", "-p", "/home/a/x"] });
  assert.deepEqual(parseFileListing("windows", "a.jsonl\r\nb.jsonl\r\n\r\n"), ["a.jsonl", "b.jsonl"]);
  assert.deepEqual(parseFileListing("macos", "sub/\na.jsonl\n"), ["a.jsonl"]);
});
