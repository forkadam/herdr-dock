// The Jira page's tab model (pure; no host imports): which tabs the page shows, which one is picked, how a tab's
// rows are split into sections, and the count written on a tab.
import { BUILTIN_FILTERS } from "./jql.js";
import { groupByCategory } from "./model.js";
import { HIDDEN_EVERY_MS, countFailure } from "./page.js";
import { attentionJql, needsAttention, severitySections } from "./severity.js";

// What the All tab searches: everything assigned to me, resolved or not.
export const ALL_JQL = "assignee = currentUser() ORDER BY updated DESC";

// Tab = { id, name, kind: "today"|"search", jql: string|null, group: "type"|"severity"|null, filters: boolean,
// button: { label, task }|null, severity: { field, levels, unrated }|null }.
// `filters`: whether the tab has the filter menu (All: it searches the filter picked there, tabFilters).
// `button`: the one button the tab's header carries, which opens Claude with `task` (tabButtonWork); only a view gives one.
// `severity`: the Jira field that rates the tab's tickets and its levels (severity.js's parseSeverity); only a view gives one.
const TODAY = { id: "today", name: "Today", kind: "today", jql: null, group: null, filters: false, button: null, severity: null };
const MINE = { id: "mine", name: "Mine", kind: "search", jql: BUILTIN_FILTERS[0].jql, group: null, filters: false, button: null, severity: null };
const ALL = { id: "all", name: "All", kind: "search", jql: ALL_JQL, group: null, filters: true, button: null, severity: null };

const fromView = (v) => ({ id: v.id, name: v.name, kind: "search", jql: v.jql, group: v.group, filters: false, button: v.button ?? null, severity: v.severity ?? null });

// The tabs, left to right: Today (when `today`), the user's views, Mine, All. A view with the id `mine` or `all`
// replaces that built-in's name, jql, group, button and severity where the built-in stands; the built-in keeps its `filters`.
export function tabList(views, { today } = {}) {
  const own = (id) => views.find((v) => v.id === id);
  const builtin = (tab) => {
    const v = own(tab.id);
    return v ? { ...tab, name: v.name, jql: v.jql, group: v.group, button: v.button ?? null, severity: v.severity ?? null } : tab;
  };
  return [
    ...(today ? [TODAY] : []),
    ...views.filter((v) => v.id !== MINE.id && v.id !== ALL.id).map(fromView),
    builtin(MINE),
    builtin(ALL),
  ];
}

// The remembered tab, else the first (the one remembered may have left the settings).
export const pickTab = (tabs, id) => tabs.find((t) => t.id === id) ?? tabs[0];

// The id of the tab after (dir 1) or before (dir -1) the one picked, wrapping around at either end.
export function stepTab(tabs, id, dir) {
  const at = Math.max(0, tabs.findIndex((t) => t.id === id));
  return tabs[(at + dir + tabs.length) % tabs.length].id;
}

// Rows -> [{ title, parts }]. No group: one section over every row, with no title. "type": one section per issue type
// in the order each first appears (rows with no type under "Other"). `parts` is groupByCategory's: To do, In
// progress, Done.
export function sectionsFor(rows, group) {
  if (group !== "type") return [{ title: null, parts: groupByCategory(rows) }];
  const types = new Map();
  for (const row of rows) {
    const title = row.type || "Other";
    if (!types.has(title)) types.set(title, []);
    types.get(title).push(row);
  }
  return [...types].map(([title, list]) => ({ title, parts: groupByCategory(list) }));
}

// A tab's list: { attention, sections }. A tab grouped by severity (group "severity" with a severity block):
// severitySections' (`attention`, the sections of the box above the rest), the box left out (null) when no level asks
// for attention. Any other: no box (null) and sectionsFor's.
export function listSections(rows, tab) {
  if (tab.group !== "severity" || !tab.severity) return { attention: null, sections: sectionsFor(rows, tab.group) };
  const { attention, sections } = severitySections(rows, tab.severity);
  return { attention: tab.severity.levels.some((l) => l.attention) ? attention : null, sections };
}

// The count on a tab: "" until it is known, "!" when its search failed, else the number, "99+" past 99. A tab
// reloading keeps the count it had.
export function tabCountText({ total, problem } = {}) {
  if (problem) return "!";
  if (!Number.isFinite(total)) return "";
  return total > 99 ? "99+" : String(total);
}

// How a tab's count is drawn: "problem" while its search failed, "attention" when some of its tickets are at an
// attention level (`attention`, the number of them), else "plain". `count` is { total, problem, attention }.
export const countTone = (count) => (count?.problem ? "problem" : count?.attention > 0 ? "attention" : "plain");

// The tip on a tab's count when tickets need attention ("1 needs attention now", "<n> need attention now"), else null.
export const attentionTip = (count) => (count?.attention > 0 ? needsAttention(count.attention) : null);

// The tip on a tab: why its search failed, else attentionTip's, else null.
export const countTip = (count) => (count?.problem ? `${count.problem.message} ${count.problem.hint ?? ""}`.trim() : attentionTip(count));

// What a failed attention search does: "page" for a rejected or forbidden token (countFailure); "rejected" when Jira
// refused the search itself (kind "invalid": a value no option has, a wrong field), said in the tab until that search
// changes or one succeeds; else "quiet" (a slow or failing Jira: the count stays as it was, nothing said).
export const attentionFailure = (kind) => (countFailure(kind) === "page" ? "page" : kind === "invalid" ? "rejected" : "quiet");

// The message of a tab's rejected attention search (`rejection`: { jql, message }), while the tab still asks that
// search (`jql`: its attention search now); else null.
export const attentionRejected = (rejection, jql) => (rejection && jql != null && rejection.jql === jql ? rejection.message : null);

// The search for a tab's tickets that need attention now: attentionJql over `jql` (what the tab searches, before its
// search text: the count ignores that); null for a tab without severity, or none of whose levels asks for attention.
export const tabAttentionJql = (tab, jql) => (tab.severity ? attentionJql(jql, tab.severity) : null);

// A tab's new count (`count`: its total, or its problem) keeping the attention number of the one before (`before`)
// until the tab's own attention search answers again; none kept for a tab with no attention search (`attends` false).
export const keepAttention = (before, count, attends) =>
  (attends && Number.isFinite(before?.attention) ? { ...count, attention: before.attention } : count);

// A tab's count with the attention search's answer (`n`, its total) on it; no count (the tab's count started over) or
// no number leaves it as it is.
export const withAttention = (count, n) => (count && Number.isFinite(n) ? { ...count, attention: n } : count);

// A tab's count without its attention number (its severity changed: asked again), the rest kept; no count stays none.
export function dropAttention(count) {
  if (!count || !("attention" in count)) return count;
  const { attention: _dropped, ...rest } = count;
  return rest;
}

// After the settings file changed, what becomes of a tab, from what it was (`before`, undefined for a new one) and is
// (`after`): "restart" when its search changed (its list and count start over), "research" when only its severity
// did, added, removed or edited (its rows are searched again, its search text and open issue kept, and its attention
// number asked again), else "keep".
export function tabReload(before, after) {
  if (!before || before.jql !== after.jql) return "restart";
  return JSON.stringify(before.severity ?? null) === JSON.stringify(after.severity ?? null) ? "keep" : "research";
}

// Today's count (for tabCountText): the brief's unread items (`badge`, briefBadge's; null: none), with the first of
// `problems` (its board's, then its brief's) while one stands, so its tab reads "!" as a tab whose search failed does.
export function todayCount(badge, problems) {
  const problem = (Array.isArray(problems) ? problems : []).find(Boolean);
  return problem ? { total: badge?.count, problem } : { total: badge?.count };
}

// The tabs whose counts are due: every searching tab but the shown one (its own search counts it), once
// HIDDEN_EVERY_MS has passed since the last round, and at once when there was none.
export function countsDue(tabs, shownId, lastAt, now) {
  if (Number.isFinite(lastAt) && now - lastAt < HIDDEN_EVERY_MS) return [];
  return tabs.filter((t) => t.id !== shownId && t.kind === "search");
}

// A tab's List / Board: its own choice, else the one the page had before tabs, else the list.
export function tabLayout(own, before) {
  const pick = own === "list" || own === "board" ? own : before;
  return pick === "board" ? "board" : "list";
}

// The filter menu on a tab with `filters` (All): the tab's own search first ("All my issues", or the name of a view
// that replaced it), then `list` (filterList's).
export const tabFilters = (tab, list) => [{ id: tab.id, name: tab.jql === ALL_JQL ? "All my issues" : tab.name, jql: tab.jql, source: "builtin" }, ...list];
