// Antigravity's limits through its status line: the writer (scripts/herdr-agy-statusline.mjs, run by agy with its
// state on stdin) and the reading Quotas makes of its cache (src/shared/antigravity.js).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AGY_CACHE_REL, AGY_STALE_MS, parseAgyCache } from "../src/shared/antigravity.js";

const WRITER = join(import.meta.dirname, "..", "scripts", "herdr-agy-statusline.mjs");
const PAYLOAD = readFileSync(new URL("./fixtures/antigravity/statusline.json", import.meta.url), "utf8");
const write = (home, input, args = []) => spawnSync(process.execPath, [WRITER, ...args], { input, encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
const cacheOf = (home) => JSON.parse(readFileSync(join(home, AGY_CACHE_REL), "utf8"));

test("writer: keeps the plan and the quota buckets only, prints nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    const r = write(home, PAYLOAD);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    const c = cacheOf(home);
    assert.equal(c.provider, "antigravity");
    assert.equal(c.plan, "Google AI Pro");
    assert.ok(c.fetched_at_unix > 0);
    assert.deepEqual(Object.keys(c.buckets).sort(), ["3p-5h", "3p-weekly", "gemini-5h", "gemini-argon-wtu-weekly", "gemini-weekly"]);
    assert.deepEqual(c.buckets["gemini-5h"], { remaining_fraction: 0.9698667, reset_time: "2026-11-22T20:05:03Z" });
    const text = readFileSync(join(home, AGY_CACHE_REL), "utf8");
    for (const leak of ["cwd", "transcript", "/home/u", "workspace"]) assert.ok(!text.includes(leak), leak);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("writer: a payload without quota keeps the last buckets; junk never breaks it; --tee passes the input through", () => {
  const home = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    write(home, PAYLOAD);
    const before = cacheOf(home);
    write(home, JSON.stringify({ ...JSON.parse(PAYLOAD), quota: undefined }));
    assert.deepEqual(cacheOf(home).buckets, before.buckets);
    assert.equal(write(home, "not json").status, 0);
    const t = write(home, PAYLOAD, ["--tee"]);
    assert.equal(t.stdout, PAYLOAD);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("parseAgyCache: Gemini 5-hour and weekly always, other buckets once used; the plan; stale after a while", () => {
  const now = Date.parse("2026-11-22T15:10:00Z");
  const cache = (buckets) => JSON.stringify({ provider: "antigravity", source: "agy-statusline", plan: "Google AI Pro", fetched_at_unix: now / 1000 - 60, buckets });
  const r = parseAgyCache(cache({
    "gemini-5h": { remaining_fraction: 0.9698667, reset_time: "2026-11-22T20:05:03Z" },
    "gemini-weekly": { remaining_fraction: 0.98, reset_time: "2026-11-29T15:05:03Z" },
    "3p-5h": { remaining_fraction: 1, reset_time: "2026-11-22T20:15:16Z" },
    "3p-weekly": { remaining_fraction: 0.5, reset_time: "2026-11-29T15:15:16Z" },
    "gemini-argon-wtu-weekly": { remaining_fraction: 1, reset_time: "2026-11-29T15:15:16Z" },
  }), now);
  assert.equal(r.plan, "Google AI Pro");
  assert.equal(r.source, "agy-statusline");
  assert.equal(r.stale, false);
  assert.deepEqual(r.windows.map((w) => [w.kind, w.label ?? null, w.short ?? null, Math.round(w.usedPercent)]),
    [["five_hour", null, null, 3], ["weekly", null, null, 2], ["bucket", "other models weekly", "3p wk", 50]]);
  assert.equal(r.windows[0].durationMs, 5 * 3600e3);
  assert.equal(r.windows[2].durationMs, 7 * 86400e3);
  assert.equal(r.windows[0].resetsMs, Date.parse("2026-11-22T20:05:03Z"));
  assert.equal(parseAgyCache(cache({ "gemini-5h": { remaining_fraction: 1, reset_time: null } }), now + AGY_STALE_MS + 60e3).stale, true);
  // An unknown bucket in use shows under its own name.
  const u = parseAgyCache(cache({ "gemini-ultra-daily": { remaining_fraction: 0.25, reset_time: null } }), now);
  assert.deepEqual(u.windows.map((w) => [w.label, Math.round(w.usedPercent)]), [["gemini-ultra-daily", 75]]);
  assert.equal(parseAgyCache("junk", now), null);
  assert.equal(parseAgyCache(cache({}), now), null);
});
