import test from "node:test";
import assert from "node:assert/strict";
import { liveRight, planRight, rightFromConfig } from "../src/shared/panel.js";

const cmds = (plan) => plan.actions.map((a) => `${a.command} ${JSON.stringify(a.args)}`);
const SHOW_COL = 'layout.show {"id":"dock-right"}';
const HIDE_COL = 'layout.hide {"id":"dock-right"}';
const SHOW_PANEL = 'layout.show {"id":"panel"}';
const HIDE_PANEL = 'layout.hide {"id":"panel"}';
const select = (child) => `layout.select {"stack":"panel-body","child":"${child}"}`;
const mem = (shown = false, active = "files") => ({ shown, active });

test("liveRight reads the column, the panel and the active tab", () => {
  const tree = { id: "root", children: [{ id: "dock-right", hidden: true, children: [
    { id: "panel", children: [{ id: "panel-body", active: "changes" }] }] }] };
  assert.deepEqual(liveRight(tree), { column: false, panel: true, active: "changes" });
  assert.deepEqual(liveRight({ id: "root" }), { column: false, panel: false, active: null });
});

test("toggle on with mods: show the column, keep the panel closed unless it was open", () => {
  const p = planRight({ shown: true, hasFeatures: true, live: { column: false, panel: false, active: "files" }, prev: null, memory: mem() });
  assert.deepEqual(cmds(p), [SHOW_COL]);
  assert.equal(p.shown, true);
  const q = planRight({ shown: true, hasFeatures: true, live: { column: false, panel: false, active: "files" }, prev: null, memory: mem(true, "changes") });
  assert.deepEqual(cmds(q), [select("changes"), SHOW_PANEL, SHOW_COL]);
});

test("toggle on with no mods opens Files/Changes on the last tab", () => {
  const p = planRight({ shown: true, hasFeatures: false, live: { column: false, panel: false, active: "files" }, prev: null, memory: mem(false, "changes") });
  assert.deepEqual(cmds(p), [select("changes"), SHOW_PANEL, SHOW_COL]);
});

test("toggle off hides the column and the panel, remembering the panel was open", () => {
  const live = { column: true, panel: true, active: "changes" };
  const p = planRight({ shown: false, hasFeatures: true, live, prev: live, memory: mem() });
  // Panel first: a hidden column with a visible panel would read as "the tab bar opened it".
  assert.deepEqual(cmds(p), [HIDE_PANEL, HIDE_COL]);
  assert.deepEqual(p.memory, { shown: true, active: "changes" });
  assert.equal(p.shown, false);
});

test("the tab bar opening Files while the column is hidden shows the column", () => {
  const prev = { column: false, panel: false, active: "files" };
  const live = { column: false, panel: true, active: "files" };
  const p = planRight({ shown: false, hasFeatures: true, live, prev, memory: mem() });
  assert.equal(p.shown, true);
  assert.deepEqual(cmds(p), [SHOW_COL]);
});

test("closing Files/Changes with no mods in the column hides the column", () => {
  const prev = { column: true, panel: true, active: "files" };
  const live = { column: true, panel: false, active: "files" };
  const p = planRight({ shown: true, hasFeatures: false, live, prev, memory: mem(true) });
  assert.equal(p.shown, false);
  assert.deepEqual(cmds(p), [HIDE_COL]);
  assert.deepEqual(p.memory, { shown: false, active: "files" });
});

test("closing Files/Changes with mods keeps the column", () => {
  const prev = { column: true, panel: true, active: "files" };
  const live = { column: true, panel: false, active: "files" };
  const p = planRight({ shown: true, hasFeatures: true, live, prev, memory: mem(true) });
  assert.equal(p.shown, true);
  assert.deepEqual(cmds(p), []);
});

test("a settled state plans nothing", () => {
  const live = { column: true, panel: false, active: "files" };
  assert.deepEqual(cmds(planRight({ shown: true, hasFeatures: true, live, prev: live, memory: mem() })), []);
  const off = { column: false, panel: false, active: "files" };
  assert.deepEqual(cmds(planRight({ shown: false, hasFeatures: true, live: off, prev: off, memory: mem(true) })), []);
});

test("rightFromConfig: a changed config default applies once, a first read keeps the person's choice", () => {
  assert.equal(rightFromConfig(true, false, true), null);
  assert.deepEqual(rightFromConfig(null, true, true), { record: true, shown: null });
  assert.deepEqual(rightFromConfig(null, undefined, true), { record: true, shown: false });
  assert.deepEqual(rightFromConfig(true, false, false), { record: false, shown: true });
});
