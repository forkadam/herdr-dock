import test from "node:test";
import assert from "node:assert/strict";
import { HIDDEN_EVERY_MS, RETRY_AFTER_MS, SHOWN_EVERY_MS, badgeFor, countText, filterList, pageState, pickFilter, pollDue } from "../src/shared/jira/page.js";

test("filterList: built-ins, favourites, own; stable ids; junk skipped", () => {
  const list = filterList(
    [{ id: "10100", name: "My open bugs", jql: "a = 1" }, { id: "x", name: "no jql" }, null],
    [{ name: "Team", jql: "project = WEB" }, { name: "" }],
  );
  assert.deepEqual(list.map((f) => f.id), ["mine", "reported", "recent", "fav:10100", "own:0:Team"]);
  assert.deepEqual(list.map((f) => f.source), ["builtin", "builtin", "builtin", "favourite", "own"]);
  assert.equal(filterList(undefined, undefined).length, 3);
});

test("pickFilter: the remembered one, else Assigned to me", () => {
  const list = filterList([{ id: "1", name: "F", jql: "x" }], []);
  assert.equal(pickFilter(list, "fav:1").name, "F");
  assert.equal(pickFilter(list, "fav:gone").id, "mine");
  assert.equal(pickFilter(list, undefined).id, "mine");
});

test("pollDue", () => {
  const now = 1e9;
  assert.equal(pollDue({ shown: true, lastAt: undefined, now }), true);
  assert.equal(pollDue({ shown: true, lastAt: now - SHOWN_EVERY_MS + 1, now }), false);
  assert.equal(pollDue({ shown: true, lastAt: now - SHOWN_EVERY_MS, now }), true);
  assert.equal(pollDue({ shown: false, lastAt: now - SHOWN_EVERY_MS, now }), false);
  assert.equal(pollDue({ shown: false, lastAt: now - HIDDEN_EVERY_MS, now }), true);
  assert.equal(pollDue({ shown: true, lastAt: now - SHOWN_EVERY_MS, failed: true, now }), false);
  assert.equal(pollDue({ shown: true, lastAt: now - RETRY_AFTER_MS, failed: true, now }), true);
});

test("pageState", () => {
  const ok = { settings: { baseUrl: "https://j" }, token: "t" };
  assert.equal(pageState({ settings: { baseUrl: "" }, token: "t" }), "setup");
  assert.equal(pageState({ ...ok, token: null }), "setup");
  assert.equal(pageState({ ...ok, editing: true }), "settings");
  assert.equal(pageState({ ...ok, checking: true }), "checking");
  assert.equal(pageState({ ...ok, connected: false }), "checking");
  assert.equal(pageState({ ...ok, connected: true, problem: { kind: "auth" } }), "problem");
  assert.equal(pageState({ ...ok, connected: true }), "ready");
});

test("badgeFor and countText", () => {
  assert.deepEqual(badgeFor(4), { count: 4, tone: "info" });
  assert.equal(badgeFor(undefined), null);
  assert.equal(countText(12, 12), "12 issues");
  assert.equal(countText(1, 1), "1 issue");
  assert.equal(countText(50, 120), "50 of 120");
  assert.equal(countText(0, undefined), "");
});
