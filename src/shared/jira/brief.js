// Today's brief, as a pure model (no host imports): what it asks Jira (your changed issues, the parents of your
// sub-tasks, your high-priority bugs), which description edits and sprint arrivals count as new, the read marks (and
// which a click reads), the lists it shows, the badge, a change's diff and the "check against my work" tab. The page
// does the fetching and drawing.
// Issues are Jira's REST ones with expand=changelog; Sprint = { id, name, state, startMs, endMs } (client.js sprints()).
// Marks = { [key]: { changed?: <time of the latest edit covered>, sprint?: <sprint id>, bug?: true } }.
import { lineDiff } from "./diff.js";
import { wikiToText } from "./model.js";

const MINUTE_MS = 60e3;
const DEFAULT_SINCE_MINUTES = 14 * 24 * 60;
const PARENTS_PER_SEARCH = 50;
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const list = (v) => (Array.isArray(v) ? v : []);
const isField = (item, name) => String(item?.field ?? "").toLowerCase() === name;
const timeOf = (v) => Date.parse(v);

// You, as the brief tells your doings from others': `me` is { key, name } (Jira's /myself), or a plain string taken as
// your name. Jira Server's history names a user by key (an assignee item's `from` / `to`: a key such as JIRAUSER10000,
// not the name, for users made since Jira 8), some Jira versions by name; a history's author carries both.
const ME = (me) => (me && typeof me === "object" ? { key: me.key, name: me.name } : { key: undefined, name: me });
const given = (v) => typeof v === "string" && v !== "";
// A history's author is you when its key is your key, or its name your name.
const byMe = (author, me) => {
  const { key, name } = ME(me);
  return (given(key) && author?.key === key) || (given(name) && author?.name === name);
};
// A user in a history item (an assignee's `to`) is you when it is your key, or your name.
const isMe = (user, me) => {
  const { key, name } = ME(me);
  return given(user) && (user === key || user === name);
};

// ---- what it asks Jira ----

// The brief looks back to the sprint's start (rounded up to a whole minute); 14 days without one.
export function sinceMinutes(sprint, now) {
  const start = sprint?.startMs;
  const minutes = Number.isFinite(start) ? Math.ceil((now - start) / MINUTE_MS) : 0;
  return minutes > 0 ? minutes : DEFAULT_SINCE_MINUTES;
}

// Your unresolved issues updated in the window, then the parents of your sub-tasks (50 keys a search). Only keys shaped
// like an issue key go into the list, so a malformed one can neither change the search nor fail the 49 others with it.
export function changedSearches({ since, parentKeys }) {
  const recent = `updated >= -${since}m`;
  const keys = [...new Set(list(parentKeys).filter((k) => typeof k === "string" && ISSUE_KEY.test(k)))];
  const searches = [`assignee = currentUser() AND resolution = Unresolved AND ${recent}`];
  for (let i = 0; i < keys.length; i += PARENTS_PER_SEARCH) {
    searches.push(`key in (${keys.slice(i, i + PARENTS_PER_SEARCH).join(",")}) AND ${recent}`);
  }
  return searches;
}

// Quoted values and the words that matter to a JQL's shape: "order by" ends the conditions, "or" needs grouping.
const JQL_TOKENS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\border\s+by\b|\bor\b/gi;

// A JQL as { where, order (from its ORDER BY on), hasOr (an OR among the conditions) }; quoted text is skipped.
function splitJql(jql) {
  let hasOr = false;
  for (const m of jql.matchAll(JQL_TOKENS)) {
    if (m[0][0] === '"' || m[0][0] === "'") continue;
    if (/^or$/i.test(m[0])) { hasOr = true; continue; }
    return { where: jql.slice(0, m.index).trim(), order: jql.slice(m.index).trim(), hasOr };
  }
  return { where: jql.trim(), order: "", hasOr };
}

const quoteName = (name) => `"${String(name).replace(/"/g, '\\"')}"`;

// The standing bug list narrowed to the high priorities. Its ORDER BY stays last, and an OR among its conditions is
// grouped so that the priority still narrows all of them. No priorities, no narrowing.
export function bugsSearch({ briefBugs, highPriorities }) {
  const names = list(highPriorities);
  if (!names.length) return briefBugs;
  const { where, order, hasOr } = splitJql(String(briefBugs ?? ""));
  const conditions = [...(where ? [hasOr ? `(${where})` : where] : []), `priority in (${names.map(quoteName).join(", ")})`];
  return `${conditions.join(" AND ")}${order ? ` ${order}` : ""}`;
}

// ---- Changed ----

// The description edits on an issue by someone other than you (`me`: by key or name), oldest first, as { at, author,
// from, to } (the text before and after, in Jira's markup; author is the display name when there is one).
export function descriptionEdits(issue, { me } = {}) {
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

// The unread description edits of an issue: those after the window's start and after what its read mark covers.
// `before` is the text ahead of the first of them and `after` the text the last one left, so 8 edits read as one
// change; `at` is the last one's time. null when there is no changelog or no such edit.
export function changedItem(issue, { me, sinceMs, marks } = {}) {
  if (!issue?.changelog) return null;
  const read = marks?.[issue.key]?.changed;
  const from = Math.max(Number.isFinite(sinceMs) ? sinceMs : 0, Number.isFinite(read) ? read : 0);
  const edits = descriptionEdits(issue, { me }).filter((e) => e.at > from);
  if (!edits.length) return null;
  const last = edits[edits.length - 1];
  return { key: issue.key, summary: issue.fields?.summary ?? "", edits, before: edits[0].from, after: last.to, at: last.at };
}

// ---- New in sprint ----

// A comma-separated sprint id list as text ids: "41, 42" -> ["41", "42"].
const sprintIds = (text) => String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// A Sprint history item that brought the issue into `id` (a text id): `id` is in `to` and wasn't in `from`, and it
// isn't a carry-over, which keeps every sprint `from` held ("41" -> "41, 42": the previous sprint closing). An issue
// moved from another sprint ("43" -> "42", a future one, say) was added.
function addedTo(item, id) {
  const from = sprintIds(item.from), to = sprintIds(item.to);
  if (!to.includes(id) || from.includes(id)) return false;
  return !(from.length && from.every((x) => to.includes(x)));
}

// How an issue came to be new in the sprint after it started, or null: its history `added` it to the sprint (addedTo:
// not a carry-over), it was `created` after the start, or its history `assigned` it to you after the start (to your key, as Jira Server writes
// it, or your name). When several apply, the first of those wins, and `at` is the latest time of that reason.
export function newInSprintItem(issue, { sprint, me } = {}) {
  const start = sprint?.startMs;
  if (!Number.isFinite(start)) return null;
  const at = {};
  const latest = (why, time) => { at[why] = Math.max(at[why] ?? 0, time); };
  for (const history of list(issue?.changelog?.histories)) {
    const time = timeOf(history?.created);
    if (!(time > start)) continue;
    for (const item of list(history?.items)) {
      if (isField(item, "sprint") && addedTo(item, String(sprint.id))) latest("added", time);
      else if (isField(item, "assignee") && isMe(item.to, me)) latest("assigned", time);
    }
  }
  const created = timeOf(issue?.fields?.created);
  if (created > start) at.created = created;
  const why = ["added", "created", "assigned"].find((w) => at[w] !== undefined);
  return why ? { key: issue.key, summary: issue.fields?.summary ?? "", why, at: at[why], sprintId: sprint.id } : null;
}

// ---- read marks and the badge ----

// What each kind of mark stores, and what makes an item read.
const MARK = {
  changed: { store: (item) => ({ changed: item.at }), covers: (mark, item) => mark?.changed >= item.at },
  sprint: { store: (item) => ({ sprint: item.sprintId }), covers: (mark, item) => mark?.sprint === item.sprintId },
  bug: { store: () => ({ bug: true }), covers: (mark) => mark?.bug === true },
};

// An item is unread until its kind's mark covers it: a later description edit, another sprint, or no mark at all.
export function isUnread(kind, item, marks) {
  return !MARK[kind]?.covers(marks?.[item.key], item);
}

// The marks with this item read (a new object; the key's other marks stay).
export function withRead(marks, kind, item) {
  return { ...marks, [item.key]: { ...marks?.[item.key], ...MARK[kind]?.store(item) } };
}

// The marks without the `bug` mark of bugs no longer on the list (so one that comes back reads as new again); a key
// with nothing left is dropped.
export function pruneBugs(marks, bugKeys) {
  const listed = new Set(list(bugKeys));
  const pruned = {};
  for (const [key, mark] of Object.entries(marks ?? {})) {
    if (!mark?.bug || listed.has(key)) { pruned[key] = mark; continue; }
    const { bug: _bug, ...rest } = mark;
    if (Object.keys(rest).length) pruned[key] = rest;
  }
  return pruned;
}

// The number of unread items across the three lists; `warn` while a bug is unread, else `info`; null when none.
export function briefBadge({ changed, sprint, bugs } = {}, marks) {
  const unread = (kind, items) => list(items).filter((item) => isUnread(kind, item, marks)).length;
  const bugCount = unread("bug", bugs);
  const count = unread("changed", changed) + unread("sprint", sprint) + bugCount;
  return count ? { count, tone: bugCount ? "warn" : "info" } : null;
}

// ---- the page's lists, and what a click marks read ----

// What the brief shows: Changed and New in sprint, unread items only, newest first; every high-priority bug, each with
// `unread`, the unread ones first (otherwise in the search's order).
export function briefLists({ changed, sprint, bugs } = {}, marks) {
  const unread = (kind) => (item) => isUnread(kind, item, marks);
  const newest = (a, b) => (b.at ?? 0) - (a.at ?? 0);
  const all = list(bugs).map((item) => ({ ...item, unread: isUnread("bug", item, marks) }));
  return {
    changed: list(changed).filter(unread("changed")).sort(newest),
    sprint: list(sprint).filter(unread("sprint")).sort(newest),
    bugs: [...all.filter((b) => b.unread), ...all.filter((b) => !b.unread)],
  };
}

// The marks with every unread item of `kinds` that `pick` keeps read; the same object when there was none.
function readEach(marks, brief, pick) {
  let out = marks ?? {};
  for (const [kind, items] of [["changed", brief?.changed], ["sprint", brief?.sprint], ["bug", brief?.bugs]]) {
    for (const item of list(items)) if (pick(kind, item) && isUnread(kind, item, out)) out = withRead(out, kind, item);
  }
  return out;
}

// An issue opened (its detail, from the brief, the board or any list): its New-in-sprint and bug items have nothing
// more to read, so they are read. Its Changed item stays unread until Mark read (the diff is read, then checked against
// your work). The same object when nothing changed.
export const readOnOpen = (marks, brief, key) => readEach(marks, brief, (kind, item) => kind !== "changed" && item.key === key);

// Mark all read: every unread item of the three lists (the same object when nothing was unread).
export const readAll = (marks, brief) => readEach(marks, brief, () => true);

// ---- reading a change ----

// The description's line diff as the detail shows it: Jira markup as text on both sides, and a trailing empty line
// dropped from each (a final line break would otherwise read as a removed empty line).
export function changeDiff(before, after) {
  const text = (markup) => wikiToText(markup).replace(/\n$/, "");
  return lineDiff(text(before), text(after));
}

// The description edits of an issue's history (client.js issueHistory's histories) by someone other than you, after
// `sinceMs`, newest first: the detail's Recent changes, read or not.
export function recentEdits(histories, { me, sinceMs } = {}) {
  const from = Number.isFinite(sinceMs) ? sinceMs : 0;
  return descriptionEdits({ changelog: { histories } }, { me }).filter((e) => e.at > from).reverse();
}

// "2 edits by Ana, Nov 19 15:46–15:54": how many edits, by whom (each name once, as they first edited) and, unless
// `when` is false, when (local time).
export function editsText(edits, { when = true } = {}) {
  const all = list(edits);
  const names = [...new Set(all.map((e) => e?.author).filter(Boolean))];
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const span = when ? whenText(all) : "";
  return `${all.length} edit${all.length === 1 ? "" : "s"}${who ? ` by ${who}` : ""}${span ? `, ${span}` : ""}`;
}

// ---- Check against my work ----

// Your sub-tasks by parent key, from a search's issues (with the `parent` field): Map parent key -> [sub-task keys],
// each list in key order (WEB-9 before WEB-10), whatever order the search had.
export function subtasksByParent(issues) {
  const out = new Map();
  for (const issue of list(issues)) {
    const parent = issue?.fields?.parent?.key;
    if (typeof parent !== "string" || !parent || typeof issue.key !== "string") continue;
    if (!out.has(parent)) out.set(parent, []);
    if (!out.get(parent).includes(issue.key)) out.get(parent).push(issue.key);
  }
  for (const keys of out.values()) keys.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return out;
}

// The Herdr command "Check against my work" runs (Start work's way): a tab "<key> check" running Claude, whose first
// message is checkMessage's, with {mine} your sub-tasks under the issue (`subtasks`, subtasksByParent's) when it is
// their parent, else the issue itself. Null without an item.
export function checkWork(item, { template, subtasks } = {}) {
  if (!item?.key) return null;
  const own = subtasks?.get?.(item.key);
  const mine = Array.isArray(own) && own.length ? own : [item.key];
  const task = checkMessage(template, { key: item.key, summary: item.summary, edits: item.edits, mine });
  return { command: "tab.new", args: { name: `${item.key} check`, argv: ["claude"], task } };
}

// ---- the check message ----

const day = (date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const clock = (date) => date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// The span of the edits in local time: "Nov 19 15:46–15:54" (one time when it is one minute) on one day, else
// "Nov 12 – Nov 19".
function whenText(edits) {
  const times = list(edits).map((e) => e?.at).filter(Number.isFinite);
  if (!times.length) return "";
  const first = new Date(Math.min(...times)), last = new Date(Math.max(...times));
  if (first.toDateString() !== last.toDateString()) return `${day(first)} – ${day(last)}`;
  return clock(first) === clock(last) ? `${day(first)} ${clock(first)}` : `${day(first)} ${clock(first)}–${clock(last)}`;
}

// The first message of the Claude tab for "Check against my work": the template with {key}, {summary}, {when} and
// {mine} filled in (other {words} stay). It names the issue and when it changed, never the description's text.
export function checkMessage(template, { key, summary, edits, mine }) {
  const values = { key, summary, when: whenText(edits), mine: list(mine).join(", ") };
  return String(template ?? "").replace(/\{(\w+)\}/g, (whole, name) => (Object.hasOwn(values, name) ? String(values[name] ?? "") : whole));
}
