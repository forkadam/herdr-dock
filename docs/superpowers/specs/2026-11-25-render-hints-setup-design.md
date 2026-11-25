# Diagram hints for the Herdr-way install — design (short)

**Why.** `npm run deploy` adds the diagram-hint hooks to `~/.claude/settings.json`, but the Herdr-way install copies
`app/` and follows `app/RECIPE.md`, which never mentions them. Those users never get the hooks and are never told they
exist; once prismantis is removed, Claude stops writing what the Render panel draws.

**Goals.** The Herdr-way install sets the hooks up and tells the person; if it didn't, the Render panel says so and
offers **Set up**, as Quotas does for the status line.

**Non-goals.** Changing what the hooks do. Making a hand-removed hook stay removed across a clone install's deploy.

**Anti-goals.** A panel row that nags someone who doesn't want the hooks. A second way of editing settings.json.

**Approach** (the status line's, agreed with Adam):
- **A setup command**, `mods/dock-render/herdr-hints-setup.mjs`: `src/app/hints-setup.js` (the same `setupHints`
  deploy uses) gains a command line like `statusline-setup.js`: `node herdr-hints-setup.mjs [--check] [--script
  <path>]`, the script defaulting to `herdr-hint.mjs` beside it, Claude's folder `DOCK_CLAUDE_HOME` or `~/.claude`;
  prints `<state>: <message>`; exit 1 only for `invalid` or a failure.
- **`app/RECIPE.md`**: the "Tell the person before adding" line names the two hooks (what they add per prompt, quiet
  while prismantis's hints are on); a step after the status line runs the setup command and reports what it printed;
  "Files written outside the mod folders" adds the hooks; "Done when" checks for the two `herdr-hint` entries.
- **The Render panel's row**, under its header: read `~/.claude/settings.json` (`readTextFile`; no file → the folder
  probe Quotas uses: missing vs no Claude Code) and run `hintsPlan` against the installed `herdr-hint.mjs`. Missing →
  "Diagram hints for Claude aren't set up" with **Set up**; pointing at another install → "Diagram hints point at
  another install" with **Set up**; unreadable → "~/.claude/settings.json can't be read: diagram hints aren't set up"
  (no button); present or no Claude Code → nothing. **Set up** runs the command, then checks again; a failure shows
  its message with **Set up** again. The check runs when the panel is first shown and after **Set up**.
- *My call:* the row has a small **×** that hides it for good (a shared setting), so someone who doesn't want the
  hooks isn't asked again.

**Left to the builder.** Wording within the above; the pure part (the row's text and action from the state) goes in
`src/shared/render/view.js` with Node tests; the command line's tests (added, `--check` writes nothing, invalid exits
1); `app/` rebuilt.
