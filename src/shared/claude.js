// Pure Claude data helpers (no Node built-ins, no "herdr" import: bundled into Herdr mods).
// Callers pass in file text and the current time; nothing here touches the filesystem.

const STALE_MS = 120_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(["five_hour", "weekly"]);

function parseJson(text) {
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return null; }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Returns the sessionId of a live interactive Claude record owned by fg.pid, else null.
export function matchSession(recordText, fg, terminalCreatedMs, nowMs) {
  const r = parseJson(recordText);
  if (!isObj(r) || !fg) return null;
  if (r.pid !== fg.pid || r.kind !== "interactive") return null;
  if (typeof r.sessionId !== "string" || !UUID_RE.test(r.sessionId)) return null;
  if (!isNum(r.startedAt)) return null;
  if (r.startedAt < terminalCreatedMs - 5000 || r.startedAt > nowMs + 60_000) return null;
  return r.sessionId.toLowerCase();
}

// Statusline cache -> { fetchedMs, stale, sessions: Map, windows: [] } or null.
export function parseStatusline(text, nowMs) {
  const d = parseJson(text);
  if (!isObj(d) || d.provider !== "claude" || d.source !== "claude-statusline") return null;
  if (!isNum(d.fetched_at_unix)) return null;
  const fetchedMs = d.fetched_at_unix * 1000;
  const sessions = new Map();
  if (isObj(d.session_contexts)) {
    for (const [id, s] of Object.entries(d.session_contexts)) {
      if (!isObj(s) || !isNum(s.used_percent)) continue;
      const act = isObj(s.cache) ? s.cache.last_activity_unix : undefined;
      // No activity time: treat as stale rather than fresh-looking.
      const seenMs = isNum(act) ? act * 1000 : 0;
      // Lowercase: matchSession returns lowercase ids.
      sessions.set(id.toLowerCase(), { usedPercent: s.used_percent, seenMs, stale: nowMs - seenMs > STALE_MS });
    }
  }
  const windows = [];
  if (Array.isArray(d.windows)) {
    for (const w of d.windows) {
      if (!isObj(w) || !KINDS.has(w.kind) || !isNum(w.used_percent)) continue;
      windows.push({ kind: w.kind, usedPercent: w.used_percent,
        resetsMs: isNum(w.resets_at) ? w.resets_at * 1000 : null });
    }
  }
  return { fetchedMs, stale: nowMs - fetchedMs > STALE_MS, sessions, windows };
}

export function formatPercent(p) {
  return `${Math.round(p)}% used`;
}

export function formatAge(ms) {
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatReset(resetsMs, nowMs) {
  const diff = resetsMs - nowMs;
  if (diff <= 0) return "resetting";
  const totalMin = Math.floor(diff / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `resets in ${d}d ${h}h`;
  if (h > 0) return `resets in ${h}h ${String(m).padStart(2, "0")}m`;
  return `resets in ${m}m`;
}

// The identity hc reports for a terminal (`hc get <t> --json`): its foreground pid and when
// the terminal was made. Either changing means another program or terminal: a new session.
function identityOf(info) {
  const pid = isObj(info) && isObj(info.foreground) ? info.foreground.pid : undefined;
  if (!isNum(pid) || !isNum(info.created_ms)) return null;
  return { pid, createdMs: info.created_ms };
}

// Keep a cached context entry only while hc still reports the same pid and created_ms.
export function keepEntry(prev, info) {
  const id = identityOf(info);
  return Boolean(prev && id && prev.pid === id.pid && prev.createdMs === id.createdMs);
}

// One agent's context from a fresh hc result, its session record text and the parsed cache:
// { pid, createdMs, sessionId, usedPercent, seenMs, stale } or null when anything doesn't match.
export function contextEntry(info, recordText, cache, nowMs) {
  const id = identityOf(info);
  if (!id || !cache) return null;
  const sessionId = matchSession(recordText, { pid: id.pid }, id.createdMs, nowMs);
  const s = sessionId ? cache.sessions.get(sessionId) : undefined;
  if (!s) return null;
  return { ...id, sessionId, usedPercent: s.usedPercent, seenMs: s.seenMs, stale: s.stale };
}
