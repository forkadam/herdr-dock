# Render Diagram Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code sessions in Herdr get herdr-dock's own note that the Render panel draws diagrams, figures, tables and alerts: the full note once per session, a one-line reminder per prompt, quiet while prismantis's hints are on.

**Architecture:** A pure module holds the note, the reminder, the quiet rules and the settings.json plan; a small hook script (bundled into `mods/dock-render/herdr-hint.mjs`) prints Claude Code's hook JSON; deploy adds the two hook entries to `~/.claude/settings.json` the way it sets up the status line.

**Tech Stack:** JavaScript (ESM), Node, esbuild bundle, Claude Code `SessionStart` / `UserPromptSubmit` hooks, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-render-diagram-hints-design.md`

## Global Constraints

- Hook output: `{"hookSpecificOutput":{"hookEventName":"SessionStart"|"UserPromptSubmit","additionalContext":<text>}}` on stdout, exit 0; nothing printed when quiet.
- Quiet when `HERDR_PANE_ID` is unset or empty; when prismantis's hints are on (an `enabledPlugins` key starting `prismantis@` set to `true`, and that key's `pluginConfigs[key].options` has none of `enabled`, `mermaid`, `diagramHints` equal to `false`); when settings.json exists but isn't valid JSON; on any thrown error. A missing settings.json counts as no prismantis.
- Settings are read from `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`.
- Commands: `node "<script>" session` and `node "<script>" prompt`, the script path with forward slashes, in double quotes; `herdr-hint` in a command marks an entry as ours.
- A changed settings.json is first copied to `settings.json.bak-herdr-dock` (as the status line does); other settings and hooks are kept byte-for-byte in meaning (JSON re-serialised with 2-space indent, as `statuslinePlan` writes it).
- Figures: at most `FIGURE_MAX_COLUMNS` (100) columns and `FIGURE_MAX_LINES` (80) lines, imported from `src/shared/render/figure.js`, never retyped.
- Credit prismantis 0.20.0 (MIT) for the note's wording, in `hints.js` and the README.
- `app/` is generated: run `npm run build:app` after source changes. Known baseline failure: `tests/dock-core-class.test.mjs`.

## Review Focus

- A settings.json with hooks of the person's own on the same events: theirs stay, ours are added beside them (Task 1 test "hintsPlan: other hooks are kept").
- A settings.json written by hand with a BOM or CRLF: it still reads (Task 1 test "hintsPlan: a BOM-prefixed file reads").
- Prismantis turned off in any of its three ways: our note comes back (Task 1 test "prismantisHints: …").
- The hook run with a broken settings.json: prints nothing, exits 0 (Task 2 test "the script: broken settings print nothing").
- Deploy run twice: the second run changes nothing and makes no second backup change (Task 3 deploy test).

---

### Task 1: The note and the plan (pure)

**Files:**
- Create: `src/shared/render/hints.js`
- Test: `tests/render-hints.test.mjs`

**Interfaces:**
- Consumes: `FIGURE_MAX_COLUMNS`, `FIGURE_MAX_LINES` from `src/shared/render/figure.js`; `readSettings` from `src/shared/statusline.js` (BOM-tolerant parse).
- Produces (in `hints.js`):
  - `HINT_MARK = "herdr-hint"`
  - `HINT: string`, `REMINDER: string`
  - `prismantisHints(settings: object): boolean`
  - `hintOutput(event: "session" | "prompt", { env: object, settingsText: string | null }): string` (the JSON line, or `""`)
  - `hintCommand(script: string, event: "session" | "prompt"): string`
  - `hintsPlan(settingsText: string | null, script: string): { state: "present" } | { state: "missing" | "moved", text: string } | { state: "invalid", error: string }`

- [ ] **Step 1: Write the failing tests** in `tests/render-hints.test.mjs`

```js
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
  assert.equal(hintsPlan("﻿{}", SCRIPT).state, "missing");
  assert.equal(hintsPlan("{ nope", SCRIPT).state, "invalid");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/render-hints.test.mjs`
Expected: FAIL, `Cannot find module '…/src/shared/render/hints.js'`.

- [ ] **Step 3: Write `hints.js`**

`HINT` adapts prismantis 0.20.0 `HINT` + `FIGURE_HINT` (credit comment, MIT): "Replies in this session are also drawn in the Render panel beside this terminal (herdr-dock, in the Herdr app); it is not a command or tool to call." Then the panel's kinds (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, `erDiagram`, `xychart-beta` bar or line charts), the five alerts, the guidance sentences and the copy-button sentence as prismantis words them, and the figure part with ``At most ${FIGURE_MAX_COLUMNS} columns and ${FIGURE_MAX_LINES} lines`` and prismantis's glyph list `─│┌┐└┘├┤┬┴┼═║→←►◄▲▼✓✗●○█▏■□·`. `REMINDER`: "The Render panel beside this terminal draws ```mermaid, ```figure, tables and alerts as the session-start note describes: add a picture when it is easier to see than read, and put commands in fenced blocks." `hintsPlan` parses with `readSettings`, looks for a hook entry whose command includes `HINT_MARK` under each of `SessionStart` and `UserPromptSubmit`, rewrites a stale command in place, appends a missing one as its own matcher group, and returns `JSON.stringify(settings, null, 2) + "\n"`.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/render-hints.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/render/hints.js tests/render-hints.test.mjs
git commit -m "feat(render): the panel's diagram note and reminder, quiet outside Herdr and while prismantis hints"
```

### Task 2: The hook script

**Files:**
- Create: `src/app/render-hint.js`
- Modify: `scripts/build.mjs` (bundle it into `mods/dock-render/herdr-hint.mjs` beside `herdr-render.mjs`)
- Test: `tests/render-hints.test.mjs` (script tests appended)

**Interfaces:**
- Consumes: `hintOutput` (Task 1).
- Produces: `node herdr-hint.mjs <session|prompt>`: prints `hintOutput(event, { env: process.env, settingsText })` (plus `"\n"` when not empty), exit 0 always; settings from `$CLAUDE_CONFIG_DIR/settings.json` or `~/.claude/settings.json` (`null` when missing).

- [ ] **Step 1: Write the failing tests** (appended to `tests/render-hints.test.mjs`)

```js
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/render-hints.test.mjs`
Expected: FAIL (the script doesn't exist: non-zero status / empty stdout where JSON is expected).

- [ ] **Step 3: Write `render-hint.js`** (header comment: what it is, the two events, when it's quiet) and add to `scripts/build.mjs`'s `dock-render` block a second esbuild call: `entryPoints: [join(ROOT, "src/app/render-hint.js")]`, `outfile: join(dest, "herdr-hint.mjs")`, `bundle: true, platform: "node", format: "esm"`.

- [ ] **Step 4: Run the tests and the build**

Run: `node --test tests/render-hints.test.mjs && npm run build:app >/dev/null && ls app/mods/dock-render/herdr-hint.mjs && HERDR_PANE_ID=x node app/mods/dock-render/herdr-hint.mjs prompt`
Expected: tests pass; the file exists; the built script prints the `UserPromptSubmit` JSON (or nothing if prismantis's hints are on in this machine's settings — then check with `CLAUDE_CONFIG_DIR=/tmp/none`).

- [ ] **Step 5: Commit**

```bash
git add src/app/render-hint.js scripts/build.mjs tests/render-hints.test.mjs app
git commit -m "feat(render): herdr-hint.mjs — the Claude Code hook that prints the panel's note"
```

### Task 3: Installed by deploy

**Files:**
- Create: `src/app/hints-setup.js`
- Modify: `scripts/deploy.mjs` (call it; `--no-hints`; usage line)
- Modify: `tests/build.test.mjs` (the deploy test at line ~160)
- Modify: `README.md` (Render section)

**Interfaces:**
- Consumes: `hintsPlan`, `HINT_MARK` (Task 1); the built `mods/dock-render/herdr-hint.mjs` (Task 2).
- Produces: `setupHints({ claudeHome: string, script: string, dry?: boolean }): { state: "present" | "added" | "updated" | "invalid" | "no-claude", changed: boolean, message: string }`.

- [ ] **Step 1: Write the failing test** in `tests/build.test.mjs`, inside the existing deploy test that runs with `DOCK_CLAUDE_HOME: claude` (after its status-line assertions):

```js
    const settings = JSON.parse(readFileSync(join(claude, "settings.json"), "utf8"));
    const script = join(tmp, "mods/dock-render/herdr-hint.mjs").replace(/\\/g, "/");
    assert.deepEqual(settings.hooks.SessionStart.map((g) => g.hooks[0].command), [`node "${script}" session`]);
    assert.deepEqual(settings.hooks.UserPromptSubmit.map((g) => g.hooks[0].command), [`node "${script}" prompt`]);
    assert.ok(existsSync(join(claude, "settings.json.bak-herdr-dock")));
```

and after the second (`again`) run: `assert.match(again.stdout, /diagram hints: already/);` plus a run with `--no-hints` into a fresh Claude home asserting its settings.json has no `hooks`.

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern="deploy" tests/build.test.mjs`
Expected: FAIL (`settings.hooks` undefined).

- [ ] **Step 3: Write `setupHints` and wire deploy**

`setupHints` mirrors `setupStatusline`: no `claudeHome` → `no-claude`; read settings.json; `hintsPlan`; `invalid` → message, no change; `present` → `"diagram hints: already in <path>"`; otherwise (unless `dry`) copy the file to `settings.json.bak-herdr-dock` when it exists, write the new text atomically (temp file + rename), and say `added` / `updated`. In `deploy.mjs`, inside the `existsSync(claudeHome)` block after the status line: unless `--no-hints`, `setupHints({ claudeHome, script: slashPath(join(appHome, "mods/dock-render/herdr-hint.mjs")), dry })`, printing `diagram hints: <message>`; a throw prints `diagram hints setup failed: …` and deploy goes on. Add `[--no-hints]` to the usage line.

- [ ] **Step 4: README**

In the Render section, a **Diagram hints** bullet: what the note says, that it comes once per session (start, `/clear`, compaction) plus a one-line reminder per prompt (about 40 tokens), that it's quiet outside Herdr and while prismantis's hints are on, that deploy adds the two hooks to `~/.claude/settings.json` (backup first; `--no-hints` skips), and how to remove it (delete the two `herdr-hint` entries). Credit prismantis (MIT) for the wording.

- [ ] **Step 5: Run tests and build**

Run: `npm run build:app >/dev/null && node --test tests/build.test.mjs tests/render-hints.test.mjs tests/build-app.test.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/hints-setup.js scripts/deploy.mjs tests/build.test.mjs README.md app
git commit -m "feat(render): deploy installs the diagram-hint hooks into Claude Code's settings"
```
