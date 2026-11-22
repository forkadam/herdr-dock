// The notification history as rows to draw (pure; no host imports).
import { formatAge } from "../../shared/claude.js";

// formatAge's text without " ago": "just now", "5m", "2h", "3d".
const when = (ms) => formatAge(Math.max(0, ms)).replace(/ ago$/, "");

// One row per history item (historyOf's items), in the history's order (newest first).
export function notificationRows(list, now) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => ({
    id: x.id, title: x.title ?? "", body: x.body ?? "", level: x.level ?? "info", when: when(now - (x.at ?? 0)),
    needs: x.needs != null, resolved: x.needs != null && x.resolved === true, read: x.read === true,
    hasAction: typeof x.action?.name === "string",
  }));
}
