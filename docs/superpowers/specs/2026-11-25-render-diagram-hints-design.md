# Render panel: diagram hints for Claude — design (short)

**Why.** Claude writes diagrams, figures, tables and alerts because prismantis adds a hidden note to every prompt
saying they render. Once prismantis is removed (after this and project 3 of the prismantis replacement), that note is
gone, and Claude stops writing what the Render panel draws. This adds herdr-dock's own note, describing the panel.

**Goals.** Claude Code sessions running inside Herdr get a note saying the Render panel beside the terminal draws
` ```mermaid ` (flowcharts, sequence, state, class and ER diagrams, `xychart-beta` bar and line charts),
` ```figure ` text pictures, tables, GitHub alerts and fenced code with copy buttons, with prismantis's guidance on
when to use each and the figure syntax, adapted to the panel's limits (figures at most 100 columns and 80 lines).
`npm run deploy` installs it. It costs little per prompt.

**Non-goals.** Codex (it has no prompt hook). Removing prismantis. Sessions outside Herdr. Project-level
`.claude/settings.json` files.

**Anti-goals.** Two notes at once while prismantis is still installed. Notes in a plain terminal, where a figure is just
markup. A hook that slows a prompt or breaks Claude Code when something is wrong.

**Approaches** (Adam picked the first):
- **The full note once per session, and a one-line reminder on each prompt.** Claude Code's `SessionStart` hook runs
  at start, after `/clear` and after compaction; its `UserPromptSubmit` hook runs on each prompt. About 40 tokens per
  prompt.
- The full note on every prompt, as prismantis does: about 630 tokens per prompt, kept in the conversation each time.
- The full note once per session only: free per prompt, but Claude may drift from it late in a long session.

**Design.**
- **The note** is prismantis 0.20.0's `HINT` and `FIGURE_HINT` (MIT, credited), reworded for the panel: "the Render
  panel beside this terminal draws…" instead of "colored terminal graphics"; the diagram kinds above; all five alert
  kinds; figures at most 100 columns and 80 lines (`FIGURE_MAX_COLUMNS`, `FIGURE_MAX_LINES` in `figure.js`). The
  reminder is one line pointing back to it.
- **A hook script**, `herdr-hint.mjs`, shipped in `mods/dock-render/` (bundled by the build). `node herdr-hint.mjs
  session` prints the `SessionStart` JSON with the note as `additionalContext`; `prompt` prints the
  `UserPromptSubmit` JSON with the reminder. It prints nothing (exit 0) when `HERDR_PANE_ID` isn't set (not in Herdr),
  when prismantis's hints are on in `~/.claude/settings.json` (a `prismantis@…` plugin enabled, with its `enabled`,
  `mermaid` and `diagramHints` options not `false`), or on any error.
- **Installed by deploy** into `~/.claude/settings.json` like the status line: the file is copied to
  `settings.json.bak-herdr-dock` before a change; a `SessionStart` entry (no matcher, so every source) and a
  `UserPromptSubmit` entry are added, each `node "<app home>/mods/dock-render/herdr-hint.mjs" <session|prompt>`; other
  hooks are kept; an entry already there (found by `herdr-hint`) is updated when its path changed, else left alone.
  `--no-hints` skips it; `--dry-run` only says what it would do. Without `~/.claude` nothing happens.
- **README** describes the note, when it is quiet, its cost, and how to remove it (delete the two entries).

**Left to the builder.** The exact wording within those constraints; the file split (pure parts in `src/shared/`,
tested with Node); tests for the script (in and out of Herdr, prismantis on and off, both events, bad settings), the
setup (missing, present, moved path, other hooks kept, invalid JSON, backup), and deploy (entries written into a
temporary Claude home).
