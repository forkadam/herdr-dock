// src/app/render-hint.js
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
var REMINDER = "The Render panel beside this terminal draws ```mermaid, ```figure, tables and alerts as the session-start note describes: add a picture when it is easier to see than read, and put commands in fenced blocks.";
var isObj2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function prismantisHints(settings) {
  const plugins = isObj2(settings?.enabledPlugins) ? settings.enabledPlugins : {};
  return Object.entries(plugins).some(([key, on]) => {
    if (!key.startsWith("prismantis@") || on !== true) return false;
    const o = settings.pluginConfigs?.[key]?.options;
    return !(isObj2(o) && (o.enabled === false || o.mermaid === false || o.diagramHints === false));
  });
}
var EVENTS = { session: "SessionStart", prompt: "UserPromptSubmit" };
function hintOutput(event, { env, settingsText }) {
  const name = EVENTS[event];
  if (!name || !env?.HC_TERMINAL_ID) return "";
  const r = readSettings(settingsText);
  if (!r.ok || prismantisHints(r.settings)) return "";
  return JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: event === "session" ? HINT : REMINDER } });
}

// src/app/render-hint.js
try {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  let settingsText = null;
  try {
    settingsText = readFileSync(join(dir, "settings.json"), "utf8");
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
  const out = hintOutput(process.argv[2], { env: process.env, settingsText });
  if (out) process.stdout.write(out + "\n");
} catch {
}
