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

// ---- Task 6: actions ----
import { actionOutcome, canAssignToMe, commentReady, withComment } from "../src/shared/jira/page.js";

test("canAssignToMe: hidden when it's already mine, or before Jira says who I am", () => {
  const me = { name: "me", displayName: "Mock User" };
  assert.equal(canAssignToMe({ assigneeName: null }, me), true);
  assert.equal(canAssignToMe({ assigneeName: "dana" }, me), true);
  assert.equal(canAssignToMe({ assigneeName: "Me" }, me), false);
  assert.equal(canAssignToMe({ assigneeName: null }, null), false);
  assert.equal(canAssignToMe(null, me), false);
});

test("actionOutcome: what each action says when it worked", () => {
  assert.deepEqual(actionOutcome("transition", { ok: true }, { to: "In Review" }), { ok: true, message: "Moved to In Review." });
  assert.deepEqual(actionOutcome("assign", { ok: true }), { ok: true, message: "Assigned to you." });
  assert.deepEqual(actionOutcome("comment", { ok: true }), { ok: true, message: "Comment added." });
});

test("actionOutcome: a workflow step that wants fields points at the browser", () => {
  const r = actionOutcome("transition", { ok: false, problem: { kind: "invalid", message: "Jira refused the request. Resolution is required.", hint: "x", fields: ["resolution"] } },
    { to: "Done", url: "https://j/browse/A-1" });
  assert.equal(r.ok, false);
  assert.equal(r.message, "Jira wants more for this step (resolution): open it in the browser.");
  assert.equal(r.link, "https://j/browse/A-1");
});

test("actionOutcome: any other failure gives Jira's message and the hint", () => {
  const r = actionOutcome("comment", { ok: false, problem: { kind: "server", message: "Jira had a server error.", hint: "Try again in a minute." } });
  assert.deepEqual(r, { ok: false, message: "Jira had a server error. Try again in a minute." });
});

test("commentReady: something to send", () => {
  assert.equal(commentReady("  "), false);
  assert.equal(commentReady(""), false);
  assert.equal(commentReady(" ok "), true);
});

test("withComment: the new comment shows at once, last 5 kept, total counted", () => {
  const d = { comments: [1, 2, 3, 4, 5].map((n) => ({ id: String(n), author: "a", bodyText: `c${n}`, createdMs: n })), commentTotal: 7 };
  const next = withComment(d, { id: "9", author: { displayName: "Mock User" }, body: "*new*", created: "2026-11-22T10:00:00.000+0000" });
  assert.equal(next.comments.length, 5);
  assert.deepEqual(next.comments.at(-1), { id: "9", author: "Mock User", bodyText: "new", createdMs: Date.parse("2026-11-22T10:00:00.000+0000") });
  assert.equal(next.comments[0].id, "2");
  assert.equal(next.commentTotal, 8);
  assert.equal(d.comments.length, 5); // not changed in place
});
