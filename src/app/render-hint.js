// The Render panel's diagram hints, as Claude Code hooks (bundled into mods/dock-render/herdr-hint.mjs; deploy adds
// both to ~/.claude/settings.json):
//
//   node herdr-hint.mjs session    SessionStart (start, /clear, compaction): the note on what the panel draws
//   node herdr-hint.mjs prompt     UserPromptSubmit: a one-line reminder
//
// Prints the hook's JSON, or nothing outside Herdr, while prismantis's own hints are on, when settings.json doesn't
// parse, or on any error. Always exits 0, so a prompt is never held up. Settings: $CLAUDE_CONFIG_DIR/settings.json,
// else ~/.claude/settings.json.
//
// Each run is also recorded for Render's check, from the session_id Claude Code passes on stdin:
// <app home>/herdr-dock/hint-runs/<session id>.json = { at, event, decision } (hints.js, hintDecision). App home:
// two folders up from this script (<app home>/mods/dock-render/), or $DOCK_APP_HOME. No usable id, no record.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hintDecision } from "../shared/render/hints.js";

const SESSION_ID = /^[A-Za-z0-9-]{1,128}$/;

function record(input, event, decision) {
  let id;
  try { id = JSON.parse(input)?.session_id; } catch { return; }
  if (typeof id !== "string" || !SESSION_ID.test(id)) return;
  const home = process.env.DOCK_APP_HOME || resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dir = join(home, "herdr-dock", "hint-runs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ at: Date.now(), event, decision }));
  renameSync(tmp, file);
}

try {
  const event = process.argv[2];
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  let settingsText = null;
  try { settingsText = readFileSync(join(dir, "settings.json"), "utf8"); } catch (e) { if (e?.code !== "ENOENT") throw e; }
  const d = hintDecision(event, { env: process.env, settingsText });
  if (d?.output) process.stdout.write(d.output + "\n");
  if (d) {
    let input = "";
    try { if (!process.stdin.isTTY) input = readFileSync(0, "utf8"); } catch {}
    try { record(input, event, d.decision); } catch {}
  }
} catch {
  // Quiet: a hint is never worth a failed prompt.
}
