// What a browser setup run records, so the Dock layout dialog's Browser section can tell "still running" from "failed"
// and from "the setup tab was closed" (pure; no host imports). Written by `npm run deploy` (the browser step) and by
// herdr-browser-setup.mjs, at <app home>/herdr-dock/browser/setup-result.json.
//
// At the start { state: "running", startedAt, action }; at the end { state: "ok" | "failed" | "unsupported", at, action,
// message }. action: "on" (set it up) or "off" (remove it); message: the failure's first line, or "".

export const SETUP_RESULT_REL = "herdr-dock/browser/setup-result.json";
// A run still "running" this long after it started was stopped or its tab was closed.
export const ABANDON_MS = 15 * 60e3;

const OUTCOMES = ["ok", "failed", "unsupported"];
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

export const startResult = (action, now) => ({ state: "running", startedAt: now, action });
export const endResult = (action, outcome, message, now) => ({ state: outcome, at: now, action, message });

// The result in `text` (the file's content), or null when it is missing, junk or not a result.
export function parseSetupResult(text) {
  let r;
  try { r = JSON.parse(text); } catch { return null; }
  if (!isObj(r)) return null;
  if (r.state === "running") return Number.isFinite(r.startedAt) ? r : null;
  return OUTCOMES.includes(r.state) ? r : null;
}

// "running" | "abandoned" | "ok" | "failed" | "unsupported", or null without a result.
export function runState(result, now) {
  if (!result) return null;
  if (result.state === "running") return now - result.startedAt >= ABANDON_MS ? "abandoned" : "running";
  return result.state;
}
