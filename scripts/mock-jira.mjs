#!/usr/bin/env node
// A mock Jira Server / Data Center for developing and testing the Jira page without the company's Jira.
// It answers the REST v2 endpoints the page uses, with Jira's JSON shapes, from tests/fixtures/jira/*.json, and keeps
// changes in memory (a transition moves the issue, a comment appears) until it stops. No dependencies.
//
//   npm run mock:jira                       http://127.0.0.1:8089, token mock-token
//   node scripts/mock-jira.mjs --port 9000 --slow 3000 --status 500 --token other
//
// Dates are shifted so the newest update is ~20 minutes before now. JQL is a small subset (see parseJql); anything
// else is a 400 with Jira's error shape, so the page's error display gets exercised too.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "jira");
const API = "/rest/api/2";
const DAY = 86400e3;

const load = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const jiraTime = (ms) => new Date(ms).toISOString().replace("Z", "+0000");
const err = (messages, errors = {}) => ({ errorMessages: messages, errors });

class JqlError extends Error {}

// Shift every date so the newest `updated` is 20 minutes before `now`.
function shiftDates(issues, now) {
  const newest = Math.max(...issues.map((i) => Date.parse(i.fields.updated)));
  const by = now - 20 * 60e3 - newest;
  const shift = (s) => jiraTime(Date.parse(s) + by);
  for (const i of issues) {
    i.fields.created = shift(i.fields.created);
    i.fields.updated = shift(i.fields.updated);
    for (const c of i.fields.comment.comments) { c.created = shift(c.created); c.updated = shift(c.updated); }
  }
}

// ---- JQL (a subset) ----

// Splits at a keyword (AND) outside quotes and parentheses.
function splitTop(text, word) {
  const parts = [];
  let depth = 0, quote = false, start = 0;
  const re = new RegExp(`^\\s+${word}\\s+`, "i");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote && c === "\\") { i++; continue; } // an escaped character inside quotes
    if (c === '"') quote = !quote;
    else if (!quote && c === "(") depth++;
    else if (!quote && c === ")") depth--;
    else if (!quote && depth === 0 && /\s/.test(c)) {
      const m = re.exec(text.slice(i));
      if (m) { parts.push(text.slice(start, i)); i += m[0].length - 1; start = i + 1; }
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// A JQL string value: "quoted" (with \" and \\ escapes) or bare.
const unquote = (v) => {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(v.trim());
  return m ? m[1].replace(/\\(.)/g, "$1") : v.trim();
};
const list = (v) => v.split(",").map(unquote).filter(Boolean);
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const CATEGORY = { "to do": "new", new: "new", "in progress": "indeterminate", indeterminate: "indeterminate", done: "done" };
const RELATIVE = /^-?(\d+)([dhwm])$/i;
const UNIT = { d: DAY, h: 3600e3, w: 7 * DAY, m: 60e3 };

function clause(text, ctx) {
  let m;
  if ((m = /^(assignee|reporter)\s+is\s+(not\s+)?empty$/i.exec(text))) {
    const field = m[1].toLowerCase(), not = Boolean(m[2]);
    return (i) => (i.fields[field] == null) !== not;
  }
  if ((m = /^(assignee|reporter)\s*(!=|=)\s*(.+)$/i.exec(text))) {
    const field = m[1].toLowerCase(), not = m[2] === "!=";
    const who = /^currentuser\(\)$/i.test(m[3].trim()) ? ctx.me : unquote(m[3]);
    return (i) => same(i.fields[field]?.name, who) !== not;
  }
  if ((m = /^(project|key|status|issuetype|type|priority)\s+(not\s+)?in\s*\((.*)\)$/i.exec(text))) {
    const field = m[1].toLowerCase(), not = Boolean(m[2]), values = list(m[3]);
    if (field === "project") for (const v of values) checkProject(v, ctx);
    return (i) => values.some((v) => matches(i, field, v)) !== not;
  }
  if ((m = /^(project|status|issuetype|type|priority|statuscategory|resolution)\s*(!=|=)\s*(.+)$/i.exec(text))) {
    const field = m[1].toLowerCase(), not = m[2] === "!=", value = unquote(m[3]);
    if (field === "project") checkProject(value, ctx);
    return (i) => matches(i, field, value) !== not;
  }
  if ((m = /^(text|summary)\s*~\s*("(?:[^"\\]|\\.)*")$/i.exec(text))) {
    const field = m[1].toLowerCase(), q = unquote(m[2]).toLowerCase();
    return (i) => [i.fields.summary, field === "text" ? i.fields.description : ""].some((s) => (s ?? "").toLowerCase().includes(q));
  }
  if ((m = /^(updated|created)\s*(>=|<=|>|<)\s*(\S+)$/i.exec(text))) {
    const field = m[1].toLowerCase(), op = m[2], r = RELATIVE.exec(m[3]);
    if (!r) throw new JqlError(`Date value '${m[3]}' for field '${field}' is invalid.`);
    const at = ctx.now - Number(r[1]) * UNIT[r[2].toLowerCase()];
    return (i) => {
      const t = Date.parse(i.fields[field]);
      return op === ">=" ? t >= at : op === ">" ? t > at : op === "<=" ? t <= at : t < at;
    };
  }
  throw new JqlError(`Error in the JQL Query: Unable to parse "${text}".`);
}

function checkProject(value, ctx) {
  if (!ctx.projects.some((p) => same(p, value))) throw new JqlError(`The value '${value}' does not exist for the field 'project'.`);
}

function matches(i, field, value) {
  const f = i.fields;
  switch (field) {
    case "project": return same(f.project.key, value) || same(f.project.name, value);
    case "key": return same(i.key, value);
    case "status": return same(f.status.name, value);
    case "issuetype": case "type": return same(f.issuetype.name, value);
    case "priority": return same(f.priority?.name, value);
    case "statuscategory": return f.status.statusCategory.key === (CATEGORY[String(value).toLowerCase()] ?? value);
    case "resolution": return same(value, "unresolved") ? f.resolution == null : same(f.resolution?.name, value);
    default: return false;
  }
}

const ORDER = {
  updated: (i) => Date.parse(i.fields.updated),
  created: (i) => Date.parse(i.fields.created),
  priority: (i) => -Number(i.fields.priority?.id ?? 99), // Highest (id 1) first when DESC, as Jira does
  key: (i) => `${i.fields.project.key}-${String(Number(i.key.split("-")[1])).padStart(6, "0")}`,
};

// jql -> { filter(issue), sort(a, b) }. Throws JqlError for anything outside the subset.
export function parseJql(jql, ctx) {
  const [where, order] = (() => {
    const m = /^(.*?)\s*\border\s+by\s+(.+)$/is.exec(jql.trim());
    return m ? [m[1], m[2]] : [jql.trim(), "key DESC"];
  })();
  if (/\bor\b/i.test(where.replace(/"(?:[^"\\]|\\.)*"/g, ""))) throw new JqlError("Error in the JQL Query: OR is not supported by the mock.");
  const tests = where ? splitTop(where, "and").map((c) => clause(c, ctx)) : [];
  const keys = order.split(",").map((s) => {
    const m = /^(\w+)(?:\s+(asc|desc))?$/i.exec(s.trim());
    if (!m || !ORDER[m[1].toLowerCase()]) throw new JqlError(`Error in the JQL Query: Not able to sort using field '${s.trim()}'.`);
    return { get: ORDER[m[1].toLowerCase()], dir: (m[2] ?? "asc").toLowerCase() === "desc" ? -1 : 1 };
  });
  return {
    filter: (i) => tests.every((t) => t(i)),
    sort: (a, b) => {
      for (const k of keys) {
        const x = k.get(a), y = k.get(b);
        if (x !== y) return (x < y ? -1 : 1) * k.dir;
      }
      return 0;
    },
  };
}

// ---- The server ----

// The fields an issue response carries: all, or only those asked for (`fields=a,b`; `*all` / `*navigable` = all).
function pick(issue, fields) {
  const want = (fields ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const all = !want.length || want.some((f) => f.startsWith("*"));
  const out = { expand: "", id: issue.id, self: issue.self, key: issue.key, fields: {} };
  for (const [k, v] of Object.entries(issue.fields)) if (all || want.includes(k)) out.fields[k] = clone(v);
  return out;
}

export async function startMock({ port = 8089, host = "127.0.0.1", token = "mock-token", slowMs = 0, failStatus = null, now = Date.now() } = {}) {
  const { users, issues } = load("issues.json");
  const workflow = load("workflow.json");
  const filters = load("filters.json");
  shiftDates(issues, now);
  const me = users.me.name;
  const started = Date.now();
  const clock = () => now + (Date.now() - started); // "now" moves on with real time
  const projects = [...new Set(issues.map((i) => i.fields.project.key))];
  const statusById = Object.fromEntries(workflow.statuses.map((s) => [s.id, s]));
  const statusObj = (s) => ({ self: `${API}/status/${s.id}`, id: s.id, name: s.name, statusCategory: clone(workflow.categories[s.category]) });
  let base = "";
  const self = (path) => `${base}${path}`;
  let commentId = 90000;

  const find = (key) => issues.find((i) => i.key.toLowerCase() === String(key).toLowerCase());
  const available = (issue) => workflow.transitions.filter((t) => t.from.includes(issue.fields.status.id));

  async function route(req, url, body) {
    const path = url.pathname.replace(/\/+$/, "");
    const p = (s) => path === `${API}${s}`;
    if (req.method === "GET" && p("/serverInfo")) {
      return [200, { baseUrl: base, version: "9.12.2", versionNumbers: [9, 12, 2], deploymentType: "Server", buildNumber: 912002, serverTitle: "Mock Jira" }];
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      return [401, err(["You are not authenticated. Authentication required to perform this operation."])];
    }
    if (failStatus) return [failStatus, err([`Mock server error (${failStatus}).`])];

    if (req.method === "GET" && p("/myself")) {
      return [200, { self: self(`${API}/user?username=${me}`), ...clone(users.me), timeZone: "UTC", locale: "en_US" }];
    }
    if (req.method === "GET" && p("/search")) {
      const startAt = Math.max(0, Number(url.searchParams.get("startAt") ?? 0) || 0);
      const maxResults = Math.min(100, Math.max(0, Number(url.searchParams.get("maxResults") ?? 50) || 50));
      let q;
      try { q = parseJql(url.searchParams.get("jql") ?? "", { me, now: clock(), projects }); } catch (e) {
        if (e instanceof JqlError) return [400, err([e.message])];
        throw e;
      }
      const hits = issues.filter(q.filter).sort(q.sort);
      return [200, { expand: "names,schema", startAt, maxResults, total: hits.length,
        issues: hits.slice(startAt, startAt + maxResults).map((i) => pick(i, url.searchParams.get("fields"))) }];
    }
    if (req.method === "GET" && p("/status")) return [200, workflow.statuses.map(statusObj)];
    if (req.method === "GET" && p("/filter/favourite")) {
      return [200, filters.map((f) => ({ self: self(`${API}/filter/${f.id}`), ...clone(f),
        viewUrl: self(`/issues/?filter=${f.id}`), searchUrl: self(`${API}/search?jql=${encodeURIComponent(f.jql)}`) }))];
    }
    const m = new RegExp(`^${API}/issue/([A-Za-z]+-\\d+)(/transitions|/assignee|/comment)?$`).exec(path);
    if (!m) return [404, err([`null for uri: ${url.pathname}`])];
    const issue = find(m[1]);
    if (!issue) return [404, err(["Issue does not exist or you do not have permission to see it."])];
    const touch = () => { issue.fields.updated = jiraTime(clock()); };
    const sub = m[2] ?? "";

    if (req.method === "GET" && sub === "") return [200, pick(issue, url.searchParams.get("fields"))];
    if (req.method === "GET" && sub === "/transitions") {
      return [200, { expand: "transitions", transitions: available(issue).map((t) => ({
        id: t.id, name: t.name, to: statusObj(statusById[t.to]), hasScreen: t.hasScreen, isGlobal: false, isInitial: false, isConditional: false,
      })) }];
    }
    if (req.method === "POST" && sub === "/transitions") {
      const id = body?.transition?.id;
      const t = available(issue).find((x) => x.id === String(id));
      if (!t) return [400, err([`Transition id '${id}' is not valid for this issue.`])];
      const missing = (t.requires ?? []).filter((f) => body?.fields?.[f] == null);
      if (missing.length) return [400, err([], Object.fromEntries(missing.map((f) => [f, `${f[0].toUpperCase()}${f.slice(1)} is required.`])))];
      const to = statusById[t.to];
      issue.fields.status = statusObj(to);
      issue.fields.resolution = to.category === "done" ? { id: "10000", name: body?.fields?.resolution?.name ?? "Done" } : null;
      touch();
      return [204, null];
    }
    if (req.method === "PUT" && sub === "/assignee") {
      const name = body?.name ?? null;
      if (name !== null && !users[name]) return [400, err([], { assignee: `User '${name}' does not exist.` })];
      issue.fields.assignee = name === null ? null : clone(users[name]);
      touch();
      return [204, null];
    }
    if (req.method === "POST" && sub === "/comment") {
      const text = typeof body?.body === "string" ? body.body : "";
      if (!text.trim()) return [400, err([], { comment: "Comment body can not be empty!" })];
      const at = jiraTime(clock());
      const c = { self: self(`${API}/issue/${issue.id}/comment/${commentId}`), id: String(commentId++), author: clone(users.me), body: text, created: at, updated: at };
      const list = issue.fields.comment;
      list.comments.push(c);
      list.total = list.maxResults = list.comments.length;
      touch();
      return [201, c];
    }
    return [405, err([`Method ${req.method} not allowed here.`])];
  }

  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body;
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = undefined; }
    }
    let status, data;
    if (raw && body === undefined) [status, data] = [400, err(["Unexpected request body: not JSON."])];
    else {
      try { [status, data] = await route(req, new URL(req.url, base), body); } catch (e) { [status, data] = [500, err([String(e?.message ?? e)])]; }
    }
    if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
    if (data === null) { res.writeHead(status); res.end(); return; }
    res.writeHead(status, { "Content-Type": "application/json;charset=UTF-8" });
    res.end(JSON.stringify(data));
  });
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(port, host, ok); });
  base = `http://${host}:${server.address().port}`;
  // Fixture links point at http://jira.mock; serve them under this server instead.
  for (const i of issues) i.self = i.self.replace("http://jira.mock", base);
  return {
    url: base,
    issues,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opts = {
    port: Number(arg(argv, "--port", 8089)),
    token: arg(argv, "--token", "mock-token"),
    slowMs: Number(arg(argv, "--slow", 0)),
    failStatus: argv.includes("--status") ? Number(arg(argv, "--status", 500)) : null,
  };
  startMock(opts).then((m) => {
    console.log(`mock Jira at ${m.url}  (token: ${opts.token}${opts.slowMs ? `, ${opts.slowMs} ms slow` : ""}${opts.failStatus ? `, every call ${opts.failStatus}` : ""})`);
    console.log("Ctrl+C stops it; changes are kept in memory until then.");
  }).catch((e) => { console.error(`mock Jira: ${e.message}`); process.exit(1); });
}
