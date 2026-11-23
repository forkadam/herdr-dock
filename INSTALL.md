# Installing herdr-dock (instructions for an AI agent)

You are setting up herdr-dock on this machine for the user. Follow the steps in order. Ask before the steps marked
**Ask first**. Keep your messages short.

Alternative: for Herdr's own sharing convention (no clone), the user can tell their agent `Read
~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/forkadam/herdr-dock/tree/main/app`
(README, "Install the Herdr way"). Use one install per machine.

## 1. Check the prerequisites

- **Node 22 or newer:** `node --version`.
- **git:** `git --version` (2.31 or newer).
- **Herdr installed and run at least once:** `herdr-app` is on PATH, and `~/.config/herdr-app/keys.json`
  exists (Herdr writes it on its first start). If it doesn't, ask the user to start Herdr once.
- **`gh` logged in**, because the repo is private: `gh auth status`. If it isn't installed or logged in, tell the
  user and help them (`gh auth login`) before going on.

Stop and report anything missing. Don't install Node, git or Herdr yourself.

## 2. Clone

Ask the user which folder to clone into. Suggest `~/herdr-dock`. Then:

```
gh repo clone forkadam/herdr-dock <dir>
cd <dir>
```

## 3. Install and deploy

```
npm ci
npm run deploy
herdr-app status
```

`npm run deploy` exits non-zero if a mod check fails. Read what it says about a skipped key binding. `herdr-app
status` must show no errors. If it does, fix the cause or report it. Don't go on as if it worked.

## 4. The Claude status line

Deploy (step 3) already did this: Claude Code gives its usage limits only to a status line, so deploy wires
herdr-dock's writer into `~/.claude/settings.json` (backup: `settings.json.bak-herdr-dock`). Tell the user which
of deploy's `status line:` messages it printed:

- **added a status line**: there was none; the new one prints nothing, so Claude Code looks the same.
- **put the writer in front of your status line**: theirs prints the same as before.
- **more than one command**: their status line was left alone. Show them the one line for their platform in
  `README.md`, section "Where the quota and context numbers come from", and add it to their script only if they
  agree, before it prints, after the input is read.
- **already feeds herdr-dock**: nothing to do.

If they don't want it, run `node scripts/deploy.mjs --no-statusline` next time and restore the backup.

## 5. Pipelines: gh and glab

**Ask first.** CI badges need the provider's CLI, installed and logged in (README, "Install and log in"):

- GitHub: `gh auth login`.
- GitLab (any host other than github.com): `glab auth login --hostname <host>`.

Offer to install a missing CLI, and do it only if they say yes. Otherwise skip this step.

## 6. The browser beside agents

**Ask first.** Turn on the browser beside agents? Downloads agent-browser (~20 MB) and, without a `chrome` path, Chrome
for Testing (~150 MB). Agents then open and drive a real page with `browse`, and the person watches it in the Browser
panel. It is off by default, and a "no" skips this step.

If they say yes, set it in `<app home>/herdr-dock/local.json` (this PC only; the file is `{ "v": 1, ... }`):

```
"browser": { "enabled": true }
```

Add `"chrome": "<path to Chrome or Chromium>"` if they have one and want it used (nothing is downloaded then). Run
`npm run deploy` again. It downloads the pinned agent-browser into `herdr-dock/browser/bin/` (the download is checked
against a pinned checksum), gets Chrome, and writes the `dock-browser` skill to `~/.claude/skills`, `~/.codex/skills`
and, where it has a `skills` folder, `~/.gemini/config/skills`. `--no-skills` skips the skills. Setting `enabled`
back to false and deploying removes the binary and the skills; the signed-in profile stays.

## 7. Restart Herdr if you installed a CLI

Herdr reads PATH when it starts. If you installed `gh` or `glab`, tell the user to restart Herdr. If you only
logged in, they can press the refresh button in Git projects instead.

## 8. Finish

Give the user a short summary: where it is cloned, that deploy and `herdr-app status` passed, whether the status
line, the CLIs and the browser were set up or skipped, and whether they need to restart Herdr. Mention the layout switch
(Ctrl+Shift+L, pick `herdr-dock`) and that updates arrive from the Dock layout dialog or `npm run update`.

## Never

- Never edit files outside the repo, Herdr's app home (`~/.config/herdr-app`, or `$HERDR_APP_HOME`),
  `~/.claude/settings.json` (deploy's status line) and the status-line script.
- Never commit or push.
- Never put per-PC settings in `config/dock.json`. They go in `<app home>/herdr-dock/local.json`, through the Dock
  layout dialog.
