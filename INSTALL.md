# Installing herdr-dock (instructions for an AI agent)

You are setting up herdr-dock on this machine for the user. Follow the steps in order. Ask before the steps marked
**Ask first**. Keep your messages short.

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
npm install
npm run deploy
herdr-app status
```

`npm run deploy` exits non-zero if a mod check fails. Read what it says about a skipped key binding. `herdr-app
status` must show no errors. If it does, fix the cause or report it. Don't go on as if it worked.

## 4. The Claude status line

**Ask first.** This feeds the quota and context numbers.

1. Read `~/.claude/settings.json` and find `statusLine.command`. That points at the user's status-line script. If
   there is none, skip this step and say so.
2. Open the script. If it already calls `herdr-statusline-cache.mjs`, you're done with this step.
3. In `README.md`, section "Where the quota and context numbers come from", find the one line for the user's
   platform (Windows PowerShell, or macOS / Linux shell). Show the user that line and which file you'd add it to.
4. Only if they agree, add it to the script, before the script prints, after the input is read.

## 5. Pipelines: gh and glab

**Ask first.** CI badges need the provider's CLI, installed and logged in (README, "Install and log in"):

- GitHub: `gh auth login`.
- GitLab (any host other than github.com): `glab auth login --hostname <host>`.

Offer to install a missing CLI, and do it only if they say yes. Otherwise skip this step.

## 6. Restart Herdr if you installed a CLI

Herdr reads PATH when it starts. If you installed `gh` or `glab`, tell the user to restart Herdr. If you only
logged in, they can press the refresh button in Git projects instead.

## 7. Finish

Give the user a short summary: where it is cloned, that deploy and `herdr-app status` passed, whether the status
line and the CLIs were set up or skipped, and whether they need to restart Herdr. Mention the layout switch
(Ctrl+Shift+L, pick `herdr-dock`) and that updates arrive from the Dock layout dialog or `npm run update`.

## Never

- Never edit files outside the repo, Herdr's app home (`~/.config/herdr-app`, or `$HERDR_APP_HOME`) and the
  status-line script.
- Never commit or push.
- Never put per-PC settings in `config/dock.json`. They go in `<app home>/herdr-dock/local.json`, through the Dock
  layout dialog.
