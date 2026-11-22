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

// ---- Task 7: Start work ----
import { startWork } from "../src/shared/jira/page.js";

test("startWork: a Claude tab named after the issue, its first message from the template", () => {
  const d = { key: "API-2", summary: "Enforce daily search quota", url: "https://j/browse/API-2", description: "Long text" };
  assert.deepEqual(startWork(d, "/init-ticket {key}"), { command: "tab.new", args: { name: "API-2", argv: ["claude"], task: "/init-ticket API-2" } });
  assert.equal(startWork(d, "").args.task, "Work on Jira issue API-2: Enforce daily search quota\nhttps://j/browse/API-2");
  // From a list row (no description fetched yet) it still works.
  assert.equal(startWork({ key: "X-1", summary: "s", url: "u" }, "{key} {description}").args.task, "X-1 ");
  assert.equal(startWork(null, "x"), null);
});

// ---- Final review fixes ----
import { needsDetail, refreshSize } from "../src/shared/jira/page.js";

test("refreshSize: a refresh keeps the rows already loaded (Load more), within a cap", () => {
  assert.equal(refreshSize(0), 50);
  assert.equal(refreshSize(30), 50);
  assert.equal(refreshSize(150), 150);
  assert.equal(refreshSize(900), 200);
});

test("needsDetail: a list row lacks the description, so a template using it needs the full issue", () => {
  assert.equal(needsDetail("/init-ticket {key}"), false);
  assert.equal(needsDetail("{key}\\n{description}"), true);
  assert.equal(needsDetail(""), false); // the default template
  assert.equal(needsDetail(undefined), false);
});

// ---- Deferred minors ----
import { CLEARED_VIEW, afterProblem, previewTask } from "../src/shared/jira/page.js";

test("afterProblem: a rejected token clears the badge and stops polling until the user acts; others keep retrying", () => {
  assert.deepEqual(afterProblem("auth"), { connected: false, clearBadge: true, pause: true });
  assert.deepEqual(afterProblem("forbidden"), { connected: false, clearBadge: true, pause: true });
  assert.deepEqual(afterProblem("offline"), { connected: true, clearBadge: false, pause: false });
  assert.deepEqual(afterProblem("server"), { connected: true, clearBadge: false, pause: false });
});

test("previewTask: the message as it will be sent; from a row, the description is named, not left empty", () => {
  const row = { key: "A-1", summary: "s", url: "u" };
  assert.equal(previewTask(row, "/t {key}"), "/t A-1");
  assert.equal(previewTask(row, "{key} {description}"), "A-1 (its description, fetched when you start)");
  assert.equal(previewTask({ ...row, description: "real" }, "{key} {description}"), "A-1 real");
  assert.equal(previewTask(null, "x"), "");
});

test("CLEARED_VIEW: what a new Jira address (or Disconnect) forgets", () => {
  for (const k of ["rows", "total", "selected", "detail", "favourites", "statusOrder", "me", "fetchedAt", "listProblem", "transitions", "actionMsg"]) {
    assert.ok(k in CLEARED_VIEW, k);
  }
  assert.deepEqual(CLEARED_VIEW.rows, []);
  assert.ok(Object.isFrozen(CLEARED_VIEW));
});

// ---- Board drag and drop ----
import { DRAG_START_PX, dragColumns, dragStarted, dropPlan, dropTargets } from "../src/shared/jira/page.js";

const tr = (id, name, to, category = "indeterminate") => ({ id, name, to: { name: to, statusCategory: { key: category } } });
const TRANSITIONS = [tr("21", "Send to review", "In Review"), tr("41", "Back to To Do", "To Do", "new"), tr("31", "Resolve", "Done", "done"), tr("61", "Close", "Done", "done")];

test("dropTargets: the statuses this issue can move to now (its own status is not one)", () => {
  assert.deepEqual([...dropTargets(TRANSITIONS, "In Progress")].sort(), ["Done", "In Review", "To Do"]);
  assert.deepEqual([...dropTargets([tr("9", "Loop", "In Progress")], "In Progress")], []);
  assert.deepEqual([...dropTargets(null, "x")], []);
});

test("dropPlan: one transition runs, several ask, none (or its own column) does nothing", () => {
  assert.deepEqual(dropPlan(TRANSITIONS, "In Review", "In Progress"), { kind: "run", transition: TRANSITIONS[0] });
  assert.deepEqual(dropPlan(TRANSITIONS, "Done", "In Progress"), { kind: "choose", transitions: [TRANSITIONS[2], TRANSITIONS[3]] });
  assert.deepEqual(dropPlan(TRANSITIONS, "Blocked", "In Progress"), { kind: "none" });
  assert.deepEqual(dropPlan(TRANSITIONS, "In Progress", "In Progress"), { kind: "none" });
  assert.deepEqual(dropPlan("loading", "Done", "In Progress"), { kind: "none" });
});

test("dragColumns: a reachable status with no column gets an empty one, placed by category then Jira's order", () => {
  const cols = [
    { status: "To Do", category: "new", rows: [1] },
    { status: "In Progress", category: "indeterminate", rows: [2] },
  ];
  const targets = new Set(["To Do", "In Review", "Done"]);
  const out = dragColumns(cols, targets, TRANSITIONS, ["To Do", "In Progress", "In Review", "Done"]);
  assert.deepEqual(out.map((c) => [c.status, c.rows.length, Boolean(c.temporary)]),
    [["To Do", 1, false], ["In Progress", 1, false], ["In Review", 0, true], ["Done", 0, true]]);
  assert.equal(out[3].category, "done");
  // Not dragging: the columns as they are.
  assert.equal(dragColumns(cols, new Set(), [], []), cols);
});

test("dragStarted: a press becomes a drag only once the pointer has moved a few pixels (a click stays a click)", () => {
  assert.equal(dragStarted({ x: 10, y: 10 }, { x: 12, y: 11 }), false);
  assert.equal(dragStarted({ x: 10, y: 10 }, { x: 10 + DRAG_START_PX, y: 10 }), true);
  assert.equal(dragStarted(null, { x: 0, y: 0 }), false);
});
