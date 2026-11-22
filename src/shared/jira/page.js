// The Jira page's decisions (pure; no host imports): which filters it offers, when it polls, what it shows.
import { BUILTIN_FILTERS } from "./jql.js";

export const SHOWN_EVERY_MS = 2 * 60e3;
export const HIDDEN_EVERY_MS = 10 * 60e3;
export const RETRY_AFTER_MS = 5 * 60e3;
export const PAGE_SIZE = 50;

// Built-ins, then Jira's favourite filters, then the user's own (settings), each { id, name, jql, source }.
// Ids are stable across restarts so the chosen filter can be remembered: "fav:<jira id>", "own:<index>:<name>".
export function filterList(favourites, own) {
  const out = BUILTIN_FILTERS.map((f) => ({ ...f, source: "builtin" }));
  for (const f of Array.isArray(favourites) ? favourites : []) {
    if (f && typeof f.jql === "string" && f.jql.trim() && f.name) out.push({ id: `fav:${f.id}`, name: String(f.name), jql: f.jql, source: "favourite" });
  }
  (Array.isArray(own) ? own : []).forEach((f, i) => {
    if (f?.name && f?.jql) out.push({ id: `own:${i}:${f.name}`, name: f.name, jql: f.jql, source: "own" });
  });
  return out;
}

// The remembered filter if it still exists, else Assigned to me.
export const pickFilter = (filters, id) => filters.find((f) => f.id === id) ?? filters[0];

// Whether a poll is due: every 2 minutes while the page shows, every 10 while hidden (for the Pages badge); after a
// failure no sooner than 5 minutes. A manual refresh doesn't ask.
export function pollDue({ shown, lastAt, failed, now }) {
  if (!Number.isFinite(lastAt)) return true;
  const every = failed ? Math.max(RETRY_AFTER_MS, shown ? SHOWN_EVERY_MS : HIDDEN_EVERY_MS) : shown ? SHOWN_EVERY_MS : HIDDEN_EVERY_MS;
  return now - lastAt >= every;
}

// What the page shows: "setup" (no address or token), "settings" (the form, opened by hand), "checking" (first
// contact), "problem" (can't talk to Jira at all), or "ready".
export function pageState({ settings, token, editing, connected, problem, checking }) {
  if (editing) return "settings";
  if (!settings?.baseUrl || !token) return "setup";
  if (problem) return "problem";
  if (checking || !connected) return "checking";
  return "ready";
}

// The Pages badge: how many issues are assigned to me and unresolved (null when not connected).
export const badgeFor = (count) => (Number.isFinite(count) ? { count, tone: "info" } : null);

// The search's paging text: "12 issues", "50 of 120".
export function countText(shown, total) {
  if (!Number.isFinite(total)) return "";
  if (shown >= total) return `${total} issue${total === 1 ? "" : "s"}`;
  return `${shown} of ${total}`;
}
