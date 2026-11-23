// The Jira page's pure model (src/shared/jira/*): JQL, rows, groups, board, detail, markup, errors, Start work.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILTIN_FILTERS, ROW_FIELDS, searchUrl, withSearch } from "../src/shared/jira/jql.js";
import {
  DEFAULT_START_TASK, ago, boardColumns, classify, groupByCategory, issueDetail, issueRow, latestOnly, startTask, wikiToText,
} from "../src/shared/jira/model.js";

const { issues } = JSON.parse(readFileSync(new URL("./fixtures/jira/issues.json", import.meta.url), "utf8"));
const BASE = "https://jira.example.com";
const byKey = (k) => issues.find((i) => i.key === k);
const rows = issues.map((i) => issueRow(i, BASE));

test("BUILTIN_FILTERS: Assigned to me first, each with an id, a name and JQL", () => {
  assert.equal(BUILTIN_FILTERS[0].id, "mine");
  // As the spec names it: Jira's own history of the issues you opened.
  assert.deepEqual(BUILTIN_FILTERS.find((f) => f.id === "recent"), { id: "recent", name: "Recently viewed", jql: "issuekey in issueHistory() ORDER BY lastViewed DESC" });
  assert.match(BUILTIN_FILTERS[0].jql, /assignee = currentUser\(\) AND resolution = Unresolved/);
  for (const f of BUILTIN_FILTERS) assert.ok(f.id && f.name && f.jql);
  assert.equal(new Set(BUILTIN_FILTERS.map((f) => f.id)).size, BUILTIN_FILTERS.length);
});

test("withSearch adds text ~ before ORDER BY, escapes quotes, and wraps an OR", () => {
  assert.equal(withSearch("project = API ORDER BY updated DESC", "quota"), 'project = API AND text ~ "quota" ORDER BY updated DESC');
  assert.equal(withSearch("project = API", "  "), "project = API");
  assert.equal(withSearch("ORDER BY key ASC", "x"), 'text ~ "x" ORDER BY key ASC');
  assert.equal(withSearch("", "x"), 'text ~ "x"');
  assert.equal(withSearch("a = 1", 'say "hi" \\ there'), 'a = 1 AND text ~ "say \\"hi\\" \\\\ there"');
  assert.equal(withSearch("a = 1 OR b = 2 order by key", "x"), '(a = 1 OR b = 2) AND text ~ "x" order by key');
});

test("searchUrl asks for the row fields, paged", () => {
  const u = new URL(searchUrl(BASE + "/", "project = API", { startAt: 50, maxResults: 25 }));
  assert.equal(u.origin + u.pathname, `${BASE}/rest/api/2/search`);
  assert.equal(u.searchParams.get("jql"), "project = API");
  assert.equal(u.searchParams.get("startAt"), "50");
  assert.equal(u.searchParams.get("maxResults"), "25");
  assert.equal(u.searchParams.get("fields"), ROW_FIELDS.join(","));
  assert.equal(new URL(searchUrl(BASE, "x")).searchParams.get("maxResults"), "50");
});

test("searchUrl: expand only when given", () => {
  assert.ok(searchUrl("https://j", "a = 1", { expand: "changelog" }).includes("expand=changelog"));
  assert.ok(!searchUrl("https://j", "a = 1").includes("expand"));
});

test("issueRow: project, subtask, parent", () => {
  const row = issueRow({ key: "WEB-41", fields: { issuetype: { name: "Sub-task", subtask: true },
    parent: { key: "WEB-40", fields: { summary: "Story", status: { name: "Spec design" }, issuetype: { name: "Story" } } } } }, "https://j");
  assert.equal(row.project, "WEB");
  assert.equal(row.subtask, true);
  assert.deepEqual(row.parent, { key: "WEB-40", summary: "Story", status: "Spec design", type: "Story" });
  assert.equal(issueRow({ key: "WEB-1", fields: {} }, "https://j").parent, null);
  assert.equal(issueRow({ key: "WEB-1", fields: {} }, "https://j").subtask, false);
  assert.equal(issueRow({ key: "MY-APP-12", fields: {} }, "https://j").project, "MY-APP");
});

test("issueRow: the list's fields, a browse link and the status category", () => {
  const i = byKey("WEB-2");
  const r = issueRow(i, BASE);
  assert.equal(r.key, "WEB-2");
  assert.equal(r.summary, i.fields.summary);
  assert.equal(r.type, i.fields.issuetype.name);
  assert.equal(r.priority, i.fields.priority.name);
  assert.equal(r.status, i.fields.status.name);
  assert.equal(r.category, i.fields.status.statusCategory.key);
  assert.equal(r.assignee, i.fields.assignee?.displayName ?? null);
  assert.equal(r.updatedMs, Date.parse(i.fields.updated));
  assert.equal(r.url, `${BASE}/browse/WEB-2`);
  // Missing fields (a search that didn't ask for them) don't throw.
  const bare = issueRow({ key: "X-1", fields: { summary: "s" } }, BASE);
  assert.deepEqual([bare.type, bare.priority, bare.status, bare.assignee, bare.updatedMs], [null, null, null, null, null]);
  assert.equal(bare.category, "new");
});

test("groupByCategory: To do, In progress, Done, keeping order, leaving out empty groups", () => {
  const g = groupByCategory(rows);
  assert.deepEqual(g.map((x) => x.category), ["new", "indeterminate", "done"]);
  assert.deepEqual(g.map((x) => x.title), ["To do", "In progress", "Done"]);
  assert.equal(g.reduce((n, x) => n + x.rows.length, 0), rows.length);
  const inProgress = rows.filter((r) => r.category === "indeterminate").map((r) => r.key);
  assert.deepEqual(g[1].rows.map((r) => r.key), inProgress);
  assert.deepEqual(groupByCategory(rows.filter((r) => r.category === "done")).map((x) => x.category), ["done"]);
  assert.deepEqual(groupByCategory([]), []);
});

test("boardColumns: one per status, by category then first seen", () => {
  const cols = boardColumns(rows);
  assert.deepEqual(cols.map((c) => c.status), ["To Do", "In Progress", "In Review", "Resolved", "Done"]);
  assert.equal(cols.reduce((n, c) => n + c.rows.length, 0), rows.length);
  const reviewFirst = [...rows].sort((a, b) => (a.status === "In Review" ? -1 : b.status === "In Review" ? 1 : 0));
  assert.deepEqual(boardColumns(reviewFirst).map((c) => c.status), ["To Do", "In Review", "In Progress", "Resolved", "Done"]);
  assert.deepEqual(boardColumns([]), []);
  // Jira's own status order wins over the order first seen.
  assert.deepEqual(boardColumns(reviewFirst, ["To Do", "In Progress", "In Review", "Done"]).map((c) => c.status), ["To Do", "In Progress", "In Review", "Resolved", "Done"]);
  assert.deepEqual(boardColumns(reviewFirst, ["Done"]).map((c) => c.status), ["To Do", "In Review", "In Progress", "Resolved", "Done"]);
  // The workflow's statuses (from the projects on the board) all get a column, empty ones too: Done shows even when
  // the filter only lists unresolved issues.
  const open = rows.filter((r) => r.category !== "done");
  const all = [{ name: "To Do", category: "new" }, { name: "In Progress", category: "indeterminate" }, { name: "In Review", category: "indeterminate" }, { name: "Resolved", category: "indeterminate" }, { name: "Done", category: "done" }];
  const withAll = boardColumns(open, ["To Do", "In Progress", "In Review", "Resolved", "Done"], all);
  assert.deepEqual(withAll.map((c) => [c.status, c.rows.length > 0]), [["To Do", true], ["In Progress", true], ["In Review", true], ["Resolved", true], ["Done", false]]);
  assert.equal(withAll[4].category, "done");
  assert.deepEqual(boardColumns(open, [], []).map((c) => c.status), boardColumns(open).map((c) => c.status));
});

test("issueDetail: description as text, the last 5 comments, links", () => {
  const withComments = issues.find((i) => i.fields.comment.comments.length === 4);
  const d = issueDetail(withComments, BASE);
  assert.equal(d.key, withComments.key);
  assert.ok(!d.description.includes("{code"));
  assert.ok(!d.description.includes("h3."));
  assert.equal(d.comments.length, 4);
  assert.equal(d.commentTotal, 4);
  assert.equal(d.comments[0].author, withComments.fields.comment.comments[0].author.displayName);
  assert.ok(Number.isFinite(d.comments[0].createdMs));
  const many = structuredClone(withComments);
  for (let k = 0; k < 4; k++) many.fields.comment.comments.push({ ...many.fields.comment.comments[0], id: `x${k}`, body: `extra ${k}` });
  many.fields.comment.total = 8;
  const dm = issueDetail(many, BASE);
  assert.equal(dm.comments.length, 5);
  assert.equal(dm.comments.at(-1).bodyText, "extra 3");
  assert.equal(dm.commentTotal, 8);
  const linked = issues.find((i) => i.fields.issuelinks.length);
  assert.deepEqual(issueDetail(linked, BASE).links, [{ label: "relates to", key: linked.fields.issuelinks[0].outwardIssue.key, url: `${BASE}/browse/${linked.fields.issuelinks[0].outwardIssue.key}` }]);
  assert.equal(issueDetail(issues.find((i) => !i.fields.description), BASE).description, "");
});

test("issueDetail: project, subtask and parent as issueRow derives them, so an action rule matches a detail opened from anywhere", () => {
  const sub = { key: "WEB-41", fields: { summary: "Bar", issuetype: { name: "Sub-task", subtask: true },
    parent: { key: "WEB-40", fields: { summary: "Story", status: { name: "Spec design" }, issuetype: { name: "Story" } } } } };
  const d = issueDetail(sub, BASE);
  assert.equal(d.project, "WEB"); // the key's prefix, though the response names no project
  assert.equal(d.subtask, true);
  assert.deepEqual(d.parent, { key: "WEB-40", summary: "Story", status: "Spec design", type: "Story" });
  const plain = issueDetail({ key: "MY-APP-12", fields: { issuetype: { name: "Bug", subtask: false } } }, BASE);
  assert.deepEqual([plain.project, plain.subtask, plain.parent], ["MY-APP", false, null]);
  // Each equals what the issue's row says (a row and a detail of one issue agree).
  for (const i of issues) {
    const row = issueRow(i, BASE), det = issueDetail(i, BASE);
    assert.deepEqual([det.project, det.subtask, det.parent], [row.project, row.subtask, row.parent], i.key);
  }
});

test("wikiToText: Jira markup as readable text", () => {
  assert.equal(wikiToText(null), "");
  assert.equal(wikiToText("h3. Context\n*Steps* and _why_"), "Context\nSteps and why");
  assert.equal(wikiToText("{code:bash}\necho hi\n{code}"), "echo hi");
  assert.equal(wikiToText("{noformat}raw{noformat}"), "raw");
  assert.equal(wikiToText("{quote}said{quote}"), "said");
  assert.equal(wikiToText("See [the doc|https://x.y/z] and [https://a.b]"), "See the doc (https://x.y/z) and https://a.b");
  assert.equal(wikiToText("ping [~dana] about {{config.yml}}"), "ping @dana about config.yml");
  assert.equal(wikiToText("# one\n# two\n\n# again\n* dot\n** deeper"), "1. one\n2. two\n\n1. again\n• dot\n  • deeper");
  assert.equal(wikiToText("{color:red}hot{color} !shot.png|thumbnail!"), "hot [image: shot.png]");
  assert.equal(wikiToText("a\\\\b"), "a\nb");
  assert.equal(wikiToText("x\n\n\n\ny"), "x\n\ny");
  // Asterisks that aren't bold markers stay.
  assert.equal(wikiToText("2 * 3 = 6"), "2 * 3 = 6");
});

test("classify: HTTP statuses", () => {
  assert.equal(classify({ status: 401 }).kind, "auth");
  assert.equal(classify({ status: 403 }).kind, "forbidden");
  assert.equal(classify({ status: 404, data: { errorMessages: ["Issue does not exist"] } }).kind, "notfound");
  const bad = classify({ status: 400, data: { errorMessages: ["Unable to parse \"x\"."], errors: { resolution: "Resolution is required." } } });
  assert.equal(bad.kind, "invalid");
  assert.match(bad.message, /Unable to parse/);
  assert.match(bad.message, /Resolution is required/);
  assert.deepEqual(classify({ status: 400, data: { errorMessages: [], errors: { resolution: "Resolution is required." } } }).fields, ["resolution"]);
  for (const s of [500, 502, 503]) assert.equal(classify({ status: s }).kind, "server");
  for (const k of ["auth", "forbidden", "notfound", "invalid", "server"]) assert.ok(classify({ status: { auth: 401, forbidden: 403, notfound: 404, invalid: 400, server: 500 }[k] }).hint);
});

test("classify: transport failures", () => {
  for (const e of ["self signed certificate in certificate chain", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "invalid peer certificate: UnknownIssuer", "SSL handshake failed"]) {
    assert.equal(classify({ error: e }).kind, "tls", e);
  }
  for (const e of ["connect ECONNREFUSED 127.0.0.1:8089", "getaddrinfo ENOTFOUND jira.corp", "dns error: failed to lookup", "error sending request: network unreachable"]) {
    assert.equal(classify({ error: e }).kind, "offline", e);
  }
  assert.equal(classify({ error: "operation timed out" }).kind, "timeout");
  // Herdr's fetch: one message for any failure to connect, with the URL twice.
  const herdr = classify({ error: "fetching http://127.0.0.1:8089/rest/api/2/search?jql=a failed: error sending request for url (http://127.0.0.1:8089/rest/api/2/search?jql=a)" });
  assert.equal(herdr.kind, "offline");
  assert.match(herdr.hint, /certificate/);
  assert.ok(!herdr.message.includes("http"));
  const odd = classify({ error: "fetching https://j/x?jql=long failed: something new (https://j/x?jql=long)" });
  assert.equal(odd.kind, "unknown");
  assert.match(odd.message, /something new/);
  assert.ok(!odd.message.includes("https://"));
  assert.equal(classify({ error: "something odd" }).kind, "unknown");
  for (const [code, kind] of [[6, "offline"], [7, "offline"], [28, "timeout"], [35, "tls"], [51, "tls"], [58, "tls"], [60, "tls"], [2, "unknown"]]) {
    assert.equal(classify({ curlCode: code }).kind, kind, String(code));
  }
  assert.match(classify({ error: "x", status: undefined }).message, /x/);
});

test("startTask fills every placeholder, empty when missing; unknown ones stay", () => {
  const d = issueDetail(byKey("API-2"), BASE);
  assert.equal(startTask(undefined, d), `Work on Jira issue API-2: ${d.summary}\n${BASE}/browse/API-2`);
  assert.equal(startTask("", d), startTask(DEFAULT_START_TASK, d));
  assert.equal(startTask("/init-ticket {key}", d), "/init-ticket API-2");
  assert.equal(startTask("{key}\\n{url}", d), `API-2\n${d.url}`); // "\n" typed in the one-line field
  assert.equal(startTask("{key}|{type}|{status}|{priority}|{url}", d), `API-2|${d.type}|${d.status}|${d.priority}|${d.url}`);
  assert.equal(startTask("{key} {description}", d), `API-2 ${d.description}`);
  const bare = { key: "X-1", summary: "s", url: "u" };
  assert.equal(startTask("{key} [{description}] [{priority}]", bare), "X-1 [] []");
  assert.equal(startTask("{key} {nope}", bare), "X-1 {nope}");
  const long = { ...bare, description: "y".repeat(5000) };
  assert.ok(startTask("{description}", long).length <= 2001);
});

test("latestOnly drops an older response", () => {
  const l = latestOnly();
  const a = l.next(), b = l.next();
  assert.equal(l.accept(a), false);
  assert.equal(l.accept(b), true);
});

test("ago", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  assert.equal(ago(now - 20e3, now), "now");
  assert.equal(ago(now - 5 * 60e3, now), "5m");
  assert.equal(ago(now - 3 * 3600e3, now), "3h");
  assert.equal(ago(now - 4 * 86400e3, now), "4d");
  assert.equal(ago(now - 70 * 86400e3, now), "2mo");
  assert.equal(ago(null, now), "");
  assert.equal(ago(now + 60e3, now), "now");
});

test("the built-in filters, with and without a search, run on the mock Jira", async () => {
  const { startMock } = await import("../scripts/mock-jira.mjs");
  const mock = await startMock({ port: 0 });
  try {
    for (const f of BUILTIN_FILTERS) {
      for (const jql of [f.jql, withSearch(f.jql, "search"), withSearch(f.jql, 'a "quoted" word')]) {
        const r = await fetch(searchUrl(mock.url, jql), { headers: { Authorization: "Bearer mock-token" } });
        assert.equal(r.status, 200, jql);
        const data = await r.json();
        // `parent` is Jira's alone to send, and only on a sub-task: every other field is always there.
        for (const i of data.issues) assert.deepEqual(Object.keys(i.fields).filter((k) => k !== "parent").sort(), ROW_FIELDS.filter((k) => k !== "parent").sort());
      }
    }
    const mine = await (await fetch(searchUrl(mock.url, BUILTIN_FILTERS[0].jql), { headers: { Authorization: "Bearer mock-token" } })).json();
    assert.equal(mine.total, 19);
    const mineRows = mine.issues.map((i) => issueRow(i, mock.url));
    assert.equal(groupByCategory(mineRows).some((g) => g.category === "done"), false);
    // Jira sends `parent` on sub-tasks only (the mock's WEB-41 and WEB-42 sit under story WEB-40).
    assert.deepEqual(mineRows.filter((r) => r.subtask).map((r) => [r.key, r.parent?.key]), [["WEB-41", "WEB-40"], ["WEB-42", "WEB-40"]]);
    assert.ok(mineRows.filter((r) => !r.subtask).every((r) => r.parent === null && r.project === r.key.split("-")[0]));
  } finally { await mock.close(); }
});
