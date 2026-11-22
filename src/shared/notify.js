// The notification history (pure; no host imports): every toast recorded as an item, what "needs you" items
// wait on, and when their cause is fixed. Kept in shared state under HISTORY_KEY, newest first.
//
// Herdr's own agent toasts, observed by pointing the layout's "toast" at a probe mod (Step 1):
//   blocked: { title: "<program> needs you", body: "<space> / <tab>", level: "error",
//              action: { name: "agent.focus", args: { terminal: "t13" } }, overlay: "o6" }
//   done:    { title: "<program> finished",  body: "<space> / <tab>", level: "info",
//              action: { name: "agent.focus", args: { terminal: "t14" } }, overlay: "o7" }
// args.terminal is the agent's terminal address (agents()[i].address), not its pane id: an agent item's needs
// is { kind: "agent", terminal }, and resolveItems matches it against agents()[i].address.

import { parseGitCommand } from "./gitcmd.js";

export const HISTORY_KEY = "dock.notify.history";
export const CAP = 200;
const BODY_MAX = 2000;

const cut = (s) => (typeof s === "string" && s.length > BODY_MAX ? s.slice(0, BODY_MAX) + "…" : s);

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : null);

function actionOf(a) {
  if (!isObj(a) || typeof a.name !== "string") return null;
  return a.args === undefined ? { name: a.name } : { name: a.name, args: a.args };
}

function itemOf(x) {
  if (!isObj(x) || typeof x.id !== "string") return null;
  const needs = isObj(x.needs) && ((x.needs.kind === "agent" && typeof x.needs.terminal === "string")
    || (x.needs.kind === "pipeline" && typeof x.needs.worktree === "string")) ? x.needs : null;
  return {
    id: x.id, at: Number.isFinite(x.at) ? x.at : 0, title: typeof x.title === "string" ? x.title : "",
    body: str(x.body), level: str(x.level), icon: str(x.icon), action: actionOf(x.action),
    read: x.read === true, needs, resolved: needs != null && x.resolved === true,
  };
}

// The stored history as items; anything that isn't one is dropped.
export function historyOf(raw) {
  return Array.isArray(raw) ? raw.map(itemOf).filter(Boolean) : [];
}

// What a notification's props wait on: a pipeline failure alert's worktree, a Herdr agent-needs-you toast's
// agent, else null.
export function needsOf(n) {
  const name = isObj(n) && isObj(n.action) ? n.action.name : null;
  if (typeof name !== "string") return null;
  if (name.startsWith("dock-core.")) {
    const c = parseGitCommand(name.slice("dock-core.".length));
    return c?.cmd === "show" && typeof c.worktree === "string" ? { kind: "pipeline", worktree: c.worktree } : null;
  }
  const terminal = n.action.args?.terminal;
  if (name === "agent.focus" && n.level === "error" && typeof terminal === "string") return { kind: "agent", terminal };
  return null;
}

// The list with n recorded first (a body over 2000 characters is cut, with "…"). Past CAP, resolved items go first (oldest first), then the oldest.
export function addItem(list, n, now, id) {
  const p = isObj(n) ? n : {};
  const out = [itemOf({ ...p, body: cut(p.body), id, at: now, read: false, needs: needsOf(p), resolved: false }), ...list];
  while (out.length > CAP) {
    const i = out.findLastIndex((x) => x.resolved);
    out.splice(i >= 0 ? i : out.length - 1, 1);
  }
  return out;
}

export const clearItem = (list, id) => list.filter((x) => x.id !== id);
export const clearAll = () => [];
export const markAllRead = (list) => list.map((x) => (x.read ? x : { ...x, read: true }));

function isFixed(needs, agents, gitState) {
  if (needs.kind === "agent") {
    if (!Array.isArray(agents)) return false; // agents unknown: not fixed (a real [] means it's gone)
    const a = agents.find((g) => g?.address === needs.terminal);
    return !a || a.status !== "blocked"; // a gone agent waits on nothing
  }
  for (const r of gitState?.repos ?? []) {
    const w = (r?.worktrees ?? []).find((x) => x?.id === needs.worktree);
    if (w) {
      // Not polled yet (null) or a CI error ("unknown"): not fixed. Only a definite non-failed status is.
      const status = w.pipeline?.status;
      return typeof status === "string" && status !== "unknown" && status !== "failed";
    }
  }
  return false; // a worktree the state doesn't know: unknown is not fixed
}

// Marks needs-you items whose cause is fixed. Returns the same array when nothing changed.
export function resolveItems(list, { agents, gitState } = {}) {
  let changed = false;
  const out = list.map((x) => {
    if (!x.needs || x.resolved || !isFixed(x.needs, agents, gitState)) return x;
    changed = true;
    return { ...x, resolved: true };
  });
  return changed ? out : list;
}

// needYou: unresolved needs-you items. unread: the other unread items (a resolved one counts as plain unread),
// so no item is counted twice.
export function counts(list) {
  let needYou = 0, unread = 0;
  for (const x of list) {
    if (x.needs && !x.resolved) needYou++;
    else if (!x.read) unread++;
  }
  return { needYou, unread };
}
