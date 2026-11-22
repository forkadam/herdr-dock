// herdr-dock's own update state (pure; no host imports). dock-core checks GitHub's main, publishes
// dock.update.state for the Dock layout dialog, notifies once per new upstream commit, and reads the result
// file the update script (scripts/update.mjs) writes.
//
// dock.update.state = { status, current, latest, behind, subject, checkedAt, reason, startedAt } (+ commits
// after an update). status: "idle" (up to date) | "checking" | "available" | "updating" | "updated" |
// "failed" | "blocked". reason: for "blocked", why Update can't run ("on branch X", "N local commits",
// "local changes in the repo": the dialog shows "Can't update: <reason>"); for "failed", the sentence to show
// after a failed check ("Can't check: <git's first line>") or what went wrong in an update.

export const UPDATE_KEY = "dock.update.state";
export const NOTIFIED_KEY = "dock.update.notified";
// Relative to the app home, written by scripts/update.mjs: { ok, from, to, commits, reason, at }.
export const RESULT_REL = "herdr-dock/update-result.json";
// Still "updating" this long with no result file: the update tab was probably closed.
export const TIMEOUT_MS = 10 * 60 * 1000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 30000;
// The notifications open the Dock layout dialog (args are kept for Herdr's own commands).
export const OPEN_DIALOG = { name: "mod.open", args: { name: "dock-config" } };

const firstLine = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l) ?? "";
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Why Update can't run, or null. Off main and local commits always block (main isn't comparable); local
// changes only block when there is something to pull.
function blockReason({ branch, ahead, behind, dirty }) {
  if (branch === "HEAD") return "detached HEAD";
  if (branch !== "main") return `on branch ${branch}`;
  if (ahead > 0) return plural(ahead, "local commit");
  if (dirty && behind > 0) return "local changes in the repo";
  return null;
}

// The state after a check. prev (optional) is the state before it: a check right after an update keeps
// "updated" (so the strip still says "Updated to …") while HEAD is still that commit and nothing is newer.
export function updateState({ fetchOk, fetchError, branch, ahead, behind, latest, subject, current, dirty }, now, prev = null) {
  const common = { current: current ?? prev?.current ?? null, checkedAt: now, startedAt: null };
  if (!fetchOk) {
    return {
      status: "failed", latest: prev?.latest ?? null, behind: prev?.behind ?? null, subject: prev?.subject ?? null,
      ...common, reason: `Can't check: ${firstLine(fetchError) || "git fetch failed"}`,
    };
  }
  const s = { status: "idle", ...common, latest: latest ?? null, behind: behind ?? 0, subject: subject ?? null, reason: null };
  const reason = blockReason({ branch, ahead: ahead ?? 0, behind: behind ?? 0, dirty: !!dirty });
  if (reason) return { ...s, status: "blocked", reason };
  if (s.behind > 0) return { ...s, status: "available" };
  if (prev?.status === "updated" && prev.current && prev.current === s.current) {
    return { ...s, status: "updated", commits: prev.commits ?? null };
  }
  return s;
}

// Notify only for an available update whose upstream sha hasn't been notified yet.
export function shouldNotify(state, notifiedSha) {
  return state?.status === "available" && !!state.latest && state.latest !== notifiedSha;
}

// The toast for an available update.
export function availableNote(state) {
  return { title: "herdr-dock update available", body: plural(state.behind, "new commit"), level: "info", action: OPEN_DIALOG };
}

// The state after the update script's result, or null when it isn't a result object.
export function resultToState(result, prev, _now) {
  if (result == null || typeof result !== "object" || Array.isArray(result)) return null;
  const p = prev && typeof prev === "object" ? prev : {};
  const s = {
    status: "idle", current: p.current ?? null, latest: p.latest ?? null, behind: p.behind ?? null, subject: p.subject ?? null,
    checkedAt: p.checkedAt ?? null, reason: null, startedAt: null,
  };
  if (result.ok) {
    const to = result.to ?? p.latest ?? null;
    return { ...s, status: "updated", current: to, latest: to, behind: 0, commits: result.commits ?? null };
  }
  return { ...s, status: "failed", reason: firstLine(result.reason) || "unknown error" };
}

// The toast for the update script's result.
export function resultNote(result) {
  if (result?.ok) {
    return { title: `herdr-dock updated to ${result.to}`, body: plural(result.commits ?? 0, "commit"), level: "success", action: OPEN_DIALOG };
  }
  return { title: "herdr-dock update failed", body: firstLine(result?.reason) || "unknown error", level: "error", action: OPEN_DIALOG };
}

// update.start: the dialog is opening the update tab.
export function startState(prev, now) {
  return { ...(prev && typeof prev === "object" ? prev : {}), status: "updating", reason: null, startedAt: now };
}

// The failed state when an update has run TIMEOUT_MS with no result, else null.
export function timedOut(state, now) {
  if (state?.status !== "updating" || typeof state.startedAt !== "number") return null;
  if (now - state.startedAt < TIMEOUT_MS) return null;
  return { ...state, status: "failed", reason: "no result (was the update tab closed?)", startedAt: null };
}

// What dock-core's nextCommand() string asks for: { cmd: "check" | "start" }, or null.
export function parseUpdateCommand(c) {
  if (c === "update.check") return { cmd: "check" };
  if (c === "update.start") return { cmd: "start" };
  return null;
}
