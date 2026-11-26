# Spaces folds a space's children

Date: 2026-11-26 · Size: small change · Status: approved 2026-11-26 ("fix both, then do the collapse")

## Why

Since be87008 the Spaces panel lists each space's agents under it, alongside its worktrees. With many
agents (account-center-mf has five sessions) the list grows long. Adam asked for collapse/expand and
chose: **per space**.

## Goals

1. **Fold per space.** A space row with children (agents, or worktrees with their agents) gets a
   chevron. Clicking it folds or unfolds that space's children.
   - A top-level space folds its own agents, its worktrees, and their agents.
   - A worktree row folds only its own agents.
2. **What a folded row says.** A folded row shows how many rows it hides, and the most urgent state
   among the hidden agents (needs you > done > working), drawn as the Agents panel's group headers
   draw it.
3. **Remembered.** Folds survive restarts (`localStorage`). Ids of spaces that no longer exist are
   dropped.

## Non-goals

- No fold-all switch.
- No folding in the narrow icon rail: it draws no children anyway.
- No change to the Agents panel.

## Anti-goals

- Clicking the chevron must not select the space or start dragging it. Today a press then release
  on a space row selects it.
- Folding must not hide where you are. When the active space is a worktree inside a folded parent,
  the parent row:
  - shows the active highlight;
  - is what the list scrolls to.

## Shipped first: the list jumped to the active space on hover

Fixed in 46333df: the list got a stable id, and it scrolls only when its height really changes. The
review of that fix found two more problems. Adam approved both, so they're fixed on this branch
before folding.

## Also on this branch: two fixes Adam approved

1. **A leftover drag moves a space on a later agent-row click** (from be87008).
   - **How it happens:** you press space C, drag it over another space's rows, then let go outside
     the list. The press is never cleared. Your next click on an agent row reaches `dragEnd`, which
     moves C.
   - **Fix:** pressing an agent row clears any leftover space press (`pressed`, `over`) before
     anything else. A press on an agent row is never a space drag.
2. **Widening the panel from the narrow rail no longer reveals the active space** (from 46333df).
   - **Why:** that change is width-only, and the active space's place is counted without agent rows,
     so nothing triggers a scroll.
   - **Fix:** the render-time reveal also fires when the panel switches between narrow and full.

## Approaches

| | Approach | Trade-off | |
|-|-|-|-|
| 1 | **Per space**: a chevron on each space row with children | Fine-grained, and matches the Agents panel's group folding | **Chosen by Adam** |
| 2 | Per space, agents only (worktrees always shown) | Simpler, but a repo with many worktrees still sprawls | Not chosen |
| 3 | One switch in the header hides every agent row | One click, but no per-space choice | Not chosen |

## Decisions (my calls; correct any)

- **The chevron.** It sits at the right end of the row, after the git tail:
  - `chevron-down` while open, `chevron-right` while folded (the `workspace-chrome` icons Spaces
    already uses);
  - dim, and drawn only when the row has children;
  - it handles its own mouse down and up and stops propagation, so the row's drag and select never
    see the click.
- **The folded count.** It counts the rows hidden: agents, plus worktree rows and their agents.
- **Default.** Unfolded. Folds are stored as an array of space ids in `localStorage` key
  `spaces.folded`.
- **Drag.** A folded space can still be dragged and dropped onto. Its hidden rows move with it.

## Tests

- **Placement:** the pure function that builds the rows (`withAgents` or a sibling) leaves out a
  folded space's children:
  - a folded top-level space hides its agents, worktrees and their agents;
  - a folded worktree hides only its own agents;
  - the hidden count and most urgent state are right.
- **Class test, chevron click:** clicking the chevron toggles the fold and runs no `space.select` or
  `space.move`.
- **Class test, active worktree:** with the active worktree hidden, the scroll target is the parent
  row.
- **Remembered:** folds come back after a new instance, and unknown ids are pruned.

## Sketch

```
 [H] herdr-dock                         ▾
   ├─ ✳ herdr-dock-e9                    ○
   └─ ⎇ herdr-dock      spaces-fold      ▾
        └─ ✳ git-project-not-show-mac-7a ◌
 [C] account-center-mf          5  ●     ▸     (folded: 5 hidden, one done)
 [A] amp-refine-ui                       ▾
   └─ ✳ amp-refine-ui-85                 ●
```
