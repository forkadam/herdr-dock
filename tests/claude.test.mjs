import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSession, parseStatusline, formatPercent, formatAge, formatReset, contextEntry, keepEntry } from "../src/shared/claude.js";

const SID = "73636264-03cb-4b62-bb2d-36ccfbcbee15";
const rec = (o) => JSON.stringify({ pid: 16604, sessionId: SID,
  kind: "interactive", startedAt: 1_000_000, pidDomain: "win32:forkadam-pc", ...o });
test("matchSession accepts a live record in the terminal's lifetime", () => {
  assert.equal(matchSession(rec(), { pid: 16604 }, 999_000, 2_000_000), SID);
});
test("matchSession rejects wrong pid, non-interactive, older than terminal, missing", () => {
  assert.equal(matchSession(rec({ pid: 1 }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession(rec({ kind: "bg" }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession(rec({ startedAt: 100 }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession(null, { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession("{oops", { pid: 16604 }, 999_000, 2_000_000), null);
});
test("matchSession boundaries, uuid check, case", () => {
  assert.equal(matchSession(rec({ startedAt: 994_000 }), { pid: 16604 }, 999_000, 2_000_000), SID);
  assert.equal(matchSession(rec({ startedAt: 993_999 }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession(rec({ startedAt: 2_060_000 }), { pid: 16604 }, 999_000, 2_000_000), SID);
  assert.equal(matchSession(rec({ startedAt: 2_060_001 }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession(rec({ sessionId: "not-a-uuid" }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession(rec({ sessionId: SID.toUpperCase() }), { pid: 16604 }, 999_000, 2_000_000), SID);
  assert.equal(matchSession(rec({ startedAt: "x" }), { pid: 16604 }, 999_000, 2_000_000), null);
  assert.equal(matchSession("[]", { pid: 16604 }, 999_000, 2_000_000), null);
});
const cache = { provider: "claude", source: "claude-statusline", fetched_at_unix: 1000,
  session_contexts: { "s1": { used_percent: 31, cache: { session_id: "s1", last_activity_unix: 990 } } },
  windows: [{ kind: "five_hour", used_percent: 5, remaining_percent: 95, resets_at: 8200 },
            { kind: "weekly", used_percent: 1, remaining_percent: 99, resets_at: 600000 },
            { kind: "monthly", used_percent: 9 }] };
test("parseStatusline reads sessions and known windows", () => {
  const s = parseStatusline(JSON.stringify(cache), 1_000_000 + 30_000);
  assert.equal(s.sessions.get("s1").usedPercent, 31);
  assert.equal(s.sessions.get("s1").stale, false);
  assert.deepEqual(s.windows.map((w) => [w.kind, w.usedPercent, w.resetsMs]),
    [["five_hour", 5, 8_200_000], ["weekly", 1, 600_000_000]]);
});
test("parseStatusline marks stale and rejects foreign files", () => {
  assert.equal(parseStatusline(JSON.stringify(cache), 1_000_000 + 600_000).stale, true);
  assert.equal(parseStatusline(JSON.stringify({ ...cache, provider: "codex" }), 0), null);
  assert.equal(parseStatusline(JSON.stringify({ ...cache, source: "x" }), 0), null);
  assert.equal(parseStatusline(null, 0), null);
  assert.equal(parseStatusline("{oops", 0), null);
});
test("parseStatusline: per-session staleness, null reset, float seconds, missing parts", () => {
  const c = { ...cache, fetched_at_unix: 1000.5,
    session_contexts: { a: { used_percent: 1, cache: { last_activity_unix: 800 } }, b: { used_percent: 2 } },
    windows: [{ kind: "five_hour", used_percent: 5, resets_at: null }] };
  const s = parseStatusline(JSON.stringify(c), 1_000_500 + 1000);
  assert.equal(s.fetchedMs, 1_000_500);
  assert.equal(s.stale, false);
  assert.equal(s.sessions.get("a").stale, true);
  assert.equal(s.sessions.get("b").stale, true);
  assert.equal(s.windows[0].resetsMs, null);
  const e = parseStatusline(JSON.stringify({ provider: "claude", source: "claude-statusline", fetched_at_unix: 1 }), 5000);
  assert.equal(e.sessions.size, 0);
  assert.deepEqual(e.windows, []);
});
test("formatters", () => {
  assert.equal(formatPercent(30.6), "31% used");
  assert.equal(formatAge(30_000), "just now"); assert.equal(formatAge(5 * 60_000), "5m ago");
  assert.equal(formatAge(2 * 3600_000), "2h ago");
  assert.equal(formatAge(3 * 86400_000), "3d ago");
  assert.equal(formatReset(1000 + (2 * 60 + 5) * 60_000, 1000), "resets in 2h 05m");
  assert.equal(formatReset(1000 + (3 * 24 + 4) * 3600_000, 1000), "resets in 3d 4h");
  assert.equal(formatReset(1000 + 45 * 60_000, 1000), "resets in 45m");
  assert.equal(formatReset(500, 1000), "resetting");
});

const cacheText = (id, act, pct = 47) => JSON.stringify({ provider: "claude", source: "claude-statusline",
  fetched_at_unix: act, session_contexts: { [id]: { used_percent: pct, cache: { last_activity_unix: act } } } });

test("parseStatusline looks sessions up case-insensitively (uppercase cache key)", () => {
  const p = parseStatusline(cacheText(SID.toUpperCase(), 1_000), 1_000_000);
  assert.equal(p.sessions.get(SID).usedPercent, 47);
});

const info = (o) => ({ foreground: { pid: 16604 }, created_ms: 999_000, ...o });
test("contextEntry: matched fresh session gives its identity and reading", () => {
  const cache = parseStatusline(cacheText(SID, 1_990), 2_000_000);
  assert.deepEqual(contextEntry(info(), rec(), cache, 2_000_000),
    { pid: 16604, createdMs: 999_000, sessionId: SID, usedPercent: 47, seenMs: 1_990_000, stale: false });
});
test("contextEntry: a stale reading is kept, marked stale", () => {
  const cache = parseStatusline(cacheText(SID, 1_000), 2_000_000);
  assert.equal(contextEntry(info(), rec(), cache, 2_000_000).stale, true);
});
test("contextEntry: nothing without identity, match, cache or session", () => {
  const cache = parseStatusline(cacheText(SID, 1_990), 2_000_000);
  assert.equal(contextEntry(null, rec(), cache, 2_000_000), null);
  assert.equal(contextEntry(info({ foreground: null }), rec(), cache, 2_000_000), null);
  assert.equal(contextEntry(info({ created_ms: "x" }), rec(), cache, 2_000_000), null);
  assert.equal(contextEntry(info(), rec({ pid: 1 }), cache, 2_000_000), null);
  assert.equal(contextEntry(info(), rec(), null, 2_000_000), null);
  const other = parseStatusline(cacheText("11111111-2222-3333-4444-555555555555", 1_990), 2_000_000);
  assert.equal(contextEntry(info(), rec(), other, 2_000_000), null);
});
test("keepEntry: keep only while hc reports the same pid and created_ms", () => {
  const prev = { pid: 16604, createdMs: 999_000 };
  assert.equal(keepEntry(prev, info()), true);
  assert.equal(keepEntry(prev, info({ foreground: { pid: 1 } })), false); // Claude restarted
  assert.equal(keepEntry(prev, info({ created_ms: 5 })), false); // a new terminal at the address
  assert.equal(keepEntry(prev, info({ foreground: null })), false);
  assert.equal(keepEntry(prev, null), false);
  assert.equal(keepEntry(null, info()), false);
});
