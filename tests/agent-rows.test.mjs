import { test } from "node:test";
import assert from "node:assert/strict";
import { withAgents, rowLabel, sharedNames } from "../src/shared/agent-rows.js";

const row = (id, tree = null) => ({ w: { id, machine: null }, tree });
const ag = (address, space) => ({ address, space });
test("withAgents puts a space's agents right after its row, in order; a worktree's one step deeper", () => {
  const rows = [row("A"), row("Aw", "└─"), row("B")];
  const out = withAgents(rows, [ag("t1", "A"), ag("t2", "Aw"), ag("t3", "A"), ag("t4", "Z")]);
  assert.deepEqual(out.map((r) => (r.agent ? `${r.agent.address}@${r.depth}` : r.w.id)), ["A", "t1@1", "t3@1", "Aw", "t2@2", "B"]);
  assert.equal(out[1].w, rows[0].w);
});
test("rowLabel: the peer name, then pane name, title, a named tab, the program, the address", () => {
  const a = { address: "t5", pane_name: null, title: "✦  Fixing the build", tab_name: "2", program: { name: "Codex" } };
  assert.equal(rowLabel(a, "amp-refine-ui-85"), "amp-refine-ui-85");
  assert.equal(rowLabel({ ...a, pane_name: "api" }, null), "api");
  assert.equal(rowLabel(a, null), "Fixing the build");
  assert.equal(rowLabel({ ...a, title: "" }, null), "Codex");
  assert.equal(rowLabel({ ...a, title: "", tab_name: "deploy" }, null), "deploy");
  assert.equal(rowLabel({ address: "t5", title: "", tab_name: "", program: {} }, null), "t5");
});
test("sharedNames: only names two agents both have", () => {
  assert.deepEqual([...sharedNames(["account-center-mf-ff", "amp-refine-ui-85", "account-center-mf-ff", null, null])], ["account-center-mf-ff"]);
});
