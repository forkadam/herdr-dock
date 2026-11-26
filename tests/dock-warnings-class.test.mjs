// Loads dock-warnings' real class against stubbed host modules: a quota warning's click focuses the real Quotas block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetHost, handlers } from "./fixtures/host-stubs.mjs";

const herdr = await import("herdr");
const { default: Warnings } = await import("../src/mods/dock-warnings/main.js");
const cx = { notify() {}, stop_propagation() {}, timer: { every() {} } };

function warnings(leftFeatures) {
  resetHost();
  herdr.data.shared.set("dock.config.applied", { left: { features: leftFeatures } });
  herdr.data.shared.set("dock.quotas.top", { p: 95, at: Date.now() });
  const w = new Warnings();
  w.init({}, cx);
  w.render(cx);
  return w;
}

test("the quota warning focuses Quotas by its real left-panel block id", () => {
  warnings([{ mod: "dock-header" }, { mod: "dock-spaces" }, { mod: "dock-quotas" }]);
  const click = handlers()["dock-warning-quota:on_click"];
  assert.equal(typeof click, "function", "a quota warning is drawn and clickable");
  click({}, cx);
  assert.equal(herdr.data.shared.get("dock.left.focus"), "dock-left-2-dock-quotas");
  assert.equal(herdr.data.shared.get("dock.left.mode"), "expanded");
});

test("with no Quotas in the left panel the click changes nothing", () => {
  warnings([{ mod: "dock-header" }, { mod: "dock-spaces" }]);
  handlers()["dock-warning-quota:on_click"]?.({}, cx);
  assert.equal(herdr.data.shared.get("dock.left.focus"), undefined);
  assert.equal(herdr.data.shared.get("dock.left.mode"), undefined);
});
