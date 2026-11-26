# Pipelines: stay inside the CI API budget

## Intent

The Pipelines jobs view (spec `2026-11-26-pipelines-jobs-view-design.md`, merged at a182bb9) polls hard while the
panel is open. Measured on the user's repo (auto-video-spliter, a commit with a Release run and a CI run):

| Case | Calls per poll | Cadence | Calls / hour |
|---|---|---|---|
| GitHub, panel open, 2 runs of the commit running | 2 run lists + 2 job lists = 4 | 10 s | ≈ 1,440 (29 % of the 5,000/h token budget, shared with `gh` and every other tool on that token) |
| GitLab, panel open, tag + branch pipelines | 2 lists + ≤3 × (jobs + bridges) + ≤2 traces ≤ 10 | 10 s | ≤ 3,600 |
| Any worktree with a running build, panel closed | 2 lists + jobs of failed/running | 30 s | ≈ 240+ each |

Two more gaps: jobs of finished builds are refetched every poll although they cannot change, and the dock never
reads the providers' rate-limit headers — a GitHub "limit exceeded" answer (403/429) is treated like any 4xx and the
dock keeps polling into it. The final reviewer recommended caching; the controller dropped it without telling the
user, who called it "a big deal". User picked approach A below.

Measured: GitHub answers a request carrying the previous `If-None-Match` ETag with `304 Not Modified`, and the 304 does
not count against the rate limit (used count unchanged: 35 → 35).

## Goals

- Finished builds' jobs are fetched once and reused until that build changes (GitLab bridges are revalidated by
  ETag on every full poll).
- Every GET on the fetch route sends the URL's last ETag; a 304 reuses the stored answer (free on GitHub).
- The dock reads each host's remaining budget from response headers and:
  - when the remaining budget is low, drops the watched 10 s cadence to the normal 30 s and skips log traces;
  - when the limit is hit, stops polling that host until the reset time (no requests at all), and the panel says
    so: `GitHub API limit reached — resumes at 15:46`.
- The panel shows the host's remaining budget as one dim line when known: `GitHub API: 4,321 of 5,000 left`.
- A once-per-host log line says whether headers were readable (`CI: <host> rate-limit headers seen` / `… not
  readable`), so the deploy check can confirm Herdr's fetch exposes them.

## Non-goals

- Changing what the panel lists or the cadence rules when the budget is healthy.
- ETags on the `glab api` / `gh api` CLI route (it gets the job cache and limit handling from error text only).
- Sharing a budget across PCs or tools beyond what the headers report.

## Anti-goals

- A cached answer must never show a build as older than it is: a running build's jobs are always revalidated (ETag),
  never served from the finished-build cache.
- Hitting the limit must not look like "no CI" or blank the panel: the last good data stays, with the limit line.
- No new host backoff from rate-limit handling itself (the limit pause is its own state, cleared at reset).

## Approaches considered

| | What | Trade-off |
|---|---|---|
| **A. Cache + ETag + budget guard** | Finished-build job cache; conditional GETs; read limit headers, slow down when low, pause at the limit. | Most code; GitHub panel-open cost drops to ≈ 1 paid call per running build's job change. |
| B. Cache + guard, no ETag | As A without conditional GETs. | Run lists still cost ≈ 720/h at 10 s. |
| C. Slower cadence | Raise 10 s. | Live step goes stale — against why the panel exists. |

**Picked: A** (user's choice, recommended).

## Design

### Response metadata from `request()`

`request()` (src/shared/ci-client.js) returns, on the fetch route, the response headers it needs, read with
`r.headers?.get?.(name)` so a fetch without readable headers degrades to "unknown":
`etag`, GitHub `x-ratelimit-remaining|limit|reset` (reset = epoch seconds), GitLab `ratelimit-remaining|limit|reset`
(epoch seconds), and `retry-after` (seconds). **Unverified guess:** Herdr's fetch exposes `headers.get` like the
standard one; the once-per-host log line settles it on deploy.

### Conditional GETs (fetch route only)

- The client keeps `etags: Map<url, { etag, data }>`, at most 300 entries (oldest dropped first).
- A GET sends `If-None-Match: <etag>` when it has one. A `304` returns `{ ok: true, data: <stored data>, status: 304,
  notModified: true }` and counts as success (clears backoff like any good answer).
- A 200 with an `etag` stores `{ etag, data }`; without one, the entry is removed.
- Text (trace) requests are excluded (Range answers vary).
- Stored data is the parsed JSON cut down to the fields the normalizers and the job cache read (`ci.js` keep*; a
  real GitHub run-list page is ~13 KB per run), deep-frozen; a 200 and the 304s after it return that same object. It
  never leaves the client except as the answer it was. *(Final review M3, M4.)*

### Finished-build job cache

- `jobsCache: Map<key, { stamp, jobs }>`, keys `gl|<host>|<path>|<pipelineId>` and
  `gh|<host>|<path>|<runId>`, at most 100 entries. Jobs only: GitLab bridges are never cached (a retried child
  pipeline may not move the parent's `updated_at`), so they are fetched on every full poll and revalidated by ETag.
- Stamp: GitLab pipeline `updated_at` + status; GitHub run `updated_at` + status + conclusion.
- A build whose normalized status is finished (passed, failed, canceled, skipped) and whose stamp matches its cache
  entry reuses the cached jobs with no request. A jobs answer is kept only when every job in it is settled too
  (passed, failed, canceled, skipped; not GitLab "canceling"), so a job still running in a finished build is asked
  again next poll. *(Final review M2.)* A running/pending build always fetches (with its ETag).
- A Retry (or any change) moves `updated_at`, so the stamp no longer matches and the jobs are fetched again.
- Applies to full and non-full polls and to both routes (fetch and CLI).

### Budget guard

Per host the client keeps `{ remaining, limit, resetAt, limited }` from the latest response that carried headers.

- **Low:** `remaining / limit < 0.10`. The collector's `ciInterval` treats the worktree as not watched for cadence
  (30 s instead of 10 s) and the client skips log traces. `ciInterval` gains an input `budgetLow`. While the budget
  is low, every GitLab poll (plain or full) also drops the repo's kept log lines, so a line from before the low
  stretch never reappears after it.
- **Limited:** a response 429, or 403 with `x-ratelimit-remaining: 0`, or a `retry-after`. The host is paused until
  `resetAt` (or now + `retry-after`, else now + 60 s). While paused, `request()` fails fast with
  `{ ok: false, error: "API limit reached", limitedUntil, hostFailure: false }` — no network call — and the
  collector keeps the last good pipeline, sets the detail's `limitedUntil`, and does not count it as a host
  failure (no backoff ladder). At `resetAt` the pause ends by itself.
- `client.budget(host)` → `{ remaining, limit, resetAt, limitedUntil, low } | null` for the collector to publish in
  `dock.git.detail.budget`. It is null (CLI route, or before any header was seen) except while the host is paused:
  then it is always an object, with `remaining`/`limit`/`resetAt` null when no headers were seen and `low` false.

### Panel

- Under the pipeline line, one dim line when `detail.budget` is known: `GitHub API: 4,321 of 5,000 left`
  (GitLab: `GitLab API: …`); thousands separated.
- When `detail.budget.limitedUntil` is in the future, a warn line instead:
  `GitHub API limit reached — resumes at HH:MM` (local time, rounded up to the next minute), and the job list stays
  as last fetched. The line shows also before the first pipeline and under an error. Retry is disabled meanwhile, with
  the tooltip `API limit reached — resumes at HH:MM`.
- The Git projects badge: the worktree summary in `dock.git.state` carries `limitedUntil`, and the badge tooltip adds
  `API limit reached — status from before, resumes at HH:MM` while it lasts. *(Final review I1, M5–M7.)*

### Logs

- Once per host: `CI: <host> rate-limit headers seen` or `CI: <host> rate-limit headers not readable`.
- On entering a limit pause: `CI: <host> API limit reached; paused until HH:MM:SS` (once per pause).
- On low budget: `CI: <host> API budget low (<remaining>/<limit>); slower polling` (once until it recovers).

## Constraints

- Same as the jobs view: no Node built-ins in shared code; host I/O via `io`; tests first; `npm run build:app` with
  each commit; element methods from `gpui-element-methods.json` only.
- Existing behaviour unchanged when no headers are readable (the guard never engages, ETags never sent).

## Verification

- Unit tests per rule above (ETag store, 304 path, cache hit/miss by stamp, low/limited states, panel lines).
- Real replay against the user's GitHub repo (read-only): count paid calls over N polls with `gh api rate_limit`
  before/after.
- Deploy check: the once-per-host header log line, and the panel's budget line.

## Decisions from the builder check *(all controller calls)*

1. **Panel during a limit pause:** a limit result does not set `ci.error`. The collector keeps the last good
   pipeline and its status (so the Git projects badge keeps showing it, not "unknown"), and publishes
   `detail.budget.limitedUntil`. A poll in which any request hits the limit is discarded whole: the previous
   pipeline stays as it was (no mix of fresh lists and stale jobs).
2. **Which answers pause:** a 429 (with or without headers), a 403 whose remaining is `0`, or a 403 carrying
   `retry-after`, pauses the host — and is not a host failure (no backoff ladder; the existing "429 backs off"
   behaviour is replaced and its tests updated). Pause length (revised after Task 2's review): when remaining is `0`
   (the hourly/primary budget is spent), until `resetAt`, else `retry-after`, else 60 s; otherwise (GitHub's short-term
   "secondary" limit, which answers 429 or 403 with `retry-after` while the hourly budget still has calls left) for
   `retry-after` seconds, else 60 s — never until the hourly reset. **From memory, unverified:** GitHub's secondary-limit
   answers carry `retry-after`. A 403 whose headers decide nothing (calls left, no `retry-after`) but whose body
   text (fetch route: the received body, e.g. the JSON `message`) matches `/rate limit/i` also pauses, for 60 s; a
   403 without such text stays an ordinary 403 *(final review I2; from memory, unverified: GitHub secondary limits can
   answer 403 without `retry-after`)*. A header read that throws counts as no header (unknown), never as a network
   error that would move the host to the CLI *(final review M1)*. A 5xx with `retry-after` stays an ordinary 5xx host failure (not shown as "limit
   reached"). Budget headers on a 401 answer are ignored (they describe an unauthenticated budget).
3. **CLI route (`gh api` / `glab api`):** stderr/stdout matching `/rate limit|too many requests|\bHTTP 429\b/i` pauses
   the host for 60 s (no reset time there). **Unverified guess:** the exact gh/glab wording; the pattern is broad on
   purpose. The CLI route has no headers, so `budget()` is null there except during a pause (then only `limitedUntil` is set), the budget line is hidden and "low" never
   fires.
4. **Cache inputs:** `latest()` already has each GitLab pipeline's `updated_at`/`status` (list endpoint) and each
   GitHub run's `updated_at`/`status`/`conclusion` when it decides to fetch jobs. A finished build without a cache
   hit fetches normally (with its ETag). Cached jobs feed `failedJobs`, `failedKeys` and alerts unchanged.
5. **Scope:** the budget is per host. `budgetLow` applies to every worktree on that host. `client.blocked(host, now)`
   also returns true while the host is limit-paused, so `ciDue` skips it — no instant-failure polls every tick.
6. **Clock:** `resetAt` (epoch seconds × 1000) is compared with `io.now()`; a computed pause of 0 or less becomes 30 s
   (protects against clock skew).
7. **Low budget changes only the watched 10 s cadence** (to 30 s) and skips traces; the 15 s "recent push" and other
   intervals are unchanged.

## Left to the builder

- Exact LRU mechanics; where in `request()` the metadata is attached; wording of comments.
