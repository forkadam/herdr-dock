// The Render panel's diagram hints for Claude Code (pure; no Node built-ins): the note telling Claude what the panel
// draws, given once per session (Claude Code's SessionStart hook: start, /clear, compaction), and a one-line reminder
// on each prompt (UserPromptSubmit). Both are quiet outside Herdr (none of HC_TERMINAL_ID, HC_SCOPE or HERDR_PANE_ID:
// Herdr sets the first two in each of its terminals) and while prismantis's own hints are on, so there's never a
// plain-terminal note nor two notes at once.
// The wording is adapted from prismantis 0.20.0's HINT and FIGURE_HINT (hooks/register.tsx, hooks/figure.tsx): https://github.com/NahumLitvin/prismantis (MIT).
import { FIGURE_MAX_COLUMNS, FIGURE_MAX_LINES } from "./figure-limits.js";
import { readSettings } from "../statusline.js";

// In a hook's command: says the entry is herdr-dock's.
export const HINT_MARK = "herdr-hint";

// In both the note and the reminder: how Render finds them in a session's log (transcript.js, hintReach).
export { HINT_PHRASE } from "./hint-phrase.js";

// Whether a hook runs in a Herdr terminal: any of its variables set. One renamed variable can't silence the hints.
const inHerdr = (env) => ["HC_TERMINAL_ID", "HC_SCOPE", "HERDR_PANE_ID"].some((k) => typeof env?.[k] === "string" && env[k] !== "");

const GLYPHS = "─│┌┐└┘├┤┬┴┼═║→←►◄▲▼✓✗●○█▏■□·";

export const HINT = [
  [
    "Replies in this session are also drawn in the Render panel beside this terminal (herdr-dock, in the Herdr app); it is not a command or tool to call.",
    "Markdown tables, GitHub alerts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]), fenced code with a language tag, and ```mermaid blocks are drawn there:",
    "flowchart, sequenceDiagram, stateDiagram-v2, classDiagram and erDiagram diagrams, and xychart-beta bar or line charts.",
    "When a reply carries a numeric series or a flow that is easier to see than read, add a small diagram or chart with short labels, not a second picture of what a figure already shows.",
    "Skip diagrams and pictures for short or simple answers.",
    "Put any command or snippet the user may run or copy in a fenced block with a language tag, never inline code: fenced blocks get a copy button, inline code does not.",
  ].join(" "),
  [
    "A fenced block whose opening line is exactly ```figure is drawn as a text picture, as written.",
    "Prefer one over mermaid when position carries meaning: durations racing on a time axis, a screen layout, phases, before/after; mermaid stays for plain flows and charts; none for short answers, code changes or reports. The prose never retells the picture.",
    "When the user asks you to explain, compare or plan something and pictures would make it easier to grasp, build the reply around them, with the core on the first screen as a picture or a sentence.",
    "Color with {role:text}, not nested: accent for lines, warn for risk, ok for healthy, note for time, dim for asides, strong for emphasis.",
    `At most ${FIGURE_MAX_COLUMNS} columns and ${FIGURE_MAX_LINES} lines, glyphs one column wide such as ${GLYPHS}, no emoji or tabs; markup takes no columns, so align on the drawn text. Draw a time axis with edge ticks like ▏───▏───▏, not ├┼┤: █ fills its cell, ├┼┤ sit mid-cell.`,
  ].join(" "),
].join("\n");

export const REMINDER = "The Render panel beside this terminal draws ```mermaid, ```figure, tables and alerts as the session-start note describes: add a picture when it is easier to see than read, and put commands in fenced blocks.";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Whether prismantis is sending its own diagram hints: a prismantis@… plugin enabled, and none of its enabled,
// mermaid or diagramHints options set to false.
export function prismantisHints(settings) {
  const plugins = isObj(settings?.enabledPlugins) ? settings.enabledPlugins : {};
  return Object.entries(plugins).some(([key, on]) => {
    if (!key.startsWith("prismantis@") || on !== true) return false;
    const o = settings.pluginConfigs?.[key]?.options;
    return !(isObj(o) && (o.enabled === false || o.mermaid === false || o.diagramHints === false));
  });
}

const EVENTS = { session: "SessionStart", prompt: "UserPromptSubmit" };

// The hook's stdout for an event ("session" | "prompt"), or "" when it should stay quiet. settingsText: Claude Code's
// settings.json (null when missing); one that doesn't parse keeps it quiet, as prismantis may be on.
export function hintOutput(event, { env, settingsText }) {
  return hintDecision(event, { env, settingsText })?.output ?? "";
}

// What the hook does for an event, and why: { decision, output } with decision "spoke" (output is the hook's JSON),
// "not-herdr", "prismantis" or "settings-invalid" (output ""); null for an event it doesn't know. The decision goes in
// the hook's record of the run, which Render reads to say why hints aren't arriving.
export function hintDecision(event, { env, settingsText }) {
  const name = EVENTS[event];
  if (!name) return null;
  if (!inHerdr(env)) return { decision: "not-herdr", output: "" };
  const r = readSettings(settingsText);
  if (!r.ok) return { decision: "settings-invalid", output: "" };
  if (prismantisHints(r.settings)) return { decision: "prismantis", output: "" };
  return { decision: "spoke", output: JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: event === "session" ? HINT : REMINDER } }) };
}

// A hook's command: node with the script's path in double quotes (forward slashes), then the event.
export const hintCommand = (script, event) => `node "${String(script).replace(/\\/g, "/")}" ${event}`;

// What setup would do to settings.json text (null: no file) for the script at `script`:
//   { state: "present" }                 both entries are there, pointing at the script
//   { state: "missing", text }           `text` adds what's missing (and fixes a moved path)
//   { state: "moved", text }             `text` points the entries at the script's new path
//   { state: "invalid", error }          settings.json (or its hooks) can't be read; left alone
// The person's own hooks are kept; ours are found by HINT_MARK in their command.
export function hintsPlan(settingsText, script) {
  const r = readSettings(settingsText);
  if (!r.ok) return { state: "invalid", error: r.error };
  const settings = r.settings;
  if (settings.hooks !== undefined && !isObj(settings.hooks)) return { state: "invalid", error: "hooks is not an object" };
  const hooks = settings.hooks ?? (settings.hooks = {});
  let added = false, moved = false;
  for (const [event, name] of Object.entries(EVENTS)) {
    if (hooks[name] !== undefined && !Array.isArray(hooks[name])) return { state: "invalid", error: `hooks.${name} is not a list` };
    const groups = hooks[name] ?? (hooks[name] = []);
    const want = hintCommand(script, event);
    const ours = groups.flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : []))
      .find((h) => typeof h?.command === "string" && h.command.includes(HINT_MARK));
    if (!ours) { groups.push({ hooks: [{ type: "command", command: want }] }); added = true; }
    else if (ours.command !== want) { ours.command = want; moved = true; }
  }
  if (!added && !moved) return { state: "present" };
  const nl = settingsText && String(settingsText).includes("\r\n") ? "\r\n" : "\n";
  return { state: added ? "missing" : "moved", text: JSON.stringify(settings, null, 2).replace(/\n/g, nl) + nl };
}
