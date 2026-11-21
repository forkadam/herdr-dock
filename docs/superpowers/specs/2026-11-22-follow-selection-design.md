# Files and Changes follow the Git projects selection — design (short)

Date: 2026-11-22. Builds on Git projects (`2026-11-22-git-projects-design.md`).

## Intent

Herdr's shipped Files and Changes panels always show the repo of the **focused terminal**, and nothing can point
them elsewhere. The user wants selecting a repo or worktree in Git projects to switch Files and Changes to it,
including added repos that have no terminal open.

## Approaches

- **Chosen: copy the two mods as `dock-files` and `dock-changes`.** This follows the `dock-tabs` pattern. Only
  their `location()` changes; everything else is Herdr's code unchanged, with the source hashes recorded.
- **Rejected: selecting a row focuses a terminal in that worktree.** It does nothing for added repos with no
  terminal, and it moves the user's focus around.

## Design

- **"Last thing you did wins"** (pure, tested: `src/shared/follow.js`):
  - When `dock.git.selected` changes, the panels follow that worktree: its `path` and `machine`, from
    `dock.git.state`.
  - When the focused terminal's location changes, the panels follow the terminal again, as Herdr does.
  - At startup they follow the focused terminal.
  - A selected worktree that is no longer listed falls back to the terminal.
- **`dock-files` and `dock-changes`:**
  - Herdr's `files` and `changes` `main.js` with `location()` replaced by one that applies the rule. Each keeps
    the rest of Herdr's `location()` shape: `{ cwd, on }`, plus `space` for Files.
  - Their svgs are copied, and their manifests list `regions: ["right", "left", "bottom"]`.
  - Titles: "Files (dock)" and "Changes (dock)".
- **Defaults:** the default right region becomes `[dock-pipelines, dock-files, dock-changes]`, and the rail
  icons map `dock-files`/`dock-changes` to Herdr's own file and changes svgs. The user's per-PC list is
  untouched, and they swap the mods in with the dialog. Never commit `machines.*`.
- **Not changed:** Herdr's own `files` and `changes` mods stay installed and selectable.
