// Loads dock-warnings' real class against stubbed host modules: the quota warning is a tooltip, not a button.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetHost, handlers, texts, clearTexts } from "./fixtures/host-stubs.mjs";

const herdr = await import("herdr");
const { default: Warnings } = await import("../src/mods/dock-warnings/main.js");
const cx = { notify() {}, stop_propagation() {}, timer: { every() {} } };

test("the quota warning has no click: it leaves the left panel alone", () => {
  resetHost();
  herdr.data.shared.set("dock.config.applied", { left: { features: [{ mod: "dock-header" }, { mod: "dock-quotas" }] } });
  herdr.data.shared.set("dock.quotas.top", { p: 95, at: Date.now() });
  clearTexts();
  const w = new Warnings();
  w.init({}, cx);
  w.render(cx);
  assert.ok(texts().includes("⚠ quota 95%"), "the warning is drawn");
  assert.equal(handlers()["dock-warning-quota:on_click"], undefined);
  assert.equal(herdr.data.shared.get("dock.left.focus"), undefined);
});
