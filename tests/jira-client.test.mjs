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
    assert.equal(s.data.total, 10);
    assert.equal(s.data.issues.length, 5);
    const key = s.data.issues[0].key;
    const issue = await c.issue(key);
    assert.equal(issue.data.key, key);
    assert.ok("comment" in issue.data.fields && "description" in issue.data.fields);
    assert.equal((await c.favouriteFilters()).data.length, 2);
    assert.deepEqual((await c.statuses()).data.map((x) => x.name), ["To Do", "In Progress", "In Review", "Done"]);
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
    const bare = await c.transition(key, resolve.id);
    assert.equal(bare.ok, false);
    assert.equal(bare.problem.kind, "invalid");
    assert.deepEqual(bare.problem.fields, ["resolution"]);
    const done = await c.transition(key, resolve.id, { resolution: { name: "Done" } });
    assert.equal(done.ok, true);
    assert.equal((await c.issue(key)).data.fields.status.name, "Done");
  });

  test(`${transport}: wrong token, bad JQL, unknown issue`, { skip }, async () => {
    const wrong = await client(transport, { token: "nope" }).myself();
    assert.equal(wrong.ok, false);
    assert.equal(wrong.problem.kind, "auth");
    assert.ok(!wrong.problem.message.includes("nope"));
    const bad = await client(transport).search("sprint in openSprints()");
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
