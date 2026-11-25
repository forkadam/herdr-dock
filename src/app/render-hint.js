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
// Each prompt run is also recorded for Render's check, from the ids Claude Code passes on stdin (session_id, the
// transcript's file name; prompt_id, the prompt line's promptId): <app home>/<HINT_RUNS>/<session id>/<prompt id>.json
// = { at, decision } (hints.js, hintDecision). App home: two folders up from this script (<app home>/mods/dock-render/),
// or $DOCK_APP_HOME. No usable ids, no record. Input is waited for at most STDIN_WAIT_MS (Claude Code closes it at
// once; a hand run might not), after the hint is printed.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hintDecision } from "../shared/render/hints.js";
import { HINT_RUNS } from "../shared/render/hint-phrase.js";

const ID = /^[A-Za-z0-9-]{1,128}$/;
const STDIN_WAIT_MS = 2000;

function record(input, decision) {
  let ids;
  try { ids = JSON.parse(input); } catch { return; }
  const session = ids?.session_id, prompt = ids?.prompt_id;
  if (typeof session !== "string" || !ID.test(session) || typeof prompt !== "string" || !ID.test(prompt)) return;
  const home = process.env.DOCK_APP_HOME || resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dir = join(home, ...HINT_RUNS.split("/"), session);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${prompt}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ at: Date.now(), decision }));
  renameSync(tmp, file);
}

// stdin as text, or "" when it's a terminal, fails, or hasn't ended within STDIN_WAIT_MS.
function readInput() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((done) => {
    let text = "";
    const timer = setTimeout(() => done(""), STDIN_WAIT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => { text += d; });
    process.stdin.on("end", () => { clearTimeout(timer); done(text); });
    process.stdin.on("error", () => { clearTimeout(timer); done(""); });
  });
}

async function main() {
  const event = process.argv[2];
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  let settingsText = null;
  try { settingsText = readFileSync(join(dir, "settings.json"), "utf8"); } catch (e) { if (e?.code !== "ENOENT") throw e; }
  const d = hintDecision(event, { env: process.env, settingsText });
  if (d?.output) process.stdout.write(d.output + "\n");
  if (d && event === "prompt") {
    const input = await readInput();
    try { record(input, d.decision); } catch {}
  }
}

// Quiet on any error, and never left waiting: a hint is never worth a failed or held prompt. The process ends by
// itself once stdin is let go (no process.exit right after printing: on macOS a pipe is written asynchronously, so the
// hint could be cut off); the unref'd timer only fires if something else still holds it open.
process.exitCode = 0;
setTimeout(() => process.exit(0), STDIN_WAIT_MS + 3000).unref();
main().catch(() => {}).finally(() => { try { process.stdin.destroy(); } catch {} });
