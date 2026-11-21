import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planApply, parseConfig, mergeForHost } from "../src/shared/config.js";
import { buildLayout } from "../src/shared/layout.js";

test("planApply writes only when changed and keeps last good on error", () => {
  const good = readFileSync("config/dock.json", "utf8");
  const first = planApply(good, "h", null, null);
  assert.ok(first.write); assert.equal(first.error, null);
  assert.equal(planApply(good, "h", first.write, first.merged).write, null);
  const bad = planApply("{", "h", first.write, first.merged);
  assert.equal(bad.write, null); assert.match(bad.error, /JSON/); assert.equal(bad.merged, first.merged);
});

test("planApply output matches what deploy writes (pretty JSON + newline)", () => {
  const good = readFileSync("config/dock.json", "utf8");
  const expected = JSON.stringify(buildLayout(mergeForHost(parseConfig(good).config, "h")), null, 2) + "\n";
  assert.equal(planApply(good, "h", null, null).write, expected);
});

test("planApply rewrites on a size change and reports schema errors", () => {
  const good = readFileSync("config/dock.json", "utf8");
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
