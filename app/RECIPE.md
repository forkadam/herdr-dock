# herdr-dock

A whole Herdr window rebuilt as a dock. On the left a panel with your spaces, your agents, your Git projects with their CI badges and your Claude and Codex usage limits. Across the top a tab bar with a panel toggle. In the middle your terminal in one rounded pane. On the far right an icon rail that opens a panel of Pipelines, Notifications, Files or Changes. Along the bottom a quiet status bar. Every region can be rearranged from a dialog, per PC.

![herdr-dock](preview.png)

## What you see

The layout (`layouts/herdr-dock.json`) is a row with no title bar, canvas background and 14/12 terminal padding, split by 1px `border` dividers.

- **Left panel** (`dock-left`, 268px, resizable 44 to 480, `chrome` background), top to bottom:
  - Header (46px, drags the window): app name and a search button.
  - Spaces (flexible): your spaces, click to select.
  - Agents (flexible): your agents grouped by status; each Claude row can show its context as "NN%".
  - Git projects (flexible): repos and worktrees with git status and a CI badge (passed, failed, running, warning).
  - Quotas (150px): per provider (Claude, Codex), the 5-hour and weekly windows as "% used" with reset time.
  - Footer (40px): buttons for the layout dialog, adding, and settings.
- **Work area** (`dock-work`), top to bottom:
  - Top bar (42px, drags the window): the panel toggle (44px) then the tab bar with a right-panel button beside "+" and window buttons.
  - Body: the active tab's terminal in a pane (radius 10, `background` color, 1px `border`, 1px `accent` focus border, 8px gap) with a 30px pane header; then the **right panel** (`dock-right`, 360px, 280 to 900, hidden at first) and the **rail** (`dock-rail`, 40px, `chrome` background) with one icon per right mod.
  - Bottom bar (28px): Where, Warnings (210px), System (150px), Notifications bell (36px).
- A toast overlay (`dock-toast`) shows notifications like Herdr's own.

## How it behaves

- **Agent status:** working shows a spinning icon; blocked shows a red "Needs you" pill (a "!" when compact); done shows a filled dot, idle a hollow ring. Agents are ordered blocked, done, working, idle.
- **Left panel modes:** Ctrl+Alt+B (or the top-bar toggle) cycles expanded (everything), icons (a 48px rail; click an icon to expand with that feature tall), hidden (no panel).
- **Dock pages:** the Pages list in the left panel (when a page is configured) shows a page in place of the terminal; clicking the page shown, any tab, space or agent, or Ctrl+Alt+P cycling past the last page brings the terminal back. One page at a time; remembered per PC.
- **Right panel:** Ctrl+Alt+N or the tab-bar button shows or hides it; clicking a rail icon shows that mod, clicking the active one hides the panel. The state is remembered per PC.
- **Ctrl+Alt+,** opens the **Dock layout** dialog (760 wide, 80% high): move features between regions, resize, switch modes, reset this PC. Saves go to this PC only (`~/.config/herdr-app/herdr-dock/local.json`).
- **Bottom bar:** Warnings shows running pipelines, a quota at 90% or more, and low disk; System shows CPU and memory %, in the warning color from 90%; the bell is red when something needs you, accent when only unread. Anything fine shows nothing.
- **Git projects** polls git status (15s for open worktrees, 1 min others) and CI (30s running, 5 min otherwise); a failed pipeline raises a notification once.
- **Notifications** records every toast (cap 200); clicking one runs its action.
- **Updates:** the Dock layout dialog has an Updates strip that checks GitHub when Herdr starts and every 6 hours and offers Update.

## Built from

- **Layout node tree:** `root` row (`toast: dock-toast`) with children `dock-left` (column of blocks `dock-left-N-<mod>`) and `dock-work` (column: `dock-top` row, `dock-mid` row, `dock-bottom` row). `dock-mid` holds `dock-body` (row, padding 8, gap 8: the `dock-main` block with `content.tab: "active"` (with pages configured, inside a stack `dock-work-stack` beside one block `dock-page-<i>-<mod>` per page, `dockRegion: "pages"`) and a `pane` config whose header is Herdr's shipped `pane` mod; and the `dock-right` column holding a `stack` `dock-right-stack` of the four right mods) and the `dock-rail` block. Every block's content is `{mod, props: {dockFeature: <block id>, dockRegion: left|top|right|bottom}}`.
- **Mods** (all `place: "none"`, in `mods/`): `dock-core` (panel modes, layout rewriting from config, update check, notification history, system sampling), `dock-header`, `dock-spaces`, `dock-agents`, `dock-git`, `dock-quotas`, `dock-pages` (the Pages list), `dock-footer`, `dock-tabs`, `dock-rail`, `dock-pipelines`, `dock-notifications`, `dock-files`, `dock-changes`, `dock-where`, `dock-warnings`, `dock-system`, `dock-attention`, the page `dock-overview`, and overlays `dock-config` (dialog, 760 x 80%), `dock-git-delete`, `dock-toast`. Each has `manifest.json`, `mod.json`, `main.js` and its SVG art. `dock-core` also ships `config.json` (the region config), `VERSION.json`, `source.json` and `update-app.mjs`; `dock-quotas` ships `herdr-statusline-cache.mjs` (the writer Claude Code's status line runs) and `herdr-statusline-setup.mjs` (puts it there).
- **Shipped Herdr mods used:** `pane` (the pane header, and its `close.svg` on tabs and the window's close button); `workspace-chrome` (its icons: `spinner`, `chevron-right`, `chevron-down`, `plus`, `check`, `branch`, `monitor`, `server`, `pin`, `pin-off`, `clock`, `layers`); `files` (its `file.svg`, the Files rail icon) and `changes` (its `changes.svg`, the Changes rail icon) when those panels are in the right region; `picker` (opened by the header's search button through `mod.open`); `machine-add` (opened by the footer's Add machine button through `mod.open`, and by Spaces); `menu` (the right-click menu of a tab or a space) and `new-menu` (the tab bar's "+"), opened as popups.
- **Keys** (`keys.json`, section `layout:herdr-dock`): `ctrl-alt-b` runs `dock-core.cycle`, `ctrl-alt-,` runs `dock-core.config`, `ctrl-alt-n` runs `dock-core.right`, `ctrl-alt-p` runs `dock-core.page`.
- **Herdr commands:** `herdr-app do dock-core.cycle|expanded|icons|hidden|reload|right|config|page|terminals`; the mods read spaces, agents and tabs through Herdr's API and share state through Herdr's shared keys (`dock.*`).
- **Programs run** (through the mods' `exec`, plus the update tab):
  - `git` (status, worktrees, diffs, the update clone); `gh` (and `glab` for GitLab hosts: CI tokens and API calls and, in app mode, the published-version check); `node` (the system sampler, folder creation, `update-app.mjs`, `herdr-statusline-setup.mjs`, and Claude Code runs the writer with it); `herdr-app` (`herdr-app check` of every new mod during an update).
  - Windows: `powershell` (Herdr's own CPU and memory; `dock-files` lists folders), `cmd` (`dir`, to list mods and Codex session folders), `findstr` (Codex `rate_limits` lines), `hostname`, `rundll32` (open a CI page in the browser), `explorer` (open a folder).
  - macOS / Linux: `ps` (Herdr's own CPU and memory), `sh` (`dock-files` lists folders), `ls`, `grep`, `hostname` (macOS) or `uname -n` (Linux), `open` (macOS) or `xdg-open` (Linux) for pages and folders.
- **Network:** `raw.githubusercontent.com` and `api.github.com` (update check), the CI APIs of the hosts of your repos, GitHub (the update clone).
- **Files written outside the mod folders:** `~/.claude/settings.json` (its `statusLine`, by `herdr-statusline-setup.mjs`, after a `.bak-herdr-dock` copy), `~/.claude/statusline-cache/` (by the writer), `local.json` (below).
- **Files read outside the mod folders:** `~/.claude/statusline-cache/claude-statusline.json` (Claude limits and context), `~/.claude/sessions/`, `~/.codex/sessions/**/rollout-*.jsonl` (Codex limits), your repos' working folders, and `~/.config/herdr-app/herdr-dock/local.json` (the per-PC overrides, which the dialog also writes).

## Watch out

- **Don't rename anything.** The dock mods refer to each other by name (`dock-core` rewrites the layout, `dock-rail` and `dock-tabs` call the others); the layout must stay `layouts/herdr-dock.json`.
- **If any `dock-*` mod or `layouts/herdr-dock.json` already exists, stop and ask the person.** Do not overwrite or rename. A machine installed from a clone of the repo updates with `npm run update` in that clone; use one install per machine.
- **Tell the person before adding:** it runs programs (git, gh, glab, node, herdr-app; on Windows PowerShell, cmd, findstr, hostname, rundll32, explorer; elsewhere ps, sh, ls, grep, hostname or uname, open or xdg-open); it uses Herdr's shipped `pane`, `workspace-chrome`, `files`, `changes`, `picker`, `machine-add`, `menu` and `new-menu` mods (icons and the dialogs it opens); it reaches the network (GitHub for updates and CI, their repos' CI hosts); it reads the Claude and Codex usage files listed above; and it sets Claude Code's status line in `~/.claude/settings.json`.
- **Claude's numbers need herdr-dock's writer in Claude Code's status line.** After copying the mods, run `node <app home>/mods/dock-quotas/herdr-statusline-setup.mjs` and tell the person what it printed. It edits `~/.claude/settings.json` (backup: `settings.json.bak-herdr-dock`): with no status line it adds one that prints nothing; with a one-command status line it puts the writer in front (`node "<writer>" --tee | <theirs>`, which prints the same); a status line that already feeds herdr-dock or is more than one command is left alone (for the latter, offer the one line from the README, "Where the quota and context numbers come from"). No `~/.claude`: it does nothing. If it didn't run, Quotas shows "Claude: status line not set up" with a **Set up** button that runs the same script. Codex needs nothing.
- **Merge `keys.json`** into the person's: add the section and keys, ask before replacing one already in use.
- **Updates** come through the Dock layout dialog's Updates strip: Update opens a tab running `mods/dock-core/update-app.mjs`, which clones the repo into a temp folder, checks every mod, swaps the mods in and rolls back on failure. The layout, keys and `local.json` are left alone; missing keys are added.
- **The repo is private for now**: the agent installing it (and the update) needs `gh` logged in and set up for git (`gh auth status`, then `gh auth setup-git`).
- The right panel starts hidden.

## Done when

- `herdr-app check` passes for every `mods/dock-*` folder.
- `layout.switch {name: "herdr-dock"}` shows the left panel with Header, Spaces, Agents, Git projects, Quotas and Footer, the tab bar on top, the terminal pane in the middle and the 28px bottom bar; the right panel is hidden but the rail is on the far right.
- Ctrl+Alt+B cycles the left panel expanded, icons (a 48px rail), hidden, and back to expanded.
- Ctrl+Alt+N (or the tab-bar button) shows the right panel with Pipelines, and again hides it; a rail icon switches to Notifications, Files or Changes.
- The bottom bar shows a computer icon with the machine name and a branch icon with the branch on the left, the CPU and memory icons with their %, and the bell at the far right.
- `~/.claude/settings.json` has a `statusLine` whose command (or its script) runs `herdr-statusline-cache.mjs`, unless the person has no Claude Code or chose to add the line themselves; after one Claude Code reply, Quotas shows the Claude block.
- Ctrl+Alt+, opens the Dock layout dialog (760 wide) with the Updates strip at its top.
- A notification that needs the person turns the bell red and appears in Notifications with a "resolved" mark once its cause is fixed.
- A running agent shows a spinner and a blocked one a red "Needs you" pill in Agents.
