import { test } from "node:test";
import assert from "node:assert/strict";
import { gitCommandName } from "../src/shared/gitcmd.js";
import {
  HISTORY_KEY, CAP, historyOf, needsOf, addItem, clearItem, clearAll, markAllRead, resolveItems, counts,
} from "../src/shared/notify.js";

// Observed (Step 1): the props Herdr hands the toast mod when an agent goes blocked in an unfocused space.
const AGENT_TOAST = {
  title: "fake-agent needs you", body: "toast-probe / probe2", level: "error",
  action: { name: "agent.focus", args: { terminal: "t13" } }, overlay: "o6",
};
const AGENT_TOAST_TERMINAL = "t13";
// And when one finishes while nobody looks: same action, level info. Not a "needs you".
const AGENT_DONE_TOAST = {
  title: "fake-agent finished", body: "toast-probe / probe3", level: "info",
  action: { name: "agent.focus", args: { terminal: "t14" } }, overlay: "o7",
};

const item = (o = {}) => ({ id: "x", at: 0, title: "t", body: null, level: null, icon: null, action: null,
  read: false, needs: null, resolved: false, ...o });
const API = "|d:/r/api";
const state = (pipeline) => ({ repos: [{ worktrees: [{ id: API, pipeline }] }] });

test("constants", () => {
  assert.equal(HISTORY_KEY, "dock.notify.history");
  assert.equal(CAP, 200);
});

test("historyOf: junk becomes []", () => {
  for (const raw of [undefined, null, 5, "x", { a: 1 }]) assert.deepEqual(historyOf(raw), []);
  assert.deepEqual(historyOf([{ id: "a", at: 1, title: "t" }, 7, null]).map((i) => i.id), ["a"]);
});

test("historyOf: fills missing fields with their defaults", () => {
  assert.deepEqual(historyOf([{ id: "a", at: 1, title: "t" }]), [item({ id: "a", at: 1 })]);
});

test("needsOf: a pipeline alert names its worktree; an agent toast its terminal; others null", () => {
  const name = `dock-core.${gitCommandName("git.show", { worktree: API })}`;
  assert.deepEqual(needsOf({ title: "Pipeline failed", level: "error", action: { name } }), { kind: "pipeline", worktree: API });
  assert.deepEqual(needsOf(AGENT_TOAST), { kind: "agent", terminal: AGENT_TOAST_TERMINAL });
  assert.equal(needsOf({ title: "Saved", level: "info" }), null);
});

test("needsOf: an agent-finished toast, a bare git.show, other commands and junk are null", () => {
  assert.equal(needsOf(AGENT_DONE_TOAST), null);
  assert.equal(needsOf({ title: "x", level: "error", action: { name: "dock-core.git.show" } }), null);
  assert.equal(needsOf({ title: "x", level: "error", action: { name: "dock-core.git.refresh" } }), null);
  assert.equal(needsOf({ title: "x", level: "error", action: { name: "agent.focus", args: {} } }), null);
  for (const n of [undefined, null, 5, { action: 5 }, { action: { name: 7 } }]) assert.equal(needsOf(n), null);
});

test("addItem: newest first, unread, unresolved; cap 200 drops cleared-or-resolved oldest first", () => {
  let l = [];
  for (let i = 0; i < 200; i++) l = addItem(l, { title: `n${i}` }, i, `id${i}`);
  l = resolveItems(l.map((x) => (x.id === "id150" ? { ...x, needs: { kind: "agent", terminal: "gone" } } : x)), { agents: [], gitState: null });
  l = addItem(l, { title: "new" }, 999, "idnew");
  assert.equal(l.length, 200); assert.equal(l[0].id, "idnew"); assert.equal(l[0].read, false);
  assert.equal(l.some((x) => x.id === "id150"), false); // the resolved one went first
  assert.equal(l.some((x) => x.id === "id0"), true);
});

test("addItem: past the cap with nothing resolved, the oldest goes", () => {
  let l = [];
  for (let i = 0; i < 201; i++) l = addItem(l, { title: `n${i}` }, i, `id${i}`);
  assert.equal(l.length, 200); assert.equal(l[0].id, "id200"); assert.equal(l.at(-1).id, "id1");
});

test("addItem: records the props and their needs", () => {
  const [a] = addItem([], AGENT_TOAST, 42, "a");
  assert.deepEqual(a, item({ id: "a", at: 42, title: AGENT_TOAST.title, body: AGENT_TOAST.body, level: "error",
    action: AGENT_TOAST.action, needs: { kind: "agent", terminal: "t13" } }));
});

test("resolveItems: a needs-agent item resolves when its agent isn't blocked", () => {
  const l = [item({ needs: { kind: "agent", terminal: "t1" } })];
  assert.equal(resolveItems(l, { agents: [{ address: "t1", status: "working" }], gitState: null })[0].resolved, true);
  assert.equal(resolveItems(l, { agents: [{ address: "t1", status: "blocked" }], gitState: null })[0].resolved, false);
});

test("resolveItems: matches an agent by its address only, never its pane", () => {
  const l = [item({ needs: { kind: "agent", terminal: "t13" } })];
  assert.equal(resolveItems(l, { agents: [{ address: "t13", pane: "p9", status: "blocked" }], gitState: null })[0].resolved, false);
  assert.equal(resolveItems(l, { agents: [{ address: "t13", pane: "p9", status: "idle" }], gitState: null })[0].resolved, true);
  // A pane id equal to the terminal isn't a match: that agent is gone, so the item resolves.
  assert.equal(resolveItems(l, { agents: [{ address: "t99", pane: "t13", status: "blocked" }], gitState: null })[0].resolved, true);
});

test("resolveItems: a needs-agent item whose agent is gone is resolved", () => {
  const l = [item({ needs: { kind: "agent", terminal: "t1" } })];
  assert.equal(resolveItems(l, { agents: [], gitState: null })[0].resolved, true);
});

test("resolveItems: unknown agents (not an array) leave agent items unresolved", () => {
  const l = [item({ needs: { kind: "agent", terminal: "t1" } })];
  for (const agents of [undefined, null, 5, {}]) assert.equal(resolveItems(l, { agents, gitState: null }), l, String(agents));
  assert.equal(resolveItems(l), l);
});

test("historyOf: a stored agent needs must name a terminal", () => {
  assert.deepEqual(historyOf([{ id: "a", needs: { kind: "agent", terminal: "t1" } }])[0].needs, { kind: "agent", terminal: "t1" });
  assert.equal(historyOf([{ id: "a", needs: { kind: "agent", pane: "p1" } }])[0].needs, null);
});

test("resolveItems: a needs-pipeline item resolves when that worktree's pipeline isn't failed", () => {
  const l = [item({ needs: { kind: "pipeline", worktree: API } })];
  assert.equal(resolveItems(l, { agents: [], gitState: state({ status: "passed" }) })[0].resolved, true);
  assert.equal(resolveItems(l, { agents: [], gitState: state({ status: "failed" }) })[0].resolved, false);
  assert.equal(resolveItems(l, { agents: [], gitState: { repos: [] } })[0].resolved, false); // unknown is not fixed
  assert.equal(resolveItems(l, { agents: [], gitState: null })[0].resolved, false);
});

test("resolveItems: a pipeline not polled yet (null) or unknown (CI error) is not fixed", () => {
  const l = [item({ needs: { kind: "pipeline", worktree: API } })];
  assert.equal(resolveItems(l, { agents: [], gitState: state(null) }), l);
  assert.equal(resolveItems(l, { agents: [], gitState: state(undefined) }), l);
  assert.equal(resolveItems(l, { agents: [], gitState: state({ status: "unknown" }) }), l);
  assert.equal(resolveItems(l, { agents: [], gitState: state({ status: "running" }) })[0].resolved, true);
});

test("addItem: a long body is cut to 2000 characters with an ellipsis", () => {
  const long = "a".repeat(2500);
  const b = addItem([], { title: "t", body: long }, 1, "i")[0].body;
  assert.equal(b.length, 2001);
  assert.ok(b.endsWith("…"));
  assert.equal(b.slice(0, 2000), "a".repeat(2000));
  const exact = "b".repeat(2000);
  assert.equal(addItem([], { title: "t", body: exact }, 1, "i")[0].body, exact);
});

test("resolveItems: same array when nothing changed; resolved stays resolved", () => {
  const l = [item({ needs: { kind: "agent", terminal: "t1" } }), item({ id: "y" })];
  assert.equal(resolveItems(l, { agents: [{ address: "t1", status: "blocked" }], gitState: null }), l);
  const r = resolveItems(l, { agents: [], gitState: null });
  assert.notEqual(r, l); assert.equal(r[1], l[1]);
  assert.equal(resolveItems(r, { agents: [{ address: "t1", status: "blocked" }], gitState: null }), r);
});

test("counts: need you excludes resolved; unread excludes need-you items", () => {
  const needs = { kind: "agent", terminal: "t1" };
  const l = [item({ needs, resolved: false, read: false }), item({ needs, resolved: true, read: false }),
    item({ needs: null, read: false }), item({ needs: null, read: true })];
  assert.deepEqual(counts(l), { needYou: 1, unread: 2 });
});

test("clearItem / clearAll / markAllRead", () => {
  const l = [item({ id: "a" }), item({ id: "b" })];
  assert.deepEqual(clearItem(l, "a").map((x) => x.id), ["b"]);
  assert.deepEqual(clearAll(), []);
  assert.deepEqual(markAllRead(l).map((x) => x.read), [true, true]);
  assert.equal(l[0].read, false);
});

// --- filters ---------------------------------------------------------------------------------------------------
import { FILTERS, notifyType, matchesFilter, clearMatching } from "../src/shared/notify.js";

const it = (o) => ({ id: "x", at: 0, title: "T", body: null, level: "info", icon: null, action: null, read: false,
  needs: null, resolved: false, ...o });
const agentToast = it({ id: "a", title: "claude needs you", level: "error", action: { name: "agent.focus", args: { terminal: "t1" } },
  needs: { kind: "agent", terminal: "t1" } });
const browserToast = it({ id: "b", title: "The agent needs you", level: "warning", action: { name: "dock-core.browser.show.dDE" } });
const ciAlert = it({ id: "c", level: "error", action: { name: `dock-core.${gitCommandName("git.show", { worktree: "|d:/w" })}` },
  needs: { kind: "pipeline", worktree: "|d:/w" }, resolved: true });
const update = it({ id: "u", title: "herdr-dock update available", action: { name: "mod.open", args: { name: "dock-config" } } });
const other = it({ id: "o", title: "Couldn't delete worktree x", level: "error" });

test("FILTERS: needs, agents, ci, updates, other", () => {
  assert.deepEqual(FILTERS, ["needs", "agents", "ci", "updates", "other"]);
});

test("notifyType: agent and browser toasts are agents, pipeline alerts ci, dock-config opens updates, the rest other", () => {
  assert.deepEqual([agentToast, browserToast, ciAlert, update, other].map(notifyType), ["agents", "agents", "ci", "updates", "other"]);
  assert.equal(notifyType(it({ action: { name: "mod.open", args: { name: "dock-jira" } } })), "other");
});

test("matchesFilter: needs = waiting on you and not resolved; a type filter = that type; null = everything", () => {
  assert.equal(matchesFilter(agentToast, "needs"), true);
  assert.equal(matchesFilter(ciAlert, "needs"), false, "resolved");
  assert.equal(matchesFilter(update, "needs"), false);
  assert.equal(matchesFilter(ciAlert, "ci"), true);
  assert.equal(matchesFilter(ciAlert, "agents"), false);
  assert.equal(matchesFilter(other, null), true);
});

test("clearMatching: removes only the filter's items; null clears all", () => {
  const list = [agentToast, browserToast, ciAlert, update, other];
  assert.deepEqual(clearMatching(list, "agents").map((x) => x.id), ["c", "u", "o"]);
  assert.deepEqual(clearMatching(list, "needs").map((x) => x.id), ["b", "c", "u", "o"]);
  assert.deepEqual(clearMatching(list, null), []);
});
