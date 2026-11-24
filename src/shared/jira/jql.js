// JQL and search URLs for the Jira page (pure; no host imports).

// The filters every Jira page has, before the user's favourite filters and their own.
export const BUILTIN_FILTERS = [
  { id: "mine", name: "Assigned to me", jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC" },
  { id: "reported", name: "Reported by me", jql: "reporter = currentUser() AND resolution = Unresolved ORDER BY updated DESC" },
  { id: "recent", name: "Recently viewed", jql: "issuekey in issueHistory() ORDER BY lastViewed DESC" },
];

// What a search asks for: just what a list row or a board card shows (`parent` only comes back on a sub-task).
export const ROW_FIELDS = ["summary", "status", "issuetype", "priority", "assignee", "updated", "parent"];

export const quote = (text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// The filter's JQL narrowed to issues mentioning `text` (Jira's full-text `text ~`), before any ORDER BY. A query
// with OR is put in parentheses first, so the text applies to all of it.
export function withSearch(jql, text) {
  const q = String(text ?? "").trim();
  const source = String(jql ?? "").trim();
  if (!q) return source;
  const m = /^(.*?)\s*\b(order\s+by\s+.+)$/is.exec(source);
  const where = (m ? m[1] : source).trim();
  const order = m ? ` ${m[2]}` : "";
  const scoped = /\bor\b/i.test(where.replace(/"(?:[^"\\]|\\.)*"/g, "")) ? `(${where})` : where;
  return `${scoped ? `${scoped} AND ` : ""}text ~ ${quote(q)}${order}`;
}

// GET /rest/api/2/search for one page of a filter (`expand`, e.g. "changelog", goes on the query only when given).
export function searchUrl(base, jql, { startAt = 0, maxResults = 50, fields = ROW_FIELDS, expand } = {}) {
  const params = new URLSearchParams({ jql, startAt: String(startAt), maxResults: String(maxResults), fields: fields.join(",") });
  if (expand) params.set("expand", expand);
  return `${String(base).replace(/\/+$/, "")}/rest/api/2/search?${params}`;
}
