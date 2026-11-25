# Render notices when its diagram hints don't reach Claude — design

## Why

On 2026-11-25 the hint hook (`mods/dock-render/herdr-hint.mjs`) was installed and ran on every prompt, but printed
nothing: it waited for `HERDR_PANE_ID`, which Herdr never sets (fixed in d43a241: `HC_TERMINAL_ID`). Render's only check,
`checkHints`, reads `~/.claude/settings.json`, saw the hooks listed, and said nothing. A normal user can't be expected
to inspect environment variables or run the hook by hand; Render must notice on its own that the hints aren't arriving.

## Goals

- Render tells the user, in the panel, when the session it shows is getting no hints although the hooks are set up.
- It works the same on Windows, macOS and Linux, with nothing for the user to run.
- One renamed Herdr variable can't silence the hook again.

Non-goals: fixing the cause automatically (a silent hook is a herdr-dock bug or a session started before setup; neither
is fixed by rewriting settings); checking Codex sessions (the hints are Claude Code hooks).

Anti-goals: a false alarm in a healthy session; a row the user can't get rid of.

## Approaches

1. **Read the evidence in the transcript (chosen).** Claude Code writes each hint it receives into the session log as an
   `attachment` line, `attachment.type: "hook_additional_context"`, `hookEvent: "UserPromptSubmit"`, after the prompt it
   came with (seen in this session's log: one after every typed prompt since the fix, none before it). Render's helper
   already reads that log, so it can count. Checks the whole path (hook installed → run → printed → delivered).
2. A heartbeat file the hook writes when it speaks, read by Render. Proves the hook ran, not that Claude got it, and
   adds a file write to every prompt.
3. Run the hook from Render with the pane's environment. Render can't see the agent process's environment, so it would
   be checking a guess.

## Design

**The hook** (`src/shared/render/hints.js`, `hintOutput`): in Herdr when any of `HC_TERMINAL_ID`, `HC_SCOPE` or
`HERDR_PANE_ID` is non-empty. (herdr-core 0.1.22's Windows, Linux and macOS builds all name `HC_TERMINAL_ID` and
`HC_SCOPE`; `HERDR_PANE_ID` is kept in case an older Herdr set it.)

**The check** (pure, `src/shared/render/transcript.js`, `hintReach(lines)`): walks the log from its end, collecting the
last 3 *typed prompts* and, for each, whether a Render hint arrived before the next one.

- A typed prompt: a `type: "user"` line, not `isMeta`, not `isSidechain`, with text, that `speaker()` gives to `you`,
  and whose text doesn't start with `<command-name>`, `<command-message>` or `<bash-input>` (slash commands and `!`
  commands, which may not run prompt hooks: not counted, so they can't raise a false alarm). Queued messages
  (`queued_command` attachments) and task notifications aren't prompts.
- A Render hint: a `hook_additional_context` attachment whose `content` (string or array of strings) contains
  `Render panel beside this terminal` — a phrase both `HINT` and `REMINDER` contain (a test pins that).
- Result: `{ state, checked }` with `state` `"ok"` (the newest typed prompt got a hint), `"silent"` (the newest 2 typed
  prompts both got none) or `"unknown"` (fewer than 2 typed prompts, or the newest got none but the one before did).
  Reading stops after 3 prompts, so a long log costs little.

**The helper** (`src/app/render-helper.js`): in `mode: "claude"` the answer gains `hints: hintReach(lines)`.

**The panel** (`src/mods/dock-render/main.js`, `src/shared/render/view.js`):

- `checkHints` also records whether prismantis's own hints are on (`prismantisHints`), from the same settings text.
- `hintsNotice` gains the case: settings state `"present"`, prismantis hints off, the shown session's `hints.state`
  `"silent"`, not dismissed for this session → `{ text: "Diagram hints aren't reaching Claude in this session",
  action: "why" }`. The existing set-up notices are unchanged and take precedence.
- **Why** opens a short explanation under the row: *Your last 2 prompts reached Claude without Render's note, though
  the hooks are set up. If this session started before the hints were set up, start a new Claude session. If a new
  session shows this too, the hint hook is staying silent: copy the details and report it.* — with **copy details**:
  the platform, the two hook commands found in settings.json, the transcript path, and the prompts checked.
- **×** hides the row for that transcript until Render restarts (not "don't ask again": it's a fault, not a nag).

## Left to the builder

Exact layout of the Why text and button (follow the hints row's existing style); test names; where in `main.js` the
per-transcript dismissal set lives.
