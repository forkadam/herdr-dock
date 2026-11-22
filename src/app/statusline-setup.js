// Wires herdr-dock's status-line writer into Claude Code's ~/.claude/settings.json, so Quotas gets Claude's
// 5-hour/weekly limits and Agents each session's context %, with no status line of your own needed.
// Bundled to mods/dock-quotas/herdr-statusline-setup.mjs; `npm run deploy` calls setupStatusline directly.
//
//   node herdr-statusline-setup.mjs [--agy] [--check] [--writer <path>]
//
// --check prints the state and changes nothing. The writer defaults to herdr-statusline-cache.mjs beside this
// file (with --agy: Antigravity's ~/.gemini/antigravity-cli/settings.json and herdr-agy-statusline.mjs). A changed settings.json is first copied to settings.json.bak-herdr-dock. Exit code 0 unless it failed.
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { AGY_MARK, WRITER_MARK, scriptPaths, statuslinePlan } from "../shared/statusline.js";
import { slashPath } from "../shared/path.js";

const readOrNull = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// -> { state, changed, message }. state: fed | missing | other | complex | invalid | no-claude.
// `claudeHome`: the folder holding the tool's settings.json (~/.claude, or Antigravity's ~/.gemini/antigravity-cli);
// `mark` and `name` say whose writer it is (Claude Code's by default).
export function setupStatusline({ claudeHome, writer, home = homedir(), dry = false, mark = WRITER_MARK, name = "Claude Code" }) {
  if (!existsSync(claudeHome)) {
    return { state: "no-claude", changed: false, message: `no ${slashPath(claudeHome)}: ${name} isn't set up here; nothing to do` };
  }
  const settingsPath = join(claudeHome, "settings.json");
  const text = readOrNull(settingsPath);
  const first = statuslinePlan(text, writer, [], mark);
  // A command that runs a script: look inside for a writer line added by hand.
  const plan = first.command ? statuslinePlan(text, writer, scriptPaths(first.command, slashPath(home)).map(readOrNull), mark) : first;
  const where = slashPath(settingsPath);
  switch (plan.state) {
    case "fed": return { state: "fed", changed: false, message: `the ${name === "Claude Code" ? "Claude" : name} status line already feeds herdr-dock` };
    case "invalid": return { state: "invalid", changed: false, message: `${where}: ${plan.error}; not changed` };
    case "complex": return { state: "complex", changed: false,
      message: `your status line (${plan.command}) is more than one command; add the herdr-dock line to it by hand (README, "Where the quota and context numbers come from")` };
  }
  const what = plan.state === "missing"
    ? `add a status line that feeds herdr-dock and prints nothing to ${where} (${name})`
    : `put herdr-dock's writer in front of your status line in ${where} (${name}; it prints the same)`;
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

// --agy: Antigravity's status line (~/.gemini/antigravity-cli/settings.json, writer herdr-agy-statusline.mjs).
function main(argv) {
  const agy = argv.includes("--agy");
  const at = argv.indexOf("--writer");
  const beside = join(dirname(fileURLToPath(import.meta.url)), agy ? "herdr-agy-statusline.mjs" : "herdr-statusline-cache.mjs");
  const writer = resolve(at >= 0 && argv[at + 1] ? argv[at + 1] : beside);
  if (!existsSync(writer)) { console.error(`no writer at ${slashPath(writer)}`); return 1; }
  const claudeHome = agy ? resolve(process.env.DOCK_AGY_HOME || join(homedir(), ".gemini", "antigravity-cli"))
    : resolve(process.env.DOCK_CLAUDE_HOME || join(homedir(), ".claude"));
  const r = setupStatusline({ claudeHome, writer: slashPath(writer), dry: argv.includes("--check"),
    ...(agy ? { mark: AGY_MARK, name: "Antigravity" } : {}) });
  console.log(`${r.state}: ${r.message}`);
  return r.state === "invalid" ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`status line setup failed: ${e.message}`); process.exitCode = 1; }
}
