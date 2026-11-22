# herdr-dock

A configurable dock layout for [Herdr](https://herdr.app): a top bar, a left panel, and optional right and
bottom regions around your main pane. Its main mods (it also ships dock-header, dock-footer and the Dock layout
dialog, dock-config):

- **dock-core**: the left-panel toggle at the start of the tab bar. It cycles the left panel between expanded,
  icons and hidden, keeps the right panel in line with this PC's state, and rewrites the layout when
  `config/dock.json` changes.
- **dock-tabs**: the tab bar, a copy of Herdr's `tabs` with Herdr's Files/Changes buttons replaced by the
  right-panel button (right beside "+").
- **dock-rail**: the icon rail on the far right, one icon per right-region mod.
- **dock-spaces**: your spaces. Click one to select it.
- **dock-agents**: your agents. Click one to focus it. Each local Claude agent shows its context as "NN% used"
  (dimmed when the reading is older than 2 minutes).
- **dock-quotas**: usage limits grouped by provider, each under its icon: Claude and Codex 5-hour and weekly windows
  as "% used", with reset time, age, and a stale mark. A provider with nothing recorded is left out.
- **dock-git**: Git projects, your repos and worktrees with git status and a CI pipeline badge (see
  [Git projects and Pipelines](#git-projects-and-pipelines)).
- **dock-pipelines**: Pipelines, the selected worktree's pipeline: stages, failed jobs, Retry.

Only `config/dock.json` is meant to be synced between machines.
The generated `layouts/herdr-dock.json` is never committed.

## Install

Requires Node 22 or newer and the `herdr-app` CLI on your PATH. Git projects also needs git 2.31 or newer (it uses
`git rev-parse --path-format=absolute`), and `glab`/`gh` for CI badges (see Git projects and Pipelines).

```
npm install
npm run deploy
```

`npm run deploy` builds the `dock-*` mods, installs them into the Herdr app home, writes
`layouts/herdr-dock.json`, adds a `layout:herdr-dock` keys section (Ctrl+Alt+B runs `dock-core.cycle`, Ctrl+Alt+N runs `dock-core.right`, Ctrl+Alt+, runs `dock-core.config`), and runs
`herdr-app check` on each mod. It exits non-zero if any check fails. Run `npm test` for the unit tests.

- **App home.** Deploy writes to `~/.config/herdr-app`, or to `$HERDR_APP_HOME` when that is set. Pass
  `--app-home <dir>` to pick another one: `node scripts/deploy.mjs --app-home <dir>`. Add `--dry-run` to list what
  it would do without writing anything.
- **A key binding is skipped** (deploy still succeeds and says why) when `ctrl-alt-b` or `ctrl-alt-,` in `layout:herdr-dock` is
  already bound to something else, or when `keys.json` doesn't exist yet. Herdr writes `keys.json` on its first
  start: start Herdr once, then re-run `npm run deploy`.
- **Editing keys.json.** On upgrade, Herdr refreshes a `keys.json` you have never touched with its current default
  shortcuts. Any edit, including the section deploy adds, makes the file yours: new default shortcuts from later
  Herdr releases then have to be added by hand.
- **source.json.** Deploy writes `mods/dock-core/source.json`, which points dock-core at this repo's
  `config/dock.json` (and records this computer's hostname as a fallback). If you move or re-clone the repo, re-run
  `npm run deploy`.

## Switching layouts

```
herdr-app do layout.switch '{"name":"herdr-dock"}'
herdr-app do layout.switch '{"name":"main"}'
```

In Windows PowerShell 5.1 the inner quotes need escaping:

```powershell
herdr-app do layout.switch '{\"name\":\"herdr-dock\"}'
```

Or press Ctrl+Shift+L and pick the layout.

The keys section applies while the `herdr-dock` layout is active, so Ctrl+Alt+B works even when the left panel is
hidden.

## The right panel and rail

The right panel shows one right-region mod at a time. The rail on the far right has one icon per right mod, in
config order (it scrolls when there are many):

- Click an icon to show that mod in the panel. Click the icon of the mod that's showing to hide the panel.
- The button right beside "+" in the tab bar, or Ctrl+Alt+N (`dock-core.right`), shows or hides the panel.
- Pipelines, Files and Changes are ordinary right mods (the default right region has all three). Add or remove them, and any
  other mod, in the Dock layout dialog.
- Files and Changes are herdr-dock's own copies (`dock-files`, `dock-changes`) of Herdr's panels. They follow
  the last thing you did: selecting a repo or worktree in Git projects shows that worktree (even with no terminal
  open there, and on another machine); moving to a terminal in another folder shows that terminal's repo again.
  Herdr's own `files` and `changes` always follow the focused terminal.
- Icons: Files and Changes use Herdr's own, `dock-*` mods their manifest icon, other mods `mods/<id>/icon.svg`
  when it exists, else the first letter of their name. Hover for the name.
- Whether the panel is shown and which mod it shows are remembered per PC in Herdr's own state
  (`dock.right.shown`, `dock.right.active`). They are never written to `config/dock.json`, and a config save,
  a deploy or a restart keeps them. A mod you add to the right region while Herdr
  is running in this layout (for example from the Dock layout dialog) opens in the panel.
- The config's `right.hidden` (the dialog's right "shown" switch) is the default. Changing it applies once, the
  same way `left.mode` does.
- With no right mods there is no panel and no rail.

## Panel modes

The left panel has three modes. Ctrl+Alt+B (or the top-bar toggle) cycles through them:

| Mode | What you see |
| --- | --- |
| `expanded` | Spaces, Agents and Quotas in full. |
| `icons` | A 48 px rail of feature icons. Click one to expand the panel with that feature tall and the others collapsed to headers. That focus lasts until the mode changes; Ctrl+Alt+B from a focused panel goes back to plain expanded. |
| `hidden` | No left panel. |

You can also run the commands directly: `herdr-app do dock-core.cycle`, `.expanded`, `.icons`, `.hidden`, and
`.reload` (re-read the config).

## Config

Edit `config/dock.json`. dock-core watches it and rewrites the layout live. An invalid config keeps the last good
layout and shows a red dot on the toggle, so a half-saved file never breaks your window.

```json
{
  "v": 1,
  "regions": {
    "top":    { "size": 42, "features": [ { "mod": "dock-core", "size": 44 }, { "mod": "dock-tabs" } ] },
    "left":   { "size": 268, "mode": "expanded",
                "features": [ { "mod": "dock-header", "size": 46, "drag": true },
                              { "mod": "dock-spaces" }, { "mod": "dock-agents" }, { "mod": "dock-git" },
                              { "mod": "dock-quotas", "size": 150 }, { "mod": "dock-footer", "size": 40 } ] },
    "right":  { "size": 360, "hidden": true,
                "features": [ { "mod": "dock-pipelines" }, { "mod": "files" }, { "mod": "changes" } ] },
    "bottom": { "size": 28,  "features": [ { "mod": "workspace-status" } ] }
  },
  "machines": { "my-hostname": { "regions": { "left": { "size": 320 } } } }
}
```

- Each region has a `size` in px, an optional `hidden`, and a list of `features`. The left region also has `mode`;
  `"hidden": true` on the left region means mode `hidden`. Changing `mode` in the config switches the panel to it.
- The top bar must contain `dock-core` and can't be hidden (the toggle, Ctrl+Alt+B and config errors live there).
  `dock-spaces`, `dock-agents`, `dock-git` and `dock-quotas` can only be placed in the left region.
- A feature is `{ "mod": string, "props"?: object, "size"?: px, "drag"?: boolean }`. With no `size`, it gets
  weight 1 and shares the remaining space. With `"drag": true`, dragging the feature moves the window.
- The left panel starts with `dock-header` (46 px), like the header in Herdr's `main` layout: the Herdr
  brand and search, copied from Herdr's `workspace-chrome` without its collapse button. The left panel is
  toggled by the button at the start of the tab bar and by Ctrl+Alt+B. In icons mode the header shows the
  Herdr logo.
- The left panel ends with `dock-footer` (40 px): the Settings gear and the Dock layout button on the left and
  + Add machine on the right, on one line. A dot on the gear means an update is ready. In icons mode it shows the
  gear.
- `machines.<hostname>` deep-merges into the base config for that machine. Hostnames match case-insensitively.
  Objects merge key by key, arrays (`features`) replace whole, and scalars replace.

### Add a third-party mod to a region

Put the mod's id in a region's `features` and make sure the region is not hidden, or use the Dock layout dialog.
For example, to add Mission Control's GitHub panel to the right panel, next to Files and Changes:

```json
"right": { "size": 360, "features": [ { "mod": "mission-control-github" }, { "mod": "files" }, { "mod": "changes" } ] }
```

Save the file. GitHub gets a rail icon and opens in the right panel.

## Config UI

The "Dock layout" dialog edits the config without hand-editing JSON. Open it any of these ways:

- the layout button in the left panel footer (next to the Settings gear),
- `herdr-app do dock-core.config`,
- Ctrl+Alt+, while the `herdr-dock` layout is active.

Run the command again to close it.

- **Saves go to this PC only.** The dialog writes to `machines.<hostname>` in `config/dock.json`. The shared base
  config is never changed by it, so other machines keep their own layout.
- **Two views.** "By region" lists each region with its features; "By mod" lists each mod with where it is
  placed. Both edit the same draft, and nothing is written until you save.
- **Placement rules are enforced.** The same rules as in Config: the top bar keeps `dock-core`, and `dock-header`,
  `dock-footer`, `dock-spaces`, `dock-agents` and `dock-quotas` only go in the left region. An edit that would
  break them is refused, so the saved config always passes the same checks as a hand edit.
- **Reset this PC to shared** removes this PC's `machines.<hostname>` section, so it follows the shared config again.
- **If `dock.json` changed on disk since the dialog opened** (for example, you edited it by hand), the next Save or
  Reset writes nothing: it loads the file's new version, re-applies only the fields you changed on top (a region's
  size, its shown setting, the left mode, or a region's whole mod list), and shows "dock.json changed on disk; your
  edits were re-applied, check and save again". Check and save again. Everything you didn't change keeps the file's
  new values. If the new version isn't valid JSON or config, your edits are kept and the error is shown; fix the file
  and save again.
- **The first save may reformat `dock.json`.** The writer uses a stable format: 2-space indent, each feature
  object on one line. Content and key order are unchanged, so later saves give small diffs.

## Git projects and Pipelines

**Git projects** (`dock-git`, left panel) lists git repos and their worktrees:

- A repo shows up when you add it with **+**, or when a terminal in Herdr (yours or an agent's, in any space, on
  any machine) works in it: that adds it automatically, so it stays, with its pipelines watched, after the terminal
  closes. An added repo always shows all its worktrees, new ones included. Nothing removes a repo except you.
- Right-click a repo, or hover it and click **✕**, to remove the repo with all its worktrees (also on the menu:
  Open in GitLab/GitHub, Copy path). Removing a repo while a terminal is still in it hides it until all its
  terminals have left; the next time a terminal works in it, it is added again.
- Right-click a worktree for just that worktree: **Hide from list** (only the list changes; it shows again when a
  terminal works in it after none was in it; hiding a repo's last worktree removes the repo) and **Delete
  worktree…** (not for the main checkout): after a warning dialog it runs `git worktree remove`, never with
  `--force`, so git refuses a worktree with uncommitted or untracked files and you get a notification saying why.
  The branch is kept.
- **⟳** re-checks every repo and pipeline now. The list (`dock.git.repos`, `dock.git.skipped`, `dock.git.hidden`)
  is per PC, never in git.
- Each worktree row shows its branch, ↑ahead ↓behind, a dim "no upstream", • for uncommitted changes, a green dot
  when it is open in a space, and the CI badge: ✓ passed, ✕ failed, ⟳ running or pending, – none or canceled,
  ⚠ unknown (hover for why). Click a row to select it (and its space). Click the badge to open Pipelines.
- While any pipeline has failed, the Git projects icon gets a red dot when the left panel is collapsed to icons.

**Pipelines** (`dock-pipelines`) shows the selected worktree's latest pipeline: `<repo> · <branch>` with
"↗ GitLab" (or GitHub) to open it in the browser, the pipeline number, status, age and short sha, the stages,
each failed job with its duration and "open job ↗", and **Retry** (GitLab retries the pipeline; GitHub re-runs the
failed jobs). "(older commit than local HEAD)" means the pipeline is for an older commit than the one checked out
(not pushed yet, or CI hasn't started). "via glab" (or "via gh") means requests for that host go through the CLI
(see below). It sits in the default right region. If this PC's right region doesn't have it, clicking a badge or
an alert opens it as a dialog instead; add it to the right region in the Dock layout dialog to keep it there.

### Install and log in

`git` must be on PATH. CI badges also need the provider's CLI, logged in:

- **GitLab** (any host other than github.com): `winget install GLab.GLab`, then
  `glab auth login --hostname <host>`, for example `glab auth login --hostname gitlab.example.com`.
- **GitHub**: `winget install GitHub.cli`, then `gh auth login`.
- **Restart Herdr after installing `gh` or `glab`.** Herdr reads PATH when it starts, so a CLI installed while it
  runs isn't found and the badge stays ⚠ with the login hint. After a login (no install), press ⟳ in Git projects.

The token is read from the CLI (`glab config get token`, or `gh auth token`) once per host per session and kept
in memory only. Nothing is stored in git: the repo list, the pipeline state and the alerts already sent are in
Herdr's own state on this PC (`dock.git.*` keys), never in `config/dock.json`.

### Which host is which

- `github.com` is GitHub. Any other host is treated as GitLab, so a host with no CI there (for example
  bitbucket.org) shows ⚠ with a glab hint until you turn it off.
- The shared key `dock.git.hosts` overrides this per host: `"gitlab"` or `"github"` forces the provider (a
  GitHub Enterprise host uses `https://<host>/api/v3/`), and `"none"` turns CI off for that host (no badge, no
  ⚠). It has no UI yet: quit Herdr, add it to `~/.config/herdr-app/shared.json`, and start Herdr again:

  ```json
  "dock.git.hosts": { "bitbucket.org": "none", "git.example.com": "github" }
  ```

### How often, and alerts

- A running or pending pipeline is checked every 30 s, every 15 s for 2 minutes after a push, and every 5 minutes
  otherwise. Git status is read every 15 s for worktrees open in a space and every minute for the rest. ⟳ checks
  everything now.
- At most 4 requests run at once, each with a 15 s timeout. A host that fails backs off (30 s up to 5 minutes)
  and shows ⚠ with the error on hover.
- When a pipeline turns failed (or a new failed pipeline appears that was created after Herdr started), you get a
  notification "<repo> · <branch>: Pipeline failed: <first failed job> (+N more)" with a sound. Clicking it opens
  Pipelines for that worktree. Each failure alerts once, also across restarts; a retried pipeline that fails again
  alerts again. Every listed worktree alerts, including added repos' worktrees with no terminal open.
- **"via glab" fallback.** Requests go straight to the host's API first. If that fails with a network or
  certificate error (for example a company GitLab with its own certificate), that host switches to
  `glab api` (or `gh api`) for the rest of the session. That route uses the OS certificate store and the CLI's
  own login, and Pipelines shows "via glab".

### Limits

- Checks run only while Herdr is open; there is no background service. A pipeline that failed while Herdr was
  closed shows ✕ when it starts but doesn't alert.
- No auto-fetch: ↑/↓ compare with the last `git fetch` you ran. Pipelines are read from the server, so they are
  current either way.
- Only the latest pipeline of the branch (or of the commit, when detached) is shown. GitHub runs of several
  workflows for the same commit are combined, with the worst status.

## Where the quota and context numbers come from

No Python is needed anywhere; everything runs on Node.

- **Claude:** your Claude Code status line pipes its JSON to `~/.claude/herdr-statusline-cache.mjs` (installed by
  `npm run deploy` when `~/.claude` exists), which writes `~/.claude/statusline-cache/claude-statusline.json`: the
  5-hour/weekly windows and each session's context %. Add this one line to your status-line script, before it prints:
  - Windows (`statusline.ps1`): `try { $raw | & node "$env:USERPROFILE\.claude\herdr-statusline-cache.mjs" 2>$null | Out-Null } catch {}`
    (with `$raw = [Console]::In.ReadToEnd()` read first, and a UTF-8 `$OutputEncoding`). The `try` keeps the status
    line working on a PC without Node.
  - macOS / Linux (a shell script): `printf '%s' "$input" | node ~/.claude/herdr-statusline-cache.mjs >/dev/null 2>&1`
    (with `input=$(cat)` read first).

  Without it, the Claude block doesn't show and agent rows show no context figure.
- **Codex:** read from Codex's own session logs, `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`: the latest rate limits
  among the most recently written logs of the last 8 days (only their `rate_limits` lines are read, so big logs are
  fine; checked every 30 s, every 5 min while there's no `~/.codex/sessions`). A limit whose reset time has passed
  shows as "reset". Nothing to set up: use Codex once. A custom `CODEX_HOME` isn't followed (mods
  can't read environment variables).
- **Gemini / Antigravity:** not shown. It keeps no usage record on disk; its quota comes from Google's servers, and
  herdr-dock won't use your Google login to fetch it.

## Known limitations

- macOS and Omarchy are untested. v1 was verified on Windows only.
- Per-agent context is available only for local Claude agents. Other and remote agents show no number.
- Third-party mods placed in the left panel are hidden in icons mode.
- Drag-resizes and collapses are machine-local and are not synced. They survive restarts, config edits and mode
  changes; a config edit to a size wins for that size.
- Layout regeneration re-applies the panel mode after a 400 ms wait, so you may see a brief flicker.
