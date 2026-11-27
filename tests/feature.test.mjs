import { test } from "node:test";
import assert from "node:assert/strict";
import { featureMode } from "../src/mods/_feature-mode.js";

test("featureMode", () => {
  assert.equal(featureMode("icons", null, "a", "left"), "icon");
  assert.equal(featureMode("expanded", "b", "a", "left"), "collapsed");
  assert.equal(featureMode("expanded", "a", "a", "left"), "full");
  assert.equal(featureMode(undefined, undefined, "a", "left"), "full");
});

test("featureMode: icons wins over a focus; hidden and null focus are full", () => {
  assert.equal(featureMode("icons", "b", "a", "left"), "icon");
  assert.equal(featureMode("expanded", null, "a", "left"), "full");
  assert.equal(featureMode("hidden", "b", "a", "left"), "full");
  assert.equal(featureMode("expanded", undefined, "a", "left"), "full");
});

test("featureMode: a block outside the left panel is always full", () => {
  assert.equal(featureMode("icons", null, "a", "right"), "full");
  assert.equal(featureMode("expanded", "b", "a", "top"), "full");
  assert.equal(featureMode("icons", null, "a", undefined), "full");
  assert.equal(featureMode("icons", null, "a", "left"), "icon");
});

import { isFocused } from "../src/mods/_feature-mode.js";

test("isFocused: only the left feature dock.left.focus names, while expanded", () => {
  assert.equal(isFocused("expanded", "a", "a", "left"), true);
  assert.equal(isFocused("expanded", "b", "a", "left"), false);
  assert.equal(isFocused("expanded", null, "a", "left"), false);
  assert.equal(isFocused("icons", "a", "a", "left"), false);
  assert.equal(isFocused("expanded", "a", "a", "right"), false);
});
