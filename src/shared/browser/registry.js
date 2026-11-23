// Session and control records for dock-browser (pure; no Node built-ins, Herdr mods import this).
// The session record is written only by the browse wrapper, the control record only by the panel.

// window: the person's real window ("Open in a real window") is open, { since }. sizes: the size tabs the panel opened
// and what to put back on Hand back, { tabs, agentTab, viewport: { w, h } }. Both kept here, not in one panel copy, so
// any copy (the right panel, the big window, or one reloaded) finishes them.
const DEFAULT_CONTROL = { v: 1, takeover: null, answer: null, window: null, sizes: null };
const REASONS = ["person", "pick", "notes", "window"];
const VALUES = ["done", "cancel"];
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const isStr = (x) => typeof x === "string" && x !== "";

const created = (o) => (Number.isFinite(o.terminalCreated) ? { terminalCreated: o.terminalCreated } : {});

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
    ...created(o),
  };
}

export function parseControl(text) {
  const o = json(text);
  if (!isObj(o)) return { ...DEFAULT_CONTROL };
  const t = o.takeover, a = o.answer, w = o.window;
  return {
    v: 1,
    takeover: isObj(t) && REASONS.includes(t.reason) && Number.isFinite(t.since) ? { reason: t.reason, since: t.since } : null,
    answer: isObj(a) && isStr(a.id) && VALUES.includes(a.value) ? { id: a.id, value: a.value } : null,
    window: isObj(w) && Number.isFinite(w.since) ? { since: w.since } : null,
    sizes: sizesOf(o.sizes),
    ...created(o),
  };
}

const isPos = (n) => Number.isFinite(n) && n > 0;
function sizesOf(x) {
  if (!isObj(x) || !Array.isArray(x.tabs)) return null;
  const v = x.viewport;
  return {
    tabs: x.tabs.filter(isStr),
    agentTab: isStr(x.agentTab) ? x.agentTab : null,
    viewport: isObj(v) && isPos(v.w) && isPos(v.h) ? { w: v.w, h: v.h } : null,
  };
}

export const startHandoff = (session, message, now, id) => ({ ...session, handoff: { id, message, since: now } });
export const clearHandoff = (session) => ({ ...session, handoff: null });

const limit = (m) => (Number.isFinite(m) && m > 0 ? m : 15);
const expired = (h, now, minutes) => now - h.since > limit(minutes) * 60_000;

// A record belongs to one terminal incarnation: stale when null or its terminalCreated differs from the live one.
export const isStale = (record, createdMs) => !record || !Number.isFinite(record.terminalCreated) || record.terminalCreated !== createdMs;
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
export const takeOver = (control, reason, now, terminalCreated) => ({
  ...control, takeover: { reason, since: now }, ...(Number.isFinite(terminalCreated) ? { terminalCreated } : {}),
});
export const handBack = (control) => ({ ...control, takeover: null });

export const goneSessions = (sessions, liveTerminals) => sessions.filter((s) => !liveTerminals.has(s.terminal));

// The terminal ids `herdr-app ls` lists (its stdout), or null when it can't be read (then nothing is swept).
export function liveTerminals(stdout) {
  let o;
  try { o = JSON.parse(String(stdout ?? "")); } catch { return null; }
  if (!Array.isArray(o?.spaces)) return null;
  const live = new Set();
  for (const s of o.spaces) for (const tab of s?.tabs ?? []) for (const x of tab?.terminals ?? []) if (x?.terminal) live.add(x.terminal);
  return live;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
