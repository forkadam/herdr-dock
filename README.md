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
- **dock-notifications**: Notifications, the history of every toast (see [Notifications](#notifications)).
- **dock-where, dock-attention, dock-warnings, dock-system**: the bottom bar (see [Bottom bar](#bottom-bar)).

Only `config/dock.json` is meant to be synced between machines. Per-PC edits live in
`~/.config/herdr-app/herdr-dock/local.json`, never in git. The generated `layouts/herdr-dock.json` is never committed.

## Install

**With an agent:** tell your agent "clone forkadam/herdr-dock and follow INSTALL.md". It checks the
prerequisites, clones, deploys, and asks before touching your status line or installing `gh`/`glab`.

**By hand:** requires Node 22 or newer and the `herdr-app` CLI on your PATH. Git projects also needs git 2.31 or newer (it uses
`git rev-parse --path-format=absolute`), and `glab`/`gh` for CI badges (see Git projects and Pipelines).

```
gh repo clone forkadam/herdr-dock <dir>
cd <dir>
npm ci
npm run deploy
```

`npm run deploy` builds the `dock-*` mods, installs them into the Herdr app home, writes
`layouts/herdr-dock.json`, adds a `layout:herdr-dock` keys section (Ctrl+Alt+B runs `dock-core.cycle`, Ctrl+Alt+N runs `dock-core.right`, Ctrl+Alt+, runs `dock-core.config`, Ctrl+Alt+P runs `dock-core.page`), and runs
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
  `config/dock.json` (and records this computer's hostname as a fallback, and the commit it deployed). If you move or
  re-clone the repo, re-run `npm run deploy`.

### Install the Herdr way

Instead of cloning, Herdr's own sharing convention installs the built `app/` folder: the layout, the `dock-*`
mods and the keys, with no repo, `npm` or deploy step. Tell your agent:

```
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/forkadam/herdr-dock/tree/main/app
```

- **Needs `gh` logged in and set up for git** while the repo is private (`gh auth status`, then `gh auth setup-git`).
- **One install per machine.** If a `dock-*` mod or `layouts/herdr-dock.json` already exists, the agent stops and
  asks; a clone install updates with `npm run update`.
- **Status line.** Set up for you: the install runs `mods/dock-quotas/herdr-statusline-setup.mjs`, and if it
  didn't, Quotas says "Claude: status line not set up" with a **Set up** button. See "Where the quota and context
  numbers come from".
- **Updates.** The Updates strip in the Dock layout dialog compares the installed `VERSION.json` with the published
  one. **Update** opens a tab running `mods/dock-core/update-app.mjs`: it clones the repo into a temp folder,
  checks every mod, swaps the mods in, rolls back if anything fails, and reports. Your layout, your `keys.json`
  bindings and `local.json` are untouched; missing keys are added.

## Updating

The top of the Dock layout dialog has an **Updates strip**:

- `herdr-dock <sha> · up to date · checked 2h ago` with **Check now**.
- `● Update available · 3 new commits (latest: "<subject>")` with **Update**.
- `● Not deployed yet · <deployed sha> → <repo sha>` with **Update**: the repo is ahead of what was last deployed
  (an update whose `npm ci` or deploy failed after the pull, or a pull by hand). Update installs and deploys it.
- `Updating… see the "Update herdr-dock" tab`, then `✓ Updated to <sha> · 3 commits`.
- `Can't update: <reason>`, where the reason is `local changes in the repo` (only when there is something to
  update), `on branch <name>`, `detached HEAD`, or `N local commits`.
- `Can't check: <git's first line>` when the fetch failed.
- `Update failed: <reason>` when `npm run update` failed (its reason names the step, for example
  `deploy failed after pulling 3 commits: …`), or `Update failed: no result…` when no result came within 10 minutes.

How it works:

- **Automatic check.** dock-core checks GitHub's `main` when it starts and every 6 hours. When there are new
  commits it posts one notification, "herdr-dock update available · 3 new commits", once per new upstream commit.
  Click it to open the Dock layout dialog. **Check now** runs the same check right away.
- **Update** opens an "Update herdr-dock" tab running `npm run update` in the repo. The script refuses with local
  changes or when the repo isn't on `main`, runs `git pull --ff-only`, runs `npm ci` only if
  `package.json` or `package-lock.json` changed since the last deploy (or `node_modules` is missing), deploys, and
  reports back: the strip and a notification show the result. Deploy records the commit it installed in
  `mods/dock-core/source.json`; when nothing new was pulled but that commit isn't the repo's, the script still
  installs and deploys, so a failed step is retried by the next run instead of reported as up to date. If the tab is closed mid-run, the strip shows "Update failed: no result…" after 10 minutes.
- **From any terminal.** `npm run update` works the same outside Herdr, for you or an agent.
- Git uses whatever credentials it already has on that PC (the `gh` credential helper, or Git Credential Manager).

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

## Dock pages

For features bigger than a panel: a **page** fills the work area, in place of the terminal. One page shows at a
time, for the whole window (not per space or tab), so a page is never open twice.

- **The Pages bar** (`dock-pages`, a 52 px left-panel feature, after cockpit's app bar): one row of icons on a
  raised strip, the Terminal first, then each page in config order, each with a count badge in its corner (red when
  something needs you, amber for a warning). The one shown sits on a raised tile; hover for its name. Click a page to
  show it; click it again, or the Terminal, to go back. In the left panel's icon mode it is a column of icons.
- **Ctrl+Alt+P** (`dock-core.page`) cycles: the terminal, each page in turn, the terminal again.
  `herdr-app do dock-core.terminals` goes straight back.
- Clicking any tab, space, agent or worktree, or focus moving to another tab (a key, a new tab), brings the
  terminal back. While a page shows, the tab bar's tabs are dimmed.
- Pages are ordinary mods placed in the `pages` region. The layout keeps every page mounted while hidden, so
  switching is instant and a page keeps its scroll and state. The page shown is remembered per PC
  (`dock.page.active`), never in the config.
- **Overview** (`dock-overview`) is the first page: every agent in every space, grouped by status (needs you
  first), as cards; click one to go to it. Its Pages badge counts the agents that need you.
- A page mod gets `props().dockRegion === "pages"`. It may show a badge in the Pages bar by setting the shared key
  `dock.page.badge.<its mod id>` (a number, a short string, or `{ "count": 3, "tone": "bad" | "warn" | "info" }`), and can call `showTerminal()` (`src/mods/_page.js`)
  to hand the work area back.
- Add or remove pages in the Dock layout dialog (Pages section). Placing the first page also adds the Pages bar to
  the left panel. With no pages the layout is exactly as before.

## Jira page

`dock-jira` is a dock page for a self-hosted Jira (Server / Data Center): your issues and filters as a list or a
board, an issue's detail beside them, quick actions, and **Start work**.

- **Add it** on a PC in the Dock layout dialog (Pages section). It isn't in the shared config: it is company-specific.
- **Connect**: the page asks for Jira's address and a **personal access token** (Jira → Profile → Personal Access
  Tokens; Jira 8.14 or later). If you use the mcp-atlassian MCP, its `JIRA_URL` and `JIRA_PERSONAL_TOKEN` are the
  two values. Paste any Jira link as the address: the page keeps only the base (a context path like `/jira` stays).
- **Where things live** (per PC, never in git or the shared config):
  - `<app home>/herdr-dock/jira-work.json`: address, connection, CA file, Start-work message, extra filters.
  - `<app home>/herdr-dock/secrets/jira-work.token` and `jira-work.curlrc`: the token. The folder is made private
    (700) before the token is written, the files 600 after every write; on Windows your profile folder is private.
    The curl copy is re-made from the token file whenever they differ. **Disconnect** empties both.
  - `jira-work.body`, in the same folder: with the curl connection, a request's body (a comment) while it runs,
    emptied afterwards, so its text is never on curl's command line.
- **Connection**: *Herdr (fetch)* by default, or *curl*. Herdr's fetch reports any failure to connect the same way,
  so if the page says it can't reach Jira but Jira opens in your browser, the certificate is the likely cause:
  **Switch to curl**, which uses this computer's certificates (and a company CA file if you give one). The token
  reaches curl only through the private `-K` file, never on its command line.
- **Filters**: Assigned to me (the default), Reported by me, Recently viewed (Jira's `issueHistory()`), then your Jira favourite
  filters, then any listed under `filters` (`[{ "name", "jql" }]`) in the settings file. The search box narrows the
  filter (Enter). The choice and the List / Board view are remembered per PC.
- **List** groups by To do / In progress / Done; **Board** has one column per status of the workflows of the projects
  on it (asked once per project, `GET /project/{key}/statuses`), empty ones too, in Jira's own order. The columns
  share the width; past 240px each, the board scrolls sideways.
- **Drag a card** on the board to move it. When the drag starts the page asks Jira which moves that issue has (its
  workflow, for you, right now): those columns light up, the rest dim, and a status you can reach that has no column
  yet appears as an empty one. Drop on a lit column to move it; when several moves lead there (say Resolve and
  Close into Done) a box in that column asks which, and a move whose step needs a value (a Resolution) asks for it
  there too, from Jira's allowed values. Dropping on a dimmed column says, in that column, where the issue can go.
  A moved card stays in its new column until you change the filter or search (a move to Done takes it out of an
  "unresolved" filter). A step that needs more than one picked value names what's missing and links to Jira.
  This is a board of the filter's statuses, not your Jira sprint board.
- **Detail**: description (Jira markup shown as text), last 5 comments, links, Open in browser. **Actions**: the
  status pill lists the moves the workflow allows (a step that needs a Resolution asks for it; one that needs more
  names what's missing and links to Jira), Assign to me, and a one-line comment box (Enter or Send).
- **Start work** (detail button, or ▶ on a row) opens a tab named after the issue running Claude, with a first message
  from your template, then shows the terminal. Placeholders: `{key} {summary} {url} {type} {status} {priority}
  {assignee} {description}`; type `\n` for a line break. For example `/init-ticket {key}` hands it to your own skill.
  Settings previews the message for the selected issue, and so does the ▶'s tooltip. **Mind `{description}`:**
  anyone who can edit the issue writes that text, and it becomes part of Claude's first message, so a hostile
  description could try to steer the agent. Use it only for issues from people you trust, or leave it out and let
  your skill fetch the issue.
- **Refresh**: every 2 minutes while the page shows, every 10 while hidden (for the Pages badge: your open issues),
  and no sooner than 5 minutes after a failure. A rejected token stops the polling (and clears the badge) until you
  press **Connect again** or **Try again**. The refresh button reconnects at once. A new address forgets the old
  site's issues.
- **Keys**: `dock-jira.next|prev|close|list|board|refresh|settings|status|assign|comment|start` can be bound in
  `keys.json`.
- **Developing without Jira**: `npm run mock:jira` starts a mock Jira at `http://127.0.0.1:8089` (token
  `mock-token`) with 30 issues, a workflow and favourite filters; changes are kept in memory. `--slow <ms>`,
  `--status 500` and `--token <other>` rehearse failures.

## Render

**Render** (`dock-render`, a right-panel mod: its rail icon is the last one) draws what your agent wrote, beside the
terminal, so you keep Claude Code's own terminal UI:

- **Answer**: the focused agent's latest reply (what came after your last message), formatted (headings, lists,
  tables, code), with each ```` ```mermaid ```` block drawn as a diagram. It follows the agent you're looking at (the
  focused pane's, else the tab's first) and updates as the reply arrives.
- **Diagrams**: every Mermaid diagram of the session, newest first.
- **Files**: the Markdown files under the agent's folder (plans, specs), newest first; one opens formatted, with its
  diagrams drawn.
- Click a diagram to open it large. A diagram that doesn't parse shows its error and source.
- **Claude Code** is read from its session transcript (`~/.claude/projects/…/<session>.jsonl`), **Codex** from its
  newest rollout started in the agent's folder. Remote agents aren't followed.
- Diagrams are drawn by `beautiful-mermaid` (MIT, pure JavaScript, no browser), bundled into the mod's helper
  (`mods/dock-render/herdr-render.mjs`): nothing to install, on Windows, macOS and Linux. Each is rendered once into
  `<app home>/herdr-dock/render/`, in your theme's colours. Making its SVG drawable by Herdr's renderer (no CSS
  variables, `color-mix()` or web fonts) is ported from [herdr-chat](https://github.com/ChmaraX/herdr-chat) (MIT).
- **The cache**: rendered diagrams are SVG files in `<app home>/herdr-dock/render/` (`~/.config/herdr-app/herdr-dock/render`
  by default), one per diagram and theme. It tidies itself after each read: a diagram not shown for 14 days goes,
  and past the 300 most recently used; showing one again keeps it. `dock-render.clear` empties it (what's on screen
  is drawn again).
- **Keys**: `dock-render.answer|diagrams|files|refresh|clear`, and in Files `next|prev|open|back`.

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
                              { "mod": "dock-quotas", "size": 220 }, { "mod": "dock-footer", "size": 40 } ] },
    "right":  { "size": 360, "hidden": true,
                "features": [ { "mod": "dock-pipelines" }, { "mod": "files" }, { "mod": "changes" } ] },
    "bottom": { "size": 28,  "features": [ { "mod": "workspace-status" } ] }
  }
}
```

- Each region has a `size` in px, an optional `hidden`, and a list of `features`. The left region also has `mode`;
  `"hidden": true` on the left region means mode `hidden`. Changing `mode` in the config switches the panel to it.
- The top bar must contain `dock-core` and can't be hidden (the toggle, Ctrl+Alt+B and config errors live there).
  `dock-spaces`, `dock-agents`, `dock-git`, `dock-quotas` and `dock-pages` can only be placed in the left region.
- `pages` (optional) holds dock pages: `{ "features": [ { "mod": "dock-overview" } ] }`, features only (no size,
  never hidden). `dock-overview` and `dock-jira` can only be placed there. See "Dock pages".
- A feature is `{ "mod": string, "props"?: object, "size"?: px, "drag"?: boolean }`. With no `size`, it gets
  weight 1 and shares the remaining space. With `"drag": true`, dragging the feature moves the window.
- The left panel starts with `dock-header` (46 px), like the header in Herdr's `main` layout: the Herdr
  brand and search, copied from Herdr's `workspace-chrome` without its collapse button. The left panel is
  toggled by the button at the start of the tab bar and by Ctrl+Alt+B. In icons mode the header shows the
  Herdr logo.
- The left panel ends with `dock-footer` (40 px): the Settings gear and the Dock layout button on the left and
  + Add machine on the right, on one line. A dot on the gear means an update is ready. In icons mode it shows the
  gear.
- **Per-PC overrides** live in `~/.config/herdr-app/herdr-dock/local.json` (or `$HERDR_APP_HOME/herdr-dock/local.json`),
  never in git, so they survive pulls and re-clones. The Dock layout dialog writes it. It deep-merges into the base
  config: objects merge key by key, arrays (`features`) replace whole, and scalars replace.
- **One-time move.** When this PC has no local file yet and `config/dock.json` has a `machines.<this hostname>`
  section, deploy or dock-core (whichever runs first) moves that section into the local file and removes it from
  `config/dock.json`. `machines.*` is legacy: other hosts' sections stay and are still read for them, for
  compatibility, but nothing writes `machines.*` any more.
- **The shared `config/dock.json` places only Herdr's and herdr-dock's own mods.** Third-party mods (for example
  mission-control-*) belong in a PC's local file, which the dialog edits.

### Add a third-party mod to a region

Use the Dock layout dialog (it saves to this PC's local file), or edit `~/.config/herdr-app/herdr-dock/local.json`
(or `$HERDR_APP_HOME/herdr-dock/local.json`) by hand: put the mod's id in a region's `features` and make sure the
region is not hidden. Not `config/dock.json`: it is shared and places only Herdr's and herdr-dock's own mods. For
example, to add Mission Control's GitHub panel to the right panel, next to Files and Changes:

```json
"right": { "size": 360, "features": [ { "mod": "mission-control-github" }, { "mod": "files" }, { "mod": "changes" } ] }
```

Save the local file. GitHub gets a rail icon and opens in the right panel.

## Config UI

The "Dock layout" dialog edits the config without hand-editing JSON. Open it any of these ways:

- the layout button in the left panel footer (next to the Settings gear),
- `herdr-app do dock-core.config`,
- Ctrl+Alt+, while the `herdr-dock` layout is active.

Run the command again to close it.

- **Saves go to this PC only.** The dialog writes `~/.config/herdr-app/herdr-dock/local.json`. The shared
  `config/dock.json` is never changed by it, so other machines keep their own layout.
- **Two views.** "By region" lists each region with its features; "By mod" lists each mod with where it is
  placed. Both edit the same draft, and nothing is written until you save.
- **Placement rules are enforced.** The same rules as in Config: the top bar keeps `dock-core`, and `dock-header`,
  `dock-footer`, `dock-spaces`, `dock-agents` and `dock-quotas` only go in the left region. An edit that would
  break them is refused, so the saved config always passes the same checks as a hand edit.
- **Reset this PC to shared** writes an empty override to the local file, so this PC follows the shared config again.
- **If the local file changed on disk since the dialog opened** (for example, you edited it by hand), the next Save or
  Reset writes nothing: it loads the file's new version, re-applies only the fields you changed on top (a region's
  size, its shown setting, the left mode, or a region's whole mod list), and shows "the dock config changed on disk;
  your edits were re-applied, check and save again". Check and save again. Everything you didn't change keeps the file's
  new values. If the new version isn't valid JSON or config, your edits are kept and the error is shown; fix the file
  and save again.
- **The first save may reformat the local file.** The writer uses a stable format: 2-space indent, each feature
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

## Bottom bar

The bottom bar is a quiet glance. In order, left to right:

- **Where** (`dock-where`): this machine and the branch of the focused space, like `□ This computer  ⑂ main`. It
  takes the free width, so the branch is shown in full when there's room (the tooltip always has it).
- **Limits** (`dock-limits`): your usage limits in one strip, after
  [nozikov/herdr-usage-limits](https://github.com/nozikov/herdr-usage-limits): per provider its icon, then each
  window short, `5h ▬| 17%  wk ▬| 20%  Fable |─ 0%`, with the pace tick, and the time to reset from 70% up
  (`92% · 38m`). Rest the pointer on it for the full panel: the plan and one line per window, as in Quotas. It shares
  the free width with Where. It reads what Quotas collects (`dock.quotas.readings`), so it asks nothing itself;
  with Quotas taken out of the left panel it says "no limits yet".
- **Warnings** (`dock-warnings`): `⟳ 1` pipelines running now, `⚠ quota 92%` when any Claude or Codex window is at
  90% or more, `⚠ disk 7%` when this PC's system drive has under 10% free. With none applying it shows nothing.
- **System** (`dock-system`): a chip icon and a memory icon, each with its %, in the warning colour from 90%.
  Hover them for Herdr's own usage: `CPU 34% · Herdr 0.1%`, `Memory 61% · Herdr 210 MB`.
- **Notifications** (`dock-attention`), at the far right: just a bell, red when something needs you, the accent
  colour when there are only unread items, dim when there's nothing. Hover it for what's there (`⚠ 2 need you · 3
  unread`, or `No notifications`); click it to open the notification history.

Anything that is fine shows nothing. To reorder the items, or move one to another region, use the Dock layout
dialog's **Move up** / **Move down**. Herdr's own `workspace-status` is no longer in the default bottom region, but
you can place it back there in the same dialog.

- CPU and memory are for this PC only, sampled every 5 s.
- **Herdr's usage** counts every local `herdr*` process (herdr-app plus its herdr-core processes), sampled every
  10 s: Windows through one short PowerShell call, macOS and Linux through `ps`. Remote machines aren't counted.
- The quota warning needs **dock-quotas** placed somewhere (it publishes `dock.quotas.top`, refreshed at least
  every minute; a reading older than 2 minutes is ignored). Clicking `⟳ 1` with one pipeline running shows it.
- The shared keys `dock.notify.history`, `dock.system.sample`, `dock.system.herdr` and `dock.quotas.top` are per
  PC, in Herdr's own state, never in `config/dock.json` or git.

## Notifications

**Notifications** (`dock-notifications`, a bell tab in the right panel) is the history of every toast:

- Every notification is recorded, Herdr's own (agent needs you, agent finished, machine login, errors) and those
  from `dock-*` mods (pipeline failures, Delete worktree refusals). `dock-toast` records them and shows the toast
  as Herdr's own does; `dock-core` is the only writer of the history.
- Newest first, each with its level, title, body and time. Items stay until you clear them: **✕** on one, or
  **Clear all**. The history is capped at 200; once over, resolved items go first, then the oldest.
- Click an item to run its action (go to the agent, show the pipeline); in the dialog this also closes it.
  Opening the history marks everything read.
- "Needs you" items (an agent is blocked, a pipeline failed) get a **✓ resolved** mark once the cause is fixed.
  They stay until you clear them, but the red count in the bar counts unresolved ones only.
- If this PC's right region doesn't place it, it opens as a dialog; add it in the Dock layout dialog to keep it
  in the panel.

## Where the quota and context numbers come from

No Python is needed anywhere; everything runs on Node.

- **Claude's limits** (5-hour, weekly, per-model weekly like `weekly · Fable`, and your plan) come first from your own
  `claude` CLI: every 5 minutes Quotas runs `mods/dock-quotas/herdr-claude-usage.mjs`, which asks it for usage the way
  `/usage` does (its own sign-in, no token read, no model usage), in about a second. No setup. Each window is one line (label, bar, usage, time to reset; hover for the rest), and
  each bar has a **pace tick**: how much of the window's time has passed; a bar past its tick is being used up too fast. The idea comes from
  [nozikov/herdr-usage-limits](https://github.com/nozikov/herdr-usage-limits) (MIT); this is a Node version, so it runs
  on Windows too. Without `claude` (or signed out) Quotas falls back to the status line below.
- **Claude's status line** adds two things: fresher 5-hour and weekly numbers between those checks (it reports on every
  reply), and each agent's context %, which only the status line knows. Claude Code hands its 5-hour/weekly limits and each session's context % only to its status-line
  command, so herdr-dock's writer, `herdr-statusline-cache.mjs` (in `mods/dock-quotas/`), has to be in it. It
  writes `~/.claude/statusline-cache/claude-statusline.json`. You don't need a status line of your own: `npm run
  deploy`, the app install and the **Set up** button in Quotas run `herdr-statusline-setup.mjs`, which edits
  `~/.claude/settings.json` (backup first: `settings.json.bak-herdr-dock`):
  - **No status line:** adds `"statusLine": {"type": "command", "command": "node \"<app home>/mods/dock-quotas/herdr-statusline-cache.mjs\""}`.
    It prints nothing, so Claude Code looks the same.
  - **Your own status line, one command** (a script, say): puts the writer in front,
    `node "<writer>" --tee | <your command>`. `--tee` passes the input through unchanged, so yours prints the same.
  - **Already fed** (the command or its script mentions `herdr-statusline-cache`): left alone.
  - **More than one command** (`&&`, `;`, a pipe): left alone; add this line to your script yourself, before it
    prints:
    - Windows (`statusline.ps1`): `try { $raw | & node "$env:USERPROFILE\.config\herdr-app\mods\dock-quotas\herdr-statusline-cache.mjs" 2>$null | Out-Null } catch {}`
      (with `$raw = [Console]::In.ReadToEnd()` read first, and a UTF-8 `$OutputEncoding`). The `try` keeps the
      status line working on a PC without Node.
    - macOS / Linux: `printf '%s' "$input" | node ~/.config/herdr-app/mods/dock-quotas/herdr-statusline-cache.mjs >/dev/null 2>&1`
      (with `input=$(cat)` read first).

  Run it by hand with `node <app home>/mods/dock-quotas/herdr-statusline-setup.mjs` (`--check` only reports);
  `npm run deploy -- --no-statusline` skips it. Until it's in place, Quotas shows the self-check line instead of
  the Claude block, and agent rows show no context figure. The limits appear only on a Claude subscription, after
  a session's first reply. (Older installs used `~/.claude/herdr-statusline-cache.mjs`; deploy still keeps it
  current, so a line pointing there keeps working.)
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
