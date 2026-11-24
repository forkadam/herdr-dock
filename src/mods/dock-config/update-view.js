// The Updates strip at the top of the Dock layout dialog (pure): what dock.update.state (src/shared/update.js)
// reads as, its tone, and the one action it offers.
import { formatAge } from "../../shared/claude.js";

const CHECK = { label: "Check now", kind: "check" };
const UPDATE = { label: "Update", kind: "update" };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// updateStrip(state, now) -> { text, tone: "dim"|"accent"|"ok"|"bad", action: null | { label, kind } }.
// App mode (state.mode "app", a Herdr-style install) has no blocked or redeploy (they need a clone): available
// names the installed and published sources, and a stray blocked reads as a failed check.
export function updateStrip(state, now) {
  if (!state || typeof state !== "object") return { text: "herdr-dock · not checked yet", tone: "dim", action: CHECK };
  const reason = String(state.reason ?? "").trim() || "unknown error";
  const app = state.mode === "app";
  if (app && state.status === "available") {
    return { text: `Update available · ${state.current ?? "?"} → ${state.latest ?? "?"}`, tone: "accent", action: UPDATE };
  }
  if (app && state.status === "blocked") {
    return { text: reason.startsWith("Can't check:") ? reason : `Can't check: ${reason}`, tone: "bad", action: CHECK };
  }
  switch (state.status) {
    case "checking":
      return { text: "Checking…", tone: "dim", action: null };
    case "updating":
      return { text: 'Updating… see the "Update herdr-dock" tab', tone: "dim", action: null };
    case "available": {
      // HEAD isn't the deployed commit (an update that stopped after the pull): Update deploys it.
      if (state.redeploy) {
        return { text: `Not deployed yet · ${state.deployed ?? "?"} → ${state.current ?? "?"}`, tone: "accent", action: UPDATE };
      }
      const latest = state.subject ? ` (latest: "${state.subject}")` : "";
      return { text: `Update available · ${plural(state.behind ?? 0, "new commit")}${latest}`, tone: "accent", action: UPDATE };
    }
    case "updated": {
      const commits = typeof state.commits === "number" ? ` · ${plural(state.commits, "commit")}` : "";
      return { text: `✓ Updated to ${state.current ?? "?"}${commits}`, tone: "ok", action: CHECK };
    }
    case "blocked":
      return { text: `Can't update: ${reason}`, tone: "bad", action: CHECK };
    case "failed":
      // A failed fetch's reason already reads "Can't check: …"; a failed update's is bare.
      return { text: reason.startsWith("Can't check:") ? reason : `Update failed: ${reason}`, tone: "bad", action: CHECK };
    default: {
      const sha = state.current ? ` ${state.current}` : "";
      const age = typeof state.checkedAt === "number" ? ` · checked ${formatAge(Math.max(0, now - state.checkedAt))}` : "";
      return { text: `herdr-dock${sha} · up to date${age}`, tone: "dim", action: CHECK };
    }
  }
}

// What the dialog's Update runs, by state.mode: [{ command, args? }], or null when it can't run. Clone mode opens
// scripts/update.mjs in the repo; app mode (no repo) opens the shipped update-app.mjs from the app home.
export function updateRuns(state, { repo, home }) {
  const tab = (folder, argv) => ({ command: "tab.new", args: { name: "Update herdr-dock", folder, argv } });
  if (state?.mode === "app") {
    if (!home) return null;
    return [{ command: "dock-core.update.start" }, tab(home, ["node", `${home}/mods/dock-core/update-app.mjs`])];
  }
  if (!repo) return null;
  return [{ command: "dock-core.update.start" }, tab(repo, ["node", "scripts/update.mjs"])];
}

// An update replaces herdr-dock's mods (clone: scripts/update.mjs deploys; app: update-app.mjs swaps each mods/<name>),
// and Herdr reloads a mod whose files change, so the open dialog would lose its unsaved edits: Update waits for a Save
// or Cancel. Check now deploys nothing and never waits. -> the tip to show, or null.
export const UPDATE_WAITS_TIP = "Save or cancel your layout edits first: updating replaces herdr-dock's mods, which reloads this dialog";
export const updateWaits = ({ kind, dirty }) => (kind === "update" && dirty ? UPDATE_WAITS_TIP : null);
