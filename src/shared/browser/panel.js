// The Browser panel's decisions (pure; no host imports): who has the page, the control record it writes, which
// handoffs to announce, the size views, and the dock-core command that brings the panel into view.

import { b64urlDecode, b64urlEncode } from "../gitcmd.js";
import { answer, handBack, isStale, parseControl, personHas, takeOver } from "./registry.js";

// What the panel shows for a session: "handoff" (the agent asked; its handoff is open), "takeover" (the person took
// the page), else "view". A handoff answered, or past handoffMinutes, is over.
export function panelMode(session, control, now, handoffMinutes) {
  const c = control ?? parseControl(null);
  const h = session?.handoff;
  if (h && personHas(session, { ...c, takeover: null }, now, handoffMinutes)) return { kind: "handoff", handoff: h };
  return c.takeover ? { kind: "takeover", reason: c.takeover.reason } : { kind: "view" };
}

// "pick" or "notes" while the person is pointing at the page (a take-over with that reason), else null.
export const pickKind = (mode) => (mode?.kind === "takeover" && (mode.reason === "pick" || mode.reason === "notes") ? mode.reason : null);

// Put the pick script back in the page: only when it is gone and the control record, read fresh, still says this
// copy's Pick or Notes (a Cancel elsewhere, or one in flight, never brings it back).
export const shouldReinstall = (present, control, kind) => !present && !!kind && control?.takeover?.reason === kind;

// The person drives the page (clicks and keys go to it) in a handoff or a take-over.
export const inControl = (mode) => mode?.kind === "handoff" || mode?.kind === "takeover";

// The control record as it stands for this terminal: one left by an older terminal with the same id is the default.
export function controlOf(text, created) {
  const c = parseControl(text);
  return text != null && Number.isFinite(created) && isStale(c, created) ? parseControl(null) : c;
}

// The control record's next text: the current one (a stale one, left by an older terminal with the same id, starts
// over), changed, and stamped with the terminal's creation time, without which browse reads it as stale. null when
// that time isn't known: such a record could be read as another terminal's, so it is never written (NO_TERMINAL).
export function controlText(text, created, change) {
  if (!Number.isFinite(created)) return null;
  return JSON.stringify({ ...change(controlOf(text, created)), terminalCreated: created }, null, 2) + "\n";
}

export const NO_TERMINAL = "Can't identify this terminal (hc get failed)";

// Handing back ends what the person had: the take-over, the real window and the size tabs (undone by then).
const release = (c) => ({ ...handBack(c), window: null, sizes: null });

// The changes the panel's buttons make. Everything a later button must finish (the real window, the size tabs) is
// in the record, so any panel copy, or one reloaded, finishes it.
export const changes = {
  takeOver: (now) => (c) => (c.takeover ? c : takeOver(c, "person", now)),
  pick: (kind, now) => (c) => takeOver(c, kind, now), // Pick or Notes: the person points at the page
  window: (now) => (c) => takeOver(c, "window", now), // before window-open runs: the agent waits
  windowOpened: (now) => (c) => ({ ...c, window: { since: now } }), // window-open succeeded: Done runs window-done
  // A size tab opened: remembered with the agent's tab and viewport (the first size's, kept for later ones).
  sizeTab: (id, agentTab, viewport) => (c) => {
    const s = c.sizes ?? { tabs: [], agentTab: agentTab ?? null, viewport: viewport ?? null };
    return { ...c, sizes: { ...s, tabs: [...s.tabs.filter((x) => x !== id), id] } };
  },
  handBack: () => release,
  answer: (id, value) => (c) => release(answer(c, id, value)),
};

// What finishing the person's turn takes, from the control record: the commands that put the agent's tab and size
// back, whether the real window is open (Done keeps what was done there; Cancel just closes it), and whether Pick or
// Notes' script is in the page (STOP_SCRIPT takes it out).
export const finishOf = (control) => ({
  restore: restoreCommands(control?.sizes), window: !!control?.window,
  stopPick: control?.takeover?.reason === "pick" || control?.takeover?.reason === "notes",
});

// A real window left behind: the take-over "Open in a real window" made (reason "window") outlived its handoff (timed
// out, or cleared by the agent's wait), so nothing would ever finish it and the agent would wait on it. The panel
// closes the window and hands the page back.
export function windowLeft(session, control, now, handoffMinutes) {
  return control?.takeover?.reason === "window" && panelMode(session, control, now, handoffMinutes).kind !== "handoff";
}

// Handoffs to announce: open ones (not answered, not timed out) whose id isn't in `notified`.
// entries: [{ session, control }] for every terminal with a session record.
export function handoffNotices(entries, notified, now, handoffMinutes) {
  const seen = new Set(Array.isArray(notified) ? notified : []);
  const out = [];
  for (const { session, control } of entries ?? []) {
    const h = session?.handoff;
    if (!h || seen.has(h.id)) continue;
    if (panelMode(session, control, now, handoffMinutes).kind !== "handoff") continue;
    out.push({ terminal: session.terminal, id: h.id, message: h.message });
  }
  return out;
}

// The announced ids kept (newest last), at most cap.
export function rememberNotified(list, ids, cap = 50) {
  const prev = Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  return [...prev.filter((x) => !ids.includes(x)), ...ids].slice(-cap);
}

// The size views: a new tab at the current URL, then the size. agent-browser's viewport is the session's (every
// tab gets it), so the panel puts the agent's back when the person hands back (restoreCommands).
export const SIZES = {
  phone: { label: "Phone", set: ["set", "device", "iPhone 16"] },
  tablet: { label: "Tablet", set: ["set", "device", "iPad"] },
  desktop: { label: "Desktop", set: ["set", "viewport", "1440", "900"] },
};

export function sizeCommands(size, url) {
  const s = SIZES[size];
  if (!s || !url) return null;
  return [["tab", "new", "--json", url], s.set];
}

// The tab id `tab new --json` printed, or null.
export function newTabId(stdout) {
  try {
    const id = JSON.parse(String(stdout ?? "")).data?.tabId;
    return typeof id === "string" && id ? id : null;
  } catch { return null; }
}

// Back to the agent's tab at its own size: the size tabs closed, its tab active, its viewport set again.
// sizes: { tabs: [ids], agentTab, viewport: { w, h } }.
export function restoreCommands(sizes) {
  if (!sizes?.tabs?.length) return [];
  const out = sizes.tabs.map((id) => ["tab", "close", id]);
  if (sizes.agentTab) out.push(["tab", sizes.agentTab]);
  const v = sizes.viewport;
  if (v && v.w > 0 && v.h > 0) out.push(["set", "viewport", String(v.w), String(v.h)]);
  return out;
}

// The picture's width: the panel's width, and in the big window also no taller than the room there is.
export function fitWidth(frame, availW, availH) {
  const w = Math.floor(availW);
  if (!frame?.w || !frame?.h || !(availH > 0)) return w;
  return Math.max(0, Math.min(w, Math.floor((availH * frame.w) / frame.h)));
}

// The Enlarge window, and where dock-core shows the panel when the right column doesn't hold it.
export const bigWindow = (terminal) => ({
  mod: "dock-browser", kind: "window", key: "dock-browser-big", width: 0.8, height: 0.85,
  props: { big: true, ...(terminal ? { terminal } : {}) },
});

// dock-core's browser.show command (without the "dock-core." prefix): bring the panel into view on a terminal.
// Herdr drops run()'s args for mod commands, so the terminal rides in the name.
export const browserShowName = (terminal) => `browser.show.${b64urlEncode(String(terminal))}`;

export function parseBrowserShow(c) {
  const m = /^browser\.show\.([A-Za-z0-9_-]+)$/.exec(String(c ?? ""));
  if (!m) return null;
  const terminal = b64urlDecode(m[1]);
  return terminal ? { terminal } : null;
}
