# Jira page: Start work opens in the ticket's repo — design

Date: 2026-11-24. Status: designed, not built. Builds on Start work and Finish (`2026-11-23-jira-views-design.md`).

## Intent

Start work opens a Claude tab with the ticket's first message, but in whatever space is focused: the user started
CLDACC00-775 (an Account Center ticket) and it opened in their herdr-dock space, the wrong repo. Start should land in
the ticket's repo: by itself when the ticket's Jira project belongs to one repo, by asking with a picker when it
doesn't, and, when the user says so, remembering the answer for that ticket.

## What exists (the builder's starting point)

- **Start work** (`src/mods/dock-jira/main.js` `startWork`, ~line 1066): `startWork(issue, template)`
  (`src/shared/jira/page.js`) → `{ command: "tab.new", args: { name: key, argv: ["claude"], task } }`, run with
  `run(...)`, then `showTerminal()`. No folder, so Herdr uses the focused terminal's. **Finish** (`finishWork`) does the
  same with a tab named "<key> finish". Rows and details carry `key` and `project`; a detail carries `parent.key`.
- **Herdr** (`~/.config/herdr-app/herdr.d.ts`): `spaces()` → `SpaceInfo[]` with `id`, `name`, `folder` (where its new
  terminals start; empty = home), `machine` (null = this computer); `tab.new {name?, space?, folder?, argv?, task?,
  focus?}`; `space.new {name?, folder?, argv?, task?, focus?}`; `pickFolder({ prompt? })` → the chosen folder or null;
  `shared(key)` / `setShared(key, value)` persist small per-PC state.
- **Settings** (`jira-work.json`, `src/shared/jira/settings.js` `jiraOptions`): a bad entry is a warning, the rest
  keeps working. The page already has small menus over itself (the status menu, `openTransitions`).
- The user's open tickets (2026-11-24): 141 across 14 projects. CLDACC00 (45) is one repo (`account-center-mf`);
  TEM61510 (49) and INTSI000 (31) span several repos; most others are one repo each.

## Goals

- **Mapping:** the settings gain `projects`, a map from Jira project key to a folder, e.g.
  `{ "CLDACC00": "~/Dev/Workspace/account-center-mf" }` (`~` is the home folder). Projects left out (such as ones that
  span repos) have no folder.
- **Where a ticket opens**, in order:
  1. the folder **remembered** for this ticket;
  2. else its project's **mapped** folder;
  3. else the **picker**.
  A remembered or mapped folder that no longer exists on this PC goes to the picker instead (never guessed).
- **Everything is a folder; spaces are where tabs go** (my call after the builder check: on the user's PC a space's own
  `folder` is often not its repo — their `account-center-mf` space's `folder` is home, one `herdr-dock` space's is
  `~/Dev/Workspace` — while its terminals are in the repo; `SpaceInfo.name` follows the first terminal's repo).
  - A space on this computer **matches** a folder when its `folder` is that folder, or one of its terminals' live
    folder (Herdr's `panes()` `cwd`, joined to the space through its tabs) is that folder or inside it. Paths are
    compared after expanding `~` and dropping a trailing `/`. Several matches: the shown space first, else the first
    in the sidebar. A worktree elsewhere (e.g. under `~/.herdr/worktrees/`) is a different folder and doesn't match.
  - **Opening there:** a new tab in the matching space, always given the folder explicitly (`tab.new { space, folder,
    … }`), so it starts in the repo even when the space's own folder is home. With no match, a new space is made on that
    folder (named after its last part) with the tab in it. Then the terminal comes to the front, as today.
- **The picker** (over the Jira page, like the status menu), titled "Start <key> in…", lists **folders**:
  - one row per distinct folder your spaces on this computer are working in (each space's live terminal folders and
    its own `folder`, home left out), showing the folder's last part, its path dimmed, and the space(s) it's in;
    the mapped folder for the ticket's project, if any and it exists, first;
  - **Here** (the focused terminal's folder, `focused().cwd`: today's behaviour);
  - **Other folder…** (Herdr's system folder picker; cancelling it returns to the picker);
  - a **Remember for this ticket** checkbox, off by default;
  - Escape or a click outside closes it and starts nothing.
  For a sub-task with nothing remembered, its parent's remembered folder is preselected (still a choice).
  Keyboard: arrows move, Enter picks.
- **Remember:** with the box ticked, the chosen folder is stored for that ticket key (per PC, in Herdr's shared state)
  and used by the next Start or Finish of that ticket without asking. **Here** with the box ticked remembers the
  focused terminal's folder.
- **Start in…** (the user's pick, 2026-11-24): a small ▾ beside the detail's **Start work** that always opens the
  picker, whatever is remembered or mapped (and a `start-in` page command for keys). Picking there with Remember ticked
  replaces the ticket's remembered folder; without it, the tab opens there once and the remembered folder stays. This
  is the way out for a mapped project's ticket that belongs to another repo, and for changing a remembered choice.
- **Finish follows the same rule** (my call: Finish opens a tab too, and its skills work in the ticket's repo):
  remembered, else mapped, else the picker.
- **Settings check:** `projects` that isn't a map of project key → non-empty string is a warning; bad entries are
  dropped, good ones kept.
- **Docs:** README's Jira section documents `projects`, the picker and remembering, with a neutral example.

## Non-goals

- A Settings form for `projects` (file only, like `views`; the tabs form is a planned follow-up).
- Forgetting a remembered ticket outright from the UI (Start in… with Remember replaces it; clearing it entirely is by
  hand).
- A "Finish in…" twin (Finish uses the ticket's remembered folder, which Start in… sets).
- Guessing the repo from summaries, components or labels.
- Tabs' buttons (`views[].button`, e.g. a triage button): not about one ticket; they open as today.
- Spaces on other machines.

## Anti-goals

- Starting Claude in a guessed or missing folder.
- Asking on a plain Start when the answer is already known (a remembered ticket, a mapped project whose folder
  exists); only Start in… asks then.
- Company specifics (project keys, paths) in code, tests, README or RECIPE.

## Approaches

- **A. A picker on the Jira page (chosen, 2026-11-24):** the user's spaces with folders, Here, Other folder…, and
  Remember for this ticket; the project → folder map in the settings. Fits the page, reuses the user's spaces.
- **B. Let Claude ask:** Start opens Claude anywhere and its first message asks which repo. Ruled out: a Claude session
  can't move its own folder once started.
- **C. The system folder dialog only:** an OS dialog on every unmapped Start, then remember. Ignores existing spaces
  (would make a new space each time) and is clunky.

The user chose **A**, with the picker for projects that span repos and the option to remember per ticket.

## Left to the builder

- Where the pure pieces live (a `src/shared/jira/start-in.js` is the expected shape: parse `projects`, resolve a
  ticket's folder from remembered/mapped, match a folder to a space from `spaces()` + `panes()` data, the picker's
  rows) and their tests; how the page checks a folder exists (e.g. `exec` of `test -d`/node; the page uses `exec`
  today for curl and `open`).
- The shared-state key and shape for remembered tickets (e.g. `dock.jira.startIn` → `{ "<key>": "<folder>" }`), and a
  sensible cap on its size (e.g. keep the newest few hundred).
- The picker's exact look within the page's menus; what it shows while Herdr's folder dialog is open.
- After the build, with the user's yes, the controller adds their `projects` map (CLDACC00 → account-center-mf and the
  other one-repo projects they confirm).
