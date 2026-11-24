import test from "node:test";
import assert from "node:assert/strict";
import { ABANDON_MS, SETUP_RESULT_REL, endResult, parseSetupResult, runState, startResult } from "../src/shared/browser/setup-result.js";

test("runState: running, abandoned after 15 minutes, outcomes, junk", () => {
  const t0 = 1_000_000;
  assert.equal(runState(startResult("on", t0), t0 + ABANDON_MS - 1), "running");
  assert.equal(runState(startResult("on", t0), t0 + ABANDON_MS), "abandoned");
  for (const o of ["ok", "failed", "unsupported"]) assert.equal(runState(endResult("on", o, "", t0), t0), o);
  assert.equal(runState(parseSetupResult("{nope"), t0), null);
  assert.deepEqual(parseSetupResult(JSON.stringify(endResult("off", "ok", "", 5))), { state: "ok", at: 5, action: "off", message: "" });
});

test("the result file lives under the browser folder; a start and an end have the documented shape", () => {
  assert.equal(SETUP_RESULT_REL, "herdr-dock/browser/setup-result.json");
  assert.equal(ABANDON_MS, 15 * 60 * 1000);
  assert.deepEqual(startResult("off", 7), { state: "running", startedAt: 7, action: "off" });
  assert.deepEqual(endResult("on", "failed", "Chrome couldn't be set up", 9), { state: "failed", at: 9, action: "on", message: "Chrome couldn't be set up" });
});

test("parseSetupResult: anything that is not a result is null, and so is its state", () => {
  for (const text of [null, undefined, "", "null", "[]", "3", '"ok"', "{}", '{"state":"weird"}', '{"state":"running"}']) {
    assert.equal(parseSetupResult(text), null, String(text));
  }
  assert.equal(runState(null, 1), null);
  assert.equal(runState(undefined, 1), null);
  const running = startResult("on", 4);
  assert.deepEqual(parseSetupResult(JSON.stringify(running)), running);
});
