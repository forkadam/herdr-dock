import { test } from "node:test";
import assert from "node:assert/strict";
import { preflight, needsInstall, resultOf } from "../scripts/update-steps.mjs";

test("preflight: clean main passes", () => {
  assert.deepEqual(preflight({ dirty: [], branch: "main" }), { ok: true });
});
test("preflight: dirty lists files", () => {
  assert.deepEqual(preflight({ dirty: ["a.js", "b.js"], branch: "main" }), { ok: false, reason: "local changes: a.js, b.js" });
});
test("preflight: off main", () => {
  assert.deepEqual(preflight({ dirty: [], branch: "feat/x" }), { ok: false, reason: "on branch feat/x" });
  assert.deepEqual(preflight({ dirty: ["a"], branch: "feat/x" }), { ok: false, reason: "on branch feat/x" });
});
test("needsInstall", () => {
  assert.equal(needsInstall(["src/a.js"]), false);
  assert.equal(needsInstall(["src/a.js", "package.json"]), true);
  assert.equal(needsInstall(["package-lock.json"]), true);
  assert.equal(needsInstall(["sub/package.json"]), false);
  assert.equal(needsInstall([]), false);
});
test("resultOf", () => {
  assert.deepEqual(resultOf({ from: "a1", to: "b2", commits: 3, ok: true }, 99), { ok: true, from: "a1", to: "b2", commits: 3, reason: null, at: 99 });
  assert.deepEqual(resultOf({ from: "a1", ok: false, reason: "boom" }, 5), { ok: false, from: "a1", to: null, commits: 0, reason: "boom", at: 5 });
});

import { parseDirty } from "../scripts/update-steps.mjs";
test("parseDirty keeps whole names", () => {
  assert.deepEqual(parseDirty(" M a\nM  b\n?? c\nR  old -> new\n"), ["a", "b", "c", "new"]);
  assert.deepEqual(parseDirty(""), []);
});

import { planAfterPull, installNeeded } from "../scripts/update-steps.mjs";
test("planAfterPull: new commits deploy, diffing from the deployed commit when known", () => {
  assert.deepEqual(planAfterPull({ from: "a1", to: "b2", deployed: "a1" }), { action: "deploy", base: "a1" });
  // A half-finished earlier update: the packages are compared with what was last deployed.
  assert.deepEqual(planAfterPull({ from: "a1", to: "b2", deployed: "z9" }), { action: "deploy", base: "z9" });
  assert.deepEqual(planAfterPull({ from: "a1", to: "b2", deployed: null }), { action: "deploy", base: "a1" });
});
test("planAfterPull: nothing pulled and deployed matches HEAD -> up to date", () => {
  assert.deepEqual(planAfterPull({ from: "b2", to: "b2", deployed: "b2" }), { action: "none" });
});
test("planAfterPull: nothing pulled but HEAD isn't what was deployed (or unknown) -> redeploy", () => {
  assert.deepEqual(planAfterPull({ from: "b2", to: "b2", deployed: "a1" }), { action: "redeploy", base: "a1" });
  assert.deepEqual(planAfterPull({ from: "b2", to: "b2", deployed: null }), { action: "redeploy", base: null });
  assert.deepEqual(planAfterPull({ from: "b2", to: "b2", deployed: undefined }), { action: "redeploy", base: null });
});
test("installNeeded: package files changed, node_modules missing, or the diff is unknown", () => {
  assert.equal(installNeeded({ changed: ["src/a.js"], hasNodeModules: true }), false);
  assert.equal(installNeeded({ changed: ["package-lock.json"], hasNodeModules: true }), true);
  assert.equal(installNeeded({ changed: [], hasNodeModules: false }), true);
  assert.equal(installNeeded({ changed: null, hasNodeModules: true }), true);
});
