// herdr-dock's own update state (pure; no host imports). dock-core checks GitHub's main, publishes
// dock.update.state for the Dock layout dialog, notifies once per new upstream commit, and reads the result
// file the update script (scripts/update.mjs) writes.
//
// dock.update.state = { mode: "clone" | "app", status, current, deployed, latest, behind, subject, checkedAt, reason, startedAt } (+ commits
// after an update; + redeploy: true when HEAD isn't the commit the last deploy recorded in source.json and nothing
// is behind, e.g. an update whose install or deploy failed after the pull: Update finishes it). status: "idle" (up to date) | "checking" | "available" | "updating" | "updated" |
// "failed" | "blocked". reason: for "blocked", why Update can't run ("on branch X", "N local commits",
// "local changes in the repo": the dialog shows "Can't update: <reason>"); for "failed", the sentence to show
// after a failed check ("Can't check: <git's first line>") or what went wrong in an update. App mode (appUpdateState)
// has no deployed, behind, subject, blocked or redeploy; it adds version (the published content version).

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
export function updateState({ fetchOk, fetchError, branch, ahead, behind, latest, subject, current, dirty, deployed }, now, prev = null) {
  const common = { current: current ?? prev?.current ?? null, deployed: deployed ?? prev?.deployed ?? null, checkedAt: now, startedAt: null };
  if (!fetchOk) {
    return {
      status: "failed", latest: prev?.latest ?? null, behind: prev?.behind ?? null, subject: prev?.subject ?? null,
      ...common, reason: `Can't check: ${firstLine(fetchError) || "git fetch failed"}`,
    };
  }
  const s = { status: "idle", ...common, latest: latest ?? null, behind: behind ?? 0, subject: subject ?? null, reason: null };
  // HEAD isn't what was deployed: Update redeploys it (local changes block that too: the script refuses them).
  const redeploy = s.behind === 0 && !!s.deployed && !!s.current && s.deployed !== s.current;
  const reason = blockReason({ branch, ahead: ahead ?? 0, behind: redeploy ? 1 : s.behind, dirty: !!dirty });
  if (reason) return { ...s, status: "blocked", reason };
  if (s.behind > 0) return { ...s, status: "available" };
  if (redeploy) return { ...s, status: "available", redeploy: true };
  if (prev?.status === "updated" && prev.current && prev.current === s.current) {
    return { ...s, status: "updated", commits: prev.commits ?? null };
  }
  return s;
}

// The state after a check of a Herdr-style (app/) install; installed and published are { version, source }.
// state.version is the published content version (what shouldNotify keys on); current/latest are source shas.
export function appUpdateState({ fetchOk, fetchError, installed, published }, now, prev = null) {
  const common = { mode: "app", checkedAt: now, startedAt: null, behind: null, subject: null };
  if (!fetchOk) {
    return {
      ...common, status: "failed", current: installed?.source ?? prev?.current ?? null, latest: prev?.latest ?? null,
      version: prev?.version ?? null, reason: `Can't check: ${firstLine(fetchError) || "fetch failed"}`,
    };
  }
  const s = { ...common, status: "idle", current: installed?.source ?? null, latest: published?.source ?? null, version: published?.version ?? null, reason: null };
  if (published?.version !== installed?.version) return { ...s, status: "available" };
  if (prev?.mode === "app" && prev.status === "updated" && prev.version === s.version) {
    return { ...s, status: "updated", commits: prev.commits ?? null };
  }
  return s;
}

// Notify only for an available update whose upstream sha hasn't been notified yet (a redeploy has no toast).
// App mode keys on the published content version (state.version) instead of a sha.
export function shouldNotify(state, notifiedSha) {
  if (state?.mode === "app") return state.status === "available" && !!state.version && state.version !== notifiedSha;
  return state?.status === "available" && !state.redeploy && !!state.latest && state.latest !== notifiedSha;
}

// The toast for an available update.
// App mode names the installed and published sources (it has no commit count).
export function availableNote(state) {
  const body = state?.mode === "app" ? `${state.current ?? "?"} → ${state.latest ?? "?"}` : plural(state.behind, "new commit");
  return { title: "herdr-dock update available", body, level: "info", action: OPEN_DIALOG };
}

// The state after the update script's result, or null when it isn't a result object. An app-mode prev keeps its
// mode and published version (so the next check still reads "updated").
export function resultToState(result, prev, _now) {
  if (result == null || typeof result !== "object" || Array.isArray(result)) return null;
  const p = prev && typeof prev === "object" ? prev : {};
  // No prev state: the mode from the result (update-app's carry commits: null, the clone script's a number).
  const fromResult = result.commits === null ? "app" : typeof result.commits === "number" ? "clone" : null;
  const mode = prev && typeof prev === "object" ? p.mode : fromResult;
  const app = mode === "app" ? { mode: "app", version: p.version ?? null } : mode ? { mode } : {};
  const s = {
    ...app, status: "idle", current: p.current ?? null, deployed: p.deployed ?? null, latest: p.latest ?? null, behind: p.behind ?? null, subject: p.subject ?? null,
    checkedAt: p.checkedAt ?? null, reason: null, startedAt: null,
  };
  if (result.ok) {
    const to = result.to ?? p.latest ?? null;
    return { ...s, status: "updated", current: to, deployed: to, latest: to, behind: 0, commits: result.commits ?? null };
  }
  return { ...s, status: "failed", reason: firstLine(result.reason) || "unknown error" };
}

// The toast for the update script's result (update-app.mjs reports commits: null: its body is from → to).
export function resultNote(result) {
  if (result?.ok) {
    const body = typeof result.commits === "number" || result.commits === undefined
      ? plural(result.commits ?? 0, "commit") : `${result.from ?? "?"} → ${result.to ?? "?"}`;
    return { title: `herdr-dock updated to ${result.to}`, body, level: "success", action: OPEN_DIALOG };
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
