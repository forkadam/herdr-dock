import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeKeys } from "../scripts/keys.mjs";

const SECTION = "layout:herdr-dock";
const B = [["ctrl-alt-b", "dock-core.cycle"], ["ctrl-alt-,", "dock-core.config"]];

test("merging into an empty object adds both bindings", () => {
  const r = mergeKeys({}, SECTION, B);
  assert.deepEqual(r.added, ["ctrl-alt-b", "ctrl-alt-,"]);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.keys, { [SECTION]: { "ctrl-alt-b": "dock-core.cycle", "ctrl-alt-,": "dock-core.config" } });
});

test("a key bound to something else is skipped; the other is added", () => {
  const r = mergeKeys({ [SECTION]: { "ctrl-alt-,": "x" } }, SECTION, B);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].key, "ctrl-alt-,");
  assert.match(r.skipped[0].reason, /x/);
  assert.deepEqual(r.added, ["ctrl-alt-b"]);
  assert.equal(r.keys[SECTION]["ctrl-alt-,"], "x");
});

test("an identical existing binding is neither added nor skipped", () => {
  const r = mergeKeys({ [SECTION]: { "ctrl-alt-b": "dock-core.cycle" } }, SECTION, B);
  assert.deepEqual(r.added, ["ctrl-alt-,"]);
  assert.deepEqual(r.skipped, []);
});

test("the input is not mutated and other sections are kept", () => {
  const input = { other: { a: "b" }, [SECTION]: { z: "y" } };
  const copy = JSON.parse(JSON.stringify(input));
  const r = mergeKeys(input, SECTION, B);
  assert.deepEqual(input, copy);
  assert.deepEqual(r.keys.other, { a: "b" });
  assert.equal(r.keys[SECTION].z, "y");
});
