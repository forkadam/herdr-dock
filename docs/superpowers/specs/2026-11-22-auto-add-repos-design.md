# Git projects: auto-add repos that terminals work in — design (short)

Date: 2026-11-22. Builds on `2026-11-22-git-projects-design.md`.

## Intent

The list should cover what the user is working on now, without turning into a repo manager. Before this change, a
repo that was never added with + dropped off the list as soon as its last terminal closed, often an agent's
when it finished. Its pipeline then lost its badge and its alerts. After this change, a repo stays once anything
has worked in it, until the user removes it.

## Approaches

- **Chosen: auto-add on first sight.** The collector appends the repo to the added list.
- **Rejected: keep terminal-only rows for N minutes.** The repo still drops out eventually, and it is harder to
  reason about.

## Design

- **Auto-add.** When a terminal (any space, any machine) is in a repo that isn't covered by `dock.git.repos` and
  isn't skipped, the collector appends `{ path: <that worktree's top>, machine }` to `dock.git.repos`.
  - "Covered" means the repo's common-dir id matches one already resolved from an added entry.
  - While any added entry is still being resolved, auto-add waits a tick, so nothing is appended twice.
- **Remove** works on every repo from the right-click menu:
  - It removes the repo's added entries (`addedPaths`).
  - If a terminal is in any of its worktrees at that moment, the repo id is also put in `dock.git.skipped`.
- **Skipped repos** are hidden from the list completely, terminal rows included, and are never auto-added. A repo
  leaves `dock.git.skipped` once no terminal is in it. When a terminal enters it again later, it is auto-added
  again.
- **State is per PC only:** `dock.git.repos` and `dock.git.skipped` are Herdr shared keys, never in git.
- **Unchanged:** grouping, the ● marker, badges and alerts.
