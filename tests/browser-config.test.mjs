import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, parseLocal, mergeForHost, mergeWithLocal } from "../src/shared/config.js";
import { browserOf, DEFAULT_BROWSER } from "../src/shared/browser/config.js";

const BASE = { v: 1, regions: { top: { features: [{ mod: "dock-core" }] }, right: { features: [{ mod: "dock-files" }] } } };
const cfg = (extra) => JSON.stringify({ ...BASE, ...extra });
const withBrowser = (browser, regions = BASE.regions) => parseConfig(JSON.stringify({ ...BASE, regions, browser })).config;
const has = (m, name) => Object.values(m.regions).some((r) => r.features.some((f) => f.mod === name));

test("defaults when absent", () => {
  const m = mergeForHost(parseConfig(cfg({})).config, "pc");
  assert.deepEqual(browserOf(m), { enabled: false, chrome: "", production: [], handoffMinutes: 15 });
  assert.deepEqual(DEFAULT_BROWSER, browserOf(m));
  assert.ok(!m.regions.right.features.some((f) => f.mod === "dock-browser"));
});
test("enabled adds dock-browser after the right region's features", () => {
  const m = mergeForHost(withBrowser({ enabled: true }), "pc");
  assert.equal(m.regions.right.features.at(-1).mod, "dock-browser");
  assert.equal(m.regions.right.features.length, 2);
});
test("enabled keeps a user-placed dock-browser where it is", () => {
  const regions = { top: BASE.regions.top, right: { features: [{ mod: "dock-browser" }, { mod: "dock-files" }] } };
  const m = mergeForHost(withBrowser({ enabled: true }, regions), "pc");
  assert.deepEqual(m.regions.right.features.map((f) => f.mod), ["dock-browser", "dock-files"]);
});
test("disabled removes a listed dock-browser", () => {
  const regions = { top: BASE.regions.top, right: { features: [{ mod: "dock-browser" }, { mod: "dock-files" }] } };
  const m = mergeForHost(withBrowser({ enabled: false }, regions), "pc");
  assert.ok(!has(m, "dock-browser"));
  assert.equal(m.regions.right.features.length, 1);
});
test("machines section and local file override key by key", () => {
  const c = parseConfig(JSON.stringify({ ...BASE, browser: { enabled: true, chrome: "a" }, machines: { pc: { browser: { chrome: "b" } } } })).config;
  assert.equal(browserOf(mergeForHost(c, "pc")).chrome, "b");
  assert.equal(browserOf(mergeForHost(c, "pc")).enabled, true);
});
test("local file overrides chrome per machine", () => {
  const local = parseLocal(JSON.stringify({ v: 1, browser: { chrome: "/usr/bin/chromium" } })).local;
  assert.equal(browserOf(mergeWithLocal(withBrowser({ enabled: true }), "pc", local)).chrome, "/usr/bin/chromium");
});
test("an invalid local browser is ignored by mergeWithLocal", () => {
  const m = mergeWithLocal(withBrowser({ enabled: true }), "pc", { v: 1, browser: { enabled: "yes" } });
  assert.equal(browserOf(m).enabled, true);
});
test("validation", () => {
  assert.match(parseConfig(cfg({ browser: { enabled: "yes" } })).error, /^browser\.enabled: must be true or false/);
  assert.match(parseConfig(cfg({ browser: { production: ["ok.com", 3] } })).error, /^browser\.production\[1\]: must be a host pattern/);
  assert.match(parseConfig(cfg({ browser: { production: ["https://x.com"] } })).error, /^browser\.production\[0\]: must be a host pattern/);
  assert.match(parseConfig(cfg({ browser: { handoffMinutes: 0 } })).error, /^browser\.handoffMinutes: must be a positive integer/);
  assert.match(parseConfig(cfg({ browser: { chrome: 1 } })).error, /^browser\.chrome: must be a string/);
  assert.match(parseConfig(cfg({ browser: { other: 1 } })).error, /^browser\.other: unknown setting/);
  assert.match(parseConfig(cfg({ browser: [] })).error, /^browser: must be an object/);
  assert.equal(parseConfig(cfg({ browser: { production: ["*.corp.com", "localhost", "10.0.0.1"] } })).ok, true);
  assert.match(parseConfig(cfg({ machines: { pc: { browser: { enabled: 1 } } } })).error, /^machines\.pc\.browser\.enabled: /);
  assert.match(parseLocal(JSON.stringify({ v: 1, browser: { enabled: 1 } })).error, /browser\.enabled: must be true or false/);
});
