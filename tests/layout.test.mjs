import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfig, mergeForHost } from "../src/shared/config.js";
import { buildLayout, leftFeatureIds } from "../src/shared/layout.js";

const find = (t, id) => {
  if (t.id === id) return t;
  for (const c of t.children ?? []) {
    const r = find(c, id);
    if (r) return r;
  }
  return undefined;
};
const allIds = (t) => [t.id, ...(t.children ?? []).flatMap(allIds)];

test("buildLayout places features with ids, props and sizes", () => {
  const m = mergeForHost(parseConfig(readFileSync("tests/fixtures/dock.json", "utf8")).config, "nohost");
  const t = buildLayout(m);
  const left = find(t, "dock-left");
  assert.deepEqual(left.children.map((c) => c.id),
    ["dock-left-0-dock-spaces", "dock-left-1-dock-agents", "dock-left-2-dock-quotas"]);
  assert.deepEqual(left.children[2].size, { px: 150 });
  assert.deepEqual(left.children[0].size, { weight: 1 });
  assert.equal(left.children[0].min, 32);
  assert.equal(left.children[0].content.props.dockFeature, "dock-left-0-dock-spaces");
  assert.equal(left.children[0].content.props.dockRegion, "left");
  assert.equal(find(t, "dock-top").window_drag, true);
  assert.equal(find(t, "dock-main").content.tab, "active");
  assert.equal(find(t, "dock-right"), undefined);
});
test("left mode hidden sets hidden on the column", () => {
  const m = mergeForHost(parseConfig('{"v":1,"regions":{"top":{"features":[{"mod":"dock-core"}]},"left":{"mode":"hidden","features":[{"mod":"x"}]}}}').config, "h");
  assert.equal(find(buildLayout(m), "dock-left").hidden, true);
});
test("ids are unique even with the same mod twice", () => {
  const m = mergeForHost(parseConfig('{"v":1,"regions":{"top":{"features":[{"mod":"dock-core"}]},"right":{"features":[{"mod":"x"},{"mod":"x"}]}}}').config, "h");
  const ids = allIds(buildLayout(m));
  assert.equal(new Set(ids).size, ids.length);
});
test("buildLayout is deterministic", () => {
  const m = mergeForHost(parseConfig(readFileSync("tests/fixtures/dock.json", "utf8")).config, "h");
  assert.equal(JSON.stringify(buildLayout(m)), JSON.stringify(buildLayout(m)));
});
test("leftFeatureIds lists left block ids in order", () => {
  const m = mergeForHost(parseConfig(readFileSync("tests/fixtures/dock.json", "utf8")).config, "h");
  assert.deepEqual(leftFeatureIds(m),
    ["dock-left-0-dock-spaces", "dock-left-1-dock-agents", "dock-left-2-dock-quotas"]);
});

test("tree is aligned like Herdr's main layout", () => {
  const cfg = parseConfig(readFileSync("tests/fixtures/dock.json", "utf8")).config;
  const m = mergeForHost({ ...cfg, regions: { ...cfg.regions, right: { size: 360, features: [{ mod: "x" }] } } }, "h");
  const t = buildLayout(m);
  assert.equal(t.type, "row");
  assert.deepEqual(t.children.map((c) => c.id), ["dock-left", "dock-work"]);
  const work = t.children[1];
  assert.equal(work.type, "column");
  assert.deepEqual(work.children.map((c) => c.id), ["dock-top", "dock-body", "dock-bottom"]);
  const body = work.children[1];
  assert.deepEqual(body.children.map((c) => c.id), ["dock-main", "dock-right"]);
  assert.equal(body.padding, 8);
  assert.equal(body.gap, 8);
  assert.equal(find(t, "dock-main").padding, undefined);
});
test("default config shows workspace-status bottom and a 44px dock-core", () => {
  const m = mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "h");
  const t = buildLayout(m);
  const bottom = find(t, "dock-bottom");
  assert.equal(bottom.hidden, undefined);
  assert.equal(bottom.children[0].content.mod, "workspace-status");
  assert.deepEqual(find(t, "dock-top").children[0].size, { px: 44 });
});

test("default left panel starts with dock-header (Herdr's header without its collapse button), which drags the window", () => {
  const m = mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "nohost");
  const left = find(buildLayout(m), "dock-left");
  const header = left.children[0];
  assert.equal(header.id, "dock-left-0-dock-header");
  assert.deepEqual(header.size, { px: 46 });
  assert.equal(header.window_drag, true);
  assert.equal(left.children[1].window_drag, undefined);
});
