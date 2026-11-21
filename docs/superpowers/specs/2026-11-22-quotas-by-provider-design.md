# Quotas by provider, no Python — design (short)

Date: 2026-11-22.

## Intent

- The user runs Claude, Codex (OpenAI) and Gemini (through Antigravity).
- They want Quotas grouped by provider, with each provider's icon.
- The Claude usage numbers must stop depending on a Python helper, so that they work the same on Windows, macOS
  and Omarchy.

## Findings

- **Claude** reports context % and its 5-hour/weekly windows to its status line. `~/.claude/statusline.ps1` pipes
  that to `herdr-statusline-cache.py`, which writes `~/.claude/statusline-cache/claude-statusline.json`.
- **Codex** writes `token_count` events with `rate_limits` (primary and secondary windows) into
  `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
- **Antigravity (Gemini)** keeps no quota or usage record on disk. Its quota comes from Google's servers through
  the user's Google login, and herdr-dock won't use that token. It is left out until a local record exists.

## Approaches

There is one sensible way to do this: local readers inside Quotas, plus a Node port of the writer.

- **Rejected: a background service that polls every provider's API.** It needs credentials and keeps
  something running all the time.
- **Rejected: keep Python.** That defeats the goal.

## Design

1. **`herdr-statusline-cache.mjs`** (in the repo under `scripts/`): a faithful Node port of the Python helper.
   - Same input: the status-line JSON on stdin, with any BOMs stripped.
   - Same output file and shape.
   - It never throws or prints, so the status line can't break.
   - Deploy installs it to `~/.claude/` when that folder exists.
   - The one line in the user's `statusline.ps1` that calls `python` now calls `node` on that script, with
     everything else unchanged. On macOS/Omarchy the README gives the line to add.
   - The Python file is left on disk, unused.
2. **Codex reader** (`src/shared/codex.js`, pure and tested):
   - It reads the newest `rollout-*.jsonl` among today's and the previous 7 days' session folders, using a file
     listing through `src/shared/platform.js`.
   - It takes the last `rate_limits` from that file.
   - Windows map as follows: 300 min → 5-hour and 10080 min → weekly. Otherwise primary → 5-hour and
     secondary → weekly.
   - Resets come from `resets_at` (epoch seconds) or `resets_in_seconds` relative to the event's timestamp.
   - A custom `CODEX_HOME` is not followed (mods cannot read environment variables).
3. **Grouped Quotas:**
   - One block per provider (Claude, then Codex), each with its icon from Herdr's agent table (`knownAgents()`,
     keys `claude` and `codex`), else a letter.
   - The same bars, reset times and stale marks as today.
   - A provider with nothing recorded is hidden. With nothing anywhere, the panel says "no usage recorded yet".
   - The collapsed/icon badge shows the highest used % across providers.
