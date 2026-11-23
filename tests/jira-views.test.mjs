// The Jira page's tab model (src/shared/jira/views.js, pure): which tabs the page shows, which one is picked, the
// sections a tab's rows are split into, and the count on a tab.
import test from "node:test";
import assert from "node:assert/strict";
import { ALL_JQL, pickTab, sectionsFor, stepTab, tabCountText, tabList } from "../src/shared/jira/views.js";
import { BUILTIN_FILTERS } from "../src/shared/jira/jql.js";

const views = [{ id: "sec", name: "Security", jql: "project = SEC", group: "type" }, { id: "all", name: "Everything", jql: "assignee = currentUser()", group: null }];

test("tabList: Today, views, Mine, All; a view can replace a built-in", () => {
  const tabs = tabList(views, { today: true });
  assert.deepEqual(tabs.map((t) => t.id), ["today", "sec", "mine", "all"]);
  assert.equal(tabs[3].name, "Everything");
  assert.equal(tabs[3].filters, true);
  assert.deepEqual(tabList([], { today: false }).map((t) => t.id), ["mine", "all"]);
});

test("tabList: the built-in tabs and what a view replaces", () => {
  const [today, sec, mine, all] = tabList(views, { today: true });
  assert.deepEqual(today, { id: "today", name: "Today", kind: "today", jql: null, group: null, filters: false });
  assert.deepEqual(sec, { id: "sec", name: "Security", kind: "search", jql: "project = SEC", group: "type", filters: false });
  assert.deepEqual(mine, { id: "mine", name: "Mine", kind: "search", jql: BUILTIN_FILTERS[0].jql, group: null, filters: false });
  assert.deepEqual(all, { id: "all", name: "Everything", kind: "search", jql: "assignee = currentUser()", group: null, filters: true });
  assert.equal(ALL_JQL, "assignee = currentUser() ORDER BY updated DESC");
  const [m, a] = tabList([], { today: false });
  assert.deepEqual(m, mine);
  assert.deepEqual(a, { id: "all", name: "All", kind: "search", jql: ALL_JQL, group: null, filters: true });
});

test("tabList: a view with id mine replaces Mine in place, keeping its filters", () => {
  const tabs = tabList([{ id: "mine", name: "My bugs", jql: "type = Bug", group: "type" }], { today: false });
  assert.deepEqual(tabs.map((t) => t.id), ["mine", "all"]);
  assert.deepEqual(tabs[0], { id: "mine", name: "My bugs", kind: "search", jql: "type = Bug", group: "type", filters: false });
});

test("pickTab: a removed tab falls back to the first", () => {
  const tabs = tabList(views, { today: true });
  assert.equal(pickTab(tabs, "sec").id, "sec");
  assert.equal(pickTab(tabs, "gone").id, "today");
  assert.equal(pickTab(tabs, undefined).id, "today");
});

test("stepTab wraps", () => {
  const tabs = tabList(views, { today: true });
  assert.equal(stepTab(tabs, "all", 1), "today");
  assert.equal(stepTab(tabs, "today", -1), "all");
  assert.equal(stepTab(tabs, "sec", 1), "mine");
  assert.equal(stepTab(tabs, "sec", -1), "today");
});

test("stepTab from an id that is gone starts from the first tab", () => {
  const tabs = tabList(views, { today: true });
  assert.equal(stepTab(tabs, "gone", 1), "sec");
});

test("sectionsFor: by issue type, then status category", () => {
  const rows = [{ key: "SEC-1", type: "Task", category: "new" }, { key: "SEC-2", type: "Bug", category: "indeterminate" }, { key: "SEC-3", type: "Task", category: "done" }];
  const s = sectionsFor(rows, "type");
  assert.deepEqual(s.map((x) => x.title), ["Task", "Bug"]);
  assert.deepEqual(s[0].parts.map((p) => p.category), ["new", "done"]);
  assert.equal(sectionsFor(rows, null)[0].title, null);
});

test("sectionsFor: no group is one section over every row; a missing type is Other", () => {
  const rows = [{ key: "A-1", type: "Task", category: "done" }, { key: "A-2", type: null, category: "new" }];
  const one = sectionsFor(rows, null);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].parts.map((p) => p.category), ["new", "done"]);
  assert.deepEqual(sectionsFor(rows, "type").map((x) => x.title), ["Task", "Other"]);
  assert.deepEqual(sectionsFor([], "type"), []);
});

test("tabCountText", () => {
  assert.equal(tabCountText({}), "");
  assert.equal(tabCountText({ total: 9 }), "9");
  assert.equal(tabCountText({ total: 157 }), "99+");
  assert.equal(tabCountText({ total: 9, problem: { kind: "jql" } }), "!");
});

test("tabCountText: the edges", () => {
  assert.equal(tabCountText(), "");
  assert.equal(tabCountText({ total: 0 }), "0");
  assert.equal(tabCountText({ total: 99 }), "99");
  assert.equal(tabCountText({ total: 100 }), "99+");
  assert.equal(tabCountText({ problem: { kind: "auth" } }), "!");
  assert.equal(tabCountText({ total: 9, loading: true }), "9");
  assert.equal(tabCountText({ loading: true }), "");
});
