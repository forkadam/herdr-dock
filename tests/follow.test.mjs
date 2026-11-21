import test from "node:test";
import assert from "node:assert/strict";
import { followLocation, selectedLocation } from "../src/shared/follow.js";

const STATE = { repos: [
  { id: "r1", machine: null, worktrees: [{ id: "|d:/work/api", path: "D:/work/api" }] },
  { id: "r2", machine: "devbox", worktrees: [{ id: "devbox|/home/u/web", path: "/home/u/web" }] },
] };
const term = (cwd) => ({ cwd, on: null });

test("selectedLocation finds a listed worktree's folder and machine", () => {
  assert.deepEqual(selectedLocation(STATE, "|d:/work/api"), { cwd: "D:/work/api", on: null });
  assert.deepEqual(selectedLocation(STATE, "devbox|/home/u/web"), { cwd: "/home/u/web", on: "devbox" });
  assert.equal(selectedLocation(STATE, "gone"), null);
  assert.equal(selectedLocation(null, "|d:/work/api"), null);
});

test("at startup the panels follow the focused terminal, even with a selection", () => {
  const r = followLocation(null, { focus: term("D:/x"), selected: "|d:/work/api", state: STATE });
  assert.deepEqual(r.loc, term("D:/x"));
});

test("last thing you did wins: a new selection, then a terminal change", () => {
  let r = followLocation(null, { focus: term("D:/x"), selected: null, state: STATE });
  r = followLocation(r.memo, { focus: term("D:/x"), selected: "|d:/work/api", state: STATE });
  assert.deepEqual(r.loc, { cwd: "D:/work/api", on: null });
  // Same inputs again: stays on the selection.
  r = followLocation(r.memo, { focus: term("D:/x"), selected: "|d:/work/api", state: STATE });
  assert.deepEqual(r.loc, { cwd: "D:/work/api", on: null });
  // The person moves to a terminal elsewhere: back to the terminal.
  r = followLocation(r.memo, { focus: term("D:/y"), selected: "|d:/work/api", state: STATE });
  assert.deepEqual(r.loc, term("D:/y"));
  // Selecting the same worktree again doesn't change the selection key; selecting another does.
  r = followLocation(r.memo, { focus: term("D:/y"), selected: "devbox|/home/u/web", state: STATE });
  assert.deepEqual(r.loc, { cwd: "/home/u/web", on: "devbox" });
});

test("a selection that is no longer listed falls back to the terminal", () => {
  let r = followLocation(null, { focus: term("D:/x"), selected: null, state: STATE });
  r = followLocation(r.memo, { focus: term("D:/x"), selected: "gone", state: STATE });
  assert.deepEqual(r.loc, term("D:/x"));
});

test("extra focus fields (Files' space) are kept when following the terminal", () => {
  const r = followLocation(null, { focus: { cwd: "D:/x", on: null, space: "s1" }, selected: null, state: STATE });
  assert.equal(r.loc.space, "s1");
  const r2 = followLocation(r.memo, { focus: { cwd: "D:/x", on: null, space: "s1" }, selected: "|d:/work/api", state: STATE });
  assert.equal(r2.loc.space, "s1");
  assert.equal(r2.loc.cwd, "D:/work/api");
});
