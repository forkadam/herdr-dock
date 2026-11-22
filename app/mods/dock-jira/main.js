// src/mods/dock-jira/main.js
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, Popover, TextareaState, Textarea } from "gpui-base";
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
  { id: "recent", name: "Mine, updated recently", jql: "assignee = currentUser() AND updated >= -14d ORDER BY updated DESC" }
];
var ROW_FIELDS = ["summary", "status", "issuetype", "priority", "assignee", "updated"];
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
function searchUrl(base, jql, { startAt = 0, maxResults = 50, fields = ROW_FIELDS } = {}) {
  const params = new URLSearchParams({ jql, startAt: String(startAt), maxResults: String(maxResults), fields: fields.join(",") });
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
  return {
    key: issue.key,
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
    url: browseUrl(base, issue.key)
  };
}
function groupByCategory(rows) {
  return CATEGORIES.map((c) => ({ ...c, rows: rows.filter((r) => r.category === c.category) })).filter((g) => g.rows.length);
}
function boardColumns(rows, order = []) {
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
    project: f.project?.key ?? null,
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
    const num = /^(#+)\s+(.*)$/.exec(line);
    const dot = /^(\*+)\s+(.*)$/.exec(line);
    if (num) {
      n = num[1].length === 1 ? n + 1 : n;
      out.push(`${"  ".repeat(num[1].length - 1)}${num[1].length === 1 ? `${n}.` : "-"} ${num[2]}`);
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
function curlArgs({ method = "GET", url, configPath, body, timeoutMs = DEFAULT_TIMEOUT_MS, caFile }) {
  const args = ["-sS", "--globoff", "-K", configPath, "-X", method, "-H", "Accept: application/json"];
  if (body !== void 0) args.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body));
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
  "issuelinks"
];
var TIMEOUT2 = Symbol("timeout");
function errorText(e) {
  const parts = [e?.message ?? String(e)];
  for (let c = e?.cause, n = 0; c && n < 3; c = c.cause, n++) parts.push(c.code, c.message);
  return parts.filter(Boolean).join(" ");
}
function createClient({ base, transport = "fetch", token, curlConfigPath, caFile, io, timeoutMs = 2e4 }) {
  const root = String(base ?? "").replace(/\/+$/, "");
  const api = (path) => `${root}/rest/api/2${path}`;
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
  async function viaCurl(method, url, body) {
    let res;
    try {
      res = await io.exec("curl", curlArgs({ method, url, configPath: curlConfigPath, body, timeoutMs, caFile }), { timeout: timeoutMs + 1e4 });
    } catch (e) {
      return { ok: false, problem: { kind: "nocurl", message: `Couldn't run curl: ${e?.message ?? e}`, hint: "Install curl, or switch the connection to fetch in Settings." } };
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
  return {
    serverInfo: () => request("GET", api("/serverInfo")),
    myself: () => request("GET", api("/myself")),
    search: (jql, page = {}) => request("GET", searchUrl(root, jql, page)),
    issue: (key) => request("GET", `${api(issuePath(key))}?fields=${DETAIL_FIELDS.join(",")}`),
    statuses: () => request("GET", api("/status")).then((r) => map(r, (d) => Array.isArray(d) ? d : [])),
    favouriteFilters: () => request("GET", api("/filter/favourite")).then((r) => map(r, (d) => Array.isArray(d) ? d : [])),
    transitions: (key) => request("GET", api(`${issuePath(key)}/transitions`)).then((r) => map(r, (d) => d?.transitions ?? [])),
    transition: (key, id, fields) => request("POST", api(`${issuePath(key)}/transitions`), { transition: { id: String(id) }, ...fields ? { fields } : {} }),
    assign: (key, name) => request("PUT", api(`${issuePath(key)}/assignee`), { name }),
    comment: (key, text) => request("POST", api(`${issuePath(key)}/comment`), { body: text })
  };
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
function pollDue({ shown, lastAt, failed, now }) {
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
var badgeFor = (count) => Number.isFinite(count) ? { count, tone: "info" } : null;
function countText(shown, total) {
  if (!Number.isFinite(total)) return "";
  if (shown >= total) return `${total} issue${total === 1 ? "" : "s"}`;
  return `${shown} of ${total}`;
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

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
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
    curlConfigPath: `${secretsDir}/jira-${name}.curlrc`
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
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var str = (v) => typeof v === "string" ? v : "";
function parseSettings(text) {
  if (text == null || !String(text).trim()) return { ok: true, settings: { ...DEFAULT_SETTINGS, filters: [] } };
  let raw;
  try {
    raw = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, settings: { ...DEFAULT_SETTINGS, filters: [] }, error: `not valid JSON (${e.message})` };
  }
  if (!isObj(raw)) return { ok: false, settings: { ...DEFAULT_SETTINGS, filters: [] }, error: "not a JSON object" };
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
      filters: (Array.isArray(raw.filters) ? raw.filters : []).filter((f) => isObj(f) && str(f.name).trim() && str(f.jql).trim()).map((f) => ({ name: f.name.trim(), jql: f.jql.trim() }))
    }
  };
}
function formatSettings(settings) {
  const { token: _never, ...rest } = settings ?? {};
  return JSON.stringify({ ...DEFAULT_SETTINGS, ...rest, v: 1 }, null, 2) + "\n";
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

// src/shared/platform.js
function openUrlCommand(platform, url) {
  if (platform === "windows") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "macos") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

// src/mods/dock-jira/main.js
var MOD = "dock-jira";
var BADGE_KEY = `dock.page.badge.${MOD}`;
var VIEW_KEY = "dock.jira.view";
var FILTER_KEY = "dock.jira.filter";
var TICK_MS = 3e4;
var DETAIL_W = 420;
var WARN = "#d29922";
var PAGE_PROBLEMS = ["auth", "forbidden", "offline", "tls", "timeout", "server", "nocurl", "unknown"];
var TYPE_COLOR = (t, type) => ({ Bug: t.blocked, Story: t.done, Epic: "#8b5cf6" })[type] ?? t.accent;
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
    this.query = "";
    this.rows = [];
    this.total = void 0;
    this.listLoading = false;
    this.listProblem = null;
    this.fetchedAt = null;
    this.lastPollAt = void 0;
    this.pollFailed = false;
    this.selected = null;
    this.detail = null;
    this.detailLoading = false;
    this.detailProblem = null;
    this.filterOpen = false;
    this.seq = latestOnly();
    this.detailSeq = latestOnly();
    this.transOpen = false;
    this.transitions = null;
    this.actionBusy = null;
    this.actionMsg = null;
    this.searchInput = InputState.new({ placeholder: "Search this filter\u2026" });
    this.searchInput.on("submit", (_e, cx2) => {
      this.query = this.searchInput.value().trim();
      this.refresh(cx2);
    });
    this.urlInput = InputState.new({ placeholder: "https://jira.example.com" });
    this.tokenInput = InputState.new({ placeholder: "Personal access token" });
    this.tokenInput.set_masked(true);
    this.taskInput = InputState.new({ placeholder: "Work on Jira issue {key}: {summary}\\n{url}" });
    this.caInput = InputState.new({ placeholder: "Optional: path to the company CA file (curl)" });
    this.commentInput = TextareaState.new({ placeholder: "Add a comment\u2026 (Ctrl+Enter sends)" });
    this.commentInput.set_auto_grow(2, 6);
    this.commentInput.on("submit", (e, cx2) => {
      if (e?.secondary) this.sendComment(cx2);
    });
    for (const input of [this.urlInput, this.tokenInput, this.taskInput, this.caInput]) input.on("submit", (_e, cx2) => this.saveForm(cx2));
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
  // Commands (keys.json can bind them: "dock-jira.next"): list, board, refresh, settings, next, prev, close, and on
  // the open issue: status (its status menu), assign (to me), comment (the cursor into the comment box), start (Start work).
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
      if (this.detail) this.startWork(this.detail);
      return;
    }
    if (c === "list" || c === "board") setShared2(VIEW_KEY, c);
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
  // Issue keys in the order they're drawn (by group in the list, by column on the board).
  visibleOrder() {
    const parts = shared2(VIEW_KEY) === "board" ? boardColumns(this.rows, this.statusOrder) : groupByCategory(this.rows);
    return parts.flatMap((p) => p.rows.map((r) => r.key));
  }
  // ---- data ----
  io() {
    return { appHome: slashPath(appHome()), platform: window()?.platform, readTextFile, writeTextFile, exec };
  }
  async load() {
    this.jira = await loadJira(this.io(), this.site);
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
      caFile: settings.caFile || void 0,
      io: { fetch: (u, o) => fetch(u, o), exec, sleep: (ms) => cx.sleep(ms) }
    });
  }
  filters() {
    return filterList(this.favourites, this.jira?.settings.filters);
  }
  filter() {
    return pickFilter(this.filters(), shared2(FILTER_KEY));
  }
  // First contact: who am I, then the favourites and the list.
  async connect(cx) {
    this.checkingNow = true;
    this.problem = null;
    cx.notify();
    const me = await this.client(cx).myself();
    this.checkingNow = false;
    if (!me.ok) {
      this.problem = me.problem;
      this.connected = false;
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
  }
  // Refresh by hand: connect again when not connected (or after a problem), else the list and the open issue.
  async reload(cx) {
    if (!this.jira?.settings.baseUrl || !this.jira.token) return;
    if (!this.connected || this.problem) {
      await this.connect(cx);
      return;
    }
    await this.refresh(cx);
    if (this.selected) await this.loadDetail(cx, this.selected);
  }
  // The list for the chosen filter (and search), and the badge. The newest search wins.
  async refresh(cx, { more = false } = {}) {
    if (!this.connected || !this.jira) return;
    const seq = this.seq.next();
    const f = this.filter();
    const jql = withSearch(f.jql, this.query);
    this.listLoading = true;
    cx.notify();
    const r = await this.client(cx).search(jql, { startAt: more ? this.rows.length : 0, maxResults: PAGE_SIZE });
    if (!this.seq.accept(seq)) return;
    this.listLoading = false;
    this.lastPollAt = Date.now();
    this.pollFailed = !r.ok;
    if (!r.ok) {
      if (PAGE_PROBLEMS.includes(r.problem.kind)) {
        this.problem = r.problem;
        this.connected = r.problem.kind !== "auth";
      } else this.listProblem = r.problem;
      cx.notify();
      return;
    }
    const base = this.jira.settings.baseUrl;
    const rows = (r.data?.issues ?? []).map((i) => issueRow(i, base));
    this.rows = more ? [...this.rows, ...rows] : rows;
    this.total = r.data?.total;
    this.fetchedAt = Date.now();
    this.listProblem = null;
    this.problem = null;
    cx.notify();
    await this.updateBadge(cx, f);
  }
  // How many issues are assigned to me and unresolved: free when that's the filter shown, else one count query.
  async updateBadge(cx, f) {
    if (f.id === "mine" && !this.query) {
      setShared2(BADGE_KEY, badgeFor(this.total));
      return;
    }
    const r = await this.client(cx).search(pickFilter(this.filters(), "mine").jql, { maxResults: 0 });
    if (r.ok) setShared2(BADGE_KEY, badgeFor(r.data?.total));
  }
  tick(cx) {
    if (!this.jira || this.editing || this.checkingNow) return;
    const shown = pageShown(MOD);
    if (!pollDue({ shown, lastAt: this.lastPollAt, failed: this.pollFailed, now: Date.now() })) return;
    cx.spawn(async (cx2) => {
      if (!this.connected && this.jira.settings.baseUrl && this.jira.token) await this.connect(cx2);
      else await this.refresh(cx2);
      if (this.selected && shown) await this.loadDetail(cx2, this.selected);
    });
  }
  select(key, cx) {
    if (key !== this.selected) {
      this.actionMsg = null;
      this.transitions = null;
      this.transOpen = false;
      this.commentInput.set_value("");
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
  doTransition(tr, cx) {
    this.transOpen = false;
    this.transitions = null;
    this.run(
      "transition",
      cx,
      (c, key) => c.transition(key, tr.id),
      { to: tr.to?.name ?? tr.name, url: this.detail?.url },
      async (cx2, key) => {
        await this.loadDetail(cx2, key);
        await this.refresh(cx2);
      }
    );
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
  // Start work: a Claude tab named after the issue, with the user's message; then the terminal comes to the front.
  startWork(issue) {
    const c = startWork(issue, this.jira?.settings.startTask);
    if (!c) return;
    try {
      run(c.command, c.args);
    } catch (e) {
      this.actionMsg = { ok: false, message: `Couldn't open the tab: ${e?.message ?? e}` };
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
    }
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
        const settings = {
          ...this.jira.settings,
          baseUrl: url.url,
          transport: this.transportChoice,
          startTask: this.taskInput.value(),
          caFile: this.caInput.value().trim()
        };
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
      Object.assign(this, { connected: false, me: null, rows: [], total: void 0, selected: null, detail: null, problem: null });
      setShared2(BADGE_KEY, null);
      cx2.notify();
    });
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
  button(t, id, label, onClick, { primary = false, enabled = true, tip } = {}) {
    return h_flex().id(id).h(28).px(12).flex_none().items_center().rounded(7).text_size(12.5).when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground)).when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.foreground)).when(enabled, (el) => el.cursor_pointer().on_click((_e, cx) => onClick(cx)).hover((s) => primary ? s.opacity(0.9) : s.bg(t.hover))).when(!enabled, (el) => el.opacity(0.45)).when(Boolean(tip), (el) => el.tooltip(tip)).child(label);
  }
  field(t, label, input, hint) {
    return v_flex().gap(5).child(div().text_size(11.5).text_color(t.dim).child(label)).child(Input.new(input).h(34).px(10).rounded(8).border_1().border_color(t.input ?? t.border).bg(t.background).text_size(12.8).text_color(t.foreground)).when(Boolean(hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(hint)));
  }
  settingsForm(t, first) {
    const s = this.jira?.settings;
    const choice = (value, label) => h_flex().id(`jira-transport-${value}`).h(26).px(10).items_center().rounded(6).text_size(12).cursor_pointer().on_click((_e, cx) => {
      this.transportChoice = value;
      cx.notify();
    }).when(this.transportChoice === value, (el) => el.bg(t.raised ?? t.selected).border_1().border_color(t.border).text_color(t.foreground)).when(this.transportChoice !== value, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover))).child(label);
    return v_flex().id("jira-settings").size_full().min_h(0).overflow_y_scrollbar().items_center().py(32).px(24).child(v_flex().w_full().max_w(560).gap(16).child(v_flex().gap(4).child(div().text_size(18).font_semibold().child(first ? "Connect Jira" : "Jira settings")).child(div().text_size(12.5).text_color(t.muted).child("Your company's Jira Server / Data Center, with a personal access token (Jira \u2192 Profile \u2192 Personal Access Tokens). Your Jira MCP's JIRA_URL and JIRA_PERSONAL_TOKEN work here."))).child(this.field(t, "Jira address", this.urlInput, null)).child(this.field(
      t,
      this.jira?.token ? "Personal access token (saved; paste a new one to replace it)" : "Personal access token",
      this.tokenInput,
      `Kept only on this PC, in ${this.jira ? `herdr-dock/secrets/jira-${this.site}.token` : "a private file"}, readable by you alone.`
    )).child(v_flex().gap(5).child(div().text_size(11.5).text_color(t.dim).child("Connection")).child(h_flex().gap(4).p(2).rounded(8).bg(t.background).border_1().border_color(t.border).w_full().max_w(260).child(choice("fetch", "Herdr (fetch)")).child(choice("curl", "curl"))).child(div().text_size(11).text_color(t.dim).child("Use curl if Jira's certificate isn't trusted by Herdr: curl uses this computer's certificates."))).when(this.transportChoice === "curl", (el) => el.child(this.field(t, "Company CA file", this.caInput, "Only if curl doesn't trust Jira's certificate either."))).child(this.field(t, "Start work message", this.taskInput, "What Claude gets first. {key} {summary} {url} {type} {status} {priority} {assignee} {description}; \\n for a new line. E.g. /init-ticket {key}")).child(this.preview(t)).when(Boolean(this.formError), (el) => el.child(div().text_size(12.5).text_color(t.blocked).child(this.formError))).child(h_flex().gap(8).pt(4).child(this.button(t, "jira-save", this.formBusy ? "Connecting\u2026" : first ? "Connect" : "Save", (cx) => this.saveForm(cx), { primary: true, enabled: !this.formBusy })).when(!first, (el) => el.child(this.button(t, "jira-cancel", "Cancel", (cx) => {
      this.editing = false;
      this.formError = null;
      cx.notify();
    }))).child(div().flex_1()).when(Boolean(this.jira?.token), (el) => el.child(this.button(t, "jira-disconnect", "Disconnect", (cx) => {
      this.editing = false;
      this.disconnect(cx);
    }, { tip: "Forget the token on this PC" })))).when(Boolean(this.jira?.problem), (el) => el.child(div().text_size(11.5).text_color(WARN).child(this.jira.problem))));
  }
  // What Start work would send for the open issue (else the first one listed), as typed.
  preview(t) {
    const issue = this.detail ?? this.rows[0];
    if (!issue) return div();
    const text = startWork(issue, this.taskInput.value())?.args.task ?? "";
    return v_flex().gap(4).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.border).child(div().text_size(11).text_color(t.dim).child(`Preview for ${issue.key}`)).children(text.split("\n").map((l) => div().text_size(12).text_color(t.muted).child(l || " ")));
  }
  problemView(t) {
    const p = this.problem;
    return v_flex().size_full().items_center().justify_center().p(24).child(v_flex().max_w(520).gap(10).items_center().child(div().text_size(16).font_semibold().child(p.message.split(". ")[0].replace(/\.$/, "") + ".")).when(p.message.includes(". "), (el) => el.child(div().text_size(12.5).text_color(t.muted).child(p.message.slice(p.message.indexOf(". ") + 2)))).child(div().text_size(12.5).text_color(t.dim).child(p.hint ?? "")).child(h_flex().gap(8).pt(8).child(this.button(t, "jira-retry", "Try again", (cx) => cx.spawn(async (cx2) => this.reload(cx2)), { primary: true })).when((p.kind === "tls" || p.kind === "offline") && this.jira?.settings.transport !== "curl", (el) => el.child(this.button(t, "jira-use-curl", "Switch to curl", (cx) => this.useCurl(cx)))).child(this.button(t, "jira-open-settings", "Settings", (cx) => this.openSettings(cx)))));
  }
  header(t) {
    const f = this.filter();
    const filters = this.filters();
    const view = shared2(VIEW_KEY) === "board" ? "board" : "list";
    const host = (() => {
      try {
        return new URL(this.jira.settings.baseUrl).host;
      } catch {
        return "";
      }
    })();
    const item = (x) => h_flex().id(`jira-filter-${x.id}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer().bg(x.id === f.id ? t.selected : t.popover).hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
      this.filterOpen = false;
      setShared2(FILTER_KEY, x.id);
      this.selected = null;
      this.detail = null;
      cx.spawn(async (cx2) => this.refresh(cx2));
    }).child(div().flex_1().min_w(0).truncate().child(x.name)).child(div().flex_none().text_size(11).text_color(t.dim).child(x.source === "favourite" ? "Jira" : x.source === "own" ? "mine" : ""));
    const picker = Popover.new("jira-filter").open(this.filterOpen).on_open_change((open, cx) => {
      this.filterOpen = open;
      cx.notify();
    }).trigger(h_flex().id("jira-filter-trigger").h(28).px(10).gap(6).items_center().rounded(7).border_1().border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover)).text_size(12.5).child(div().max_w(220).truncate().child(f.name)).child(svg("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim))).content(v_flex().id("jira-filter-list").w(300).max_h(360).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).children(filters.map(item)));
    const seg = (value, label) => h_flex().id(`jira-view-${value}`).h(24).px(9).items_center().rounded(5).text_size(12).cursor_pointer().on_click(() => setShared2(VIEW_KEY, value)).when(view === value, (el) => el.bg(t.raised ?? t.selected).text_color(t.foreground)).when(view !== value, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover))).child(label);
    const icon = (id, path, tip, onClick) => div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => onClick(cx)).child(svg(path).size(14));
    return h_flex().flex_none().h(52).px(16).gap(10).items_center().border_b(1).border_color(t.border).child(div().text_size(16).font_semibold().child("Jira")).child(div().text_size(12).text_color(t.dim).max_w(180).truncate().child(host)).child(picker).child(h_flex().id("jira-search").w(240).h(28).px(8).items_center().rounded(7).border_1().border_color(t.border).bg(t.background).child(Input.new(this.searchInput).flex_1().h_full().text_size(12.5).text_color(t.foreground))).child(div().flex_1()).child(div().text_size(11.5).text_color(t.dim).child(this.listLoading ? "loading\u2026" : this.fetchedAt ? `${countText(this.rows.length, this.total)} \xB7 updated ${ago(this.fetchedAt, Date.now())}` : "")).child(h_flex().p(2).gap(2).rounded(7).border_1().border_color(t.border).child(seg("list", "List")).child(seg("board", "Board"))).child(icon("jira-refresh", "mods/dock-jira/refresh.svg", "Refresh", (cx) => cx.spawn(async (cx2) => this.reload(cx2)))).child(icon("jira-gear", "mods/workspace-chrome/settings.svg", "Jira settings", (cx) => this.openSettings(cx)));
  }
  typeMark(t, r) {
    return div().flex_none().size(8).rounded(2).bg(TYPE_COLOR(t, r.type)).tooltip(r.type ?? "issue");
  }
  row(t, r, i) {
    const on = this.selected === r.key;
    const hot = r.priority === "Highest" || r.priority === "High";
    return h_flex().id(`jira-row-${r.key}`).h(34).px(16).gap(10).flex_none().items_center().cursor_pointer().bg(on ? t.selected : t.background).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.select(r.key, cx)).child(this.typeMark(t, r)).child(div().w(76).flex_none().text_size(12).text_color(t.dim).child(r.key)).child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(r.summary)).child(div().w(70).flex_none().truncate().text_size(11.5).text_color(hot ? WARN : t.dim).child(r.priority ?? "")).child(div().w(110).flex_none().truncate().text_size(11.5).text_color(r.assignee ? t.muted : t.dim).child(r.assignee ?? "Unassigned")).child(div().w(34).flex_none().text_size(11.5).text_color(t.dim).child(ago(r.updatedMs, Date.now()))).child(div().id(`jira-start-${r.key}`).size(24).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover((st) => st.bg(t.raised ?? t.hover).text_color(t.foreground)).tooltip(`Start work on ${r.key} (a Claude tab)`).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => {
      cx.stop_propagation();
      this.startWork(r);
    }).child(svg("mods/dock-jira/play.svg").size(11)));
  }
  more(t) {
    if (!Number.isFinite(this.total) || this.rows.length >= this.total) return null;
    return h_flex().px(16).py(10).child(this.button(
      t,
      "jira-more",
      `Load more (${this.total - this.rows.length} left)`,
      (cx) => cx.spawn(async (cx2) => this.refresh(cx2, { more: true })),
      { enabled: !this.listLoading }
    ));
  }
  listView(t) {
    const groups = groupByCategory(this.rows);
    const more = this.more(t);
    return v_flex().id("jira-list").flex_1().min_w(0).min_h(0).overflow_y_scrollbar().pb(16).children(groups.flatMap((g) => [
      h_flex().h(30).px(16).pt(8).gap(6).flex_none().items_center().child(div().text_size(11.5).font_medium().text_color(t.muted).child(g.title)).child(div().text_size(11.5).text_color(t.dim).child(String(g.rows.length))),
      ...g.rows.map((r, i) => this.row(t, r, i))
    ])).when(Boolean(more), (el) => el.child(more));
  }
  card(t, r) {
    const on = this.selected === r.key;
    return v_flex().id(`jira-card-${r.key}`).p(10).gap(6).flex_none().rounded(8).cursor_pointer().bg(on ? t.selected : t.surface ?? t.chrome).border_1().border_color(on ? t.accent : t.border).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.select(r.key, cx)).child(div().text_size(12.8).text_color(t.foreground).child(r.summary)).child(h_flex().gap(6).items_center().child(this.typeMark(t, r)).child(div().text_size(11.5).text_color(t.dim).child(r.key)).child(div().flex_1()).child(div().text_size(11).text_color(t.dim).max_w(110).truncate().child(r.assignee ?? "Unassigned")));
  }
  boardView(t) {
    const cols = boardColumns(this.rows, this.statusOrder);
    const more = this.more(t);
    return v_flex().flex_1().min_w(0).min_h(0).child(div().id("jira-board").flex().flex_row().flex_1().min_h(0).overflow_x_scrollbar().p(12).gap(12).children(cols.map((c, i) => v_flex().id(`jira-col-${i}`).w(280).flex_none().min_h(0).rounded(10).bg(t.chrome).border_1().border_color(t.border).child(h_flex().h(36).px(12).gap(6).flex_none().items_center().child(div().text_size(12).font_medium().text_color(t.muted).child(c.status)).child(div().text_size(11.5).text_color(t.dim).child(String(c.rows.length)))).child(v_flex().id(`jira-col-${i}-cards`).flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8).gap(6).children(c.rows.map((r) => this.card(t, r))))))).when(Boolean(more), (el) => el.child(more));
  }
  detailView(t) {
    const d = this.detail;
    const close = div().id("jira-detail-close").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close").on_click((_e, cx) => {
      this.selected = null;
      this.detail = null;
      cx.notify();
    }).child(svg("mods/workspace-chrome/x.svg").size(13));
    const pane = v_flex().id("jira-detail").w(DETAIL_W).flex_none().min_h(0).border_l(1).border_color(t.border).bg(t.background);
    const top = h_flex().h(44).px(16).gap(8).flex_none().items_center().border_b(1).border_color(t.border).child(div().text_size(12.5).text_color(t.dim).child(this.selected)).child(div().flex_1()).child(close);
    if (!d) {
      return pane.child(top).child(div().p(16).text_size(12.5).text_color(this.detailProblem ? t.blocked : t.dim).child(this.detailProblem ? `${this.detailProblem.message} ${this.detailProblem.hint}` : "Loading\u2026"));
    }
    const lines = (text) => (text ? text.split("\n") : []).map((l) => l.trim() ? div().child(l) : div().h(8));
    const meta = (label, value) => h_flex().gap(8).child(div().w(70).flex_none().text_color(t.dim).child(label)).child(div().flex_1().min_w(0).truncate().child(value ?? "\u2014"));
    return pane.child(top).child(v_flex().id("jira-detail-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(14).child(div().text_size(16).font_semibold().child(d.summary)).child(h_flex().gap(8).items_center().child(this.statusMenu(t, d)).when(canAssignToMe(d, this.me), (el) => el.child(this.button(
      t,
      "jira-assign",
      this.actionBusy === "assign" ? "Assigning\u2026" : "Assign to me",
      (cx) => this.assignMe(cx),
      { enabled: !this.actionBusy }
    ))).child(div().flex_1()).child(this.button(t, "jira-start", "Start work", () => this.startWork(d), { primary: true, tip: `Opens a Claude tab with:
${startWork(d, this.jira?.settings.startTask)?.args.task ?? ""}` })).child(this.button(t, "jira-open", "Open in browser", () => this.openUrl(d.url)))).when(Boolean(this.actionMsg) || this.actionBusy === "transition", (el) => el.child(this.actionLine(t))).child(v_flex().gap(4).text_size(12.5).child(meta("Type", d.type)).child(meta("Priority", d.priority)).child(meta("Assignee", d.assignee ?? "Unassigned")).child(meta("Reporter", d.reporter)).child(meta("Updated", d.updatedMs ? `${ago(d.updatedMs, Date.now())} ago` : null))).child(v_flex().gap(4).text_size(12.8).text_color(t.foreground).child(div().text_size(11.5).font_medium().text_color(t.muted).child("Description")).children(d.description ? lines(d.description) : [div().text_color(t.dim).child("No description.")])).when(d.links.length > 0, (el) => el.child(v_flex().gap(4).text_size(12.5).child(div().text_size(11.5).font_medium().text_color(t.muted).child("Links")).children(d.links.map((l, i) => h_flex().id(`jira-link-${i}`).gap(6).cursor_pointer().hover((s) => s.text_color(t.accent)).on_click(() => this.openUrl(l.url)).child(div().text_color(t.dim).child(l.label)).child(div().child(l.key)))))).child(v_flex().gap(10).child(div().text_size(11.5).font_medium().text_color(t.muted).child(d.commentTotal > d.comments.length ? `Comments \xB7 last ${d.comments.length} of ${d.commentTotal}` : `Comments \xB7 ${d.commentTotal}`)).children(d.comments.map((c) => v_flex().gap(3).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.border).text_size(12.5).child(h_flex().gap(6).child(div().font_medium().child(c.author)).child(div().text_color(t.dim).child(c.createdMs ? ago(c.createdMs, Date.now()) : ""))).children(lines(c.bodyText)))).child(v_flex().gap(6).child(div().rounded(8).border_1().border_color(t.border).bg(t.surface ?? t.chrome).px(10).py(8).child(Textarea.new(this.commentInput).w_full().text_size(12.5).text_color(t.foreground))).child(h_flex().gap(8).items_center().child(div().flex_1().text_size(11).text_color(t.dim).child("Ctrl+Enter sends")).child(this.button(
      t,
      "jira-comment-send",
      this.actionBusy === "comment" ? "Sending\u2026" : "Send",
      (cx) => this.sendComment(cx),
      { primary: true, enabled: !this.actionBusy }
    ))))));
  }
  // The status pill: a menu of the moves Jira allows from here (asked when it opens; workflows differ per issue).
  statusMenu(t, d) {
    const pill = h_flex().id("jira-status").h(24).px(8).gap(5).items_center().rounded(6).text_size(11.5).cursor_pointer().bg(d.category === "done" ? t.done : d.category === "indeterminate" ? t.accent : t.border).text_color(d.category === "new" ? t.foreground : t.accent_foreground ?? t.background).hover((st) => st.opacity(0.85)).tooltip("Change status").child(d.status ?? "").child(svg("mods/workspace-chrome/chevron-down.svg").size(11));
    const list = this.transitions;
    const rows = list === "loading" || list === null ? [div().p(8).text_color(t.dim).child("Asking Jira\u2026")] : list.problem ? [div().p(8).text_color(t.blocked).child(`${list.problem.message} ${list.problem.hint}`)] : !list.length ? [div().p(8).text_color(t.dim).child("No moves from this status.")] : list.map((tr) => h_flex().id(`jira-tr-${tr.id}`).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.doTransition(tr, cx)).child(div().flex_1().min_w(0).truncate().child(tr.name)).when(Boolean(tr.to?.name) && tr.to.name !== tr.name, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`\u2192 ${tr.to.name}`))));
    return Popover.new("jira-status-menu").open(this.transOpen).on_open_change((open, cx) => this.openTransitions(open, cx)).trigger(pill).content(v_flex().id("jira-tr-list").w(260).max_h(320).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).children(rows));
  }
  // What the last action did, in place: green when it worked, red when not (with the browser link for a step
  // Jira wants more for).
  actionLine(t) {
    const m = this.actionMsg;
    if (!m) return div().text_size(12).text_color(t.dim).child("Moving\u2026");
    return h_flex().gap(8).items_center().text_size(12).child(div().flex_1().text_color(m.ok ? t.done : t.blocked).child(m.message)).when(Boolean(m.link), (el) => el.child(this.button(t, "jira-action-link", "Open in browser", () => this.openUrl(m.link))));
  }
  render() {
    const t = theme();
    const state = checking() || !this.jira ? "setup" : pageState({ settings: this.jira.settings, token: this.jira.token, editing: this.editing, connected: this.connected, problem: this.problem, checking: this.checkingNow });
    const root = v_flex().id("dock-jira").size_full().min_h(0).bg(t.background).text_color(t.foreground);
    if (state === "setup" || state === "settings") return root.child(this.settingsForm(t, state === "setup"));
    if (state === "problem") return root.child(this.problemView(t));
    if (state === "checking") {
      return root.child(v_flex().size_full().items_center().justify_center().gap(6).child(div().text_size(14).child("Connecting to Jira\u2026")).child(div().text_size(12).text_color(t.dim).child(this.jira.settings.baseUrl)));
    }
    const view = shared2(VIEW_KEY) === "board" ? "board" : "list";
    const body = this.listProblem ? v_flex().flex_1().p(24).gap(6).child(div().text_size(13).text_color(t.blocked).child(this.listProblem.message)).child(div().text_size(12).text_color(t.dim).child(this.listProblem.hint)) : !this.rows.length && !this.listLoading ? v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(this.query ? `Nothing matches "${this.query}".` : "No issues in this filter.") : view === "board" ? this.boardView(t) : this.listView(t);
    return root.child(this.header(t)).child(div().flex().flex_row().flex_1().min_h(0).child(body).when(Boolean(this.selected), (el) => el.child(this.detailView(t))));
  }
};
export {
  Jira as default
};
