// Loads dock-agents' real class against stubbed host modules: rows from two spaces with one name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetHost, texts, clearTexts } from "./fixtures/host-stubs.mjs";

const herdr = await import("herdr");
const { default: Agents } = await import("../src/mods/dock-agents/main.js");
const cx = { spawn() {}, notify() {}, stop_propagation() {}, timer: { every() {} } };

test("dock-agents: two same-named spaces' agents read apart by branch, in both sorts", () => {
  resetHost();
  herdr.data.layout = { id: "root", children: [{ id: "dock-left", size: { px: 300 } }] };
  herdr.data.spaces = [{ id: "S1", name: "herdr-dock", tabs: [{ id: "ta", name: "1" }] }, { id: "S2", name: "herdr-dock", tabs: [{ id: "tb", name: "1" }] }];
  const agent = (address, space, tab, pane) => ({ address, space, space_name: "herdr-dock", tab, tab_index: 0, tab_name: "1", pane, status: "idle", app: "claude-code", program: { key: "claude" }, title: "Claude Code", pane_name: null, seq: 1, pinned: false, focused: false });
  herdr.data.agents = [agent("t1", "S1", "ta", "p1"), agent("t2", "S2", "tb", "p2")];
  herdr.data.panes = [{ pane: "p1", terminal: "t1", tab: "ta", branch: "main", program: { agent: true } }, { pane: "p2", terminal: "t2", tab: "tb", branch: "changes-minors", program: { agent: true } }];
  const panel = new Agents(); panel.init({}, cx);
  for (const sort of ["priority", "grouped"]) {
    herdr.data.shared.set("agents.sort", sort);
    clearTexts();
    assert.doesNotThrow(() => panel.render(cx), sort);
    assert.ok(texts().includes("herdr-dock · changes-minors"), `${sort}: ${JSON.stringify(texts())}`);
    assert.ok(texts().includes("herdr-dock"), sort);
  }
});
