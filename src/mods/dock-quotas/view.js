// Pure view model for the Quotas feature (no host imports: node --test runs it).
// Usage readings ({ windows: [{ kind, usedPercent, resetsMs }], fetchedMs, stale }) come from the Claude
// status-line cache (src/shared/claude.js) and Codex's session logs (src/shared/codex.js).
import { formatPercent, formatAge, formatReset } from "../../shared/claude.js";
import { paceOf, planLabel } from "../../shared/claude-usage.js";

// Group order and names. `agent` is the program key in Herdr's agent table (knownAgents), for the icon.
export const PROVIDERS = [
  { id: "claude", title: "Claude", agent: "claude", source: "Claude status line" },
  { id: "codex", title: "Codex", agent: "codex", source: "Codex session logs" },
];
const LABELS = { five_hour: "5-hour", weekly: "weekly" };

// Where a reading came from: the claude CLI (what /usage shows) overrides the provider's default source.
const sourceOf = (usage, provider) => (usage.source === "cli" ? "Claude Code (/usage)" : provider.source);
const labelOf = (w) => (w.kind === "model" ? `weekly · ${w.label}` : LABELS[w.kind] ?? w.kind);

const isReset = (w, nowMs) => Number.isFinite(nowMs) && Number.isFinite(w.resetsMs) && w.resetsMs <= nowMs;

// One provider's reading -> rows { label, value, detail, stale, tooltip, percent, pace }. `pace` (0..1, or null): how
// much of the window's time has passed, drawn as a tick on the bar (a bar past it is being used up too fast).
export function quotaRows(usage, nowMs, provider) {
  const age = formatAge(nowMs - usage.fetchedMs);
  const source = sourceOf(usage, provider);
  return usage.windows.map((w) => {
    const label = labelOf(w);
    // Past its reset time, an old reading's % no longer applies.
    if (isReset(w, nowMs)) {
      return { label, value: "reset", detail: `reset · ${age}`, stale: Boolean(usage.stale),
        tooltip: `${provider.title} · ${label}: reset since this reading · source: ${source}`, percent: null, pace: null };
    }
    const pace = paceOf(w, nowMs);
    return {
      label,
      value: formatPercent(w.usedPercent),
      detail: w.resetsMs == null ? age : `${formatReset(w.resetsMs, nowMs)} · ${age}`,
      stale: Boolean(usage.stale),
      tooltip: `${provider.title} · ${label}: ${formatPercent(w.usedPercent)}${pace == null ? "" : ` · ${Math.round(pace * 100)}% of the window has passed`} · source: ${source}`,
      percent: w.usedPercent,
      pace,
    };
  });
}

// { [providerId]: reading | null } -> [{ id, title, agent, rows }] in PROVIDERS order, leaving out providers
// with nothing recorded.
export function quotaGroups(byId, nowMs) {
  return PROVIDERS
    .filter((p) => byId?.[p.id]?.windows?.length)
    .map((p) => ({ id: p.id, title: p.title, agent: p.agent, plan: planLabel(byId[p.id].plan), rows: quotaRows(byId[p.id], nowMs, p) }));
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

// The Claude status-line self-check, shown while there's no Claude reading. state: statuslinePlan's state, or
// "no-claude" (no ~/.claude) / null (not checked yet). -> { text, tip, action } or null (nothing to say).
// "fed" with no reading: set up, waiting for Claude Code to run its status line (after its next reply).
// action: "setup" when the Set up button can fix it.
export function setupNotice(state, { busy = false, error = null } = {}) {
  if (error) return { text: "Claude: set up failed", tip: error, action: "setup" };
  if (busy) return { text: "Claude: setting up…", tip: "Writing ~/.claude/settings.json", action: null };
  switch (state) {
    case "missing": return { text: "Claude: status line not set up",
      tip: "Claude Code gives its usage limits only to a status line. Set up adds one that prints nothing.", action: "setup" };
    case "other": return { text: "Claude: status line doesn't feed Quotas",
      tip: "Set up puts herdr-dock's writer in front of your status line; it prints the same.", action: "setup" };
    case "complex": return { text: "Claude: add one line to your status line",
      tip: "Your status line is more than one command, so it's left alone. README: \"Where the quota and context numbers come from\".", action: null };
    case "fed": return { text: "Claude: waiting for Claude Code's next reply",
      tip: "The status line is set up. The limits arrive with the next reply in any Claude Code session (only on a Claude subscription). Nothing after a reply? Restart Claude Code.", action: null };
    case "invalid": return { text: "Claude: ~/.claude/settings.json isn't valid JSON", tip: "Fix the file; Quotas checks again.", action: null };
    default: return null;
  }
}
