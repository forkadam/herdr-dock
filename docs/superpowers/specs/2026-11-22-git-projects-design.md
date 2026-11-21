# herdr-dock Git projects and CI pipelines — design

Date: 2026-11-22. Builds on the herdr-dock dock (spec `2026-11-21-herdr-dock-design.md`), the config UI, and the
right panel with its rail (`2026-11-21-right-column-design.md`).

## Intent

At work the user has several repos and git worktrees going at once. The company runs a **self-hosted GitLab**,
and every push runs a CI/CD pipeline. Pipelines fail from time to time, and finding out quickly is crucial.
Today they have to go and look.

They want one place that shows every repo and worktree in progress, with each one's **latest pipeline status**.
A failure should reach them even while they work in another terminal.

- GitLab merge requests are rarely used: not needed.
- GitHub is for personal repos (push/pull, nothing special). It shows git status there, plus GitHub Actions runs
  for repos that have them.
- "Machines" (a later, separate piece) will show other computers. This design keeps room for repos on other
  machines, but doesn't build the Machines feature.

**Success:** a pipeline failing on any worktree the user works on announces itself once: a notification, a
sound, and a ✕ in the list. One click reaches the failed job.

## Goals

1. A **Git projects** feature in the left panel: a compact list grouped by repo, one row per worktree.
2. Which repos are listed:
   - repos the user added always show, with all their worktrees;
   - any repo or worktree a terminal is in shows too.
3. Per worktree:
   - the branch;
   - ↑ unpushed and ↓ behind counts (against the upstream as of the last fetch);
   - • for uncommitted changes;
   - ● when a terminal is open in it;
   - the latest pipeline's status: ✓ passed, ✕ failed, ⟳ running or pending, – none, ⚠ unknown or error.
4. A **Pipelines** mod in the right panel (a rail icon) for the selected worktree:
   - the latest pipeline: number, status, branch, commit, how long ago;
   - its stages, each with a status;
   - failed jobs, each with an "open job" link;
   - Retry (GitLab: retry the pipeline; GitHub: rerun failed jobs) and "Open in GitLab/GitHub".
   - It is marked when the pipeline is for an older commit than the local HEAD.
5. **Failure alert.** When a pipeline is first seen to go from not-failed to failed during this Herdr session, or a
   new pipeline is first seen already failed, there is:
   - one Herdr notification, "api · feature/login: test failed". Clicking it selects that worktree and opens the
     Pipelines panel.
   - one sound.
   - Failures that already existed when Herdr started don't alert. They only show ✕.
6. Clicking a row jumps to the space whose terminal is in that worktree. With none, it selects the worktree for
   the Pipelines panel. Clicking the badge opens the Pipelines panel on that worktree.
7. **"+ Add repo"** uses the system folder picker on this PC. A row menu has "Remove repo". The added-repo list is
   per PC.
8. Works on Windows, macOS and Omarchy. Windows is the verified platform, as for the rest of herdr-dock.

## Non-goals

- Merge requests and PRs, issues, reviews.
- Background checks while Herdr is closed.
- Automatic `git fetch`: ↓ is "behind as of your last fetch".
- Editing CI config, and per-job logs inside Herdr (the job opens in the browser).
- The Machines feature itself, and adding repos on other machines by hand. Remote repos appear only
  automatically, from terminals on that machine.

## Anti-goals

- **Tokens never written anywhere by herdr-dock:** not in files, config, shared state or logs. Tokens are
  borrowed in memory from `glab`/`gh`.
- **No repeated alerts** for the same failure, including on restart or after a layout rewrite.
- **Never block or slow the UI.** All git and HTTP work is async and bounded. A slow or unreachable GitLab shows
  ⚠, and nothing hangs.
- **No changes to the user's repos.** Only read-only git commands; the one write action, Retry, goes to the
  CI server and only on a click.
- **Nothing per-PC in the git-synced config.** The repo list and selection live in Herdr shared state
  (`shared.json`).

## Approaches considered

- **1. Built into herdr-dock (chosen).** A collector inside dock-core runs git, and fetches pipeline status
  over HTTPS with the login `glab`/`gh` already store. It publishes the results in shared state; the left and
  right mods only draw. It works the same on all three OSes, and nothing else runs. Its limit is that it only
  checks while Herdr is open.
- **2. A separate background service** (cockpit's hub, Mission Control's backend). It checks while Herdr is
  closed, but it's another program to install and keep running on three OSes, and that is where cockpit
  broke on Windows. Rejected.
- **3. Like 1, but calling the `glab`/`gh` CLI for every request.** It's simpler about auth, but means dozens of
  processes every 30 s, which is slow on Windows. Rejected: the CLIs are used only to borrow the token.

## Design

### Pieces

- **`src/shared/git.js`** (pure, tested) parses:
  - `git worktree list --porcelain`;
  - `git status --porcelain=v2 --branch`, giving branch, upstream, ahead/behind and dirty;
  - `git rev-parse --show-toplevel --git-common-dir`;
  - `git remote get-url origin`, mapped to `{ host, path }` for SSH and HTTPS URLs, with ports, `.git` and
    nested GitLab groups handled.

  It also groups worktrees into repos by their common git dir.
- **`src/shared/ci.js`** (pure, tested):
  - maps GitLab and GitHub API responses to one shape:
    `{ id, status, ref, sha, webUrl, createdAt, stages: [{ name, status }], failedJobs: [{ name, stage, webUrl, duration }] }`;
  - normalizes status: `passed`, `failed`, `running`, `pending`, `canceled`, `skipped`, `none`, `unknown`;
  - decides alerts with `alertFor(previous, current, seenThisSession) -> alert | null`;
  - decides the poll interval for a worktree.
- **`src/shared/platform.js`** gains `openUrlCommand(platform, url)`:
  - Windows: `rundll32 url.dll,FileProtocolHandler <url>`, which avoids `cmd`'s `&` parsing;
  - macOS: `open <url>`;
  - Linux: `xdg-open <url>`.
- **Collector** (`src/mods/dock-core/git-collector.js`, run by the top dock-core copy only, the same way it owns
  the layout):
  - discovers worktrees, polls git and CI, publishes the results, and raises alerts;
  - takes all I/O through an injected `io` object (exec, fetch, readTextFile, notify, playSound, shared), so it
    is testable with fakes, including a fake second machine.
- **`dock-git`** (new left-panel feature mod, left-only like the other core features):
  - expanded: the list;
  - icon rail: a git icon with a red dot when any pipeline failed;
  - collapsed: a header with counts.
- **`dock-pipelines`** (new mod, placeable in the right region): the detail view for the selected worktree.
- **Defaults:**
  - The default config's left region gets `dock-git` between `dock-agents` and `dock-quotas`.
  - The default right region becomes `[dock-pipelines, files, changes]`.
  - The user's per-PC right list doesn't change. They add Pipelines with the dialog.

### Discovery

- **Added repos:** shared key `dock.git.repos` = `[{ path, machine: null }]`.
  - For each, `git -C <path> worktree list --porcelain` gives all its worktrees.
  - A path that is no longer a repo shows a ⚠ row with "Remove".
- **Terminals:**
  - For each pane in `panes()` with a `cwd`, the collector runs
    `git -C <cwd> rev-parse --show-toplevel --git-common-dir`, on the pane's space machine (`exec(..., { on })`).
  - Results are cached by cwd and refreshed when the pane's cwd changes.
  - The cwd's worktree is added. When the cwd is inside a repo that wasn't added, that repo's other worktrees
    aren't listed.
- **Grouping:** worktrees group under their repo (the common git dir). The repo's display name is its main
  worktree's folder name, plus the machine name when it isn't this computer.
- **Identity:** a worktree is identified as `machine|worktree path`, with paths slash-normalized and
  case-insensitive on Windows.

### Git status

- `git -C <wt> status --porcelain=v2 --branch` (one process per worktree) gives:
  - the branch, or "detached @sha";
  - ↑ and ↓ from `branch.ab`;
  - • when there are any changed or untracked entries.
- The HEAD sha comes from `branch.oid`.
- Poll cadence: every 15 s for worktrees with an open terminal, every 60 s for others, and immediately after
  the refresh button.
- No folder watching: on Windows and macOS it is recursive, including `node_modules`, and Herdr limits watches
  to 64. That makes polling the dependable choice.
- At most 4 git processes at once.

### CI

- **Which server:** a worktree's `origin` remote URL gives `{ host, path }`, which maps to a provider.
  - `github.com` is GitHub.
  - A host that `glab` is logged in to is GitLab.
  - Shared key `dock.git.hosts` = `{ "<host>": "gitlab" | "github" }` can override this. The builder may expose
    that later; it's not in this version's UI.
  - Other hosts show git status only, with no badge.
- **Login:**
  - GitLab: the token comes from `glab config get token --host <host>`, run once per host per session.
  - GitHub: the token comes from `gh auth token --hostname github.com`.
  - Tokens are kept in collector memory only.
  - With no login, the badge is ⚠, and the Pipelines panel says "Log in with `glab auth login --hostname <host>`"
    (or `gh auth login`).
  - A 401 response drops the cached token and retries once.
- **Requests** (via `fetch`):
  - GitLab:
    - `GET /api/v4/projects/<url-encoded path>/pipelines?ref=<branch>&per_page=1&order_by=id&sort=desc`;
    - for failed or running pipelines, `GET .../pipelines/<id>/jobs?per_page=100` for stages and failed jobs;
    - Retry is `POST .../pipelines/<id>/retry`.
  - GitHub:
    - `GET /repos/<owner>/<repo>/actions/runs?branch=<branch>&per_page=1`;
    - for failed runs, `GET .../runs/<id>/jobs`;
    - Retry is `POST .../runs/<id>/rerun-failed-jobs`.
  - A repo with no workflows shows no badge.
- **Cadence:**
  - every 30 s while the latest pipeline is running or pending;
  - every 15 s for 2 minutes after the worktree's upstream sha changes (a push was just made);
  - every 5 min otherwise.
  - The refresh button refreshes now.
  - At most 4 HTTP requests at once, each with a 15 s timeout.
  - A failing host backs off up to 5 min and shows ⚠ with the error on hover.

### Published state (shared keys, machine-local)

- `dock.git.repos`: the added repos (written by `dock-git`'s add and remove).
- `dock.git.state`: `{ repos: [{ id, name, machine, provider, host, worktrees: [{ id, path, branch, ahead, behind, dirty, open, space, pipeline: { status, id, sha, webUrl, createdAt, stale, error } }] }], updatedAt }`.
  - The full details live only for the selected worktree, in `dock.git.detail`, so shared state stays small.
- `dock.git.selected`: the selected worktree id, set by row and badge clicks. The collector fetches its details.
- `dock.git.alerted`: `{ "<worktree id>": ["<pipeline id>|<finished at>", ...] }`, the worktree's last 20 alert
  keys (an older single-string value still counts). It is persisted, so a restart doesn't repeat an alert, and a
  list, so switching branches back to an old failure doesn't either.
- Commands (to dock-core, the same way as `right`):
  - `git.refresh`;
  - `git.retry` (the selected pipeline);
  - `git.open` (the selected pipeline's or a job's URL, via `openUrlCommand`).
  - Mods call them through `run("dock-core.<cmd>")`, or by setting a request key in shared state if `run`
    can't reach mod commands; the builder checks which.

### Alerts

- An alert fires only when **all** of these hold:
  - the worktree's pipeline status was first observed this session as not failed, and is now failed; or a
    pipeline id never seen this session is failed and was created after Herdr started;
  - the pipeline's alert key is not in `dock.git.alerted[worktree]`.
- On an alert:
  - `notify({ title: "<repo> · <branch>", body: "Pipeline failed: <first failed job> (+N more)", level: "error", action: { name: "dock-core.git.show", args: { worktree } } })`;
  - `playSound("blocked")`.
- The rail and the `dock-git` icon get a red dot while any pipeline has failed.

### UI

```
LEFT — dock-git                          RIGHT — dock-pipelines
GIT PROJECTS                 ⟳  +        api · feature/login       ↗ GitLab
api                                      #48213  ✕ failed  · 3m ago  a1b2c3d
  ● main            ✓  ↓2                build ✓   test ✕   deploy –
  ● feature/login   ✕  ↑1 •              ✕ test:unit     2m14s   open job ↗
    fix/timeout     ⟳                    ✕ test:e2e      5m02s   open job ↗
herdr-dock · github                      [ Retry ]
  ● main               ↑0                (older commit than local HEAD)
```

- Rows are about 24 px, and long branch names truncate with a tooltip. ⟳ refreshes, + adds a repo, and the row
  menu (right-click) has "Remove repo" (added repos only), "Open in GitLab", and "Copy path".
- With nothing to show: "No repos yet: + Add repo, or open a terminal in a repo."

### Testing

- Unit tests with `node --test` for `git.js` and `ci.js`, and for the collector over a fake `io`. They cover:
  - parsing;
  - grouping across added repos and terminals;
  - a **fake second machine**: a pane whose space has machine `"devbox"`, with `exec` answers keyed by
    `{ on }`;
  - alert transitions, including restart and an already-failed pipeline at startup;
  - poll cadence;
  - a 401 retry;
  - a timeout giving ⚠;
  - no token in published state or logs.
- Live check on Windows: this repo, `herdr-dock`, on GitHub. GitLab is checked with recorded API response
  fixtures, because the company GitLab isn't reachable from this session. The user does a final live check at
  work.

## Constraints

- Same toolchain: esbuild per mod, deploy, `herdr-app check`, Node 22+ for building only. The mods use only the
  Herdr APIs (`exec`, `fetch`, `shared`, `notify`, `playSound`, `pickFolder`, `panes`, `spaces`).
- `git` must be on PATH. `glab` and `gh` are needed only for CI badges. The README says how to install and log in
  (`winget install GLab.GLab`, `glab auth login --hostname <host>`, `gh auth login`).
- No Python and no shell scripts.

## Left to the builder

- Exact icons and spacing, following the dock's theme usage.
- The command-dispatch mechanism between the mods and dock-core (`run` versus a request key).
- How GitLab nested-group paths are URL-encoded (`encodeURIComponent` of the full path).
- Whether the collector lives in dock-core or in its own hidden mod, as long as exactly one copy runs.

## Decisions from the builder check

These are the designer's calls; the user can revise any of them.

- **Pipelines not in this PC's right list.** The badge click and the notification open `dock-pipelines` as a
  dialog (`openOverlay({ mod: "dock-pipelines", kind: "dialog", width: 640, height: 0.7 })`) when it isn't
  placed in the right region. When it is placed, they select it in the right panel and show the panel. Either
  way, one click reaches the failed job. `dock-pipelines`' `mod.json` has no `overlay` key, so it stays placeable.
- **The notification action** is `dock-core.git.show` with `{ worktree }`, and `git.show` joins the command list.
  Herdr runs mod commands by name, as keys.json does for `dock-core.cycle`. The builder spikes this first. If it
  can't carry args, the alert sets `dock.git.selected` before notifying, and the action is a bare
  `dock-core.git.show`.
- **GitLab login detection.**
  - A host counts as GitLab when `glab auth status --hostname <host>` succeeds.
  - The token comes from `glab config get token --host <host>`. If that is empty (keyring or OAuth setups), the
    collector parses the token line of `glab auth status --hostname <host> --show-token`.
  - With no usable token: ⚠ and the login hint.
- **Remote-machine worktrees.** CI depends on the remote URL, not on where the worktree lives, so their badges
  and alerts work the same way: requests go from this PC.
- **Disappearing rows.** A worktree known only from a terminal disappears when no terminal is in it anymore. Its
  `dock.git.alerted` entry stays, so reopening it won't re-alert.
- **Alert scope.** Every listed worktree alerts, including added repos' worktrees with no terminal. That is the
  reason the user chose "added repos always show": a failing pipeline on a worktree they stepped away from
  must not be missed.
- **Detached HEAD.** CI is queried by sha (GitLab `pipelines?sha=`, GitHub `runs?head_sha=`), and the row shows
  "detached @abc1234".
- **No upstream.** The row shows a dim "no upstream" with no ↑/↓, and CI is still queried by branch.
- **GitHub, several workflows.** The collector fetches the branch's recent runs (`per_page=20`), keeps those for
  the newest `head_sha`, and reports the worst status (failed > running/pending > passed). The failed jobs come
  from all of that commit's failed runs.
- **Certificate fallback** (the user isn't sure whether the company GitLab uses its own certificate; git there
  goes over SSH):
  - Requests go through `fetch` first.
  - When `fetch` fails for a host with a network or TLS error (not an HTTP error status), that host switches to
    the CLI route for the rest of the session: `glab api --hostname <host> <path>` (or `gh api`, with `-X POST`
    for Retry).
  - The CLI route uses the OS certificate store and the CLI's own login. The same response mapping applies.
  - The Pipelines panel shows "via glab" for that host, so it's visible which route is in use.
  - Tests cover the switch with a fake `fetch` throwing a TLS error.
- **SSH remotes** (`git@host:group/project.git`, `ssh://git@host:2222/group/project.git`) map to the same
  `{ host, path }` as HTTPS remotes. The API always goes over HTTPS to that host. A host whose API lives
  elsewhere can be mapped with `dock.git.hosts`.
