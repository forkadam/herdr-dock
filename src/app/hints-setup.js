// Adds the Render panel's diagram-hint hooks (mods/dock-render/herdr-hint.mjs) to Claude Code's settings.json:
// a SessionStart entry (the note) and a UserPromptSubmit entry (the reminder). `npm run deploy` calls setupHints, the
// way it sets up the status line. A changed settings.json is first copied to settings.json.bak-herdr-dock; the
// person's own hooks are kept.
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hintsPlan } from "../shared/render/hints.js";
import { slashPath } from "../shared/path.js";

const readOrNull = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// -> { state: present | added | updated | invalid | no-claude, changed, message }.
export function setupHints({ claudeHome, script, dry = false }) {
  if (!existsSync(claudeHome)) {
    return { state: "no-claude", changed: false, message: `no ${slashPath(claudeHome)}: Claude Code isn't set up here; nothing to do` };
  }
  const settingsPath = join(claudeHome, "settings.json");
  const where = slashPath(settingsPath);
  const text = readOrNull(settingsPath);
  const plan = hintsPlan(text, script);
  if (plan.state === "invalid") return { state: "invalid", changed: false, message: `${where}: ${plan.error}; not changed` };
  if (plan.state === "present") return { state: "present", changed: false, message: `already in ${where}` };
  const state = plan.state === "missing" ? "added" : "updated";
  const what = state === "added" ? `add the SessionStart and UserPromptSubmit hooks to ${where}` : `point the hooks in ${where} at ${slashPath(script)}`;
  if (dry) return { state, changed: false, message: `would ${what}` };
  if (text != null) copyFileSync(settingsPath, settingsPath + ".bak-herdr-dock");
  const tmp = `${settingsPath}.tmp-herdr-dock-${process.pid}`;
  try {
    writeFileSync(tmp, plan.text);
    renameSync(tmp, settingsPath);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { state, changed: true, message: `${what[0].toUpperCase()}${what.slice(1)}` + (text != null ? " (backup: settings.json.bak-herdr-dock)" : "") };
}
