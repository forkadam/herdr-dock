# Bottom bar and notification history — design

Date: 2026-11-22. Builds on `2026-11-21-herdr-dock-design.md` (the bottom bar is "for messages, info and
resources").

## Intent

Things that need the user get missed today. A pipeline fails while they're in another space, an agent waits for an
answer, or a toast vanishes before they read it. The bottom bar becomes a quiet glance: who and where they are,
whether anything needs them, and how the machine is doing. A notification history keeps everything until the user
clears it. The bar is the way into that history.

## Goals

- A bottom bar made of small feature mods, in this default order, left to right:
  1. **Where** (`dock-where`): machine and branch of the focused space, like Herdr's status line today
     (`□ This computer  ⑂ main`).
  2. **Attention** (`dock-attention`): `⚠ 2 need you` (red) and `3 unread` (dim). Each is hidden at zero; with
     both at zero it shows a dim `No notifications`. Clicking opens the notification history.
  3. **Warnings** (`dock-warnings`): shown only when they apply:
     - `⟳ 1`: pipelines running now (from `dock.git.state`; status `running` only, not `pending`, which can sit
       for a long time — builder-check call);
     - `⚠ quota 92%`: any Claude or Codex window, 5-hour or weekly, at dock-quotas' `high` level (90% or more,
       `barLevel` in `src/mods/dock-quotas/view.js`), so the bar agrees with the panel and stays quiet below it
       (builder-check call);
     - `⚠ disk 7%`: this PC's system drive (or home volume) under 10% free.
     With none applying it draws nothing.
  4. **System** (`dock-system`): `CPU 34%  RAM 61%` for this PC, at the right edge of the bar.
- A **notification history** (`dock-notifications`), a tab in the right panel next to Pipelines, Files and
  Changes, with its own icon (a bell) on the right rail (decided by the user). It is added to the shared default
  right panel (`config/dock.json` base and the code default) and to this PC's override
  (`machines.forkadam-pc.regions.right.features`, which replaces the default list). Where some PC's config doesn't
  place it, it opens as a dialog, the way `git.show` reveals dock-pipelines today.
  - Every notification is recorded: Herdr's own (agent needs you, agent finished, machine login, errors) and every
    `notify()` from dock mods (pipeline failures, Delete worktree refusals, …).
  - Newest first. Each item shows its level, title, body and time, and has a **✕** to clear it. There is a
    **Clear all**. Items stay until cleared (decided by the user).
  - Clicking an item runs its action when it has one (go to the agent, show the pipeline). Opening the history
    marks every item read.
  - "Needs you" items (an agent blocked, a pipeline failed) get a **✓ resolved** mark once their cause is fixed:
    the agent is no longer blocked, or that worktree's pipeline is no longer failed. They stay until cleared; the
    bar's red count counts unresolved ones only (the user agreed).
- **Reordering** the bar items needs nothing new: the Dock layout dialog already has Move up / Move down on every
  placed feature in every region (`src/mods/dock-config/by-region.js`, edit op `move` in `src/shared/edit.js`),
  and a region's feature order is its order on screen.

## Non-goals

- No clock, and no full quota readout in the bar (both exist elsewhere).
- No CPU or memory for remote machines (only this PC). No graphs or history of CPU or memory.
- No snoozing, grouping or filtering of notifications. No sync of history across PCs.
- No change to how toasts look. The replacement toast mod looks and behaves like Herdr's shipped `toast`.

## Anti-goals

- The bar must not be busy on a normal day: anything that is "fine" shows nothing (or one dim word).
- Polling must not cost noticeable CPU. A system monitor that loads the system is a failure.
- Losing a notification is a failure: anything that showed as a toast must be in the history.

## Constraints and what exists

- The bottom region is a `row` (`src/shared/layout.js`). A feature with `size` gets that many px, and one without
  shares the rest by weight. Its default content is Herdr's `workspace-status`. It is 28 px tall.
- A layout's root may name the mod that shows notifications: `"toast": "<mod>"`. That mod receives
  `props()` `{ title, body, level, icon, action, timeout, overlay }` for every notification, Herdr's and
  `notify()`'s alike. This is how history captures everything.
- `agents()` reports each agent's `status` (`working | blocked | done | idle`), live.
- A mod can only `exec` a command and wait for its output: there is no streaming process. Mods may read and write
  files under `~/.config/herdr-app` (`fs/promises`) and use shared keys (`shared`/`setShared`, persisted, visible
  to every mod).
- Node is already required (deploy runs on it), on all three platforms.
- Feature mods follow the existing contract (`src/mods/_feature.js`, manifest `regions`, `mod.json` place
  `"none"`). Helper or overlay-only mods are kept out of the dialog's list (`mod.json` `overlay: true`, see
  `src/shared/inventory.js`).

## Approaches

- **A. Each bar item its own feature mod, reordered with the Dock layout dialog (chosen by the user).** It matches
  how the rest of the dock is built, and the items can be placed in other regions. The dialog's Move up / Move
  down already exists for every region. It costs four small mods and a width for each item.
- **B. One `dock-status` mod with its own ordered item list.** Quicker, but reordering works only inside the bar,
  and the items can't live elsewhere.

## Design

### Notification capture and history

- New mod `dock-toast`, named by the herdr-dock layout root as `"toast": "dock-toast"`. On each notification it
  appends an item to the history, then renders exactly like the shipped `toast` (copy its behaviour, including
  the machine-login Copy button). Clicking runs the action and closes it, as now.
- History storage: shared key `dock.notify.history`, newest first, capped at 200 items (the oldest cleared items
  go first, then the oldest overall). Item:
  `{ id, at, title, body, level, icon, action, read, needs, resolved }`.
  - `needs`: what it waits on, or null. `{ kind: "agent", pane }` for Herdr's agent-needs-you toasts, matched by
    their action (it names the agent's pane or terminal). `{ kind: "pipeline", worktree }` for pipeline failure
    alerts (the collector's alert action already carries `worktree`). Other items have `needs: null`.
  - `resolved`: set true once its cause is fixed. The agent's status is no longer `blocked`, or the worktree's
    pipeline in `dock.git.state` is no longer `failed`. Checked by `dock-attention` while it runs, so it is kept
    current even when the history isn't open.
- `dock-notifications` (feature mod, regions `["right"]`, also opened as a dialog) renders the list. Each item has
  ✕ to clear, Clear all at the top, and click to run the action. Opening it sets `read` on every item.
- Opening the history: `dock-attention` sets `dock.right.active = "dock-notifications"` and
  `dock.right.shown = true` when this PC's merged config places it in the right panel, else opens it as a dialog
  (the same plan as `showPlan` in `src/shared/gitcmd.js`).

### Bar items

- **dock-where:** the focused space's machine (`This computer` for local) and the branch of its first terminal,
  as Herdr's `workspace-status` shows them today.
- **dock-attention:** counts from `dock.notify.history`: `need you` = items with `needs` and not `resolved`;
  `unread` = items with `read: false` (not counting those already in `need you`).
- **dock-warnings:** reads `dock.git.state` (running pipelines), the quota data dock-quotas already reads (same
  source, its `high` level), and the system sample's disk figure.
- **dock-system:** samples CPU, memory and system-drive free space with a short Node command
  (`node -e …` using `os.cpus()` times over a ~250 ms window, `os.totalmem()`/`os.freemem()`, and `fs.statfs` for
  disk) every 5 s. It publishes `{ cpu, mem, diskFree, at }` to shared key `dock.system.sample` so
  dock-warnings reuses it. CPU and RAM turn the warning colour at 90% and above.
- Default bottom config: `dock-where` (fixed width), `dock-attention` (fixed width), `dock-warnings` (fixed
  width), `dock-system` (takes the rest, content right-aligned). Herdr's `workspace-status` leaves the default
  bottom region. It stays placeable.

## Left to the builder

- Exact widths of the fixed bar items, icons and colours (theme tokens; the warning colour as in dock-git).
- How `dock-toast` recognises Herdr's agent toasts (inspect their props: action name and args).
- Whether the system sample runs in `dock-system` or in dock-core next to the collector, as long as it only runs
  once per PC and costs little.
- The machine-and-branch source for `dock-where` (Herdr's status mod source is a reference).
- Tests for the pure parts: history append, cap, resolve, counts, warning thresholds, the move edit op, the
  sample parser.
