// The Jira page's decisions (pure; no host imports): which filters it offers, when it polls, what it shows.
import { matchAction } from "./actions.js";
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
// failure no sooner than 5 minutes; never while the shown tab is still `loading` (its first load has no `lastAt` yet,
// and a poll then would start that load over and over). A manual refresh doesn't ask.
export function pollDue({ shown, lastAt, failed, now, loading = false }) {
  if (loading) return false;
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

// The template Start work sends for this issue: the `start` of the first action rule that matches it, else the
// fallback (the settings' own Start-work message, which may be empty: startTask then uses its default).
export const startTemplate = (rules, issue, fallback) => matchAction(rules, issue).start ?? fallback;

// The Herdr command Finish runs: as Start work, a Claude tab (named "<key> finish") whose first message is the
// matched rule's `finish`. Null when no rule gives one (the page then shows no Finish). Changes nothing in Jira.
export function finishWork(issue, rules) {
  const finish = matchAction(rules, issue).finish;
  if (!issue?.key || !finish) return null;
  return { command: "tab.new", args: { name: `${issue.key} finish`, argv: ["claude"], task: startTask(finish, issue) } };
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

// A hidden tab's count-only search that failed: "page" when the token was rejected or forbidden (afterProblem then
// pauses polling and clears the badge), else "tab": only that tab's count is marked ("!"). The shown tab's own search
// is what tells whether Jira can be reached at all.
export const countFailure = (kind) => (kind === "auth" || kind === "forbidden" ? "page" : "tab");

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

// ---- Board columns from the projects' workflows ----

// The projects on the board, from its issues' keys (PROJ-123), each once, in order.
export const boardProjects = (rows) => [...new Set((rows ?? []).map((r) => String(r.key ?? "").split("-")[0]).filter(Boolean))];

// Several projects' statuses ([{ name, category }] each; anything else skipped) as one list, each status once.
export function unionStatuses(lists) {
  const seen = new Map();
  for (const list of lists ?? []) if (Array.isArray(list)) for (const st of list) if (st?.name && !seen.has(st.name)) seen.set(st.name, st);
  return [...seen.values()];
}

// The empty workflow columns of the board: one project's whole workflow when every issue is from that project, else
// none (14 projects' workflows would run the board off the screen; a drag still adds what its card can reach).
// `statusesByProject` maps a project key to its statuses, or "loading" while they are being asked.
export function workflowStatuses(rows, statusesByProject) {
  const projects = boardProjects(rows);
  return projects.length === 1 ? unionStatuses([statusesByProject?.get(projects[0])]) : [];
}

// Said in the column a card was dropped on when its workflow has no move there (the drop did nothing, on purpose).
export function refusedDropText(key, from, to, targets) {
  const allowed = targets ? [...targets] : [];
  if (!allowed.length) return `${key} can't move from ${from}.`;
  return `${key} can't go to ${to} from ${from}. Its workflow allows: ${allowed.join(", ")}.`;
}

// ---- Steps that ask for fields ----

// What a transition asks before it can run (its `fields`, from expand=transitions.fields):
//   { kind: "none" }                       nothing required: run it
//   { kind: "pick", fields: [{ key, name, options }] }   one required field with Jira's allowed values (Resolution)
//   { kind: "browser", names }             anything else required (free text, several fields): do it in Jira
export function stepNeeds(transition) {
  const required = Object.entries(transition?.fields ?? {}).filter(([, f]) => f?.required);
  if (!required.length) return { kind: "none" };
  const pickable = required.filter(([, f]) => Array.isArray(f.allowedValues) && f.allowedValues.length);
  if (required.length === 1 && pickable.length === 1) {
    const [key, f] = pickable[0];
    return { kind: "pick", fields: [{ key, name: f.name ?? key, options: f.allowedValues.map((v) => ({ id: v.id, name: v.name ?? v.value ?? String(v.id) })) }] };
  }
  // Name what the page can't fill in (else, when several are pickable, all of them).
  const blocking = required.filter((r) => !pickable.includes(r));
  return { kind: "browser", names: (blocking.length ? blocking : required).map(([key, f]) => f.name ?? key) };
}

// The `fields` a move posts for the value picked (by id when Jira gave one).
export const stepFields = (key, option) => ({ [key]: option.id != null ? { id: option.id } : { name: option.name } });

// The board's rows with the cards just moved kept in their new status (a move to Done takes an issue out of an
// "unresolved" filter, and a card that just vanishes reads as "nothing happened"). `moved`: key -> moved row.
export function keepMoved(rows, moved) {
  if (!moved?.size) return rows;
  const have = new Set(rows.map((r) => r.key));
  return [...rows.map((r) => (moved.has(r.key) ? { ...r, ...moved.get(r.key) } : r)), ...[...moved.values()].filter((m) => !have.has(m.key))];
}
