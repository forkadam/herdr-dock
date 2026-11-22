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
  assert.equal(me.data.displayName, "Mock User");
});

test("search: assigned to me and unresolved, newest first, with only the asked fields", async () => {
  const r = await search("assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC", "&fields=summary,status");
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 10);
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
  assert.equal((await search("project in (WEB, OPS)")).data.total, 20);
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
  assert.equal(a.data.total, 30);
  assert.equal(a.data.maxResults, 10);
  assert.equal(b.data.startAt, 10);
  assert.equal(new Set([...keys(a), ...keys(b)]).size, 20);
});

test("search: JQL outside the subset and unknown projects are 400s in Jira's shape", async () => {
  for (const jql of ["sprint in openSprints()", "assignee = currentUser() OR reporter = currentUser()", "project = NOPE"]) {
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
