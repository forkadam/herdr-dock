# Pipelines panel: every job, by stage, with the running job's live status

## Intent

The Pipelines panel (`src/mods/dock-pipelines/main.js`) says almost nothing today: for a passed or pending
pipeline it shows one line (`#4821 ✓ passed · 3m ago · a1b2c3d4`) and a greyed-out Retry. The cause is in the
fetch, not just the view: GitLab jobs are only requested when the pipeline is failed or running
(`ci-client.js` `gitlabLatest`), and GitHub jobs only for failed runs (`githubLatestOf`). The user's words:
"how many jobs in a workflow and what stage is it under for each of the jobs with some information, maybe show
a current status on the current job … today's view is trash."

A second gap, found on 2026-11-26 with the user's own repo: the panel missed a running tag build. In
`auto-video-spliter`, `main` and tag `v0.4.0-alpha.0` point at the same commit (72aae06). GitHub had a **Release**
run for the tag in progress (2 matrix jobs, on steps "Build and sign Tauri desktop bundle" and "Build and stage
co-versioned vsplit CLI binary"), but the dock asks for `actions/runs?branch=main`, and a tag push's run has
`head_branch = v0.4.0-alpha.0`, so only the finished **CI** run showed. GitLab has the same hole: a tag pipeline
has `ref = <tag>`, and the dock asks for `pipelines?ref=<branch>`. User: "it needs to show current running ci for
the current project, like now it has a ci with tag and not showing."

So the panel should read like the pipeline itself: a job count, every job listed under its stage with its status
and time, and the running job(s) standing out with a live elapsed time and a line saying what it is doing now.

## Goals

- A count line: `12 jobs · 1 running · 4 pending · 7 passed` (only non-zero buckets, in the order failed,
  running, pending, manual, passed, canceled, skipped — what needs attention first). *(Call: order.)*
- Every job of the selected worktree's pipeline, grouped under its stage in pipeline order, for every pipeline
  status (passed included).
- Per job: status glyph, name, duration (finished) or live elapsed time (running), and the raw provider status
  when it says more than the glyph (`manual`, `created`, `skipped`, `allowed to fail`).
- Per stage header: stage name, worst status glyph, `done/total` count (e.g. `● 1/3`).
- The running job row is highlighted (accent bar + accent text), its elapsed time ticks every second, and a
  second line under it shows what it is doing:
  - GitLab: the last meaningful line of the job's log (approach B, chosen by the user).
  - GitHub: the current step, `step 4/7 · Run tests` (GitHub's API reports steps; its job logs are not readable
    while a job runs, so the step is GitHub's "log line").
- Every job with a web URL keeps an "open job ↗" link; Retry stays at the bottom, unchanged.

## Non-goals

- Commit title / author, pipeline trigger source, total pipeline duration, recent-runs history. (Possible
  follow-ups; not asked for.)
- Showing more than one log line, or a scrolling log.
- Fetching full job lists for worktrees that aren't selected (approach C, rejected: several times the API calls
  for nothing on screen).
- Changing the Git projects list or its summary badge. (Alerts and Retry did change, as a consequence of reading
  every build of a commit: see "Alerts and Retry across a commit's builds" below.)

## Anti-goals

- The extra calls must not slow the git/CI loop for other worktrees or trip host backoff on a big log.
- A noisy log (progress bars, colour codes, GitLab section markers) must not show as garbage; better no line
  than a junk line.
- Log text must not leak a token: it passes through the client's `redact`.

## Approaches considered

| | What | Trade-off |
|---|---|---|
| **A. All jobs for the selected worktree** | Fetch the full job list on every poll of the selected worktree only, any status. | One extra call per poll of one worktree. |
| **B. A + running job's log line** | Also fetch the running GitLab job's log and keep its last meaningful line. | One more call per running job per poll; logs are noisy and can be large. |
| C. All jobs for every worktree | Same view; jobs fetched for all worktrees. | Many more calls for nothing visible. Rejected. |

**Picked: A + B** (user's choice). Recommended A; the user wanted the log line too.

## Design

### Data: `pipeline.jobs`

`gitlabPipeline` and `githubLatest` (`src/shared/ci.js`) gain a `jobs` array, in pipeline order:

```js
{ id, name, stage, status /* normalized: passed|failed|running|pending|canceled|skipped|unknown */,
  label /* provider word worth showing, or null: "manual", "created", "scheduled", "waiting", "allowed to fail" */,
  allowFailure, duration /* seconds | null */, startedAt /* ISO | null */, webUrl,
  step /* GitHub running job: { index, total, name } | null */,
  logLine /* GitLab running job: string | null, filled by the client */ }
```

- `failedJobs` stays (the alert body names its jobs).
- **Alerts and Retry across a commit's builds** (added after the final review): a commit can have several failed
  builds (a tag pipeline beside a branch pipeline, or two workflow runs). The Pipeline carries `failedKeys`, one
  `<pipeline or run id>|<its finish stamp>` per failed build, and an alert fires only for a key not yet in
  `dock.git.alerted` that is a new failure (or, with no previous poll, or one of the same commit that didn't list
  the build, created after the dock started; a failed build of a newly checked-out commit alerts once). GitLab
  Retry retries every failed or canceled pipeline of the commit, as GitHub reruns every failed run; a Retry error
  names the pipeline or run whose request failed and stays while the pipeline is still failed.
- Display status vs. normalized status *(call)*: `normalizeStatus` is unchanged (it feeds pipeline status,
  cadence and Retry). For display, `format.js` derives each job's bucket: GitLab `manual` and `scheduled` →
  **manual** (shown with its label, not counted as pending, and never holding a stage back); a failed job with
  `allow_failure` → **warn** (warn glyph, counted as passed-with-warning, and it does not turn its stage red).
  `done` in a stage's `done/total` = finished jobs (passed, failed, canceled, skipped, warn); `total` excludes
  manual jobs that never ran. A stage's glyph is the worst of its display buckets.
- GitLab: stage order = order of first appearance after the existing sort by job id. `per_page=100`; GitLab may
  return a pipeline's jobs newest first, so a pipeline with more than 100 jobs shows 100 of them (not necessarily
  the first 100) and the count line says `100+ jobs`.
- GitHub: a "stage" is a workflow run of the head sha (as today); jobs come from each run's `/jobs?per_page=100`, `step` from
  the job's `steps` (the first `in_progress` step; index is 1-based; total = steps.length).
- `stages` is still derived (name, worst status) and gains `done` and `total` counts.

### Which runs: everything built from the worktree's HEAD commit, branch and tags alike

- A worktree's pipeline is the set of runs **for its HEAD commit**, whatever ref triggered them (branch push,
  tag push, MR/PR, schedule). Each poll asks by commit as well as by branch:
  - GitHub: `actions/runs?head_sha=<HEAD>&per_page=20` and today's `?branch=<branch>&per_page=20`. If the commit
    query has runs, they are the pipeline (`githubLatest` already groups by head_sha). Otherwise the branch's
    newest commit is used, as today, and `olderThanHead` marks it.
  - GitLab: `pipelines?sha=<HEAD>&order_by=id&sort=desc&per_page=5` and today's `?ref=<branch>&per_page=1`. If
    the commit has pipelines, the newest is shown; any other pipelines of the same commit (e.g. the branch one
    beside the tag one) appear as extra "stages" groups headed by their ref. Otherwise the branch's newest, as
    today.
  - Detached HEAD: today's sha query only.
- Each run / pipeline group shows its **ref** next to its name when it isn't the worktree's branch:
  `Release · tag v0.4.0-alpha.0`.
- Overall status = worst of the commit's runs (as GitHub already does), so a running tag build makes the
  worktree's badge in Git projects show running, and the 30 s cadence follows it.
- Applies to every worktree's summary poll, not only the watched one: the badge must show the tag build too.
  Cost: one extra list call per poll per worktree. *(Call: correctness of the badge is worth it; the list calls
  are small.)*

### GitLab trigger (bridge) jobs

The user's work GitLab uses `trigger:` (child / multi-project pipelines). `/pipelines/:id/jobs` leaves those out,
so a `full` GitLab poll also calls `/pipelines/:id/bridges?per_page=100` and merges them into `jobs` by stage
(sorted with the jobs by id). A bridge row shows the downstream pipeline's status (`downstream_pipeline.status`,
falling back to the bridge's own), the label `child pipeline` or `→ <project path>`, and its "open ↗" goes to
`downstream_pipeline.web_url` (else the bridge's `web_url`). No log line for a bridge. Non-full polls skip the
bridges call (the summary status already comes from the parent pipeline).

### Fetching: only the selected worktree gets jobs every time

- `client.latest(host, provider, path, head, { full })`. The collector passes `full: wt.id === selected`.
  - GitLab `full`: always fetch `/pipelines/:id/jobs?per_page=100`, whatever the status. Not full: today's rule.
  - GitHub `full`: fetch `/runs/:id/jobs` for every run of the head sha. Not full: today's rule (failed runs).
- Log line, GitLab `full` only: for each running job, **up to 2** *(call: the HTTP limiter of 4 is shared by
  every host and worktree, so logs never take more than half of it)*, the most recently started first, and none
  for a job whose previous log fetch is still in flight. `GET
  projects/:id/jobs/:job_id/trace`. `request()` today JSON-parses every GET; it gains a text mode
  (`request(host, "GET", path, { text: true })`, both the fetch and the `glab api` route). The text goes through
  `lastLogLine()` (below) and `redact`. A failed or slow trace call leaves `logLine: null` (or keeps the last
  one) and is logged once. **A trace call never counts toward host backoff, timeouts included** *(call)*: it
  goes through `request(..., { text: true, noBackoff: true, timeout: 8000 })`, so a big log can't stop CI for
  the host. The request asks for the tail with `Range: bytes=-16384` (`glab api -H` on the CLI route).
  **Unverified guess:** that GitLab's trace endpoint honours Range; if it ignores it the whole log arrives and
  is tailed locally; if it answers 416, retry once without Range.
- **"Watched", not just selected** *(call)*: `dock.git.selected` stays set while the panel is closed, and by
  default the panel is a dialog that is usually closed. `full`, the log line and the faster cadence apply only
  while the panel is on screen. The view writes a heartbeat (`dock.git.watching`: `{ worktree, at }`) every 5 s
  from a `cx.spawn` loop while it is shown (right panel: the `shown()` test dock-browser uses with
  `dock.right.shown`/`dock.right.active`; dialog: while the view lives). The collector treats a heartbeat under
  15 s old for the selected worktree as watched. **Unverified guess:** that a view's `cx.spawn` loop ends when
  its dialog closes. The builder checks it in a real Herdr; if the loop outlives the dialog, the view also clears
  the heartbeat in `close()` and the 15 s expiry covers other ways of closing.
- Selecting a worktree already forces a poll when it was never polled (`select()`); it now also forces one when
  its last poll wasn't `full`, so the list fills in on selection rather than after the next interval.

### Cadence

`ciInterval` gains `selected`: a selected worktree whose pipeline is running or pending polls every **10 s**
(others stay at 30 s). This keeps the log line and statuses near-live for the one pipeline on screen.

### `lastLogLine(text)` (pure, in `ci.js`)

- Keep only the last ~16 KB of the text before work (big logs).
- Strip ANSI escapes and GitLab `section_start:…`/`section_end:…` markers.
- For each line, keep the text after the last `\r` (progress bars redraw with `\r`).
- Return the last line that is non-blank after trimming, cut to 200 characters; else `null`.

### View (`dock-pipelines/main.js`)

```
 repo · feat/x                                          ↗ GitLab
 #4821 ● running · 3m ago · a1b2c3d4
 12 jobs · 1 running · 4 pending · 7 passed

 build                                              ✓ 2/2
   ✓ compile                                        1m02s
   ✓ lint                                           0m40s
 test                                               ● 1/3
 ▌● e2e                                    1m34s running
 ▌  > 112/340 specs passed                     (log line)
   ○ integration                                  pending
 deploy                                             ○ 0/2
   ○ staging                                       manual
                                               [Retry]
```

- Stage header: name in foreground, `glyph done/total` right-aligned in the stage's tone.
- Job row: glyph (tone by status; `allowed to fail` failures in warn tone), name (truncated), then duration /
  live elapsed / label, then "open job ↗" on hover or always (builder's call, keep it compact).
- Running job: accent left bar, accent text; second line in mono, dim, one line truncated — `logLine` for GitLab,
  `step i/n · name` for GitHub. No second line when neither is known.
- Live elapsed: computed in render from `startedAt` and `Date.now()`; while any job is running the view
  re-renders once a second (a `cx.spawn` loop that stops when nothing is running or the view goes away).
- The pipeline line, warnings, notes, empty states and Retry are kept as today. The old failed-jobs list goes
  (the failed jobs are now rows in their stages).
- `git.open.job { index }` indexes `pipeline.jobs` instead of `failedJobs` (`collector.urlFor`,
  `_git-command.js` comment, `gitcmd.js` unchanged).
- Pure helpers (count line, stage counts, elapsed) live in `format.js` so `node --test` covers them.

## Constraints

- Shared code stays Node-built-in-free (bundled into Herdr mods); host I/O only via the injected `io`.
- The view only uses element methods declared in `gpui-kit.d.ts` (the test host stub rejects others).
- `dock.git.detail` republishes only when its JSON changes; elapsed time is computed in the view so a ticking
  clock never republishes it.
- Tests first for `ci.js` mappings, `lastLogLine`, the client's `full`/text paths, the cadence rule, and the
  view's rows (existing fixture style: `tests/fixtures/gitlab-pipeline.json`, `tests/pipelines-format.test.mjs`,
  `tests/ci.test.mjs`, `tests/collector-ci.test.mjs`).

## Left to the builder

- Exact spacing, colours within the theme's tones, and whether "open job ↗" shows on hover or always.
- Fixture JSON for GitLab jobs (all statuses), a GitLab trace sample, and GitHub jobs with steps.
