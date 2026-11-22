# Git projects: hide or delete one worktree — design (short)

Date: 2026-11-22. Builds on `2026-11-22-auto-add-repos-design.md`.

## Intent

A repo can have many worktrees. Removing from a worktree's line should act on that worktree, not the whole repo.
Removing the whole repo stays on the repo's line (right-click, or the ✕ shown on hover).

## Design

- **Repo line:** Remove repo (unchanged), plus a ✕ on hover. Right-click menu: Remove repo, Open in GitLab/GitHub,
  Copy path.
- **Worktree line**, right-click: Hide from list, Delete worktree… (not for the main checkout), Open in
  GitLab/GitHub, Copy path (that worktree's folder). The menu is drawn under the line clicked.
- **Hide from list** only changes the list. `dock.git.hidden` (Herdr shared key, per PC) holds `{ id, held }`;
  `held` is true when a terminal was in the worktree when it was hidden.
  - A hidden worktree is left out of `dock.git.state` until a terminal enters it after none was in it (a held
    entry first waits for its terminals to leave).
  - An entry for a worktree that no longer exists is dropped (not while an added repo is still resolving).
  - Hiding a repo's last shown worktree removes the repo instead (same as Remove repo).
- **Delete worktree…** opens the `dock-git-delete` dialog (modal): the branch (accent colour) and the folder name on their own line; the name shows the full path on hover and opens the folder in the file manager when clicked (this PC only). Its Delete sends
  `dock-core.git.delete.<base64url id>`; the collector runs `git -C <main checkout> worktree remove <path>`,
  never `--force`, on the repo's machine. Git refuses a worktree with uncommitted or untracked files; the
  refusal comes back as an error notification. The branch is kept. Then everything is re-polled.
