import { test } from "node:test";
import assert from "node:assert/strict";
import { withAgents, rowLabel, sharedNames, spaceTags, foldRows } from "../src/shared/agent-rows.js";

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

const sa = (address, space, space_name) => ({ address, space, space_name, pane: "p" + address });
test("spaceTags adds the branch only where different spaces share a name, never main or master", () => {
  const list = [sa("t1", "S1", "herdr-dock"), sa("t2", "S2", "herdr-dock"), sa("t3", "S3", "server"), sa("t4", "S3", "server")];
  const branch = { t1: "main", t2: "changes-minors", t3: "feat/x", t4: "feat/x" };
  assert.deepEqual([...spaceTags(list, (a) => branch[a.address])],
    [["t1", "herdr-dock"], ["t2", "herdr-dock · changes-minors"], ["t3", "server"], ["t4", "server"]]);
});
test("spaceTags: no branch or master leaves the plain name", () => {
  const tags = spaceTags([sa("t1", "S1", "api"), sa("t2", "S2", "api")], (a) => (a.address === "t1" ? "master" : null));
  assert.deepEqual([...tags.values()], ["api", "api"]);
});

const fr = () => {
  const A = { id: "A" }, Aw = { id: "Aw" }, B = { id: "B" };
  return [{ w: A, tree: null }, { w: A, agent: { status: "idle" }, depth: 1 }, { w: Aw, tree: "└─" },
          { w: Aw, agent: { status: "done" }, depth: 2 }, { w: B, tree: null }];
};
const ids = (out) => out.map((r) => r.w.id + (r.agent ? "@" : ""));
test("foldRows: a folded space hides its agents, worktrees and theirs; says how many and the most urgent", () => {
  const out = foldRows(fr(), new Set(["A"]));
  assert.deepEqual(ids(out), ["A", "B"]);
  assert.deepEqual([out[0].folded, out[0].children, out[0].hidden, out[0].top], [true, 3, 3, "done"]);
  assert.deepEqual([out[1].folded, out[1].children], [false, 0]);
});
test("foldRows: a folded worktree hides only its own agents; nothing folded shows everything", () => {
  const out = foldRows(fr(), new Set(["Aw"]));
  assert.deepEqual(ids(out), ["A", "A@", "Aw", "B"]);
  assert.deepEqual([out[0].children, out[2].folded, out[2].hidden, out[2].top], [3, true, 1, "done"]);
  assert.deepEqual(ids(foldRows(fr(), new Set())), ["A", "A@", "Aw", "Aw@", "B"]);
  assert.equal(foldRows(fr(), new Set(["B"]))[4].folded, false); // nothing to fold
});
test("foldRows: a folded parent holds the active worktree hidden inside it", () => {
  const rows = fr(); rows[2].w.active = true;
  assert.equal(foldRows(rows, new Set(["A"]))[0].holdsActive, true);
  assert.ok(!foldRows(rows, new Set())[0].holdsActive);
});
