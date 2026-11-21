import test from "node:test";
import assert from "node:assert/strict";
import {
  liveRight, planRight, railClick, rightActiveOf, rightFromConfig, rightShownOf, rightStateFromShared,
} from "../src/shared/panel.js";

const F = [{ mod: "mission-control-github" }, { mod: "files" }, { mod: "changes" }];
const cmds = (actions) => actions.map((a) => `${a.command} ${JSON.stringify(a.args)}`);

test("liveRight reads whether the panel is shown and which block the stack shows", () => {
  const tree = { id: "root", children: [{ id: "dock-right", hidden: true, children: [
    { id: "dock-right-stack", active: "dock-right-1-files", children: [] }] }] };
  assert.deepEqual(liveRight(tree), { column: false, active: "dock-right-1-files" });
  assert.deepEqual(liveRight({ id: "root" }), { column: false, active: null });
});

test("rightActiveOf falls back to the first mod for a missing or removed one", () => {
  assert.equal(rightActiveOf("files", F), "files");
  assert.equal(rightActiveOf("gone", F), "mission-control-github");
  assert.equal(rightActiveOf(undefined, F), "mission-control-github");
  assert.equal(rightActiveOf("files", []), null);
});

test("rightShownOf: this PC's choice, else the config default", () => {
  assert.equal(rightShownOf(true, { right: { hidden: true } }), true);
  assert.equal(rightShownOf(undefined, { right: { hidden: false } }), true);
  assert.equal(rightShownOf(undefined, { right: { hidden: true } }), false);
  assert.equal(rightShownOf(undefined, null), false);
});

test("railClick: another mod shows it, the showing mod hides the panel", () => {
  assert.deepEqual(railClick(false, "files", "files"), { shown: true, active: "files" });
  assert.deepEqual(railClick(true, "files", "changes"), { shown: true, active: "changes" });
  assert.deepEqual(railClick(true, "files", "files"), { shown: false, active: "files" });
});

test("planRight selects then shows, hides, or does nothing when settled", () => {
  const off = { column: false, active: "dock-right-0-mission-control-github" };
  assert.deepEqual(cmds(planRight({ shown: true, active: "files", features: F, live: off })), [
    'layout.select {"stack":"dock-right-stack","child":"dock-right-1-files"}',
    'layout.show {"id":"dock-right"}',
  ]);
  const on = { column: true, active: "dock-right-1-files" };
  assert.deepEqual(cmds(planRight({ shown: true, active: "files", features: F, live: on })), []);
  assert.deepEqual(cmds(planRight({ shown: false, active: "files", features: F, live: on })), ['layout.hide {"id":"dock-right"}']);
  assert.deepEqual(cmds(planRight({ shown: false, active: "files", features: F, live: off })), []);
  // No right mods: no panel to drive.
  assert.deepEqual(cmds(planRight({ shown: true, active: null, features: [], live: { column: false, active: null } })), []);
});

test("rightFromConfig: a changed config default applies once, a first read keeps the person's choice", () => {
  assert.equal(rightFromConfig(true, false, true), null);
  assert.deepEqual(rightFromConfig(null, true, true), { record: true, shown: null });
  assert.deepEqual(rightFromConfig(null, undefined, true), { record: true, shown: false });
  assert.deepEqual(rightFromConfig(true, false, false), { record: false, shown: true });
});

test("rightStateFromShared reads this PC's state for a layout rewrite", () => {
  assert.deepEqual(rightStateFromShared({ "dock.right.shown": false, "dock.right.active": "changes" }),
    { rightShown: false, active: "changes" });
  assert.deepEqual(rightStateFromShared(null), { rightShown: undefined, active: undefined });
  assert.deepEqual(rightStateFromShared({ "dock.right.shown": "yes", "dock.right.active": 3 }), { rightShown: undefined, active: undefined });
});

// dock-core decides the right panel state from the NEW config before building the layout file,
// so the file it writes already matches what the panel should be (no extra rewrite or flicker).
import { rightConfigUpdate } from "../src/shared/panel.js";
import { buildLayout } from "../src/shared/layout.js";
const merged = (hidden, mods) => ({ regions: {
  top: { features: [{ mod: "dock-core" }], hidden: false }, left: { features: [], mode: "expanded", hidden: false },
  right: { size: 360, hidden, features: mods.map((mod) => ({ mod })) }, bottom: { features: [], hidden: false } } });

test("rightConfigUpdate: a first load with nothing saved follows the config, like deploy", () => {
  const m = merged(false, ["files", "changes"]);
  const u = rightConfigUpdate({ prev: null, merged: m, saved: {} });
  assert.deepEqual(u.set, { "dock.right.configHidden": false, "dock.right.shown": true });
  assert.deepEqual(u.state, { rightShown: true, active: undefined });
  assert.equal(JSON.stringify(buildLayout(m, u.state)), JSON.stringify(buildLayout(m, rightStateFromShared({}))));
});

test("rightConfigUpdate: a newly placed right mod is shown and active", () => {
  const u = rightConfigUpdate({ prev: merged(true, ["files"]), merged: merged(true, ["files", "g"]),
    saved: { shown: false, active: "files", configHidden: true } });
  assert.deepEqual(u.set, { "dock.right.active": "g", "dock.right.shown": true });
  assert.deepEqual(u.state, { rightShown: true, active: "g" });
});

test("rightConfigUpdate: a changed config default applies; an unchanged one keeps this PC's choice", () => {
  let u = rightConfigUpdate({ prev: merged(true, ["files"]), merged: merged(false, ["files"]),
    saved: { shown: false, active: "files", configHidden: true } });
  assert.deepEqual(u.set, { "dock.right.configHidden": false, "dock.right.shown": true });
  assert.equal(u.state.rightShown, true);
  u = rightConfigUpdate({ prev: merged(true, ["files"]), merged: merged(true, ["files"]),
    saved: { shown: true, active: "files", configHidden: true } });
  assert.deepEqual(u.set, {});
  assert.deepEqual(u.state, { rightShown: true, active: "files" });
});

test("rightConfigUpdate: removing or reordering mods opens nothing", () => {
  const u = rightConfigUpdate({ prev: merged(true, ["files", "changes"]), merged: merged(true, ["changes"]),
    saved: { shown: false, active: "files", configHidden: true } });
  assert.deepEqual(u.set, {});
  assert.equal(u.state.rightShown, false);
});
