// Loads dock-spaces' real class against stubbed host modules: agent rows and peer-name passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetHost, handlers, scrolls, bgs, clearBgs } from "./fixtures/host-stubs.mjs";

const herdr = await import("herdr");
const { default: Spaces } = await import("../src/mods/dock-spaces/main.js");
const cx = { spawn: (f) => { cx.last = f(cx); }, notify() {}, stop_propagation() {}, timer: { every() {} } };
const left = (px) => ({ id: "root", children: [{ id: "dock-left", size: { px } }] });

test("dock-spaces: agent rows count toward the active space's place; the narrow rail draws none", () => {
  resetHost();
  herdr.data.spaces = [{ id: "A", name: "api", tabs: [{ id: "ta" }], active: false }, { id: "B", name: "web", tabs: [{ id: "tb" }], active: true }];
  herdr.data.agents = [{ address: "t1", space: "A", pane: "p1", status: "idle", program: {}, title: "one" },
                       { address: "t2", space: "A", pane: "p2", status: "working", program: {}, title: "two" }];
  herdr.data.layout = left(300);
  const s = new Spaces(); s.init({}, cx);
  s.render(cx);
  assert.equal(s.activeAt, 3);
  herdr.data.layout = left(100);
  s.render(cx);
  assert.equal(s.activeAt, 1);
});

test("dock-spaces: a name pass replaces the names, never merges into old ones", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.layout = left(300);
  herdr.data.spaces = [{ id: "A", name: "api", tabs: [{ id: "ta" }], active: true }];
  herdr.data.agents = [{ address: "t1", space: "A", pane: "p1", app: "claude-code", program: { key: "claude" }, status: "idle", title: "" }];
  herdr.data.hc = () => ({ code: 0, stdout: JSON.stringify({ foreground: { pid: 42 }, created_ms: Date.now() - 60_000 }), stderr: "" });
  herdr.data.files.set("C:/home/.claude/sessions/42.json", JSON.stringify({ pid: 42, sessionId: "73636264-03cb-4b62-bb2d-36ccfbcbee15", kind: "interactive", startedAt: Date.now() - 1000, name: "api-7a" }));
  const s = new Spaces(); s.init({}, cx); s.render(cx);
  s.refreshNames(cx); await cx.last;
  assert.equal(s.names.get("t1")?.name, "api-7a");
  herdr.data.files.clear();
  s.refreshNames(cx); await cx.last;
  assert.equal(s.names.has("t1"), false);
});

let s3; // the panel three() made
const three = () => {
  resetHost();
  herdr.data.layout = left(300);
  herdr.data.spaces = [{ id: "A", name: "api", tabs: [{ id: "ta" }], active: false }, { id: "B", name: "web", tabs: [{ id: "tb" }], active: true },
                       { id: "C", name: "cli", tabs: [{ id: "tc" }], active: false }];
  herdr.data.agents = [{ address: "t1", space: "A", pane: "p1", status: "idle", program: {}, title: "one" },
                       { address: "t2", space: "A", pane: "p2", status: "idle", program: {}, title: "two" }];
  const s = new Spaces(); s.init({}, cx); s.render(cx);
  s3 = s;
  return s;
};
const moves = () => herdr.data.runs.filter(([c]) => c === "space.move" || c === "space.select");

test("dock-spaces: a space dragged onto another space's agent row lands at that space", () => {
  const s = three();
  handlers()["space-C:on_mouse_down:left"]();
  handlers()["space-agent-t1:on_mouse_move"]?.({}, cx);
  s.render(cx);
  handlers()["space-agent-t1:on_mouse_up:left"]?.({}, cx);
  assert.deepEqual(moves(), [["space.move", { id: "C", index: 1 }]]);
});

test("dock-spaces: pressing a space and letting go on its own agent row still selects it", () => {
  three();
  handlers()["space-A:on_mouse_down:left"]();
  handlers()["space-agent-t2:on_mouse_up:left"]?.({}, cx);
  assert.deepEqual(moves(), [["space.select", { id: "A" }]]);
});

test("dock-spaces: names are dropped while agent rows aren't drawn, so coming back never shows an old one", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.layout = left(300);
  herdr.data.spaces = [{ id: "A", name: "api", tabs: [{ id: "ta" }], active: true }];
  herdr.data.agents = [{ address: "t1", space: "A", pane: "p1", app: "claude-code", program: { key: "claude" }, status: "idle", title: "" }];
  herdr.data.hc = () => ({ code: 0, stdout: JSON.stringify({ foreground: { pid: 42 }, created_ms: Date.now() - 60_000 }), stderr: "" });
  herdr.data.files.set("C:/home/.claude/sessions/42.json", JSON.stringify({ pid: 42, sessionId: "73636264-03cb-4b62-bb2d-36ccfbcbee15", kind: "interactive", startedAt: Date.now() - 1000, name: "api-7a" }));
  const s = new Spaces(); s.init({}, cx); s.render(cx);
  s.refreshNames(cx); await cx.last;
  assert.equal(s.nameFor(herdr.data.agents[0]), "api-7a");
  herdr.data.layout = left(100);
  s.render(cx);
  herdr.data.layout = left(300);
  s.render(cx);
  assert.equal(s.nameFor(herdr.data.agents[0]), null);
});

test("dock-spaces: an agent starting above the active space doesn't scroll the list back to it; spaces moving does", () => {
  const s = three();
  assert.deepEqual(scrolls(), [3]);
  scrolls().length = 0;
  herdr.data.agents.push({ address: "t3", space: "A", pane: "p3", status: "working", program: {}, title: "three" });
  s.render(cx);
  assert.deepEqual(scrolls(), []);
  const [a, b, c] = herdr.data.spaces;
  herdr.data.spaces = [a, c, b];
  s.render(cx);
  assert.deepEqual(scrolls(), [5]);
});

test("dock-spaces: the list scrolls to the active space only when its height really changes", () => {
  three();
  scrolls().length = 0;
  const resized = handlers()["spaces-list:on_size_change"];
  resized({ width: 250, height: 400 }, cx);
  assert.deepEqual(scrolls(), [3]);
  resized({ width: 250, height: 400 }, cx); // a redraw at the same size (hovering an agent row)
  resized({ width: 250, height: 401 }, cx); // under 2 px
  assert.deepEqual(scrolls(), [3]);
  resized({ width: 250, height: 300 }, cx); // a block above grew: the list shrank
  assert.deepEqual(scrolls(), [3, 3]);
});

test("dock-spaces: a drag let go outside the list doesn't turn a later agent-row click into a move", () => {
  three();
  handlers()["space-C:on_mouse_down:left"]();
  handlers()["space-agent-t1:on_mouse_move"]({}, cx); // dragged over A's agent rows…
  // …and let go outside the list: no handler of this panel sees the release.
  handlers()["space-agent-t1:on_mouse_down:left"]?.({}, cx); // later: a click on that agent row
  handlers()["space-agent-t1:on_mouse_up:left"]({}, cx);
  handlers()["space-agent-t1:on_click"]({}, cx);
  assert.deepEqual(moves(), []);
  assert.deepEqual(herdr.data.runs.filter(([c]) => c === "pane.focus"), [["pane.focus", { pane: "p1" }]]);
});

test("dock-spaces: switching between the narrow rail and full brings the active space into view", () => {
  three();
  scrolls().length = 0;
  herdr.data.layout = left(100);
  s3.render(cx);
  herdr.data.layout = left(300);
  s3.render(cx);
  assert.deepEqual(scrolls(), [1, 3]);
});

test("dock-spaces: the chevron folds a space's agents and never selects or moves it", () => {
  localStorage.removeItem("spaces.folded");
  three();
  handlers()["space-fold-A:on_mouse_down:left"]({}, cx);
  s3.render(cx);
  assert.equal(s3.activeAt, 1); // A's two agent rows are hidden
  assert.deepEqual(moves(), []);
  assert.deepEqual(JSON.parse(localStorage.getItem("spaces.folded")), ["A"]);
  scrolls().length = 0;
  s3.render(cx); s3.render(cx); // later redraws at rest
  assert.deepEqual(scrolls(), []);
  localStorage.removeItem("spaces.folded");
});
test("dock-spaces: folds come back with a new panel; an id that's gone is dropped at the next change", () => {
  localStorage.setItem("spaces.folded", JSON.stringify(["A", "GONE"]));
  three();
  assert.equal(s3.activeAt, 1);
  handlers()["space-fold-C:on_mouse_down:left"]?.({}, cx); // C has no children: no chevron
  s3.toggleFold("B", cx);
  assert.deepEqual(JSON.parse(localStorage.getItem("spaces.folded")), ["A", "B"]);
  localStorage.removeItem("spaces.folded");
});
test("dock-spaces: the active worktree inside a folded parent: the parent is highlighted and scrolled to", () => {
  localStorage.setItem("spaces.folded", JSON.stringify(["R"]));
  resetHost();
  herdr.data.layout = left(300);
  herdr.data.spaces = [{ id: "R", name: "repo", folder: "/r", tabs: [{ id: "tr" }], active: false },
                       { id: "W", name: "repo", folder: "/r-wt", tabs: [{ id: "tw" }], active: true }];
  const s = new Spaces(); s.init({}, cx);
  s.git['[null,"/r"]'] = { name: "repo", branch: "main", ahead: 0, behind: 0, repo: '[null,"/r/.git"]', linked: false };
  s.git['[null,"/r-wt"]'] = { name: "repo", branch: "feat", ahead: 0, behind: 0, repo: '[null,"/r/.git"]', linked: true };
  s.render(cx);
  assert.equal(s.activeAt, 0);
  assert.ok(scrolls().includes(0));
  localStorage.removeItem("spaces.folded");
});

const repoAndWorktree = (activeId, foldR) => {
  localStorage.setItem("spaces.folded", JSON.stringify(foldR ? ["R"] : []));
  resetHost();
  herdr.data.layout = left(300);
  herdr.data.spaces = [{ id: "R", name: "repo", folder: "/r", tabs: [{ id: "tr" }], active: activeId === "R" },
                       { id: "W", name: "repo", folder: "/r-wt", tabs: [{ id: "tw" }], active: activeId === "W" },
                       { id: "B", name: "web", folder: "/b", tabs: [{ id: "tb" }], active: activeId === "B" }];
  const s = new Spaces(); s.init({}, cx);
  s.git['[null,"/r"]'] = { name: "repo", branch: "main", ahead: 0, behind: 0, repo: '[null,"/r/.git"]', linked: false };
  s.git['[null,"/r-wt"]'] = { name: "repo", branch: "feat", ahead: 0, behind: 0, repo: '[null,"/r/.git"]', linked: true };
  s.render(cx);
  return s;
};

test("dock-spaces: folding a space with a worktree above the active one doesn't scroll the list; selecting still does", () => {
  const s = repoAndWorktree("B", false);
  scrolls().length = 0;
  handlers()["space-fold-R:on_mouse_down:left"]({}, cx);
  s.render(cx);
  handlers()["space-fold-R:on_mouse_down:left"]({}, cx);
  s.render(cx);
  assert.deepEqual(scrolls(), []);
  herdr.data.spaces[2].active = false; herdr.data.spaces[0].active = true;
  s.render(cx);
  assert.deepEqual(scrolls(), [0]);
  localStorage.removeItem("spaces.folded");
});

test("dock-spaces: clicking a folded parent that holds the active worktree keeps you in that worktree", () => {
  repoAndWorktree("W", true);
  handlers()["space-R:on_mouse_down:left"]();
  handlers()["space-R:on_mouse_up:left"]({}, cx);
  assert.deepEqual(moves(), []);
  localStorage.removeItem("spaces.folded");
});

test("dock-spaces: a chevron press drops a leftover drag, so the row's release moves nothing", () => {
  localStorage.removeItem("spaces.folded");
  three();
  handlers()["space-C:on_mouse_down:left"]();
  handlers()["space-agent-t1:on_mouse_move"]({}, cx); // over A, then let go outside the list
  const spy = { ...cx, stops: 0, stop_propagation() { this.stops++; } };
  handlers()["space-fold-A:on_mouse_down:left"]({}, spy);
  handlers()["space-A:on_mouse_up:left"]({}, cx); // the release reaches the row (the chevron has no mouse-up)
  assert.deepEqual(moves(), []);
  assert.equal(spy.stops, 1);
  localStorage.removeItem("spaces.folded");
});

test("dock-spaces: a folded parent wears the active highlight for its hidden worktree; unfolding gives it back", () => {
  const s = repoAndWorktree("W", true);
  assert.equal(bgs()["space-R"], "selected");
  handlers()["space-fold-R:on_mouse_down:left"]({}, cx);
  clearBgs();
  s.render(cx);
  assert.equal(bgs()["space-W"], "selected");
  assert.notEqual(bgs()["space-R"], "selected");
  localStorage.removeItem("spaces.folded");
});
