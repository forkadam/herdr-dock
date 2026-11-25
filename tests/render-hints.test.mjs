// The Render panel's diagram hints for Claude Code (src/shared/render/hints.js, src/app/render-hint.js).
import test from "node:test";
import assert from "node:assert/strict";
import { HINT, HINT_PHRASE, REMINDER, hintCommand, hintDecision, hintOutput, hintsPlan, prismantisHints } from "../src/shared/render/hints.js";

const IN = { HC_TERMINAL_ID: "t1" };
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
  assert.equal(hintOutput("session", { env: { HC_TERMINAL_ID: "" }, settingsText: null }), "");
  assert.equal(hintOutput("session", { env: IN, settingsText: PRISM() }), "");
  assert.equal(hintOutput("session", { env: IN, settingsText: "{ not json" }), "");
  assert.equal(hintOutput("other", { env: IN, settingsText: null }), "");
});

test("hintOutput: in Herdr by HC_TERMINAL_ID, HC_SCOPE or HERDR_PANE_ID; empty ones don't count", () => {
  for (const env of [{ HC_TERMINAL_ID: "t1" }, { HC_SCOPE: "0-abc" }, { HERDR_PANE_ID: "p1" }])
    assert.notEqual(hintOutput("prompt", { env, settingsText: null }), "", JSON.stringify(env));
  assert.equal(hintOutput("prompt", { env: { HC_TERMINAL_ID: "", HC_SCOPE: "", HERDR_PANE_ID: "" }, settingsText: null }), "");
});

test("hintDecision: spoke (with its output), not-herdr, prismantis, settings-invalid; null for an unknown event", () => {
  const d = (env, settingsText = null) => hintDecision("prompt", { env, settingsText });
  assert.equal(d(IN).decision, "spoke");
  assert.equal(d(IN).output, hintOutput("prompt", { env: IN, settingsText: null }));
  assert.deepEqual(d({}), { decision: "not-herdr", output: "" });
  assert.deepEqual(d(IN, PRISM()), { decision: "prismantis", output: "" });
  assert.deepEqual(d(IN, "{ nope"), { decision: "settings-invalid", output: "" });
  assert.equal(hintDecision("other", { env: IN, settingsText: null }), null);
});

test("HINT_PHRASE is in both the note and the reminder", () => {
  assert.ok(HINT_PHRASE && HINT.includes(HINT_PHRASE) && REMINDER.includes(HINT_PHRASE));
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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const HINT_JS = join(import.meta.dirname, "..", "src", "app", "render-hint.js");
const hook = (event, env, settings) => {
  const dir = mkdtempSync(join(tmpdir(), "hint-"));
  try {
    if (settings != null) writeFileSync(join(dir, "settings.json"), settings);
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !["HC_TERMINAL_ID", "HC_SCOPE", "HERDR_PANE_ID"].includes(k)));
    return spawnSync(process.execPath, [HINT_JS, event], { encoding: "utf8", env: { ...clean, CLAUDE_CONFIG_DIR: dir, ...env } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("the script: prints the hook JSON in Herdr; nothing outside it; exit 0 either way", () => {
  const r = hook("session", { HC_TERMINAL_ID: "t1" }, "{}");
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, HINT);
  const out = hook("prompt", {}, "{}");
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "");
});

test("the script: broken settings print nothing; prismantis on prints nothing", () => {
  assert.equal(hook("session", { HC_TERMINAL_ID: "t1" }, "{ broken").stdout, "");
  assert.equal(hook("session", { HC_TERMINAL_ID: "t1" }, PRISM()).stdout, "");
  assert.equal(hook("session", { HC_TERMINAL_ID: "t1" }, PRISM({ diagramHints: false })).status, 0);
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
    assert.equal(JSON.parse(readFileSync(join(claude, "settings.json"), "utf8")).hooks.SessionStart[0].hooks[0].command, `node "${resolve("/x/herdr-hint.mjs").replace(/\\/g, "/")}" session`);
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

// ---- The hook's record of each prompt run (<app home>/herdr-dock/hint-runs/<session id>/<prompt id>.json) ----
import { existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { HINT_RUNS } from "../src/shared/render/hint-phrase.js";

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !["HC_TERMINAL_ID", "HC_SCOPE", "HERDR_PANE_ID"].includes(k)));
const runHook = (event, { env = {}, input = "", settings = "{}" } = {}) => {
  const app = mkdtempSync(join(tmpdir(), "hint-app-"));
  const claude = mkdtempSync(join(tmpdir(), "hint-cfg-"));
  writeFileSync(join(claude, "settings.json"), settings);
  const before = Date.now();
  const r = spawnSync(process.execPath, [HINT_JS, event], { encoding: "utf8", input, env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: claude, DOCK_APP_HOME: app, ...env } });
  const root = join(app, ...HINT_RUNS.split("/"));
  const files = [];
  if (existsSync(root)) for (const s of readdirSync(root)) for (const p of readdirSync(join(root, s))) files.push(`${s}/${p}`);
  const out = { r, files, before, after: Date.now(), record: files.length ? JSON.parse(readFileSync(join(root, ...files[0].split("/")), "utf8")) : null };
  rmSync(app, { recursive: true, force: true });
  rmSync(claude, { recursive: true, force: true });
  return out;
};
const IDS = { session_id: "s-1", prompt_id: "p-1", hook_event_name: "UserPromptSubmit", prompt: "hi" };

test("HINT_RUNS: where the hook's records go, under the app home", () => assert.equal(HINT_RUNS, "herdr-dock/hint-runs"));

test("the script records each prompt run under its session and prompt: when, and what it decided", () => {
  const spoke = runHook("prompt", { env: { HC_TERMINAL_ID: "t1" }, input: JSON.stringify(IDS) });
  assert.equal(spoke.r.status, 0);
  assert.equal(JSON.parse(spoke.r.stdout).hookSpecificOutput.additionalContext, REMINDER);
  assert.deepEqual(spoke.files, ["s-1/p-1.json"]);
  assert.equal(spoke.record.decision, "spoke");
  assert.ok(spoke.record.at >= spoke.before && spoke.record.at <= spoke.after);
  assert.equal(runHook("prompt", { input: JSON.stringify(IDS) }).record.decision, "not-herdr");
  assert.equal(runHook("prompt", { env: { HC_TERMINAL_ID: "t1" }, input: JSON.stringify(IDS), settings: PRISM() }).record.decision, "prismantis");
});

test("the script records no session-start run, and nothing for a bad or missing session or prompt id or input that isn't JSON", () => {
  assert.deepEqual(runHook("session", { env: { HC_TERMINAL_ID: "t1" }, input: JSON.stringify(IDS) }).files, []);
  const bad = [{ ...IDS, session_id: "../x" }, { ...IDS, session_id: "a/b" }, { ...IDS, session_id: "a\b" }, { ...IDS, session_id: "" },
    { ...IDS, prompt_id: "../p" }, { ...IDS, prompt_id: undefined }, {}];
  for (const input of [...bad.map((o) => JSON.stringify(o)), "not json", ""]) {
    const x = runHook("prompt", { env: { HC_TERMINAL_ID: "t1" }, input });
    assert.equal(x.r.status, 0, input);
    assert.deepEqual(x.files, [], input);
    assert.equal(JSON.parse(x.r.stdout).hookSpecificOutput.additionalContext, REMINDER, input);
  }
});

test("the script doesn't wait long for input that never ends: the hint is printed, it exits 0 within a few seconds", async () => {
  const claude = mkdtempSync(join(tmpdir(), "hint-cfg-"));
  writeFileSync(join(claude, "settings.json"), "{}");
  const start = Date.now();
  const child = spawn(process.execPath, [HINT_JS, "prompt"], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: claude, DOCK_APP_HOME: claude, HC_TERMINAL_ID: "t1" } });
  let stdout = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stdin.write('{"session_id":"s-1"'); // and never closed
  const code = await new Promise((done) => { const t = setTimeout(() => { child.kill(); done("hung"); }, 8000); child.on("exit", (c) => { clearTimeout(t); done(c); }); });
  rmSync(claude, { recursive: true, force: true });
  assert.equal(code, 0);
  // It lets stdin go after STDIN_WAIT_MS (2 s): well before the 5 s fallback that only guards against a stuck handle.
  assert.ok(Date.now() - start < 4000, `took ${Date.now() - start} ms`);
  assert.equal(JSON.parse(stdout).hookSpecificOutput.additionalContext, REMINDER);
});

// ---- Writing a record (src/shared/render/hint-record.js) ----
import { writeRecord } from "../src/shared/render/hint-record.js";

test("writeRecord: makes the folder, writes through a temp file, and tries once more if the folder vanished meanwhile", () => {
  const dir = mkdtempSync(join(tmpdir(), "hint-rec-"));
  try {
    writeRecord(join(dir, "s-1"), "p-1.json", '{"a":1}');
    assert.equal(readFileSync(join(dir, "s-1", "p-1.json"), "utf8"), '{"a":1}');
    assert.deepEqual(readdirSync(join(dir, "s-1")), ["p-1.json"]);
    // The Render helper's tidy-up removed the empty session folder between mkdir and write.
    let first = true;
    const real = { mkdirSync, writeFileSync, renameSync: (a, b) => renameSync(a, b) };
    const racy = { ...real, writeFileSync: (p, t) => { if (first) { first = false; const e = new Error("gone"); e.code = "ENOENT"; throw e; } return writeFileSync(p, t); } };
    writeRecord(join(dir, "s-2"), "p-2.json", '{"b":2}', racy);
    assert.equal(readFileSync(join(dir, "s-2", "p-2.json"), "utf8"), '{"b":2}');
    const always = { ...real, writeFileSync: () => { const e = new Error("gone"); e.code = "ENOENT"; throw e; } };
    assert.throws(() => writeRecord(join(dir, "s-3"), "p-3.json", "{}", always), /gone/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
