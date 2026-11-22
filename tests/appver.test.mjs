import { test } from "node:test";
import assert from "node:assert/strict";
import { appVersionFiles, contentVersion } from "../src/shared/appver.js";

const f = (path, s) => ({ path, bytes: Buffer.from(s) });

test("contentVersion: 12 hex digits, order independent", () => {
  const a = contentVersion([f("a.js", "1"), f("mods/b.js", "2")]);
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(a, contentVersion([f("mods/b.js", "2"), f("a.js", "1")]));
});

test("contentVersion: a changed byte or a renamed path changes it", () => {
  const a = contentVersion([f("a.js", "1")]);
  assert.notEqual(a, contentVersion([f("a.js", "2")]));
  assert.notEqual(a, contentVersion([f("b.js", "1")]));
});

test("appVersionFiles: leaves out the three root files, keeps other mods' VERSION.json", () => {
  const out = appVersionFiles(["VERSION.json", "RECIPE.md", "preview.png", "mods/x/VERSION.json", "mods/x/main.js"]);
  assert.deepEqual(out, ["mods/x/VERSION.json", "mods/x/main.js"]);
});

test("appVersionFiles: leaves out dock-core's copy of VERSION.json (it holds the version and source)", () => {
  const out = appVersionFiles(["mods/dock-core/VERSION.json", "mods/dock-core/main.js"]);
  assert.deepEqual(out, ["mods/dock-core/main.js"]);
});
