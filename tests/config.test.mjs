import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, mergeForHost, DEFAULT_CONFIG } from "../src/shared/config.js";

test("parseConfig rejects bad JSON with a message", () => {
  const r = parseConfig("{ \"v\": 1, "); assert.equal(r.ok, false); assert.match(r.error, /JSON/);
});
test("parseConfig rejects unknown region and wrong version", () => {
  assert.match(parseConfig('{"v":1,"regions":{"middle":{}}}').error, /middle/);
  assert.match(parseConfig('{"v":2,"regions":{}}').error, /version/);
});
test("parseConfig rejects a feature without mod and a bad left mode", () => {
  assert.equal(parseConfig('{"v":1,"regions":{"left":{"features":[{}]}}}').ok, false);
  assert.equal(parseConfig('{"v":1,"regions":{"left":{"mode":"tiny"}}}').ok, false);
});
test("parseConfig rejects non-positive-integer size", () => {
  assert.match(parseConfig('{"v":1,"regions":{"left":{"size":0}}}').error, /regions\.left\.size/);
  assert.equal(parseConfig('{"v":1,"regions":{"left":{"size":1.5}}}').ok, false);
});
test("mergeForHost applies override case-insensitively; arrays replace", () => {
  const c = parseConfig(JSON.stringify({ v: 1,
    regions: { left: { size: 268, features: [{ mod: "dock-spaces" }, { mod: "dock-agents" }] } },
    machines: { "ForkAdam-PC": { regions: { left: { size: 300, features: [{ mod: "dock-quotas" }] } } } } })).config;
  const m = mergeForHost(c, "forkadam-pc");
  assert.equal(m.regions.left.size, 300);
  assert.deepEqual(m.regions.left.features, [{ mod: "dock-quotas" }]);
  assert.equal(m.regions.left.mode, "expanded");
  assert.deepEqual(m.regions.right.features, []);
  assert.equal(m.regions.right.hidden, false);
  assert.equal("machines" in m, false);
});
test("mergeForHost without a matching host returns the base", () => {
  const c = parseConfig(JSON.stringify({ v: 1, regions: { left: { size: 268 } } })).config;
  assert.equal(mergeForHost(c, "other").regions.left.size, 268);
});
test("mergeForHost validates-free: an override of an invalid shape is rejected at parse", () => {
  const r = parseConfig(JSON.stringify({ v: 1, regions: {}, machines: { x: { regions: { nope: {} } } } }));
  assert.equal(r.ok, false); assert.match(r.error, /nope/);
});
test("DEFAULT_CONFIG has no machines and the shipped config parses", async () => {
  assert.equal("machines" in DEFAULT_CONFIG, false);
  const { readFileSync } = await import("node:fs");
  const r = parseConfig(readFileSync(new URL("../config/dock.json", import.meta.url), "utf8"));
  assert.equal(r.ok, true);
});
test("mergeForHost treats left.hidden: true as mode hidden", () => {
  const c = parseConfig(JSON.stringify({ v: 1, regions: { left: { hidden: true, mode: "expanded" } } })).config;
  assert.equal(mergeForHost(c, "h").regions.left.mode, "hidden");
  const d = parseConfig(JSON.stringify({ v: 1, regions: { left: { hidden: false, mode: "icons" } } })).config;
  assert.equal(mergeForHost(d, "h").regions.left.mode, "icons");
});
