import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planApply, parseConfig, mergeForHost } from "../src/shared/config.js";
import { buildLayout } from "../src/shared/layout.js";

test("planApply writes only when changed and keeps last good on error", () => {
  const good = readFileSync("tests/fixtures/dock.json", "utf8");
  const first = planApply(good, "h", null, null);
  assert.ok(first.write); assert.equal(first.error, null);
  assert.equal(planApply(good, "h", first.write, first.merged).write, null);
  const bad = planApply("{", "h", first.write, first.merged);
  assert.equal(bad.write, null); assert.match(bad.error, /JSON/); assert.equal(bad.merged, first.merged);
});

test("planApply output matches what deploy writes (pretty JSON + newline)", () => {
  const good = readFileSync("tests/fixtures/dock.json", "utf8");
  const expected = JSON.stringify(buildLayout(mergeForHost(parseConfig(good).config, "h")), null, 2) + "\n";
  assert.equal(planApply(good, "h", null, null).write, expected);
});

test("planApply rewrites on a size change and reports schema errors", () => {
  const good = readFileSync("tests/fixtures/dock.json", "utf8");
  const first = planApply(good, "h", null, null);
  const wider = JSON.parse(good); wider.regions.left.size = 300;
  const next = planApply(JSON.stringify(wider), "h", first.write, first.merged);
  assert.ok(next.write); assert.equal(next.merged.regions.left.size, 300);
  const bad = planApply(JSON.stringify({ v: 1, regions: { middle: {} } }), "h", first.write, first.merged);
  assert.equal(bad.write, null); assert.match(bad.error, /unknown region/); assert.equal(bad.merged, first.merged);
});

test("planApply with a missing config keeps last good", () => {
  const r = planApply(null, "h", "x", null);
  assert.equal(r.write, null); assert.ok(r.error); assert.equal(r.merged, null);
});

test("planApply merges the local file's text over the config", () => {
  const good = readFileSync("tests/fixtures/dock.json", "utf8");
  const local = JSON.stringify({ v: 1, regions: { left: { size: 333 } } });
  const r = planApply(good, "h", null, null, {}, local);
  assert.equal(r.error, null); assert.equal(r.merged.regions.left.size, 333);
  const expected = JSON.stringify(buildLayout(mergeForHost(parseConfig(good).config, "h", JSON.parse(local))), null, 2) + "\n";
  assert.equal(r.write, expected);
  assert.equal(planApply(good, "h", null, null, {}, null).merged.regions.left.size, parseConfig(good).config.regions.left.size);
});

test("planApply with an invalid local file reports it and keeps last good (never merges it)", () => {
  const good = readFileSync("tests/fixtures/dock.json", "utf8");
  const first = planApply(good, "h", null, null);
  for (const bad of ["{", JSON.stringify({ v: 1, regions: { middle: {} } })]) {
    const r = planApply(good, "h", first.write, first.merged, {}, bad);
    assert.equal(r.write, null); assert.match(r.error, /herdr-dock\/local\.json/); assert.equal(r.merged, first.merged);
  }
});
