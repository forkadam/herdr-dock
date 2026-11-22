import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "herdr-statusline-cache.mjs");

function runWith(home, input) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  return spawnSync(process.execPath, [SCRIPT], { input, env, encoding: "utf8" });
}
const cacheOf = (home) => JSON.parse(readFileSync(join(home, ".claude", "statusline-cache", "claude-statusline.json"), "utf8"));
const SESSION = "0123456789abcdef";

test("writes context % and the 5-hour/weekly windows, like the Python helper", () => {
  const home = mkdtempSync(join(tmpdir(), "slc-"));
  const event = {
    session_id: SESSION,
    context_window: { used_percentage: 42 },
    rate_limits: { five_hour: { used_percentage: 28, resets_at: 1900000000 }, seven_day: { used_percent: 8, resets_at: 1900000000000 } },
  };
  const r = runWith(home, "﻿﻿" + JSON.stringify(event)); // PowerShell can prefix BOMs
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  const c = cacheOf(home);
  assert.equal(c.provider, "claude");
  assert.equal(c.source, "claude-statusline");
  assert.equal(c.session_contexts[SESSION].used_percent, 42);
  assert.equal(c.session_contexts[SESSION].cache.session_id, SESSION);
  assert.deepEqual(c.windows, [
    { kind: "five_hour", used_percent: 28, remaining_percent: 72, resets_at: 1900000000 },
    { kind: "weekly", used_percent: 8, remaining_percent: 92, resets_at: 1900000000 }, // ms → s
  ]);
});

test("keeps the previous windows (and their time) when an update has none; drops old sessions", () => {
  const home = mkdtempSync(join(tmpdir(), "slc-"));
  const dir = join(home, ".claude", "statusline-cache");
  mkdirSync(dir, { recursive: true });
  const now = Date.now() / 1000;
  writeFileSync(join(dir, "claude-statusline.json"), JSON.stringify({
    provider: "claude", source: "claude-statusline", fetched_at_unix: 1000,
    windows: [{ kind: "weekly", used_percent: 5, remaining_percent: 95, resets_at: null }],
    session_contexts: {
      old: { used_percent: 1, cache: { session_id: "old", last_activity_unix: now - 8 * 86400 } },
      kept: { used_percent: 2, cache: { session_id: "kept", last_activity_unix: now - 60 } },
    },
  }));
  runWith(home, JSON.stringify({ session_id: SESSION, context_window: { used_percentage: 10 } }));
  const c = cacheOf(home);
  assert.deepEqual(c.windows, [{ kind: "weekly", used_percent: 5, remaining_percent: 95, resets_at: null }]);
  assert.equal(c.fetched_at_unix, 1000);
  assert.deepEqual(Object.keys(c.session_contexts).sort(), ["0123456789abcdef", "kept"]);
});

test("never fails the status line: bad input, a bad session id and an unwritable cache all exit 0 silently", () => {
  const home = mkdtempSync(join(tmpdir(), "slc-"));
  for (const input of ["not json", "{}", JSON.stringify({ session_id: "short" }), ""]) {
    const r = runWith(home, input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, "");
  }
  assert.equal(existsSync(join(home, ".claude", "statusline-cache", "claude-statusline.json")), false);
  // A file where the cache folder should be: writing fails, still exit 0.
  const home2 = mkdtempSync(join(tmpdir(), "slc-"));
  mkdirSync(join(home2, ".claude"), { recursive: true });
  writeFileSync(join(home2, ".claude", "statusline-cache"), "x");
  const r = runWith(home2, JSON.stringify({ session_id: SESSION, context_window: { used_percentage: 1 } }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
});

test("--tee writes the input back unchanged (also when it isn't JSON) and still caches", () => {
  const home = mkdtempSync(join(tmpdir(), "slc-"));
  const input = JSON.stringify({ session_id: SESSION, context_window: { used_percentage: 5 } });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const r = spawnSync(process.execPath, [SCRIPT, "--tee"], { input, env, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, input);
  assert.equal(cacheOf(home).session_contexts[SESSION].used_percent, 5);
  const bad = spawnSync(process.execPath, [SCRIPT, "--tee"], { input: "not json", env, encoding: "utf8" });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, "not json");
});
