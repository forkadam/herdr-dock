// src/app/hints-setup.js
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/shared/render/figure-limits.js
var FIGURE_MAX_COLUMNS = 100;
var FIGURE_MAX_LINES = 80;

// src/shared/statusline.js
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function readSettings(text) {
  if (text == null || !String(text).trim()) return { ok: true, settings: {}, command: null };
  let settings;
  try {
    settings = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: `not valid JSON (${e.message})` };
  }
  if (!isObj(settings)) return { ok: false, error: "the root is not an object" };
  const sl = settings.statusLine;
  const command = isObj(sl) && typeof sl.command === "string" && sl.command.trim() ? sl.command : null;
  return { ok: true, settings, command };
}

// src/shared/render/hints.js
var HINT_MARK = "herdr-hint";
var GLYPHS = "\u2500\u2502\u250C\u2510\u2514\u2518\u251C\u2524\u252C\u2534\u253C\u2550\u2551\u2192\u2190\u25BA\u25C4\u25B2\u25BC\u2713\u2717\u25CF\u25CB\u2588\u258F\u25A0\u25A1\xB7";
var HINT = [
  [
    "Replies in this session are also drawn in the Render panel beside this terminal (herdr-dock, in the Herdr app); it is not a command or tool to call.",
    "Markdown tables, GitHub alerts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]), fenced code with a language tag, and ```mermaid blocks are drawn there:",
    "flowchart, sequenceDiagram, stateDiagram-v2, classDiagram and erDiagram diagrams, and xychart-beta bar or line charts.",
    "When a reply carries a numeric series or a flow that is easier to see than read, add a small diagram or chart with short labels, not a second picture of what a figure already shows.",
    "Skip diagrams and pictures for short or simple answers.",
    "Put any command or snippet the user may run or copy in a fenced block with a language tag, never inline code: fenced blocks get a copy button, inline code does not."
  ].join(" "),
  [
    "A fenced block whose opening line is exactly ```figure is drawn as a text picture, as written.",
    "Prefer one over mermaid when position carries meaning: durations racing on a time axis, a screen layout, phases, before/after; mermaid stays for plain flows and charts; none for short answers, code changes or reports. The prose never retells the picture.",
    "When the user asks you to explain, compare or plan something and pictures would make it easier to grasp, build the reply around them, with the core on the first screen as a picture or a sentence.",
    "Color with {role:text}, not nested: accent for lines, warn for risk, ok for healthy, note for time, dim for asides, strong for emphasis.",
    `At most ${FIGURE_MAX_COLUMNS} columns and ${FIGURE_MAX_LINES} lines, glyphs one column wide such as ${GLYPHS}, no emoji or tabs; markup takes no columns, so align on the drawn text. Draw a time axis with edge ticks like \u258F\u2500\u2500\u2500\u258F\u2500\u2500\u2500\u258F, not \u251C\u253C\u2524: \u2588 fills its cell, \u251C\u253C\u2524 sit mid-cell.`
  ].join(" ")
].join("\n");
var isObj2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var EVENTS = { session: "SessionStart", prompt: "UserPromptSubmit" };
var hintCommand = (script, event) => `node "${String(script).replace(/\\/g, "/")}" ${event}`;
function hintsPlan(settingsText, script) {
  const r = readSettings(settingsText);
  if (!r.ok) return { state: "invalid", error: r.error };
  const settings = r.settings;
  if (settings.hooks !== void 0 && !isObj2(settings.hooks)) return { state: "invalid", error: "hooks is not an object" };
  const hooks = settings.hooks ?? (settings.hooks = {});
  let added = false, moved = false;
  for (const [event, name] of Object.entries(EVENTS)) {
    if (hooks[name] !== void 0 && !Array.isArray(hooks[name])) return { state: "invalid", error: `hooks.${name} is not a list` };
    const groups = hooks[name] ?? (hooks[name] = []);
    const want = hintCommand(script, event);
    const ours = groups.flatMap((g) => Array.isArray(g?.hooks) ? g.hooks : []).find((h) => typeof h?.command === "string" && h.command.includes(HINT_MARK));
    if (!ours) {
      groups.push({ hooks: [{ type: "command", command: want }] });
      added = true;
    } else if (ours.command !== want) {
      ours.command = want;
      moved = true;
    }
  }
  if (!added && !moved) return { state: "present" };
  const nl = settingsText && String(settingsText).includes("\r\n") ? "\r\n" : "\n";
  return { state: added ? "missing" : "moved", text: JSON.stringify(settings, null, 2).replace(/\n/g, nl) + nl };
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/app/hints-setup.js
var readOrNull = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
function setupHints({ claudeHome, script, dry = false, backup = true }) {
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`diagram hints setup failed: ${e.message}`);
    process.exitCode = 1;
  }
}
export {
  setupHints
};
