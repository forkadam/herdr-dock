import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfig, mergeForHost } from "../src/shared/config.js";
import { nextMode, panelActions, planSync } from "../src/shared/panel.js";

const merged = () => mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "h");

test("nextMode cycles", () => {
  assert.equal(nextMode("expanded"), "icons");
  assert.equal(nextMode("icons"), "hidden");
  assert.equal(nextMode("hidden"), "expanded");
});
test("panelActions for icons and hidden", () => {
  const m = merged();
  assert.deepEqual(panelActions("hidden", m, null), [{ command: "layout.hide", args: { id: "dock-left" } }]);
  assert.deepEqual(panelActions("icons", m, null).at(-1), { command: "layout.resize", args: { id: "dock-left", px: 48 } });
});
test("icons hides third-party left blocks, expanded shows them", () => {
  const m = merged();
  m.regions.left.features.push({ mod: "thirdparty" });
  const id = "dock-left-3-thirdparty";
  assert.ok(panelActions("icons", m, null).some((a) => a.command === "layout.hide" && a.args.id === id));
  assert.ok(!panelActions("icons", m, null).some((a) => a.command === "layout.hide" && a.args.id === "dock-left-0-dock-spaces"));
  assert.ok(panelActions("expanded", m, null).some((a) => a.command === "layout.show" && a.args.id === id));
});
test("panelActions expanded with focus collapses the others", () => {
  const m = merged();
  const a = panelActions("expanded", m, "dock-left-1-dock-agents");
  assert.deepEqual(a.find((x) => x.args.id === "dock-left-1-dock-agents").args, { id: "dock-left-1-dock-agents", weight: 1 });
  assert.deepEqual(a.find((x) => x.args.id === "dock-left-0-dock-spaces").args, { id: "dock-left-0-dock-spaces", px: 32 });
});
test("panelActions expanded without focus restores configured sizes", () => {
  const a = panelActions("expanded", merged(), null);
  const resize = (id) => a.find((x) => x.command === "layout.resize" && x.args.id === id).args;
  assert.deepEqual(resize("dock-left"), { id: "dock-left", px: 268 });
  assert.deepEqual(resize("dock-left-2-dock-quotas"), { id: "dock-left-2-dock-quotas", px: 150 });
  assert.deepEqual(resize("dock-left-0-dock-spaces"), { id: "dock-left-0-dock-spaces", weight: 1 });
});

const ids = ["dock-left-0-dock-spaces", "dock-left-1-dock-agents"];
test("planSync returns null when nothing changed", () => {
  assert.equal(planSync({ mode: "expanded", focus: null, leftIds: ids, applied: "expanded|null" }), null);
  assert.equal(planSync({ mode: "expanded", focus: ids[1], leftIds: ids, applied: `expanded|${ids[1]}` }), null);
});
test("planSync keeps a focus while expanded", () => {
  assert.deepEqual(planSync({ mode: "expanded", focus: ids[1], leftIds: ids, applied: "expanded|null" }),
    { key: `expanded|${ids[1]}`, focus: ids[1], clearFocus: false });
});
test("planSync ignores focus while icons and keeps a pending request", () => {
  assert.deepEqual(planSync({ mode: "icons", focus: ids[0], leftIds: ids, applied: "expanded|null" }),
    { key: "icons|null", focus: null, clearFocus: false });
  // Feature set focus while already in icons: nothing to do, request waits for "expanded".
  assert.equal(planSync({ mode: "icons", focus: ids[0], leftIds: ids, applied: "icons|null" }), null);
  // Then sets expanded: the focus is applied and kept.
  assert.deepEqual(planSync({ mode: "expanded", focus: ids[0], leftIds: ids, applied: "icons|null" }),
    { key: `expanded|${ids[0]}`, focus: ids[0], clearFocus: false });
});
test("planSync treats an unknown focus id as none and clears it", () => {
  assert.deepEqual(planSync({ mode: "expanded", focus: "nope", leftIds: ids, applied: null }),
    { key: "expanded|null", focus: null, clearFocus: true });
});
test("planSync clears focus when the mode changes away from a focused expanded panel", () => {
  assert.deepEqual(planSync({ mode: "hidden", focus: ids[1], leftIds: ids, applied: `expanded|${ids[1]}` }),
    { key: "hidden|null", focus: null, clearFocus: true });
});
