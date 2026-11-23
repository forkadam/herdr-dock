// The mock Jira (scripts/mock-jira.mjs): the REST v2 endpoints the Jira page uses, with Jira's JSON shapes.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startMock } from "../scripts/mock-jira.mjs";

const NOW = Date.parse("2026-11-22T12:00:00.000Z");
let mock;
before(async () => { mock = await startMock({ port: 0, now: NOW }); });
after(() => mock.close());

const call = async (path, { method = "GET", body, token = "mock-token", base = mock.url } = {}) => {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
};
const search = (jql, extra = "") => call(`/rest/api/2/search?jql=${encodeURIComponent(jql)}${extra}`);
const keys = (r) => r.data.issues.map((i) => i.key);

test("serverInfo needs no token; everything else wants the Bearer token", async () => {
  const info = await call("/rest/api/2/serverInfo", { token: null });
  assert.equal(info.status, 200);
  assert.equal(info.data.deploymentType, "Server");
  assert.deepEqual(info.data.versionNumbers.slice(0, 1), [9]);
  for (const token of [null, "wrong"]) {
    const r = await call("/rest/api/2/myself", { token });
    assert.equal(r.status, 401);
    assert.ok(r.data.errorMessages.length);
  }
  const me = await call("/rest/api/2/myself");
  assert.equal(me.status, 200);
  assert.equal(me.data.name, "me");
  assert.equal(me.data.key, "JIRAUSER10000"); // as Jira Server's newer users: the key is not the name
  assert.equal(me.data.displayName, "Mock User");
});

test("search: assigned to me and unresolved, newest first, with only the asked fields", async () => {
  const r = await search("assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC", "&fields=summary,status");
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 19);
  assert.equal(r.data.startAt, 0);
  const i = r.data.issues[0];
  assert.deepEqual(Object.keys(i.fields).sort(), ["status", "summary"]);
  assert.ok(i.key && i.id && i.self);
  const all = await search("assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC", "&fields=updated,assignee,resolution");
  const times = all.data.issues.map((x) => Date.parse(x.fields.updated));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  assert.ok(all.data.issues.every((x) => x.fields.assignee.name === "me" && x.fields.resolution === null));
});

test("dates are shifted so the newest update is minutes before `now`", async () => {
  const r = await search("ORDER BY updated DESC", "&maxResults=1&fields=updated");
  const age = NOW - Date.parse(r.data.issues[0].fields.updated);
  assert.ok(age > 0 && age <= 60 * 60e3, `newest is ${age} ms old`);
});

test("search: the JQL subset", async () => {
  assert.ok(keys(await search("project = API")).every((k) => k.startsWith("API-")));
  assert.equal((await search("project in (WEB, OPS)")).data.total, 30);
  assert.ok((await search('status = "In Progress"', "&fields=status")).data.issues.every((i) => i.fields.status.name === "In Progress"));
  assert.ok((await search("statusCategory != Done", "&fields=status")).data.issues.every((i) => i.fields.status.statusCategory.key !== "done"));
  assert.ok((await search('statusCategory = "In Progress"', "&fields=status")).data.issues.every((i) => i.fields.status.statusCategory.key === "indeterminate"));
  assert.equal((await search("assignee is EMPTY")).data.total, 4);
  assert.ok((await search("reporter = currentUser()", "&fields=reporter")).data.issues.every((i) => i.fields.reporter.name === "me"));
  assert.ok((await search("issuetype = Bug", "&fields=issuetype")).data.issues.every((i) => i.fields.issuetype.name === "Bug"));
  assert.deepEqual(keys(await search("key in (WEB-2, API-3) ORDER BY key ASC")), ["API-3", "WEB-2"]);
  assert.deepEqual(keys(await search('text ~ "quota"')).sort(), ["API-2"]);
  const recent = await search("updated >= -2d", "&fields=updated");
  assert.ok(recent.data.issues.every((i) => NOW - Date.parse(i.fields.updated) <= 2 * 86400e3));
  assert.ok(recent.data.total > 0 && recent.data.total < 30);
  const prio = await search("project = WEB ORDER BY priority DESC", "&fields=priority");
  const ids = prio.data.issues.map((i) => Number(i.fields.priority.id));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test("search: paging with startAt and maxResults", async () => {
  const a = await search("ORDER BY key ASC", "&maxResults=10");
  const b = await search("ORDER BY key ASC", "&startAt=10&maxResults=10");
  assert.equal(a.data.total, 40);
  assert.equal(a.data.maxResults, 10);
  assert.equal(b.data.startAt, 10);
  assert.equal(new Set([...keys(a), ...keys(b)]).size, 20);
});

test("search: JQL outside the subset and unknown projects are 400s in Jira's shape", async () => {
  for (const jql of ["labels = urgent", "assignee = currentUser() OR reporter = currentUser()", "project = NOPE"]) {
    const r = await search(jql);
    assert.equal(r.status, 400, jql);
    assert.ok(Array.isArray(r.data.errorMessages) && r.data.errorMessages.length, jql);
    assert.deepEqual(r.data.errors, {});
  }
});

test("issue: full fields, 404 for an unknown key", async () => {
  const r = await call("/rest/api/2/issue/WEB-1");
  assert.equal(r.status, 200);
  assert.equal(r.data.key, "WEB-1");
  for (const f of ["summary", "description", "status", "issuetype", "priority", "comment", "issuelinks", "project"]) assert.ok(f in r.data.fields, f);
  const missing = await call("/rest/api/2/issue/WEB-999");
  assert.equal(missing.status, 404);
  assert.ok(missing.data.errorMessages.length);
});

test("favourite filters", async () => {
  const r = await call("/rest/api/2/filter/favourite");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.map((f) => f.name), ["My open bugs", "API in progress"]);
  for (const f of r.data) {
    assert.ok(f.jql && f.id && f.viewUrl);
    assert.equal((await search(f.jql)).status, 200, f.jql);
  }
});

test("transitions follow the workflow, move the issue, and a screen step wants its field", async () => {
  // Find a To Do issue and walk it to Done.
  const todo = (await search('status = "To Do" ORDER BY key ASC', "&maxResults=1")).data.issues[0].key;
  const names = async () => (await call(`/rest/api/2/issue/${todo}/transitions`)).data.transitions.map((t) => t.name);
  assert.deepEqual(await names(), ["Start progress"]);
  const go = (id, extra = {}) => call(`/rest/api/2/issue/${todo}/transitions`, { method: "POST", body: { transition: { id }, ...extra } });
  assert.equal((await go("99")).status, 400);
  assert.equal((await go("21")).status, 400); // not from To Do
  assert.equal((await go("11")).status, 204);
  assert.equal((await call(`/rest/api/2/issue/${todo}`)).data.fields.status.name, "In Progress");
  assert.equal((await go("21")).status, 204);
  const resolve = (await call(`/rest/api/2/issue/${todo}/transitions`)).data.transitions.find((t) => t.name === "Resolve");
  assert.equal(resolve.hasScreen, true);
  const bare = await go("31");
  assert.equal(bare.status, 400);
  assert.ok(bare.data.errors.resolution);
  assert.equal((await go("31", { fields: { resolution: { name: "Done" } } })).status, 204);
  const done = (await call(`/rest/api/2/issue/${todo}`)).data.fields;
  assert.equal(done.status.statusCategory.key, "done");
  assert.equal(done.resolution.name, "Done");
  assert.ok(!keys(await search(`key in (${todo}) AND resolution = Unresolved`)).length);
  assert.equal((await go("51")).status, 204);
  assert.equal((await call(`/rest/api/2/issue/${todo}`)).data.fields.resolution, null);
});

test("assign and comment", async () => {
  const free = (await search("assignee is EMPTY ORDER BY key ASC", "&maxResults=1")).data.issues[0].key;
  assert.equal((await call(`/rest/api/2/issue/${free}/assignee`, { method: "PUT", body: { name: "nobody" } })).status, 400);
  assert.equal((await call(`/rest/api/2/issue/${free}/assignee`, { method: "PUT", body: { name: "me" } })).status, 204);
  assert.equal((await call(`/rest/api/2/issue/${free}`)).data.fields.assignee.name, "me");
  assert.equal((await call(`/rest/api/2/issue/${free}/comment`, { method: "POST", body: { body: "  " } })).status, 400);
  const c = await call(`/rest/api/2/issue/${free}/comment`, { method: "POST", body: { body: "On it." } });
  assert.equal(c.status, 201);
  assert.equal(c.data.author.name, "me");
  const comments = (await call(`/rest/api/2/issue/${free}`)).data.fields.comment;
  assert.equal(comments.comments.at(-1).body, "On it.");
  assert.equal(comments.total, comments.comments.length);
});

test("failure switches: a server error on every authed call, and a slow server", async () => {
  const bad = await startMock({ port: 0, failStatus: 500 });
  try {
    assert.equal((await call("/rest/api/2/myself", { base: bad.url })).status, 500);
    assert.equal((await call("/rest/api/2/serverInfo", { base: bad.url, token: null })).status, 200);
  } finally { await bad.close(); }
  const slow = await startMock({ port: 0, slowMs: 300 });
  try {
    const t = Date.now();
    await call("/rest/api/2/myself", { base: slow.url });
    assert.ok(Date.now() - t >= 280);
  } finally { await slow.close(); }
});

test("each start has its own state", async () => {
  const other = await startMock({ port: 0 });
  try {
    const key = "OPS-1";
    await call(`/rest/api/2/issue/${key}/comment`, { base: other.url, method: "POST", body: { body: "only here" } });
    const here = (await call(`/rest/api/2/issue/${key}`)).data.fields.comment.comments;
    assert.ok(!here.some((c) => c.body === "only here"));
  } finally { await other.close(); }
});

test("search: escaped quotes and backslashes inside a quoted value", async () => {
  const r = await search('text ~ "say \\"hi\\" \\\\ there"');
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 0);
  assert.deepEqual(keys(await search('summary ~ "\\"quota\\""')), []);
  assert.equal((await search('text ~ "quota" AND project = API')).data.total, 1);
});

test("issueHistory(): the issues opened, most recently viewed first", async () => {
  const fresh = await startMock({ port: 0 });
  try {
    const get = (p) => call(p, { base: fresh.url });
    const viewed = async () => (await call(`/rest/api/2/search?jql=${encodeURIComponent("issuekey in issueHistory() ORDER BY lastViewed DESC")}`, { base: fresh.url })).data;
    assert.equal((await viewed()).total, 0);
    await get("/rest/api/2/issue/WEB-1");
    await new Promise((r) => setTimeout(r, 5));
    await get("/rest/api/2/issue/API-3");
    assert.deepEqual((await viewed()).issues.map((i) => i.key), ["API-3", "WEB-1"]);
    await new Promise((r) => setTimeout(r, 5));
    await get("/rest/api/2/issue/WEB-1");
    assert.deepEqual((await viewed()).issues.map((i) => i.key), ["WEB-1", "API-3"]);
    // A search's results are not "viewed"; an unknown key isn't either.
    await get("/rest/api/2/issue/NOPE-1");
    assert.equal((await viewed()).total, 2);
  } finally { await fresh.close(); }
});

test("project statuses: per issue type, every status of the workflow", async () => {
  const r = await call("/rest/api/2/project/WEB/statuses");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data) && r.data.length >= 1);
  for (const type of r.data) {
    assert.ok(type.name && Array.isArray(type.statuses));
    assert.deepEqual(type.statuses.map((x) => x.name), ["To Do", "In Progress", "In Review", "Resolved", "Done"]);
    assert.ok(type.statuses.every((x) => x.statusCategory?.key));
  }
  assert.equal((await call("/rest/api/2/project/NOPE/statuses")).status, 404);
});

test("transitions with expand=transitions.fields: a screen step lists its required fields and their allowed values", async () => {
  const own = await startMock({ port: 0 });
  try {
    const inReview = (await call(`/rest/api/2/search?jql=${encodeURIComponent('status = "In Review" ORDER BY key ASC')}&maxResults=1`, { base: own.url })).data.issues[0].key;
    const r = await call(`/rest/api/2/issue/${inReview}/transitions?expand=transitions.fields`, { base: own.url });
    const resolve = r.data.transitions.find((x) => x.name === "Resolve");
    assert.equal(resolve.fields.resolution.required, true);
    assert.equal(resolve.fields.resolution.name, "Resolution");
    assert.deepEqual(resolve.fields.resolution.allowedValues.map((v) => v.name), ["Done", "Won't Do", "Duplicate"]);
    assert.deepEqual(r.data.transitions.find((x) => x.name === "Close").fields, {});
    // Without expand, no fields (as Jira does).
    const plain = await call(`/rest/api/2/issue/${inReview}/transitions`, { base: own.url });
    assert.equal("fields" in plain.data.transitions[0], false);
  } finally { await own.close(); }
});

const agile = (path, opts) => call(`/rest/agile/1.0${path}`, opts);
test("agile: boards, configuration, sprints", async () => {
  assert.deepEqual((await agile("/board?type=scrum&name=WEB")).data.values.map((b) => b.name), ["WEB board"]);
  const cols = (await agile("/board/1/configuration")).data.columnConfig.columns;
  assert.deepEqual(cols.map((c) => c.name), ["To Do", "In Progress", "Done"]);
  assert.deepEqual(cols[1].statuses.map((s) => s.id), ["3", "10001", "10003"]);
  assert.deepEqual((await agile("/board/1/sprint?state=active")).data.values.map((s) => s.name), ["Sprint 42", "Otter Sprint 7"]);
  assert.deepEqual((await agile("/board/1/sprint?state=closed")).data.values.map((s) => s.name), ["Sprint 41"]);
});
test("search: sprint clauses, rank order, parent field", async () => {
  const r = await search("sprint = 42 AND assignee = currentUser() ORDER BY Rank", "&fields=parent,issuetype");
  assert.ok(keys(r).includes("WEB-41"));
  const sub = r.data.issues.find((i) => i.key === "WEB-41");
  assert.equal(sub.fields.parent.key, "WEB-40");
  assert.equal(sub.fields.issuetype.subtask, true);
  assert.equal((await search("sprint = 7 AND assignee = currentUser()")).data.total, 0);
  assert.ok((await search("sprint in openSprints() AND assignee = currentUser()")).data.total >= r.data.total);
});

test("agile boards: a list page in Jira's shape; type and name narrow it (name is a case-insensitive contains)", async () => {
  const r = await agile("/board?type=scrum&name=WEB");
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.startAt, r.data.maxResults, r.data.total, r.data.isLast], [0, 50, 1, true]);
  assert.deepEqual(Object.keys(r.data.values[0]).sort(), ["id", "name", "self", "type"]);
  assert.equal(r.data.values[0].id, 1);
  assert.equal(r.data.values[0].type, "scrum");
  assert.equal(r.data.values[0].self, `${mock.url}/rest/agile/1.0/board/1`);
  for (const name of ["web", "board", "B"]) assert.deepEqual((await agile(`/board?name=${name}`)).data.values.map((b) => b.id), [1], name);
  assert.equal((await agile("/board")).data.values.length, 1);
  for (const q of ["name=nope", "type=kanban"]) {
    const none = await agile(`/board?${q}`);
    assert.deepEqual([none.status, none.data.values, none.data.total, none.data.isLast], [200, [], 0, true], q);
  }
});

test("agile board configuration: columns of status ids that are the workflow's own", async () => {
  const r = await agile("/board/1/configuration");
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.id, r.data.name, r.data.type], [1, "WEB board", "scrum"]);
  assert.equal(r.data.columnConfig.constraintType, "none");
  const ids = r.data.columnConfig.columns.flatMap((c) => c.statuses.map((s) => s.id));
  assert.deepEqual(r.data.columnConfig.columns[0].statuses, [{ id: "10000", self: `${mock.url}/rest/api/2/status/10000` }]);
  assert.equal(new Set(ids).size, ids.length, "a status sits in one column");
  const known = (await call("/rest/api/2/status")).data.map((s) => s.id);
  assert.deepEqual([...ids].sort(), [...known].sort(), "the board maps every status of the workflow, and only those");
});

test("agile sprints: ordered by start, filtered by any listed state, dates ISO with Z shifted like the issues", async () => {
  const all = (await agile("/board/1/sprint")).data;
  assert.deepEqual(all.values.map((s) => s.name), ["Sprint 41", "Sprint 42", "Otter Sprint 7", "Sprint 43"]);
  assert.deepEqual(all.values.map((s) => s.id), [41, 42, 7, 43]);
  assert.deepEqual([all.startAt, all.maxResults, all.isLast], [0, 50, true]);
  assert.deepEqual((await agile("/board/1/sprint?state=active,future")).data.values.map((s) => s.name), ["Sprint 42", "Otter Sprint 7", "Sprint 43"]);
  assert.deepEqual((await agile("/board/1/sprint?state=future")).data.values.map((s) => s.name), ["Sprint 43"]);
  const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
  for (const s of all.values) {
    for (const k of ["id", "self", "state", "name", "startDate", "endDate", "originBoardId"]) assert.ok(k in s, `${s.name}.${k}`);
    assert.equal(s.originBoardId, 1);
    assert.equal(s.self, `${mock.url}/rest/agile/1.0/sprint/${s.id}`);
    assert.match(s.startDate, iso);
    assert.match(s.endDate, iso);
    assert.equal("completeDate" in s, s.state === "closed", `${s.name} completeDate`);
    if (s.state === "closed") assert.match(s.completeDate, iso);
    const [start, end] = [Date.parse(s.startDate), Date.parse(s.endDate)];
    assert.ok(start < end, s.name);
    if (s.state === "active") assert.ok(start <= NOW && NOW <= end, `${s.name} spans now`);
    if (s.state === "closed") assert.ok(end < NOW && Date.parse(s.completeDate) < NOW, `${s.name} is over`);
    if (s.state === "future") assert.ok(start > NOW, `${s.name} is ahead`);
  }
});

test("agile sprints: startAt and maxResults page the list, isLast says when it ends", async () => {
  const names = (r) => r.data.values.map((s) => s.name);
  const a = await agile("/board/1/sprint?maxResults=2");
  assert.deepEqual(names(a), ["Sprint 41", "Sprint 42"]);
  assert.deepEqual([a.data.startAt, a.data.maxResults, a.data.isLast], [0, 2, false]);
  const b = await agile("/board/1/sprint?startAt=2&maxResults=2");
  assert.deepEqual(names(b), ["Otter Sprint 7", "Sprint 43"]);
  assert.deepEqual([b.data.startAt, b.data.isLast], [2, true]);
  const c = await agile("/board/1/sprint?startAt=3&maxResults=2");
  assert.deepEqual([names(c), c.data.isLast], [["Sprint 43"], true]);
  assert.equal((await agile("/board/1/sprint?maxResults=500")).data.maxResults, 50); // Jira caps a page at 50
});

test("agile: an unknown board is a 404 in Jira's shape; the routes want the token; only GET", async () => {
  for (const path of ["/board/99/configuration", "/board/99/sprint"]) {
    const r = await agile(path);
    assert.equal(r.status, 404, path);
    assert.ok(r.data.errorMessages.length, path);
    assert.deepEqual(r.data.errors, {}, path);
  }
  for (const token of [null, "wrong"]) {
    for (const path of ["/board", "/board/1/configuration", "/board/1/sprint"]) {
      const r = await agile(path, { token });
      assert.equal(r.status, 401, path);
      assert.ok(r.data.errorMessages.length, path);
    }
  }
  assert.equal((await agile("/board", { method: "POST", body: {} })).status, 405);
  const bad = await startMock({ port: 0, failStatus: 500 });
  try { assert.equal((await agile("/board/1/sprint", { base: bad.url })).status, 500); } finally { await bad.close(); }
});

test("search: sprint = <id> is the issues in that sprint, a carry-over is in both; an unknown sprint is a 400", async () => {
  assert.deepEqual(keys(await search("sprint = 41 ORDER BY key ASC")), ["WEB-3", "WEB-8", "WEB-44"]);
  assert.deepEqual(keys(await search("sprint = 43")), ["WEB-10"]);
  assert.deepEqual(keys(await search("sprint = 7 ORDER BY key ASC")), ["WEB-9", "WEB-11"]);
  assert.ok(keys(await search("sprint = 42")).includes("WEB-8")); // carried over from Sprint 41
  assert.deepEqual(keys(await search("sprint = 42 AND assignee = currentUser() AND statusCategory != Done ORDER BY key ASC")), ["WEB-2", "WEB-4", "WEB-8", "WEB-41", "WEB-42", "WEB-43", "WEB-44", "WEB-45", "WEB-46"]);
  const none = await search("sprint = 999");
  assert.equal(none.status, 400);
  assert.match(none.data.errorMessages[0], /999.*Sprint/);
});

test("search: sprint in openSprints() is every active sprint, Otter's issues included", async () => {
  const open = keys(await search("sprint in openSprints()"));
  const both = [...keys(await search("sprint = 42")), ...keys(await search("sprint = 7"))];
  assert.deepEqual([...open].sort(), [...both].sort());
  assert.ok(!open.includes("WEB-3") && !open.includes("WEB-10"), "closed and future sprints are not open");
  assert.ok(open.includes("WEB-9"));
});

test("search: ORDER BY Rank follows the fixture's rank, Rank DESC reverses it", async () => {
  const jql = (order) => `sprint = 42 AND assignee = currentUser() ${order}`;
  const ranked = ["WEB-41", "WEB-4", "WEB-42", "WEB-2", "WEB-8", "WEB-6", "WEB-43", "WEB-44", "WEB-45", "WEB-46"];
  for (const order of ["ORDER BY Rank", "ORDER BY Rank ASC", "ORDER BY rank", "order by RANK asc"]) assert.deepEqual(keys(await search(jql(order))), ranked, order);
  assert.deepEqual(keys(await search(jql("ORDER BY Rank DESC"))), [...ranked].reverse());
  assert.notDeepEqual(keys(await search(jql("ORDER BY key ASC"))), ranked, "rank is not just the key order");
  const board = keys(await search("sprint = 42 ORDER BY Rank"));
  assert.deepEqual(board, ["WEB-40", "WEB-41", "WEB-1", "WEB-4", "WEB-42", "WEB-2", "WEB-7", "WEB-8", "WEB-5", "WEB-6", "WEB-43", "WEB-44", "WEB-45", "WEB-46"]);
});

test("search and issue: the mock's own sprints, rank and parent bookkeeping never reach the JSON", async () => {
  const everything = await search("sprint = 42", "&fields=*all");
  const one = await call("/rest/api/2/issue/WEB-41");
  const named = await search("sprint = 42", "&fields=sprints,rank,parentKey,summary");
  for (const r of [everything, one, named]) assert.doesNotMatch(JSON.stringify(r.data), /"(sprints|rank|parentKey)"\s*:/);
  assert.deepEqual(Object.keys(named.data.issues[0].fields), ["summary"]);
});

test("sub-tasks: a parent with its summary, status, priority and type; the parent's changes show; stories carry none", async () => {
  const own = await startMock({ port: 0 });
  try {
    const q = (jql, extra) => call(`/rest/api/2/search?jql=${encodeURIComponent(jql)}${extra}`, { base: own.url });
    const sub = (await q("key in (WEB-41)", "&fields=parent")).data.issues[0];
    assert.deepEqual(Object.keys(sub.fields), ["parent"]);
    const parent = sub.fields.parent;
    assert.deepEqual(Object.keys(parent).sort(), ["fields", "id", "key", "self"]);
    assert.equal(parent.key, "WEB-40");
    assert.equal(parent.self, `${own.url}/rest/api/2/issue/${parent.id}`);
    assert.deepEqual(Object.keys(parent.fields).sort(), ["issuetype", "priority", "status", "summary"]);
    assert.equal(parent.fields.issuetype.name, "Story");
    assert.equal(parent.fields.issuetype.subtask, false);
    assert.equal(parent.fields.status.name, "In Progress");
    assert.ok(parent.fields.summary && parent.fields.priority.name);
    // All fields (no `fields` asked, and on one issue) carry the parent too, and the sub-task type says so.
    const full = await call("/rest/api/2/issue/WEB-42", { base: own.url });
    assert.equal(full.data.fields.parent.key, "WEB-40");
    assert.equal(full.data.fields.issuetype.subtask, true);
    assert.equal(full.data.fields.issuetype.name, "Sub-task");
    // Only sub-tasks have one: the story asked for it gets no parent field.
    assert.deepEqual((await q("key in (WEB-40)", "&fields=parent")).data.issues[0].fields, {});
    assert.equal("parent" in (await call("/rest/api/2/issue/WEB-40", { base: own.url })).data.fields, false);
    // The parent is read live: moving the story moves what its sub-task says.
    const go = await call("/rest/api/2/issue/WEB-40/transitions", { base: own.url, method: "POST", body: { transition: { id: "21" } } });
    assert.equal(go.status, 204);
    assert.equal((await q("key in (WEB-41)", "&fields=parent")).data.issues[0].fields.parent.fields.status.name, "In Review");
    // The sub-tasks are the mock user's, unresolved, and findable by type.
    assert.deepEqual((await q("issuetype = Sub-task AND assignee = currentUser() AND resolution = Unresolved ORDER BY key ASC", "&fields=summary")).data.issues.map((i) => i.key), ["WEB-41", "WEB-42"]);
  } finally { await own.close(); }
});

test("project statuses: a sub-task type says it is one", async () => {
  const web = (await call("/rest/api/2/project/WEB/statuses")).data;
  assert.deepEqual(web.map((t) => [t.name, t.subtask]).sort(), [["Bug", false], ["Story", false], ["Sub-task", true], ["Task", false]]);
});

test("history: expand=changelog on search and issue, in Jira's shape", async () => {
  const r = await search("key = WEB-40", "&fields=summary&expand=changelog");
  const h = r.data.issues[0].changelog.histories;
  const desc = h.flatMap((x) => x.items.map((i) => ({ ...i, by: x.author.name }))).filter((i) => i.field === "description");
  assert.deepEqual(desc.map((d) => d.by), ["ana", "me", "ana"]); // oldest first, as in the fixture
  assert.ok(desc.every((d) => "fromString" in d && "toString" in d));
  assert.equal((await search("key = WEB-40", "&fields=summary")).data.issues[0].changelog, undefined);
  assert.ok((await call("/rest/api/2/issue/WEB-40?fields=description&expand=changelog")).data.changelog.histories.length >= 3);
  const resolved = await search('status = Resolved AND resolution = Unresolved AND issuetype = Bug');
  assert.equal(resolved.data.total, 1);
});

test("search: maxResults=0 is a count only, as Jira does: the total and no issues", async () => {
  const jql = "assignee = currentUser() AND resolution = Unresolved";
  const count = await search(jql, "&maxResults=0");
  assert.equal(count.status, 200);
  assert.deepEqual([count.data.maxResults, count.data.issues], [0, []]);
  const page = await search(jql);
  assert.ok(count.data.total > 0);
  assert.equal(count.data.total, page.data.total);
  assert.ok(page.data.issues.length > 0);
  // Left out, blank or not a number, a page is still 50.
  for (const extra of ["", "&maxResults=", "&maxResults=abc"]) assert.equal((await search("ORDER BY key ASC", extra)).data.maxResults, 50, extra);
});

test("search: key = and key != pick an issue or leave it out", async () => {
  assert.deepEqual(keys(await search("key = WEB-40")), ["WEB-40"]);
  assert.deepEqual(keys(await search("key = web-40 AND project = WEB")), ["WEB-40"]);
  assert.equal((await search("key = WEB-999")).data.total, 0);
  const all = (await search("ORDER BY key ASC")).data.total;
  const rest = await search("key != WEB-40", "&maxResults=100");
  assert.equal(rest.data.total, all - 1);
  assert.ok(!keys(rest).includes("WEB-40"));
});

// The cases the brief on Today is tried against. Their times are the fixture's, shifted with the issues' dates, so
// "after Sprint 42 started" holds whatever `now` is.
test("history: the fixture's cases, timed against Sprint 42's start", async () => {
  const start = Date.parse((await agile("/board/1/sprint?state=active")).data.values.find((s) => s.name === "Sprint 42").startDate);
  const open = async (key) => (await call(`/rest/api/2/issue/${key}?expand=changelog`)).data;
  const items = (issue, field) => issue.changelog.histories.flatMap((h) => h.items.filter((i) => i.field === field).map((i) => ({ ...i, by: h.author, at: Date.parse(h.created) })));
  const sprintItem = async (key) => { const [only, ...more] = items(await open(key), "Sprint"); assert.equal(more.length, 0, key); return only; };

  // WEB-40, the parent of the mock user's sub-tasks: three description edits in this sprint, whole texts, each from the last.
  const parent = await open("WEB-40");
  const edits = items(parent, "description");
  assert.deepEqual(edits.map((e) => e.by), [{ key: "ana", name: "ana", displayName: "Ana Lima" }, { key: "JIRAUSER10000", name: "me", displayName: "Mock User" }, { key: "ana", name: "ana", displayName: "Ana Lima" }]);
  assert.ok(edits.every((e, k) => e.at > start && e.at < NOW && (k === 0 || e.at > edits[k - 1].at)), "after the start, before now, oldest first");
  assert.ok(edits.every((e) => e.fieldtype === "jira" && e.from === null && e.to === null && e.fromString && e.toString));
  assert.ok(edits.every((e, k) => k === 0 || e.fromString === edits[k - 1].toString));
  assert.equal(edits.at(-1).toString, parent.fields.description, "the last edit is what the description is now");
  assert.ok(Date.parse(parent.fields.updated) >= edits.at(-1).at);
  assert.deepEqual(Object.keys(parent.changelog.histories[0]).sort(), ["author", "created", "id", "items"]);
  assert.deepEqual(Object.keys(parent.changelog.histories[0].author).sort(), ["displayName", "key", "name"]);
  assert.deepEqual([parent.changelog.startAt, parent.changelog.maxResults, parent.changelog.total], [0, parent.changelog.histories.length, parent.changelog.histories.length]);
  const ids = (await search("sprint in openSprints()", "&fields=summary&expand=changelog&maxResults=100")).data.issues.flatMap((i) => i.changelog.histories.map((h) => h.id));
  assert.ok(ids.every((id) => typeof id === "string") && new Set(ids).size === ids.length, "history ids are strings, one each");

  // Added to the sprint after it started: Sprint "" -> "42".
  const added = await sprintItem("WEB-43");
  assert.deepEqual([added.field, added.fieldtype, added.from, added.fromString, added.to, added.toString], ["Sprint", "custom", "", "", "42", "Sprint 42"]);
  assert.ok(added.at > start && added.at < NOW);
  assert.ok(Date.parse((await open("WEB-43")).fields.created) < start, "an issue from before the sprint");

  // A carry-over: it held Sprint 41 and now holds 41 and 42; that happened after the start too.
  const carried = await sprintItem("WEB-44");
  assert.deepEqual([carried.from, carried.fromString, carried.to, carried.toString], ["41", "Sprint 41", "41, 42", "Sprint 41, Sprint 42"]);
  assert.ok(carried.at > start && carried.at < NOW);
  assert.ok(Date.parse((await open("WEB-44")).fields.created) < start);

  // Reassigned to the mock user after the start; it was already in the sprint. `from` and `to` are user keys.
  const reassigned = await open("WEB-45");
  const [to] = items(reassigned, "assignee");
  assert.deepEqual([to.fieldtype, to.from, to.fromString, to.to, to.toString], ["jira", "dana", "Dana Lee", "JIRAUSER10000", "Mock User"]);
  assert.ok(to.at > start && to.at < NOW);
  assert.equal(reassigned.fields.assignee.name, "me");
  assert.equal(items(reassigned, "Sprint").length, 0);
  assert.ok(Date.parse(reassigned.fields.created) < start);

  // Created into the sprint after the start: its `created` says so, its history has no Sprint item.
  const created = await open("WEB-46");
  assert.ok(Date.parse(created.fields.created) > start);
  assert.deepEqual(created.changelog, { startAt: 0, maxResults: 0, total: 0, histories: [] });
  const mine = keys(await search("sprint = 42 AND assignee = currentUser()"));
  for (const key of ["WEB-43", "WEB-44", "WEB-45", "WEB-46"]) assert.ok(mine.includes(key), `${key} is the mock user's, in Sprint 42`);
});

test("history: an issue without any has an empty one; nothing of it is sent unless asked for", async () => {
  const quiet = (await call("/rest/api/2/issue/WEB-1?expand=changelog")).data;
  assert.deepEqual(quiet.changelog, { startAt: 0, maxResults: 0, total: 0, histories: [] });
  const everything = await search("ORDER BY key ASC", "&maxResults=100&fields=*all");
  assert.ok(everything.data.issues.length > 30);
  assert.doesNotMatch(JSON.stringify(everything.data), /"(changelog|histories|history)"\s*:/);
  const asked = await search("ORDER BY key ASC", "&maxResults=100&fields=summary&expand=changelog");
  assert.ok(asked.data.issues.every((i) => Array.isArray(i.changelog.histories)));
  assert.doesNotMatch(JSON.stringify(asked.data), /"history"\s*:/); // the fixture's own key never goes out
  // One of several expand names still asks for it; another alone does not.
  assert.ok((await call("/rest/api/2/issue/WEB-40?expand=renderedFields,changelog")).data.changelog);
  assert.equal((await call("/rest/api/2/issue/WEB-40?expand=renderedFields")).data.changelog, undefined);
});

test("workflow: Resolved is an in-progress status that holds one unresolved bug; the new issues carry P0-P3", async () => {
  const resolved = (await call("/rest/api/2/status")).data.find((s) => s.name === "Resolved");
  assert.equal(resolved.statusCategory.key, "indeterminate");
  const bugs = (await search("status = Resolved", "&fields=issuetype,resolution,status,assignee")).data.issues;
  assert.deepEqual(bugs.map((i) => [i.fields.issuetype.name, i.fields.resolution, i.fields.status.statusCategory.key, i.fields.assignee.name]), [["Bug", null, "indeterminate", "me"]]);
  const p = (await search('priority in (P0, P1, P2, P3) ORDER BY priority DESC', "&fields=priority&maxResults=100")).data.issues;
  assert.deepEqual([...new Set(p.map((i) => `${i.fields.priority.id}:${i.fields.priority.name}`))].sort(), ["1:P0", "2:P1", "3:P2", "4:P3"]);
  // The high-priority bugs the brief lists: P0 and P1 bugs of the mock user, one of them waiting in Resolved.
  const high = await search('issuetype = Bug AND assignee = currentUser() AND resolution = Unresolved AND priority in (P0, P1) ORDER BY priority DESC', "&fields=status");
  assert.deepEqual(high.data.issues.map((i) => i.fields.status.name).sort(), ["In Progress", "Resolved", "To Do"]);
});

test("history: of the mock user's Sprint 42 issues only the deliberate cases are new in it", async () => {
  const sprint = (await agile("/board/1/sprint?state=active")).data.values.find((s) => s.name === "Sprint 42");
  const start = Date.parse(sprint.startDate);
  const mine = (await search("sprint = 42 AND assignee = currentUser() ORDER BY key ASC", "&fields=created&expand=changelog&maxResults=100")).data.issues;
  assert.ok(mine.length >= 10);
  // Created after the sprint started: just the one issue made into it.
  assert.deepEqual(mine.filter((i) => Date.parse(i.fields.created) > start).map((i) => i.key), ["WEB-46"]);
  // The rules the brief reads history by: a Sprint item after the start bringing in Sprint 42 is added, unless it keeps
  // every sprint its `from` held (a carry-over); an assignee item to the mock user (its key) after the start is assigned.
  const me = (await call("/rest/api/2/myself")).data;
  const why = (i) => {
    const after = i.changelog.histories.filter((h) => Date.parse(h.created) > start).flatMap((h) => h.items);
    const ids = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const carried = (x) => ids(x.from).length > 0 && ids(x.from).every((id) => ids(x.to).includes(id));
    if (after.some((x) => x.field === "Sprint" && ids(x.to).includes("42") && !ids(x.from).includes("42") && !carried(x))) return "added";
    if (Date.parse(i.fields.created) > start) return "created";
    if (after.some((x) => x.field === "assignee" && x.to === me.key)) return "assigned";
    return null;
  };
  assert.deepEqual(Object.fromEntries(mine.map((i) => [i.key, why(i)]).filter(([, w]) => w)), { "WEB-43": "added", "WEB-45": "assigned", "WEB-46": "created" });
  assert.equal(why(mine.find((i) => i.key === "WEB-44")), null, "the carry-over is not new");
});
