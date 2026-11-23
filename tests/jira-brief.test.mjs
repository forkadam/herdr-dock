// The brief model (src/shared/jira/brief.js): what Today's brief asks Jira, which description edits and sprint
// arrivals are new, the read marks, the badge and the "check against my work" message. Times in the message are
// local, so pin the zone.
process.env.TZ = "UTC";

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHECK_TASK } from "../src/shared/jira/settings.js";
import {
  briefBadge, briefLists, bugsSearch, changeDiff, changedItem, changedSearches, checkMessage, checkWork, descriptionEdits, editsText,
  isUnread, newInSprintItem, pruneBugs, readAll, readOnOpen, recentEdits, sinceMinutes, subtasksByParent, withRead,
} from "../src/shared/jira/brief.js";

const me = "me";
const edit = (author, created, from, to) => ({ author: { name: author }, created, items: [{ field: "description", fromString: from, toString: to }] });
const issue = { key: "WEB-40", fields: { summary: "Story" }, changelog: { histories: [
  edit("ana", "2026-11-12T10:00:00.000+0000", "v1", "v2"),
  edit(me, "2026-11-13T10:00:00.000+0000", "v2", "v3"),
  edit("ana", "2026-11-19T15:46:00.000+0000", "v3", "v4"),
  edit("ana", "2026-11-19T15:54:00.000+0000", "v4", "v5"),
] } };

// ---- what it asks Jira ----

test("sinceMinutes: minutes since the sprint started, else 14 days", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  assert.equal(sinceMinutes({ id: 42, startMs: Date.parse("2026-11-16T00:00:00Z") }, now), 3 * 24 * 60 + 12 * 60);
  assert.equal(sinceMinutes({ id: 42, startMs: now - 90_000 }, now), 2); // a started minute counts: never short
  assert.equal(sinceMinutes(null, now), 14 * 24 * 60);
  assert.equal(sinceMinutes({ id: 42, startMs: null }, now), 14 * 24 * 60);
  assert.equal(sinceMinutes({ id: 42, startMs: now + 1000 }, now), 14 * 24 * 60); // not started yet
});

test("changedSearches: parents split by 50", () => {
  const keys = Array.from({ length: 120 }, (_, i) => `WEB-${i}`);
  const q = changedSearches({ since: 10080, parentKeys: keys });
  assert.equal(q.length, 4);
  assert.equal(q[0], "assignee = currentUser() AND resolution = Unresolved AND updated >= -10080m");
  assert.ok(q[3].startsWith("key in (WEB-100,"));
});

test("changedSearches: no parents is one search; 50 parents fit one", () => {
  assert.deepEqual(changedSearches({ since: 60, parentKeys: [] }), ["assignee = currentUser() AND resolution = Unresolved AND updated >= -60m"]);
  const keys = Array.from({ length: 50 }, (_, i) => `WEB-${i}`);
  assert.equal(changedSearches({ since: 60, parentKeys: keys }).length, 2);
  assert.equal(changedSearches({ since: 60, parentKeys: [...keys, "WEB-50"] }).length, 3);
  assert.equal(changedSearches({ since: 60, parentKeys: ["WEB-1", "WEB-2"] })[1], "key in (WEB-1,WEB-2) AND updated >= -60m");
});

test("changedSearches: only well-formed issue keys go into key in (...)", () => {
  const q = changedSearches({ since: 5, parentKeys: ["WEB-1) OR (project = X", "WEB-2", "web-3", "WEB_X9-10", "WEB-2", "", " WEB-4", "WEB-5\n", "WEB", "WEB-", "1WEB-6", null, 7, { key: "WEB-8" }] });
  assert.deepEqual(q, ["assignee = currentUser() AND resolution = Unresolved AND updated >= -5m", "key in (WEB-2,web-3,WEB_X9-10) AND updated >= -5m"]);
  // nothing well-formed left: no parents search at all
  assert.equal(changedSearches({ since: 5, parentKeys: ["WEB-1) OR (project = X", "x y-1"] }).length, 1);
});

test("bugsSearch keeps ORDER BY last", () => {
  assert.equal(bugsSearch({ briefBugs: "issuetype = Bug ORDER BY updated DESC", highPriorities: ["P0", "P1"] }),
    'issuetype = Bug AND priority in ("P0", "P1") ORDER BY updated DESC');
});

test("bugsSearch: no ORDER BY, none to narrow with, quotes inside a name", () => {
  assert.equal(bugsSearch({ briefBugs: "issuetype = Bug", highPriorities: ["High"] }), 'issuetype = Bug AND priority in ("High")');
  assert.equal(bugsSearch({ briefBugs: "issuetype = Bug ORDER BY updated DESC", highPriorities: [] }), "issuetype = Bug ORDER BY updated DESC");
  assert.equal(bugsSearch({ briefBugs: "issuetype = Bug", highPriorities: ['P"0'] }), 'issuetype = Bug AND priority in ("P\\"0")');
  assert.equal(bugsSearch({ briefBugs: "issuetype = Bug order  by updated", highPriorities: ["P0"] }), 'issuetype = Bug AND priority in ("P0") order  by updated');
});

test("bugsSearch: an OR in the bugs query is grouped so the priority still narrows all of it", () => {
  assert.equal(bugsSearch({ briefBugs: "issuetype = Bug OR labels = urgent ORDER BY rank", highPriorities: ["P0"] }),
    '(issuetype = Bug OR labels = urgent) AND priority in ("P0") ORDER BY rank');
  // "order by" and "or" inside a quoted value are text, not clauses
  assert.equal(bugsSearch({ briefBugs: 'summary ~ "order by or" AND issuetype = Bug', highPriorities: ["P0"] }),
    'summary ~ "order by or" AND issuetype = Bug AND priority in ("P0")');
});

// ---- Changed ----

test("descriptionEdits: only description items by someone else, oldest first", () => {
  const mixed = { key: "WEB-1", fields: {}, changelog: { histories: [
    { author: { name: "bo", displayName: "Bo Lin" }, created: "2026-11-19T10:00:00.000+0000", items: [{ field: "description", fromString: "b", toString: "c" }] },
    { author: { name: "ana" }, created: "2026-11-18T10:00:00.000+0000", items: [{ field: "status", fromString: "Open", toString: "Done" }] },
    { author: { name: "ana" }, created: "2026-11-17T10:00:00.000+0000", items: [{ field: "description", fromString: null, toString: "b" }] },
    { author: { name: me }, created: "2026-11-16T10:00:00.000+0000", items: [{ field: "description", fromString: "a", toString: "b" }] },
  ] } };
  assert.deepEqual(descriptionEdits(mixed, { me }), [
    { at: Date.parse("2026-11-17T10:00:00Z"), author: "ana", from: "", to: "b" },
    { at: Date.parse("2026-11-19T10:00:00Z"), author: "Bo Lin", from: "b", to: "c" },
  ]);
  assert.deepEqual(descriptionEdits({ key: "WEB-1", fields: {} }, { me }), []);
});

test("changedItem: others' edits since the window or the read mark", () => {
  const c = changedItem(issue, { me, sinceMs: Date.parse("2026-11-16T00:00:00Z"), marks: {} });
  assert.equal(c.edits.length, 2);
  assert.equal(c.before, "v3");
  assert.equal(c.after, "v5");
  const read = withRead({}, "changed", c);
  assert.equal(changedItem(issue, { me, sinceMs: 0, marks: read }), null);
});

test("changedItem: the item's shape, and a newer edit after a read mark is unread again", () => {
  const c = changedItem(issue, { me, sinceMs: 0, marks: {} });
  assert.deepEqual(Object.keys(c).sort(), ["after", "at", "before", "edits", "key", "summary"]);
  assert.equal(c.key, "WEB-40");
  assert.equal(c.summary, "Story");
  assert.equal(c.edits.length, 3); // from the window: Nov 12 and both Nov 19 edits (the Nov 13 one is yours)
  assert.equal(c.at, Date.parse("2026-11-19T15:54:00Z"));
  // the mark covers the first Nov 19 edit only: the later one is what's left
  const partly = changedItem(issue, { me, sinceMs: 0, marks: { "WEB-40": { changed: Date.parse("2026-11-19T15:46:00Z") } } });
  assert.deepEqual([partly.edits.length, partly.before, partly.after], [1, "v4", "v5"]);
  // the window can start later than the mark
  assert.equal(changedItem(issue, { me, sinceMs: Date.parse("2026-11-19T15:50:00Z"), marks: { "WEB-40": { changed: 1 } } }).edits.length, 1);
});

test("changedItem: null without a changelog or without description edits by others", () => {
  assert.equal(changedItem({ key: "WEB-1", fields: { summary: "s" } }, { me, sinceMs: 0, marks: {} }), null);
  const mine = { key: "WEB-1", fields: { summary: "s" }, changelog: { histories: [edit(me, "2026-11-19T10:00:00.000+0000", "a", "b")] } };
  assert.equal(changedItem(mine, { me, sinceMs: 0, marks: {} }), null);
  assert.equal(changedItem({ key: "WEB-1", fields: {}, changelog: { histories: [] } }, { me, sinceMs: 0, marks: {} }), null);
});

// ---- New in sprint ----

test("newInSprintItem: added, carried over, created, assigned", () => {
  const sprint = { id: 42, startMs: Date.parse("2026-11-16T00:00:00Z") };
  const before = "2026-11-01T00:00:00.000+0000", after = "2026-11-18T00:00:00.000+0000";
  const h = (at, items, created = before) => ({ key: "WEB-1", fields: { summary: "s", created }, changelog: { histories: [{ author: { name: "lead" }, created: at, items }] } });
  const added = newInSprintItem(h(after, [{ field: "Sprint", from: "", to: "42" }]), { sprint, me });
  assert.deepEqual([added.why, added.sprintId], ["added", 42]);
  assert.equal(newInSprintItem(h(after, [{ field: "Sprint", from: "41", to: "41, 42" }]), { sprint, me }), null);
  assert.equal(newInSprintItem(h(after, [{ field: "assignee", to: me }]), { sprint, me }).why, "assigned");
  assert.equal(newInSprintItem(h(after, [], after), { sprint, me }).why, "created");
  assert.equal(newInSprintItem(h(before, [{ field: "Sprint", from: "", to: "42" }]), { sprint, me }), null); // before the start
});

test("newInSprintItem: the item's shape and when it happened", () => {
  const sprint = { id: 42, startMs: Date.parse("2026-11-16T00:00:00Z") };
  const at = "2026-11-18T09:30:00.000+0000";
  const mk = (items, created = "2026-11-01T00:00:00.000+0000") => ({ key: "WEB-1", fields: { summary: "Do it", created }, changelog: { histories: [{ author: { name: "lead" }, created: at, items }] } });
  assert.deepEqual(newInSprintItem(mk([{ field: "Sprint", from: "", to: "42" }]), { sprint, me }),
    { key: "WEB-1", summary: "Do it", why: "added", at: Date.parse(at), sprintId: 42 });
  assert.deepEqual(newInSprintItem(mk([{ field: "assignee", to: me }]), { sprint, me }),
    { key: "WEB-1", summary: "Do it", why: "assigned", at: Date.parse(at), sprintId: 42 });
  const made = { key: "WEB-2", fields: { summary: "New", created: at } };
  assert.deepEqual(newInSprintItem(made, { sprint, me }), { key: "WEB-2", summary: "New", why: "created", at: Date.parse(at), sprintId: 42 }); // no changelog needed
});

test("newInSprintItem: sprint ids are a comma list compared as text; other sprints, assignees and no start are not new", () => {
  const sprint = { id: 42, startMs: Date.parse("2026-11-16T00:00:00Z") };
  const mk = (items, created = "2026-11-01T00:00:00.000+0000") => ({ key: "WEB-1", fields: { summary: "s", created }, changelog: { histories: [{ author: { name: "lead" }, created: "2026-11-18T00:00:00.000+0000", items }] } });
  assert.equal(newInSprintItem(mk([{ field: "Sprint", from: "", to: "43,42" }]), { sprint, me }).why, "added");
  assert.equal(newInSprintItem(mk([{ field: "Sprint", from: null, to: "42 , 43" }]), { sprint, me }).why, "added");
  assert.equal(newInSprintItem(mk([{ field: "Sprint", from: "", to: "142" }]), { sprint, me }), null); // 142 is not 42
  assert.equal(newInSprintItem(mk([{ field: "Sprint", from: "", to: "43" }]), { sprint, me }), null);
  assert.equal(newInSprintItem(mk([{ field: "assignee", to: "ana" }]), { sprint, me }), null);
  assert.equal(newInSprintItem(mk([{ field: "Sprint", from: "", to: "42" }]), { sprint: { id: 42, startMs: null }, me }), null);
  assert.equal(newInSprintItem({ key: "WEB-1", fields: { summary: "s" } }, { sprint, me }), null);
});

test("newInSprintItem: a carry-over does not hide a later assignment to you; added wins over assigned", () => {
  const sprint = { id: 42, startMs: Date.parse("2026-11-16T00:00:00Z") };
  const h = (created, items) => ({ author: { name: "lead" }, created, items });
  const carried = h("2026-11-16T00:00:01.000+0000", [{ field: "Sprint", from: "41", to: "41, 42" }]);
  const assigned = h("2026-11-18T00:00:00.000+0000", [{ field: "assignee", to: me }]);
  const added = h("2026-11-17T00:00:00.000+0000", [{ field: "Sprint", from: "", to: "42" }]);
  const mk = (...histories) => ({ key: "WEB-1", fields: { summary: "s", created: "2026-11-01T00:00:00.000+0000" }, changelog: { histories } });
  const a = newInSprintItem(mk(carried, assigned), { sprint, me });
  assert.deepEqual([a.why, a.at], ["assigned", Date.parse("2026-11-18T00:00:00Z")]);
  assert.equal(newInSprintItem(mk(added, assigned), { sprint, me }).why, "added");
});

// ---- you, by key and by name (Jira Server's history names users by key) ----

const you = { key: "JIRAUSER10000", name: "me" };

test("newInSprintItem: an assignment to you is matched by your user key (as Jira Server writes it), or by your name", () => {
  const sprint = { id: 42, startMs: Date.parse("2026-11-16T00:00:00Z") };
  const mk = (to) => ({ key: "WEB-1", fields: { summary: "s", created: "2026-11-01T00:00:00.000+0000" },
    changelog: { histories: [{ author: { key: "lead", name: "lead" }, created: "2026-11-18T00:00:00.000+0000", items: [{ field: "assignee", from: "ana", to }] }] } });
  assert.equal(newInSprintItem(mk("JIRAUSER10000"), { sprint, me: you }).why, "assigned"); // the key
  assert.equal(newInSprintItem(mk("me"), { sprint, me: you }).why, "assigned"); // a Jira that writes names
  assert.equal(newInSprintItem(mk("JIRAUSER10001"), { sprint, me: you }), null);
  // A plain string is your name, as before.
  assert.equal(newInSprintItem(mk("me"), { sprint, me: "me" }).why, "assigned");
  assert.equal(newInSprintItem(mk("JIRAUSER10000"), { sprint, me: "me" }), null);
  // A key or name Jira didn't send matches nothing.
  assert.equal(newInSprintItem(mk(undefined), { sprint, me: { name: "me" } }), null);
  assert.equal(newInSprintItem(mk(null), { sprint, me: { key: null, name: "me" } }), null);
  assert.equal(newInSprintItem(mk(""), { sprint, me: { key: "", name: "" } }), null);
  assert.equal(newInSprintItem(mk("JIRAUSER10000"), { sprint, me: null }), null);
});

test("descriptionEdits and changedItem: an edit is yours when its author's key or its name is yours", () => {
  const by = (author) => ({ key: "WEB-1", fields: { summary: "s" },
    changelog: { histories: [{ author, created: "2026-11-19T10:00:00.000+0000", items: [{ field: "description", fromString: "a", toString: "b" }] }] } });
  assert.deepEqual(descriptionEdits(by({ key: "JIRAUSER10000", name: "me", displayName: "Me" }), { me: you }), []);
  assert.deepEqual(descriptionEdits(by({ key: "JIRAUSER10000", name: "renamed" }), { me: you }), []); // the key still says so
  assert.deepEqual(descriptionEdits(by({ name: "me" }), { me: you }), []); // no key sent: the name
  assert.equal(descriptionEdits(by({ key: "JIRAUSER10001", name: "ana" }), { me: you }).length, 1);
  assert.equal(changedItem(by({ key: "JIRAUSER10000", name: "x" }), { me: you, sinceMs: 0, marks: {} }), null);
  assert.equal(changedItem(by({ key: "JIRAUSER10001", name: "ana" }), { me: you, sinceMs: 0, marks: {} }).edits.length, 1);
  // Key against key, name against name: another user whose key is your name is someone else.
  assert.equal(descriptionEdits(by({ key: "me", name: "someone" }), { me: you }).length, 1);
  assert.equal(descriptionEdits(by({ key: "x", name: "JIRAUSER10000" }), { me: you }).length, 1);
  // A plain string is your name, as before.
  assert.deepEqual(descriptionEdits(by({ key: "JIRAUSER10000", name: "me" }), { me: "me" }), []);
  assert.equal(descriptionEdits(by({ key: "JIRAUSER10000", name: "other" }), { me: "me" }).length, 1);
  // An author without a key or name is never you.
  assert.equal(descriptionEdits(by({}), { me: { key: undefined, name: undefined } }).length, 1);
  assert.equal(descriptionEdits(by({ displayName: "Ghost" }), { me: you }).length, 1);
});

test("recentEdits: your own edits are left out by your key too", () => {
  const histories = [
    { author: { key: "JIRAUSER10000", name: "me" }, created: "2026-11-19T10:00:00.000+0000", items: [{ field: "description", fromString: "a", toString: "b" }] },
    { author: { key: "ana", name: "ana" }, created: "2026-11-19T11:00:00.000+0000", items: [{ field: "description", fromString: "b", toString: "c" }] },
  ];
  assert.deepEqual(recentEdits(histories, { me: you, sinceMs: 0 }).map((e) => e.author), ["ana"]);
});

// ---- the read marks and the badge ----

test("isUnread: each kind has its own mark", () => {
  assert.equal(isUnread("changed", { key: "WEB-7", at: 5 }, {}), true);
  assert.equal(isUnread("changed", { key: "WEB-7", at: 5 }, { "WEB-7": { changed: 4 } }), true);
  assert.equal(isUnread("changed", { key: "WEB-7", at: 5 }, { "WEB-7": { changed: 5 } }), false);
  assert.equal(isUnread("changed", { key: "WEB-7", at: 5 }, { "WEB-7": { changed: 9 } }), false);
  assert.equal(isUnread("sprint", { key: "WEB-7", sprintId: 42 }, {}), true);
  assert.equal(isUnread("sprint", { key: "WEB-7", sprintId: 42 }, { "WEB-7": { sprint: 41 } }), true); // the next sprint's arrival is new again
  assert.equal(isUnread("sprint", { key: "WEB-7", sprintId: 42 }, { "WEB-7": { sprint: 42 } }), false);
  assert.equal(isUnread("bug", { key: "WEB-7" }, {}), true);
  assert.equal(isUnread("bug", { key: "WEB-7" }, { "WEB-7": { bug: true } }), false);
  assert.equal(isUnread("bug", { key: "WEB-7" }, { "WEB-7": { changed: 3 } }), true); // another kind's mark doesn't count
  assert.equal(isUnread("bug", { key: "WEB-7" }, null), true);
});

test("withRead: a new marks object that keeps the key's other marks", () => {
  const marks = { "WEB-7": { changed: 3 }, "WEB-8": { bug: true } };
  const bug = withRead(marks, "bug", { key: "WEB-7" });
  assert.deepEqual(bug, { "WEB-7": { changed: 3, bug: true }, "WEB-8": { bug: true } });
  assert.deepEqual(marks, { "WEB-7": { changed: 3 }, "WEB-8": { bug: true } }); // not changed in place
  assert.deepEqual(withRead({}, "changed", { key: "WEB-7", at: 8 }), { "WEB-7": { changed: 8 } });
  assert.deepEqual(withRead({}, "sprint", { key: "WEB-7", sprintId: 42 }), { "WEB-7": { sprint: 42 } });
  assert.deepEqual(withRead({ "WEB-7": { sprint: 41, bug: true } }, "sprint", { key: "WEB-7", sprintId: 42 }), { "WEB-7": { sprint: 42, bug: true } });
  assert.equal(isUnread("changed", { key: "WEB-7", at: 8 }, withRead({}, "changed", { key: "WEB-7", at: 8 })), false);
});

test("briefBadge: unread only; warn when a bug is unread", () => {
  const items = { changed: [{ key: "WEB-40", at: 5 }], sprint: [], bugs: [{ key: "WEB-7" }] };
  assert.deepEqual(briefBadge(items, {}), { count: 2, tone: "warn" });
  assert.deepEqual(briefBadge(items, { "WEB-7": { bug: true } }), { count: 1, tone: "info" });
  assert.equal(briefBadge({ changed: [], sprint: [], bugs: [] }, {}), null);
  assert.deepEqual(pruneBugs({ "WEB-7": { bug: true, changed: 3 } }, []), { "WEB-7": { changed: 3 } });
});

test("briefBadge: counts the three lists by their own marks; read everything is no badge", () => {
  const items = { changed: [{ key: "WEB-40", at: 5 }, { key: "WEB-41", at: 6 }], sprint: [{ key: "WEB-42", sprintId: 42 }], bugs: [{ key: "WEB-7" }, { key: "WEB-8" }] };
  const marks = { "WEB-40": { changed: 5 }, "WEB-42": { sprint: 42 }, "WEB-7": { bug: true } };
  assert.deepEqual(briefBadge(items, marks), { count: 2, tone: "warn" }); // WEB-41 changed, WEB-8 bug
  assert.deepEqual(briefBadge({ ...items, bugs: [{ key: "WEB-7" }] }, marks), { count: 1, tone: "info" });
  assert.deepEqual(briefBadge({ changed: [], sprint: [{ key: "WEB-42", sprintId: 42 }], bugs: [] }, {}), { count: 1, tone: "info" });
  assert.equal(briefBadge({ ...items, changed: [items.changed[0]], bugs: [{ key: "WEB-7" }] }, marks), null);
});

test("pruneBugs: drops the mark of a bug that left the list, and an entry left empty", () => {
  const marks = { "WEB-7": { bug: true }, "WEB-8": { bug: true }, "WEB-9": { bug: true, sprint: 42 }, "WEB-10": { changed: 4 } };
  assert.deepEqual(pruneBugs(marks, ["WEB-8"]), { "WEB-8": { bug: true }, "WEB-9": { sprint: 42 }, "WEB-10": { changed: 4 } });
  assert.deepEqual(marks["WEB-7"], { bug: true }); // not changed in place
});

// ---- the message ----

test("checkMessage never carries description text", () => {
  const c = changedItem(issue, { me, sinceMs: 0, marks: {} });
  const msg = checkMessage(DEFAULT_CHECK_TASK, { key: c.key, summary: "Story", edits: c.edits, mine: ["WEB-41", "WEB-42"] });
  assert.ok(msg.includes("WEB-41, WEB-42"));
  for (const v of ["v2", "v4", "v5"]) assert.ok(!msg.includes(v), v);
});

test("checkMessage: {when} is the span of the edits", () => {
  const at = (s) => ({ at: Date.parse(s), author: "ana", from: "a", to: "b" });
  const msg = (edits) => checkMessage("{key} ({summary}) {when} on {mine}", { key: "WEB-40", summary: "Story", edits, mine: ["WEB-41"] });
  assert.equal(msg([at("2026-11-19T15:46:00Z"), at("2026-11-19T15:54:00Z")]), "WEB-40 (Story) Nov 19 15:46–15:54 on WEB-41");
  assert.equal(msg([at("2026-11-19T15:46:00Z")]), "WEB-40 (Story) Nov 19 15:46 on WEB-41");
  assert.equal(msg([at("2026-11-19T15:46:10Z"), at("2026-11-19T15:46:50Z")]), "WEB-40 (Story) Nov 19 15:46 on WEB-41"); // the same minute twice is one time
  assert.equal(msg([at("2026-11-12T10:00:00Z"), at("2026-11-19T15:54:00Z")]), "WEB-40 (Story) Nov 12 – Nov 19 on WEB-41");
  assert.equal(msg([at("2026-11-19T23:50:00Z"), at("2026-11-20T00:05:00Z")]), "WEB-40 (Story) Nov 19 – Nov 20 on WEB-41"); // across midnight is two days
  assert.equal(msg([at("2026-11-19T00:05:00Z")]), "WEB-40 (Story) Nov 19 00:05 on WEB-41"); // 24-hour clock: 00:05, not 24:05
  assert.equal(msg([at("2026-11-19T09:05:00Z")]), "WEB-40 (Story) Nov 19 09:05 on WEB-41"); // two digits
  assert.equal(msg([at("2026-11-19T15:54:00Z"), at("2026-11-19T15:46:00Z")]), "WEB-40 (Story) Nov 19 15:46–15:54 on WEB-41"); // the order of the edits doesn't matter
});

test("checkMessage: unknown placeholders stay, and a value's braces are not filled in again", () => {
  const edits = [{ at: Date.parse("2026-11-19T15:46:00Z"), author: "ana", from: "a", to: "b" }];
  assert.equal(checkMessage("{key} {who} {when}", { key: "WEB-40", summary: "s", edits, mine: [] }), "WEB-40 {who} Nov 19 15:46");
  assert.equal(checkMessage("{summary} / {key}", { key: "WEB-40", summary: "see {key}", edits, mine: [] }), "see {key} / WEB-40");
  assert.equal(checkMessage("{key} {key}", { key: "WEB-40", summary: "s", edits, mine: [] }), "WEB-40 WEB-40");
});

// ---- the page's lists and what a click marks read ----

const brief = {
  changed: [{ key: "WEB-40", at: 5, edits: [] }, { key: "WEB-41", at: 9, edits: [] }],
  sprint: [{ key: "WEB-43", why: "added", at: 3, sprintId: 42 }, { key: "WEB-46", why: "created", at: 7, sprintId: 42 }],
  bugs: [{ key: "WEB-47", at: 1 }, { key: "WEB-48", at: 2 }, { key: "WEB-46", at: 4 }],
};

test("briefLists: Changed and New in sprint unread only, newest first; every bug, unread ones first", () => {
  const marks = { "WEB-41": { changed: 9 }, "WEB-43": { sprint: 42 }, "WEB-47": { bug: true } };
  const l = briefLists(brief, marks);
  assert.deepEqual(l.changed.map((x) => x.key), ["WEB-40"]);
  assert.deepEqual(l.sprint.map((x) => x.key), ["WEB-46"]);
  assert.deepEqual(l.bugs.map((x) => [x.key, x.unread]), [["WEB-48", true], ["WEB-46", true], ["WEB-47", false]]);
  assert.deepEqual(briefLists(brief, {}).changed.map((x) => x.key), ["WEB-41", "WEB-40"]);
  assert.deepEqual(brief.changed.map((x) => x.key), ["WEB-40", "WEB-41"]); // the brief itself isn't sorted in place
  assert.deepEqual(briefLists(undefined, {}), { changed: [], sprint: [], bugs: [] });
});

test("readOnOpen: opening an issue (from anywhere) reads its New-in-sprint and bug items, not its Changed item", () => {
  const marks = readOnOpen({}, brief, "WEB-46");
  assert.deepEqual(marks, { "WEB-46": { sprint: 42, bug: true } });
  assert.deepEqual(readOnOpen({ "WEB-40": { sprint: 41 } }, brief, "WEB-40"), { "WEB-40": { sprint: 41 } }); // only a Changed item: nothing
  const before = { "WEB-46": { sprint: 42, bug: true } };
  assert.equal(readOnOpen(before, brief, "WEB-46"), before); // already read: the same object, nothing to save
  assert.equal(readOnOpen(before, brief, "WEB-99"), before);
});

test("readAll: every unread item of the three lists; nothing unread is the same object", () => {
  const marks = readAll({ "WEB-40": { sprint: 41 } }, brief);
  assert.deepEqual(marks, {
    "WEB-40": { sprint: 41, changed: 5 }, "WEB-41": { changed: 9 }, "WEB-43": { sprint: 42 },
    "WEB-46": { sprint: 42, bug: true }, "WEB-47": { bug: true }, "WEB-48": { bug: true },
  });
  assert.equal(briefBadge(brief, marks), null);
  assert.equal(readAll(marks, brief), marks);
  // a mark that already covers a later edit is never moved back
  assert.deepEqual(readAll({ "WEB-40": { changed: 99 } }, { changed: [{ key: "WEB-40", at: 5 }] }), { "WEB-40": { changed: 99 } });
});

// ---- reading a change ----

test("changeDiff: Jira markup as text on both sides; a trailing line break is not a removed line", () => {
  assert.deepEqual(changeDiff("h1. Goal\nShip *it*", "h1. Goal\nShip *it* now"),
    [{ op: "same", text: "Goal" }, { op: "del", text: "Ship it" }, { op: "add", text: "Ship it now" }]);
  assert.deepEqual(changeDiff("a\nb\n", "a\nb"), [{ op: "same", text: "a" }, { op: "same", text: "b" }]);
  assert.deepEqual(changeDiff("", "new"), [{ op: "add", text: "new" }]);
  assert.deepEqual(changeDiff(null, null), []);
});

test("editsText: how many edits, by whom, and when", () => {
  const e = (author, s) => ({ at: Date.parse(s), author, from: "", to: "" });
  assert.equal(editsText([e("Ana", "2026-11-19T15:46:00Z"), e("Ana", "2026-11-19T15:54:00Z")]), "2 edits by Ana, Nov 19 15:46–15:54");
  assert.equal(editsText([e("Ana", "2026-11-12T10:00:00Z"), e("Bo", "2026-11-19T15:54:00Z"), e("Cy", "2026-11-19T16:00:00Z")]), "3 edits by Ana, Bo and Cy, Nov 12 – Nov 19");
  assert.equal(editsText([e("", "2026-11-19T15:46:00Z")]), "1 edit, Nov 19 15:46");
  assert.equal(editsText([e("Ana", "2026-11-19T15:46:00Z")], { when: false }), "1 edit by Ana");
  assert.equal(editsText([]), "0 edits");
});

test("recentEdits: others' description edits since the window's start, newest first", () => {
  const histories = issue.changelog.histories;
  const r = recentEdits(histories, { me, sinceMs: Date.parse("2026-11-13T00:00:00Z") });
  assert.deepEqual(r.map((x) => [x.to, x.author]), [["v5", "ana"], ["v4", "ana"]]);
  assert.equal(recentEdits(histories, { me, sinceMs: 0 }).length, 3);
  assert.deepEqual(recentEdits(undefined, { me, sinceMs: 0 }), []);
});

// ---- Check against my work ----

test("subtasksByParent: your sub-tasks' keys by parent, each once, in key order; issues without a parent are left out", () => {
  const issues = [
    { key: "WEB-42", fields: { parent: { key: "WEB-40" } } }, { key: "WEB-41", fields: { parent: { key: "WEB-40" } } },
    { key: "WEB-41", fields: { parent: { key: "WEB-40" } } }, { key: "API-3", fields: { parent: { key: "API-1" } } },
    { key: "WEB-43", fields: {} }, { key: "WEB-44" }, null, { fields: { parent: { key: "WEB-40" } } },
  ];
  assert.deepEqual([...subtasksByParent(issues)], [["WEB-40", ["WEB-41", "WEB-42"]], ["API-1", ["API-3"]]]);
  const many = ["WEB-10", "WEB-9", "WEB-100"].map((key) => ({ key, fields: { parent: { key: "WEB-1" } } }));
  assert.deepEqual(subtasksByParent(many).get("WEB-1"), ["WEB-9", "WEB-10", "WEB-100"]);
  assert.equal(subtasksByParent(undefined).size, 0);
});

test("checkWork: a Claude tab '<key> check' with checkMessage's text; {mine} your sub-tasks under it, else the key", () => {
  const item = changedItem(issue, { me, sinceMs: 0, marks: {} });
  const subtasks = new Map([["WEB-40", ["WEB-41", "WEB-42"]]]);
  const c = checkWork(item, { template: "{key} ({summary}) changed {when}: check {mine}", subtasks });
  assert.deepEqual(c, { command: "tab.new", args: { name: "WEB-40 check", argv: ["claude"], task: "WEB-40 (Story) changed Nov 12 – Nov 19: check WEB-41, WEB-42" } });
  assert.equal(checkWork(item, { template: "{mine}", subtasks: new Map() }).args.task, "WEB-40");
  assert.equal(checkWork(item, { template: "{mine}", subtasks: new Map([["WEB-40", []]]) }).args.task, "WEB-40");
  const full = checkWork(item, { template: DEFAULT_CHECK_TASK, subtasks }).args.task;
  for (const v of ["v2", "v4", "v5"]) assert.ok(!full.includes(v), v); // never the description's text
  assert.equal(checkWork(null, { template: "{key}" }), null);
});
