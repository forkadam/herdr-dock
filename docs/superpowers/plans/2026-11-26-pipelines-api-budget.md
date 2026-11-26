# Pipelines API Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dock stays inside each CI host's API budget: finished builds' jobs are cached, GETs are conditional
(ETag → free 304 on GitHub), and the dock slows down when the budget is low and pauses cleanly at the limit, with
the budget shown in the Pipelines panel.

**Architecture:** Pure rules in a new `src/shared/ci-budget.js` (header parsing, pause decision, low test, LRU, CLI
limit text) → `ci-client.js` uses them in `request()` (ETag store, budget state, pause) and in `gitlabLatest` /
`githubLatestOf` (finished-build job cache, traces skipped when low) → `collector.js` keeps the last pipeline on a
limit result, feeds `budgetLow` to `ciInterval` and publishes `detail.budget` → the panel draws one budget line or
the limit warning.

**Tech Stack:** Plain ES modules, `node --test`, Herdr mod host, host stubs in `tests/fixtures/host-stubs*.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-26-pipelines-api-budget-design.md`

## Global Constraints

- Shared code has no Node built-ins; all I/O through the injected `io`.
- Response headers are read only as `r.headers?.get?.(name)`; when unreadable, nothing in this plan engages (no ETag sent, no budget, no pause from headers) and behaviour equals today's.
- ETag store: at most 300 entries; job cache: at most 100 entries; oldest dropped first.
- Low budget: `remaining / limit < 0.10`. Limit pause: until `resetAt`, else `retry-after` seconds, else 60 s; a computed pause ≤ 0 becomes 30 s.
- A pause is triggered by HTTP 429 (any headers), or 403 with `x-ratelimit-remaining: 0`; never by a 5xx. CLI route: text matching `/rate limit|too many requests|\b429\b/i` → 60 s pause.
- A limit pause is not a host failure (no backoff ladder); `client.blocked(host, now)` is true while paused.
- Panel copy: `GitHub API: 4,321 of 5,000 left` / `GitLab API: …`; `GitHub API limit reached — resumes at HH:MM` (local time).
- Logs, once per host (or per pause / per low episode): `CI: <host> rate-limit headers seen` | `CI: <host> rate-limit headers not readable`; `CI: <host> API limit reached; paused until HH:MM:SS`; `CI: <host> API budget low (<remaining>/<limit>); slower polling`.
- After source changes, `npm run build:app` and commit `app/` with the source. Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A running build is never served from the finished-build cache, even when its stamp looks unchanged. (Task 3 test.)
2. A host whose fetch exposes no headers behaves exactly as before — no `If-None-Match`, no pause, no budget line. (Task 2 test.)
3. A limit hit partway through a poll leaves the previous pipeline, status and alerts untouched. (Task 4 test.)
4. After the pause ends, polling resumes by itself without a refresh press. (Task 4 test.)
5. A 304 refreshes nothing it shouldn't: the stored answer comes back as data and clears backoff like a 200. (Task 2 test.)

---

### Task 1: Pure budget rules

**Files:**
- Create: `src/shared/ci-budget.js`, `tests/ci-budget.test.mjs`
- Modify: `src/shared/ci.js` (`ciInterval`), `tests/ci.test.mjs`

**Interfaces:**
- Produces:
  - `readLimit(get: (name) => string|null|undefined, provider: "github"|"gitlab") -> { remaining, limit, resetAt } | null` (resetAt in ms; null when the remaining/limit pair is missing or not numeric).
  - `pauseFor({ status, remaining, resetAt, retryAfter, now }) -> number | 0` — ms to pause (0 = not a limit answer). 429 → pause; 403 with remaining === 0 → pause; else 0. Length: resetAt − now, else retryAfter × 1000, else 60000; ≤ 0 → 30000.
  - `isLow(b) -> boolean` — `b && b.limit > 0 && b.remaining / b.limit < 0.10`.
  - `cliLimited(text) -> boolean` — the CLI regex.
  - `lru(max) -> { get(k), set(k, v), delete(k), size }` — insertion order refreshed on set and get; oldest dropped past max.
  - `ciInterval({ status, upstreamChangedAt, now, watched, budgetLow })` — `budgetLow` turns the watched 10 s into 30 s; nothing else changes.

- [ ] **Step 1: Write the failing tests** in `tests/ci-budget.test.mjs`: GitHub headers `x-ratelimit-remaining "4321"`, `x-ratelimit-limit "5000"`, `x-ratelimit-reset "1795707975"` → `{ remaining: 4321, limit: 5000, resetAt: 1795707975000 }`; GitLab `ratelimit-remaining/limit/reset` the same; missing or `"abc"` → null. `pauseFor`: 429 no headers → 60000; 429 retryAfter 12 → 12000; 403 remaining 0 resetAt now+90 s → 90000; 403 remaining 5 → 0; 503 retryAfter 30 → 0; resetAt in the past → 30000. `isLow`: 499/5000 → true, 500/5000 → false, null → false. `cliLimited`: "HTTP 403: API rate limit exceeded for user" → true, "429 Too Many Requests" → true, "HTTP 404: Not Found" → false. `lru(2)`: set a, b, get a, set c → b dropped. In `tests/ci.test.mjs`: `ciInterval({status:"running", watched:true, budgetLow:true})` → 30000; `({status:"running", watched:true})` → 10000; `({status:"passed", upstreamChangedAt: now-1000, now, budgetLow:true})` → 15000.
- [ ] **Step 2: Run** `node --test tests/ci-budget.test.mjs tests/ci.test.mjs` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the functions above.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ci): budget rules: rate-limit headers, pause length, low budget, LRU`.

### Task 2: `request()`: headers, ETags, budget state, limit pause

**Files:**
- Modify: `src/shared/ci-client.js`, `tests/collector-ci.test.mjs` (client cases)

**Interfaces:**
- Consumes: Task 1 `readLimit`, `pauseFor`, `cliLimited`, `lru`, `isLow`.
- Produces:
  - `request()` results gain `notModified?: true` (on 304) and, on a limit answer or while paused, `{ ok: false, error: "API limit reached", limited: true, limitedUntil, hostFailure: false }`.
  - `client.budget(host) -> { remaining, limit, resetAt, limitedUntil, low } | null` (null on the CLI route or before any header was seen).
  - `client.blocked(host, now)` is also true while `now < limitedUntil`.

- [ ] **Step 1: Write the failing tests** (build the client with `createCiClient(io, log)`; give `res()` a `headers.get` for these cases):
  - `ETag: a 200 with etag stores it; the next GET sends If-None-Match; a 304 returns the stored data with notModified` (and `ok: true`).
  - `ETag: a 304 clears backoff like a 200`.
  - `ETag: text (trace) requests never send If-None-Match`.
  - `no readable headers: no If-None-Match ever, budget null, a 429 still pauses 60 s` (res without `headers`).
  - `budget: remaining/limit/reset from the latest answer; low when under 10 %`.
  - `limit: 403 with x-ratelimit-remaining 0 pauses until reset; requests during the pause make no fetch and return limited; blocked() true; after reset a request goes out`.
  - `limit: 429 pauses and is not a host failure (no backoff ladder)` — replace the existing "429 backs off" expectation.
  - `limit: a 503 with retry-after is an ordinary host failure`.
  - `CLI route: stderr "HTTP 403: API rate limit exceeded" pauses 60 s; budget stays null`.
  - `logs: headers seen / not readable once per host; limit reached once per pause; budget low once per episode`.
- [ ] **Step 2: Run** `node --test tests/collector-ci.test.mjs` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `request()`/`viaCli()`; ETag store keyed by full URL with the parsed JSON; a 304 goes through `good()`; the pause lives on the host record next to `blockedUntil`.
- [ ] **Step 4: Run** `npm run build:app` then `node --test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ci-client): conditional GETs, the host's remaining budget, and a clean pause at the limit`.

### Task 3: Finished-build job cache; no traces on a low budget

**Files:**
- Modify: `src/shared/ci-client.js` (`gitlabLatest`, `githubLatestOf`, `logLines`), `tests/collector-ci.test.mjs`

**Interfaces:**
- Consumes: Task 1 `lru`, `isLow`; Task 2 `budget()`.
- Produces: `latest()` results unchanged in shape; when any request of the poll returned `limited`, `latest()` returns `{ ok: false, limited: true, limitedUntil, error: "API limit reached", hostFailure: false }`.

- [ ] **Step 1: Write the failing tests:**
  - `GitLab: a finished pipeline's jobs and bridges are fetched once while its updated_at and status stay` (two full polls → one jobs call, one bridges call; the second poll's pipeline has the same jobs).
  - `GitLab: a changed updated_at refetches`.
  - `GitHub: a completed run's jobs are fetched once; a run still in_progress is fetched every poll` (Review Focus 1: same updated_at on the running run → still fetched).
  - `cached jobs still drive failedJobs and failedKeys` (a failed finished pipeline from cache → same failedKeys as the first poll).
  - `low budget: no trace calls` (budget 100/5000 → running job, no trace URL fetched).
  - `a limit hit on the jobs call makes latest() return limited` (lists 200, jobs 429).
- [ ] **Step 2: Run** `node --test tests/collector-ci.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement.** Cache key and stamp per the spec ("Finished-build job cache"); finished = normalized passed/failed/canceled/skipped.
- [ ] **Step 4: Run** `npm run build:app` then `node --test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ci-client): finished builds' jobs are fetched once; no log tails on a low budget`.

### Task 4: Collector: limit results, low-budget cadence, `detail.budget`

**Files:**
- Modify: `src/shared/collector.js`, `tests/collector-ci.test.mjs`

**Interfaces:**
- Consumes: Task 2 `budget()`, `blocked()`; Task 3 limited `latest()` result; Task 1 `ciInterval({ budgetLow })`.
- Produces: `dock.git.detail.budget = { provider, remaining, limit, limitedUntil } | null`.

- [ ] **Step 1: Write the failing tests:**
  - `limit: a limited poll keeps the previous pipeline, its status and summary (not "unknown"), sets no ci.error, raises no alert` (Review Focus 3).
  - `limit: while paused no worktree on that host polls; after limitedUntil polling resumes by itself` (Review Focus 4).
  - `budget low: a watched running pipeline re-polls after 30 s, not 10 s`.
  - `detail.budget carries provider, remaining, limit and limitedUntil; null when the client has none`.
- [ ] **Step 2: Run** `node --test tests/collector-ci.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** in `pollCi` (a `got.limited` branch before the error branch: keep `ci.pipeline`, set `ci.at`, no `ci.error`), `ciDue` (pass `budgetLow: isLow(client.budget(host))`), `publishDetail` (`budget`).
- [ ] **Step 4: Run** `npm run build:app` then `node --test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(collector): keep the last pipeline through an API limit; slower polling on a low budget`.

### Task 5: Panel: budget line and limit warning

**Files:**
- Modify: `src/mods/dock-pipelines/format.js`, `src/mods/dock-pipelines/main.js`, `tests/pipelines-format.test.mjs`, `tests/dock-pipelines-class.test.mjs`

**Interfaces:**
- Consumes: `detail.budget` (Task 4).
- Produces: `budgetLine(budget, now) -> { tone: "dim"|"warn", text } | null` in format.js.

- [ ] **Step 1: Write the failing tests:** `budgetLine({provider:"github", remaining:4321, limit:5000}, now)` → `{ tone:"dim", text:"GitHub API: 4,321 of 5,000 left" }`; GitLab label `GitLab API`; `limitedUntil` in the future → `{ tone:"warn", text:"GitHub API limit reached — resumes at HH:MM" }` (local time, two-digit); limitedUntil past → the dim line; null budget → null. Panel test: the line is drawn under the pipeline line; with a limit, the warn line shows and the job list is still drawn.
- [ ] **Step 2: Run** `node --test tests/pipelines-format.test.mjs tests/dock-pipelines-class.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run build:app` then `node --test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pipelines): the panel shows the API budget and when a limit pause ends`.

### Task 6: Measure and check live

**Files:** none unless a check fails (back to the owning task, failing test first).

- [ ] **Step 1:** Read-only replay against the user's GitHub repo with the branch's client: 6 full polls 10 s apart of a commit with finished runs; record `gh api rate_limit` `used` before and after. Expected: far fewer paid calls than 6 × (2 + runs).
- [ ] **Step 2:** With the user's OK, `npm run deploy`; confirm the once-per-host log `CI: github.com rate-limit headers seen` (or "not readable") and the panel's budget line (`herdr-app shot` if the user agrees, else ask them to look).
