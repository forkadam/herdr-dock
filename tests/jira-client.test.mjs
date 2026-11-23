// The Jira client (src/shared/jira/client.js) against the mock Jira, through both transports. Node's fetch and
// child_process stand in for Herdr's fetch and exec (same shapes).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "../src/shared/jira/client.js";
import { curlConfig } from "../src/shared/jira/transport.js";
import { startMock } from "../scripts/mock-jira.mjs";

const hasCurl = spawnSync("curl", ["--version"]).status === 0;
const exec = (command, args, options = {}) => new Promise((ok, fail) => {
  execFile(command, args, { timeout: options.timeout ?? 30000, encoding: "utf8" }, (e, stdout, stderr) => {
    if (e && typeof e.code !== "number") return fail(e); // couldn't start
    ok({ code: e ? e.code : 0, stdout, stderr });
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const io = { fetch: (u, o) => fetch(u, o), exec, sleep };

let mock, dir;
before(async () => {
  mock = await startMock({ port: 0 });
  dir = mkdtempSync(join(tmpdir(), "jira-client-"));
});
after(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

function client(transport, { token = "mock-token", base = mock.url, timeoutMs } = {}) {
  const curlConfigPath = join(dir, `${transport}-${token.replace(/\W/g, "")}.curlrc`);
  writeFileSync(curlConfigPath, curlConfig(token));
  return createClient({ base, transport, token, curlConfigPath, io, timeoutMs });
}

for (const transport of ["fetch", "curl"]) {
  const skip = transport === "curl" && !hasCurl ? "curl not installed" : false;

  test(`${transport}: every call against the mock`, { skip }, async (t) => {
    const own = await startMock({ port: 0 }); // its own data: the other transport's tests change theirs
    t.after(() => own.close());
    const c = client(transport, { base: own.url });
    const info = await c.serverInfo();
    assert.equal(info.ok, true);
    assert.equal(info.data.deploymentType, "Server");
    assert.equal((await c.myself()).data.name, "me");
    const s = await c.search("assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC", { maxResults: 5 });
    assert.equal(s.ok, true);
    assert.equal(s.data.total, 12);
    assert.equal(s.data.issues.length, 5);
    const key = s.data.issues[0].key;
    const issue = await c.issue(key);
    assert.equal(issue.data.key, key);
    assert.ok("comment" in issue.data.fields && "description" in issue.data.fields);
    assert.equal((await c.favouriteFilters()).data.length, 2);
    assert.deepEqual((await c.statuses()).data.map((x) => x.name), ["To Do", "In Progress", "In Review", "Done"]);
    const ps = await c.projectStatuses("API");
    assert.equal(ps.ok, true);
    assert.deepEqual(ps.data, [{ name: "To Do", category: "new" }, { name: "In Progress", category: "indeterminate" }, { name: "In Review", category: "indeterminate" }, { name: "Done", category: "done" }]);
    const tr = await c.transitions(key);
    assert.ok(tr.ok && Array.isArray(tr.data) && tr.data.length);
    const comment = await c.comment(key, `from ${transport}`);
    assert.equal(comment.ok, true);
    assert.equal(comment.data.body, `from ${transport}`);
    assert.equal((await c.assign(key, "me")).ok, true);
  });

  test(`${transport}: a transition, and one that wants a field`, { skip }, async (t) => {
    const own = await startMock({ port: 0 });
    t.after(() => own.close());
    const c = client(transport, { base: own.url });
    const key = (await c.search('status = "In Review" ORDER BY key ASC', { maxResults: 1 })).data.issues[0].key;
    const resolve = (await c.transitions(key)).data.find((x) => x.name === "Resolve");
    // The client asks for the fields, so a step's required ones (and their choices) come along.
    assert.deepEqual(resolve.fields.resolution.allowedValues.map((v) => v.name), ["Done", "Won't Do", "Duplicate"]);
    const bare = await c.transition(key, resolve.id);
    assert.equal(bare.ok, false);
    assert.equal(bare.problem.kind, "invalid");
    assert.deepEqual(bare.problem.fields, ["resolution"]);
    const done = await c.transition(key, resolve.id, { resolution: { name: "Done" } });
    assert.equal(done.ok, true);
    assert.equal((await c.issue(key)).data.fields.status.name, "Done");
  });

  test(`${transport}: boards, configuration, sprints`, { skip }, async () => {
    const c = client(transport);
    assert.deepEqual((await c.boards("WEB")).data.map((b) => b.id), [1]);
    assert.deepEqual((await c.boardConfiguration(1)).data.columns[1], { name: "In Progress", statusIds: ["3", "10001"] });
    const s = (await c.sprints(1, ["active"])).data;
    assert.deepEqual(s.map((x) => x.name), ["Sprint 42", "Otter Sprint 7"]);
    assert.ok(Number.isFinite(s[0].startMs) && typeof s[0].id === "number");
  });

  test(`${transport}: an issue's history call returns its description and a list of histories`, { skip }, async () => {
    const r = await client(transport).issueHistory("WEB-1");
    assert.equal(r.ok, true);
    assert.equal(typeof r.data.description, "string");
    assert.ok(Array.isArray(r.data.histories));
    assert.equal((await client(transport).issueHistory("WEB-999")).problem.kind, "notfound");
  });

  test(`${transport}: wrong token, bad JQL, unknown issue`, { skip }, async () => {
    const wrong = await client(transport, { token: "nope" }).myself();
    assert.equal(wrong.ok, false);
    assert.equal(wrong.problem.kind, "auth");
    assert.ok(!wrong.problem.message.includes("nope"));
    const bad = await client(transport).search("labels = urgent");
    assert.equal(bad.problem.kind, "invalid");
    assert.match(bad.problem.message, /Unable to parse/);
    assert.equal((await client(transport).issue("WEB-999")).problem.kind, "notfound");
  });

  test(`${transport}: Jira not running, a 500, a slow Jira`, { skip }, async () => {
    const gone = await startMock({ port: 0 });
    const url = gone.url;
    await gone.close();
    assert.equal((await client(transport, { base: url }).myself()).problem.kind, "offline");
    const broken = await startMock({ port: 0, failStatus: 500 });
    try { assert.equal((await client(transport, { base: broken.url }).myself()).problem.kind, "server"); } finally { await broken.close(); }
    const slow = await startMock({ port: 0, slowMs: 2500 });
    try {
      const r = await client(transport, { base: slow.url, timeoutMs: 1000 }).myself();
      assert.equal(r.ok, false);
      assert.equal(r.problem.kind, "timeout");
    } finally { await slow.close(); }
  });
}

// A Jira the test scripts: each request's URL is kept, and `page(url)` answers with { status, body }.
function stubClient(page) {
  const seen = [];
  const fetch = async (url) => {
    seen.push(new URL(url));
    const { status = 200, body } = page(new URL(url));
    return { status, text: async () => JSON.stringify(body) };
  };
  return { seen, c: createClient({ base: "https://j", transport: "fetch", token: "t", io: { fetch } }) };
}
const sprintValues = (from, n) => Array.from({ length: n }, (_, i) => ({ id: from + i, name: `S${from + i}`, state: "closed", startDate: "2026-01-05T09:00:00.000Z", endDate: "garbage" }));

test("sprints: follows isLast through pages of 50, mapping ids and dates", async () => {
  const { seen, c } = stubClient((u) => {
    const at = Number(u.searchParams.get("startAt"));
    return { body: { startAt: at, maxResults: 50, isLast: at >= 100, values: sprintValues(at + 1, at >= 100 ? 7 : 50) } };
  });
  const r = await c.sprints(7, ["closed", "active"]);
  assert.equal(r.ok, true);
  assert.equal(r.data.length, 107);
  assert.deepEqual(seen.map((u) => u.searchParams.get("startAt")), ["0", "50", "100"]);
  assert.ok(seen.every((u) => u.pathname === "/rest/agile/1.0/board/7/sprint" && u.searchParams.get("maxResults") === "50" && u.searchParams.get("state") === "closed,active"));
  assert.deepEqual(r.data[0], { id: 1, name: "S1", state: "closed", startMs: Date.parse("2026-01-05T09:00:00.000Z"), endMs: null });
});

test("sprints: stops at 20 pages however long Jira says it goes on", async () => {
  const { seen, c } = stubClient((u) => ({ body: { isLast: false, values: sprintValues(Number(u.searchParams.get("startAt")) + 1, 50) } }));
  const r = await c.sprints(1, ["closed"]);
  assert.equal(r.ok, true);
  assert.equal(seen.length, 20);
  assert.equal(r.data.length, 1000);
});

test("sprints: a page that fails fails the call", async () => {
  const { c } = stubClient((u) => (u.searchParams.get("startAt") === "0"
    ? { body: { isLast: false, values: sprintValues(1, 50) } }
    : { status: 500, body: { errorMessages: ["boom"] } }));
  const r = await c.sprints(1, ["closed"]);
  assert.equal(r.ok, false);
  assert.equal(r.problem.kind, "server");
});

// The new agile calls get whatever Jira (or a proxy in front of it) sends: odd entries are skipped, never thrown on.
const junk = [null, 5, "x", true, [], {}];

test("boards: entries that aren't boards are skipped, and a body that isn't a list gives none", async () => {
  const board = { id: 1, name: "WEB board", type: "scrum" };
  const ok = await stubClient(() => ({ body: { values: [...junk, { name: "no id" }, { id: null, name: "null id" }, board] } })).c.boards();
  assert.deepEqual(ok, { ok: true, status: 200, data: [board] });
  for (const body of [null, {}, { values: null }, { values: {} }, "text", 7]) {
    const r = await stubClient(() => ({ body })).c.boards("WEB");
    assert.deepEqual([r.ok, r.data], [true, []], JSON.stringify(body));
  }
});

test("boardConfiguration: columns that aren't objects with a name, and statuses with no id, are skipped", async () => {
  const body = { columnConfig: { columns: [...junk, { name: "To Do", statuses: [...junk, { id: "1" }, { id: null }, { id: 10000 }, { self: "no id" }] }, { name: "Done" }, { name: "Odd", statuses: "x" }] } };
  const r = await stubClient(() => ({ body })).c.boardConfiguration(1);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.columns.map((c) => [c.name, c.statusIds]), [["To Do", ["1", "10000"]], ["Done", []], ["Odd", []]]);
  for (const odd of [null, {}, { columnConfig: null }, { columnConfig: { columns: "x" } }, "text"]) {
    assert.deepEqual((await stubClient(() => ({ body: odd })).c.boardConfiguration(1)).data, { columns: [] }, JSON.stringify(odd));
  }
});

test("sprints: entries without a usable id are skipped, and paging goes on past them; states that aren't a list mean no filter", async () => {
  const bad = [...junk, { name: "no id" }, { id: null }, { id: "" }, { id: "x" }];
  const { seen, c } = stubClient((u) => (u.searchParams.get("startAt") === "0"
    ? { body: { isLast: false, values: [...bad, ...sprintValues(1, 2)] } }
    : { body: { isLast: true, values: [{ id: 9, name: "Last", state: "future" }, null] } }));
  const r = await c.sprints(1, null);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.map((x) => x.id), [1, 2, 9]);
  assert.deepEqual(seen.map((u) => u.searchParams.get("startAt")), ["0", String(bad.length + 2)]);
  assert.ok(seen.every((u) => !u.searchParams.has("state")));
  assert.deepEqual(r.data[2], { id: 9, name: "Last", state: "future", startMs: null, endMs: null });
  for (const states of [undefined, "active", 5, {}, []]) {
    const one = stubClient(() => ({ body: { isLast: true, values: sprintValues(1, 1) } }));
    assert.equal((await one.c.sprints(1, states)).ok, true, String(states));
    assert.equal(one.seen[0].searchParams.has("state"), false, String(states));
  }
  const some = stubClient(() => ({ body: { isLast: true, values: [] } }));
  await some.c.sprints(1, ["active", null, 3, "future"]);
  assert.equal(some.seen[0].searchParams.get("state"), "active,future");
  for (const body of [null, {}, { values: "x" }, { isLast: false }]) {
    const e = await stubClient(() => ({ body })).c.sprints(1, ["active"]);
    assert.deepEqual([e.ok, e.data], [true, []], JSON.stringify(body));
  }
});

test("issueHistory: a body without fields or changelog gives no description and no histories; histories that aren't objects with an id are skipped", async () => {
  for (const body of [null, {}, { fields: null, changelog: null }, "text"]) {
    const r = await stubClient(() => ({ body })).c.issueHistory("WEB-1");
    assert.deepEqual([r.ok, r.data], [true, { description: null, histories: [] }], JSON.stringify(body));
  }
  const r = await stubClient(() => ({ body: { fields: { description: "d" }, changelog: { histories: [...junk, { id: "7", items: [] }] } } })).c.issueHistory("WEB-1");
  assert.deepEqual(r.data, { description: "d", histories: [{ id: "7", items: [] }] });
});

test("the agile calls resolve, never reject, when they can't even build the request", async () => {
  const { c } = stubClient(() => ({ body: {} }));
  for (const bad of ["\uD800", Symbol("x")]) { // encodeURIComponent throws on both
    for (const call of [() => c.boardConfiguration(bad), () => c.sprints(bad, ["active"]), () => c.issueHistory(bad)]) {
      const r = await call();
      assert.equal(r.ok, false);
      assert.ok(r.problem.kind && r.problem.message);
    }
  }
});

test("curl not installed: a clear problem, no throw", async () => {
  const c = createClient({ base: mock.url, transport: "curl", token: "t", curlConfigPath: "/x", io: { ...io, exec: async () => { throw new Error("No such file or directory"); } } });
  const r = await c.myself();
  assert.equal(r.ok, false);
  assert.equal(r.problem.kind, "nocurl");
  assert.match(r.problem.hint, /fetch/);
});

test("a fetch that throws something odd still resolves", async () => {
  const c = createClient({ base: mock.url, transport: "fetch", token: "t", io: { fetch: () => { throw new TypeError("boom"); } } });
  const r = await c.myself();
  assert.equal(r.ok, false);
  assert.equal(r.problem.kind, "unknown");
});

test("curl: a request body goes through the private body file, which is emptied afterwards", { skip: hasCurl ? false : "curl not installed" }, async (t) => {
  const { readFileSync, existsSync, renameSync } = await import("node:fs");
  const own = await startMock({ port: 0 });
  t.after(() => own.close());
  const bodyPath = join(dir, "jira-work.body");
  const seen = [];
  const files = {
    readTextFile: async (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    writeTextFile: async (p, text, expected) => {
      const now = existsSync(p) ? readFileSync(p, "utf8") : null;
      if (now !== expected) throw new Error("stale");
      writeFileSync(`${p}.tmp`, text); renameSync(`${p}.tmp`, p);
    },
  };
  const curlConfigPath = join(dir, "body-test.curlrc");
  writeFileSync(curlConfigPath, curlConfig("mock-token"));
  const c = createClient({ base: own.url, transport: "curl", token: "mock-token", curlConfigPath, curlBodyPath: bodyPath,
    io: { ...io, ...files, exec: (cmd, args, o) => { seen.push(args.join(" ")); return exec(cmd, args, o); } } });
  const r = await c.comment("WEB-1", "company secret text");
  assert.equal(r.ok, true);
  assert.equal(r.data.body, "company secret text");
  assert.ok(seen.length && seen.every((a) => !a.includes("company secret text")));
  assert.equal(readFileSync(bodyPath, "utf8"), "");
});
