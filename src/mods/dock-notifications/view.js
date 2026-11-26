// The notification history as rows to draw (pure; no host imports).
import { formatAge } from "../../shared/claude.js";
import { FILTERS, matchesFilter, notifyType } from "../../shared/notify.js";

// formatAge's text without " ago": "just now", "5m", "2h", "3d".
const when = (ms) => formatAge(Math.max(0, ms)).replace(/ ago$/, "");

// One row per history item (historyOf's items), in the history's order (newest first). type and needsNow drive the
// filter chips; matchesFilter reads them through the row's needs/resolved/action, the same rule dock-core clears by.
export function notificationRows(list, now) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => ({
    id: x.id, title: x.title ?? "", body: x.body ?? "", level: x.level ?? "info", when: when(now - (x.at ?? 0)),
    needs: x.needs != null, resolved: x.needs != null && x.resolved === true, read: x.read === true,
    hasAction: typeof x.action?.name === "string",
    type: notifyType(x), needsNow: matchesFilter(x, "needs"),
  }));
}

// The rows a filter shows; null shows every row.
export function filterRows(rows, filter) {
  if (!filter) return rows;
  return rows.filter((r) => (filter === "needs" ? r.needsNow : r.type === filter));
}

// How many rows each chip would show: { all, needs, agents, ci, updates, other }.
export function filterCounts(rows) {
  const out = { all: rows.length };
  for (const f of FILTERS) out[f] = filterRows(rows, f).length;
  return out;
}
