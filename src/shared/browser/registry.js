// Session and control records for dock-browser (pure; no Node built-ins, Herdr mods import this).
// The session record is written only by the browse wrapper, the control record only by the panel.

const DEFAULT_CONTROL = { v: 1, takeover: null, answer: null };
const REASONS = ["person", "pick", "notes", "window"];
const VALUES = ["done", "cancel"];
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const isStr = (x) => typeof x === "string" && x !== "";

function json(text) {
  try { return JSON.parse(String(text ?? "")); } catch { return null; }
}

export function parseSession(text) {
  const o = json(text);
  if (!isObj(o) || !isStr(o.session) || !isStr(o.terminal)) return null;
  const h = o.handoff;
  const handoff = isObj(h) && isStr(h.id) && Number.isFinite(h.since)
    ? { id: h.id, message: String(h.message ?? ""), since: h.since }
    : null;
  return {
    v: 1, session: o.session, terminal: o.terminal,
    profile: String(o.profile ?? ""), port: Number.isFinite(o.port) ? o.port : 0,
    url: String(o.url ?? ""), title: String(o.title ?? ""),
    opened: Number.isFinite(o.opened) ? o.opened : 0, handoff,
  };
}

export function parseControl(text) {
  const o = json(text);
  if (!isObj(o)) return { ...DEFAULT_CONTROL };
  const t = o.takeover, a = o.answer;
  return {
    v: 1,
    takeover: isObj(t) && REASONS.includes(t.reason) && Number.isFinite(t.since) ? { reason: t.reason, since: t.since } : null,
    answer: isObj(a) && isStr(a.id) && VALUES.includes(a.value) ? { id: a.id, value: a.value } : null,
  };
}

export const startHandoff = (session, message, now, id) => ({ ...session, handoff: { id, message, since: now } });
export const clearHandoff = (session) => ({ ...session, handoff: null });

const expired = (h, now, minutes) => now - h.since > minutes * 60_000;
const answerOf = (session, control) =>
  session.handoff && control.answer && control.answer.id === session.handoff.id ? control.answer.value : null;

export function personHas(session, control, now, handoffMinutes) {
  if (control.takeover) return true;
  const h = session.handoff;
  return !!h && !answerOf(session, control) && !expired(h, now, handoffMinutes);
}

export function waitOutcome(session, control, now, handoffMinutes) {
  const h = session.handoff;
  if (h) {
    const a = answerOf(session, control);
    if (a) return a;
    return expired(h, now, handoffMinutes) ? "timeout" : "waiting";
  }
  return control.takeover ? "waiting" : "free";
}

export const answer = (control, id, value) => ({ ...control, answer: { id, value } });
export const takeOver = (control, reason, now) => ({ ...control, takeover: { reason, since: now } });
export const handBack = (control) => ({ ...control, takeover: null });

export const goneSessions = (sessions, liveTerminals) => sessions.filter((s) => !liveTerminals.has(s.terminal));

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
