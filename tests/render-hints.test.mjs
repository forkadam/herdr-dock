// The Render panel's diagram hints for Claude Code (src/shared/render/hints.js, src/app/render-hint.js).
import test from "node:test";
import assert from "node:assert/strict";
import { HINT, REMINDER, hintCommand, hintOutput, hintsPlan, prismantisHints } from "../src/shared/render/hints.js";

const IN = { HERDR_PANE_ID: "p1" };
const PRISM = (options = {}) => JSON.stringify({ enabledPlugins: { "prismantis@prismantis": true }, pluginConfigs: { "prismantis@prismantis": { options } } });
const SCRIPT = "/Users/a/.config/herdr-app/mods/dock-render/herdr-hint.mjs";

test("HINT: the panel, what it draws, the figure rules with the panel's limits; REMINDER is one short line", () => {
  for (const s of ["Render panel", "```mermaid", "xychart-beta", "stateDiagram", "erDiagram", "[!CAUTION]", "```figure", "{role:text}", "100 columns", "80 lines", "copy button"]) assert.ok(HINT.includes(s), s);
  assert.ok(!HINT.includes("74 columns"));
  assert.ok(!REMINDER.includes("\n") && REMINDER.length < 300);
  assert.match(REMINDER, /Render panel/);
});

test("hintOutput: in Herdr, the note at session start and the reminder on a prompt", () => {
  assert.deepEqual(JSON.parse(hintOutput("session", { env: IN, settingsText: null })), { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: HINT } });
  assert.deepEqual(JSON.parse(hintOutput("prompt", { env: IN, settingsText: "{}" })), { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: REMINDER } });
});

test("hintOutput: quiet outside Herdr, while prismantis's hints are on, with broken settings, for an unknown event", () => {
  assert.equal(hintOutput("session", { env: {}, settingsText: null }), "");
  assert.equal(hintOutput("session", { env: { HERDR_PANE_ID: "" }, settingsText: null }), "");
  assert.equal(hintOutput("session", { env: IN, settingsText: PRISM() }), "");
  assert.equal(hintOutput("session", { env: IN, settingsText: "{ not json" }), "");
  assert.equal(hintOutput("other", { env: IN, settingsText: null }), "");
});

test("prismantisHints: on unless the plugin is off or its enabled, mermaid or diagramHints option is false", () => {
  assert.equal(prismantisHints(JSON.parse(PRISM())), true);
  assert.equal(prismantisHints({}), false);
  assert.equal(prismantisHints({ enabledPlugins: { "prismantis@prismantis": false } }), false);
  for (const k of ["enabled", "mermaid", "diagramHints"]) assert.equal(prismantisHints(JSON.parse(PRISM({ [k]: false }))), false, k);
  assert.equal(prismantisHints({ enabledPlugins: { "prismantis@other-market": true } }), true);
});

test("hintsPlan: no hooks adds both entries and keeps the other settings", () => {
  const p = hintsPlan(JSON.stringify({ theme: "dark" }), SCRIPT);
  assert.equal(p.state, "missing");
  const s = JSON.parse(p.text);
  assert.equal(s.theme, "dark");
  assert.deepEqual(s.hooks.SessionStart, [{ hooks: [{ type: "command", command: hintCommand(SCRIPT, "session") }] }]);
  assert.deepEqual(s.hooks.UserPromptSubmit, [{ hooks: [{ type: "command", command: hintCommand(SCRIPT, "prompt") }] }]);
  assert.equal(hintCommand(SCRIPT, "prompt"), `node "${SCRIPT}" prompt`);
  assert.deepEqual(hintsPlan(p.text, SCRIPT), { state: "present" });
});

test("hintsPlan: other hooks are kept; a moved script is updated in place", () => {
  const theirs = { hooks: [{ type: "command", command: "echo mine" }] };
  const p = hintsPlan(JSON.stringify({ hooks: { UserPromptSubmit: [theirs] } }), SCRIPT);
  assert.deepEqual(JSON.parse(p.text).hooks.UserPromptSubmit, [theirs, { hooks: [{ type: "command", command: hintCommand(SCRIPT, "prompt") }] }]);
  const moved = hintsPlan(p.text, "/new/place/herdr-hint.mjs");
  assert.equal(moved.state, "moved");
  const s = JSON.parse(moved.text);
  assert.deepEqual(s.hooks.UserPromptSubmit, [theirs, { hooks: [{ type: "command", command: 'node "/new/place/herdr-hint.mjs" prompt' }] }]);
  assert.equal(s.hooks.SessionStart.length, 1);
});

test("hintsPlan: a BOM-prefixed file reads; invalid JSON is left alone", () => {
  assert.equal(hintsPlan("\uFEFF{}", SCRIPT).state, "missing");
  assert.equal(hintsPlan("{ nope", SCRIPT).state, "invalid");
});
