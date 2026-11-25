// Adds the Render panel's diagram-hint hooks (mods/dock-render/herdr-hint.mjs) to Claude Code's settings.json:
// a SessionStart entry (the note) and a UserPromptSubmit entry (the reminder). `npm run deploy` calls setupHints, the
// way it sets up the status line. A changed settings.json is first copied to settings.json.bak-herdr-dock; the
// person's own hooks are kept. Bundled to mods/dock-render/herdr-hints-setup.mjs for the Herdr-way install and the
// Render panel's Set up:
//
//   node herdr-hints-setup.mjs [--check] [--script <path>]
//
// --check prints what it would do and changes nothing. The script defaults to herdr-hint.mjs beside this file;
// Claude's folder is $DOCK_CLAUDE_HOME, else ~/.claude. Prints "<state>: <message>"; exit 1 when settings.json can't
// be read or setup failed.
import { copyFileSync, existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hintsPlan } from "../shared/render/hints.js";
import { slashPath } from "../shared/path.js";

// The file's text, or null when there is none. Any other read error is thrown: a settings.json that exists but can't
// be read must never look missing, or it would be replaced by one holding only the hooks.
const readOrNull = (p) => {
  try { return readFileSync(p, "utf8"); } catch (e) { if (e?.code === "ENOENT") return null; throw e; }
};

// -> { state: present | added | updated | invalid | no-claude, changed, message }. `backup: false` when this run already
// backed the file up (deploy's status line changed it first), so the backup keeps the file as it was.
export function setupHints({ claudeHome, script, dry = false, backup = true }) {
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
  const backedUp = backup && text != null;
  if (backedUp) copyFileSync(settingsPath, settingsPath + ".bak-herdr-dock");
  const tmp = `${settingsPath}.tmp-herdr-dock-${process.pid}`;
  try {
    writeFileSync(tmp, plan.text);
    renameSync(tmp, settingsPath);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { state, changed: true, message: `${what[0].toUpperCase()}${what.slice(1)}` + (backedUp ? " (backup: settings.json.bak-herdr-dock)" : "") };
}

function main(argv) {
  const at = argv.indexOf("--script");
  const script = resolve(at >= 0 && argv[at + 1] ? argv[at + 1] : join(dirname(fileURLToPath(import.meta.url)), "herdr-hint.mjs"));
  const claudeHome = resolve(process.env.DOCK_CLAUDE_HOME || join(homedir(), ".claude"));
  const r = setupHints({ claudeHome, script: slashPath(script), dry: argv.includes("--check") });
  console.log(`${r.state}: ${r.message}`);
  return r.state === "invalid" ? 1 : 0;
}

// Run as a command (not imported by deploy): argv[1] is this file, compared through realpath (symlinks, 8.3 names).
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`diagram hints setup failed: ${e.message}`); process.exitCode = 1; }
}
