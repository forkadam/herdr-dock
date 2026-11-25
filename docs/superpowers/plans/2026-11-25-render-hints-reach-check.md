# Render notices when its diagram hints don't reach Claude — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render shows "Diagram hints aren't reaching Claude in this session" when the hooks are set up but the session's
recent prompts arrived without the hint; the hook recognises Herdr by any of its variables.

**Architecture:** A pure reader (`hintReach`) walks the Claude transcript backwards over the last 3 typed prompts and
looks for the hook's `hook_additional_context` attachment after each. The helper returns its result with the
conversation; the panel combines it with the settings check it already does and shows a row with **Why** and **×**.

**Tech Stack:** Node ≥ 22 ESM, `node:test`, the Herdr mod API (gpui-kit) in `main.js`, esbuild bundles via
`npm run build` / `npm run build:app`.

**Spec:** `docs/superpowers/specs/2026-11-25-render-hints-reach-check-design.md`

## Global Constraints

- Herdr detection: any non-empty `HC_TERMINAL_ID`, `HC_SCOPE` or `HERDR_PANE_ID`.
- Hint phrase (in both `HINT` and `REMINDER`): `Render panel beside this terminal`.
- Row text, exactly: `Diagram hints aren't reaching Claude in this session`.
- Why text, exactly: `Your last 2 prompts reached Claude without Render's note, though the hooks are set up. If this
  session started before the hints were set up, start a new Claude session. If a new session shows this too, the hint
  hook is staying silent: copy the details and report it.`
- Codex sessions are never checked. Existing set-up notices are unchanged and take precedence.
- Code style: the repo's (one-line comments in its voice, 120-column lines, no new dependencies).

## Review Focus

- A log whose newest prompts are slash commands or `!` commands, with hints on earlier prompts → not "silent".
- A message typed while Claude works (`queued_command` attachment) or a task notification → never counted as a prompt.
- A brand-new session with one prompt and no hint yet → "unknown", no row.
- Hint attachment `content` as a plain string rather than an array → still recognised.
- prismantis's own hints on (Render's hook stays quiet by design) → no row.

Each has a test in Task 2 or Task 4.

---

### Task 1: The hook recognises Herdr by any of its variables

**Files:**
- Modify: `src/shared/render/hints.js` (`hintOutput`, header comment; add `HINT_PHRASE`)
- Test: `tests/render-hints.test.mjs`

**Interfaces:**
- Produces: `export const HINT_PHRASE = "Render panel beside this terminal"` from `src/shared/render/hints.js`.

- [ ] **Step 1: Failing tests** in `tests/render-hints.test.mjs`:

```js
test("hintOutput: in Herdr by HC_TERMINAL_ID, HC_SCOPE or HERDR_PANE_ID; empty ones don't count", () => {
  for (const env of [{ HC_TERMINAL_ID: "t1" }, { HC_SCOPE: "0-abc" }, { HERDR_PANE_ID: "p1" }])
    assert.notEqual(hintOutput("prompt", { env, settingsText: null }), "", JSON.stringify(env));
  assert.equal(hintOutput("prompt", { env: { HC_TERMINAL_ID: "", HC_SCOPE: "", HERDR_PANE_ID: "" }, settingsText: null }), "");
});
test("HINT_PHRASE is in both the note and the reminder", () => {
  assert.ok(HINT.includes(HINT_PHRASE) && REMINDER.includes(HINT_PHRASE));
});
```
Import `HINT_PHRASE`. The script helper `hook()` must also strip `HC_SCOPE` and `HERDR_PANE_ID` from the inherited
environment (the suite itself may run in a Herdr terminal).

- [ ] **Step 2:** `node --test tests/render-hints.test.mjs` → the HC_SCOPE / HERDR_PANE_ID cases fail; HINT_PHRASE import fails.
- [ ] **Step 3:** Implement: `inHerdr(env)` = any of the three non-empty; export `HINT_PHRASE`; header comment names the three.
- [ ] **Step 4:** Same command → all pass except the known-none; `npm test` → 0 failures.
- [ ] **Step 5: Commit** `fix(render): the hint hook knows Herdr by HC_TERMINAL_ID, HC_SCOPE or HERDR_PANE_ID`

### Task 2: `hintReach(lines)` — did the last prompts get the hint?

**Files:**
- Modify: `src/shared/render/transcript.js` (new export, reusing `parse` and `speaker`)
- Test: `tests/render-core.test.mjs` (where `readClaude` is tested)

**Interfaces:**
- Consumes: `HINT_PHRASE` (Task 1).
- Produces: `hintReach(lines: string[]) -> { state: "ok" | "silent" | "unknown", checked: number }`.

Rules (from the spec): walk from the end; stop after 3 typed prompts. A typed prompt: `type: "user"`, not `isMeta`, not
`isSidechain`, text content, `speaker(text, o.origin?.kind ?? null, null)?.by === "you"`, and the trimmed text not
starting with `<command-name>`, `<command-message>` or `<bash-input>`. A prompt "got the hint" when a line between it and
the next typed prompt is `type: "attachment"`, `attachment.type === "hook_additional_context"`, whose `content` (string,
or array of strings) contains `HINT_PHRASE`. `state`: newest got it → `"ok"`; newest 2 both didn't → `"silent"`;
otherwise `"unknown"`. `checked` = typed prompts examined.

- [ ] **Step 1: Failing tests.** Build logs with small helpers (`P(text, uuid)` a prompt line, `H(phrase=true, asString=false)` a hint attachment line, `Q(text)` a `queued_command` attachment, `C(cmd)` a `<command-name>` prompt):

```js
test("hintReach: ok when the newest prompt got the hint", () => assert.deepEqual(hintReach([P("a"), H(), P("b"), H()]), { state: "ok", checked: 2 }));
test("hintReach: silent when the newest two got none", () => assert.equal(hintReach([P("a"), H(), P("b"), P("c")]).state, "silent"));
test("hintReach: one prompt with no hint is unknown", () => assert.deepEqual(hintReach([P("a")]), { state: "unknown", checked: 1 }));
test("hintReach: newest missed but the one before got it is unknown", () => assert.equal(hintReach([P("a"), H(), P("b")]).state, "unknown"));
test("hintReach: slash commands, ! commands, queued messages and task notifications aren't prompts", () => {
  assert.equal(hintReach([P("a"), H(), P("b"), H(), C("/clear"), P("<bash-input>ls</bash-input>"), Q("typed mid-turn"), P("<task-notification>x</task-notification>")]).state, "ok");
});
test("hintReach: a hint given as a plain string counts; other hooks' context doesn't", () => {
  assert.equal(hintReach([P("a"), H(true, true)]).state, "ok");
  assert.equal(hintReach([P("a"), H(false), P("b"), H(false)]).state, "silent");
});
test("hintReach: stops after 3 prompts", () => assert.equal(hintReach([P("x"), H(), P("a"), P("b"), P("c")]).checked, 3));
```

- [ ] **Step 2:** `node --test tests/render-core.test.mjs` → fail (`hintReach` not exported).
- [ ] **Step 3:** Implement `hintReach` in `transcript.js`.
- [ ] **Step 4:** Same command → pass.
- [ ] **Step 5: Commit** `feat(render): hintReach — whether a session's last prompts got Render's hint`

### Task 3: The helper returns `hints` for Claude sessions

**Files:**
- Modify: `src/app/render-helper.js` (`run`, `case "claude"`; header comment's answer shape)
- Test: `tests/render-helper.test.mjs`

**Interfaces:**
- Consumes: `hintReach` (Task 2).
- Produces: the `mode: "claude"` answer gains `hints: { state, checked }`; `mode: "codex"` answers have no `hints`.

- [ ] **Step 1: Failing test:** with the existing fixture `claude-conversation.jsonl` (no hint attachments), `out.hints.state` is `"silent"` or `"unknown"` per its prompts — assert `typeof out.hints.state === "string"` and `out.hints.checked >= 1`; and a temp log written as `[P, H, P, H]` gives `out.hints.state === "ok"`.
- [ ] **Step 2:** `node --test tests/render-helper.test.mjs` → fail.
- [ ] **Step 3:** In `case "claude"`, read the lines once and pass `{ ..., hints: hintReach(lines) }` as `extra` to `fromLog`.
- [ ] **Step 4:** Same command → pass.
- [ ] **Step 5: Commit** `feat(render): the helper says whether the session's prompts got the hint`

### Task 4: The panel's row, Why and copy details

**Files:**
- Modify: `src/shared/render/view.js` (`hintsNotice`; new `hintsWhy`, `hintsDetails`)
- Modify: `src/mods/dock-render/main.js` (`checkHints`, `hintsRow`, state for Why open / dismissed transcripts)
- Modify: `README.md` (the Diagram hints bullet under Render: one sentence on the new row)
- Test: `tests/render-view.test.mjs`

**Interfaces:**
- Consumes: the helper's `hints` (Task 3), `prismantisHints` and `readSettings` (existing), `HINT_MARK` (existing).
- Produces: `hintsNotice(state, { dismissed, error, reach, prismantis, reachDismissed })`; `HINTS_WHY` (the exact Why
  text); `hintsDetails({ platform, commands, transcript, checked }) -> string`.

- [ ] **Step 1: Failing tests** in `tests/render-view.test.mjs`:

```js
test("hintsNotice: hooks present but the session's prompts got none -> the reach row; not for prismantis, unknown, ok or after ×", () => {
  const n = (o) => hintsNotice("present", { dismissed: false, error: null, reach: "silent", prismantis: false, reachDismissed: false, ...o });
  assert.deepEqual(n({}), { text: "Diagram hints aren't reaching Claude in this session", action: "why" });
  assert.deepEqual(n({ dismissed: true }), { text: "Diagram hints aren't reaching Claude in this session", action: "why" });
  for (const o of [{ prismantis: true }, { reach: "unknown" }, { reach: "ok" }, { reach: undefined }, { reachDismissed: true }]) assert.equal(n(o), null, JSON.stringify(o));
  assert.equal(hintsNotice("missing", { dismissed: false, error: null, reach: "silent" }).action, "setup");
});
test("hintsDetails: platform, hook commands, transcript, prompts checked", () => {
  const d = hintsDetails({ platform: "linux", commands: ['node "/a/herdr-hint.mjs" prompt'], transcript: "/t.jsonl", checked: 3 });
  for (const s of ["linux", 'node "/a/herdr-hint.mjs" prompt', "/t.jsonl", "3"]) assert.ok(d.includes(s), s);
});
```
Keep the existing `hintsNotice` test passing (its calls omit `reach`).

- [ ] **Step 2:** `node --test tests/render-view.test.mjs` → fail.
- [ ] **Step 3:** Implement in `view.js` (the reach case is checked before `dismissed`, which only silences set-up rows). In `main.js`: `checkHints` also sets `this.hints.prismantis` (via `readSettings` + `prismantisHints`) and `this.hints.commands` (hook commands containing `HINT_MARK`); `hintsRow` passes `reach: this.data?.hints?.state` only when the target is a Claude session, `reachDismissed` from a `Set` of dismissed transcript paths; action `"why"` shows a **Why** button that toggles `HINTS_WHY` under the row with a **copy details** button (`cx.write_to_clipboard(hintsDetails(...))`, then the existing "copied" feedback). × on the reach row adds the transcript to the set. README sentence.
- [ ] **Step 4:** `npm test` → 0 failures; `npm run build` passes its checks; `npm run build:app` (drift test) then `npm test` again → 0 failures.
- [ ] **Step 5: Commit** `feat(render): a row says when diagram hints aren't reaching Claude, with why and details to copy`

### Task 5: Prove it in the real panel

- [ ] `npm run deploy`. With this session (hints arriving): no row. Then temporarily make the deployed hook quiet (rename `HC_TERMINAL_ID` check in the deployed `herdr-hint.mjs` copy, not the source), send two prompts in a test Claude session in Herdr: the row appears; **Why** opens; **copy details** copies; × hides it. Restore by `npm run deploy`. Linux suite via WSL (`linux-test.sh`) → 0 failures.
