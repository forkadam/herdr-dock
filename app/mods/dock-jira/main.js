// src/mods/dock-jira/main.js
import { View, div as div4, svg as svg3 } from "gpui-kit";
import { h_flex as h_flex4, v_flex as v_flex3, InputState, Input, Popover as Popover2, ScrollHandle } from "gpui-base";
import { appHome, checking, exec, nextCommand, props, readTextFile, run, setShared as setShared2, shared as shared2, theme, window, writeTextFile } from "herdr";

// src/mods/_page.js
import { setShared, shared } from "herdr";

// src/shared/panel.js
var PAGE_KEY = "dock.page.active";

// src/mods/_page.js
function showTerminal() {
  if ((shared(PAGE_KEY) ?? null) !== null) setShared(PAGE_KEY, null);
}
var pageShown = (myMod) => shared(PAGE_KEY) === myMod;

// src/shared/jira/jql.js
var BUILTIN_FILTERS = [
  { id: "mine", name: "Assigned to me", jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC" },
  { id: "reported", name: "Reported by me", jql: "reporter = currentUser() AND resolution = Unresolved ORDER BY updated DESC" },
  { id: "recent", name: "Recently viewed", jql: "issuekey in issueHistory() ORDER BY lastViewed DESC" }
];
var ROW_FIELDS = ["summary", "status", "issuetype", "priority", "assignee", "updated", "parent"];
var quote = (text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
function withSearch(jql, text) {
  const q = String(text ?? "").trim();
  const source = String(jql ?? "").trim();
  if (!q) return source;
  const m = /^(.*?)\s*\b(order\s+by\s+.+)$/is.exec(source);
  const where = (m ? m[1] : source).trim();
  const order = m ? ` ${m[2]}` : "";
  const scoped = /\bor\b/i.test(where.replace(/"(?:[^"\\]|\\.)*"/g, "")) ? `(${where})` : where;
  return `${scoped ? `${scoped} AND ` : ""}text ~ ${quote(q)}${order}`;
}
function searchUrl(base, jql, { startAt = 0, maxResults = 50, fields = ROW_FIELDS, expand } = {}) {
  const params = new URLSearchParams({ jql, startAt: String(startAt), maxResults: String(maxResults), fields: fields.join(",") });
  if (expand) params.set("expand", expand);
  return `${String(base).replace(/\/+$/, "")}/rest/api/2/search?${params}`;
}

// src/shared/jira/model.js
var CATEGORIES = [
  { category: "new", title: "To do" },
  { category: "indeterminate", title: "In progress" },
  { category: "done", title: "Done" }
];
var RANK = Object.fromEntries(CATEGORIES.map((c, i) => [c.category, i]));
var time = (s) => {
  const t = Date.parse(s ?? "");
  return Number.isFinite(t) ? t : null;
};
var trimBase = (base) => String(base ?? "").replace(/\/+$/, "");
var browseUrl = (base, key) => `${trimBase(base)}/browse/${key}`;
function issueRow(issue, base) {
  const f = issue?.fields ?? {};
  const cat = f.status?.statusCategory?.key;
  const dash = String(issue.key ?? "").lastIndexOf("-");
  const p = f.parent;
  return {
    key: issue.key,
    project: dash > 0 ? issue.key.slice(0, dash) : null,
    summary: f.summary ?? "",
    type: f.issuetype?.name ?? null,
    typeIcon: f.issuetype?.iconUrl ?? null,
    priority: f.priority?.name ?? null,
    priorityId: f.priority?.id ?? null,
    status: f.status?.name ?? null,
    category: cat in RANK ? cat : "new",
    assignee: f.assignee?.displayName ?? null,
    assigneeName: f.assignee?.name ?? null,
    updatedMs: time(f.updated),
    subtask: Boolean(f.issuetype?.subtask),
    parent: p?.key ? { key: p.key, summary: p.fields?.summary ?? "", status: p.fields?.status?.name ?? null, type: p.fields?.issuetype?.name ?? null } : null,
    url: browseUrl(base, issue.key)
  };
}
function groupByCategory(rows) {
  return CATEGORIES.map((c) => ({ ...c, rows: rows.filter((r) => r.category === c.category) })).filter((g) => g.rows.length);
}
function boardColumns(rows, order = [], statuses = []) {
  const pos = (name) => {
    const i = order.indexOf(name);
    return i < 0 ? Infinity : i;
  };
  const cols = [];
  for (const r of rows) {
    const name = r.status ?? "No status";
    let col = cols.find((c) => c.status === name);
    if (!col) cols.push(col = { status: name, category: r.category, rows: [], seen: cols.length });
    col.rows.push(r);
  }
  for (const st of statuses ?? []) {
    if (st?.name && !cols.some((c) => c.status === st.name)) cols.push({ status: st.name, category: st.category in RANK ? st.category : "new", rows: [], seen: cols.length });
  }
  return cols.sort((a, b) => RANK[a.category] - RANK[b.category] || (pos(a.status) - pos(b.status) || 0) || a.seen - b.seen).map(({ seen, ...c }) => c);
}
function issueDetail(issue, base) {
  const f = issue?.fields ?? {};
  const all = f.comment?.comments ?? [];
  const links = (f.issuelinks ?? []).map((l) => {
    const other = l.outwardIssue ?? l.inwardIssue;
    if (!other?.key) return null;
    return { label: (l.outwardIssue ? l.type?.outward : l.type?.inward) ?? l.type?.name ?? "links to", key: other.key, url: browseUrl(base, other.key) };
  }).filter(Boolean);
  return {
    ...issueRow(issue, base),
    reporter: f.reporter?.displayName ?? null,
    createdMs: time(f.created),
    resolution: f.resolution?.name ?? null,
    description: wikiToText(f.description),
    comments: all.slice(-5).map((c) => ({ id: c.id, author: c.author?.displayName ?? "someone", bodyText: wikiToText(c.body), createdMs: time(c.created) })),
    commentTotal: Number.isFinite(f.comment?.total) ? f.comment.total : all.length,
    links
  };
}
function wikiToText(markup) {
  if (typeof markup !== "string" || !markup) return "";
  let s = markup.replace(/\r\n?/g, "\n");
  s = s.replace(/\{(code|noformat)(?::[^}]*)?\}\n?([\s\S]*?)\n?\{\1\}/g, "$2");
  s = s.replace(/\{(quote|panel)(?::[^}]*)?\}([\s\S]*?)\{\1\}/g, "$2");
  s = s.replace(/\{color(?::[^}]*)?\}([\s\S]*?)\{color\}/g, "$1");
  s = s.replace(/^h[1-6]\.\s*/gm, "");
  s = s.replace(/\[~([^\]]+)\]/g, "@$1");
  s = s.replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$1 ($2)");
  s = s.replace(/\[((?:https?|mailto):[^\]]+)\]/g, "$1");
  s = s.replace(/\{\{([^}]*)\}\}/g, "$1");
  s = s.replace(/!([^!\s|]+)(?:\|[^!]*)?!/g, "[image: $1]");
  s = s.replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,:;!?])/gm, "$1$2");
  s = s.replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,:;!?])/gm, "$1$2");
  s = s.replace(/\\\\/g, "\n");
  const out = [];
  let n = 0;
  for (const line of s.split("\n")) {
    const num2 = /^(#+)\s+(.*)$/.exec(line);
    const dot = /^(\*+)\s+(.*)$/.exec(line);
    if (num2) {
      n = num2[1].length === 1 ? n + 1 : n;
      out.push(`${"  ".repeat(num2[1].length - 1)}${num2[1].length === 1 ? `${n}.` : "-"} ${num2[2]}`);
      continue;
    }
    n = 0;
    if (dot) {
      out.push(`${"  ".repeat(dot[1].length - 1)}\u2022 ${dot[2]}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
var TLS = /certificate|self[- ]signed|unable_to_verify|unknownissuer|\bssl\b|\btls\b|cert_|handshake/i;
var OFFLINE = /econnrefused|enotfound|eai_again|getaddrinfo|\bdns\b|network|unreachable|connection refused|resolve host|failed to lookup|connect error|error sending request/i;
var TIMEOUT = /timed?\s?out|etimedout|timeout/i;
var CURL = { 6: "offline", 7: "offline", 28: "timeout", 35: "tls", 51: "tls", 53: "tls", 54: "tls", 58: "tls", 59: "tls", 60: "tls", 77: "tls", 80: "tls", 82: "tls", 83: "tls", 90: "tls", 91: "tls" };
var TEXT = {
  auth: ["Jira didn't accept the token.", "Connect again with a personal access token (Jira \u2192 Profile \u2192 Personal Access Tokens)."],
  forbidden: ["Jira says you don't have permission for this.", "Ask a Jira admin, or try it in the browser."],
  notfound: ["Jira couldn't find that.", "It may have been moved or deleted; refresh the list."],
  invalid: ["Jira refused the request.", "Check the filter's JQL, or do this step in the browser."],
  server: ["Jira had a server error.", "Try again in a minute."],
  offline: ["Can't reach Jira.", "Are you on the company network (or VPN)? If Jira opens in your browser, its certificate may not be trusted here: try the curl connection. It retries every 5 minutes."],
  tls: ["Jira's certificate isn't trusted here.", "Switch the connection to curl in Settings (it uses this computer's certificates)."],
  timeout: ["Jira took too long to answer.", "Try again; if it keeps happening, Jira may be overloaded."],
  unknown: ["Something went wrong talking to Jira.", "Try again; the details are below."]
};
function shorten(text) {
  return String(text).replace(/^fetching \S+ failed:\s*/i, "").replace(/\(?https?:\/\/[^\s)]*\)?/g, "").replace(/\s{2,}/g, " ").trim().slice(0, 300);
}
function classify({ status, data, error, curlCode } = {}) {
  let kind;
  if (Number.isInteger(curlCode)) kind = CURL[curlCode] ?? "unknown";
  else if (Number.isInteger(status)) {
    kind = status === 401 ? "auth" : status === 403 ? "forbidden" : status === 404 ? "notfound" : status >= 500 ? "server" : status >= 400 ? "invalid" : "unknown";
  } else {
    const e = String(error ?? "");
    kind = TLS.test(e) ? "tls" : OFFLINE.test(e) ? "offline" : TIMEOUT.test(e) ? "timeout" : "unknown";
  }
  const [base, hint] = TEXT[kind];
  const jira = [...data?.errorMessages ?? [], ...Object.values(data?.errors ?? {})].filter((x) => typeof x === "string" && x);
  const detail = jira.length ? jira.join(" ") : kind === "unknown" ? shorten(error ?? (curlCode ? `curl exit ${curlCode}` : status ? `HTTP ${status}` : "")) : "";
  const out = { kind, message: detail ? `${base} ${detail}` : base, hint };
  const fields = Object.keys(data?.errors ?? {});
  if (fields.length) out.fields = fields;
  return out;
}
var DEFAULT_START_TASK = "Work on Jira issue {key}: {summary}\n{url}";
var PLACEHOLDERS = ["key", "summary", "url", "type", "status", "priority", "assignee", "description"];
var DESCRIPTION_MAX = 2e3;
function startTask(template, detail) {
  const t = (typeof template === "string" && template.trim() ? template : DEFAULT_START_TASK).replace(/\\n/g, "\n");
  return t.replace(/\{(\w+)\}/g, (whole, name) => {
    if (!PLACEHOLDERS.includes(name)) return whole;
    let v = detail?.[name];
    v = v == null ? "" : String(v);
    if (name === "description" && v.length > DESCRIPTION_MAX) v = `${v.slice(0, DESCRIPTION_MAX - 1)}\u2026`;
    return v;
  });
}
function latestOnly() {
  let n = 0;
  return { next: () => ++n, accept: (seq) => seq === n };
}
function ago(ms, now) {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, now - ms) / 1e3;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (30 * 86400))}mo`;
}

// src/shared/jira/transport.js
var DEFAULT_TIMEOUT_MS = 2e4;
var clean = (token) => String(token ?? "").replace(/[\r\n]/g, "").trim();
function fetchRequest({ method = "GET", url, token, body }) {
  const headers = { Accept: "application/json", Authorization: `Bearer ${clean(token)}` };
  if (body !== void 0) headers["Content-Type"] = "application/json";
  return { url, options: { method, headers, ...body !== void 0 ? { body: JSON.stringify(body) } : {} } };
}
function curlConfig(token) {
  const t = clean(token).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `header = "Authorization: Bearer ${t}"
`;
}
function curlArgs({ method = "GET", url, configPath, body, bodyPath, timeoutMs = DEFAULT_TIMEOUT_MS, caFile }) {
  const args = ["-sS", "--globoff", "-K", configPath, "-X", method, "-H", "Accept: application/json"];
  if (body !== void 0) args.push("-H", "Content-Type: application/json", "--data-binary", bodyPath ? `@${bodyPath}` : JSON.stringify(body));
  if (caFile) args.push("--cacert", caFile);
  args.push("--max-time", String(Math.max(1, Math.round(timeoutMs / 1e3))), "-w", "\n%{http_code}", url);
  return args;
}
function parseCurl({ code, stdout, stderr }) {
  if (code !== 0) return { curlCode: code, stderr: String(stderr ?? "").trim() };
  const out = String(stdout ?? "");
  const cut = out.lastIndexOf("\n");
  const status = Number(out.slice(cut + 1).trim());
  if (cut < 0 || !Number.isInteger(status) || status < 100) return { curlCode: -1, stderr: "curl printed no status" };
  return { status, text: out.slice(0, cut) };
}
function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// src/shared/jira/client.js
var DETAIL_FIELDS = [
  "summary",
  "description",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "project",
  "created",
  "updated",
  "resolution",
  "comment",
  "issuelinks",
  "parent"
];
var TIMEOUT2 = Symbol("timeout");
function errorText(e) {
  const parts = [e?.message ?? String(e)];
  for (let c = e?.cause, n = 0; c && n < 3; c = c.cause, n++) parts.push(c.code, c.message);
  return parts.filter(Boolean).join(" ");
}
function createClient({ base, transport = "fetch", token, curlConfigPath, curlBodyPath, caFile, io, timeoutMs = 2e4 }) {
  const root = String(base ?? "").replace(/\/+$/, "");
  const api = (path) => `${root}/rest/api/2${path}`;
  const agile = (path) => `${root}/rest/agile/1.0${path}`;
  const issuePath = (key) => `/issue/${encodeURIComponent(key)}`;
  async function viaFetch(method, url, body) {
    const { options } = fetchRequest({ method, url, token, body });
    let r;
    try {
      const call = Promise.resolve().then(() => io.fetch(url, options));
      r = io.sleep ? await Promise.race([call, io.sleep(timeoutMs).then(() => TIMEOUT2)]) : await call;
    } catch (e) {
      return { ok: false, problem: classify({ error: errorText(e) }) };
    }
    if (r === TIMEOUT2) return { ok: false, problem: classify({ error: "timed out" }) };
    let text = "";
    try {
      text = await r.text();
    } catch {
      text = "";
    }
    return answer(r.status, text);
  }
  async function putBody(text) {
    const now = await io.readTextFile(curlBodyPath).catch(() => null);
    if (now !== text) await io.writeTextFile(curlBodyPath, text, now);
  }
  async function viaCurl(method, url, body) {
    const useFile = body !== void 0 && curlBodyPath && io.writeTextFile && io.readTextFile;
    if (useFile) {
      try {
        await putBody(JSON.stringify(body));
      } catch (e) {
        return { ok: false, problem: { kind: "unknown", message: `Couldn't prepare the request: ${e?.message ?? e}`, hint: "Check the herdr-dock/secrets folder, or switch the connection to fetch." } };
      }
    }
    let res;
    try {
      res = await io.exec("curl", curlArgs({ method, url, configPath: curlConfigPath, body, bodyPath: useFile ? curlBodyPath : void 0, timeoutMs, caFile }), { timeout: timeoutMs + 1e4 });
    } catch (e) {
      return { ok: false, problem: { kind: "nocurl", message: `Couldn't run curl: ${e?.message ?? e}`, hint: "Install curl, or switch the connection to fetch in Settings." } };
    } finally {
      if (useFile) await putBody("").catch(() => {
      });
    }
    const p = parseCurl(res);
    if ("curlCode" in p) return { ok: false, problem: classify(p.curlCode === -1 ? { error: p.stderr } : { curlCode: p.curlCode }) };
    return answer(p.status, p.text);
  }
  function answer(status, text) {
    const data = parseJson(text);
    if (status >= 200 && status < 300) return { ok: true, status, data };
    return { ok: false, status, problem: classify({ status, data }) };
  }
  async function request(method, url, body) {
    try {
      return await (transport === "curl" ? viaCurl : viaFetch)(method, url, body);
    } catch (e) {
      return { ok: false, problem: classify({ error: String(e?.message ?? e) }) };
    }
  }
  const map = (r, f) => r.ok ? { ...r, data: f(r.data) } : r;
  const list3 = (d) => Array.isArray(d) ? d : [];
  const objects = (d) => list3(d).filter((x) => x && typeof x === "object" && !Array.isArray(x));
  const hasId = (x) => typeof x?.id === "number" ? Number.isFinite(x.id) : typeof x?.id === "string" && x.id.trim() !== "" && Number.isFinite(Number(x.id));
  const ms = (s) => {
    const t = Date.parse(s ?? "");
    return Number.isFinite(t) ? t : null;
  };
  const never = (call) => async (...args) => {
    try {
      return await call(...args);
    } catch (e) {
      return { ok: false, problem: classify({ error: String(e?.message ?? e) }) };
    }
  };
  return {
    serverInfo: () => request("GET", api("/serverInfo")),
    myself: () => request("GET", api("/myself")),
    search: (jql, page = {}) => request("GET", searchUrl(root, jql, page)),
    issue: (key) => request("GET", `${api(issuePath(key))}?fields=${DETAIL_FIELDS.join(",")}`),
    // A project's statuses across its issue types, once each, in Jira's order: [{ name, category }] (board columns).
    projectStatuses: (key) => request("GET", api(`/project/${encodeURIComponent(key)}/statuses`)).then((r) => map(r, (d) => {
      const seen = /* @__PURE__ */ new Map();
      for (const type of Array.isArray(d) ? d : []) {
        for (const st of type?.statuses ?? []) if (st?.name && !seen.has(st.name)) seen.set(st.name, { name: st.name, category: st.statusCategory?.key ?? "new" });
      }
      return [...seen.values()];
    })),
    // The scrum boards (whose name has `name` in it, when given): [{ id, name, type }].
    boards: never((name) => request("GET", agile(`/board?${new URLSearchParams({ type: "scrum", ...name ? { name } : {} })}`)).then((r) => map(r, (d) => objects(d?.values).filter(hasId).map((b) => ({ id: b.id, name: b.name, type: b.type }))))),
    // A board's columns, each with the ids (strings) of the statuses it holds, and the board's name when Jira sends
    // one: { name?, columns: [{ name, statusIds }] }.
    boardConfiguration: never((id) => request("GET", agile(`/board/${encodeURIComponent(id)}/configuration`)).then((r) => map(r, (d) => ({
      ...typeof d?.name === "string" && d.name.trim() ? { name: d.name } : {},
      columns: objects(d?.columnConfig?.columns).filter((c) => typeof c.name === "string").map((c) => ({ name: c.name, statusIds: objects(c.statuses).filter(hasId).map((st) => String(st.id)) }))
    })))),
    // A board's sprints in the given states ("active", "future", "closed"; anything but a list means all), in Jira's
    // order, following its pages of 50 (isLast; at most 20 pages): [{ id, name, state, startMs, endMs }]. A page that
    // fails fails the call.
    sprints: never(async (boardId2, states) => {
      const state = list3(states).filter((x) => typeof x === "string" && x).join(",");
      const out = [];
      for (let page = 0, startAt = 0; page < 20; page++) {
        const params = new URLSearchParams({ ...state ? { state } : {}, startAt: String(startAt), maxResults: "50" });
        const r = await request("GET", agile(`/board/${encodeURIComponent(boardId2)}/sprint?${params}`));
        if (!r.ok) return r;
        const values = list3(r.data?.values);
        out.push(...objects(values).filter(hasId).map((s) => ({ id: Number(s.id), name: s.name, state: s.state, startMs: ms(s.startDate), endMs: ms(s.endDate) })));
        if (r.data?.isLast !== false || !values.length) break;
        startAt += values.length;
      }
      return { ok: true, data: out };
    }),
    // An issue's description and its changelog's histories (what changed, when, by whom), newest last as Jira sends them.
    issueHistory: never((key) => request("GET", `${api(issuePath(key))}?fields=description&expand=changelog`).then((r) => map(r, (d) => ({ description: d?.fields?.description ?? null, histories: objects(d?.changelog?.histories).filter(hasId) })))),
    statuses: () => request("GET", api("/status")).then((r) => map(r, (d) => Array.isArray(d) ? d : [])),
    favouriteFilters: () => request("GET", api("/filter/favourite")).then((r) => map(r, (d) => Array.isArray(d) ? d : [])),
    // With each step's screen fields (required ones and their allowed values), so the page can ask for them.
    transitions: (key) => request("GET", api(`${issuePath(key)}/transitions?expand=transitions.fields`)).then((r) => map(r, (d) => d?.transitions ?? [])),
    transition: (key, id, fields) => request("POST", api(`${issuePath(key)}/transitions`), { transition: { id: String(id) }, ...fields ? { fields } : {} }),
    assign: (key, name) => request("PUT", api(`${issuePath(key)}/assignee`), { name }),
    comment: (key, text) => request("POST", api(`${issuePath(key)}/comment`), { body: text })
  };
}

// src/shared/jira/diff.js
var MAX_CELLS = 2e3 * 2e3;
var toLines = (text) => typeof text === "string" && text !== "" ? text.replace(/\r\n/g, "\n").split("\n") : [];
function lineDiff(before, after) {
  const a = toLines(before), b = toLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ op: "same", text: a[i] });
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  for (const o of diffMiddle(midA, midB)) ops.push(o);
  for (let i = endA; i < a.length; i++) ops.push({ op: "same", text: a[i] });
  return ops;
}
function diffStats(ops) {
  let added = 0, removed = 0;
  for (const o of Array.isArray(ops) ? ops : []) {
    if (o?.op === "add") added++;
    else if (o?.op === "del") removed++;
  }
  return { added, removed };
}
function foldDiff(ops, context = 2) {
  const all = Array.isArray(ops) ? ops : [];
  const keep = all.map((o) => o?.op === "add" || o?.op === "del");
  all.forEach((o, i) => {
    if (o?.op !== "add" && o?.op !== "del") return;
    for (let j = Math.max(0, i - context); j <= Math.min(all.length - 1, i + context); j++) keep[j] = true;
  });
  const out = [];
  for (let i = 0; i < all.length; ) {
    if (keep[i]) {
      out.push(all[i++]);
      continue;
    }
    let j = i;
    while (j < all.length && !keep[j]) j++;
    if (j - i === 1) out.push(all[i]);
    else out.push({ op: "skip", count: j - i });
    i = j;
  }
  return out;
}
var dels = (lines) => lines.map((text) => ({ op: "del", text }));
var adds = (lines) => lines.map((text) => ({ op: "add", text }));
function diffMiddle(a, b) {
  if (!a.length) return adds(b);
  if (!b.length) return dels(a);
  if (a.length * b.length > MAX_CELLS) return [...dels(a), ...adds(b)];
  const ids = /* @__PURE__ */ new Map();
  const num2 = (line) => {
    let n = ids.get(line);
    if (n === void 0) ids.set(line, n = ids.size);
    return n;
  };
  const x = a.map(num2), y = b.map(num2);
  const w = y.length + 1;
  const lcs = new Uint16Array((x.length + 1) * w);
  for (let i2 = x.length - 1; i2 >= 0; i2--) {
    for (let j2 = y.length - 1; j2 >= 0; j2--) {
      lcs[i2 * w + j2] = x[i2] === y[j2] ? lcs[(i2 + 1) * w + j2 + 1] + 1 : Math.max(lcs[(i2 + 1) * w + j2], lcs[i2 * w + j2 + 1]);
    }
  }
  const ops = [];
  let del = [], add = [];
  const flush = () => {
    for (const o of dels(del)) ops.push(o);
    for (const o of adds(add)) ops.push(o);
    del = [];
    add = [];
  };
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      flush();
      ops.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) del.push(a[i++]);
    else add.push(b[j++]);
  }
  while (i < x.length) del.push(a[i++]);
  while (j < y.length) add.push(b[j++]);
  flush();
  return ops;
}

// src/shared/jira/brief.js
var MINUTE_MS = 6e4;
var DEFAULT_SINCE_MINUTES = 14 * 24 * 60;
var PARENTS_PER_SEARCH = 50;
var KEYS_PER_SEARCH = 50;
var ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
var list = (v) => Array.isArray(v) ? v : [];
var isField = (item, name) => String(item?.field ?? "").toLowerCase() === name;
var timeOf = (v) => Date.parse(v);
var ME = (me) => me && typeof me === "object" ? { key: me.key, name: me.name } : { key: void 0, name: me };
var given = (v) => typeof v === "string" && v !== "";
var byMe = (author, me) => {
  const { key, name } = ME(me);
  return given(key) && author?.key === key || given(name) && author?.name === name;
};
var isMe = (user, me) => {
  const { key, name } = ME(me);
  return given(user) && (user === key || user === name);
};
function sinceMinutes(sprint, now) {
  const start = sprint?.startMs;
  const minutes = Number.isFinite(start) ? Math.ceil((now - start) / MINUTE_MS) : 0;
  return minutes > 0 ? minutes : DEFAULT_SINCE_MINUTES;
}
function changedSearches({ since, parentKeys }) {
  const recent = `updated >= -${since}m`;
  const keys = [...new Set(list(parentKeys).filter((k) => typeof k === "string" && ISSUE_KEY.test(k)))];
  const searches = [`assignee = currentUser() AND resolution = Unresolved AND ${recent}`];
  for (let i = 0; i < keys.length; i += PARENTS_PER_SEARCH) {
    searches.push(`key in (${keys.slice(i, i + PARENTS_PER_SEARCH).join(",")}) AND ${recent}`);
  }
  return searches;
}
function historyPlan(found, cache) {
  const stale = [], keep = [], seen = /* @__PURE__ */ new Set();
  for (const f of list(found)) {
    const key = f?.key;
    if (typeof key !== "string" || !key || seen.has(key)) continue;
    seen.add(key);
    const cached = cache?.get?.(key);
    (cached && cached.updated != null && cached.updated === f.updated ? keep : stale).push(key);
  }
  return { stale, keep };
}
function keySearches(keys) {
  const wanted = [...new Set(list(keys).filter((k) => typeof k === "string" && ISSUE_KEY.test(k)))];
  const searches = [];
  for (let i = 0; i < wanted.length; i += KEYS_PER_SEARCH) searches.push(`key in (${wanted.slice(i, i + KEYS_PER_SEARCH).join(",")})`);
  return searches;
}
var JQL_TOKENS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\border\s+by\b|\bor\b/gi;
function splitJql(jql) {
  let hasOr = false;
  for (const m of jql.matchAll(JQL_TOKENS)) {
    if (m[0][0] === '"' || m[0][0] === "'") continue;
    if (/^or$/i.test(m[0])) {
      hasOr = true;
      continue;
    }
    return { where: jql.slice(0, m.index).trim(), order: jql.slice(m.index).trim(), hasOr };
  }
  return { where: jql.trim(), order: "", hasOr };
}
var quoteName = (name) => `"${String(name).replace(/"/g, '\\"')}"`;
function bugsSearch({ briefBugs, highPriorities }) {
  const names = list(highPriorities);
  if (!names.length) return briefBugs;
  const { where, order, hasOr } = splitJql(String(briefBugs ?? ""));
  const conditions = [...where ? [hasOr ? `(${where})` : where] : [], `priority in (${names.map(quoteName).join(", ")})`];
  return `${conditions.join(" AND ")}${order ? ` ${order}` : ""}`;
}
function descriptionEdits(issue, { me } = {}) {
  const edits = [];
  for (const history of list(issue?.changelog?.histories)) {
    if (byMe(history?.author, me)) continue;
    const at = timeOf(history?.created);
    if (!Number.isFinite(at)) continue;
    for (const item of list(history?.items)) {
      if (!isField(item, "description")) continue;
      edits.push({ at, author: history.author?.displayName || history.author?.name || "", from: item.fromString ?? "", to: item.toString ?? "" });
    }
  }
  return edits.sort((a, b) => a.at - b.at);
}
function changedItem(issue, { me, sinceMs, marks } = {}) {
  if (!issue?.changelog) return null;
  const read = marks?.[issue.key]?.changed;
  const from = Math.max(Number.isFinite(sinceMs) ? sinceMs : 0, Number.isFinite(read) ? read : 0);
  const edits = descriptionEdits(issue, { me }).filter((e) => e.at > from);
  if (!edits.length) return null;
  const last = edits[edits.length - 1];
  return { key: issue.key, summary: issue.fields?.summary ?? "", edits, before: edits[0].from, after: last.to, at: last.at };
}
var sprintIds = (text) => String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
function addedTo(item, id) {
  const from = sprintIds(item.from), to = sprintIds(item.to);
  if (!to.includes(id) || from.includes(id)) return false;
  return !(from.length && from.every((x) => to.includes(x)));
}
function newInSprintItem(issue, { sprint, me } = {}) {
  const start = sprint?.startMs;
  if (!Number.isFinite(start)) return null;
  const at = {};
  const latest = (why2, time2) => {
    at[why2] = Math.max(at[why2] ?? 0, time2);
  };
  for (const history of list(issue?.changelog?.histories)) {
    const time2 = timeOf(history?.created);
    if (!(time2 > start)) continue;
    for (const item of list(history?.items)) {
      if (isField(item, "sprint") && addedTo(item, String(sprint.id))) latest("added", time2);
      else if (isField(item, "assignee") && isMe(item.to, me)) latest("assigned", time2);
    }
  }
  const created = timeOf(issue?.fields?.created);
  if (created > start) at.created = created;
  const why = ["added", "created", "assigned"].find((w) => at[w] !== void 0);
  return why ? { key: issue.key, summary: issue.fields?.summary ?? "", why, at: at[why], sprintId: sprint.id } : null;
}
var MARK = {
  changed: { store: (item) => ({ changed: item.at }), covers: (mark, item) => mark?.changed >= item.at },
  sprint: { store: (item) => ({ sprint: item.sprintId }), covers: (mark, item) => mark?.sprint === item.sprintId },
  bug: { store: () => ({ bug: true }), covers: (mark) => mark?.bug === true }
};
function isUnread(kind, item, marks) {
  return !MARK[kind]?.covers(marks?.[item.key], item);
}
function withRead(marks, kind, item) {
  return { ...marks, [item.key]: { ...marks?.[item.key], ...MARK[kind]?.store(item) } };
}
function pruneBugs(marks, bugKeys) {
  const listed = new Set(list(bugKeys));
  const pruned = {};
  for (const [key, mark] of Object.entries(marks ?? {})) {
    if (!mark?.bug || listed.has(key)) {
      pruned[key] = mark;
      continue;
    }
    const { bug: _bug, ...rest } = mark;
    if (Object.keys(rest).length) pruned[key] = rest;
  }
  return pruned;
}
function briefBadge({ changed, sprint, bugs } = {}, marks) {
  const unread = (kind, items) => list(items).filter((item) => isUnread(kind, item, marks)).length;
  const bugCount = unread("bug", bugs);
  const count = unread("changed", changed) + unread("sprint", sprint) + bugCount;
  return count ? { count, tone: bugCount ? "warn" : "info" } : null;
}
function briefLists({ changed, sprint, bugs } = {}, marks) {
  const unread = (kind) => (item) => isUnread(kind, item, marks);
  const newest2 = (a, b) => (b.at ?? 0) - (a.at ?? 0);
  const all = list(bugs).map((item) => ({ ...item, unread: isUnread("bug", item, marks) }));
  return {
    changed: list(changed).filter(unread("changed")).sort(newest2),
    sprint: list(sprint).filter(unread("sprint")).sort(newest2),
    bugs: [...all.filter((b) => b.unread), ...all.filter((b) => !b.unread)]
  };
}
function readEach(marks, brief, pick) {
  let out = marks ?? {};
  for (const [kind, items] of [["changed", brief?.changed], ["sprint", brief?.sprint], ["bug", brief?.bugs]]) {
    for (const item of list(items)) if (pick(kind, item) && isUnread(kind, item, out)) out = withRead(out, kind, item);
  }
  return out;
}
var readOnOpen = (marks, brief, key) => readEach(marks, brief, (kind, item) => kind !== "changed" && item.key === key);
var readAll = (marks, brief) => readEach(marks, brief, () => true);
function changeDiff(before, after) {
  const text = (markup) => wikiToText(markup).replace(/\n$/, "");
  return lineDiff(text(before), text(after));
}
function recentEdits(histories, { me, sinceMs } = {}) {
  const from = Number.isFinite(sinceMs) ? sinceMs : 0;
  return descriptionEdits({ changelog: { histories } }, { me }).filter((e) => e.at > from).reverse();
}
function editsText(edits, { when = true } = {}) {
  const all = list(edits);
  const names = [...new Set(all.map((e) => e?.author).filter(Boolean))];
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const span = when ? whenText(all) : "";
  return `${all.length} edit${all.length === 1 ? "" : "s"}${who ? ` by ${who}` : ""}${span ? `, ${span}` : ""}`;
}
function subtasksByParent(issues) {
  const out = /* @__PURE__ */ new Map();
  for (const issue of list(issues)) {
    const parent = issue?.fields?.parent?.key;
    if (typeof parent !== "string" || !parent || typeof issue.key !== "string") continue;
    if (!out.has(parent)) out.set(parent, []);
    if (!out.get(parent).includes(issue.key)) out.get(parent).push(issue.key);
  }
  for (const keys of out.values()) keys.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return out;
}
function checkWork(item, { template, subtasks } = {}) {
  if (!item?.key) return null;
  const own = subtasks?.get?.(item.key);
  const mine = Array.isArray(own) && own.length ? own : [item.key];
  const task = checkMessage(template, { key: item.key, summary: item.summary, edits: item.edits, mine });
  return { command: "tab.new", args: { name: `${item.key} check`, argv: ["claude"], task } };
}
var day = (date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
var clock = (date) => date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function whenText(edits) {
  const times = list(edits).map((e) => e?.at).filter(Number.isFinite);
  if (!times.length) return "";
  const first = new Date(Math.min(...times)), last = new Date(Math.max(...times));
  if (first.toDateString() !== last.toDateString()) return `${day(first)} \u2013 ${day(last)}`;
  return clock(first) === clock(last) ? `${day(first)} ${clock(first)}` : `${day(first)} ${clock(first)}\u2013${clock(last)}`;
}
function checkMessage(template, { key, summary, edits, mine }) {
  const values = { key, summary, when: whenText(edits), mine: list(mine).join(", ") };
  return String(template ?? "").replace(/\{(\w+)\}/g, (whole, name) => Object.hasOwn(values, name) ? String(values[name] ?? "") : whole);
}

// src/shared/jira/actions.js
function projectOf(issue) {
  if (issue?.project != null) return issue.project;
  const key = String(issue?.key ?? "");
  const dash = key.lastIndexOf("-");
  return dash > 0 ? key.slice(0, dash) : null;
}
function matches(rule, issue) {
  if (rule.project != null && rule.project !== projectOf(issue)) return false;
  if (rule.type != null && rule.type !== issue?.type) return false;
  if (rule.subtask != null && rule.subtask !== Boolean(issue?.subtask)) return false;
  if (rule.parentType != null && !(Array.isArray(rule.parentType) && rule.parentType.includes(issue?.parent?.type))) return false;
  return true;
}
function matchAction(rules, issue) {
  const rule = (Array.isArray(rules) ? rules : []).find((r) => r && typeof r === "object" && matches(r, issue));
  return { start: rule?.start ?? null, finish: rule?.finish ?? null };
}

// src/shared/jira/page.js
var SHOWN_EVERY_MS = 2 * 6e4;
var HIDDEN_EVERY_MS = 10 * 6e4;
var RETRY_AFTER_MS = 5 * 6e4;
var PAGE_SIZE = 50;
function filterList(favourites, own) {
  const out = BUILTIN_FILTERS.map((f) => ({ ...f, source: "builtin" }));
  for (const f of Array.isArray(favourites) ? favourites : []) {
    if (f && typeof f.jql === "string" && f.jql.trim() && f.name) out.push({ id: `fav:${f.id}`, name: String(f.name), jql: f.jql, source: "favourite" });
  }
  (Array.isArray(own) ? own : []).forEach((f, i) => {
    if (f?.name && f?.jql) out.push({ id: `own:${i}:${f.name}`, name: f.name, jql: f.jql, source: "own" });
  });
  return out;
}
var pickFilter = (filters, id) => filters.find((f) => f.id === id) ?? filters[0];
function pollDue({ shown, lastAt, failed, now, loading = false }) {
  if (loading) return false;
  if (!Number.isFinite(lastAt)) return true;
  const every = failed ? Math.max(RETRY_AFTER_MS, shown ? SHOWN_EVERY_MS : HIDDEN_EVERY_MS) : shown ? SHOWN_EVERY_MS : HIDDEN_EVERY_MS;
  return now - lastAt >= every;
}
function pageState({ settings, token, editing, connected, problem, checking: checking2 }) {
  if (editing) return "settings";
  if (!settings?.baseUrl || !token) return "setup";
  if (problem) return "problem";
  if (checking2 || !connected) return "checking";
  return "ready";
}
var REFRESH_CAP = 200;
var refreshSize = (loaded) => Math.min(REFRESH_CAP, Math.max(PAGE_SIZE, Number.isFinite(loaded) ? loaded : 0));
function countText(shown, total) {
  if (!Number.isFinite(total)) return "";
  if (shown >= total) return `${total} issue${total === 1 ? "" : "s"}`;
  return `${shown} of ${total}`;
}
function keyColumnWidth(keys) {
  const longest = (keys ?? []).reduce((n, k) => k == null ? n : Math.max(n, String(k).length), 0);
  return Math.min(132, Math.max(56, Math.ceil(longest * 7.5) + 6));
}
function canAssignToMe(detail, me) {
  if (!detail || !me?.name) return false;
  return String(detail.assigneeName ?? "").toLowerCase() !== String(me.name).toLowerCase();
}
var DONE = { assign: "Assigned to you.", comment: "Comment added." };
function actionOutcome(kind, result, extra = {}) {
  if (result?.ok) return { ok: true, message: kind === "transition" ? `Moved to ${extra.to ?? "the new status"}.` : DONE[kind] ?? "Done." };
  const p = result?.problem ?? { message: "Something went wrong.", hint: "" };
  if (kind === "transition" && p.fields?.length) {
    return { ok: false, message: `Jira wants more for this step (${p.fields.join(", ")}): open it in the browser.`, link: extra.url };
  }
  return { ok: false, message: [p.message, p.hint].filter(Boolean).join(" ") };
}
var commentReady = (text) => String(text ?? "").trim().length > 0;
function withComment(detail, comment) {
  const added = { id: comment.id, author: comment.author?.displayName ?? "you", bodyText: wikiToText(comment.body), createdMs: Date.parse(comment.created ?? "") || null };
  return { ...detail, comments: [...detail.comments, added].slice(-5), commentTotal: (detail.commentTotal ?? detail.comments.length) + 1 };
}
function startWork(issue, template) {
  if (!issue?.key) return null;
  return { command: "tab.new", args: { name: issue.key, argv: ["claude"], task: startTask(template, issue) } };
}
function tabButtonWork(button) {
  if (!button) return null;
  return { command: "tab.new", args: { name: button.label, argv: ["claude"], task: button.task.replace(/\\n/g, "\n") } };
}
var startTemplate = (rules, issue, fallback) => matchAction(rules, issue).start ?? fallback;
function finishWork(issue, rules) {
  const finish = matchAction(rules, issue).finish;
  if (!issue?.key || !finish) return null;
  return { command: "tab.new", args: { name: `${issue.key} finish`, argv: ["claude"], task: startTask(finish, issue) } };
}
function needsDetail(template) {
  const t = typeof template === "string" && template.trim() ? template : DEFAULT_START_TASK;
  return /\{description\}/.test(t);
}
function afterProblem(kind) {
  const token = kind === "auth" || kind === "forbidden";
  return { connected: !token, clearBadge: token, pause: token };
}
var countFailure = (kind) => kind === "auth" || kind === "forbidden" ? "page" : "tab";
var CONNECTION = ["auth", "forbidden", "offline", "tls", "nocurl"];
function todayFailure(kind, { shown = false, agile = false } = {}) {
  if (agile) return "today";
  if (!shown) return countFailure(kind) === "page" ? "page" : "today";
  return CONNECTION.includes(kind) ? "page" : "today";
}
function previewTask(issue, template) {
  if (!issue?.key) return "";
  const shown = !("description" in issue) && needsDetail(template) ? { ...issue, description: "(its description, fetched when you start)" } : issue;
  return startWork(shown, template)?.args.task ?? "";
}
var CLEARED_VIEW = Object.freeze({
  me: null,
  rows: [],
  total: void 0,
  fetchedAt: null,
  listProblem: null,
  selected: null,
  detail: null,
  detailProblem: null,
  favourites: [],
  statusOrder: [],
  transitions: null,
  transOpen: false,
  actionMsg: null
});
var DRAG_START_PX = 5;
function dragStarted(from, to) {
  if (!from || !to) return false;
  return Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_START_PX;
}
function dropTargets(transitions, current) {
  if (!Array.isArray(transitions)) return /* @__PURE__ */ new Set();
  return new Set(transitions.map((t) => t?.to?.name).filter((name) => name && name !== current));
}
function dropPlan(transitions, status, current) {
  if (!Array.isArray(transitions) || status === current) return { kind: "none" };
  const ways = transitions.filter((t) => t?.to?.name === status);
  if (!ways.length) return { kind: "none" };
  return ways.length === 1 ? { kind: "run", transition: ways[0] } : { kind: "choose", transitions: ways };
}
var RANK2 = { new: 0, indeterminate: 1, done: 2 };
function dragColumns(cols, targets, transitions, order = []) {
  if (!targets?.size) return cols;
  const have = new Set(cols.map((c) => c.status));
  const extra = [...targets].filter((name) => !have.has(name)).map((name) => {
    const cat = (transitions ?? []).find((t) => t?.to?.name === name)?.to?.statusCategory?.key;
    return { status: name, category: cat in RANK2 ? cat : "indeterminate", rows: [], temporary: true };
  });
  if (!extra.length) return cols;
  const pos = (name) => {
    const i = order.indexOf(name);
    return i < 0 ? Infinity : i;
  };
  return [...cols, ...extra].map((c, i) => ({ c, i })).sort((a, b) => (RANK2[a.c.category] ?? 1) - (RANK2[b.c.category] ?? 1) || (pos(a.c.status) - pos(b.c.status) || 0) || a.i - b.i).map(({ c }) => c);
}
var boardProjects = (rows) => [...new Set((rows ?? []).map((r) => String(r.key ?? "").split("-")[0]).filter(Boolean))];
function unionStatuses(lists) {
  const seen = /* @__PURE__ */ new Map();
  for (const list3 of lists ?? []) if (Array.isArray(list3)) {
    for (const st of list3) if (st?.name && !seen.has(st.name)) seen.set(st.name, st);
  }
  return [...seen.values()];
}
function workflowStatuses(rows, statusesByProject) {
  const projects = boardProjects(rows);
  return projects.length === 1 ? unionStatuses([statusesByProject?.get(projects[0])]) : [];
}
function refusedDropText(key, from, to, targets) {
  const allowed = targets ? [...targets] : [];
  if (!allowed.length) return `${key} can't move from ${from}.`;
  return `${key} can't go to ${to} from ${from}. Its workflow allows: ${allowed.join(", ")}.`;
}
function stepNeeds(transition) {
  const required = Object.entries(transition?.fields ?? {}).filter(([, f]) => f?.required);
  if (!required.length) return { kind: "none" };
  const pickable = required.filter(([, f]) => Array.isArray(f.allowedValues) && f.allowedValues.length);
  if (required.length === 1 && pickable.length === 1) {
    const [key, f] = pickable[0];
    return { kind: "pick", fields: [{ key, name: f.name ?? key, options: f.allowedValues.map((v) => ({ id: v.id, name: v.name ?? v.value ?? String(v.id) })) }] };
  }
  const blocking = required.filter((r) => !pickable.includes(r));
  return { kind: "browser", names: (blocking.length ? blocking : required).map(([key, f]) => f.name ?? key) };
}
var stepFields = (key, option) => ({ [key]: option.id != null ? { id: option.id } : { name: option.name } });
function keepMoved(rows, moved) {
  if (!moved?.size) return rows;
  const have = new Set(rows.map((r) => r.key));
  return [...rows.map((r) => moved.has(r.key) ? { ...r, ...moved.get(r.key) } : r), ...[...moved.values()].filter((m) => !have.has(m.key))];
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/shared/jira/severity.js
var COLOR_NAMES = Object.freeze(["red", "orange", "yellow", "green", "blue", "purple", "gray"]);
var DEFAULT_UNRATED = "No severity";
var HEX_COLOR = /^#[0-9a-f]{6}$/i;
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
function parseLevel(l, at) {
  if (!isObj(l)) return { error: `${at} is not an object` };
  if (!Array.isArray(l.values) || !l.values.length || !l.values.every(nonEmpty)) return { error: `${at} needs a list of values` };
  if (!nonEmpty(l.label)) return { error: `${at} needs a label` };
  const color = typeof l.color === "string" ? l.color.trim() : "";
  if (!COLOR_NAMES.includes(color) && !HEX_COLOR.test(color)) return { error: `${at} colour is not ${COLOR_NAMES.join(", ")} or #rrggbb` };
  if (l.attention != null && typeof l.attention !== "boolean") return { error: `${at} attention is not true or false` };
  return { level: { values: l.values.map((v) => v.trim()), label: l.label.trim(), color: color.toLowerCase(), attention: l.attention === true } };
}
function parseSeverity(value, at) {
  const bad = (what) => ({ severity: null, warning: `${at}.severity: ${what}` });
  if (!isObj(value)) return bad("not an object");
  if (!nonEmpty(value.field)) return bad("needs a field");
  if (!Array.isArray(value.levels) || !value.levels.length) return bad("needs a list of levels");
  const levels = [];
  for (const [i, l] of value.levels.entries()) {
    const { level, error } = parseLevel(l, `levels[${i}]`);
    if (error) return bad(error);
    levels.push(level);
  }
  if (value.unrated != null && !nonEmpty(value.unrated)) return bad("unrated is not a name");
  return { severity: { field: value.field.trim(), levels, unrated: nonEmpty(value.unrated) ? value.unrated.trim() : DEFAULT_UNRATED }, warning: null };
}

// src/shared/jira/settings.js
var DEFAULT_SETTINGS = Object.freeze({ v: 1, baseUrl: "", transport: "fetch", caFile: "", startTask: "", filters: [] });
var TRANSPORTS = ["fetch", "curl"];
function siteName(site) {
  const s = String(site ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(s) ? s : "work";
}
function jiraPaths(appHome2, site) {
  const home = slashPath(appHome2).replace(/\/+$/, "");
  const name = siteName(site);
  const dir = `${home}/herdr-dock`;
  const secretsDir = `${dir}/secrets`;
  return {
    dir,
    settingsPath: `${dir}/jira-${name}.json`,
    secretsDir,
    tokenPath: `${secretsDir}/jira-${name}.token`,
    curlConfigPath: `${secretsDir}/jira-${name}.curlrc`,
    bodyPath: `${secretsDir}/jira-${name}.body`
    // a curl request's body (a comment), emptied after each request
  };
}
var JIRA_PAGES = /\/(browse|secure|projects|issues|rest|plugins|servicedesk|login\.jsp|dashboards?)(\/|$|\?|\.)/i;
function normalizeBaseUrl(text) {
  let s = String(text ?? "").trim();
  if (!s) return { ok: false, error: "Enter Jira's address, e.g. https://jira.example.com" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/\s/.test(s) || !/^[\w.-]+(:\d+)?(\/|$)/.test(s)) return { ok: false, error: "That doesn't look like an address." };
    s = `https://${s}`;
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "That doesn't look like an address." };
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "Jira's address starts with https:// (or http://)." };
  if (!u.hostname) return { ok: false, error: "That address has no host." };
  let path = u.pathname;
  const m = JIRA_PAGES.exec(path);
  if (m) path = path.slice(0, m.index);
  path = path.replace(/\/+$/, "");
  return { ok: true, url: `${u.protocol}//${u.host}${path}` };
}
function validateToken(text) {
  const t = String(text ?? "").trim();
  if (!t) return { ok: false, error: "Paste your personal access token." };
  if (/^bearer\s/i.test(t)) return { ok: false, error: 'Paste the token alone, without "Bearer".' };
  if (/\s/.test(t)) return { ok: false, error: "A token is one word, without spaces." };
  return { ok: true, token: t };
}
var isObj2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var str = (v) => typeof v === "string" ? v : "";
function parseSettings(text) {
  if (text == null || !String(text).trim()) return { ok: true, settings: { ...DEFAULT_SETTINGS, filters: [] } };
  let raw;
  try {
    raw = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, settings: { ...DEFAULT_SETTINGS, filters: [] }, error: `not valid JSON (${e.message})` };
  }
  if (!isObj2(raw)) return { ok: false, settings: { ...DEFAULT_SETTINGS, filters: [] }, error: "not a JSON object" };
  const { token: _never, ...rest } = raw;
  return {
    ok: true,
    settings: {
      ...rest,
      v: 1,
      baseUrl: str(raw.baseUrl).trim(),
      transport: TRANSPORTS.includes(raw.transport) ? raw.transport : "fetch",
      caFile: str(raw.caFile).trim(),
      startTask: str(raw.startTask),
      filters: (Array.isArray(raw.filters) ? raw.filters : []).filter((f) => isObj2(f) && str(f.name).trim() && str(f.jql).trim()).map((f) => ({ name: f.name.trim(), jql: f.jql.trim() }))
    }
  };
}
function settingsReload(current, text, file) {
  const parsed = parseSettings(text);
  if (!parsed.ok) return { kind: "keep", problem: `herdr-dock/${file} ${parsed.error}; the page keeps the settings it had until the file is fixed` };
  return { kind: "load", newSite: parsed.settings.baseUrl !== (current?.baseUrl ?? "") };
}
function formatSettings(settings) {
  const { token: _never, ...rest } = settings ?? {};
  return JSON.stringify({ ...DEFAULT_SETTINGS, ...rest, v: 1 }, null, 2) + "\n";
}
var DEFAULT_HIGH_PRIORITIES = /* @__PURE__ */ Object.freeze(["Highest", "High"]);
var DEFAULT_BRIEF_BUGS = "issuetype = Bug AND assignee = currentUser() AND resolution = Unresolved";
var DEFAULT_CHECK_TASK = "The description of {key} ({summary}) changed {when}. Read the change with your Jira tools and check it against my work on {mine} in this repo.";
var VIEW_ID = /^[a-z][a-z0-9-]{0,23}$/;
var nonEmpty2 = (v) => typeof v === "string" && v.trim() !== "";
function boardId(v) {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function parseRule(a) {
  if (!isObj2(a)) return { error: "not an object" };
  const rule = {};
  for (const k of ["project", "type"]) {
    if (a[k] == null) continue;
    if (!nonEmpty2(a[k])) return { error: `${k} is not a name` };
    rule[k] = a[k].trim();
  }
  if (a.subtask != null) {
    if (typeof a.subtask !== "boolean") return { error: "subtask is not true or false" };
    rule.subtask = a.subtask;
  }
  if (a.parentType != null) {
    const list3 = typeof a.parentType === "string" ? [a.parentType] : a.parentType;
    if (!Array.isArray(list3) || !list3.length || !list3.every(nonEmpty2)) return { error: "parentType is not a type name or a list of them" };
    rule.parentType = list3.map((t) => t.trim());
  }
  for (const k of ["start", "finish"]) if (nonEmpty2(a[k])) rule[k] = a[k];
  if (rule.start === void 0 && rule.finish === void 0) return { error: "needs a start or a finish" };
  return { rule };
}
function jiraOptions(settings) {
  const s = isObj2(settings) ? settings : {};
  const warnings = [];
  let board = null;
  if (s.board != null) {
    board = boardId(s.board);
    if (board === null) warnings.push("board: not a board id");
  }
  const hp = s.highPriorities;
  const highPriorities = Array.isArray(hp) && hp.length && hp.every(nonEmpty2) ? hp.map((p) => p.trim()) : [...DEFAULT_HIGH_PRIORITIES];
  const views = [];
  if (s.views != null && !Array.isArray(s.views)) warnings.push("views: not a list");
  for (const [i, v] of (Array.isArray(s.views) ? s.views : []).entries()) {
    const at = `views[${i}]`;
    if (!isObj2(v)) {
      warnings.push(`${at}: not an object`);
      continue;
    }
    const name = str(v.name).trim();
    const jql = str(v.jql).trim();
    if (!name || !jql) {
      warnings.push(`${at}: needs a name and a jql`);
      continue;
    }
    if (typeof v.id !== "string" || !VIEW_ID.test(v.id)) {
      warnings.push(`${at}: the id must be lower-case letters, digits and dashes, starting with a letter (24 at most)`);
      continue;
    }
    if (v.id === "today") {
      warnings.push(`${at}: "today" is the Today tab's id`);
      continue;
    }
    if (views.some((w) => w.id === v.id)) {
      warnings.push(`${at}: the id "${v.id}" is already used`);
      continue;
    }
    let severity = null;
    if (v.severity != null) {
      const parsed = parseSeverity(v.severity, at);
      severity = parsed.severity;
      if (parsed.warning) warnings.push(parsed.warning);
    }
    let group = null;
    if (v.group == null) group = severity ? "severity" : null;
    else if (v.group === "type") group = "type";
    else if (v.group === "severity") {
      if (severity) group = "severity";
      else warnings.push(`${at}: group "severity" needs a valid severity block`);
    } else warnings.push(`${at}: group "${v.group}" is not "type" or "severity"`);
    let button = null;
    if (v.button != null) {
      if (isObj2(v.button) && nonEmpty2(v.button.label) && nonEmpty2(v.button.task)) button = { label: v.button.label.trim(), task: v.button.task.trim() };
      else warnings.push(`${at}: button needs a label and a task`);
    }
    views.push({ id: v.id, name, jql, group, button, severity });
  }
  const actions = [];
  if (s.actions != null && !Array.isArray(s.actions)) warnings.push("actions: not a list");
  for (const [i, a] of (Array.isArray(s.actions) ? s.actions : []).entries()) {
    const { rule, error } = parseRule(a);
    if (error) warnings.push(`actions[${i}]: ${error}`);
    else actions.push(rule);
  }
  return {
    board,
    highPriorities,
    briefBugs: nonEmpty2(s.briefBugs) ? s.briefBugs.trim() : DEFAULT_BRIEF_BUGS,
    views,
    actions,
    checkTask: nonEmpty2(s.checkTask) ? s.checkTask : DEFAULT_CHECK_TASK,
    warnings
  };
}
function prioritiesText(settings) {
  const hp = isObj2(settings) ? settings.highPriorities : null;
  return Array.isArray(hp) ? hp.filter(nonEmpty2).map((p) => p.trim()).join(", ") : "";
}
function withFormOptions(settings, { board, priorities }) {
  const { board: _b, highPriorities: _h, ...rest } = isObj2(settings) ? settings : {};
  const names = String(priorities ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return { ...rest, ...board != null ? { board } : {}, ...names.length ? { highPriorities: names } : {} };
}

// src/shared/jira/sprint.js
var DAY_MS = 864e5;
var KEEP_CLOSED = 5;
var num = (v) => Number.isFinite(v) ? v : null;
var list2 = (v) => Array.isArray(v) ? v : [];
function sprintColumns(columns, statuses) {
  const names = new Map(list2(statuses).map((s) => [String(s?.id), s?.name]));
  return list2(columns).map((c) => ({
    name: String(c?.name ?? ""),
    statuses: list2(c?.statusIds).map((id) => names.get(String(id))).filter((n) => typeof n === "string" && n)
  }));
}
var earliest = (a, b) => (num(a.startMs) ?? Infinity) - (num(b.startMs) ?? Infinity) || a.id - b.id;
var newest = (a, b) => {
  const x = num(a.startMs) ?? Infinity, y = num(b.startMs) ?? Infinity;
  return x === y ? b.id - a.id : y - x;
};
function pickSprint(active, mineBySprint) {
  const mine = (s) => mineBySprint?.get?.(s.id) ?? 0;
  const sorted = [...list2(active)].sort((a, b) => mine(b) - mine(a) || earliest(a, b));
  return sorted[0] ?? null;
}
function shownSprint({ picked, shown, all, closed, current }) {
  if (picked == null) return current ?? null;
  const found = [...list2(all), ...list2(closed)].find((s) => s?.id === picked);
  if (found) return found;
  if (closed == null && shown?.id === picked && shown.state === "closed") return shown;
  return current ?? null;
}
function seriesKey(name) {
  const text = String(name ?? "");
  return /\d/.test(text) ? text.replace(/\d+(?!.*\d)/, "#").trim() : null;
}
function sprintSeries(current, sprints, mineBySprint) {
  if (!current) return [];
  const all = list2(sprints);
  const key = seriesKey(current.name);
  let picked;
  if (key === null) {
    picked = all.filter((s) => (mineBySprint?.get?.(s.id) ?? 0) > 0);
  } else {
    const same = all.filter((s) => seriesKey(s.name) === key);
    const rank = (s) => num(s.endMs) ?? num(s.startMs) ?? -Infinity;
    const closed = same.filter((s) => s.state === "closed").sort((a, b) => rank(b) - rank(a) || b.id - a.id).slice(0, KEEP_CLOSED);
    const next = same.filter((s) => s.state === "future").sort(earliest).slice(0, 1);
    picked = [...next, ...same.filter((s) => s.state === "active"), ...closed];
  }
  return [...new Map([...picked, current].map((s) => [s.id, s])).values()].sort(newest);
}
function sprintRows(rows) {
  const all = list2(rows);
  const own = new Map(all.map((r) => [r?.key, r]));
  const parents = new Set(all.map((r) => r?.parent?.key).filter(Boolean));
  const lanes = /* @__PURE__ */ new Map();
  const loose = [];
  for (const row of all) {
    if (!row || parents.has(row.key)) continue;
    const p = row.parent;
    if (!p?.key) {
      loose.push(row);
      continue;
    }
    if (!lanes.has(p.key)) {
      const head = own.get(p.key) ?? p;
      lanes.set(p.key, { parent: { key: head.key, summary: head.summary, status: head.status }, rows: [] });
    }
    lanes.get(p.key).rows.push(row);
  }
  return [...lanes.values(), ...loose.length ? [{ parent: null, rows: loose }] : []];
}
function columnDrop(transitions, column, current) {
  const into = new Set(list2(column?.statuses));
  if (into.has(current)) return { kind: "none" };
  const ways = list2(transitions).filter((t) => t?.to?.name && into.has(t.to.name));
  if (!ways.length) return { kind: "none" };
  return ways.length === 1 ? { kind: "run", transition: ways[0] } : { kind: "choose", transitions: ways };
}
var shortDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
var dayOf = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};
function sprintLabel(sprint, now) {
  const name = String(sprint?.name ?? "");
  const start = num(sprint?.startMs), end = num(sprint?.endMs);
  if (start === null || end === null) return name;
  const head = `${name} \xB7 ${shortDate(start)} \u2013 ${shortDate(end)}`;
  if (sprint.state === "closed" || end - now <= 0) return `${head} \xB7 ended`;
  const days = Math.round((dayOf(end) - dayOf(now)) / DAY_MS);
  if (days <= 0) return `${head} \xB7 ends today`;
  return `${head} \xB7 ${days} ${days === 1 ? "day" : "days"} left`;
}
var sprintJql = (id) => `sprint = ${id} AND assignee = currentUser() ORDER BY Rank`;
var sprintMineJql = (id) => `sprint = ${id} AND assignee = currentUser()`;
var SPRINT_CACHE_MS = 60 * 6e4;
var sprintCacheDue = (at, now) => !Number.isFinite(at) || now - at >= SPRINT_CACHE_MS;
function closedNeeded({ active, menuOpen, closedAt }) {
  return closedAt == null && (Boolean(menuOpen) || !list2(active).length);
}
function litColumns(columns, targets, current) {
  const out = /* @__PURE__ */ new Set();
  for (const c of list2(columns)) {
    const statuses = list2(c?.statuses);
    if (!statuses.includes(current) && statuses.some((s) => targets?.has?.(s))) out.add(c.name);
  }
  return out;
}
function laneCells(lane, columns) {
  const rows = list2(lane?.rows);
  return list2(columns).map((c) => {
    const into = new Set(list2(c?.statuses));
    return rows.filter((r) => into.has(r?.status));
  });
}
function menuSprint(current, sprints) {
  if (current) return current;
  const all = list2(sprints);
  const rank = (s) => num(s.endMs) ?? num(s.startMs) ?? -Infinity;
  const closed = all.filter((s) => s?.state === "closed").sort((a, b) => rank(b) - rank(a) || b.id - a.id);
  if (closed.length) return closed[0];
  return all.filter((s) => s?.state === "future").sort(earliest)[0] ?? null;
}

// src/shared/jira/store.js
var NODE_MKDIR = "const fs=require('fs');fs.mkdirSync(process.argv[1],{recursive:true,mode:process.argv[2]==='private'?0o700:0o755});if(process.argv[2]==='private')fs.chmodSync(process.argv[1],0o700)";
var NODE_CHMOD = "const fs=require('fs');for(const p of process.argv.slice(1))fs.chmodSync(p,0o600)";
async function makeFolder(io, dir, kind) {
  try {
    const r = await io.exec("node", ["-e", NODE_MKDIR, dir, kind]);
    return r.code === 0 ? null : (r.stderr || `node exit ${r.code}`).trim();
  } catch (e) {
    return `couldn't run node: ${e?.message ?? e}`;
  }
}
async function put(io, path, text) {
  const now = await io.readTextFile(path).catch(() => null);
  if (now === text) return;
  await io.writeTextFile(path, text, now);
}
async function loadJira(io, site) {
  const paths = jiraPaths(io.appHome, site);
  const settingsText = await io.readTextFile(paths.settingsPath).catch(() => null);
  const parsed = parseSettings(settingsText);
  const raw = await io.readTextFile(paths.tokenPath).catch(() => null);
  const token = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  return {
    paths,
    settings: parsed.settings,
    settingsText,
    token,
    problem: parsed.ok ? null : `herdr-dock/${paths.settingsPath.split("/").pop()} ${parsed.error}; using defaults until it's saved again`
  };
}
async function saveSettings(io, site, settings, expectedText) {
  const paths = jiraPaths(io.appHome, site);
  const text = formatSettings(settings);
  try {
    if (expectedText === void 0) {
      try {
        await put(io, paths.settingsPath, text);
      } catch {
        const err = await makeFolder(io, paths.dir, "plain");
        if (err) return { ok: false, error: `couldn't create ${paths.dir}: ${err}` };
        await put(io, paths.settingsPath, text);
      }
    } else {
      await io.writeTextFile(paths.settingsPath, text, expectedText);
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: /stale/i.test(String(e?.message ?? e)) ? "the settings changed on disk meanwhile; reopen Settings and save again" : `couldn't save: ${e?.message ?? e}` };
  }
}
async function saveToken(io, site, text) {
  const v = validateToken(text);
  if (!v.ok) return { ok: false, error: v.error };
  const paths = jiraPaths(io.appHome, site);
  const err = await makeFolder(io, paths.secretsDir, "private");
  if (err) return { ok: false, error: `couldn't make the secrets folder private: ${err}` };
  try {
    await put(io, paths.tokenPath, `${v.token}
`);
    await put(io, paths.curlConfigPath, curlConfig(v.token));
  } catch (e) {
    return { ok: false, error: `couldn't save the token: ${e?.message ?? e}` };
  }
  return lockFiles(io, paths);
}
async function syncCurlConfig(io, site, token) {
  const paths = jiraPaths(io.appHome, site);
  const want = curlConfig(token);
  const now = await io.readTextFile(paths.curlConfigPath).catch(() => null);
  if (now === want) return { ok: true, changed: false };
  const err = await makeFolder(io, paths.secretsDir, "private");
  if (err) return { ok: false, error: `couldn't make the secrets folder private: ${err}` };
  try {
    await put(io, paths.curlConfigPath, want);
  } catch (e) {
    return { ok: false, error: `couldn't update the curl config: ${e?.message ?? e}` };
  }
  const locked = await lockFiles(io, paths);
  return locked.ok ? { ok: true, changed: true } : locked;
}
async function clearToken(io, site) {
  const paths = jiraPaths(io.appHome, site);
  try {
    for (const p of [paths.tokenPath, paths.curlConfigPath]) {
      const now = await io.readTextFile(p).catch(() => null);
      if (now) await io.writeTextFile(p, "", now);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `couldn't clear the token: ${e?.message ?? e}` };
  }
}
async function lockFiles(io, paths) {
  if (io.platform === "windows") return { ok: true };
  try {
    const r = await io.exec("node", ["-e", NODE_CHMOD, paths.tokenPath, paths.curlConfigPath]);
    return r.code === 0 ? { ok: true } : { ok: false, error: `token saved, but couldn't make it private: ${(r.stderr || "").trim()}` };
  } catch (e) {
    return { ok: false, error: `token saved, but couldn't make it private: ${e?.message ?? e}` };
  }
}

// src/shared/jira/views.js
var ALL_JQL = "assignee = currentUser() ORDER BY updated DESC";
var TODAY = { id: "today", name: "Today", kind: "today", jql: null, group: null, filters: false, button: null, severity: null };
var MINE = { id: "mine", name: "Mine", kind: "search", jql: BUILTIN_FILTERS[0].jql, group: null, filters: false, button: null, severity: null };
var ALL = { id: "all", name: "All", kind: "search", jql: ALL_JQL, group: null, filters: true, button: null, severity: null };
var fromView = (v) => ({ id: v.id, name: v.name, kind: "search", jql: v.jql, group: v.group, filters: false, button: v.button ?? null, severity: v.severity ?? null });
function tabList(views, { today } = {}) {
  const own = (id) => views.find((v) => v.id === id);
  const builtin = (tab) => {
    const v = own(tab.id);
    return v ? { ...tab, name: v.name, jql: v.jql, group: v.group, button: v.button ?? null, severity: v.severity ?? null } : tab;
  };
  return [
    ...today ? [TODAY] : [],
    ...views.filter((v) => v.id !== MINE.id && v.id !== ALL.id).map(fromView),
    builtin(MINE),
    builtin(ALL)
  ];
}
var pickTab = (tabs, id) => tabs.find((t) => t.id === id) ?? tabs[0];
function stepTab(tabs, id, dir) {
  const at = Math.max(0, tabs.findIndex((t) => t.id === id));
  return tabs[(at + dir + tabs.length) % tabs.length].id;
}
function sectionsFor(rows, group) {
  if (group !== "type") return [{ title: null, parts: groupByCategory(rows) }];
  const types = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const title = row.type || "Other";
    if (!types.has(title)) types.set(title, []);
    types.get(title).push(row);
  }
  return [...types].map(([title, list3]) => ({ title, parts: groupByCategory(list3) }));
}
function tabCountText({ total, problem } = {}) {
  if (problem) return "!";
  if (!Number.isFinite(total)) return "";
  return total > 99 ? "99+" : String(total);
}
function todayCount(badge, problems) {
  const problem = (Array.isArray(problems) ? problems : []).find(Boolean);
  return problem ? { total: badge?.count, problem } : { total: badge?.count };
}
function countsDue(tabs, shownId, lastAt, now) {
  if (Number.isFinite(lastAt) && now - lastAt < HIDDEN_EVERY_MS) return [];
  return tabs.filter((t) => t.id !== shownId && t.kind === "search");
}
function tabLayout(own, before) {
  const pick = own === "list" || own === "board" ? own : before;
  return pick === "board" ? "board" : "list";
}
var tabFilters = (tab, list3) => [{ id: tab.id, name: tab.jql === ALL_JQL ? "All my issues" : tab.name, jql: tab.jql, source: "builtin" }, ...list3];

// src/shared/platform.js
function openUrlCommand(platform, url) {
  if (platform === "windows") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "macos") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

// src/mods/dock-jira/brief-view.js
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
var WARN = "#d29922";
var BRIEF_MAX_H = 280;
var CONTEXT = 2;
var WHY = { added: "added to the sprint", created: "created in the sprint", assigned: "assigned to you" };
var PART = { changed: "Changed", bugs: "High-priority bugs" };
var shortDate2 = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
var dateTime = (ms) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
var problemText = (p) => `${p.message} ${p.hint ?? ""}`.trim();
var green = (t) => t.ansi2 ?? "#46a758";
var red = (t) => t.ansi1 ?? "#e5484d";
var stats = (t, ops) => {
  const { added, removed } = diffStats(ops);
  return h_flex().flex_none().gap(6).text_size(11).child(div().text_color(green(t)).child(`+${added}`)).child(div().text_color(red(t)).child(`\u2212${removed}`));
};
function diffView(t, id, ops, full, showAll) {
  const shown = full ? ops : foldDiff(ops, CONTEXT);
  const line = (o, i) => {
    if (o.op === "skip") {
      return div().id(`${id}-skip-${i}`).px(8).py(2).text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show the whole text").on_click((_e, cx) => showAll(cx)).child(`\u22EF ${o.count} unchanged line${o.count === 1 ? "" : "s"}`);
    }
    const add = o.op === "add", del = o.op === "del";
    return h_flex().items_start().gap(6).px(8).min_h(18).when(add, (el) => el.bg(`${green(t)}18`)).when(del, (el) => el.bg(`${red(t)}18`)).child(div().w(10).flex_none().text_color(add ? green(t) : del ? red(t) : t.dim).child(add ? "+" : del ? "\u2212" : " ")).child(div().flex_1().min_w(0).text_color(add || del ? t.foreground : t.muted).when(del, (el) => el.line_through()).child(o.text || " "));
  };
  return v_flex().id(id).py(4).rounded(6).border_1().border_color(t.border).bg(t.background).text_size(12.3).children(shown.length ? shown.map(line) : [div().px(8).text_color(t.dim).child("No text on either side.")]);
}
function briefView(page, t) {
  const b = page.brief;
  const alone = page.options.board == null;
  const now = Date.now();
  const lists = briefLists(b, page.marks());
  const newBugs = lists.bugs.filter((x) => x.unread).length;
  const unread = lists.changed.length + lists.sprint.length + newBugs;
  const keyW = keyColumnWidth([...lists.changed, ...lists.sprint, ...lists.bugs].map((x) => x.key));
  const row = (kind, item, why, fresh) => h_flex().id(`jira-brief-${kind}-${item.key}`).h(30).px(16).gap(10).flex_none().items_center().cursor_pointer().bg(page.selected === item.key ? t.selected : t.background).hover((s) => s.bg(t.hover)).on_click((_e, cx) => page.select(item.key, cx)).child(div().w(keyW).flex_none().truncate().text_size(12).text_color(t.dim).child(item.key)).child(div().flex_1().min_w(0).truncate().text_size(12.8).text_color(t.foreground).child(item.summary || item.key)).when(fresh, (el) => el.child(div().flex_none().px(5).rounded(4).border_1().border_color(WARN).text_size(10.5).text_color(WARN).child("new"))).child(div().flex_none().max_w(220).truncate().text_size(11.5).text_color(t.muted).child(why)).child(div().w(34).flex_none().text_size(11.5).text_color(t.dim).child(ago(item.at, now)));
  const section = (title, count, rows, none) => [
    h_flex().h(28).px(16).pt(6).gap(6).flex_none().items_center().child(div().text_size(11.5).font_medium().text_color(t.muted).child(title)).child(div().text_size(11.5).text_color(t.dim).child(count)),
    ...rows.length ? rows : [div().px(16).pb(4).text_size(12).text_color(t.dim).child(none)]
  ];
  const sections = !b.at ? [div().px(16).py(8).text_size(12.5).text_color(t.dim).child("Loading\u2026")] : [
    ...section(
      "Changed",
      String(lists.changed.length),
      lists.changed.map((x) => row("changed", x, editsText(x.edits, { when: false }), false)),
      "No unread description changes."
    ),
    ...alone ? [] : section(
      "New in sprint",
      String(lists.sprint.length),
      lists.sprint.map((x) => row("sprint", x, WHY[x.why] ?? x.why, false)),
      page.sprint.current ? "Nothing new in the sprint." : "No active sprint."
    ),
    ...section(
      "High-priority bugs",
      newBugs ? `${newBugs} new of ${lists.bugs.length}` : String(lists.bugs.length),
      lists.bugs.map((x) => row("bug", x, [x.priority, x.status].filter(Boolean).join(" \xB7 "), x.unread)),
      "No high-priority bugs."
    )
  ];
  const head = h_flex().h(38).px(16).gap(8).flex_none().items_center().child(div().text_size(13).font_semibold().child("Brief")).child(div().text_size(11.5).text_color(t.dim).child(b.sinceMs ? `since ${shortDate2(b.sinceMs)}` : "")).child(div().flex_1()).child(page.button(t, "jira-brief-read-all", "Mark all read", (cx) => page.markAllRead(cx), { enabled: unread > 0 }));
  const failed = b.problem ? div().px(16).pb(4).text_size(12).text_color(t.blocked).child(`${PART[b.problem.part] ?? "The brief"}: ${problemText(b.problem)}`) : null;
  const scroll = page.scroll("today/brief");
  const body = (alone ? v_flex().id("jira-brief-list").flex_1().min_h(0) : v_flex().id("jira-brief-list").flex_none().max_h(BRIEF_MAX_H)).overflow_y_scrollbar().pb(10).when(Boolean(scroll), (el) => el.track_scroll(scroll)).when(Boolean(failed), (el) => el.child(failed)).children(sections);
  return (alone ? v_flex().id("jira-brief").flex_1().min_h(0) : v_flex().id("jira-brief").flex_none().border_b(1).border_color(t.border)).min_w(0).child(head).child(body);
}
function changeView(page, t) {
  const d = page.detail;
  const ch = page.change?.key === d.key ? page.change : null;
  const rc = page.recent?.key === d.key ? page.recent : null;
  const label = (text) => div().text_size(11.5).font_medium().text_color(t.muted).child(text);
  const note = (text, color = t.dim) => div().text_size(12).text_color(color).child(text);
  const what = (() => {
    if (!ch) return null;
    const read = !isUnread("changed", ch.item, page.marks());
    const check = checkWork(ch.item, { template: page.options.checkTask, subtasks: page.subtasks.byParent });
    return v_flex().id("jira-change").gap(8).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(read ? t.border : t.accent).child(h_flex().gap(8).items_center().child(label("What changed")).child(div().flex_1()).child(stats(t, ch.ops))).child(note(editsText(ch.item.edits), t.muted)).child(diffView(t, "jira-change-diff", ch.ops, ch.full, (cx) => {
      ch.full = true;
      cx.notify();
    })).child(h_flex().gap(8).flex_wrap().child(page.button(t, "jira-change-read", read ? "Read" : "Mark read", (cx) => page.markRead(cx), { enabled: !read })).child(page.button(t, "jira-change-open", "Open in browser", () => page.openUrl(d.url))).child(page.button(
      t,
      "jira-change-check",
      "Check against my work",
      (cx) => page.checkMyWork(ch.item, cx),
      { primary: true, tip: `Opens a Claude tab with:
${check?.args.task ?? ""}` }
    )));
  })();
  const toggle = h_flex().id("jira-recent").h(24).gap(6).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(rc ? "Hide the recent changes" : "The description's edits by others since the brief's start, as diffs").on_click((_e, cx) => page.toggleRecent(d.key, cx)).child(svg(`mods/workspace-chrome/chevron-${rc ? "down" : "right"}.svg`).size(12).text_color(t.dim)).child(label("Recent changes")).when(Boolean(rc?.sinceMs), (el) => el.child(div().text_size(11).text_color(t.dim).child(`since ${shortDate2(rc.sinceMs)}`)));
  const edits = !rc ? [] : rc.edits === "loading" ? [note("Asking Jira\u2026")] : !Array.isArray(rc.edits) ? [note(problemText(rc.edits.problem), t.blocked)] : !rc.edits.length ? [note("No description edits by others in that time.")] : rc.edits.map((e, i) => v_flex().gap(6).child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`${e.author || "Someone"} \xB7 ${dateTime(e.at)}`)).child(stats(t, e.ops))).child(diffView(t, `jira-recent-diff-${i}`, e.ops, rc.full.has(i), (cx) => {
    rc.full.add(i);
    cx.notify();
  })));
  return v_flex().gap(14).when(Boolean(what), (el) => el.child(what)).child(v_flex().gap(8).child(toggle).children(edits));
}

// src/mods/dock-jira/sprint-view.js
import { div as div2, svg as svg2 } from "gpui-kit";
import { h_flex as h_flex2, v_flex as v_flex2, Popover } from "gpui-base";
var laneKey = (lane) => lane.parent?.key ?? "";
function sprintMenu(page, t) {
  const sp = page.sprint;
  const sprints = [...sp.all, ...sp.closed ?? []];
  const items = sprintSeries(menuSprint(sp.current, sprints), sprints, sp.mine);
  const older = sp.closedAt != null ? null : sp.closedProblem ? "Couldn't load older sprints" : "Loading older sprints\u2026";
  const item = (s) => h_flex2().id(`jira-sprint-item-${s.id}`).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer().bg(s.id === sp.shown?.id ? t.selected : t.popover).hover((st) => st.bg(t.hover)).on_click((_e, cx) => page.showSprint(s.id, cx)).child(div2().flex_1().min_w(0).truncate().child(s.name)).child(div2().flex_none().text_size(11).text_color(t.dim).child(s.id === sp.current?.id ? "current" : s.state));
  return Popover.new("jira-sprint-menu").open(page.sprintOpen).on_open_change((open, cx) => page.openSprintMenu(open, cx)).trigger(h_flex2().id("jira-sprint-trigger").h(28).px(10).gap(6).items_center().rounded(7).border_1().border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover)).text_size(12.5).child(div2().truncate().child(sp.shown ? sprintLabel(sp.shown, Date.now()) : "Sprints")).child(svg2("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim))).content(v_flex2().id("jira-sprint-list").w(280).max_h(360).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).children(items.map(item)).when(Boolean(older), (el) => el.child(div2().px(8).py(6).text_size(12).text_color(t.dim).child(older))).when(!items.length && !older, (el) => el.child(div2().p(8).text_color(t.dim).child("No sprints on this board."))));
}
function sprintBoard(page, t) {
  const sp = page.sprint;
  const message = (text) => v_flex2().flex_1().items_center().justify_center().text_color(t.dim).child(text);
  const problem = (p) => v_flex2().gap(6).child(div2().text_size(13).text_color(t.blocked).child(p.message)).child(div2().text_size(12).text_color(t.dim).child(p.hint ?? ""));
  if (!sp.cachedAt) return sp.problem ? v_flex2().flex_1().p(24).child(problem(sp.problem)) : message("Loading\u2026");
  const top = h_flex2().flex_none().h(44).px(16).gap(10).items_center().child(sprintMenu(page, t));
  const withMenu = (...children) => v_flex2().flex_1().min_w(0).min_h(0).child(top).children(children);
  const failed = sp.problem ? div2().flex_none().px(16).pb(8).text_size(12).text_color(t.blocked).child(`${sp.problem.message} ${sp.problem.hint ?? ""}`.trim()) : null;
  if (!sp.shown) return withMenu(...failed ? [failed] : [], message(`No active sprint on ${sp.board?.name ?? `board ${sp.board?.id}`}.`));
  if (!sp.at) return withMenu(sp.problem ? v_flex2().p(24).child(problem(sp.problem)) : message("Loading\u2026"));
  const d = page.drag;
  const cols = sp.columns;
  const lit = d ? litColumns(cols, d.targets, d.row.status) : /* @__PURE__ */ new Set();
  const dim = (c) => Boolean(d) && !lit.has(c.name) && !c.statuses.includes(d.row.status);
  const hover = (name) => (_e, cx) => {
    if (!page.drag) return;
    page.drag.hover = name;
    const over = name !== null && lit.has(name) ? name : null;
    if (page.drag.over !== over) {
      page.drag.over = over;
      cx.notify();
    }
  };
  const lanes = sprintRows(sp.rows);
  const cells = lanes.map((l) => laneCells(l, cols));
  const column = (el, c) => el.rounded(8).bg(d?.over === c.name ? t.selected : t.chrome).border_1().border_color(lit.has(c.name) ? t.accent : t.border).when(dim(c), (x) => x.opacity(0.4)).on_mouse_move(hover(c.name));
  const heads = h_flex2().flex_none().px(12).gap(8).children(cols.map((c, ci) => column(h_flex2().id(`jira-sprint-col-${ci}`), c).flex_1().min_w(0).h(32).px(10).gap(6).items_center().child(div2().min_w(0).truncate().text_size(12).font_medium().text_color(lit.has(c.name) ? t.foreground : t.muted).child(c.name)).child(div2().flex_none().text_size(11.5).text_color(t.dim).child(String(cells.reduce((n, lane2) => n + lane2[ci].length, 0))))));
  const here = (lane2, c, key) => !d && page.dropColumn === c.name && lane2.rows.some((r) => r.key === key);
  const lane = (l, li) => {
    const key = laneKey(l);
    const folded = page.collapsed.has(key);
    const head = h_flex2().id(`jira-lane-${li}`).h(30).px(4).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(folded ? "Show this story's issues" : "Fold this story").on_mouse_move(hover(null)).on_click((_e, cx) => page.toggleLane(key, cx)).child(svg2(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(12).text_color(t.dim)).when(Boolean(l.parent), (el) => el.child(div2().flex_none().text_size(12).text_color(t.dim).child(l.parent.key))).when(Boolean(l.parent?.status), (el) => el.child(div2().flex_none().px(6).py(1).rounded(5).bg(t.border).text_size(11).text_color(t.muted).child(l.parent.status))).child(div2().flex_1().min_w(0).truncate().text_size(12.8).font_medium().text_color(t.foreground).child(l.parent ? l.parent.summary || l.parent.key : "Other issues")).child(div2().flex_none().text_size(11.5).text_color(t.dim).child(String(l.rows.length)));
    if (folded) return v_flex2().flex_none().child(head);
    return v_flex2().flex_none().gap(6).child(head).child(div2().flex().flex_row().gap(8).children(cols.map((c, ci) => column(v_flex2().id(`jira-sprint-cell-${li}-${ci}`), c).flex_1().min_w(0).min_h(44).p(6).gap(6).when(Boolean(page.dropChoice) && here(l, c, page.dropChoice?.row.key), (el) => el.child(page.choiceBox(t))).when(Boolean(page.dropNote) && here(l, c, page.dropNote?.key), (el) => el.child(page.noteBox(t))).children(cells[li][ci].map((r) => page.card(t, r))))));
  };
  const scroll = page.scroll("today/board");
  return v_flex2().id("jira-sprint-wrap").relative().flex_1().min_w(0).min_h(0).on_mouse_move((e, cx) => page.pointerMoved(e, cx)).on_mouse_up("left", (_e, cx) => page.released(cx)).child(top).when(Boolean(failed), (el) => el.child(failed)).child(heads).child(v_flex2().id("jira-sprint-lanes").flex_1().min_h(0).overflow_y_scrollbar().px(12).pt(10).pb(16).gap(12).when(Boolean(scroll), (el) => el.track_scroll(scroll)).children(lanes.length ? lanes.map(lane) : [div2().p(12).text_size(12.5).text_color(t.dim).child(`None of your issues are in ${sp.shown.name}.`)])).when(Boolean(d), (el) => el.child(page.dragBar(t))).when(Boolean(d?.at), (el) => el.child(div2().absolute().left(d.at.x + 14).top(d.at.y + 14).w(240).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.accent).opacity(0.92).text_size(12.5).text_color(t.foreground).child(div2().text_size(11).text_color(t.dim).child(d.row.key)).child(div2().truncate().child(d.row.summary))));
}

// src/mods/dock-jira/tabs.js
import { div as div3 } from "gpui-kit";
import { h_flex as h_flex3 } from "gpui-base";
function tabBar(page, t) {
  const shown = page.tab().id;
  const tab = (x) => {
    const on = x.id === shown;
    const c = page.counts.get(x.id);
    const count = tabCountText(c);
    return h_flex3().id(`jira-tab-${x.id}`).h(28).px(10).gap(6).flex_none().items_center().rounded(7).text_size(12.5).cursor_pointer().when(on, (el) => el.bg(t.raised ?? t.selected).text_color(t.foreground)).when(!on, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover))).when(Boolean(c?.problem), (el) => el.tooltip(`${c.problem.message} ${c.problem.hint ?? ""}`.trim())).on_click((_e, cx) => page.showTab(x.id, cx)).child(div3().child(x.name)).when(count !== "", (el) => el.child(div3().text_size(11).text_color(c?.problem ? t.blocked : t.dim).child(count)));
  };
  return div3().id("jira-tabs").flex().flex_row().flex_none().h(40).px(12).gap(4).items_center().overflow_x_scrollbar().border_b(1).border_color(t.border).children(page.tabs().map(tab));
}

// src/mods/dock-jira/main.js
var MOD = "dock-jira";
var BADGE_KEY = `dock.page.badge.${MOD}`;
var VIEW_KEY = "dock.jira.view";
var TAB_KEY = "dock.jira.tab";
var LAYOUT_KEY = (id) => `dock.jira.layout.${id}`;
var FILTER_KEY = "dock.jira.filter.all";
var READ_KEY = "dock.jira.read";
var SUBTASKS_JQL = "assignee = currentUser() AND resolution = Unresolved";
var TICK_MS = 3e4;
var DETAIL_W = 420;
var SCROLL_POOL = 64;
var WARN2 = "#d29922";
var PAGE_PROBLEMS = ["auth", "forbidden", "offline", "tls", "timeout", "server", "nocurl", "unknown"];
var TYPE_COLOR = (t, type) => ({ Bug: t.blocked, Story: t.done, Epic: "#8b5cf6" })[type] ?? t.accent;
var blankSprint = (board) => ({
  board: board == null ? null : { id: board, name: null },
  columns: [],
  active: [],
  all: [],
  mine: /* @__PURE__ */ new Map(),
  current: null,
  shown: null,
  picked: null,
  rows: [],
  total: void 0,
  problem: null,
  at: null,
  cachedAt: null,
  closed: null,
  closedAt: null,
  closedLoading: false,
  closedProblem: null
});
var blankBrief = () => ({ changed: [], sprint: [], bugs: [], at: null, sinceMs: null, problem: null });
var blankSubtasks = () => ({ byParent: /* @__PURE__ */ new Map(), cachedAt: null });
var Jira = class extends View {
  init(_props, cx) {
    this.site = siteName(props()?.site);
    this.jira = null;
    this.me = null;
    this.connected = false;
    this.checkingNow = false;
    this.problem = null;
    this.editing = false;
    this.formError = null;
    this.formBusy = false;
    this.favourites = [];
    this.statusOrder = [];
    this.projectStatuses = /* @__PURE__ */ new Map();
    this.options = jiraOptions({});
    this.tabId = null;
    this.states = /* @__PURE__ */ new Map();
    this.counts = /* @__PURE__ */ new Map();
    this.sprint = blankSprint(null);
    this.sprintOpen = false;
    this.closedSeq = latestOnly();
    this.closedRead = null;
    this.collapsed = /* @__PURE__ */ new Set();
    this.dropColumn = null;
    this.brief = blankBrief();
    this.briefTried = void 0;
    this.subtasks = blankSubtasks();
    this.histories = /* @__PURE__ */ new Map();
    this.change = null;
    this.recent = null;
    this.countsAt = void 0;
    this.lastPollAt = void 0;
    this.pollFailed = false;
    this.paused = false;
    this.detail = null;
    this.detailLoading = false;
    this.detailProblem = null;
    this.filterOpen = false;
    this.detailSeq = latestOnly();
    this.transOpen = false;
    this.transitions = null;
    this.actionBusy = null;
    this.actionMsg = null;
    this.press = null;
    this.drag = null;
    this.dropChoice = null;
    this.dropNote = null;
    this.pendingStep = null;
    this.scrollPool = Array.from({ length: SCROLL_POOL }, () => ScrollHandle.new());
    this.scrolls = /* @__PURE__ */ new Map();
    this.searchInput = InputState.new({ placeholder: "Search this filter\u2026" });
    this.searchInput.on("submit", (_e, cx2) => {
      const s = this.shown();
      s.query = this.searchInput.value().trim();
      s.moved = /* @__PURE__ */ new Map();
      this.refresh(cx2);
    });
    this.urlInput = InputState.new({ placeholder: "https://jira.example.com" });
    this.tokenInput = InputState.new({ placeholder: "Personal access token" });
    this.tokenInput.set_masked(true);
    this.taskInput = InputState.new({ placeholder: "Work on Jira issue {key}: {summary}\\n{url}" });
    this.caInput = InputState.new({ placeholder: "Optional: path to the company CA file (curl)" });
    this.boardChoice = null;
    this.boardHits = null;
    this.boardSeq = latestOnly();
    this.boardInput = InputState.new({ placeholder: "Type part of the board's name" });
    this.boardInput.on("change", (_e, cx2) => this.searchBoards(cx2));
    this.boardInput.on("submit", (_e, cx2) => {
      if (Array.isArray(this.boardHits) && this.boardHits.length) this.pickBoard(this.boardHits[0], cx2);
    });
    this.prioInput = InputState.new({ placeholder: DEFAULT_HIGH_PRIORITIES.join(", ") });
    this.commentInput = InputState.new({ placeholder: "Add a comment\u2026 (Enter sends)" });
    this.commentInput.on("submit", (_e, cx2) => this.sendComment(cx2));
    for (const input of [this.urlInput, this.tokenInput, this.taskInput, this.caInput, this.prioInput]) input.on("submit", (_e, cx2) => this.saveForm(cx2));
    this.taskInput.on("change", (_e, cx2) => cx2.notify());
    this.transportChoice = "fetch";
    if (checking()) return;
    cx.spawn(async (cx2) => {
      await this.load();
      cx2.notify();
      if (this.jira.settings.baseUrl && this.jira.token) await this.connect(cx2);
    });
    cx.timer.every(TICK_MS, (cx2) => this.tick(cx2));
    cx.spawn(async (cx2) => {
      for (; ; ) {
        const c = await nextCommand();
        try {
          this.command(c, cx2);
        } catch (e) {
          console.log(`dock-jira: command ${c} failed: ${e?.message ?? e}`);
        }
        cx2.notify();
      }
    });
  }
  // Commands (keys.json can bind them: "dock-jira.next"): list, board, refresh, settings, next, prev, close, the tabs
  // (tab-next, tab-prev, tab-<id>), and on the open issue: status (its status menu), assign (to me), comment (the
  // cursor into the comment box), start (Start work), finish (Finish, when an action rule gives one).
  command(c, cx) {
    if (c === "status") {
      if (this.detail) this.openTransitions(!this.transOpen, cx);
      return;
    }
    if (c === "assign") {
      if (canAssignToMe(this.detail, this.me)) this.assignMe(cx);
      return;
    }
    if (c === "comment") {
      if (this.detail) this.commentInput.focus();
      return;
    }
    if (c === "start") {
      if (this.detail) this.startWork(this.detail, cx);
      return;
    }
    if (c === "finish") {
      if (this.detail) this.finishWork(this.detail, cx);
      return;
    }
    if (c === "tab-next" || c === "tab-prev") {
      this.showTab(stepTab(this.tabs(), this.tab().id, c === "tab-next" ? 1 : -1), cx);
      return;
    }
    if (c.startsWith("tab-")) {
      const id = c.slice(4);
      if (this.tabs().some((x) => x.id === id)) this.showTab(id, cx);
      return;
    }
    if (c === "list" || c === "board") setShared2(LAYOUT_KEY(this.tab().id), c);
    else if (c === "refresh") cx.spawn(async (cx2) => this.reload(cx2));
    else if (c === "settings") this.openSettings(cx);
    else if (c === "close") {
      if (this.editing) {
        this.editing = false;
        this.formError = null;
      } else {
        this.selected = null;
        this.detail = null;
      }
    } else if (c === "next" || c === "prev") {
      const order = this.visibleOrder();
      if (!order.length) return;
      const i = order.indexOf(this.selected);
      const j = i < 0 ? c === "next" ? 0 : order.length - 1 : Math.min(order.length - 1, Math.max(0, i + (c === "next" ? 1 : -1)));
      this.select(order[j], cx);
    }
  }
  // Issue keys in the order they're drawn (by section and group in the list, by column on the board; on Today by
  // lane, then column, leaving out folded lanes).
  visibleOrder() {
    if (this.tab().kind === "today") {
      const cols = this.sprint.columns;
      return sprintRows(this.sprint.rows).filter((l) => !this.collapsed.has(l.parent?.key ?? "")).flatMap((l) => laneCells(l, cols).flat()).map((r) => r.key);
    }
    const rows = this.shownRows();
    const parts = this.layout() === "board" ? boardColumns(rows, this.statusOrder, this.boardStatuses()) : sectionsFor(rows, this.tab().group).flatMap((s) => s.parts);
    return parts.flatMap((p) => p.rows.map((r) => r.key));
  }
  // ---- tabs ----
  // The tabs, left to right: Today (the brief, and the sprint board when the settings name a board), the user's views
  // (settings), Mine, All.
  tabs() {
    return tabList(this.options.views, { today: true });
  }
  // The shown tab: the one picked, else the remembered one, else the first (a view may have left the settings).
  tab() {
    return pickTab(this.tabs(), this.tabId ?? shared2(TAB_KEY));
  }
  // A tab's list, kept while Herdr runs so switching back finds it as it was. `seq`: its newest search wins.
  // `moved`: key -> the row as moved, kept on the board in its new status until the tab's search changes.
  state(id) {
    if (!this.states.has(id)) {
      this.states.set(id, { rows: [], total: void 0, query: "", selected: null, fetchedAt: null, listProblem: null, loading: false, seq: latestOnly(), moved: /* @__PURE__ */ new Map() });
    }
    return this.states.get(id);
  }
  shown() {
    return this.state(this.tab().id);
  }
  // The open issue is the shown tab's selection.
  get selected() {
    return this.shown().selected;
  }
  set selected(key) {
    this.shown().selected = key;
  }
  layout() {
    const id = this.tab().id;
    return tabLayout(shared2(LAYOUT_KEY(id)), shared2(VIEW_KEY));
  }
  // A tab's scroller: its kept position (null once the pool is used up). No host call, so it is safe while drawing.
  scroll(key) {
    if (!this.scrolls.has(key)) this.scrolls.set(key, this.scrollPool.pop() ?? null);
    return this.scrolls.get(key);
  }
  // A tab whose list starts over (its search changed, another site): its scrollers go back to the top.
  scrollTop(id) {
    for (const [key, h] of this.scrolls) if (h && key.startsWith(`${id}/`)) h.scroll_to_item(0);
  }
  // What a tab searches (before its search text): All's is the filter picked in its menu.
  source(tab) {
    return tab.filters ? this.filter() : tab;
  }
  // Shows a tab as it was left: its search, rows, selection and open issue. Asks Jira again when it was never loaded
  // or its rows are older than a poll of the shown page.
  showTab(id, cx) {
    const before = this.selected;
    const tab = pickTab(this.tabs(), id);
    if (tab.id === this.tab().id) return;
    this.tabId = tab.id;
    setShared2(TAB_KEY, tab.id);
    this.filterOpen = false;
    this.sprintOpen = false;
    this.press = null;
    this.drag = null;
    this.dropChoice = null;
    this.dropNote = null;
    const s = this.state(tab.id);
    this.searchInput.set_value(s.query);
    if (s.selected !== before) this.followSelection(cx);
    if (!s.loading && pollDue({ shown: true, lastAt: s.fetchedAt, failed: false, now: Date.now() })) cx.spawn(async (cx2) => this.refresh(cx2));
    else cx.spawn(async (cx2) => this.loadProjectStatuses(cx2));
    cx.notify();
  }
  // The issue pane after the tab changed: the new tab's own selection, its actions starting clean.
  followSelection(cx) {
    this.actionMsg = null;
    this.pendingStep = null;
    this.transitions = null;
    this.transOpen = false;
    this.commentInput.set_value("");
    this.detail = null;
    this.detailProblem = null;
    this.openChange(this.selected);
    const key = this.selected;
    if (key) this.updateMarks((marks) => readOnOpen(marks, this.brief, key));
    if (key) cx.spawn(async (cx2) => this.loadDetail(cx2, key));
  }
  // ---- data ----
  io() {
    return { appHome: slashPath(appHome()), platform: window()?.platform, readTextFile, writeTextFile, exec };
  }
  async load() {
    this.jira = await loadJira(this.io(), this.site);
    this.options = jiraOptions(this.jira.settings);
    if ((this.sprint.board?.id ?? null) !== this.options.board) {
      this.sprint = blankSprint(this.options.board);
      this.states.delete("today");
      this.scrollTop("today");
      this.brief = { ...this.brief, sprint: [] };
      this.briefTried = void 0;
      this.histories = /* @__PURE__ */ new Map();
    }
    const s = this.jira.settings;
    this.urlInput.set_value(s.baseUrl);
    this.taskInput.set_value(s.startTask);
    this.caInput.set_value(s.caFile);
    this.transportChoice = s.transport;
  }
  client(cx) {
    const { settings, token, paths } = this.jira;
    return createClient({
      base: settings.baseUrl,
      transport: settings.transport,
      token,
      curlConfigPath: paths.curlConfigPath,
      curlBodyPath: paths.bodyPath,
      caFile: settings.caFile || void 0,
      io: { fetch: (u, o) => fetch(u, o), exec, sleep: (ms) => cx.sleep(ms), readTextFile, writeTextFile }
    });
  }
  // The All tab's filter menu: All my issues, then the built-ins, Jira favourites and the settings' own filters.
  filters() {
    return tabFilters(this.tabs().find((x) => x.filters), filterList(this.favourites, this.jira?.settings.filters));
  }
  filter() {
    return pickFilter(this.filters(), shared2(FILTER_KEY));
  }
  // First contact: who am I, then the favourites and the list.
  async connect(cx) {
    this.checkingNow = true;
    this.problem = null;
    this.paused = false;
    cx.notify();
    if (this.jira.settings.transport === "curl") {
      const sync = await syncCurlConfig(this.io(), this.site, this.jira.token);
      if (!sync.ok) console.log(`dock-jira: ${sync.error}`);
    }
    const me = await this.client(cx).myself();
    this.checkingNow = false;
    if (!me.ok) {
      this.problem = me.problem;
      this.connected = false;
      this.paused = afterProblem(me.problem.kind).pause;
      this.lastPollAt = Date.now();
      this.pollFailed = true;
      setShared2(BADGE_KEY, null);
      cx.notify();
      return;
    }
    this.me = me.data;
    this.connected = true;
    const favs = await this.client(cx).favouriteFilters();
    this.favourites = favs.ok ? favs.data : [];
    const statuses = await this.client(cx).statuses();
    this.statusOrder = statuses.ok ? statuses.data.map((x) => x.name) : [];
    await this.refresh(cx);
    await this.refreshCounts(cx);
    await this.refreshBriefHidden(cx);
  }
  // Refresh by hand: connect again when not connected (or after a problem), else the list (on Today, the board's
  // columns and sprints too) and the open issue.
  async reload(cx) {
    if (!this.jira?.settings.baseUrl || !this.jira.token) return;
    if (!this.connected || this.problem) {
      await this.connect(cx);
      return;
    }
    await this.refresh(cx, { fresh: true });
    if (this.selected) await this.loadDetail(cx, this.selected);
  }
  // The shown tab's list (its search, and its search text) and its count. The tab's newest search wins; the answer
  // goes to the tab it was asked for, even if another is shown by then. Today is its brief and sprint board
  // (refreshToday; `fresh`: its board's columns and sprints, and your sub-tasks' parents, read again too).
  async refresh(cx, { more = false, fresh = false } = {}) {
    if (!this.connected || !this.jira) return;
    const tab = this.tab();
    if (tab.kind === "today") {
      await this.refreshToday(cx, { fresh });
      return;
    }
    const s = this.state(tab.id);
    const seq = s.seq.next();
    const f = this.source(tab);
    const jql = withSearch(f.jql, s.query);
    s.loading = true;
    this.counts.set(tab.id, { ...this.counts.get(tab.id), loading: true });
    cx.notify();
    const r = await this.client(cx).search(jql, { startAt: more ? s.rows.length : 0, maxResults: more ? PAGE_SIZE : refreshSize(s.rows.length) });
    if (!s.seq.accept(seq)) return;
    s.loading = false;
    this.lastPollAt = Date.now();
    this.pollFailed = !r.ok;
    if (!r.ok) {
      if (this.pageProblem(r.problem)) this.counts.set(tab.id, { ...this.counts.get(tab.id), loading: false });
      else {
        s.listProblem = r.problem;
        this.counts.set(tab.id, { problem: r.problem });
      }
      cx.notify();
      return;
    }
    const base = this.jira.settings.baseUrl;
    const rows = (r.data?.issues ?? []).map((i) => issueRow(i, base));
    s.rows = more ? [...s.rows, ...rows] : rows;
    s.total = r.data?.total;
    s.fetchedAt = Date.now();
    s.listProblem = null;
    this.counts.set(tab.id, { total: s.total });
    this.problem = null;
    cx.notify();
    await this.loadProjectStatuses(cx);
  }
  // A failed search that means Jira can't be reached at all takes the whole page (true); any other (a view's bad
  // JQL) is the tab's own (false).
  pageProblem(problem) {
    if (!PAGE_PROBLEMS.includes(problem.kind)) return false;
    const effect = afterProblem(problem.kind);
    this.problem = problem;
    this.connected = effect.connected;
    this.paused = effect.pause;
    if (effect.clearBadge) setShared2(BADGE_KEY, null);
    return true;
  }
  // ---- Today: the brief and the sprint board ----
  // Today: the sprint board (when the settings name one) and the brief. The board's columns, statuses and sprints (and
  // how many of yours each active sprint holds, which picks the current sprint) are read when due (hourly) or `fresh`;
  // then, every time, the shown sprint's issues assigned to you in the board's order, with their history (New in
  // sprint), and the brief's own searches (readBrief). Today shown, this is the page's poll (refresh() sends it here);
  // another tab shown, the badge's refresh every HIDDEN_EVERY_MS (refreshBriefHidden), which leaves the poll's timing
  // alone. Its newest call wins; an answer for a board or a site the page has left since is dropped. A failure that
  // means Jira can't be reached with this token takes the page (todayFailure, then pageProblem); any other (a slow or
  // failing search, anything from the agile API) is Today's own: said where it belongs, on the board or in the brief,
  // and as "!" on Today's tab (updateBadge), and the rest carries on.
  async refreshToday(cx, { fresh = false } = {}) {
    if (!this.connected || !this.jira) return;
    const board = this.options.board;
    const s = this.state("today");
    const seq = s.seq.next();
    const live = () => s.seq.accept(seq) && this.states.get("today") === s && this.options.board === board;
    const polled = this.tab().kind === "today";
    let failed = false;
    const fail = (problem, here, agile = false) => {
      failed = true;
      if (todayFailure(problem.kind, { shown: polled, agile }) === "page" && this.pageProblem(problem)) return true;
      here(problem);
      return false;
    };
    const done = () => {
      s.loading = false;
      this.briefTried = Date.now();
      if (polled) {
        this.lastPollAt = Date.now();
        this.pollFailed = failed;
      }
      cx.notify();
    };
    s.loading = true;
    cx.notify();
    if (this.closedRead) {
      await this.closedRead;
      if (!live()) return;
    }
    const c = this.client(cx);
    const onBoard = (problem) => {
      this.sprint = { ...this.sprint, problem };
    };
    let closedTried = false;
    const closedInTurn = async () => {
      const sp = this.sprint;
      if (closedTried || sp.closedLoading || !closedNeeded({ active: sp.active, menuOpen: this.sprintOpen, closedAt: sp.closedAt })) return;
      closedTried = true;
      await this.readClosed(c, cx);
    };
    let current = null;
    if (board != null) {
      let cached = true;
      if (fresh || sprintCacheDue(this.sprint.cachedAt, Date.now())) {
        const got = await this.readSprints(c, board, live);
        if (!got || !live()) return;
        if (got.ok) this.sprint = { ...this.sprint, ...got.data };
        else if (fail(got.problem, onBoard, got.agile)) {
          done();
          return;
        } else cached = false;
      }
      if (cached) {
        const sp = this.sprint;
        const shown = shownSprint({ picked: sp.picked, shown: sp.shown, all: sp.all, closed: sp.closed, current: sp.current });
        let found = { ok: true, data: { issues: [], total: 0 } };
        if (shown) {
          found = await c.search(sprintJql(shown.id), { maxResults: REFRESH_CAP, fields: [...ROW_FIELDS, "created"], expand: "changelog" });
          if (!live()) return;
        }
        if (found.ok) {
          const issues = found.data?.issues ?? [];
          const base = this.jira.settings.baseUrl;
          this.sprint = {
            ...this.sprint,
            shown: shown ?? null,
            picked: shown && shown.id !== sp.current?.id ? shown.id : null,
            rows: issues.map((i) => issueRow(i, base)),
            total: found.data?.total,
            problem: null,
            at: Date.now()
          };
          cx.notify();
          if (!sp.current || shown?.id === sp.current.id) current = sp.current ? issues : [];
        } else if (fail(found.problem, onBoard)) {
          done();
          return;
        }
        await closedInTurn();
        if (!live()) return;
      }
    }
    if (this.me?.key || this.me?.name) {
      const stop = await this.readBrief(c, { fresh, live, fail, current });
      if (stop === "gone") return;
      if (stop === "page") {
        done();
        return;
      }
    }
    if (board != null && this.sprint.cachedAt) {
      await closedInTurn();
      if (!live()) return;
    }
    s.fetchedAt = Date.now();
    if (polled) this.problem = null;
    done();
  }
  // The brief's searches (refreshToday's): your sub-tasks' parents when due (with the board's cache: hourly, or
  // `fresh`); your unresolved issues and those parents updated since the current sprint started (14 days without
  // one), with their history (Changed; read again only for those that changed: this.histories); the high-priority
  // bugs. Then the lists (New in sprint from `current`, the current sprint's issues, when they were read), the marks
  // without the bugs that left the list, and the badge. The first failure ends the searches and is the brief's
  // `problem`; what was read before it is used, and a list not read keeps what it had. "gone": the answer is for a
  // Today the page has left; "page": a failure took the page.
  async readBrief(c, { fresh, live, fail, current }) {
    const me = this.me;
    const now = Date.now();
    const since = sinceMinutes(this.sprint.current, now);
    const sinceMs = now - since * 6e4;
    let problem = null;
    const said = (part) => (p) => {
      problem = { ...p, part };
    };
    if (fresh || sprintCacheDue(this.subtasks.cachedAt, now)) {
      const r = await c.search(SUBTASKS_JQL, { maxResults: REFRESH_CAP, fields: ["parent"] });
      if (!live()) return "gone";
      if (r.ok) this.subtasks = { byParent: subtasksByParent(r.data?.issues), cachedAt: Date.now() };
      else if (fail(r.problem, said("changed"))) return "page";
    }
    let changed = null;
    if (!problem) {
      const found = [];
      for (const jql of changedSearches({ since, parentKeys: [...this.subtasks.byParent.keys()] })) {
        const r = await c.search(jql, { maxResults: REFRESH_CAP, fields: ["updated"] });
        if (!live()) return "gone";
        if (!r.ok) {
          if (fail(r.problem, said("changed"))) return "page";
          break;
        }
        for (const issue of r.data?.issues ?? []) if (issue?.key) found.push({ key: issue.key, updated: issue.fields?.updated });
      }
      if (!problem) {
        for (const jql of keySearches(historyPlan(found, this.histories).stale)) {
          const r = await c.search(jql, { maxResults: REFRESH_CAP, fields: ROW_FIELDS, expand: "changelog" });
          if (!live()) return "gone";
          if (!r.ok) {
            if (fail(r.problem, said("changed"))) return "page";
            break;
          }
          for (const issue of r.data?.issues ?? []) if (issue?.key) this.histories.set(issue.key, { updated: issue.fields?.updated, issue });
        }
        const keys = new Set(found.map((f) => f.key));
        for (const key of [...this.histories.keys()]) if (!keys.has(key)) this.histories.delete(key);
        const marks = this.marks();
        changed = [...keys].map((key) => this.histories.get(key)?.issue).filter(Boolean).map((i) => changedItem(i, { me, sinceMs, marks })).filter(Boolean);
      }
    }
    let bugs = null;
    if (!problem) {
      const r = await c.search(bugsSearch(this.options), { maxResults: REFRESH_CAP });
      if (!live()) return "gone";
      const base = this.jira.settings.baseUrl;
      if (r.ok) bugs = (r.data?.issues ?? []).map((i) => issueRow(i, base)).map((x) => ({ key: x.key, summary: x.summary, priority: x.priority, status: x.status, at: x.updatedMs }));
      else if (fail(r.problem, said("bugs"))) return "page";
    }
    const sprint = this.sprint.current;
    this.brief = {
      changed: changed ?? this.brief.changed,
      sprint: current ? current.map((i) => newInSprintItem(i, { sprint, me })).filter(Boolean) : this.brief.sprint.filter((x) => x.sprintId === sprint?.id),
      bugs: bugs ?? this.brief.bugs,
      at: Date.now(),
      sinceMs,
      problem
    };
    if (bugs) this.updateMarks((marks) => {
      const pruned = pruneBugs(marks, bugs.map((b) => b.key));
      return JSON.stringify(pruned) === JSON.stringify(marks) ? marks : pruned;
    });
    this.updateBadge();
    return null;
  }
  // Today's brief while another tab is shown: refreshed every HIDDEN_EVERY_MS (as a hidden page polls), so the Pages
  // badge and Today's count keep up. With Today shown, it is the page's own poll.
  async refreshBriefHidden(cx) {
    if (!this.connected || this.problem || !this.jira || this.tab().kind === "today" || this.state("today").loading) return;
    if (!pollDue({ shown: false, lastAt: this.briefTried, failed: false, now: Date.now() })) return;
    await this.refreshToday(cx);
  }
  // The brief's read marks, per PC: { [key]: { changed?, sprint?, bug? } } (brief.js).
  marks() {
    const m = shared2(READ_KEY);
    return m && typeof m === "object" && !Array.isArray(m) ? m : {};
  }
  // The marks after `change` (marks -> marks; the same object for no change): saved, with the badge, when they changed.
  updateMarks(change) {
    const before = this.marks();
    const after = change(before);
    if (after === before) return;
    setShared2(READ_KEY, after);
    this.updateBadge();
  }
  // The Pages badge and Today's count (todayCount): the brief's unread items (briefBadge; none: no badge and no number),
  // and "!" while Today's board or brief has a problem of its own. No number and no badge until the brief was first
  // built. The badge is published only while connected and not paused: once a rejected token cleared it, neither a
  // key that opens an issue (its read marks) nor a brief that ends late puts it back.
  updateBadge() {
    const badge = this.brief.at ? briefBadge(this.brief, this.marks()) : null;
    this.counts.set("today", todayCount(badge, [this.sprint.problem, this.brief.problem]));
    if (this.brief.at && this.connected && !this.paused) setShared2(BADGE_KEY, badge);
  }
  markAllRead(cx) {
    this.updateMarks((marks) => readAll(marks, this.brief));
    cx.notify();
  }
  // What changed's Mark read: the edits it shows are read (a later one is unread again).
  markRead(cx) {
    const item = this.change?.item;
    if (!item) return;
    this.updateMarks((marks) => isUnread("changed", item, marks) ? withRead(marks, "changed", item) : marks);
    cx.notify();
  }
  // The issue opening in the detail: What changed is its unread Changed item, taken now and kept while the issue stays
  // open; Recent changes starts closed.
  openChange(key) {
    const marks = this.marks();
    const item = key ? this.brief.changed.find((x) => x.key === key && isUnread("changed", x, marks)) : null;
    this.change = item ? { key, item, ops: changeDiff(item.before, item.after), full: false } : null;
    this.recent = null;
  }
  // Recent changes on the open issue: opened, its description edits by others within the brief's window, as diffs,
  // asked each time it opens (GET the issue's history); closed, forgotten.
  toggleRecent(key, cx) {
    if (this.recent?.key === key) {
      this.recent = null;
      cx.notify();
      return;
    }
    const now = Date.now();
    const sinceMs = this.brief.sinceMs ?? now - sinceMinutes(this.sprint.current, now) * 6e4;
    const asked = { key, sinceMs, edits: "loading", full: /* @__PURE__ */ new Set() };
    this.recent = asked;
    cx.notify();
    cx.spawn(async (cx2) => {
      const r = await this.client(cx2).issueHistory(key);
      if (this.recent !== asked) return;
      this.recent = { ...asked, edits: r.ok ? recentEdits(r.data.histories, { me: this.me, sinceMs }).map((e) => ({ ...e, ops: changeDiff(e.from, e.to) })) : { problem: r.problem } };
      cx2.notify();
    });
  }
  // Check against my work: a Claude tab with checkTask's message (checkWork: the issue, when it changed and your work
  // under it, never its text), then the terminal, as Start work does.
  checkMyWork(item, cx) {
    const c = checkWork(item, { template: this.options.checkTask, subtasks: this.subtasks.byParent });
    if (!c) return;
    try {
      run(c.command, c.args);
    } catch (e) {
      this.actionMsg = { ok: false, message: `Couldn't open the tab: ${e?.message ?? e}` };
      cx.notify();
      return;
    }
    showTerminal();
  }
  // What changes rarely on Today's board, for `board`: { ok, data: { board: { id, name }, columns, active, all,
  // mine, current, cachedAt, closed, closedAt, closedProblem } }, or the first failure (with `agile: true` when it
  // came from Jira Software's agile API: the board's configuration, its sprints). Only the active and future sprints
  // (`all`; one page, where every sprint the board ever had is several): the closed ones are dropped, read again when
  // needed (readClosed). One request at a time; one count per active sprint. Once `live()` is false (a newer refresh
  // of Today started, or the page left this board) it stops before the next request, with null.
  async readSprints(c, board, live) {
    const conf = await c.boardConfiguration(board);
    if (!live()) return null;
    if (!conf.ok) return { ...conf, agile: true };
    const statuses = await c.statuses();
    if (!live()) return null;
    if (!statuses.ok) return statuses;
    const sprints = await c.sprints(board, ["active", "future"]);
    if (!live()) return null;
    if (!sprints.ok) return { ...sprints, agile: true };
    const active = sprints.data.filter((x) => x.state === "active");
    const mine = /* @__PURE__ */ new Map();
    for (const a of active) {
      const n = await c.search(sprintMineJql(a.id), { maxResults: 0 });
      if (!live()) return null;
      if (!n.ok) return n;
      mine.set(a.id, Number.isFinite(n.data?.total) ? n.data.total : 0);
    }
    return { ok: true, data: {
      board: { id: board, name: conf.data.name ?? null },
      columns: sprintColumns(conf.data.columns, statuses.data),
      active,
      all: sprints.data,
      mine,
      current: pickSprint(active, mine),
      cachedAt: Date.now(),
      closed: null,
      closedAt: null,
      closedProblem: null
    } };
  }
  // The board's closed sprints (the sprint menu's older ones; the series it offers with no active sprint), when
  // closedNeeded says so: this.sprint's `closed` and `closedAt`, or `closedProblem`, said in the menu (never the page's
  // problem, nor the board's). `closedLoading` while it runs (one read at a time); its newest read wins, and an answer
  // for a board or a site the page has left since is dropped. Drawn when it ends (the menu fills in while open). The
  // read is this.closedRead while it runs, whoever started it, so a refresh of Today starting meanwhile waits for it.
  readClosed(c, cx) {
    const board = this.options.board;
    const s = this.state("today");
    const seq = this.closedSeq.next();
    const live = () => this.closedSeq.accept(seq) && this.states.get("today") === s && this.options.board === board;
    this.sprint = { ...this.sprint, closedLoading: true, closedProblem: null };
    cx.notify();
    const read = (async () => {
      const r = await c.sprints(board, ["closed"]);
      if (this.closedRead === read) this.closedRead = null;
      if (!live()) return;
      this.sprint = r.ok ? { ...this.sprint, closed: r.data, closedAt: Date.now(), closedLoading: false } : { ...this.sprint, closedLoading: false, closedProblem: r.problem };
      cx.notify();
    })();
    this.closedRead = read;
    return read;
  }
  // The sprint menu opened or closed. Opened, its older sprints are read when closedNeeded says so: now, or, while
  // Today refreshes, by that refresh once it's done with the board (refreshToday), so requests go one at a time. The
  // read starts later, in a task of its own: asked again there, so that a refresh queued in the same turn, or the menu
  // closed and opened again, never starts a second read beside the one running.
  openSprintMenu(open, cx) {
    this.sprintOpen = open;
    cx.notify();
    if (!open) return;
    const due = () => {
      const sp = this.sprint;
      return Boolean(sp.cachedAt) && !sp.closedLoading && !this.state("today").loading && closedNeeded({ active: sp.active, menuOpen: this.sprintOpen, closedAt: sp.closedAt });
    };
    if (!due()) return;
    cx.spawn(async (cx2) => {
      if (due()) await this.readClosed(this.client(cx2), cx2);
    });
  }
  // The sprint menu: shows another sprint of the board, from the top, with nothing open (not remembered: Today opens
  // on the current sprint when Herdr starts).
  showSprint(id, cx) {
    this.sprintOpen = false;
    const sp = this.sprint;
    const pick = [...sp.all, ...sp.closed ?? []].find((x) => x.id === id);
    if (!pick || pick.id === sp.shown?.id) {
      cx.notify();
      return;
    }
    this.sprint = { ...sp, shown: pick, picked: pick.id === sp.current?.id ? null : pick.id, rows: [], total: void 0, problem: null, at: null };
    this.state("today").fetchedAt = null;
    this.selected = null;
    this.detail = null;
    this.dropChoice = null;
    this.dropNote = null;
    this.scroll("today/board")?.scroll_to_item(0);
    cx.notify();
    cx.spawn(async (cx2) => this.refresh(cx2));
  }
  // A lane's header folds it, or unfolds it.
  toggleLane(key, cx) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    cx.notify();
  }
  // The counts on the tabs not shown: one count-only search each, every HIDDEN_EVERY_MS (countsDue), one at a time.
  // A failed one marks only its own tab ("!"), except a rejected or forbidden token, which takes the page
  // (countFailure). Whether Jira can be reached at all is the shown tab's search to say.
  async refreshCounts(cx) {
    if (!this.connected || this.problem || !this.jira) return;
    const due = countsDue(this.tabs(), this.tab().id, this.countsAt, Date.now());
    if (!due.length) return;
    this.countsAt = Date.now();
    for (const tab of due) {
      if (!this.connected || this.problem) return;
      const r = await this.client(cx).search(withSearch(this.source(tab).jql, this.state(tab.id).query), { maxResults: 0 });
      if (tab.id === this.tab().id) continue;
      if (r.ok) this.counts.set(tab.id, { total: r.data?.total });
      else if (countFailure(r.problem.kind) === "page") {
        this.pageProblem(r.problem);
        cx.notify();
        return;
      } else this.counts.set(tab.id, { problem: r.problem });
      cx.notify();
    }
  }
  // The workflow statuses of the board's project, asked once per project, only when the board is one project (its
  // columns show them all, empty ones too; a mixed board has none to ask for). A failure leaves the project out: its
  // columns then come from its issues, as before. The board is the shown tab's.
  async loadProjectStatuses(cx) {
    const projects = boardProjects(this.shown().rows);
    if (projects.length !== 1) return;
    const key = projects[0];
    if (this.projectStatuses.has(key)) return;
    this.projectStatuses.set(key, "loading");
    const r = await this.client(cx).projectStatuses(key);
    this.projectStatuses.set(key, r.ok ? r.data : []);
    cx.notify();
  }
  boardStatuses() {
    return workflowStatuses(this.shown().rows, this.projectStatuses);
  }
  tick(cx) {
    if (!this.jira || this.editing) return;
    cx.spawn(async (cx2) => {
      await this.reloadSettings(cx2);
      if (!this.editing && !this.checkingNow && !this.paused) {
        await this.refreshCounts(cx2);
        await this.refreshBriefHidden(cx2);
      }
    });
    if (this.checkingNow || this.paused) return;
    const shown = pageShown(MOD);
    if (!pollDue({ shown, lastAt: this.lastPollAt, failed: this.pollFailed, now: Date.now(), loading: this.shown().loading })) return;
    cx.spawn(async (cx2) => {
      if (!this.connected && this.jira.settings.baseUrl && this.jira.token) await this.connect(cx2);
      else await this.refresh(cx2);
      if (this.selected && shown) await this.loadDetail(cx2, this.selected);
    });
  }
  // Reads the settings file again (cheap) and, when its text changed, acts on it (settingsReload). Text that doesn't
  // parse keeps the settings and tabs in use, with the problem in the form. Another address starts over, as Save does
  // for one. Otherwise it loads and rebuilds the tabs: a tab whose search changed starts over, every tab is counted
  // again, and the shown one (maybe another now: its view may have gone) is loaded if it never was.
  async reloadSettings(cx) {
    const path = this.jira?.paths.settingsPath;
    if (!path) return;
    const text = await readTextFile(path).catch(() => null);
    if (text === this.jira.settingsText || this.editing) return;
    const plan = settingsReload(this.jira.settings, text, path.split("/").pop());
    if (plan.kind === "keep") {
      const warnings = [...this.options.warnings.filter((w) => w !== this.jira.problem), plan.problem];
      this.jira = { ...this.jira, settingsText: text, problem: plan.problem };
      this.options = { ...this.options, warnings };
      cx.notify();
      return;
    }
    if (plan.newSite) {
      this.clearView();
      this.connected = false;
      setShared2(BADGE_KEY, null);
      await this.load();
      cx.notify();
      if (this.jira.settings.baseUrl && this.jira.token) await this.connect(cx);
      return;
    }
    const searches = new Map(this.tabs().map((x) => [x.id, x.jql]));
    const before = this.selected;
    const query = this.shown().query;
    await this.load();
    for (const x of this.tabs()) if (searches.get(x.id) !== x.jql) {
      this.states.delete(x.id);
      this.counts.delete(x.id);
      this.scrollTop(x.id);
    }
    this.countsAt = void 0;
    if (this.selected !== before) this.followSelection(cx);
    if (this.shown().query !== query) this.searchInput.set_value(this.shown().query);
    cx.notify();
    const s = this.shown();
    if (!s.fetchedAt && !s.loading) await this.refresh(cx);
  }
  // Opens an issue in the detail (from the brief, the board, a list or a key). Opening it reads its New-in-sprint and
  // bug items (readOnOpen); a Changed item waits for Mark read.
  select(key, cx) {
    this.updateMarks((marks) => readOnOpen(marks, this.brief, key));
    if (key !== this.selected) {
      this.actionMsg = null;
      this.pendingStep = null;
      this.transitions = null;
      this.transOpen = false;
      this.commentInput.set_value("");
      this.openChange(key);
    }
    this.selected = key;
    this.detail = null;
    this.detailProblem = null;
    cx.spawn(async (cx2) => this.loadDetail(cx2, key));
  }
  async loadDetail(cx, key) {
    const seq = this.detailSeq.next();
    this.detailLoading = true;
    cx.notify();
    const r = await this.client(cx).issue(key);
    if (!this.detailSeq.accept(seq) || this.selected !== key) return;
    this.detailLoading = false;
    if (r.ok) {
      this.detail = issueDetail(r.data, this.jira.settings.baseUrl);
      this.detailProblem = null;
    } else this.detailProblem = r.problem;
    cx.notify();
  }
  // ---- actions (each guarded: one at a time, and its answer applied only to the issue it was for) ----
  openTransitions(open, cx) {
    this.transOpen = open;
    if (!open || !this.selected) {
      cx.notify();
      return;
    }
    const key = this.selected;
    this.transitions = "loading";
    cx.notify();
    cx.spawn(async (cx2) => {
      const r = await this.client(cx2).transitions(key);
      if (this.selected !== key) return;
      this.transitions = r.ok ? r.data : { problem: r.problem };
      cx2.notify();
    });
  }
  run(kind, cx, call, extra, after) {
    if (this.actionBusy || !this.selected) return;
    const key = this.selected;
    this.actionBusy = kind;
    this.actionMsg = null;
    cx.notify();
    cx.spawn(async (cx2) => {
      let r;
      try {
        r = await call(this.client(cx2), key);
      } finally {
        this.actionBusy = null;
      }
      if (this.selected !== key) return;
      this.actionMsg = actionOutcome(kind, r, extra);
      cx2.notify();
      if (r.ok) await after(cx2, key, r);
    });
  }
  // A move: run at once, or first ask for the one value its step requires (a Resolution, from Jira's allowed values),
  // or send the user to Jira for anything more. `fields`: the value picked, when asked.
  doTransition(tr, cx, url = this.detail?.url, fields) {
    this.transOpen = false;
    this.transitions = null;
    this.pendingStep = null;
    const needs = fields ? { kind: "none" } : stepNeeds(tr);
    if (needs.kind === "pick") {
      this.actionMsg = null;
      this.pendingStep = { key: this.selected, tr, field: needs.fields[0], url };
      cx.notify();
      return;
    }
    if (needs.kind === "browser") {
      this.actionMsg = { ok: false, message: `${tr.name} needs ${needs.names.join(", ")}: do this step in Jira.`, link: url };
      cx.notify();
      return;
    }
    this.run(
      "transition",
      cx,
      (c, key) => c.transition(key, tr.id, fields),
      { to: tr.to?.name ?? tr.name, url },
      async (cx2, key) => {
        const row = this.shownRows().find((r) => r.key === key);
        if (row) this.shown().moved.set(key, { ...row, status: tr.to?.name ?? row.status, category: tr.to?.statusCategory?.key ?? row.category });
        await this.loadDetail(cx2, key);
        await this.refresh(cx2);
      }
    );
  }
  shownRows() {
    const s = this.shown();
    return keepMoved(s.rows, s.moved);
  }
  assignMe(cx) {
    if (!this.me?.name) return;
    this.run(
      "assign",
      cx,
      (c, key) => c.assign(key, this.me.name),
      {},
      async (cx2, key) => {
        await this.loadDetail(cx2, key);
        await this.refresh(cx2);
      }
    );
  }
  sendComment(cx) {
    const text = this.commentInput.value();
    if (!commentReady(text) || this.actionBusy) return;
    this.run("comment", cx, (c, key) => c.comment(key, text.trim()), {}, async (cx2, _key, r) => {
      if (this.detail && r.data) this.detail = withComment(this.detail, r.data);
      this.commentInput.set_value("");
      cx2.notify();
      await this.refresh(cx2);
    });
  }
  // ---- board drag and drop ----
  // A press on a card becomes a drag once the pointer moves a few pixels (a click still opens the issue). The drag
  // asks Jira which moves this issue has (its workflow, for this user, now); those columns light up, others dim, and
  // a reachable status with no column yet gets an empty one. Releasing over a lit column runs its move (or asks
  // which, when several lead there); anywhere else does nothing.
  pointerMoved(e, cx) {
    if (this.drag) {
      this.drag.at = e.local_position;
      cx.notify();
      return;
    }
    if (!this.press || !dragStarted(this.press.from, e.position)) return;
    const row = this.press.row;
    this.press = null;
    this.dropChoice = null;
    this.dropNote = null;
    this.drag = { row, transitions: "loading", targets: /* @__PURE__ */ new Set(), over: null, hover: null, at: e.local_position };
    cx.notify();
    cx.spawn(async (cx2) => {
      const r = await this.client(cx2).transitions(row.key);
      if (this.drag?.row.key !== row.key) return;
      this.drag.transitions = r.ok ? r.data : { problem: r.problem };
      this.drag.targets = r.ok ? dropTargets(r.data, row.status) : /* @__PURE__ */ new Set();
      cx2.notify();
    });
  }
  released(cx) {
    this.press = null;
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    cx.notify();
    if (this.tab().kind === "today") {
      this.droppedOnColumn(drag, cx);
      return;
    }
    if (!drag.over) {
      if (drag.hover && drag.hover !== drag.row.status && Array.isArray(drag.transitions)) {
        this.dropNote = { status: drag.hover, text: refusedDropText(drag.row.key, drag.row.status, drag.hover, drag.targets) };
      }
      return;
    }
    const plan = dropPlan(drag.transitions, drag.over, drag.row.status);
    if (plan.kind === "run") this.moveCard(drag.row, plan.transition, cx);
    else if (plan.kind === "choose") this.dropChoice = { row: drag.row, status: drag.over, transitions: plan.transitions };
  }
  // Today: a drop on one of the board's columns (several statuses; `hover` is its name) runs the move into it, asks
  // which when several lead there, or says why not (columnDrop). A drop on the card's own column does nothing.
  droppedOnColumn(drag, cx) {
    const col = this.sprint.columns.find((c) => c.name === drag.hover);
    if (!col || !Array.isArray(drag.transitions)) return;
    this.dropColumn = col.name;
    const plan = columnDrop(drag.transitions, col, drag.row.status);
    if (plan.kind === "run") this.moveCard(drag.row, plan.transition, cx);
    else if (plan.kind === "choose") this.dropChoice = { row: drag.row, status: col.name, transitions: plan.transitions };
    else if (!col.statuses.includes(drag.row.status)) {
      this.dropNote = { status: col.name, key: drag.row.key, text: refusedDropText(drag.row.key, drag.row.status, col.name, drag.targets) };
    }
  }
  // A release anywhere on the page: a drag still going ends without a move (a release over the board's columns was
  // already handled there: its own handler runs first), and a press that never became a drag is forgotten, so
  // neither is left stuck (over the brief, the header, the tabs or the detail).
  dragEnded(cx) {
    this.press = null;
    if (!this.drag) return;
    this.drag = null;
    cx.notify();
  }
  // The move runs like one picked in the status menu, with the issue opened beside the board to show the result.
  // A drop's move that needs a value (Resolution) asks for it right there in the column, before opening anything.
  moveCard(row, tr, cx, fields) {
    const needs = fields ? { kind: "none" } : stepNeeds(tr);
    if (needs.kind === "pick") {
      this.dropChoice = { row, status: tr.to?.name, transitions: [tr], step: { tr, field: needs.fields[0] } };
      cx.notify();
      return;
    }
    this.dropChoice = null;
    if (this.selected !== row.key) this.select(row.key, cx);
    this.doTransition(tr, cx, row.url, fields);
  }
  // Start work: a Claude tab named after the issue, with the message of its flow (the `start` of the first action rule
  // that matches it, else the settings' Start-work message); then the terminal comes to the front. From a list row, a
  // template that uses {description} first fetches the full issue (rows don't carry it).
  startWork(issue, cx) {
    const template = startTemplate(this.options.actions, issue, this.jira?.settings.startTask);
    if (issue && !("description" in issue) && needsDetail(template)) {
      if (this.detail?.key === issue.key) {
        this.startWork(this.detail, cx);
        return;
      }
      cx.spawn(async (cx2) => {
        const r = await this.client(cx2).issue(issue.key);
        if (r.ok) this.startWork(issueDetail(r.data, this.jira.settings.baseUrl), cx2);
        else {
          this.actionMsg = { ok: false, message: `Couldn't start ${issue.key}: ${r.problem.message}` };
          cx2.notify();
        }
      });
      return;
    }
    const c = startWork(issue, template);
    if (!c) return;
    try {
      run(c.command, c.args);
    } catch (e) {
      this.actionMsg = { ok: false, message: `Couldn't open the tab: ${e?.message ?? e}` };
      return;
    }
    showTerminal();
  }
  // Finish: a Claude tab named "<key> finish" with the `finish` message of the issue's flow (the detail has the
  // description already); then the terminal. Nothing in Jira changes: the skill it names does that, step by step.
  finishWork(issue, cx) {
    const c = finishWork(issue, this.options.actions);
    if (!c) return;
    try {
      run(c.command, c.args);
    } catch (e) {
      this.actionMsg = { ok: false, message: `Couldn't open the tab: ${e?.message ?? e}` };
      cx.notify();
      return;
    }
    showTerminal();
  }
  // A tab's button (a view's `button` setting): a Claude tab named after its label, with its task as the first message,
  // then the terminal, as Start work does. No Jira request, so it needs no connection.
  tabButton(button, cx) {
    const c = tabButtonWork(button);
    if (!c) return;
    try {
      run(c.command, c.args);
    } catch (e) {
      this.actionMsg = { ok: false, message: `Couldn't open the tab: ${e?.message ?? e}` };
      cx.notify();
      return;
    }
    showTerminal();
  }
  openUrl(url) {
    const c = openUrlCommand(window()?.platform, url);
    exec(c.command, c.args).catch((e) => console.log(`dock-jira: open failed: ${e}`));
  }
  // ---- settings ----
  openSettings(cx) {
    this.editing = true;
    this.formError = null;
    this.tokenInput.set_value("");
    if (this.jira) {
      this.urlInput.set_value(this.jira.settings.baseUrl);
      this.taskInput.set_value(this.jira.settings.startTask);
      this.caInput.set_value(this.jira.settings.caFile);
      this.transportChoice = this.jira.settings.transport;
      this.boardChoice = this.options.board != null ? { id: this.options.board, name: this.sprint.board?.name ?? null } : null;
      this.boardHits = null;
      this.boardSeq.next();
      this.boardInput.set_value("");
      this.prioInput.set_value(prioritiesText(this.jira.settings));
    }
    cx.notify();
  }
  // The Scrum board field: Jira's scrum boards whose name holds what's typed, asked once typing pauses.
  searchBoards(cx) {
    const text = this.boardInput.value().trim();
    const seq = this.boardSeq.next();
    if (!text || !this.jira?.settings.baseUrl || !this.jira.token) {
      this.boardHits = null;
      cx.notify();
      return;
    }
    this.boardHits = "loading";
    cx.notify();
    cx.spawn(async (cx2) => {
      await cx2.sleep(250);
      if (!this.boardSeq.accept(seq)) return;
      const r = await this.client(cx2).boards(text);
      if (!this.boardSeq.accept(seq)) return;
      this.boardHits = r.ok ? r.data : { problem: r.problem };
      cx2.notify();
    });
  }
  pickBoard(b, cx) {
    this.boardChoice = { id: b.id, name: b.name ?? null };
    this.boardHits = null;
    this.boardSeq.next();
    this.boardInput.set_value("");
    cx.notify();
  }
  saveForm(cx) {
    if (this.formBusy || !this.jira) return;
    const url = normalizeBaseUrl(this.urlInput.value());
    if (!url.ok) {
      this.formError = url.error;
      cx.notify();
      return;
    }
    const typed = this.tokenInput.value().trim();
    if (!typed && !this.jira.token) {
      this.formError = "Paste your personal access token.";
      cx.notify();
      return;
    }
    this.formBusy = true;
    this.formError = null;
    cx.notify();
    cx.spawn(async (cx2) => {
      try {
        const io = this.io();
        if (typed) {
          const t = await saveToken(io, this.site, typed);
          if (!t.ok) {
            this.formError = t.error;
            return;
          }
        }
        if (url.url !== this.jira.settings.baseUrl) {
          this.clearView();
          this.connected = false;
          setShared2(BADGE_KEY, null);
        }
        const fields = {
          ...this.jira.settings,
          baseUrl: url.url,
          transport: this.transportChoice,
          startTask: this.taskInput.value(),
          caFile: this.caInput.value().trim()
        };
        const settings = this.editing ? withFormOptions(fields, { board: this.boardChoice?.id ?? null, priorities: this.prioInput.value() }) : fields;
        const s = await saveSettings(io, this.site, settings, this.jira.settingsText ?? void 0);
        if (!s.ok) {
          this.formError = s.error;
          return;
        }
        await this.load();
        this.tokenInput.set_value("");
        this.editing = false;
        this.connected = false;
        await this.connect(cx2);
      } finally {
        this.formBusy = false;
        cx2.notify();
      }
    });
  }
  disconnect(cx) {
    cx.spawn(async (cx2) => {
      const r = await clearToken(this.io(), this.site);
      if (!r.ok) this.formError = r.error;
      await this.load();
      this.clearView();
      Object.assign(this, { connected: false, problem: null, paused: false });
      setShared2(BADGE_KEY, null);
      cx2.notify();
    });
  }
  // A new Jira address, or Disconnect: the old site's issues (every tab's list and count, Today's board and brief),
  // open issue and filters are forgotten. CLEARED_VIEW's list fields live in the tabs' states now, so they go with those.
  clearView() {
    const { rows: _r, total: _t, fetchedAt: _f, listProblem: _p, ...view } = JSON.parse(JSON.stringify(CLEARED_VIEW));
    Object.assign(this, view, {
      states: /* @__PURE__ */ new Map(),
      counts: /* @__PURE__ */ new Map(),
      countsAt: void 0,
      projectStatuses: /* @__PURE__ */ new Map(),
      sprint: blankSprint(this.options.board),
      brief: blankBrief(),
      briefTried: void 0,
      subtasks: blankSubtasks(),
      histories: /* @__PURE__ */ new Map(),
      change: null,
      recent: null
    });
    for (const h of this.scrolls.values()) h?.scroll_to_item(0);
    this.searchInput.set_value("");
  }
  useCurl(cx) {
    cx.spawn(async (cx2) => {
      const s = await saveSettings(this.io(), this.site, { ...this.jira.settings, transport: "curl" }, this.jira.settingsText ?? void 0);
      if (!s.ok) {
        this.problem = { kind: "unknown", message: s.error, hint: "" };
        cx2.notify();
        return;
      }
      await this.load();
      await this.connect(cx2);
    });
  }
  // ---- drawing ----
  // `accent`: the theme's accent colour for the outline and text, for a button that should stand out a little without
  // being the page's primary action (a tab's own button).
  button(t, id, label, onClick, { primary = false, accent = false, enabled = true, tip } = {}) {
    return h_flex4().id(id).h(28).px(12).flex_none().items_center().rounded(7).text_size(12.5).when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground)).when(!primary && accent, (el) => el.border_1().border_color(t.accent).text_color(t.accent)).when(!primary && !accent, (el) => el.border_1().border_color(t.border).text_color(t.foreground)).when(enabled, (el) => el.cursor_pointer().on_click((_e, cx) => onClick(cx)).hover((s) => primary ? s.opacity(0.9) : s.bg(t.hover))).when(!enabled, (el) => el.opacity(0.45)).when(Boolean(tip), (el) => el.tooltip(tip)).child(label);
  }
  field(t, label, input, hint) {
    return v_flex3().gap(5).child(div4().text_size(11.5).text_color(t.dim).child(label)).child(Input.new(input).h(34).px(10).rounded(8).border_1().border_color(t.input ?? t.border).bg(t.background).text_size(12.8).text_color(t.foreground)).when(Boolean(hint), (el) => el.child(div4().text_size(11).text_color(t.dim).child(hint)));
  }
  settingsForm(t, first) {
    const s = this.jira?.settings;
    const choice = (value, label) => h_flex4().id(`jira-transport-${value}`).h(26).px(10).items_center().rounded(6).text_size(12).cursor_pointer().on_click((_e, cx) => {
      this.transportChoice = value;
      cx.notify();
    }).when(this.transportChoice === value, (el) => el.bg(t.raised ?? t.selected).border_1().border_color(t.border).text_color(t.foreground)).when(this.transportChoice !== value, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover))).child(label);
    return v_flex3().id("jira-settings").size_full().min_h(0).overflow_y_scrollbar().items_center().py(32).px(24).child(v_flex3().w_full().max_w(560).gap(16).child(v_flex3().gap(4).child(div4().text_size(18).font_semibold().child(first ? "Connect Jira" : "Jira settings")).child(div4().text_size(12.5).text_color(t.muted).child("Your company's Jira Server / Data Center, with a personal access token (Jira \u2192 Profile \u2192 Personal Access Tokens). Your Jira MCP's JIRA_URL and JIRA_PERSONAL_TOKEN work here."))).child(this.field(t, "Jira address", this.urlInput, null)).child(this.field(
      t,
      this.jira?.token ? "Personal access token (saved; paste a new one to replace it)" : "Personal access token",
      this.tokenInput,
      `Kept only on this PC, in ${this.jira ? `herdr-dock/secrets/jira-${this.site}.token` : "a private file"}, readable by you alone.`
    )).child(v_flex3().gap(5).child(div4().text_size(11.5).text_color(t.dim).child("Connection")).child(h_flex4().gap(4).p(2).rounded(8).bg(t.background).border_1().border_color(t.border).w_full().max_w(260).child(choice("fetch", "Herdr (fetch)")).child(choice("curl", "curl"))).child(div4().text_size(11).text_color(t.dim).child("Use curl if Jira's certificate isn't trusted by Herdr: curl uses this computer's certificates."))).when(this.transportChoice === "curl", (el) => el.child(this.field(t, "Company CA file", this.caInput, "Only if curl doesn't trust Jira's certificate either."))).child(this.field(t, "Start work message", this.taskInput, "What Claude gets first. {key} {summary} {url} {type} {status} {priority} {assignee} {description}; \\n for a new line. E.g. /init-ticket {key}")).child(this.preview(t)).when(!first, (el) => el.child(this.boardField(t)).child(this.field(t, "High priorities", this.prioInput, `Your Jira's names for urgent priorities, comma-separated (e.g. P0, P1), for the brief's High-priority bugs. Empty: ${DEFAULT_HIGH_PRIORITIES.join(", ")}.`))).child(this.fileNote(t)).when(Boolean(this.formError), (el) => el.child(div4().text_size(12.5).text_color(t.blocked).child(this.formError))).child(h_flex4().gap(8).pt(4).child(this.button(t, "jira-save", this.formBusy ? "Connecting\u2026" : first ? "Connect" : "Save", (cx) => this.saveForm(cx), { primary: true, enabled: !this.formBusy })).when(!first, (el) => el.child(this.button(t, "jira-cancel", "Cancel", (cx) => {
      this.editing = false;
      this.formError = null;
      cx.notify();
    }))).child(div4().flex_1()).when(Boolean(this.jira?.token), (el) => el.child(this.button(t, "jira-disconnect", "Disconnect", (cx) => {
      this.editing = false;
      this.disconnect(cx);
    }, { tip: "Forget the token on this PC" })))).when(Boolean(this.jira?.problem) && !this.options.warnings.includes(this.jira.problem), (el) => el.child(div4().text_size(11.5).text_color(WARN2).child(this.jira.problem))));
  }
  // The Scrum board: the one picked (its name), a search box over Jira's scrum boards and the ones found, to pick.
  boardField(t) {
    const c = this.boardChoice;
    const hits = this.boardHits;
    const note = (text, color = t.dim) => div4().px(8).py(6).text_size(11.5).text_color(color).child(text);
    const hit = (b) => h_flex4().id(`jira-board-hit-${b.id}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.pickBoard(b, cx)).child(div4().flex_1().min_w(0).truncate().child(b.name ?? `Board ${b.id}`)).child(div4().flex_none().text_size(11).text_color(t.dim).child(`#${b.id}`));
    const found = hits === "loading" ? [note("Searching\u2026")] : hits?.problem ? [note(`${hits.problem.message} ${hits.problem.hint ?? ""}`.trim(), t.blocked)] : Array.isArray(hits) ? hits.length ? hits.map(hit) : [note("No scrum board has that in its name.")] : [];
    return v_flex3().gap(5).child(this.field(t, c ? `Scrum board: ${c.name ?? `#${c.id}`}` : "Scrum board: none", this.boardInput, null)).when(found.length > 0, (el) => el.child(v_flex3().id("jira-board-hits").max_h(200).overflow_y_scrollbar().p(4).gap(1).rounded(8).border_1().border_color(t.border).bg(t.background).text_size(12.5).text_color(t.foreground).children(found))).child(h_flex4().gap(8).items_center().child(div4().flex_1().text_size(11).text_color(t.dim).child("With a board, the Today tab shows its current sprint in its own columns under the brief. Type part of its name, then pick it.")).when(Boolean(c), (el) => el.child(this.button(t, "jira-board-none", "No board", (cx) => {
      this.boardChoice = null;
      cx.notify();
    }))));
  }
  // Where the tabs (views) and the other options are edited by hand, and each entry of that file the page skipped.
  fileNote(t) {
    const path = this.jira?.paths.settingsPath;
    return v_flex3().gap(3).when(Boolean(path), (el) => el.child(div4().text_size(11).text_color(t.dim).child(`Tabs (views) and other options are edited in ${path}; the page reads it again when it changes.`))).children(this.options.warnings.map((w) => div4().text_size(11.5).text_color(WARN2).child(w === this.jira?.problem ? w : `Skipped ${w}`)));
  }
  // What Start work would send for the open issue (else the first one listed): its action rule's message, else as typed.
  preview(t) {
    const issue = this.detail ?? this.shown().rows[0];
    if (!issue) return div4();
    const typed = this.taskInput.value();
    const template = startTemplate(this.options.actions, issue, typed);
    const text = previewTask(issue, template);
    return v_flex3().gap(4).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.border).child(div4().text_size(11).text_color(t.dim).child(template === typed ? `Preview for ${issue.key}` : `Preview for ${issue.key}, from its action rule`)).children(text.split("\n").map((l) => div4().text_size(12).text_color(t.muted).child(l || " ")));
  }
  problemView(t) {
    const p = this.problem;
    return v_flex3().size_full().items_center().justify_center().p(24).child(v_flex3().max_w(520).gap(10).items_center().child(div4().text_size(16).font_semibold().child(p.message.split(". ")[0].replace(/\.$/, "") + ".")).when(p.message.includes(". "), (el) => el.child(div4().text_size(12.5).text_color(t.muted).child(p.message.slice(p.message.indexOf(". ") + 2)))).child(div4().text_size(12.5).text_color(t.dim).child(p.hint ?? "")).child(h_flex4().gap(8).pt(8).child(this.button(t, "jira-retry", "Try again", (cx) => cx.spawn(async (cx2) => this.reload(cx2)), { primary: true })).when((p.kind === "tls" || p.kind === "offline") && this.jira?.settings.transport !== "curl", (el) => el.child(this.button(t, "jira-use-curl", "Switch to curl", (cx) => this.useCurl(cx)))).child(this.button(t, "jira-open-settings", p.kind === "auth" || p.kind === "forbidden" ? "Connect again" : "Settings", (cx) => this.openSettings(cx)))));
  }
  header(t) {
    const tab = this.tab();
    const today = tab.kind === "today";
    const list3 = this.state(tab.id);
    const [shownCount, total] = today ? [this.sprint.rows.length, this.sprint.total] : [list3.rows.length, list3.total];
    const f = this.filter();
    const filters = this.filters();
    const view = this.layout();
    const host = (() => {
      try {
        return new URL(this.jira.settings.baseUrl).host;
      } catch {
        return "";
      }
    })();
    const item = (x) => h_flex4().id(`jira-filter-${x.id}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer().bg(x.id === f.id ? t.selected : t.popover).hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
      this.filterOpen = false;
      setShared2(FILTER_KEY, x.id);
      list3.moved = /* @__PURE__ */ new Map();
      this.selected = null;
      this.detail = null;
      cx.spawn(async (cx2) => this.refresh(cx2));
    }).child(div4().flex_1().min_w(0).truncate().child(x.name)).child(div4().flex_none().text_size(11).text_color(t.dim).child(x.source === "favourite" ? "Jira" : x.source === "own" ? "mine" : ""));
    const picker = tab.filters && Popover2.new("jira-filter").open(this.filterOpen).on_open_change((open, cx) => {
      this.filterOpen = open;
      cx.notify();
    }).trigger(h_flex4().id("jira-filter-trigger").h(28).px(10).gap(6).items_center().rounded(7).border_1().border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover)).text_size(12.5).child(div4().max_w(220).truncate().child(f.name)).child(svg3("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim))).content(v_flex3().id("jira-filter-list").w(300).max_h(360).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).children(filters.map(item)));
    const seg = (value, label) => h_flex4().id(`jira-view-${value}`).h(24).px(9).items_center().rounded(5).text_size(12).cursor_pointer().on_click(() => setShared2(LAYOUT_KEY(tab.id), value)).when(view === value, (el) => el.bg(t.raised ?? t.selected).text_color(t.foreground)).when(view !== value, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover))).child(label);
    const icon = (id, path, tip, onClick) => div4().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => onClick(cx)).child(svg3(path).size(14));
    return h_flex4().flex_none().h(52).px(16).gap(10).items_center().border_b(1).border_color(t.border).child(div4().text_size(16).font_semibold().child("Jira")).child(div4().text_size(12).text_color(t.dim).max_w(180).truncate().child(host)).when(Boolean(picker), (el) => el.child(picker)).when(!today, (el) => el.child(h_flex4().id("jira-search").w(240).h(28).px(8).items_center().rounded(7).border_1().border_color(t.border).bg(t.background).child(Input.new(this.searchInput).flex_1().h_full().text_size(12.5).text_color(t.foreground)))).when(!today && Boolean(tab.button), (el) => el.child(this.button(t, "jira-tab-button", tab.button.label, (cx) => this.tabButton(tab.button, cx), { accent: true, tip: tabButtonWork(tab.button).args.task }))).child(div4().flex_1()).child(div4().text_size(11.5).text_color(t.dim).child(list3.loading ? "loading\u2026" : list3.fetchedAt ? [countText(shownCount, total), `updated ${ago(list3.fetchedAt, Date.now())}`].filter(Boolean).join(" \xB7 ") : "")).when(!today, (el) => el.child(h_flex4().p(2).gap(2).rounded(7).border_1().border_color(t.border).child(seg("list", "List")).child(seg("board", "Board")))).child(icon("jira-refresh", "mods/dock-jira/refresh.svg", "Refresh", (cx) => cx.spawn(async (cx2) => this.reload(cx2)))).child(icon("jira-gear", "mods/workspace-chrome/settings.svg", "Jira settings", (cx) => this.openSettings(cx)));
  }
  typeMark(t, r) {
    return div4().flex_none().size(8).rounded(2).bg(TYPE_COLOR(t, r.type)).tooltip(r.type ?? "issue");
  }
  // `keyW`: the key column's width, one for the whole list (keyColumnWidth over the shown rows).
  row(t, r, i, keyW) {
    const on = this.selected === r.key;
    const hot = r.priority === "Highest" || r.priority === "High";
    return h_flex4().id(`jira-row-${r.key}`).h(34).px(16).gap(10).flex_none().items_center().cursor_pointer().bg(on ? t.selected : t.background).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.select(r.key, cx)).child(this.typeMark(t, r)).child(div4().w(keyW).flex_none().truncate().text_size(12).text_color(t.dim).child(r.key)).child(div4().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(r.summary)).child(div4().w(70).flex_none().truncate().text_size(11.5).text_color(hot ? WARN2 : t.dim).child(r.priority ?? "")).child(div4().w(110).flex_none().truncate().text_size(11.5).text_color(r.assignee ? t.muted : t.dim).child(r.assignee ?? "Unassigned")).child(div4().w(34).flex_none().text_size(11.5).text_color(t.dim).child(ago(r.updatedMs, Date.now()))).child(div4().id(`jira-start-${r.key}`).size(24).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover((st) => st.bg(t.raised ?? t.hover).text_color(t.foreground)).tooltip(`Start work on ${r.key}: a Claude tab with
${previewTask(r, startTemplate(this.options.actions, r, this.jira?.settings.startTask))}`).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => {
      cx.stop_propagation();
      this.startWork(r, cx);
    }).child(svg3("mods/dock-jira/play.svg").size(11)));
  }
  more(t) {
    const s = this.shown();
    if (!Number.isFinite(s.total) || s.rows.length >= s.total) return null;
    return h_flex4().px(16).py(10).child(this.button(
      t,
      "jira-more",
      `Load more (${s.total - s.rows.length} left)`,
      (cx) => cx.spawn(async (cx2) => this.refresh(cx2, { more: true })),
      { enabled: !s.loading }
    ));
  }
  // The tab's rows by To do / In progress / Done; a view grouped by "type" first splits them by issue type.
  listView(t) {
    const tab = this.tab();
    const rows = this.shownRows();
    const sections = sectionsFor(rows, tab.group);
    const keyW = keyColumnWidth(rows.map((r) => r.key));
    const more = this.more(t);
    const group = (g) => [
      h_flex4().h(30).px(16).pt(8).gap(6).flex_none().items_center().child(div4().text_size(11.5).font_medium().text_color(t.muted).child(g.title)).child(div4().text_size(11.5).text_color(t.dim).child(String(g.rows.length))),
      ...g.rows.map((r, i) => this.row(t, r, i, keyW))
    ];
    const section = (sec) => [
      ...sec.title ? [h_flex4().h(38).px(16).pt(14).gap(6).flex_none().items_center().child(div4().text_size(13).font_semibold().text_color(t.foreground).child(sec.title)).child(div4().text_size(12).text_color(t.dim).child(String(sec.parts.reduce((n, g) => n + g.rows.length, 0))))] : [],
      ...sec.parts.flatMap(group)
    ];
    const scroll = this.scroll(`${tab.id}/list`);
    return v_flex3().id(`jira-list-${tab.id}`).flex_1().min_w(0).min_h(0).overflow_y_scrollbar().pb(16).when(Boolean(scroll), (el) => el.track_scroll(scroll)).children(sections.flatMap(section)).when(Boolean(more), (el) => el.child(more));
  }
  card(t, r) {
    const on = this.selected === r.key;
    const dragged = this.drag?.row.key === r.key;
    return v_flex3().id(`jira-card-${r.key}`).p(10).gap(6).flex_none().rounded(8).cursor_pointer().bg(on ? t.selected : t.surface ?? t.chrome).border_1().border_color(on ? t.accent : t.border).hover((s) => s.bg(t.hover)).when(dragged, (el) => el.opacity(0.35)).on_mouse_down("left", (e) => {
      this.press = { row: r, from: e.position };
    }).on_click((_e, cx) => {
      if (!this.drag) this.select(r.key, cx);
    }).child(div4().text_size(12.8).text_color(t.foreground).child(r.summary)).child(h_flex4().gap(6).items_center().child(this.typeMark(t, r)).child(div4().text_size(11.5).text_color(t.dim).child(r.key)).when(Boolean(r.priority), (el) => el.child(div4().text_size(11).text_color(r.priority === "Highest" || r.priority === "High" ? WARN2 : t.dim).child(r.priority))).child(div4().flex_1()).child(div4().text_size(11).text_color(t.dim).max_w(110).truncate().child(r.assignee ?? "Unassigned")));
  }
  boardView(t) {
    const d = this.drag;
    const base = boardColumns(this.shownRows(), this.statusOrder, this.boardStatuses());
    const cols = d ? dragColumns(base, d.targets, Array.isArray(d.transitions) ? d.transitions : [], this.statusOrder) : base;
    const more = this.more(t);
    const tabId = this.tab().id;
    const board = this.scroll(`${tabId}/board`);
    const column = (c, i) => {
      const own = d && c.status === d.row.status;
      const cards = c.temporary ? null : this.scroll(`${tabId}/col/${c.status}`);
      const target = d && d.targets.has(c.status);
      const over = target && d.over === c.status;
      return v_flex3().id(`jira-col-${i}`).flex_1().min_w(240).min_h(0).rounded(10).border_1().bg(over ? t.selected : t.chrome).border_color(target ? t.accent : t.border).when(Boolean(d) && !own && !target, (el) => el.opacity(0.4)).on_mouse_move((_e, cx) => {
        if (!this.drag) return;
        this.drag.hover = c.status;
        if (this.drag.over !== (target ? c.status : null)) {
          this.drag.over = target ? c.status : null;
          cx.notify();
        }
      }).child(h_flex4().h(36).px(12).gap(6).flex_none().items_center().child(div4().text_size(12).font_medium().text_color(target ? t.foreground : t.muted).child(c.status)).child(div4().text_size(11.5).text_color(t.dim).child(c.temporary ? "move here" : String(c.rows.length)))).child(v_flex3().id(`jira-col-${i}-cards`).flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8).gap(6).when(Boolean(cards), (el) => el.track_scroll(cards)).when(this.dropChoice?.status === c.status && !d, (el) => el.child(this.choiceBox(t))).when(this.dropNote?.status === c.status && !d, (el) => el.child(this.noteBox(t))).children(c.rows.map((r) => this.card(t, r))));
    };
    return v_flex3().id("jira-board-wrap").relative().flex_1().min_w(0).min_h(0).on_mouse_move((e, cx) => this.pointerMoved(e, cx)).on_mouse_up("left", (_e, cx) => this.released(cx)).child(div4().id(`jira-board-${tabId}`).flex().flex_row().flex_1().min_h(0).overflow_x_scrollbar().p(12).gap(12).when(Boolean(board), (el) => el.track_scroll(board)).children(cols.map(column))).when(Boolean(more), (el) => el.child(more)).when(Boolean(d), (el) => el.child(this.dragBar(t))).when(Boolean(d?.at), (el) => el.child(div4().absolute().left(d.at.x + 14).top(d.at.y + 14).w(240).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.accent).opacity(0.92).text_size(12.5).text_color(t.foreground).child(div4().text_size(11).text_color(t.dim).child(d.row.key)).child(div4().truncate().child(d.row.summary))));
  }
  // In the column dropped on, when several moves lead there: which one (Resolve or Close into Done, say).
  choiceBox(t) {
    const c = this.dropChoice;
    if (c.step) {
      const { tr, field } = c.step;
      return v_flex3().id("jira-drop-choice").flex_none().p(10).gap(8).rounded(8).bg(t.selected).border_1().border_color(t.accent).child(div4().text_size(12.5).text_color(t.foreground).child(`${tr.name} ${c.row.key}: pick a ${field.name}`)).child(h_flex4().gap(6).flex_wrap().children(field.options.map((o) => this.button(t, `jira-drop-opt-${o.id ?? o.name}`, o.name, (cx) => this.moveCard(c.row, tr, cx, stepFields(field.key, o)), { primary: true }))).child(this.button(t, "jira-drop-cancel", "Cancel", (cx) => {
        this.dropChoice = null;
        cx.notify();
      })));
    }
    return v_flex3().id("jira-drop-choice").flex_none().p(10).gap(8).rounded(8).bg(t.selected).border_1().border_color(t.accent).child(div4().text_size(12.5).text_color(t.foreground).child(`Move ${c.row.key} here by:`)).child(h_flex4().gap(6).flex_wrap().children(c.transitions.map((tr) => this.button(t, `jira-drop-${tr.id}`, tr.name, (cx) => this.moveCard(c.row, tr, cx), { primary: true }))).child(this.button(t, "jira-drop-cancel", "Cancel", (cx) => {
      this.dropChoice = null;
      cx.notify();
    })));
  }
  // In a dimmed column a card was dropped on: why nothing happened.
  noteBox(t) {
    return h_flex4().id("jira-drop-note").flex_none().p(10).gap(8).items_start().rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(WARN2).child(div4().flex_1().text_size(12).text_color(t.muted).child(this.dropNote.text)).child(div4().id("jira-drop-note-x").size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.dim).hover((st) => st.bg(t.hover)).on_click((_e, cx) => {
      this.dropNote = null;
      cx.notify();
    }).child(svg3("mods/workspace-chrome/x.svg").size(11)));
  }
  // At the bottom of the board while dragging: what's happening.
  dragBar(t) {
    const bar = h_flex4().absolute().bottom(12).left(12).h(38).px(14).gap(8).items_center().rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(12.5);
    const d = this.drag;
    const text = d.transitions === "loading" ? `Moving ${d.row.key}: asking Jira where it can go\u2026` : d.transitions.problem ? `Can't move ${d.row.key}: ${d.transitions.problem.message}` : d.targets.size ? `Drop ${d.row.key} on a highlighted column (release elsewhere to cancel)` : `${d.row.key} has no moves from ${d.row.status}.`;
    return bar.child(div4().text_color(d.transitions?.problem ? t.blocked : t.muted).child(text));
  }
  detailView(t) {
    const d = this.detail;
    const close = div4().id("jira-detail-close").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close").on_click((_e, cx) => {
      this.selected = null;
      this.detail = null;
      cx.notify();
    }).child(svg3("mods/workspace-chrome/x.svg").size(13));
    const pane = v_flex3().id("jira-detail").w(DETAIL_W).flex_none().min_h(0).border_l(1).border_color(t.border).bg(t.background);
    const top = h_flex4().h(44).px(16).gap(8).flex_none().items_center().border_b(1).border_color(t.border).child(div4().text_size(12.5).text_color(t.dim).child(this.selected)).child(div4().flex_1()).child(close);
    if (!d) {
      return pane.child(top).child(div4().p(16).text_size(12.5).text_color(this.detailProblem ? t.blocked : t.dim).child(this.detailProblem ? `${this.detailProblem.message} ${this.detailProblem.hint}` : "Loading\u2026"));
    }
    const finish = finishWork(d, this.options.actions);
    const lines = (text) => (text ? text.split("\n") : []).map((l) => l.trim() ? div4().child(l) : div4().h(8));
    const meta = (label, value) => h_flex4().gap(8).child(div4().w(70).flex_none().text_color(t.dim).child(label)).child(div4().flex_1().min_w(0).truncate().child(value ?? "\u2014"));
    return pane.child(top).child(v_flex3().id("jira-detail-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(14).child(div4().text_size(16).font_semibold().child(d.summary)).child(h_flex4().gap(8).items_center().flex_wrap().child(this.statusMenu(t, d)).when(canAssignToMe(d, this.me), (el) => el.child(this.button(
      t,
      "jira-assign",
      this.actionBusy === "assign" ? "Assigning\u2026" : "Assign to me",
      (cx) => this.assignMe(cx),
      { enabled: !this.actionBusy }
    ))).child(div4().flex_1()).child(this.button(t, "jira-start", "Start work", (cx) => this.startWork(d, cx), { primary: true, tip: `Opens a Claude tab with:
${startWork(d, startTemplate(this.options.actions, d, this.jira?.settings.startTask))?.args.task ?? ""}` })).when(Boolean(finish), (el) => el.child(this.button(t, "jira-finish", "Finish", (cx) => this.finishWork(d, cx), { tip: `Opens a Claude tab named ${d.key} finish with:
${finish.args.task}` }))).child(this.button(t, "jira-open", "Open in browser", () => this.openUrl(d.url)))).when(this.pendingStep?.key === d.key, (el) => el.child(this.stepBox(t))).when(Boolean(this.actionMsg) || this.actionBusy === "transition", (el) => el.child(this.actionLine(t))).child(v_flex3().gap(4).text_size(12.5).child(meta("Type", d.type)).child(meta("Priority", d.priority)).child(meta("Assignee", d.assignee ?? "Unassigned")).child(meta("Reporter", d.reporter)).child(meta("Updated", d.updatedMs ? `${ago(d.updatedMs, Date.now())} ago` : null))).child(changeView(this, t)).child(v_flex3().gap(4).text_size(12.8).text_color(t.foreground).child(div4().text_size(11.5).font_medium().text_color(t.muted).child("Description")).children(d.description ? lines(d.description) : [div4().text_color(t.dim).child("No description.")])).when(d.links.length > 0, (el) => el.child(v_flex3().gap(4).text_size(12.5).child(div4().text_size(11.5).font_medium().text_color(t.muted).child("Links")).children(d.links.map((l, i) => h_flex4().id(`jira-link-${i}`).gap(6).cursor_pointer().hover((s) => s.text_color(t.accent)).on_click(() => this.openUrl(l.url)).child(div4().text_color(t.dim).child(l.label)).child(div4().child(l.key)))))).child(v_flex3().gap(10).child(div4().text_size(11.5).font_medium().text_color(t.muted).child(d.commentTotal > d.comments.length ? `Comments \xB7 last ${d.comments.length} of ${d.commentTotal}` : `Comments \xB7 ${d.commentTotal}`)).children(d.comments.map((c) => v_flex3().gap(3).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.border).text_size(12.5).child(h_flex4().gap(6).child(div4().font_medium().child(c.author)).child(div4().text_color(t.dim).child(c.createdMs ? ago(c.createdMs, Date.now()) : ""))).children(lines(c.bodyText)))).child(v_flex3().gap(6).child(div4().rounded(8).border_1().border_color(t.border).bg(t.surface ?? t.chrome).px(10).py(8).child(Input.new(this.commentInput).w_full().h(22).text_size(12.5).text_color(t.foreground))).child(h_flex4().gap(8).items_center().child(div4().flex_1().text_size(11).text_color(t.dim).child("Enter sends")).child(this.button(
      t,
      "jira-comment-send",
      this.actionBusy === "comment" ? "Sending\u2026" : "Send",
      (cx) => this.sendComment(cx),
      { primary: true, enabled: !this.actionBusy }
    ))))));
  }
  // The status pill: a menu of the moves Jira allows from here (asked when it opens; workflows differ per issue).
  statusMenu(t, d) {
    const pill = h_flex4().id("jira-status").h(24).px(8).gap(5).items_center().rounded(6).text_size(11.5).cursor_pointer().bg(d.category === "done" ? t.done : d.category === "indeterminate" ? t.accent : t.border).text_color(d.category === "new" ? t.foreground : t.accent_foreground ?? t.background).hover((st) => st.opacity(0.85)).tooltip("Change status").child(d.status ?? "").child(svg3("mods/workspace-chrome/chevron-down.svg").size(11));
    const list3 = this.transitions;
    const rows = list3 === "loading" || list3 === null ? [div4().p(8).text_color(t.dim).child("Asking Jira\u2026")] : list3.problem ? [div4().p(8).text_color(t.blocked).child(`${list3.problem.message} ${list3.problem.hint}`)] : !list3.length ? [div4().p(8).text_color(t.dim).child("No moves from this status.")] : list3.map((tr) => h_flex4().id(`jira-tr-${tr.id}`).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.doTransition(tr, cx)).child(div4().flex_1().min_w(0).truncate().child(tr.name)).when(Boolean(tr.to?.name) && tr.to.name !== tr.name, (el) => el.child(div4().flex_none().text_size(11).text_color(t.dim).child(`\u2192 ${tr.to.name}`))));
    return Popover2.new("jira-status-menu").open(this.transOpen).on_open_change((open, cx) => this.openTransitions(open, cx)).trigger(pill).content(v_flex3().id("jira-tr-list").w(260).max_h(320).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).children(rows));
  }
  // A move from the status menu waiting for its one required value (a Resolution): Jira's choices as buttons.
  stepBox(t) {
    const { tr, field, url } = this.pendingStep;
    return v_flex3().id("jira-step").p(10).gap(8).rounded(8).bg(t.selected).border_1().border_color(t.accent).child(div4().text_size(12.5).child(`${tr.name}: pick a ${field.name}`)).child(h_flex4().gap(6).flex_wrap().children(field.options.map((o) => this.button(t, `jira-step-opt-${o.id ?? o.name}`, o.name, (cx) => this.doTransition(tr, cx, url, stepFields(field.key, o)), { primary: true }))).child(this.button(t, "jira-step-cancel", "Cancel", (cx) => {
      this.pendingStep = null;
      cx.notify();
    })));
  }
  // What the last action did, in place: green when it worked, red when not (with the browser link for a step
  // Jira wants more for).
  actionLine(t) {
    const m = this.actionMsg;
    if (!m) return div4().text_size(12).text_color(t.dim).child("Moving\u2026");
    return h_flex4().gap(8).items_center().text_size(12).child(div4().flex_1().text_color(m.ok ? t.done : t.blocked).child(m.message)).when(Boolean(m.link), (el) => el.child(this.button(t, "jira-action-link", "Open in browser", () => this.openUrl(m.link))));
  }
  render() {
    const t = theme();
    const state = checking() || !this.jira ? "setup" : pageState({ settings: this.jira.settings, token: this.jira.token, editing: this.editing, connected: this.connected, problem: this.problem, checking: this.checkingNow });
    const root = v_flex3().id("dock-jira").size_full().min_h(0).bg(t.background).text_color(t.foreground).on_mouse_up("left", (_e, cx) => this.dragEnded(cx));
    if (state === "setup" || state === "settings") return root.child(this.settingsForm(t, state === "setup"));
    if (state === "problem") return root.child(this.problemView(t));
    if (state === "checking") {
      return root.child(v_flex3().size_full().items_center().justify_center().gap(6).child(div4().text_size(14).child("Connecting to Jira\u2026")).child(div4().text_size(12).text_color(t.dim).child(this.jira.settings.baseUrl)));
    }
    const s = this.shown();
    const message = (text) => v_flex3().flex_1().items_center().justify_center().text_color(t.dim).child(text);
    const body = this.tab().kind === "today" ? v_flex3().flex_1().min_w(0).min_h(0).child(briefView(this, t)).when(this.options.board != null, (el) => el.child(sprintBoard(this, t))) : s.listProblem ? v_flex3().flex_1().p(24).gap(6).child(div4().text_size(13).text_color(t.blocked).child(s.listProblem.message)).child(div4().text_size(12).text_color(t.dim).child(s.listProblem.hint)) : !s.fetchedAt ? message("Loading\u2026") : !s.rows.length && !s.loading ? message(s.query ? `Nothing matches "${s.query}".` : "No issues in this filter.") : this.layout() === "board" ? this.boardView(t) : this.listView(t);
    return root.child(this.header(t)).child(tabBar(this, t)).child(div4().flex().flex_row().flex_1().min_h(0).child(body).when(Boolean(this.selected), (el) => el.child(this.detailView(t))));
  }
};
export {
  Jira as default
};
