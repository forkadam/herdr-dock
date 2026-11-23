// The Jira page's view model (pure; no host imports): Jira REST v2 responses -> list rows, groups, board
// columns and an issue's detail; Jira wiki markup as plain text; problems sorted into what the page can say; the
// Start-work message.

const CATEGORIES = [
  { category: "new", title: "To do" },
  { category: "indeterminate", title: "In progress" },
  { category: "done", title: "Done" },
];
const RANK = Object.fromEntries(CATEGORIES.map((c, i) => [c.category, i]));
const time = (s) => {
  const t = Date.parse(s ?? "");
  return Number.isFinite(t) ? t : null;
};
const trimBase = (base) => String(base ?? "").replace(/\/+$/, "");
export const browseUrl = (base, key) => `${trimBase(base)}/browse/${key}`;

// One issue from a search (only ROW_FIELDS asked for) -> what a row or card shows. Missing fields are null; a
// status category Jira doesn't name (or "undefined") counts as To do. `project` is the key's prefix (WEB for WEB-41);
// `parent` is the sub-task's parent story or task (Jira sends none on any other issue).
export function issueRow(issue, base) {
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
    url: browseUrl(base, issue.key),
  };
}

// Rows -> [{ category, title, rows }] in To do, In progress, Done order, keeping the search's order inside a group.
export function groupByCategory(rows) {
  return CATEGORIES.map((c) => ({ ...c, rows: rows.filter((r) => r.category === c.category) })).filter((g) => g.rows.length);
}

// Rows -> one board column per status: [{ status, category, rows }], by category, then in Jira's status order
// (`order`: status names from GET /status), then in the order first seen. `statuses` ([{ name, category }], the
// workflow's statuses of the projects on the board) adds an empty column for each one no row has, so a board shows
// its whole workflow (Done too, when the filter lists only open issues).
export function boardColumns(rows, order = [], statuses = []) {
  const pos = (name) => { const i = order.indexOf(name); return i < 0 ? Infinity : i; };
  const cols = [];
  for (const r of rows) {
    const name = r.status ?? "No status";
    let col = cols.find((c) => c.status === name);
    if (!col) cols.push((col = { status: name, category: r.category, rows: [], seen: cols.length }));
    col.rows.push(r);
  }
  for (const st of statuses ?? []) {
    if (st?.name && !cols.some((c) => c.status === st.name)) cols.push({ status: st.name, category: st.category in RANK ? st.category : "new", rows: [], seen: cols.length });
  }
  return cols.sort((a, b) => RANK[a.category] - RANK[b.category] || (pos(a.status) - pos(b.status) || 0) || a.seen - b.seen)
    .map(({ seen, ...c }) => c);
}

// GET /issue/{key} -> the detail pane: the row, the description as text, the last 5 comments, links.
export function issueDetail(issue, base) {
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
    links,
  };
}

// Jira wiki markup -> readable plain text (v1 doesn't render markup).
export function wikiToText(markup) {
  if (typeof markup !== "string" || !markup) return "";
  let s = markup.replace(/\r\n?/g, "\n");
  // Blocks: keep what's inside, drop the markers (and a marker's own line break).
  s = s.replace(/\{(code|noformat)(?::[^}]*)?\}\n?([\s\S]*?)\n?\{\1\}/g, "$2");
  s = s.replace(/\{(quote|panel)(?::[^}]*)?\}([\s\S]*?)\{\1\}/g, "$2");
  s = s.replace(/\{color(?::[^}]*)?\}([\s\S]*?)\{color\}/g, "$1");
  s = s.replace(/^h[1-6]\.\s*/gm, "");
  s = s.replace(/\[~([^\]]+)\]/g, "@$1");
  s = s.replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$1 ($2)");
  s = s.replace(/\[((?:https?|mailto):[^\]]+)\]/g, "$1");
  s = s.replace(/\{\{([^}]*)\}\}/g, "$1");
  s = s.replace(/!([^!\s|]+)(?:\|[^!]*)?!/g, "[image: $1]");
  // Bold and italic only around words (so "2 * 3" stays).
  s = s.replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,:;!?])/gm, "$1$2");
  s = s.replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,:;!?])/gm, "$1$2");
  s = s.replace(/\\\\/g, "\n");
  // Lists: "# item" numbered per run of lines, "* item" bullets, deeper levels indented.
  const out = [];
  let n = 0;
  for (const line of s.split("\n")) {
    const num = /^(#+)\s+(.*)$/.exec(line);
    const dot = /^(\*+)\s+(.*)$/.exec(line);
    if (num) { n = num[1].length === 1 ? n + 1 : n; out.push(`${"  ".repeat(num[1].length - 1)}${num[1].length === 1 ? `${n}.` : "-"} ${num[2]}`); continue; }
    n = 0;
    if (dot) { out.push(`${"  ".repeat(dot[1].length - 1)}• ${dot[2]}`); continue; }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const TLS = /certificate|self[- ]signed|unable_to_verify|unknownissuer|\bssl\b|\btls\b|cert_|handshake/i;
// Herdr's fetch says only "error sending request for url (…)" for any failure to connect (refused, DNS, and also a
// certificate it rejects): it counts as offline, and the hint names the certificate too.
const OFFLINE = /econnrefused|enotfound|eai_again|getaddrinfo|\bdns\b|network|unreachable|connection refused|resolve host|failed to lookup|connect error|error sending request/i;
const TIMEOUT = /timed?\s?out|etimedout|timeout/i;
const CURL = { 6: "offline", 7: "offline", 28: "timeout", 35: "tls", 51: "tls", 53: "tls", 54: "tls", 58: "tls", 59: "tls", 60: "tls", 77: "tls", 80: "tls", 82: "tls", 83: "tls", 90: "tls", 91: "tls" };

const TEXT = {
  auth: ["Jira didn't accept the token.", "Connect again with a personal access token (Jira → Profile → Personal Access Tokens)."],
  forbidden: ["Jira says you don't have permission for this.", "Ask a Jira admin, or try it in the browser."],
  notfound: ["Jira couldn't find that.", "It may have been moved or deleted; refresh the list."],
  invalid: ["Jira refused the request.", "Check the filter's JQL, or do this step in the browser."],
  server: ["Jira had a server error.", "Try again in a minute."],
  offline: ["Can't reach Jira.", "Are you on the company network (or VPN)? If Jira opens in your browser, its certificate may not be trusted here: try the curl connection. It retries every 5 minutes."],
  tls: ["Jira's certificate isn't trusted here.", "Switch the connection to curl in Settings (it uses this computer's certificates)."],
  timeout: ["Jira took too long to answer.", "Try again; if it keeps happening, Jira may be overloaded."],
  unknown: ["Something went wrong talking to Jira.", "Try again; the details are below."],
};

// An error's text without URLs (a search URL is a wall of JQL) and without Herdr's "fetching <url> failed:" lead.
function shorten(text) {
  return String(text).replace(/^fetching \S+ failed:\s*/i, "").replace(/\(?https?:\/\/[^\s)]*\)?/g, "").replace(/\s{2,}/g, " ").trim().slice(0, 300);
}

// A response or a transport failure -> { kind, message, hint, fields? } for the page to show. Input: an HTTP answer
// { status, data } (data: Jira's { errorMessages, errors }), a fetch rejection { error: text }, or a curl failure
// { curlCode }. The message never includes request headers (so never the token).
export function classify({ status, data, error, curlCode } = {}) {
  let kind;
  if (Number.isInteger(curlCode)) kind = CURL[curlCode] ?? "unknown";
  else if (Number.isInteger(status)) {
    kind = status === 401 ? "auth" : status === 403 ? "forbidden" : status === 404 ? "notfound"
      : status >= 500 ? "server" : status >= 400 ? "invalid" : "unknown";
  } else {
    const e = String(error ?? "");
    kind = TLS.test(e) ? "tls" : OFFLINE.test(e) ? "offline" : TIMEOUT.test(e) ? "timeout" : "unknown";
  }
  const [base, hint] = TEXT[kind];
  const jira = [...(data?.errorMessages ?? []), ...Object.values(data?.errors ?? {})].filter((x) => typeof x === "string" && x);
  const detail = jira.length ? jira.join(" ") : kind === "unknown" ? shorten(error ?? (curlCode ? `curl exit ${curlCode}` : status ? `HTTP ${status}` : "")) : "";
  const out = { kind, message: detail ? `${base} ${detail}` : base, hint };
  const fields = Object.keys(data?.errors ?? {});
  if (fields.length) out.fields = fields;
  return out;
}

// The first message Start work gives Claude: the user's template with the issue filled in.
export const DEFAULT_START_TASK = "Work on Jira issue {key}: {summary}\n{url}";
const PLACEHOLDERS = ["key", "summary", "url", "type", "status", "priority", "assignee", "description"];
const DESCRIPTION_MAX = 2000;

export function startTask(template, detail) {
  // A one-line settings field can't hold a line break: "\n" typed there means one.
  const t = (typeof template === "string" && template.trim() ? template : DEFAULT_START_TASK).replace(/\\n/g, "\n");
  return t.replace(/\{(\w+)\}/g, (whole, name) => {
    if (!PLACEHOLDERS.includes(name)) return whole;
    let v = detail?.[name];
    v = v == null ? "" : String(v);
    if (name === "description" && v.length > DESCRIPTION_MAX) v = `${v.slice(0, DESCRIPTION_MAX - 1)}…`;
    return v;
  });
}

// Each search takes a number; only the newest one's answer is used (a slow old filter can't replace a new one).
export function latestOnly() {
  let n = 0;
  return { next: () => ++n, accept: (seq) => seq === n };
}

// "now", "5m", "3h", "4d", "2mo".
export function ago(ms, now) {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, now - ms) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (30 * 86400))}mo`;
}
