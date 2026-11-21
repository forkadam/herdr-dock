import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfig, mergeForHost } from "../src/shared/config.js";
import { nextMode, panelActions } from "../src/shared/panel.js";

const merged = () => mergeForHost(parseConfig(readFileSync("config/dock.json", "utf8")).config, "h");

test("nextMode cycles", () => {
  assert.equal(nextMode("expanded"), "icons");
  assert.equal(nextMode("icons"), "hidden");
  assert.equal(nextMode("hidden"), "expanded");
});
test("panelActions for icons and hidden", () => {
  const m = merged();
  assert.deepEqual(panelActions("hidden", m, null), [{ command: "layout.hide", args: { id: "dock-left" } }]);
  assert.deepEqual(panelActions("icons", m, null).at(-1), { command: "layout.resize", args: { id: "dock-left", px: 48 } });
});
test("icons hides third-party left blocks, expanded shows them", () => {
  const m = merged();
  m.regions.left.features.push({ mod: "thirdparty" });
  const id = "dock-left-3-thirdparty";
  assert.ok(panelActions("icons", m, null).some((a) => a.command === "layout.hide" && a.args.id === id));
  assert.ok(!panelActions("icons", m, null).some((a) => a.command === "layout.hide" && a.args.id === "dock-left-0-dock-spaces"));
  assert.ok(panelActions("expanded", m, null).some((a) => a.command === "layout.show" && a.args.id === id));
});
test("panelActions expanded with focus collapses the others", () => {
  const m = merged();
  const a = panelActions("expanded", m, "dock-left-1-dock-agents");
  assert.deepEqual(a.find((x) => x.args.id === "dock-left-1-dock-agents").args, { id: "dock-left-1-dock-agents", weight: 1 });
  assert.deepEqual(a.find((x) => x.args.id === "dock-left-0-dock-spaces").args, { id: "dock-left-0-dock-spaces", px: 32 });
});
test("panelActions expanded without focus restores configured sizes", () => {
  const a = panelActions("expanded", merged(), null);
  const resize = (id) => a.find((x) => x.command === "layout.resize" && x.args.id === id).args;
  assert.deepEqual(resize("dock-left"), { id: "dock-left", px: 268 });
  assert.deepEqual(resize("dock-left-2-dock-quotas"), { id: "dock-left-2-dock-quotas", px: 150 });
  assert.deepEqual(resize("dock-left-0-dock-spaces"), { id: "dock-left-0-dock-spaces", weight: 1 });
});
