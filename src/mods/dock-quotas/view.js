// Pure view model for the Quotas feature (no host imports: node --test runs it).
import { formatPercent, formatAge, formatReset } from "../../shared/claude.js";

const LABELS = { five_hour: "Claude · 5-hour", weekly: "Claude · weekly" };

// Statusline | null -> rows { label, value, detail, stale, percent? }.
export function quotaRows(statusline, nowMs) {
  if (!statusline) return [{ label: "Claude", value: "no data", detail: "start Claude Code to report usage", stale: false }];
  const age = formatAge(nowMs - statusline.fetchedMs);
  return statusline.windows.map((w) => ({
    label: LABELS[w.kind] ?? `Claude · ${w.kind}`,
    value: formatPercent(w.usedPercent),
    detail: w.resetsMs == null ? age : `${formatReset(w.resetsMs, nowMs)} · ${age}`,
    stale: Boolean(statusline.stale),
    percent: w.usedPercent,
  }));
}

// Icon-rail badge: highest finite used % (rounded), marked stale with the cache. Null: nothing to show.
export function iconBadge(statusline) {
  if (!statusline) return null;
  const ps = statusline.windows.map((w) => w.usedPercent).filter((p) => Number.isFinite(p));
  if (!ps.length) return null;
  return { text: `${Math.round(Math.max(...ps))}%`, stale: Boolean(statusline.stale) };
}

export const barLevel = (p) => (p >= 90 ? "high" : p >= 70 ? "warn" : "ok");
