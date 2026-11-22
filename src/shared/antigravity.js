// Antigravity's usage limits (pure; bundled into dock-quotas). The agy CLI hands its state to a status-line command;
// herdr-agy-statusline.mjs keeps the plan and quota buckets in a small cache, read here. Buckets as agy 1.5 names
// them: gemini-5h, gemini-weekly (always shown), 3p-5h / 3p-weekly (third-party models), gemini-argon-wtu-weekly,
// and any other, shown once used.

// The cache, under the home folder (the writer runs from agy, which doesn't know Herdr's app home).
export const AGY_CACHE_REL = ".gemini/antigravity-cli/statusline-cache/agy-statusline.json";
// The status line reports only while an agy session runs: a reading older than this is marked stale.
export const AGY_STALE_MS = 15 * 60e3;

const HOUR = 3600e3;
const ALWAYS = { "gemini-5h": "five_hour", "gemini-weekly": "weekly" };
const NAMED = { "3p-5h": ["other models 5-hour", "3p 5h"], "3p-weekly": ["other models weekly", "3p wk"] };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// A bucket's length, from its name, for the pace tick.
const durationOf = (key) => (/5h$/.test(key) ? 5 * HOUR : /weekly$/.test(key) ? 7 * 24 * HOUR : /daily$/.test(key) ? 24 * HOUR : null);

// The cache's text -> a reading ({ source, plan, fetchedMs, stale, windows }) or null.
export function parseAgyCache(text, nowMs) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d || d.provider !== "antigravity" || !isNum(d.fetched_at_unix) || typeof d.buckets !== "object" || !d.buckets) return null;
  const windows = [];
  const order = (k) => (k === "gemini-5h" ? 0 : k === "gemini-weekly" ? 1 : 2);
  for (const key of Object.keys(d.buckets).sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    const b = d.buckets[key];
    if (!isNum(b?.remaining_fraction)) continue;
    const usedPercent = Math.max(0, Math.min(100, (1 - b.remaining_fraction) * 100));
    if (!ALWAYS[key] && usedPercent <= 0) continue; // a bucket not in use stays out (three rows of 0% say nothing)
    const t = Date.parse(b.reset_time ?? "");
    const w = { kind: ALWAYS[key] ?? "bucket", usedPercent, resetsMs: Number.isFinite(t) ? t : null, durationMs: durationOf(key) };
    if (!ALWAYS[key]) Object.assign(w, { label: NAMED[key]?.[0] ?? key, short: NAMED[key]?.[1] ?? key });
    windows.push(w);
  }
  if (!windows.length) return null;
  const fetchedMs = d.fetched_at_unix * 1000;
  return { source: "agy-statusline", plan: typeof d.plan === "string" && d.plan ? d.plan : null, fetchedMs, stale: nowMs - fetchedMs > AGY_STALE_MS, windows };
}
