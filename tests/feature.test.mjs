import { test } from "node:test";
import assert from "node:assert/strict";
import { featureMode } from "../src/mods/_feature-mode.js";

test("featureMode", () => {
  assert.equal(featureMode("icons", null, "a"), "icon");
  assert.equal(featureMode("expanded", "b", "a"), "collapsed");
  assert.equal(featureMode("expanded", "a", "a"), "full");
  assert.equal(featureMode(undefined, undefined, "a"), "full");
});

test("featureMode: icons wins over a focus; hidden and null focus are full", () => {
  assert.equal(featureMode("icons", "b", "a"), "icon");
  assert.equal(featureMode("expanded", null, "a"), "full");
  assert.equal(featureMode("hidden", "b", "a"), "full");
  assert.equal(featureMode("expanded", undefined, "a"), "full");
});
