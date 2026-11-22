# Install and update — design

Date: 2026-11-22. For the user's own machines (this Windows PC, a work PC, a Mac, Omarchy). It may go public
later, so nothing here should rule that out, but nothing is built for it now. `forkadam/herdr-dock` is private;
machines have `gh` logged in.

## Intent

Getting herdr-dock onto a machine, and keeping each machine current, is manual today:
- **install:** clone, `npm install`, `npm run deploy`, then hand-edit the Claude status-line script;
- **update:** `git pull`, then `npm run deploy`, with nothing saying a newer version exists.

The user wants three things:
- **An agent-driven install:** "clone forkadam/herdr-dock and follow INSTALL.md". The agent does the steps that
  need judgement, such as finding the status-line script.
- **Updates surfaced in herdr-dock's own settings:** the Dock layout dialog checks by itself and on demand, and
  applies an update when the user clicks.
- **Per-PC settings out of the tracked config file,** so an update never collides with them. The shared default
  holds only Herdr's and herdr-dock's own mods.

## Goals

1. **Per-PC settings file.**
   - Each PC's overrides live in `<app home>/herdr-dock.local.json`. The app home is Herdr's
     (`~/.config/herdr-app`, or `$HERDR_APP_HOME`).
   - The file is never in git, so it survives re-clones and pulls.
   - The Dock layout dialog saves there ("Save" and "Reset this PC to shared").
2. **Migration, once.**
   - When this PC has no local file yet and `config/dock.json` has a `machines.<this host>` section, that section
     is written to the local file and removed from `config/dock.json`.
   - The working copy then matches git again for that file.
   - It runs in both deploy and dock-core start, whichever comes first.
3. **Shared default stays clean.**
   - `config/dock.json` and the code default (`DEFAULT_CONFIG`) place only Herdr's shipped mods and herdr-dock's
     `dock-*` mods.
   - A test enforces it. Third-party mods (mission-control-*, cockpit, …) belong only in a PC's local file.
4. **Updates strip at the top of the Dock layout dialog,** above the By region / By mod tabs, always visible:
   - `herdr-dock <short sha> · up to date · checked 2h ago   [Check now]`
   - `● Update available · 3 new commits (latest: "<subject>")   [Update]`
   - `Updating… see the "Update herdr-dock" tab`, then `✓ Updated to <sha> · 3 commits`
   - `Can't update: <reason>` when it can't. Reasons: local changes in the repo, cannot fast-forward, fetch failed.
5. **Automatic check.**
   - dock-core checks when it starts and every 6 hours.
   - When `main` on GitHub has commits this repo lacks, it posts **one** notification:
     `herdr-dock update available · 3 new commits`. Clicking it opens the Dock layout dialog.
   - It notifies once per new upstream commit, not on every check.
6. **Check now** runs the same check right away and shows the result in the strip.
7. **Update** opens a Herdr tab named `Update herdr-dock` running `npm run update` (`scripts/update.mjs`) in the
   repo. The script:
   1. stops with a clear message if the repo has local changes (`git status --porcelain` not empty) or is not on
      `main`;
   2. runs `git pull --ff-only` and stops if that fails;
   3. runs `npm ci` only if `package.json` or `package-lock.json` changed between the deployed commit (source.json `commit`) and the new HEAD, or `node_modules` is missing; when nothing was pulled but HEAD differs from the deployed commit, it still installs and deploys (finishing an update that failed after the pull);
   4. runs `node scripts/deploy.mjs`;
   5. reports the result to dock-core, which updates the strip and posts a notification for success or failure.

   The same `npm run update` works from any terminal or for an agent.
8. **`INSTALL.md` for agents,** a checklist an agent follows on a new machine:
   1. check Node ≥ 22, git and Herdr;
   2. clone (with `gh` for the private repo) to a sensible folder;
   3. `npm ci`, then `npm run deploy`, and confirm `herdr-app status` shows no errors;
   4. find the user's Claude Code status-line script (from `~/.claude/settings.json` `statusLine.command`) and add
      the one line from the README, asking first;
   5. optionally install and log in to `gh`/`glab` for pipelines, asking first;
   6. tell the user to restart Herdr if a CLI was installed.

   It never edits files outside the repo, Herdr's app home and the status-line script, and it asks before each of
   the last two.

## Non-goals

- No automatic applying of updates. No release tags or versions: compare commits on `main`.
- Nothing public-facing: no website, no install script fetched by curl, no package registry.
- No updating of other machines from this one.

## Anti-goals

- An update that leaves a machine half-deployed without saying so.
- An update that overwrites or loses the user's local changes or per-PC settings.
- A check that nags: one notification per new upstream commit, at most.

## Constraints and what exists

- **Config.** `parseConfig` and `mergeForHost` in `src/shared/config.js` read `machines.<host>`, deep-merged over
  the base. Deploy (`scripts/deploy.mjs`) and dock-core (`reload`, via `mods/dock-core/source.json`, which points
  at the repo's `config/dock.json`) both merge for this host. The dialog (`src/mods/dock-config/session.js`)
  writes `machines.<host>` into `config/dock.json`.
- **Git and commands.** dock-core already runs git through `exec` and takes `dock-core.<command>` commands with
  arguments in the name (`src/shared/gitcmd.js`, `notifycmd.js`). Notifications go through `notify()`, so
  dock-toast records them. Herdr can open a tab running a program (`tab.new` with `argv`; see
  `~/.config/herdr-app/AGENTS.md`).
- **Deploy replaces dock-core,** so anything that must outlive it goes in shared state or a fresh check.
- Node ≥ 22 is required everywhere.

## Approaches

How "Update" runs. The user picked the Updates strip in the dialog; for the mechanics:
- **A. dock-core pulls and deploys in the background.** Invisible, but deploy replaces dock-core mid-run, and a
  failure shows as one line.
- **B. A visible Herdr tab runs `npm run update` (chosen).** Every step and error is visible. The same command
  works anywhere, and nothing depends on dock-core surviving its own replacement.
- **C. An agent follows an UPDATE.md.** Flexible but slow and costly for what is usually two commands.

Where the per-PC file lives: in Herdr's app home, not in the repo (controller's call, accepted with the
design). It's a per-PC setting like Herdr's own, so it survives re-clones and `git pull` never touches it.

## Design notes

- **Local file shape.** `{ "v": 1, "regions": { … } }`, the same shape as a `machines.<host>` value, deep-merged
  over the base. Merge order: base, then `machines.<host>` (kept for compatibility, normally gone after
  migration), then the local file.
- **Update state.** Shared key `dock.update.state`:
  `{ status: "idle"|"checking"|"available"|"updating"|"updated"|"failed", current, latest, behind, subject,
  checkedAt, reason }`.
  - `dock.update.notified` holds the upstream sha last notified.
  - Check: `git fetch --quiet origin main`, then `git rev-list --count HEAD..origin/main`, then
    `git log -1 --format=%h%x09%s origin/main`, plus `git status --porcelain` and the current branch for the
    can't-update reasons.
- **Update script reporting.** It reports by running `herdr-app do dock-core.update.report.<base64url json>`
  (`{ ok, from, to, commits, reason }`). After deploy, the new dock-core also re-checks on start, so the strip is
  right even if the report is lost.

## Calls made after the builder check (controller's, marked for the user to check)

1. **The local file gets its own folder:** `<app home>/herdr-dock/local.json`, not the app home root.
   - Why: dock-core watches the folder of each file it reads, and the app home root changes all the time
     (`shared.json`).
   - dock-core watches both the repo's `config/` folder and `<app home>/herdr-dock/`, and reloads when either
     changes.
   - The dialog reads both files and builds its draft from the merge. It saves a whole `{ v, regions }`
     override (the same per-PC diff `planSave` already computes) to the local file. A missing local file reads
     as `null`, which `writeTextFile` expects as "doesn't exist yet".
   - The dialog's conflict check applies to the local file. The shared file is read-only to the dialog, and
     "Reset this PC to shared" deletes the local file.
2. **Migration and `machines.*`.**
   - Migration moves only this host's `machines.<host>` section, and only when no local file exists.
   - Other hosts' sections stay in `config/dock.json` and are still merged for them, for compatibility. The
     dialog never writes `machines.*` again.
   - After removing the section, if the file is now JSON-equal to git's committed version, migration writes git's
     exact committed text back (`git show HEAD:config/dock.json`). The dialog's pretty-printing would otherwise
     leave it "modified", and the first `npm run update` would be blocked. On this PC that makes
     `config/dock.json` clean.
   - The shared default already holds only Herdr and herdr-dock mods, so no upstream commit is needed for that.
3. **Repo path.** Deploy adds `repo` (the repo root) to `mods/dock-core/source.json`. dock-core and the dialog use
   it for git and for the update tab. The tab runs `argv: ["node", "scripts/update.mjs"]` with `folder` set to
   the repo; `node` avoids npm's shell differences across platforms.
4. **Reporting the update result: a file, not `herdr-app do`.**
   - The script writes `<app home>/herdr-dock/update-result.json` (`{ ok, from, to, commits, reason, at }`). It
     finds the app home the same way deploy does.
   - dock-core sees it through its folder watch, or at start after deploy replaced it. It then sets the strip
     (`✓ Updated to …` or `Update failed: …`), posts the matching notification, and deletes the file.
   - **The update tab closed mid-run:** if `status` stays `updating` for 10 minutes with no result, the strip
     shows `Update failed: no result (was the update tab closed?)`.
5. **Check details.**
   - The fetch runs as `git -c credential.interactive=never fetch --quiet origin main`, with a 30 s timeout. A
     failure shows as `Can't check: <first line of git's error>`.
   - Credentials are whatever git already uses on that machine (the gh credential helper, or Git Credential
     Manager on Windows).
   - "Update available" needs the repo on `main` with nothing ahead of `origin/main`. On another branch, or with
     local commits, the strip shows `Can't update: on branch X` (or `… N local commits`) and no notification is
     posted.
6. **Notifying.** `dock.update.notified` holds the upstream sha last notified; shared keys persist across restarts.
   A newer upstream sha notifies again, once.
7. **Clone location in INSTALL.md:** the agent asks, suggesting `~/herdr-dock`. Deploy records whatever path is
   chosen, and the README already says to re-run deploy after moving the repo.

## Left to the builder

- Strip styling (theme tokens, as the dialog's header) and the dialog's exact wording within the shapes above.
- How the notification opens the dialog: the existing command or key that opens the Dock layout dialog.
- `INSTALL.md` wording, following the README's install section.
- Tests for the pure parts: local-file merge and migration, the clean-default rule, update-state parsing from git
  output, the update script's decision steps.
