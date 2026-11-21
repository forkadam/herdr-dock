// Codex (OpenAI) usage windows from its local session logs (pure; no Node built-ins).
// Codex writes ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl; its "token_count" events carry
// rate_limits { primary, secondary }, each { used_percent, window_minutes?, resets_at? (epoch s) |
// resets_in_seconds? (from the event's timestamp) }.
const STALE_MS = 120_000; // as the Claude status line's windows
const pad = (n) => String(n).padStart(2, "0");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// The session folders for today and the 7 days before, newest first. Both local and UTC dates are
// included (Codex's folder date and this computer's clock can disagree near midnight).
export function codexSessionDirs(codexHome, nowMs) {
  const out = [];
  for (let d = 0; d <= 7; d++) {
    const t = new Date(nowMs - d * 86400000);
    for (const [y, m, day] of [[t.getFullYear(), t.getMonth() + 1, t.getDate()], [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]]) {
      const dir = `${codexHome}/sessions/${y}/${pad(m)}/${pad(day)}`;
      if (!out.includes(dir)) out.push(dir);
    }
  }
  return out;
}

// The newest rollout-*.jsonl among file names (the name starts with its time), or null.
export function newestRollout(names) {
  const r = (names ?? []).filter((n) => /^rollout-.*\.jsonl$/.test(n)).sort();
  return r.length ? r[r.length - 1] : null;
}

function windowOf(w, eventMs) {
  if (!isObj(w) || !isNum(w.used_percent) || w.used_percent < 0 || w.used_percent > 100) return null;
  let resetsMs = null;
  if (isNum(w.resets_at)) resetsMs = w.resets_at > 1e12 ? w.resets_at : w.resets_at * 1000;
  else if (isNum(w.resets_in_seconds) && isNum(eventMs)) resetsMs = eventMs + w.resets_in_seconds * 1000;
  return { usedPercent: w.used_percent, minutes: isNum(w.window_minutes) ? w.window_minutes : null, resetsMs };
}

// A rollout file's text -> { windows: [{ kind, usedPercent, resetsMs }], fetchedMs, stale } from its last
// rate_limits, or null when it has none.
export function parseCodexUsage(text, nowMs) {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes("rate_limits")) continue;
    let ev;
    try { ev = JSON.parse(lines[i]); } catch { continue; }
    const rl = ev?.payload?.rate_limits ?? ev?.rate_limits;
    if (!isObj(rl)) continue;
    const eventMs = Date.parse(ev.timestamp);
    const found = [["primary", "five_hour"], ["secondary", "weekly"]]
      .map(([key, kind]) => {
        const w = windowOf(rl[key], eventMs);
        if (!w) return null;
        const byLength = w.minutes === 300 ? "five_hour" : w.minutes === 10080 ? "weekly" : kind;
        return { kind: byLength, usedPercent: w.usedPercent, resetsMs: w.resetsMs };
      })
      .filter(Boolean);
    if (!found.length) continue;
    // An unreadable timestamp: show it, but as stale (its age is unknown).
    if (!isNum(eventMs)) return { windows: found, fetchedMs: nowMs, stale: true };
    return { windows: found, fetchedMs: eventMs, stale: nowMs - eventMs > STALE_MS };
  }
  return null;
}

// The reading with the latest event among candidates (a resumed or long session may live in an older
// folder than a newer short one), or null.
export function pickNewestUsage(readings) {
  let best = null;
  for (const r of readings ?? []) if (r && (!best || r.fetchedMs > best.fetchedMs)) best = r;
  return best;
}
