// The Jira page's decisions (pure; no host imports): which filters it offers, when it polls, what it shows.
import { BUILTIN_FILTERS } from "./jql.js";
import { DEFAULT_START_TASK, startTask, wikiToText } from "./model.js";

export const SHOWN_EVERY_MS = 2 * 60e3;
export const HIDDEN_EVERY_MS = 10 * 60e3;
export const RETRY_AFTER_MS = 5 * 60e3;
export const PAGE_SIZE = 50;

// Built-ins, then Jira's favourite filters, then the user's own (settings), each { id, name, jql, source }.
// Ids are stable across restarts so the chosen filter can be remembered: "fav:<jira id>", "own:<index>:<name>".
export function filterList(favourites, own) {
  const out = BUILTIN_FILTERS.map((f) => ({ ...f, source: "builtin" }));
  for (const f of Array.isArray(favourites) ? favourites : []) {
    if (f && typeof f.jql === "string" && f.jql.trim() && f.name) out.push({ id: `fav:${f.id}`, name: String(f.name), jql: f.jql, source: "favourite" });
  }
  (Array.isArray(own) ? own : []).forEach((f, i) => {
    if (f?.name && f?.jql) out.push({ id: `own:${i}:${f.name}`, name: f.name, jql: f.jql, source: "own" });
  });
  return out;
}

// The remembered filter if it still exists, else Assigned to me.
export const pickFilter = (filters, id) => filters.find((f) => f.id === id) ?? filters[0];

// Whether a poll is due: every 2 minutes while the page shows, every 10 while hidden (for the Pages badge); after a
// failure no sooner than 5 minutes. A manual refresh doesn't ask.
export function pollDue({ shown, lastAt, failed, now }) {
  if (!Number.isFinite(lastAt)) return true;
  const every = failed ? Math.max(RETRY_AFTER_MS, shown ? SHOWN_EVERY_MS : HIDDEN_EVERY_MS) : shown ? SHOWN_EVERY_MS : HIDDEN_EVERY_MS;
  return now - lastAt >= every;
}

// What the page shows: "setup" (no address or token), "settings" (the form, opened by hand), "checking" (first
// contact), "problem" (can't talk to Jira at all), or "ready".
export function pageState({ settings, token, editing, connected, problem, checking }) {
  if (editing) return "settings";
  if (!settings?.baseUrl || !token) return "setup";
  if (problem) return "problem";
  if (checking || !connected) return "checking";
  return "ready";
}

// How many issues a refresh asks for: at least a page, and as many as are already listed (after Load more), so a
// poll or an action never shrinks the list under the reader. Capped so one refresh stays one modest request.
export const REFRESH_CAP = 200;
export const refreshSize = (loaded) => Math.min(REFRESH_CAP, Math.max(PAGE_SIZE, Number.isFinite(loaded) ? loaded : 0));

// The Pages badge: how many issues are assigned to me and unresolved (null when not connected).
export const badgeFor = (count) => (Number.isFinite(count) ? { count, tone: "info" } : null);

// The search's paging text: "12 issues", "50 of 120".
export function countText(shown, total) {
  if (!Number.isFinite(total)) return "";
  if (shown >= total) return `${total} issue${total === 1 ? "" : "s"}`;
  return `${shown} of ${total}`;
}

// ---- Actions ----

// Assign to me: offered unless the issue is already mine (and only once Jira has said who I am).
export function canAssignToMe(detail, me) {
  if (!detail || !me?.name) return false;
  return String(detail.assigneeName ?? "").toLowerCase() !== String(me.name).toLowerCase();
}

const DONE = { assign: "Assigned to you.", comment: "Comment added." };

// An action's result -> { ok, message, link? } for the detail pane. `extra`: { to } (the transition's target
// status), { url } (the issue in the browser, for a step Jira wants more for).
export function actionOutcome(kind, result, extra = {}) {
  if (result?.ok) return { ok: true, message: kind === "transition" ? `Moved to ${extra.to ?? "the new status"}.` : DONE[kind] ?? "Done." };
  const p = result?.problem ?? { message: "Something went wrong.", hint: "" };
  if (kind === "transition" && p.fields?.length) {
    return { ok: false, message: `Jira wants more for this step (${p.fields.join(", ")}): open it in the browser.`, link: extra.url };
  }
  return { ok: false, message: [p.message, p.hint].filter(Boolean).join(" ") };
}

export const commentReady = (text) => String(text ?? "").trim().length > 0;

// The detail with a comment Jira just created (POST /comment's answer) added, without fetching the issue again.
export function withComment(detail, comment) {
  const added = { id: comment.id, author: comment.author?.displayName ?? "you", bodyText: wikiToText(comment.body), createdMs: Date.parse(comment.created ?? "") || null };
  return { ...detail, comments: [...detail.comments, added].slice(-5), commentTotal: (detail.commentTotal ?? detail.comments.length) + 1 };
}

// ---- Start work ----

// The Herdr command Start work runs: a tab named after the issue, running Claude, whose first message is the user's
// template filled in (a list row works too: fields it lacks are empty). Null without an issue.
export function startWork(issue, template) {
  if (!issue?.key) return null;
  return { command: "tab.new", args: { name: issue.key, argv: ["claude"], task: startTask(template, issue) } };
}

// Whether Start work needs the full issue first: a list row has no description, so a template that uses it would
// otherwise send it empty (the detail's button already has it).
export function needsDetail(template) {
  const t = typeof template === "string" && template.trim() ? template : DEFAULT_START_TASK;
  return /\{description\}/.test(t);
}

// ---- After a problem, and starting over ----

// What a failed request means for the page. A rejected or forbidden token clears the badge and stops polling until
// the user acts (Connect again, Try again): retrying the same token every 5 minutes can't succeed and can lock an
// account. Anything else (offline, a server error, a timeout) keeps the connection and retries on the poll.
export function afterProblem(kind) {
  const token = kind === "auth" || kind === "forbidden";
  return { connected: !token, clearBadge: token, pause: token };
}

// The Start-work message for a preview or a tooltip: as it will be sent, except that a list row's missing
// description is named rather than shown empty (Start work fetches it).
export function previewTask(issue, template) {
  if (!issue?.key) return "";
  const shown = !("description" in issue) && needsDetail(template) ? { ...issue, description: "(its description, fetched when you start)" } : issue;
  return startWork(shown, template)?.args.task ?? "";
}

// The view state a new Jira address or Disconnect forgets (copy it before assigning: its arrays are shared).
export const CLEARED_VIEW = Object.freeze({
  me: null, rows: [], total: undefined, fetchedAt: null, listProblem: null, selected: null, detail: null, detailProblem: null,
  favourites: [], statusOrder: [], transitions: null, transOpen: false, actionMsg: null,
});

// ---- Board drag and drop ----
// What a card can be dropped on comes from Jira, not from a guess: GET /issue/{key}/transitions, asked when the drag
// starts, lists the moves this issue's workflow allows for this user right now.

// How far (px) the pointer moves after a press before it is a drag: less than that, it's a click (open the issue).
export const DRAG_START_PX = 5;
export function dragStarted(from, to) {
  if (!from || !to) return false;
  return Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_START_PX;
}

// The statuses this issue can move to now, as a Set of names (never its own).
export function dropTargets(transitions, current) {
  if (!Array.isArray(transitions)) return new Set();
  return new Set(transitions.map((t) => t?.to?.name).filter((name) => name && name !== current));
}

// A drop on `status`: { kind: "run", transition } when one move leads there, { kind: "choose", transitions } when
// several do (e.g. Resolve and Close both into Done), { kind: "none" } when none does or it's the card's own column.
export function dropPlan(transitions, status, current) {
  if (!Array.isArray(transitions) || status === current) return { kind: "none" };
  const ways = transitions.filter((t) => t?.to?.name === status);
  if (!ways.length) return { kind: "none" };
  return ways.length === 1 ? { kind: "run", transition: ways[0] } : { kind: "choose", transitions: ways };
}

const RANK = { new: 0, indeterminate: 1, done: 2 };

// The board while dragging: each reachable status without a column (no issue in this filter has it) gets an empty,
// temporary one, placed by status category, then Jira's status order (`order`), then as listed. Not dragging: as is.
export function dragColumns(cols, targets, transitions, order = []) {
  if (!targets?.size) return cols;
  const have = new Set(cols.map((c) => c.status));
  const extra = [...targets].filter((name) => !have.has(name)).map((name) => {
    const cat = (transitions ?? []).find((t) => t?.to?.name === name)?.to?.statusCategory?.key;
    return { status: name, category: cat in RANK ? cat : "indeterminate", rows: [], temporary: true };
  });
  if (!extra.length) return cols;
  const pos = (name) => { const i = order.indexOf(name); return i < 0 ? Infinity : i; };
  return [...cols, ...extra]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (RANK[a.c.category] ?? 1) - (RANK[b.c.category] ?? 1) || (pos(a.c.status) - pos(b.c.status) || 0) || a.i - b.i)
    .map(({ c }) => c);
}
