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

// ---- The hook script (src/app/render-hint.js; bundled as mods/dock-render/herdr-hint.mjs) ----
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HINT_JS = join(import.meta.dirname, "..", "src", "app", "render-hint.js");
const hook = (event, env, settings) => {
  const dir = mkdtempSync(join(tmpdir(), "hint-"));
  try {
    if (settings != null) writeFileSync(join(dir, "settings.json"), settings);
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "HERDR_PANE_ID"));
    return spawnSync(process.execPath, [HINT_JS, event], { encoding: "utf8", env: { ...clean, CLAUDE_CONFIG_DIR: dir, ...env } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("the script: prints the hook JSON in Herdr; nothing outside it; exit 0 either way", () => {
  const r = hook("session", { HERDR_PANE_ID: "p1" }, "{}");
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, HINT);
  const out = hook("prompt", {}, "{}");
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "");
});

test("the script: broken settings print nothing; prismantis on prints nothing", () => {
  assert.equal(hook("session", { HERDR_PANE_ID: "p1" }, "{ broken").stdout, "");
  assert.equal(hook("session", { HERDR_PANE_ID: "p1" }, PRISM()).stdout, "");
  assert.equal(hook("session", { HERDR_PANE_ID: "p1" }, PRISM({ diagramHints: false })).status, 0);
});

// ---- The setup command (src/app/hints-setup.js; bundled as mods/dock-render/herdr-hints-setup.mjs) ----
const SETUP_JS = join(import.meta.dirname, "..", "src", "app", "hints-setup.js");
const setupCli = (args, claude) => spawnSync(process.execPath, [SETUP_JS, ...args], { encoding: "utf8", env: { ...process.env, DOCK_CLAUDE_HOME: claude } });

test("the setup command: adds the hooks; --check says what it would do and writes nothing; invalid exits 1", () => {
  const claude = mkdtempSync(join(tmpdir(), "hint-claude-"));
  try {
    writeFileSync(join(claude, "settings.json"), "{}");
    const check = setupCli(["--check", "--script", "/x/herdr-hint.mjs"], claude);
    assert.equal(check.status, 0);
    assert.match(check.stdout, /^added: would add/);
    assert.equal(readFileSync(join(claude, "settings.json"), "utf8"), "{}");
    const r = setupCli(["--script", "/x/herdr-hint.mjs"], claude);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^added: /);
    assert.equal(JSON.parse(readFileSync(join(claude, "settings.json"), "utf8")).hooks.SessionStart[0].hooks[0].command, 'node "/x/herdr-hint.mjs" session');
    assert.match(setupCli(["--script", "/x/herdr-hint.mjs"], claude).stdout, /^present: /);
    writeFileSync(join(claude, "settings.json"), "{ nope");
    assert.equal(setupCli(["--script", "/x/herdr-hint.mjs"], claude).status, 1);
  } finally { rmSync(claude, { recursive: true, force: true }); }
});

test("the setup command: an unreadable settings.json fails (exit 1) and is left as it was", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const claude = mkdtempSync(join(tmpdir(), "hint-claude-"));
  const file = join(claude, "settings.json");
  try {
    writeFileSync(file, '{ "model": "opus" }');
    chmodSync(file, 0o000);
    const r = setupCli(["--script", "/x/herdr-hint.mjs"], claude);
    chmodSync(file, 0o644);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /^added/);
    assert.equal(readFileSync(file, "utf8"), '{ "model": "opus" }');
  } finally { rmSync(claude, { recursive: true, force: true }); }
});

test("the setup command runs when reached through a symlink", { skip: process.platform === "win32" }, () => {
  const claude = mkdtempSync(join(tmpdir(), "hint-claude-"));
  const links = mkdtempSync(join(tmpdir(), "hint-link-"));
  try {
    writeFileSync(join(claude, "settings.json"), "{}");
    symlinkSync(SETUP_JS, join(links, "hints-setup.js"));
    const r = spawnSync(process.execPath, [join(links, "hints-setup.js"), "--check", "--script", "/x/herdr-hint.mjs"], { encoding: "utf8", env: { ...process.env, DOCK_CLAUDE_HOME: claude } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^added: would add/);
  } finally {
    rmSync(claude, { recursive: true, force: true });
    rmSync(links, { recursive: true, force: true });
  }
});
