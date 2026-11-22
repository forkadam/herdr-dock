// Wires herdr-dock's status-line writer into Claude Code's ~/.claude/settings.json, so Quotas gets Claude's
// 5-hour/weekly limits and Agents each session's context %, with no status line of your own needed.
// Bundled to mods/dock-quotas/herdr-statusline-setup.mjs; `npm run deploy` calls setupStatusline directly.
//
//   node herdr-statusline-setup.mjs [--check] [--writer <path>]
//
// --check prints the state and changes nothing. The writer defaults to herdr-statusline-cache.mjs beside this
// file. A changed settings.json is first copied to settings.json.bak-herdr-dock. Exit code 0 unless it failed.
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { scriptPaths, statuslinePlan } from "../shared/statusline.js";
import { slashPath } from "../shared/path.js";

const readOrNull = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// -> { state, changed, message }. state: fed | missing | other | complex | invalid | no-claude.
export function setupStatusline({ claudeHome, writer, home = homedir(), dry = false }) {
  if (!existsSync(claudeHome)) {
    return { state: "no-claude", changed: false, message: `no ${slashPath(claudeHome)}: Claude Code isn't set up here; nothing to do` };
  }
  const settingsPath = join(claudeHome, "settings.json");
  const text = readOrNull(settingsPath);
  const first = statuslinePlan(text, writer);
  // A command that runs a script: look inside for a writer line added by hand.
  const plan = first.command ? statuslinePlan(text, writer, scriptPaths(first.command, slashPath(home)).map(readOrNull)) : first;
  const where = slashPath(settingsPath);
  switch (plan.state) {
    case "fed": return { state: "fed", changed: false, message: "the Claude status line already feeds herdr-dock" };
    case "invalid": return { state: "invalid", changed: false, message: `${where}: ${plan.error}; not changed` };
    case "complex": return { state: "complex", changed: false,
      message: `your status line (${plan.command}) is more than one command; add the herdr-dock line to it by hand (README, "Where the quota and context numbers come from")` };
  }
  const what = plan.state === "missing"
    ? `add a status line that feeds herdr-dock and prints nothing to ${where}`
    : `put herdr-dock's writer in front of your status line in ${where} (it prints the same)`;
  if (dry) return { state: plan.state, changed: false, message: `would ${what}` };
  if (text != null) copyFileSync(settingsPath, settingsPath + ".bak-herdr-dock");
  const tmp = `${settingsPath}.tmp-herdr-dock-${process.pid}`;
  try {
    writeFileSync(tmp, plan.text);
    renameSync(tmp, settingsPath);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { state: plan.state, changed: true, message: `${what[0].toUpperCase()}${what.slice(1)}` + (text != null ? ` (backup: settings.json.bak-herdr-dock)` : "") };
}

function main(argv) {
  const at = argv.indexOf("--writer");
  const writer = resolve(at >= 0 && argv[at + 1] ? argv[at + 1] : join(dirname(fileURLToPath(import.meta.url)), "herdr-statusline-cache.mjs"));
  if (!existsSync(writer)) { console.error(`no writer at ${slashPath(writer)}`); return 1; }
  const claudeHome = resolve(process.env.DOCK_CLAUDE_HOME || join(homedir(), ".claude"));
  const r = setupStatusline({ claudeHome, writer: slashPath(writer), dry: argv.includes("--check") });
  console.log(`${r.state}: ${r.message}`);
  return r.state === "invalid" ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`status line setup failed: ${e.message}`); process.exitCode = 1; }
}
