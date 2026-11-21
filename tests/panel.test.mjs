import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfig, mergeForHost } from "../src/shared/config.js";
import { buildLayout } from "../src/shared/layout.js";
import { nextMode, planPanel, planSync, liveSizes, sizeChanges, modeFromConfig } from "../src/shared/panel.js";

const merged = () => mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "h");
const S = "dock-left-0-dock-spaces", A = "dock-left-1-dock-agents", Q = "dock-left-2-dock-quotas";
const resizes = (actions) => actions.filter((a) => a.command === "layout.resize");
const resizeOf = (actions, id) => resizes(actions).find((a) => a.args.id === id)?.args;
// A live left column the person dragged to 320 px with Agents at 400 px.
const dragged = () => ({ px: 320, sizes: { [S]: { weight: 1 }, [A]: { px: 400 }, [Q]: { px: 150 } } });

test("nextMode cycles", () => {
  assert.equal(nextMode("expanded"), "icons");
  assert.equal(nextMode("icons"), "hidden");
  assert.equal(nextMode("hidden"), "expanded");
});
test("nextMode from a focused expanded panel goes to plain expanded first", () => {
  assert.equal(nextMode("expanded", A), "expanded");
  assert.equal(nextMode("expanded", null), "icons");
  assert.equal(nextMode("icons", A), "hidden");
});

test("first sync in expanded sends no resize", () => {
  const p = planPanel({ mode: "expanded", focus: null, merged: merged(), live: dragged(), restore: null, changes: null });
  assert.deepEqual(resizes(p.actions), []);
  assert.deepEqual(p.actions[0], { command: "layout.show", args: { id: "dock-left" } });
  assert.equal(p.restore, null);
});
test("hidden only hides and keeps the saved sizes", () => {
  const saved = dragged();
  const p = planPanel({ mode: "hidden", focus: null, merged: merged(), live: null, restore: saved, changes: null });
  assert.deepEqual(p.actions, [{ command: "layout.hide", args: { id: "dock-left" } }]);
  assert.deepEqual(p.restore, saved);
});
test("icons saves the person's sizes before shrinking to the rail", () => {
  const p = planPanel({ mode: "icons", focus: null, merged: merged(), live: dragged(), restore: null, changes: null });
  assert.deepEqual(p.actions.at(-1), { command: "layout.resize", args: { id: "dock-left", px: 48 } });
  assert.deepEqual(p.restore, dragged());
});
test("icons with sizes already saved keeps them (the live tree is the rail)", () => {
  const p = planPanel({ mode: "icons", focus: null, merged: merged(), live: { px: 48, sizes: {} }, restore: dragged(), changes: null });
  assert.deepEqual(p.restore, dragged());
});
test("user width restored after icons -> expanded", () => {
  const p = planPanel({ mode: "expanded", focus: null, merged: merged(), live: { px: 48, sizes: {} }, restore: dragged(), changes: null });
  assert.deepEqual(resizeOf(p.actions, "dock-left"), { id: "dock-left", px: 320 });
  assert.deepEqual(resizeOf(p.actions, A), { id: A, px: 400 });
  assert.deepEqual(resizeOf(p.actions, S), { id: S, weight: 1 });
  assert.equal(p.restore, null);
});
test("a rail-width live tree is never saved as the person's width", () => {
  const p = planPanel({ mode: "icons", focus: null, merged: merged(), live: { px: 48, sizes: {} }, restore: null, changes: null });
  assert.equal(p.restore.px, 268);
  assert.deepEqual(p.restore.sizes[Q], { px: 150 });
});
test("plain expanded stuck at the rail with nothing saved goes back to the config width", () => {
  const p = planPanel({ mode: "expanded", focus: null, merged: merged(), live: { px: 48, sizes: {} }, restore: null, changes: null });
  assert.deepEqual(resizeOf(p.actions, "dock-left"), { id: "dock-left", px: 268 });
});
test("focus saves sizes, keeps the panel width and collapses the others", () => {
  const p = planPanel({ mode: "expanded", focus: A, merged: merged(), live: dragged(), restore: null, changes: null });
  assert.deepEqual(resizeOf(p.actions, "dock-left"), { id: "dock-left", px: 320 });
  assert.deepEqual(resizeOf(p.actions, A), { id: A, weight: 1 });
  assert.deepEqual(resizeOf(p.actions, S), { id: S, px: 32 });
  assert.deepEqual(p.restore, dragged());
  // Unfocusing restores what was saved.
  const back = planPanel({ mode: "expanded", focus: null, merged: merged(), live: null, restore: p.restore, changes: null });
  assert.deepEqual(resizeOf(back.actions, A), { id: A, px: 400 });
  assert.equal(back.restore, null);
});
test("icons hides third-party left blocks, expanded shows them", () => {
  const m = merged();
  m.regions.left.features.push({ mod: "thirdparty" });
  const id = "dock-left-3-thirdparty";
  const icons = planPanel({ mode: "icons", focus: null, merged: m, live: null, restore: null, changes: null }).actions;
  assert.ok(icons.some((a) => a.command === "layout.hide" && a.args.id === id));
  assert.ok(!icons.some((a) => a.command === "layout.hide" && a.args.id === S));
  const exp = planPanel({ mode: "expanded", focus: null, merged: m, live: null, restore: null, changes: null }).actions;
  assert.ok(exp.some((a) => a.command === "layout.show" && a.args.id === id));
});
test("config size change -> resize to the new config value", () => {
  const p = planPanel({ mode: "expanded", focus: null, merged: merged(), live: dragged(), restore: null,
    changes: { px: 300, sizes: { [Q]: { px: 200 } } } });
  assert.deepEqual(resizeOf(p.actions, "dock-left"), { id: "dock-left", px: 300 });
  assert.deepEqual(resizeOf(p.actions, Q), { id: Q, px: 200 });
  assert.equal(resizeOf(p.actions, A), undefined);
});
test("config size change while in icons updates the saved sizes", () => {
  const p = planPanel({ mode: "icons", focus: null, merged: merged(), live: { px: 48, sizes: {} }, restore: dragged(),
    changes: { px: 300, sizes: {} } });
  assert.equal(p.restore.px, 300);
  assert.deepEqual(p.restore.sizes[A], { px: 400 });
});

test("sizeChanges lists only changed config sizes", () => {
  const a = merged(), b = merged();
  assert.equal(sizeChanges(null, b), null);
  assert.equal(sizeChanges(a, b), null);
  b.regions.left.size = 300;
  b.regions.left.features[2] = { mod: "dock-quotas", size: 200 };
  b.regions.left.features[0] = { mod: "dock-spaces", size: 100 };
  assert.deepEqual(sizeChanges(a, b), { px: 300, sizes: { [S]: { px: 100 }, [Q]: { px: 200 } } });
  const c = merged(); c.regions.left.features[2] = { mod: "dock-quotas" };
  assert.deepEqual(sizeChanges(a, c), { sizes: { [Q]: { weight: 1 } } });
});
test("liveSizes reads the left column from a layout tree", () => {
  const m = merged();
  const tree = buildLayout(m);
  assert.deepEqual(liveSizes(tree, m), { px: 268, sizes: { [S]: { weight: 1 }, [A]: { weight: 1 }, [Q]: { px: 150 } } });
  assert.equal(liveSizes({ id: "root", children: [] }, m), null);
  assert.equal(liveSizes(undefined, m), null);
});

test("modeFromConfig applies a changed config mode", () => {
  assert.equal(modeFromConfig("expanded", "expanded", "expanded"), null);
  assert.deepEqual(modeFromConfig("expanded", "expanded", "icons"), { record: "icons", mode: "icons" });
  assert.deepEqual(modeFromConfig("icons", "expanded", "hidden"), { record: "hidden", mode: "hidden" });
  // Nothing recorded yet: a mode the person chose stays; with none either, the config's applies.
  assert.deepEqual(modeFromConfig(undefined, "icons", "expanded"), { record: "expanded", mode: null });
  assert.deepEqual(modeFromConfig(undefined, undefined, "icons"), { record: "icons", mode: "icons" });
});

const ids = [S, A];
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
  assert.equal(planSync({ mode: "icons", focus: ids[0], leftIds: ids, applied: "icons|null" }), null);
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
