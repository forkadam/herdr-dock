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
  const m = mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "nohost");
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
  const m = mergeForHost(parseConfig('{"v":1,"regions":{"left":{"mode":"hidden","features":[{"mod":"x"}]}}}').config, "h");
  assert.equal(find(buildLayout(m), "dock-left").hidden, true);
});
test("ids are unique even with the same mod twice", () => {
  const m = mergeForHost(parseConfig('{"v":1,"regions":{"right":{"features":[{"mod":"x"},{"mod":"x"}]}}}').config, "h");
  const ids = allIds(buildLayout(m));
  assert.equal(new Set(ids).size, ids.length);
});
test("buildLayout is deterministic", () => {
  const m = mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "h");
  assert.equal(JSON.stringify(buildLayout(m)), JSON.stringify(buildLayout(m)));
});
test("leftFeatureIds lists left block ids in order", () => {
  const m = mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "h");
  assert.deepEqual(leftFeatureIds(m),
    ["dock-left-0-dock-spaces", "dock-left-1-dock-agents", "dock-left-2-dock-quotas"]);
});
