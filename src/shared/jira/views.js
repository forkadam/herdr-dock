// The Jira page's tab model (pure; no host imports): which tabs the page shows, which one is picked, how a tab's
// rows are split into sections, and the count written on a tab.
import { BUILTIN_FILTERS } from "./jql.js";
import { groupByCategory } from "./model.js";
import { HIDDEN_EVERY_MS } from "./page.js";

// What the All tab searches: everything assigned to me, resolved or not.
export const ALL_JQL = "assignee = currentUser() ORDER BY updated DESC";

// Tab = { id, name, kind: "today"|"search", jql: string|null, group: "type"|null, filters: boolean,
// button: { label, task }|null }.
// `filters`: whether the tab has the filter menu (All: it searches the filter picked there, tabFilters).
// `button`: the one button the tab's header carries, which opens Claude with `task` (tabButtonWork); only a view gives one.
const TODAY = { id: "today", name: "Today", kind: "today", jql: null, group: null, filters: false, button: null };
const MINE = { id: "mine", name: "Mine", kind: "search", jql: BUILTIN_FILTERS[0].jql, group: null, filters: false, button: null };
const ALL = { id: "all", name: "All", kind: "search", jql: ALL_JQL, group: null, filters: true, button: null };

const fromView = (v) => ({ id: v.id, name: v.name, kind: "search", jql: v.jql, group: v.group, filters: false, button: v.button ?? null });

// The tabs, left to right: Today (when `today`), the user's views, Mine, All. A view with the id `mine` or `all`
// replaces that built-in's name, jql, group and button where the built-in stands; the built-in keeps its `filters`.
export function tabList(views, { today } = {}) {
  const own = (id) => views.find((v) => v.id === id);
  const builtin = (tab) => {
    const v = own(tab.id);
    return v ? { ...tab, name: v.name, jql: v.jql, group: v.group, button: v.button ?? null } : tab;
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

// The count on a tab: "" until it is known, "!" when its search failed, else the number, "99+" past 99. A tab
// reloading keeps the count it had.
export function tabCountText({ total, problem } = {}) {
  if (problem) return "!";
  if (!Number.isFinite(total)) return "";
  return total > 99 ? "99+" : String(total);
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
