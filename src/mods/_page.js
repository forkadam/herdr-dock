// Dock pages helpers for mods (bundled into each mod that uses them).
import { setShared, shared } from "herdr";
import { PAGE_KEY } from "../shared/panel.js";

// Back to the terminal: a click on a tab, space, agent or worktree means "show me that terminal", even when it
// is the one already focused (which no focus change would reveal).
export function showTerminal() {
  if ((shared(PAGE_KEY) ?? null) !== null) setShared(PAGE_KEY, null);
}

// Whether this page is the one shown (a page can pause its timers while hidden).
export const pageShown = (myMod) => shared(PAGE_KEY) === myMod;
