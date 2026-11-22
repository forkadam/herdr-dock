// Claude's usage limits from the claude CLI (scripts/herdr-claude-usage.mjs: get_usage, what /usage shows), and how
// they combine with the status-line cache (pure; bundled into dock-quotas). A reading has the shape parseStatusline
// gives ({ fetchedMs, stale, windows: [{ kind, usedPercent, resetsMs }] }), plus `plan`, `source` and, per window,
// `durationMs` (for the pace tick) and, for a model's own weekly limit, kind "model" with its `label`.

const HOUR = 3600e3;
const WEEK = 7 * 24 * HOUR;
// The CLI is asked every few minutes: its reading is stale only once it's this old.
export const CLI_STALE_MS = 15 * 60e3;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function window(kind, l, durationMs, label) {
  if (!l || !isNum(l.utilization)) return null;
  const t = Date.parse(l.resets_at ?? "");
  return { kind, ...(label ? { label } : {}), usedPercent: l.utilization, resetsMs: Number.isFinite(t) ? t : null, durationMs };
}

// The helper's JSON line -> a reading, or null (it failed, or isn't JSON).
export function parseUsageOutput(text, nowMs) {
  let d;
  try { d = JSON.parse(String(text ?? "").trim().split("\n").pop()); } catch { return null; }
  if (!d?.ok || !d.limits) return null;
  const l = d.limits;
  const windows = [
    window("five_hour", l.five_hour, 5 * HOUR),
    window("weekly", l.seven_day, WEEK),
    window("model", l.seven_day_opus, WEEK, "Opus"),
    window("model", l.seven_day_sonnet, WEEK, "Sonnet"),
    ...(Array.isArray(l.model_scoped) ? l.model_scoped.map((m) => window("model", m, WEEK, m.display_name || "model")) : []),
  ].filter(Boolean);
  return { source: "cli", plan: typeof d.plan === "string" && d.plan ? d.plan : null, fetchedMs: nowMs, stale: false, windows };
}

// The reading Quotas shows: the CLI's (plan, per-model limits), with the 5-hour and weekly numbers of a status line
// that reported more recently (it updates on every Claude reply). Either alone works.
export function mergeClaude(cli, statusline, nowMs) {
  if (!cli) return statusline ?? null;
  const fresher = statusline && statusline.fetchedMs > cli.fetchedMs ? statusline : null;
  const windows = cli.windows.map((w) => {
    const s = fresher?.windows.find((x) => x.kind === w.kind && w.kind !== "model");
    return s ? { ...w, usedPercent: s.usedPercent, resetsMs: s.resetsMs ?? w.resetsMs } : w;
  });
  const fetchedMs = fresher ? fresher.fetchedMs : cli.fetchedMs;
  return { ...cli, windows, fetchedMs, stale: fresher ? Boolean(fresher.stale) && nowMs - cli.fetchedMs > CLI_STALE_MS : nowMs - cli.fetchedMs > CLI_STALE_MS };
}

// How much of a window's time has passed, 0..1 (the pace tick: a bar past it is being used up too fast); null
// without a reset time or a known length.
export function paceOf(w, nowMs) {
  if (!isNum(w?.durationMs) || !isNum(w?.resetsMs)) return null;
  const elapsed = w.durationMs - (w.resetsMs - nowMs);
  return Math.max(0, Math.min(1, elapsed / w.durationMs));
}

// "team" -> "Team", "claude_max_20x" -> "Max 20x".
export function planLabel(plan) {
  if (typeof plan !== "string" || !plan.trim()) return null;
  const words = plan.replace(/^claude[_-]/i, "").split(/[_\s-]+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}
