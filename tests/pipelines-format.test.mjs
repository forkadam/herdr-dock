import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, duration } from "../src/mods/dock-pipelines/format.js";

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
