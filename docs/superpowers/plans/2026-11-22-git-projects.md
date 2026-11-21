# Git projects and CI pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new features:
- a left-panel **Git projects** list of every repo and worktree in progress, each with its git status and
  latest CI pipeline badge;
- a right-panel **Pipelines** detail view.

A failed pipeline raises one notification plus a sound.

**Architecture:**
- **Pure, tested modules:**
  - `src/shared/git.js` parses git output and remotes.
  - `src/shared/ci.js` maps GitLab and GitHub responses, decides alerts and sets the poll cadence.
  - `src/shared/collector.js` is the stateful collector over an injected `io`.
- **dock-core** runs exactly one collector, in its top copy. It publishes the results in Herdr shared keys and
  handles `git.*` commands.
- **Two drawing mods:** `dock-git` on the left and `dock-pipelines` on the right, which only draw shared state
  and send commands.

**Tech Stack:** Herdr mods (gpui-kit JS, `herdr` module: `exec`, `fetch`, `shared`/`setShared`, `notify`,
`playSound`, `pickFolder`, `panes`, `spaces`, `openOverlay`), esbuild per mod, `node --test`, Node 22+ for
building only.

**Spec:** `docs/superpowers/specs/2026-11-22-git-projects-design.md` (read it whole, including "Decisions from the
builder check").

## Global Constraints

- Tokens are never written by herdr-dock to any file, config, shared key or log. They are borrowed in memory from
  `glab config get token --host <host>` (fallback: the token line of
  `glab auth status --hostname <host> --show-token`) or from `gh auth token --hostname github.com`.
- No change to the user's repos:
  - only read-only git commands: `rev-parse`, `worktree list`, `status`, `remote get-url`;
  - the one write is CI Retry, and only on a click.
- Nothing per-PC in `config/dock.json`. The repo list, selection and alert memory are shared keys:
  - `dock.git.repos`, `dock.git.state`, `dock.git.detail`, `dock.git.selected`, `dock.git.alerted`;
  - `dock.git.hosts` is optional.
- Never block the UI. Everything is async, and the limits are:

  | Limit | Value |
  |---|---|
  | git processes at once | 4 |
  | HTTP requests at once | 4 |
  | HTTP timeout | 15 s |
  | failing-host backoff | up to 5 min |

- Cadence:

  | What | When | Every |
  |---|---|---|
  | git | worktree has an open terminal | 15 s |
  | git | other worktrees | 60 s |
  | CI | pipeline running or pending | 30 s |
  | CI | for 2 min after the upstream sha changes | 15 s |
  | CI | otherwise | 5 min |

- An alert fires only for a failure first observed during this session, never twice for the same
  (worktree, pipeline id), and including after a restart. It is
  `notify({ title: "<repo> · <branch>", body: "Pipeline failed: <first failed job> (+N more)", level: "error", action })`
  plus `playSound("blocked")`.
- Request route: `fetch` first. A network or TLS error (not an HTTP status) switches that host to
  `glab api --hostname <host> <path>` (`gh api` for GitHub) for the rest of the session. The panel shows
  "via glab".
- Status values: `passed` `failed` `running` `pending` `canceled` `skipped` `none` `unknown`.
  - Badges: ✓ for passed, ✕ for failed, ⟳ for running or pending, – for none, ⚠ for unknown or error.
- Mods contain no OS-specific code except through `src/shared/platform.js`. No Python and no shell scripts.
- Never commit `machines.<host>` in `config/dock.json`: stage only base-config lines, built from
  `git show HEAD:config/dock.json`.

## Review Focus

1. **The same worktree reached two ways**, for example added as `D:\work\api` and reached from a terminal at
   `d:/work/api/src`. It must be one row, not two. Test in Task 3.
2. **`glab`/`gh` missing or not logged in.** Git status still shows. The badge is ⚠, the hint says the login
   command, and nothing throws. Test in Task 4.
3. **A restart with a pipeline that already failed.** No alert. A new failure afterwards gives exactly one
   alert, and `dock.git.alerted` survives the restart. Tests in Task 2 and Task 4.
4. **An added path that is no longer a repo, or a repo with no `origin`.** A ⚠ row offering "Remove", or git
   status with no badge, respectively; no crash. Test in Task 3.
5. **Branch names with `/`, `#`, `+` or spaces.** They are URL-encoded in the `ref` query, and the GitLab project
   path is fully encoded (`group%2Fsub%2Fproj`). Test in Task 4.

---

### Task 1: git parsing and the URL opener (`git.js`, `platform.js`)

**Files:**
- Create: `src/shared/git.js`
- Modify: `src/shared/platform.js`
- Test: `tests/git.test.mjs`, `tests/platform.test.mjs` (add cases)

**Interfaces:**
- Produces:
  - `parseWorktrees(porcelain: string) -> { path, head, branch: string|null, detached: boolean, bare: boolean }[]`
    (paths slash-normalized).
  - `parseStatus(porcelainV2: string) -> { branch: string|null, oid: string|null, upstream: string|null, ahead: number|null, behind: number|null, dirty: boolean }`
    (`branch` is null when detached; `ahead`/`behind` are null without an upstream).
  - `parseRevParse(stdout: string) -> { top, commonDir }`. Two lines; both are slash-normalized, and
    `commonDir` is made absolute against `top` when git prints it relative.
  - `parseRemote(url: string) -> { host, path } | null`, covering:
    - `git@host:group/sub/proj.git`
    - `ssh://git@host:2222/group/proj.git`
    - `https://host/group/proj.git`
    - `https://user@host:8443/g/p`

    `host` excludes the port for SSH remotes but keeps the port for HTTPS (the API goes to that origin). `path`
    has no `.git` and no leading `/`.
  - `worktreeId(machine: string|null, path: string, platform) -> string`, giving `"<machine or ''>|<path>"`. On
    Windows the path is lower-cased with forward slashes; trailing `/` is stripped.
- In `platform.js`: `openUrlCommand(platform, url) -> { command, args }`:
  - windows: `{ command: "rundll32", args: ["url.dll,FileProtocolHandler", url] }`
  - macos: `{ command: "open", args: [url] }`
  - linux: `{ command: "xdg-open", args: [url] }`

- [ ] **Step 1: Write the failing tests.** Use real git output samples as fixtures in the test file:
  - `parseWorktrees`: two worktrees, one `detached`, Windows paths `D:/w/api`.
  - `parseStatus`:
    - `# branch.oid abc`, `# branch.head feature/login`, `# branch.upstream origin/feature/login`,
      `# branch.ab +1 -2`, plus one `1 .M ...` line → `ahead 1, behind 2, dirty true`;
    - a clean tree → `dirty false`;
    - `# branch.head (detached)` → `branch null`;
    - no `branch.upstream` line → `ahead null`.
  - `parseRemote`: each of the four URL shapes above, with the exact `{host, path}` expected (for example
    `git@gitlab.corp:a/b/c.git` → `{ host: "gitlab.corp", path: "a/b/c" }`). Garbage gives `null`.
  - `worktreeId(null, "D:\\Work\\Api\\", "windows") === worktreeId(null, "d:/work/api", "windows")`. On linux the
    case is kept.
  - `openUrlCommand` for all three platforms.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test tests/git.test.mjs tests/platform.test.mjs`
  fails because the functions are missing.
- [ ] **Step 3: Implement.** The modules stay pure, with no Node built-ins. Reuse `slashPath` from
  `src/shared/path.js`.
- [ ] **Step 4: Run all the tests.** `npm test` passes, all the existing 153 tests included.
- [ ] **Step 5: Commit.** `git commit -m "feat(git): parse worktrees, status, remotes; URL opener"`

### Task 2: CI mapping, alerts and cadence (`ci.js`)

**Files:**
- Create: `src/shared/ci.js`
- Test: `tests/ci.test.mjs`, plus fixtures `tests/fixtures/gitlab-*.json` and `tests/fixtures/github-*.json`,
  trimmed real API shapes.

**Interfaces:**
- Produces:
  - `type Pipeline = { id, status, ref, sha, webUrl, createdAt, stages: { name, status }[], failedJobs: { name, stage, webUrl, duration }[] }`
  - `normalizeStatus(provider: "gitlab"|"github", raw: { status, conclusion? }) -> Status`:
    - GitLab:
      - `success` → passed; `failed` → failed;
      - `running`, `pending`, `created`, `waiting_for_resource`, `preparing`, `scheduled` → running or pending
        (`running` stays running, the rest are pending);
      - `canceled` and `skipped` map to themselves; `manual` → pending.
    - GitHub:
      - while `status` isn't `completed`: `in_progress` → running, `queued`/`waiting`/`requested`/`pending` → pending;
      - once `completed`, by `conclusion`: `success` → passed;
        `failure`/`timed_out`/`startup_failure`/`action_required` → failed; `cancelled` → canceled;
        `skipped`/`neutral` → skipped.
  - `gitlabPipeline(pipelineJson, jobsJson|null) -> Pipeline`. Stages come in job order, deduplicated; a stage's
    status is its worst job's status. `failedJobs` are the jobs with status failed and `allow_failure !== true`.
  - `githubLatest(runsJson, jobsByRunId: { [id]: jobsJson }) -> Pipeline | null`:
    - takes the runs with the newest `head_sha`;
    - status is the worst of them (failed > running > pending > passed);
    - stages are the run names;
    - `failedJobs` come from the failed runs' jobs.
  - `alertFor({ prev, cur, alerted, startedAt }) -> { title, body } | null`:
    - `prev` is `{ id, status } | undefined` (seen this session), `cur` is a `Pipeline`, and `alerted` is the
      pipeline id already alerted for this worktree.
    - It returns an alert only if `cur.status === "failed" && cur.id !== alerted && (prev ? (prev.status !== "failed" || prev.id !== cur.id) : Date.parse(cur.createdAt) > startedAt)`.
    - `title`/`body` take the repo name and branch from extra args `{ repo, branch }`.
  - `ciInterval({ status, upstreamChangedAt, now }) -> ms`:
    - 30 000 while running or pending;
    - 15 000 while `now - upstreamChangedAt < 120 000`;
    - 300 000 otherwise.
  - `gitInterval({ open }) -> 15 000 | 60 000`.

- [ ] **Step 1: Write the failing tests.**
  - The status map, one assertion per raw value listed.
  - `gitlabPipeline` on a fixture with stages build, test (one failed job, one `allow_failure` failed job) and
    deploy (skipped): stages are `[build passed, test failed, deploy skipped]`, and `failedJobs` has exactly one
    entry, with its `webUrl`.
  - `githubLatest`:
    - two workflows on the same `head_sha`, one failure and one success → failed;
    - an older sha with a failure is ignored;
    - an empty `runs` → `null`.
  - `alertFor`:
    - (a) prev running, cur failed → alert;
    - (b) no prev, cur failed, created before `startedAt` → null (Review Focus 3);
    - (c) no prev, created after `startedAt` → alert;
    - (d) `alerted === cur.id` → null;
    - (e) prev failed with the same id → null;
    - (f) prev failed with a different id, cur failed → alert.
  - The `ciInterval` and `gitInterval` boundaries.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test tests/ci.test.mjs` fails.
- [ ] **Step 3: Implement `src/shared/ci.js`.** It stays pure.
- [ ] **Step 4: Run all the tests.** `npm test` passes.
- [ ] **Step 5: Commit.** `git commit -m "feat(ci): map GitLab/GitHub pipelines, alert and cadence rules"`

### Task 3: Collector: discovery and git status (`collector.js`)

**Files:**
- Create: `src/shared/collector.js`
- Test: `tests/collector-git.test.mjs`

**Interfaces:**
- Consumes: Task 1 (all exports) and `gitInterval` (Task 2).
- Produces:
  - `createCollector(io) -> Collector`, where
    `io = { exec(cmd, args, { on }) -> Promise<{ code, stdout, stderr }>, fetch, now() -> ms, platform, panes() -> [{ cwd, space }], spaces() -> [{ id, machine, name }], shared(key), setShared(key, value), notify, playSound, log }`.
  - `Collector.tick() -> Promise<void>`: one pass that runs whatever is due, bounded by the concurrency limits.
    The host calls it on a 1 s timer.
  - `Collector.refresh()`: marks everything due now.
  - `Collector.state() -> State`, the same object it publishes as `dock.git.state`:
    `State = { repos: [{ id, name, machine, provider: "gitlab"|"github"|null, host, path, added: boolean, error: string|null, worktrees: [{ id, path, branch, detached, sha, upstream, ahead, behind, dirty, open, space, pipeline: null | { status, id, sha, webUrl, createdAt, stale, error, via } }] }], updatedAt }`.
  - The collector writes `dock.git.state` only when it changed (JSON compare).
- Discovery, per spec "Discovery":
  - added repos come from `shared("dock.git.repos")`, via `worktree list`;
  - panes go through `rev-parse` with `{ on: space.machine }` and are cached per (machine, cwd);
  - grouping is by `worktreeId(machine, commonDir)`.
  - The repo `name` is the folder name of its main worktree, plus ` · <machine>` when the machine isn't null.
  - `open` is true when a pane's top equals the worktree path; `space` is that pane's space id.
  - The provider is detected in Task 4 and left null here.
- Git status: `git -C <wt> status --porcelain=v2 --branch` on its machine, at the `gitInterval` cadence. The `origin`
  URL comes from `git -C <wt> remote get-url origin`, once per repo.

- [ ] **Step 1: Write the failing tests.** The fake `io.exec` answers by `(on, args.join(" "))` from a table and
  counts concurrent calls.
  - **(a) Two worktrees of one added repo**, plus a terminal in another repo on machine `"devbox"` (the **fake
    second machine**). That gives two repos; the devbox repo name ends in `· devbox`, and its git calls carry
    `{ on: "devbox" }`.
  - **(b) The same worktree reached two ways** (Review Focus 1): added `D:\work\api`, and a pane at
    `d:/work/api/src` on windows. That's one worktree, with `open: true`.
  - **(c) An added path that is no longer a repo** (`rev-parse` exits 128): the repo has `error` set and no
    worktrees. A repo with no `origin` (exit 2) gives `host: null, provider: null` and no error (Review Focus 4).
  - **(d) Git cadence:** a worktree with an open terminal is re-polled after 15 s, not at 10 s. Others are
    re-polled at 60 s. Fake the time with `io.now`.
  - **(e) Never more than 4 git processes at once,** with 10 worktrees.
  - **(f) Publishing:** `setShared("dock.git.state")` isn't called again when nothing changed.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test tests/collector-git.test.mjs` fails.
- [ ] **Step 3: Implement** `src/shared/collector.js` (git half). Keep the concurrency limiter as a small internal
  helper.
- [ ] **Step 4: Run all the tests.** `npm test` passes.
- [ ] **Step 5: Commit.** `git commit -m "feat(collector): discover repos/worktrees from added repos and terminals; git status"`

### Task 4: Collector: CI, logins, fallback, alerts and actions

**Files:**
- Modify: `src/shared/collector.js`
- Test: `tests/collector-ci.test.mjs`

**Interfaces:**
- Consumes: Task 2 (all exports), Task 3's `Collector`.
- Produces, on `Collector`:
  - `select(worktreeId)`: sets `dock.git.selected`, fetches details, and publishes `dock.git.detail` =
    `{ worktree: id, repo, branch, provider, via: "fetch"|"glab"|"gh", pipeline: Pipeline|null, olderThanHead: boolean, error: string|null, hint: string|null }`.
  - `retry() -> Promise<{ ok, error }>`: for the selected pipeline. GitLab: `POST /api/v4/projects/<enc>/pipelines/<id>/retry`.
    GitHub: `POST /repos/<o>/<r>/actions/runs/<id>/rerun-failed-jobs` for each failed run of that sha.
  - `urlFor(target: "pipeline" | { job: number }) -> string|null`.
- Provider and login, per host, once per session:
  - `github.com` is GitHub, token from `gh auth token --hostname github.com`.
  - Otherwise, `glab auth status --hostname <host>`: exit 0 means GitLab.
    - The token comes from `glab config get token --host <host>`. If that's empty, parse the line matching
      `/Token:\s*(\S+)/` from `glab auth status --hostname <host> --show-token`.
  - `shared("dock.git.hosts")[host]` overrides the provider.
  - With no CLI, not logged in, or no token: `pipeline.status "unknown"`, `error: "not logged in"`, and
    `hint: "glab auth login --hostname <host>"` (or `"gh auth login"`).
- Requests:
  - GitLab: `https://<host>/api/v4/projects/${encodeURIComponent(path)}/pipelines?ref=${encodeURIComponent(branch)}&per_page=1&order_by=id&sort=desc`.
    A detached HEAD uses `sha=<sha>` instead of `ref`. Jobs come from `.../pipelines/<id>/jobs?per_page=100` when
    the status is failed or running.
  - GitHub: `https://api.github.com/repos/<path>/actions/runs?branch=<enc>&per_page=20` (or `head_sha=`), and jobs
    from `.../actions/runs/<id>/jobs` for failed runs.
  - Headers: GitLab `PRIVATE-TOKEN: <token>`; GitHub `Authorization: Bearer <token>` and
    `Accept: application/vnd.github+json`.
  - A 401 drops the cached token, re-reads it once and retries once.
  - A 15 s timeout (`AbortController`) gives `error: "timeout"`.
  - A failing host backs off 30 s, 60 s, 120 s, then 300 s.
  - **Fallback:** a `fetch` that throws (a network or TLS error, not an HTTP status) switches that host to the
    CLI route for the session: `glab api --hostname <host> "<path after /api/v4/>"` (or
    `gh api "<path after https://api.github.com/>"`), with `-X POST` for retry, and parses stdout as JSON.
    `via` reports the route.
- Alerts: after each pipeline update, `alertFor` with
  `{ prev: this session's last seen, cur, alerted: shared("dock.git.alerted")?.[wt], startedAt }`. On an alert:
  - `setShared("dock.git.alerted", { ...old, [wt]: cur.id })` before `notify`;
  - `notify({ title, body, level: "error", action: { name: "dock-core.git.show", args: { worktree: wt } } })`;
  - `playSound("blocked")`.
- Just pushed: when a worktree's `ahead` goes from more than 0 to 0 between two status polls (a push), record
  `upstreamChangedAt = now`. `ciInterval` then polls CI every 15 s for 2 min. Test (i) covers it.

- [ ] **Step 1: Write the failing tests** with a fake `fetch` (by URL, answering from the fixture JSON) and a fake
  `exec` for `glab`/`gh`.
  - **(a) A GitLab worktree with a failed pipeline** reaches state `pipeline.status "failed"` with the right
    `webUrl`. The fake `fetch` received a `PRIVATE-TOKEN` header. The published state, the detail and every
    `io.log` call **contain no token string** (search the JSON for it).
  - **(b) Branch `feature/a b#c+d`** and project path `grp/sub/proj`: the request URL contains
    `projects/grp%2Fsub%2Fproj` and `ref=feature%2Fa%20b%23c%2Bd` (Review Focus 5).
  - **(c) `glab` missing (exec rejects) or `auth status` exit 1:** status `"unknown"`, `hint` equals
    `"glab auth login --hostname gitlab.corp"`, and git fields still filled (Review Focus 2).
  - **(d) A keyring login:** `config get token` prints nothing, `auth status --show-token` prints
    `✓ Token: glpat-xyz`, and the token used is `glpat-xyz`.
  - **(e) A fetch that throws `TypeError("fetch failed", { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } })`:**
    the next request for that host goes through `exec("glab", ["api", "--hostname", "gitlab.corp", "projects/..."])`,
    and `detail.via === "glab"`.
  - **(f) A 401, then 200:** exactly one token re-read and one retry.
  - **(g) A request that never resolves:** after 15 s of fake time, `error: "timeout"` and status `"unknown"`.
  - **(h) Alerts:**
    - a running → failed transition alerts once, with `playSound("blocked")`, and `alerted` written;
    - the next tick doesn't alert again;
    - a new collector over the same shared store (a simulated restart) with the same failed pipeline doesn't
      alert (Review Focus 3).
  - **(i) Cadence:** a running pipeline is re-queried at 30 s, a passed one at 5 min, and an upstream change
    gives 15 s for 2 min.
  - **(j) `retry()`** on GitLab posts to `.../pipelines/48213/retry`.
  - **(k) GitHub** with two workflows on one sha (one failed): status failed, and the failed job is listed.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test tests/collector-ci.test.mjs` fails.
- [ ] **Step 3: Implement** the CI half of `collector.js`. If the file passes about 450 lines, split the
  HTTP/CLI route into `src/shared/ci-client.js` and note it.
- [ ] **Step 4: Run all the tests.** `npm test` passes.
- [ ] **Step 5: Commit.** `git commit -m "feat(collector): CI via fetch with glab/gh fallback, logins, alerts, retry"`

### Task 5: dock-core runs the collector, plus `git.*` commands

**Files:**
- Modify: `src/mods/dock-core/main.js`
- Create: `tests/core-git.test.mjs`, only if dock-core logic is factored into a pure helper. Otherwise the check
  is live.

**Interfaces:**
- Consumes: `createCollector` (Task 3/4) and `openUrlCommand` (Task 1).
- Produces:
  - In the top dock-core copy only (`isTop()`, not `checking()`): build `io` from the `herdr` module
    (`exec`, `fetch`, `panes`, `spaces`, `shared`, `setShared`, `notify`, `playSound`,
    `platform: window()?.platform`, `now: Date.now`, `log: console.log`).
  - Run `tick()` every 1000 ms in a `cx.spawn` loop with `cx.sleep(1000)`.
  - Commands, via `nextCommand`:
    - `git.refresh`;
    - `git.retry`;
    - `git.open` (opens the selected pipeline's URL);
    - `git.open.job.<index>` (opens failed job N of the selected detail);
    - `git.select.<worktreeId-base64url>`, and `git.show` (see below).
  - URLs open with `exec(openUrlCommand(platform, url))`.
- **`git.show` with args:**
  - **Step 1 is a spike:** confirm whether `nextCommand()` delivers args for `herdr-app do dock-core.git.show '{"worktree":"x"}'`.
    - If yes, `git.show` takes `{ worktree }`.
    - If not, the alert sets `dock.git.selected` before notifying, and `git.show` reads it.
  - Record the outcome in the report.
  - `git.show`:
    1. calls `collector.select(worktree)`;
    2. if `dock-pipelines` is in the merged right region, sets `dock.right.active = "dock-pipelines"` and
       `dock.right.shown = true`;
    3. otherwise `openOverlay({ mod: "dock-pipelines", kind: "dialog", width: 640, height: 0.7 })`.

- [ ] **Step 1: Spike the command args.** Note the result in the report.
- [ ] **Step 2: Implement the wiring and commands.** dock-core's existing layout logic is unchanged.
- [ ] **Step 3: Check it live.**
  - `npm test` passes, and `npm run deploy` passes `herdr-app check`.
  - `herdr-app do dock-core.git.refresh` runs.
  - After one tick, `shared.json`'s `dock.git.state` lists this repo (`herdr-dock`, github), because a terminal
    is in it.
  - `herdr-app status` errors are `[]`.
- [ ] **Step 4: Commit.** `git commit -m "feat(dock-core): run the git/CI collector; git.* commands"`

### Task 6: `dock-git` left-panel feature

**Files:**
- Create: `src/mods/dock-git/{main.js,mod.json,manifest.json,icon.svg,git-branch.svg}`.
  - Icons are copied from `~/.config/herdr-app/mods/workspace-chrome/` (`git-branch.svg` and so on), with the
    source recorded in a comment.
  - `mod.json` is `{ "place": "none", "title": "Git projects" }`.
- Modify:
  - `src/shared/config.js`: add `"dock-git"` to `LEFT_ONLY`; insert `{ mod: "dock-git" }` after `dock-agents` in
    `DEFAULT_CONFIG.regions.left.features`.
  - `config/dock.json`: base left features, the same insertion. Stage only base lines, never `machines.*`.
  - `tests/layout.test.mjs`, `tests/edit.test.mjs` and `tests/build.test.mjs`: update the expected default lists
    and the mod lists.
- Test: `tests/git-view.test.mjs`, for a pure view-model helper exported from `src/mods/dock-git/view.js`.

**Interfaces:**
- Consumes: `dock.git.state`, `featureMode` (`src/mods/_feature-mode.js`), `iconRail` (`src/mods/_feature.js`).
- Produces: `gitRows(state, selected) -> { kind: "repo"|"worktree"|"empty", ... }[]` and
  `badgeOf(pipeline) -> { glyph: "✓"|"✕"|"⟳"|"–"|"⚠"|"", tone: "ok"|"bad"|"busy"|"dim"|"warn" }`.

UI, per spec "UI":
- **Header:** "GIT PROJECTS" with ⟳ (`run("dock-core.git.refresh")`) and + (`pickFolder({ prompt: "Add a repo" })`,
  then append `{ path, machine: null }` to `dock.git.repos` if it isn't already there).
- **Repo rows**, then **worktree rows**:
  - Each worktree row has ● (open), the branch (truncated, with a tooltip), the badge, ↑N/↓N (hidden when 0 or
    null; "no upstream" dim), and • when dirty.
  - Clicking a row: if `open`, `run("space.select", { id: space })`; always also
    `run("dock-core.git.select.<b64>")`.
  - Clicking the badge: `run("dock-core.git.show", { worktree })`, or the spike's fallback.
  - Right-clicking an added repo row: an inline menu with "Remove repo", "Open in GitLab/GitHub" and "Copy path".
  - A repo row with `error`: ⚠ plus "Remove".
- **Empty state:** "No repos yet: + Add repo, or open a terminal in a repo."
- **Icon rail face:** the git icon, with a red dot when any worktree's pipeline failed.
- **Collapsed face:** the header plus "N repos · M failing".

- [ ] **Step 1: Write the failing test** for `gitRows`/`badgeOf`:
  - the glyph for each status;
  - repo then worktree order;
  - the empty state;
  - an error repo row.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement** `view.js`, `main.js` and the config changes.
- [ ] **Step 4: Run the tests and check it live.**
  - `npm test` passes, and `npm run deploy` passes `herdr-app check`.
  - `herdr-app shot` shows Git projects listing `herdr-dock` / `main` with ● and the GitHub status.
  - Clicking + isn't checkable by CLI: list it for the human.
- [ ] **Step 5: Commit.** `config/dock.json` is staged with base lines only:
  `git commit -m "feat(dock-git): Git projects list in the left panel"`

### Task 7: `dock-pipelines`, the README and the end-to-end check

**Files:**
- Create: `src/mods/dock-pipelines/{main.js,mod.json,manifest.json,icon.svg}`.
  - `mod.json` is `{ "place": "none", "title": "Pipelines" }`, with **no** `overlay` key.
  - `icon.svg` is a pipeline or CI glyph from `workspace-chrome` (for example `git-compare.svg`).
- Modify:
  - `src/shared/config.js` `DEFAULT_CONFIG.regions.right.features` → `[{ mod: "dock-pipelines" }, { mod: "files" }, { mod: "changes" }]`,
    and the same in the base `config/dock.json` (base lines only).
  - `README.md`: Git projects and Pipelines; install and log in (`winget install GLab.GLab`,
    `glab auth login --hostname <host>`, `gh auth login`); the cadence; the alerts; the "via glab" fallback; that
    nothing is stored in git; limits (checks only while Herdr is open, no auto-fetch).
  - Test lists: layout and build.

**Interfaces:**
- Consumes: `dock.git.detail` and `dock.git.state`; the commands `git.retry`, `git.open` and
  `git.open.job.<i>`; `props().overlay` (a dialog copy shows a close ×).

UI, per spec:
- **Title:** `<repo> · <branch>` plus "↗ GitLab".
- **Pipeline line:** `#id`, the badge and status word, "· 3m ago", and the short sha. "(older commit than local
  HEAD)" when `olderThanHead`; "via glab" when `via !== "fetch"`.
- **Stages row**, then the **failed jobs**, each with its duration and "open job ↗".
- **[ Retry ]**, disabled while running, showing "Retrying…" and then a refresh.
- `error`/`hint`: a warning box showing the hint command in mono.
- Nothing selected: "Select a worktree in Git projects."

- [ ] **Step 1: Implement.** There's no pure logic beyond formatting. Put `ago(createdAt, now)` and
  `duration(sec)` in `src/mods/dock-pipelines/format.js`, with tests in `tests/pipelines-format.test.mjs`.
- [ ] **Step 2: Run the tests and deploy.** `npm test` passes, and `npm run deploy` passes `herdr-app check`.
- [ ] **Step 3: End-to-end live check, on Windows with this repo on GitHub.**
  - If `gh` isn't logged in, the panel shows the `gh auth login` hint; capture it. Ask the human to log in, or
    proceed with the fixture-based tests as the GitLab evidence.
  - `herdr-app do dock-core.git.show` (with the worktree of `D:/workspace/herdr-dock`) opens Pipelines: in the
    right panel if placed, otherwise as a dialog. Take a `herdr-app shot` of each case.
  - `herdr-app status` errors are `[]`.
- [ ] **Step 4: Commit.** `config/dock.json` base lines only:
  `git commit -m "feat(dock-pipelines): pipeline detail panel; README for Git projects"`
