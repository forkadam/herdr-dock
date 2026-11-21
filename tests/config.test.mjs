import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, mergeForHost, DEFAULT_CONFIG } from "../src/shared/config.js";

// The smallest valid top bar: dock-core holds the panel toggle, the key and config errors.
const TOP = { features: [{ mod: "dock-core" }] };

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
    regions: { top: TOP, left: { size: 268, features: [{ mod: "dock-spaces" }, { mod: "dock-agents" }] } },
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
  const c = parseConfig(JSON.stringify({ v: 1, regions: { top: TOP, left: { size: 268 } } })).config;
  assert.equal(mergeForHost(c, "other").regions.left.size, 268);
});
test("mergeForHost validates-free: an override of an invalid shape is rejected at parse", () => {
  const r = parseConfig(JSON.stringify({ v: 1, regions: { top: TOP }, machines: { x: { regions: { nope: {} } } } }));
  assert.equal(r.ok, false); assert.match(r.error, /nope/);
});
test("DEFAULT_CONFIG has no machines and the shipped config parses", async () => {
  assert.equal("machines" in DEFAULT_CONFIG, false);
  const { readFileSync } = await import("node:fs");
  const r = parseConfig(readFileSync(new URL("../config/dock.json", import.meta.url), "utf8"));
  assert.equal(r.ok, true);
});
test("mergeForHost treats left.hidden: true as mode hidden", () => {
  const c = parseConfig(JSON.stringify({ v: 1, regions: { top: TOP, left: { hidden: true, mode: "expanded" } } })).config;
  assert.equal(mergeForHost(c, "h").regions.left.mode, "hidden");
  const d = parseConfig(JSON.stringify({ v: 1, regions: { top: TOP, left: { hidden: false, mode: "icons" } } })).config;
  assert.equal(mergeForHost(d, "h").regions.left.mode, "icons");
});

test("parseConfig rejects core features outside regions.left, naming the key", () => {
  for (const mod of ["dock-spaces", "dock-agents", "dock-quotas"]) {
    const r = parseConfig(JSON.stringify({ v: 1, regions: { top: TOP, right: { features: [{ mod }] } } }));
    assert.equal(r.ok, false, mod);
    assert.ok(r.error.includes("regions.right.features[0].mod"), r.error);
    assert.ok(r.error.includes("regions.left"), r.error);
  }
  const m = parseConfig(JSON.stringify({ v: 1, regions: { top: TOP }, machines: { pc: { regions: { bottom: { features: [{ mod: "dock-quotas" }] } } } } }));
  assert.ok(m.error.includes("machines.pc.regions.bottom.features[0].mod"), m.error);
  assert.equal(parseConfig(JSON.stringify({ v: 1, regions: { top: TOP, right: { features: [{ mod: "files" }] } } })).ok, true);
});
test("parseConfig rejects a hidden top bar and a top bar without dock-core", () => {
  const hidden = parseConfig(JSON.stringify({ v: 1, regions: { top: { ...TOP, hidden: true } } }));
  assert.equal(hidden.ok, false); assert.ok(hidden.error.includes("regions.top.hidden"), hidden.error); assert.ok(hidden.error.includes("dock-core"), hidden.error);
  const none = parseConfig(JSON.stringify({ v: 1, regions: { top: { features: [{ mod: "tabs" }] } } }));
  assert.equal(none.ok, false); assert.ok(none.error.includes("regions.top.features"), none.error); assert.ok(none.error.includes("Ctrl+Alt+B"), none.error);
  assert.equal(parseConfig(JSON.stringify({ v: 1, regions: {} })).ok, false);
  const over = parseConfig(JSON.stringify({ v: 1, regions: { top: TOP }, machines: { pc: { regions: { top: { features: [] } } } } }));
  assert.ok(over.error.includes("machines.pc.regions.top.features"), over.error);
  const overHidden = parseConfig(JSON.stringify({ v: 1, regions: { top: TOP }, machines: { pc: { regions: { top: { hidden: true } } } } }));
  assert.ok(overHidden.error.includes("machines.pc.regions.top.hidden"), overHidden.error);
  // A machine section that leaves the top bar alone is fine.
  assert.equal(parseConfig(JSON.stringify({ v: 1, regions: { top: TOP }, machines: { pc: { regions: { left: { size: 300 } } } } })).ok, true);
});
