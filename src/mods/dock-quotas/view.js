// Pure view model for the Quotas feature (no host imports: node --test runs it).
// Usage readings ({ windows: [{ kind, usedPercent, resetsMs }], fetchedMs, stale }) come from the Claude
// status-line cache (src/shared/claude.js) and Codex's session logs (src/shared/codex.js).
import { formatPercent, formatAge, formatReset } from "../../shared/claude.js";

// Group order and names. `agent` is the program key in Herdr's agent table (knownAgents), for the icon.
export const PROVIDERS = [
  { id: "claude", title: "Claude", agent: "claude", source: "Claude status line" },
  { id: "codex", title: "Codex", agent: "codex", source: "Codex session logs" },
];
const LABELS = { five_hour: "5-hour", weekly: "weekly" };

const isReset = (w, nowMs) => Number.isFinite(nowMs) && Number.isFinite(w.resetsMs) && w.resetsMs <= nowMs;

// One provider's reading -> rows { label, value, detail, stale, tooltip, percent }.
export function quotaRows(usage, nowMs, provider) {
  const age = formatAge(nowMs - usage.fetchedMs);
  return usage.windows.map((w) => {
    const label = LABELS[w.kind] ?? w.kind;
    // Past its reset time, an old reading's % no longer applies.
    if (isReset(w, nowMs)) {
      return { label, value: "reset", detail: `reset · ${age}`, stale: Boolean(usage.stale),
        tooltip: `${provider.title} · ${label}: reset since this reading · source: ${provider.source}`, percent: null };
    }
    return {
      label,
      value: formatPercent(w.usedPercent),
      detail: w.resetsMs == null ? age : `${formatReset(w.resetsMs, nowMs)} · ${age}`,
      stale: Boolean(usage.stale),
      tooltip: `${provider.title} · ${label}: ${formatPercent(w.usedPercent)} · source: ${provider.source}`,
      percent: w.usedPercent,
    };
  });
}

// { [providerId]: reading | null } -> [{ id, title, agent, rows }] in PROVIDERS order, leaving out providers
// with nothing recorded.
export function quotaGroups(byId, nowMs) {
  return PROVIDERS
    .filter((p) => byId?.[p.id]?.windows?.length)
    .map((p) => ({ id: p.id, title: p.title, agent: p.agent, rows: quotaRows(byId[p.id], nowMs, p) }));
}

// Icon-rail badge: the highest finite used % (rounded) across readings, leaving out windows past their reset,
// stale when the reading it came from is. Null: nothing to show.
export function iconBadge(readings, nowMs) {
  let best = null;
  for (const r of readings ?? []) {
    for (const w of r?.windows ?? []) {
      if (!Number.isFinite(w.usedPercent) || isReset(w, nowMs)) continue;
      if (!best || w.usedPercent > best.p) best = { p: w.usedPercent, stale: Boolean(r.stale) };
    }
  }
  return best ? { text: `${Math.round(best.p)}%`, stale: best.stale } : null;
}

export const barLevel = (p) => (p >= 90 ? "high" : p >= 70 ? "warn" : "ok");
