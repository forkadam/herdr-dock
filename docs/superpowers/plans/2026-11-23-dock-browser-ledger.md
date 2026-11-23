# dock-browser: build ledger

The controller's ledger from building dock-browser (2026-11-23/24): pre-flight scan, rulings, every task's review
outcome, and the minor findings deferred for later. Kept as the follow-up list; see also the plan beside it.

Spec: docs/superpowers/specs/2026-11-23-dock-browser-design.md
Branch: main (user's standing rule: commit to main locally, push only on "push it")

## Pre-flight scan
| Tasks | Shared | Finding |
|---|---|---|
| T1↔T4 | browserOf(merged), config via source.json + local | consistent |
| T1↔T5 | browserOf, mergeWithLocal feature rule; deploy filters dock-browser | consistent |
| T2↔T4 | parseBrowse/refused/normalizeUrl/isProduction/sessionName/paths | consistent (wrapper builds --state itself; refused applies only to agent args) |
| T3↔T4 | parseSession/parseControl/startHandoff/clearHandoff/personHas/waitOutcome/goneSessions | consistent |
| T3↔T7/T8/T9 | takeOver(control, reason, now)/handBack/answer | consistent after plan fix |
| T4↔T5 | mod skeleton + build entry (T4); deploy install/filter (T5) | consistent |
| T6↔T7 | jpegSize/toPage/drawnHeight/FrameRing/streamStep/afterLoss | consistent |
| T7↔T8↔T9 | src/mods/dock-browser/main.js sequential edits | consistent |
| T1 self | tests vs impl | ok |
| T2 self | tests vs impl | ok |
| T3 self | ok |
| T4 self | ok |
| T5 self | fixture "agent-browser-fake.tgz (built by the test… not committed if generated)" ambiguous | Ruling below |
| T6 self | ok |
| T7–T9 self | live checks need a person's mouse/keyboard | Ruling below |
| T10 self | ok |

Ruling: T5 test .tgz is generated at test time in a temp dir, never committed — avoids a binary fixture — cost if wrong: trivial.
Ruling: live checks needing real clicks/typing (T8 take-over, T9 Pick/Notes) are done by implementers as far as scripting allows (herdr-app shot, CLI, stream input from a node script); what needs a human is listed in the report and batched for the user at the end — cost if wrong: a bug found late, fixable.
Ruling: T5 live deploy installs into the user's real app home and ~/.claude/skills, ~/.codex/skills with chrome=/usr/bin/chromium in the local file — this is the project's normal deploy and was in the approved design — cost if wrong: remove two SKILL.md folders.

## Tasks
Task 1 BASE fc27caa
Task 1 implemented b02742f (app/ regenerated for drift test); in review
Task 1: complete (commits fc27caa..b02742f, review clean)
Parked minor (T1): migrationPlan drops machines.<host>.browser on migration; edit dialog's machineSection diffs against a base without browser → injected dock-browser gets frozen into local.json when enabled. Revisit in final review.
Task 2 BASE b02742f
Task 2 review: Approved with 2 Important.
Ruling (T2 #1, plan-mandated "first word"): refused() finds the command word as the first token not starting with "-" — spec intent is to block leaving/swapping the browser; flags before the command would bypass it — cost if wrong: a legit command whose first non-flag token is "close" (none exist).
Task 2: minor (deferred): REASONS plain object (refused(["constructor"]) returns a function); isProduction needs a normalised URL (doc/test); open treats unknown --flags as URL; -pfoo glued short form; normalizeUrl: no %-encoding of #?% in paths, no UNC, view-source: mangled; missing tests (C:/x, --cdp=9222, IPv6 isProduction, open --profile without value).
Task 2: fix round 1/5 (2 addressed, 0 open; commits c6325c7..c4583c3)
Task 2: minor (deferred): refused() bypass via an unknown value-taking flag before the command (["--timeout","5000","close"]); only one trailing dot stripped.
Task 2: complete (commits b02742f..c4583c3, review clean)
Task 3 BASE c4583c3
Task 3 review: Approved with 1 Important (plan-mandated): terminal-id reuse leaves stale records that pause a new agent.
Ruling (T3 #1): both records carry `terminalCreated` (hc get <t> → created_ms); registry gains isStale(record, createdMs) (true when the field is missing or differs); personHas/waitOutcome treat a non-finite handoffMinutes as 15. Task 4 wrapper and Task 7 panel must delete stale records (and close the old agent-browser session) before acting — carry into T4/T7 dispatches — cost if wrong: extra hc call per command.
Task 3: minor (deferred): future `since` never expires; malformed handoff parses as null; parseSession ignores v; missing boundary/after-expiry/takeover+answered tests.
Task 3: fix round 1/5 (1 addressed, 0 open; commits deabf57..ae0892e)
Task 3: minor (deferred): takeOver without 4th arg keeps an old terminalCreated (fails safe); bad-handoffMinutes test doesn't assert personHas.
Task 3: complete (commits c4583c3..ae0892e, review clean)
Task 4 BASE ae0892e
Ruling (T4): if `hc get` fails, the wrapper skips the stale check (treats records as current) rather than wiping every run — cost if wrong: a stale handoff could pause a reused terminal until it times out (15 min).
Ruling (install modes): this machine is an app install (mods/dock-core/source.json {"mode":"app"}; config at mods/dock-core/config.json, read-only). Wrapper reads config via installOf(src, home) from src/shared/install.js + herdr-dock/local.json + os.hostname(). Browser setup (T5) becomes a standalone bundled script mods/dock-browser/herdr-browser-setup.mjs (`node … [--remove] [--no-skills] [--check]`) that deploy calls in clone mode, app/RECIPE.md runs in app mode, and the panel's "Set up" button runs when the binary is missing. In app mode the dock-browser mod folder ships always (app/ is all mods) but is placed only when enabled — off still means no binary, no skills, no panel. Cost if wrong: an extra panel-side setup button.
Task 4 review: Needs fixes — Critical: default app home resolves one folder too high (browse.js:919); Important: wait timeout path untested; hc/herdr-app spawn on Windows if they are .cmd shims.
Task 4: minor (deferred): spawn-failure status fallbacks (?? 1 / ?? 0) should be 2; banner after output when a click lands on production; wait with no session returns 0 silently; login ignores failed open; leftover .tmp files on failed rename; unquoted args with shell:true for .cmd test shim on Windows.
Task 4: fix round 1/5 (3 addressed, 0 open; commits 75a9b6d..603f3de)
Task 4: minor (deferred, check in final review): Windows ENOENT retry uses shell:true with unquoted args — args for hc/herdr-app are fixed (terminal id, "ls"), agent-browser is existsSync-guarded, so no user text reaches cmd.exe today; keep it that way.
Task 4: complete (commits ae0892e..603f3de, review clean)
Task 5 BASE 603f3de
Ruling (T5 live check): do NOT run `npm run deploy` (it rewrites source.json to clone mode on this app-install machine). Live check = set browser {enabled:true, chrome:"/usr/bin/chromium"} in ~/.config/herdr-app/herdr-dock/local.json and run the built setup script against the real app home.
Task 5 implemented ad82bef; live: binary+skills (claude, codex, ~/.gemini/config/skills) installed; local.json browser enabled (backup in workspace); in review
Task 5: complete (commits 603f3de..ad82bef, review clean)
Task 5: minor (deferred, final review should triage #1): deploy swallows browser-install failure and exits 0 (checksum mismatch looks like success); DOCK_AGY_HOME means different folders for status line vs skills; installSkills overwrites a user's unmarked dock-browser/SKILL.md; ensureChrome marker via 4x dirname; EBUSY on Windows when replacing a running .exe; shadowed `merged` const in deploy; missing tests for main --check enabled / unsupported; leftover test comment.
Task 6 BASE ad82bef
Task 6: complete (commits ad82bef..63e16bb, review clean)
Task 6: minor (deferred): console error condition muddled (msg.type is always "console"); afterLoss mutates its state arg (document or return state); FrameRing.next duplicate seq could drop the live frame; toPage with drawnW 0 → NaN (guard in caller); untested jpegSize fill bytes/SOF2/truncated SOF and alt/platform bits; F-keys unmapped.
Carry to T8: verify Backspace/Delete/arrows reach the page via the stream without code/windowsVirtualKeyCode; if not, add them in keyEvents.
Task 7 BASE 63e16bb
Ruling (T7+ live checks): install the committed app/ build locally — tar ~/.config/herdr-app/mods/dock-* to the workspace (mods-backup.tgz, once), then copy app/mods/dock-* over the installed ones (as update-app does), then `herdr-app status`. Cost if wrong: restore from the tarball.
Task 7 implemented b79de75 (DONE_WITH_CONCERNS): live check passed via split pane; for the user at the end: click the rail's Browser icon once; right column was left hidden (dock.right.shown false). Unrun: daemon dies but record stays → `stream status --json` may start an empty daemon (idle timeout reaps it). Out-of-task edits: browse.js updates title on URL change; streamStep dedups console errors (agent-browser sends twice).
Task 7 review: Needs fixes — Important: un-awaited clearFolder rmdir can remove the frames folder under a new stream for the same terminal → panel stuck on "Connecting…".
Task 7: minor (deferred): dedup compares only last error; reconnect has no cap/backoff; dead daemon w/ record spawns one empty daemon; short window where stale check is skipped before createdOf settles; loadConfig only on show; pane copy in inactive tab keeps streaming; write() reaches into FrameRing internals; picture width vs scrollbar.
Task 7: fix round 1/5 (1 addressed, 0 open; commits b79de75..2a341b8)
Task 7: minor (deferred): write() retry mkdir can recreate an empty frames folder after stop (guard with `if (this.stopped) return`).
Task 7: complete (commits 63e16bb..2a341b8, review clean)
Task 8 BASE 2a341b8
Task 8 implemented 99ff746 (DONE_WITH_CONCERNS). Named keys now carry key codes (Backspace/Left failed without).
Ruling (T8 sizes): size buttons take over (agent-browser viewport is session-wide and tab new becomes the active tab); hand back restores agent tab + size — spec intent (agent's tab keeps its size) preserved — cost: agent paused while person checks sizes.
Ruling (T8 paste): Ctrl/Cmd+V in take-over must paste the clipboard into the page — handoffs are for username/password and people paste from password managers — will join the fix round. Cost: one more input path; clipboard text goes only to the socket.
Task 8 review: Needs fixes — I1: real-window and size-restore state live in one panel copy's memory (right panel vs enlarged window) → Done in the other copy skips window-done (login lost, headed Chromium + tmp state file left) and Hand back skips size restore.
Task 8: minor (deferred, final review should triage M3/M5): M1 handoff missed until next folder change (arm watch before read); M2 notified-ids dedupe not atomic; M3 mouse-up outside picture lost → stuck drag; M4 hand back doesn't restore a tab the person switched to; M5 Cancel leaves tmp/<t>.json, window cleared before window-done, closing the real window by hand not detected; M6 render side effects; M7 focus stays on panel after control ends; M8 ctrl/cmd shortcuts lack codes; M9 big-window frames folder reuse across copies.
Task 8: fix round 1/5 (2 addressed, 1 new open — paste has no length cap; commits 99ff746..bcd6626)
Ruling (T8 paste, extends earlier paste ruling): paste drops one trailing line break (password managers often copy one; Enter would submit early) — cost if wrong: a deliberate trailing newline needs an Enter press.
Task 8: minor (deferred): stale window/sizes stay in the control record after a handoff ends by timeout; finish() repeats work if the clearing write fails / two copies press at once.
Task 8: fix round 2/5 (1 addressed + paste trailing-break ruling, 0 open; commits bcd6626..9989431)
Task 8: complete (commits 2a341b8..9989431, review clean)
Task 9 BASE 9989431
Task 9 implemented 0006ef6 (DONE_WITH_CONCERNS): needs person for panel clicks/typing; a reload during Notes loses the list (agent stays blocked until Cancel); tab switch during pick leaves script in old tab; 2 s polling while picking; README should credit Orca too (cockpit's grab code origin).
Task 9 review: Needs fixes — I1 pick script can be reinstalled into the agent's page after hand-back (read reinstalls; other copy's Cancel race; tab switch leaves it) and silently swallows the agent's clicks; I2 redact misses AWS secret keys (/), prefixed *_secret_*=, X-Api-Key, lowercase bearer, AKIA ids; I3 pick clicks reach the page after navigation/at start until script present; I4 clicks inside iframes reach the page.
Task 9: minor (deferred): redact false positives (Basic/Token/pass/camelCase); unowned pick after reload says "another copy" and blocks agent until Cancel; 8 KB eval every 2 s even when hidden; picture can outline the wrong element; shadow DOM picks host; prompt lines collapse when rendered; failed start leaves no backstop.
Task 9: fix round 1/5 (4 addressed, 1 new open — PAIR regex cubic backtracking; commits 0006ef6..5aec036)
Task 9: minor (deferred): press left down when release happens off the picture (next press dropped, stale up); PAIR over-redacts labels like "authentication:"/"Tokens:"; reload between STOP and handBack write loses the off mark; returning to a tab left during Pick needs Pick restarted.
Task 9: fix round 2/5 (1 addressed, 0 open; commits 5aec036..4342efd)
Task 9: complete (commits 9989431..4342efd, review clean)
Task 10 BASE 4342efd
Ruling (T10 off/on check): app-install machine → toggle browser.enabled in local.json and run herdr-browser-setup.mjs (not npm run deploy); check skills + bin removed, panel gone from layout, signed-in profile kept; then re-enable and re-run setup.
Task 10: complete (commits 4342efd..e3910be, review clean)
Final review (opus): With fixes — I1 open ignores person control & clears handoff; I2 state save after hand-closed window can wipe signed-in.json / window-done always 0 / wording; I3 deploy exits 0 on browser setup failure; I4 real-window leftovers (tmp cookie files, -real session, stuck window take-over after handoff timeout). Minors chosen for the fix wave: M1 announce on timer, M2 skill size advice, M3 panel writes records without terminalCreated, M4 app-mode setup hint, M9 migrationPlan carries browser. Rest "can wait" per triage.
Final fix BASE e3910be
Final fix wave implemented (commits e3910be..21c50ca): I1–I4, M1–M4, M9; state save also checks agent-browser's --json lifecycle (a hand-closed window relaunches a browser whose state is the old --state + NID). Live: login closed-by-hand exit 1, signed-in.json unchanged. Report: final-fix-report.md
Final fix wave: re-review clean (commits e3910be..21c50ca)
