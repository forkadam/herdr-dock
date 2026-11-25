# Render hints: the hook records each run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render shows a hints row only when the hook actually ran for the session's prompts and the hint still didn't
arrive, naming why; hooks switched off anywhere show nothing.
**Spec:** `docs/superpowers/specs/2026-11-25-render-hints-reach-check-design.md`, section "Revision".

## Global Constraints
- Record path `<app home>/herdr-dock/hint-runs/<session_id>.json`, body `{ at, event, decision }`; decisions exactly
  `spoke`, `not-herdr`, `prismantis`, `settings-invalid`.
- Row texts exactly: `Diagram hints aren't reaching Claude in this session` (spoke);
  `The diagram-hint hook doesn't see Herdr in this session` (not-herdr).
- Tolerance between a record and the newest prompt: 5000 ms. Records older than 14 days are deleted.

## Review Focus
- stdin empty, not JSON, or a TTY (hand-run hook) → no record, hint output unchanged, exit 0.
- session_id with `..`, `/` or `\` → no record written anywhere.
- A record from an earlier prompt only (hook stopped running since) → no row.
- Two sessions writing records at once → each its own file, no partial reads (atomic rename).
- An isMeta line from a person (origin human or none) keeps the pending hint (review minor 2).

### Task 1: The hook writes its record
Files: `src/shared/render/hints.js` (`hintDecision(event, { env, settingsText })` → `{ decision, output }`;
`hintOutput` stays, built on it), `src/app/render-hint.js` (stdin, record write), `tests/render-hints.test.mjs`.
Tests: decision for each case; the script with stdin `{"session_id":"s-1"}` and `DOCK_APP_HOME=<tmp>` writes
`<tmp>/herdr-dock/hint-runs/s-1.json` with the decision; bad ids (`../x`, `a/b`, `a\b`) write nothing; empty or
non-JSON stdin writes nothing; output and exit 0 unchanged in every case.

### Task 2: The verdict, the helper, the panel
Files: `src/shared/render/view.js` (`reachVerdict(hints, run)`, `hintsNotice` takes `reach: verdict`, `HINTS_WHY` →
`hintsWhy(verdict)`, `hintsDetails` gains `run`), `src/app/render-helper.js` (claude mode reads the record for the
transcript's basename from `req.runsDir`, returns `hints.run`; prunes records > 14 days; `reach`/`hooksSpeak` use
removed), `src/shared/render/hints.js` (remove `hooksSpeak`), `src/mods/dock-render/main.js` (pass `runsDir`, use
`reachVerdict`, drop the prismantis flag), README, tests in `tests/render-view.test.mjs`,
`tests/render-helper.test.mjs`, `tests/render-hints.test.mjs`, `tests/render-core.test.mjs` (the isMeta-human test).
Tests: verdict table (silent+spoke → spoke; silent+not-herdr → not-herdr; prismantis, settings-invalid, no run, run
older than prompt − 5 s → null; ok/unknown → null); helper returns `hints.run` from runsDir and deletes a 15-day-old
record; hintsNotice texts; hintsWhy per verdict; details include the decision.

### Task 3: Prove it
Deploy; this session's record appears with `spoke`; Render shows no row. Replay all transcripts. Suite on Windows and
WSL. Fresh review; fix every finding in the same round.
