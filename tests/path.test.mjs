import { test } from "node:test";
import assert from "node:assert/strict";
import { slashPath, isAbsolutePath } from "../src/shared/path.js";

test("slashPath normalizes Windows paths", () => {
  assert.equal(slashPath("c:\\Users\\Adam Cheng\\.claude\\"), "C:/Users/Adam Cheng/.claude");
  assert.equal(slashPath("/home/a/"), "/home/a");
  assert.equal(slashPath("C:\\"), "C:/");
  assert.equal(slashPath("/"), "/");
});
test("isAbsolutePath", () => {
  assert.ok(isAbsolutePath("D:\\workspace")); assert.ok(isAbsolutePath("/x"));
  assert.ok(isAbsolutePath("C:/x"));
  assert.ok(!isAbsolutePath("rel\\x"));
});
