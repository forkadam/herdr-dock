# Pipelines Jobs View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Pipelines panel lists every job of every build of the worktree's HEAD commit (branch, tag, MR), by
stage, with counts, and the running job's live elapsed time plus its current GitLab log line or GitHub step.

**Architecture:** Pure mapping in `src/shared/ci.js` (jobs, groups, log tail, cadence) → `ci-client.js` asks by
HEAD commit and branch and, in `full` mode, fetches all jobs, GitLab bridges and up to 2 log tails →
`collector.js` decides `full` from a heartbeat the panel writes while on screen → `dock-pipelines` draws groups →
stages → jobs, ticking once a second while a job runs.

**Tech Stack:** Plain ES modules, `node --test`, Herdr mod host (`gpui-kit`, `gpui-base`, `herdr`), host stubs in
`tests/fixtures/host-stubs*.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-26-pipelines-jobs-view-design.md`

## Global Constraints

- Shared code has no Node built-ins (bundled into Herdr mods); all I/O through the injected `io`.
- Views use only element methods declared in `gpui-kit.d.ts`; the host stub rejects others.
- `dock.git.detail` republishes only when its JSON changes; elapsed time is computed in the view, never stored.
- Log text and errors pass through the client's `redact` (no token may appear in shared state or logs).
- A trace (log) request never counts toward host backoff, timeouts included; timeout 8000 ms; `Range: bytes=-16384`.
- At most 2 log fetches per poll, most recently started running jobs first.
- Watched = heartbeat `dock.git.watching` `{ at }` under 15 s old (written every 5 s by the panel) and a worktree selected.
- Watched + running/pending pipeline polls every 10 000 ms; everything else keeps today's `ciInterval`.
- Count line order: failed, running, pending, manual, warn, passed, canceled, skipped; only non-zero buckets.
- After source changes, `npm run build:app` and commit `app/` with the source (tests compare them).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A commit with **no** runs yet (just pushed, CI not started) must still show the branch's latest pipeline, marked older than HEAD — not "No pipeline". (Task 4 test.)
2. The HEAD-commit query **failing** (404, 4xx, older GitLab) must not blank the panel: fall back to the branch result and log once. (Task 4 test.)
3. A **huge or ANSI/`\r`-laden log** gives a clean last line or `null`, never escape codes or a 16 KB string. (Task 2 test.)
4. A **passed pipeline with a manual deploy job** reads as passed: stage not stuck at pending, count line says `1 manual`. (Task 6 test.)
5. Closing the panel stops the extra polling within 15 s even if the view's loop keeps running. (Task 5 test; the loop-lifetime guess is checked live in Task 8.)

---

### Task 1: Jobs and groups from GitLab and GitHub (pure)

**Files:**
- Modify: `src/shared/ci.js`
- Modify: `tests/ci.test.mjs`
- Create: `tests/fixtures/gitlab-bridges.json`, `tests/fixtures/github-jobs-steps.json`

**Interfaces:**
- Produces:
  - `Job = { id, name, stage, group, status, label, allowFailure, duration, startedAt, webUrl, step, logLine, bridge }`
    (`status` normalized; `label` one of `"manual"|"scheduled"|"created"|"waiting"|"allowed to fail"|"child pipeline"|"→ <path>"|null`;
    `step` `{ index, total, name } | null`; `logLine` always `null` here; `bridge` boolean).
  - `Group = { key, name, ref, status, webUrl }` — GitLab: one per pipeline, `key = "gl:<id>"`, `name = "#<id>"`;
    GitHub: one per workflow run, `key = "gh:<runId>"`, `name = run.name`.
  - `gitlabJob(j, groupKey) -> Job`, `gitlabBridge(b, groupKey) -> Job`, `githubJob(j, run) -> Job`.
  - `gitlabCommitPipeline(entries: { pipeline, jobs: array|null, bridges: array|null }[]) -> Pipeline` — entries newest first.
  - `githubLatest(runsJson, jobsByRunId)` keeps its signature; its result gains `jobs` and `groups`.
  - `Pipeline` keeps every field it has today (`id, number, status, ref, sha, webUrl, createdAt, finishedAt, stages, failedJobs`)
    and gains `jobs: Job[]`, `groups: Group[]`, `jobsTruncated: boolean`.

- [ ] **Step 1: Write the failing tests** in `tests/ci.test.mjs`:
  - `gitlabJob maps status, label, duration, startedAt`: `{status:"manual"}` → `status "pending"`, `label "manual"`;
    `{status:"failed", allow_failure:true}` → `status "failed"`, `label "allowed to fail"`, `allowFailure true`;
    `{status:"running", started_at:"2026-11-26T12:00:00Z"}` → `startedAt` that string, `label null`.
  - `gitlabBridge uses the downstream pipeline`: `{ id:7, name:"child", stage:"deploy", status:"success", downstream_pipeline:{ status:"running", web_url:"D" , project_id: 42 }, pipeline:{ project_id: 42 } }`
    → `status "running"`, `webUrl "D"`, `label "child pipeline"`, `bridge true`; a different `project_id` with
    `downstream_pipeline.project_path` absent uses `label "→ downstream"`; with no `downstream_pipeline` the bridge's own status and `web_url`.
  - `gitlabCommitPipeline: two pipelines of one commit` (tag pipeline id 20 newest, branch pipeline id 10): `id 20`,
    `status` = worst of both, `groups.map(g=>g.ref)` `["v1.0", "main"]`, jobs of both with `group` `"gl:20"` / `"gl:10"`,
    jobs and bridges of one pipeline sorted together by id, `stages` still derived (from the newest pipeline only, as today).
  - `gitlabCommitPipeline: 100 jobs sets jobsTruncated`.
  - `githubLatest: jobs carry the run as group and the in-progress step` using `github-jobs-steps.json` (one run, a job
    with 12 steps, the 7th `in_progress`) → `step {index:7,total:12,name:<7th name>}`, `stage` = run name, `group "gh:<id>"`.
  - Existing `gitlabPipeline` / `githubLatest` tests stay green unchanged.

- [ ] **Step 2: Run** `node --test tests/ci.test.mjs` — Expected: the new tests FAIL (`gitlabJob is not a function` etc.).

- [ ] **Step 3: Implement** the functions above in `src/shared/ci.js`. `gitlabPipeline(p, jobs)` stays and is reused for
  the newest entry; `gitlabCommitPipeline` overrides `status` with the worst over entries and concatenates `failedJobs`.
  GitLab `waiting_for_resource`/`preparing` → label `"waiting"`; `created` → `"created"`; `scheduled` → `"scheduled"`.

- [ ] **Step 4: Run** `node --test tests/ci.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ci): every job of a commit's pipelines, GitLab bridges and GitHub steps, as one list`.

### Task 2: Log tail and the watched cadence (pure)

**Files:**
- Modify: `src/shared/ci.js`, `tests/ci.test.mjs`

**Interfaces:**
- Produces: `lastLogLine(text: string|null) -> string|null`; `ciInterval({ status, upstreamChangedAt, now, watched })`.

- [ ] **Step 1: Write the failing tests:**
  - `lastLogLine strips ANSI, section markers and \r redraws`: `"a\n\x1b[32;1mok\x1b[0m\nsection_end:1700000000:step\r\x1b[0K\n"` → `"ok"`;
    `"progress 10%\rprogress 55%\n"` → `"progress 55%"`; `"x\n\n   \n"` → `"x"`; `""`, `null`, `"\n\n"` → `null`.
  - `lastLogLine reads only the tail and caps at 200 chars`: `"head\n" + "y".repeat(20000)` → a string of length 200 of `y`; a log whose last
    16 384 chars hold no newline still returns its (capped) tail.
  - `ciInterval: watched running polls every 10 s`: `{status:"running", watched:true}` → `10000`; `{status:"pending", watched:true}` → `10000`;
    `{status:"running"}` → `30000`; `{status:"passed", watched:true, upstreamChangedAt:-Infinity, now:0}` → `300000`.

- [ ] **Step 2: Run** `node --test tests/ci.test.mjs` — Expected: new tests FAIL.

- [ ] **Step 3: Implement** both. `lastLogLine`: take `text.slice(-16384)`, strip `/\x1b\[[0-9;?]*[A-Za-z]/g` and
  `/section_(start|end):\d+:[^\r\n]*/g`, split on `\n`, map each line to the part after its last `\r`, trim, last non-empty, `slice(0, 200)`.

- [ ] **Step 4: Run** `node --test tests/ci.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ci): a log's last meaningful line; a watched running pipeline polls every 10 s`.

### Task 3: Text, header, timeout and no-backoff requests

**Files:**
- Modify: `src/shared/ci-client.js`
- Test: `tests/collector-ci.test.mjs` (client cases sit with the existing ones; build the client with `createCiClient(io, log)` directly)

**Interfaces:**
- Produces: `request(host, method, path, opts?: { text?: boolean, noBackoff?: boolean, timeout?: number, headers?: object })`
  → `{ ok: true, data }` (string when `text`) or `{ ok: false, error, hint?, hostFailure, status? }`. `timed(fn, ms = TIMEOUT)`.

- [ ] **Step 1: Write the failing tests:**
  - `request text mode returns the body as a string (fetch)`: route answers `{ status:200, ok:true, text: async () => "log\n" }` → `data "log\n"`; the fetch init carries `headers.Range === "bytes=-16384"` when passed.
  - `request text mode on the glab route`: after a TLS error switches to CLI, the exec args are `["api","--hostname","gitlab.corp","-H","Range: bytes=-16384", path]` and stdout comes back unparsed.
  - `noBackoff: a timeout does not block the host`: a trace request that never resolves, advance `io.t` 8001 ms and `client.sweep(io.t)` → `ok false, error "timeout"`; `client.blocked("gitlab.corp", io.t)` is `false`. The same without `noBackoff` and 15 001 ms blocks it (existing behaviour).
  - `noBackoff: HTTP 503 does not block the host`.

- [ ] **Step 2: Run** `node --test tests/collector-ci.test.mjs` — Expected: new tests FAIL.

- [ ] **Step 3: Implement.** `fail()` skips `backoff()` when `opts.noBackoff`; the CLI route adds `-H "<k>: <v>"` per header
  and returns raw stdout when `text`; a 416 answer is returned as `{ ok:false, status:416 }` so the caller can retry without Range.

- [ ] **Step 4: Run** `node --test tests/collector-ci.test.mjs` — Expected: PASS, including every existing case.

- [ ] **Step 5: Commit** `feat(ci-client): text, header, timeout and no-backoff requests`.

### Task 4: Ask by HEAD commit too; full mode fetches all jobs, bridges and log tails

**Files:**
- Modify: `src/shared/ci-client.js`, `tests/collector-ci.test.mjs`
- Create: `tests/fixtures/github-runs-tag.json` (CI run on `main` + Release run on `v0.4.0-alpha.0`, same `head_sha`, Release `in_progress`)

**Interfaces:**
- Consumes: Task 1 `gitlabCommitPipeline`, `githubLatest`; Task 2 `lastLogLine`; Task 3 `request(..., opts)`.
- Produces: `latest(host, provider, path, head: { branch, sha }, opts?: { full?: boolean })` → `{ ok, pipeline, runIds, canceledRunIds }`
  where in full GitLab mode each running `Job` (max 2) has `logLine`.

- [ ] **Step 1: Write the failing tests:**
  - `GitHub: a tag run of HEAD shows beside the branch run` (`github-runs-tag.json` answered for `actions/runs?head_sha=<HEAD>&per_page=20`; the branch query returns only the CI run)
    → pipeline `status "running"`, `groups.map(g=>[g.name,g.ref])` `[["Release","v0.4.0-alpha.0"],["CI","main"]]` (newest run first), `olderThanHead false`.
  - `GitHub: no run for HEAD yet → the branch's newest commit, older than HEAD` (head_sha query returns `{workflow_runs:[]}`) → detail `olderThanHead true`.
  - `GitLab: the HEAD-commit query failing falls back to the branch pipeline` (sha URL unrouted → 404) → pipeline from `PIPES`, one log line mentioning the sha query.
  - `GitLab: a tag pipeline of HEAD` (`pipelines?sha=<HEAD>&order_by=id&sort=desc&per_page=5` returns tag pipeline 20 and branch pipeline 10) → `id 20`, two groups.
  - `GitLab full: a passed pipeline still fetches its jobs and bridges`; not full: a passed pipeline fetches no jobs (today's rule).
  - `GitLab full: log lines for the 2 newest running jobs only` (3 running jobs; trace URL `projects/grp%2Fapi/jobs/<id>/trace` answers text) → the 2 most recent `startedAt` get `logLine`, the third `null`; the trace fetch carries `Range`.
  - `GitLab full: a 416 trace retries once without Range`; `a failed trace keeps the job's previous logLine`.
  - `GitHub full: jobs of every run of HEAD are fetched`; not full: only failed runs' (today).
  - Update case (a): `c.urlFor({ job: 1 })` is `.../jobs/902` (index into `pipeline.jobs`, sorted by id), `{ job: 0 }` is compile's URL.

- [ ] **Step 2: Run** `node --test tests/collector-ci.test.mjs` — Expected: new tests FAIL.

- [ ] **Step 3: Implement.** Start the branch query first, then the commit query (`Promise.all`, so `io.fetches[0]` stays the
  branch URL). Commit query used when it has results; on failure, log `CI: <host>/<path>: HEAD commit query: <error>` and use the branch
  result. GitLab: keep the newest pipeline per ref, at most 3 groups. Full GitLab: per kept pipeline `jobs?per_page=100` and
  `bridges?per_page=100`. The client keeps `lastLog: Map<jobId, string>` for the "keep previous" rule and drops ids no longer running. Once per host it logs `CI: <host> trace Range honoured` (206) or `… Range ignored` (200), for Task 8.
  Group titles show the bare ref (`Release · v0.4.0-alpha.0`), not "tag …": the API doesn't say which refs are tags *(call; deviates from the spec's example wording)*.

- [ ] **Step 4: Run** `node --test` — Expected: whole suite PASS.

- [ ] **Step 5: Commit** `fix(ci): a worktree's pipeline is every build of its HEAD commit, tags included; full mode lists all jobs with log tails`.

### Task 5: Collector — watched, full polls, cadence, job links

**Files:**
- Modify: `src/shared/collector.js`, `src/mods/_git-command.js` (comment only), `tests/collector-ci.test.mjs`

**Interfaces:**
- Consumes: Task 4 `latest(..., { full })`; Task 2 `ciInterval({..., watched})`.
- Produces: shared key `dock.git.watching` read as `{ at: number }`; `wt.ci.full` (last poll was full); `urlFor({ job: i })` → `pipeline.jobs[i].webUrl`.

- [ ] **Step 1: Write the failing tests:**
  - `watched: a fresh heartbeat makes the selected worktree's poll full` — set `dock.git.watching {at: io.t}`, select, tick → jobs URL fetched for a passed pipeline.
  - `watched: a heartbeat 15 s old is not watched` — `at: io.t - 15000` → no jobs call for a passed pipeline.
  - `watched: becoming watched polls at once when the last poll wasn't full` — tick (not watched), set heartbeat, advance 1 s, tick → a new poll ran.
  - `watched running pipeline re-polls after 10 s, unwatched after 30 s`.
  - `the selected worktree without a heartbeat polls like any other` (no jobs for passed, 30 s running).

- [ ] **Step 2: Run** `node --test tests/collector-ci.test.mjs` — Expected: new tests FAIL.

- [ ] **Step 3: Implement** `watched(id) = id === selected && now - (io.shared("dock.git.watching")?.at ?? -Infinity) < 15000`;
  `ciDue` returns true when `watched && !wt.ci.full`; pass `full` and `watched` through; `urlFor` reads `p.jobs`.

- [ ] **Step 4: Run** `node --test` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(collector): full pipeline polls only while the Pipelines panel is on screen`.

### Task 6: Display helpers (pure)

**Files:**
- Modify: `src/mods/dock-pipelines/format.js`, `tests/pipelines-format.test.mjs`

**Interfaces:**
- Consumes: Task 1 `Job`, `Group`.
- Produces:
  - `bucketOf(job) -> "failed"|"running"|"pending"|"manual"|"warn"|"passed"|"canceled"|"skipped"` (manual/scheduled label → `"manual"`; failed + allowFailure → `"warn"`; unknown → `"pending"`).
  - `countLine(jobs, truncated) -> string` e.g. `"12 jobs · 1 running · 4 pending · 7 passed"`, `"100+ jobs · …"`, `"1 job · 1 passed"`, `""` for none.
  - `stageSummary(jobs) -> { bucket, done, total }` (done = passed/failed/warn/canceled/skipped; total excludes manual; bucket = worst bucket, manual never worst over others).
  - `elapsed(startedAt, now) -> string` via `duration()`; `""` when missing.
  - `viewGroups(pipeline, branch) -> { key, title, webUrl, stages: { name, summary, jobs: { job, index }[] }[] }[]` —
    `title` is `name` plus ` · <ref>` when ref ≠ branch; a group whose only stage has the group's name keeps that stage with `name: null` (no stage header); `index` is the job's index in `pipeline.jobs`.

- [ ] **Step 1: Write the failing tests** for each with the spec's values: count order (`failed, running, pending, manual, warn, passed, canceled, skipped`);
  passed pipeline + manual deploy → stage summary `{ bucket:"manual", done:0, total:0 }` for the deploy stage and the count line `"… · 1 manual · …"`;
  allowed-to-fail failure → `warn`, stage bucket not `failed`; GitHub Release group titled `"Release · v0.4.0-alpha.0"` on branch `main`, CI group titled `"CI"`.

- [ ] **Step 2: Run** `node --test tests/pipelines-format.test.mjs` — Expected: FAIL.

- [ ] **Step 3: Implement** in `format.js` (no host imports).

- [ ] **Step 4: Run** `node --test tests/pipelines-format.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(pipelines): counts, stage summaries and groups for the job list`.

### Task 7: The panel

**Files:**
- Modify: `src/mods/dock-pipelines/main.js`
- Create: `tests/dock-pipelines-class.test.mjs` (pattern: `tests/dock-spaces-class.test.mjs`)
- Modify: `app/**` via `npm run build:app`

**Interfaces:**
- Consumes: Task 6 helpers; `dock.git.detail.pipeline.{jobs,groups,jobsTruncated}`; `rightShownOf`/`rightActiveOf` from `src/shared/panel.js`.
- Produces: writes `dock.git.watching { at: Date.now() }` every 5 s while shown; `gitCommand("git.open.job", { index })` with the `pipeline.jobs` index.

- [ ] **Step 1: Write the failing tests** (render against the host stub with a detail fixture built from Task 4's GitHub tag case):
  - `renders the count line and one row per job under its group/stage` — text of the tree contains `"3 jobs · 2 running · 1 passed"`, `"Release · v0.4.0-alpha.0"`, both `publish (…)` names, `"step 7/12 · Build and sign Tauri desktop bundle"`.
  - `a GitLab running job shows its log line in the second row`; `a job with no logLine or step draws no second row`.
  - `clicking a job's open link sends git.open.job with its pipeline.jobs index`.
  - `while a job runs the loop notifies each second; with none running it does not` (drive `cx.spawn` with a fake `cx.sleep`).
  - `heartbeat: written when shown in the dialog (props().overlay set), not written when the right panel shows another feature`.
  - `close() clears the heartbeat` (sets `dock.git.watching` to `null`).

- [ ] **Step 2: Run** `node --test tests/dock-pipelines-class.test.mjs` — Expected: FAIL.

- [ ] **Step 3: Implement.** Replace `stages()` and `failedJobs()` with `jobList()` drawing `viewGroups()`; keep header, warning,
  `pipelineLine`, `message`, `retryButton`. Running row: accent left bar (`border_l(2)` or a 2 px div), accent text, live
  `elapsed()`; second row mono, dim, truncated. One `cx.spawn` loop started in `init`: every 1 s `cx.notify()` if any job is running;
  every 5th tick write the heartbeat when `shown()`. Delete the `failedJobs` line in `_git-command.js`'s comment for `pipeline.jobs`.

- [ ] **Step 4: Run** `npm run build:app` then `node --test` — Expected: whole suite PASS (including the build-app comparison).

- [ ] **Step 5: Commit** `feat(pipelines): every job by stage, live elapsed time and the running job's line` (source + `app/`).

### Task 8: Check it in the real Herdr

**Files:** none unless a check fails (a failure goes back to the task that owns the code, with a failing test first).

- [ ] **Step 1:** `npm run deploy`; open the Pipelines panel on `auto-video-spliter` (`main`, tag `v0.4.0-alpha.0` on 72aae06). Expected: both CI and Release groups (re-run the Release workflow from GitHub if it has finished, to see a running job with its step ticking).
- [ ] **Step 2:** Close the Pipelines dialog; within 15 s, `~/.config/herdr-app/shared.json` `dock.git.watching.at` stops advancing. Record whether the view's loop outlived the dialog (the spec's unverified guess) in the commit or PR text.
- [ ] **Step 3:** Leave a note in the PR for the user's work GitLab: confirm a running job's log line appears, and whether the trace answered 206 (Range honoured) or 200 (whole log) — the dock logs `CI: <host> trace Range honoured|ignored` once per host (Task 4).
