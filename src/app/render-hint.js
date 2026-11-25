// The Render panel's diagram hints, as Claude Code hooks (bundled into mods/dock-render/herdr-hint.mjs; deploy adds
// both to ~/.claude/settings.json):
//
//   node herdr-hint.mjs session    SessionStart (start, /clear, compaction): the note on what the panel draws
//   node herdr-hint.mjs prompt     UserPromptSubmit: a one-line reminder
//
// Prints the hook's JSON, or nothing outside Herdr, while prismantis's own hints are on, when settings.json doesn't
// parse, or on any error. Always exits 0, so a prompt is never held up. Settings: $CLAUDE_CONFIG_DIR/settings.json,
// else ~/.claude/settings.json.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hintOutput } from "../shared/render/hints.js";

try {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  let settingsText = null;
  try { settingsText = readFileSync(join(dir, "settings.json"), "utf8"); } catch (e) { if (e?.code !== "ENOENT") throw e; }
  const out = hintOutput(process.argv[2], { env: process.env, settingsText });
  if (out) process.stdout.write(out + "\n");
} catch {
  // Quiet: a hint is never worth a failed prompt.
}
