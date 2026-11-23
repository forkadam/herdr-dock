# Jira page: key column and Today's load time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue keys never wrap in the Jira page's rows, and Today loads in a fraction of today's ~30 s on the real Jira.

**Architecture:** Same split as before: decisions are pure functions in `src/shared/jira/` with tests; `src/mods/dock-jira/` draws. Today stops reading the board's closed sprints until the sprint menu needs them, and the brief's "Changed" search fetches issue history only for issues whose `updated` changed since it last fetched them.

**Tech Stack:** Node 22 ESM, `node --test`, esbuild via `npm run build:app`.

**Spec:** `docs/superpowers/specs/2026-11-23-jira-views-design.md` (unchanged). The root causes below were measured on the real Jira on 2026-11-23 and bind this plan:

| Finding | Measured |
|---|---|
| Key column is a fixed `w(76)` in list rows (`main.js` `row()`) and brief rows (`brief-view.js:62`); real keys `CLDACC00-861` (12 chars) and `INTSI000-19211` (14) wrap onto two lines at 12 px | Screenshots |
| Today's first load: 14 sequential requests, **27.1 s** | Replay script |
| Board 546 has 186 sprints; reading them all (`state=active,future,closed`) = 4 pages, 13.7 s cold / ~6 s warm. `state=active,future` = 1 page, 1.5 s, 1 KB | H1 |
| "Changed: yours" (124 issues updated this sprint) with `expand=changelog` = 6.1 s, 1 MB; the same search with `fields=updated` only = 0.47 s, 29 KB | H2 |
| Running independent requests at once made the agile sprint call go from 1.5 s to 17 s | H3 — requests stay sequential |

## Global Constraints

- Pure logic in `src/shared/jira/*.js`, never importing `herdr`, `gpui-kit` or `gpui-base`; tests in `tests/jira-*.test.mjs` (`node:test`, `node:assert/strict`).
- After any change under `src/`, `npm run build:app` and commit `app/` in the same commit (drift test). `npm test` passes except the known `tests/dock-core-class.test.mjs` (Node 22.14).
- Requests stay sequential (H3). No new dependencies. No company specifics in code or tests.
- No deploy without the user's yes. Commits `fix(jira): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. An issue whose `updated` didn't change but is new to the window → its history is fetched (it isn't in the cache). (Task 3)
2. An issue that drops out of the window → it leaves the cache and the brief. (Task 3)
3. A history fetch that fails for one chunk → those issues keep their previous cached history (or stay unfetched) and are retried next refresh; the brief shows the problem. (Task 3)
4. Opening the sprint menu before the closed sprints have loaded → it shows the active/future ones and "Loading older sprints…", then fills in. (Task 2)
5. No active sprint on the board → the closed sprints are read right away, since "No active sprint" picks the last-ended sprint's series. (Task 2)

---

### Task 1: The key column fits the keys

**Files:**
- Modify: `src/shared/jira/page.js` (new export), `src/mods/dock-jira/main.js` (`row()`), `src/mods/dock-jira/brief-view.js:62`
- Test: `tests/jira-page.test.mjs`

**Interfaces:**
- Produces: `keyColumnWidth(keys: string[]) -> number` — `clamp(56, ceil(maxLen × 7.5) + 6, 132)` px, where `maxLen` is the longest key's length (0 for none).

- [ ] **Step 1: Write the failing test**

```js
test("keyColumnWidth: fits the longest key, within 56–132 px", () => {
  assert.equal(keyColumnWidth([]), 56);
  assert.equal(keyColumnWidth(["WEB-1"]), 56);
  assert.equal(keyColumnWidth(["WEB-1", "ABCDEFGH-861"]), 96);   // 12 chars
  assert.equal(keyColumnWidth(["ABCDEFGH-19211"]), 111);         // 14 chars
  assert.equal(keyColumnWidth(["A".repeat(30)]), 132);
  assert.equal(keyColumnWidth([null, undefined, "WEB-12"]), 56);
});
```

- [ ] **Step 2:** `node --test tests/jira-page.test.mjs` → FAIL (`keyColumnWidth` is not exported).
- [ ] **Step 3: Implement** `keyColumnWidth` in `page.js`. In `main.js` `row()`, the key cell's `w(76)` becomes `w(keyColumnWidth(<the shown tab's rows' keys>))` computed once per render (not per row), and the cell gets `.truncate()` so it never wraps. Same in `brief-view.js` over all the brief's item keys.
- [ ] **Step 4:** `npm test` → PASS (except the known baseline).
- [ ] **Step 5:** `npm run build:app && herdr-app check app/mods/dock-jira` → "check passed".
- [ ] **Step 6: Commit** `fix(jira): the key column fits the keys and never wraps` (src, tests, app/).

### Task 2: Today reads only the active and future sprints

**Files:**
- Modify: `src/shared/jira/sprint.js` (new export), `src/mods/dock-jira/main.js` (`readSprints`, the sprint menu's open handler), `src/mods/dock-jira/sprint-view.js` (`sprintMenu`)
- Test: `tests/jira-sprint.test.mjs`

**Interfaces:**
- Consumes: `client.sprints(boardId, states)`, `sprintSeries`, `pickSprint`, `menuSprint` (existing).
- Produces: `closedNeeded({ active: Sprint[], menuOpen: boolean, closedAt: number|null }) -> boolean` — true when the closed sprints haven't been read (`closedAt == null`) and either the menu is open or there is no active sprint.

- [ ] **Step 1: Write the failing test**

```js
test("closedNeeded: only for the sprint menu, or when no sprint is active", () => {
  const a = [{ id: 42, state: "active" }];
  assert.equal(closedNeeded({ active: a, menuOpen: false, closedAt: null }), false);
  assert.equal(closedNeeded({ active: a, menuOpen: true, closedAt: null }), true);
  assert.equal(closedNeeded({ active: [], menuOpen: false, closedAt: null }), true);
  assert.equal(closedNeeded({ active: [], menuOpen: true, closedAt: 123 }), false);
});
```

- [ ] **Step 2:** `node --test tests/jira-sprint.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** `readSprints` asks `sprints(board, ["active", "future"])` (one page for this board). The closed sprints are read with `sprints(board, ["closed"])` when `closedNeeded(...)` says so — on opening the sprint menu, or right after `readSprints` finds no active sprint — stored on `this.sprint` with `closedAt`, and dropped when the hourly cache or ⟳ re-reads the sprints (so they're read again on the next menu open). `sprintSeries`/`menuSprint` get active + future + whatever closed sprints are loaded. While they load, the menu shows its current list plus a dim "Loading older sprints…" line; a failure shows "Couldn't load older sprints" there (not a page problem).
- [ ] **Step 4:** `npm test` → PASS. **Step 5:** `npm run build:app && herdr-app check app/mods/dock-jira`.
- [ ] **Step 6: Commit** `fix(jira): Today reads only the active and future sprints; older ones load with the menu`.

### Task 3: History only for issues that changed

**Files:**
- Modify: `src/shared/jira/brief.js` (new exports), `src/mods/dock-jira/main.js` (`readBrief`, `clearView`)
- Test: `tests/jira-brief.test.mjs`

**Interfaces:**
- Consumes: `changedSearches({ since, parentKeys })` (existing JQLs), `ISSUE_KEY` (brief.js), `ROW_FIELDS`.
- Produces:
  - `historyPlan(found: [{ key, updated }], cache: Map<key, { updated, issue }>) -> { stale: string[], keep: string[] }` — `stale`: keys new to the cache or whose `updated` differs; `keep`: keys found whose cached `updated` matches. Keys not in `found` appear in neither (they leave the cache).
  - `keySearches(keys: string[]) -> string[]` — `key in (A,B,…)` JQLs of ≤ 50 well-formed keys each (`ISSUE_KEY`), duplicates dropped; `[]` for none.

- [ ] **Step 1: Write the failing tests**

```js
test("historyPlan: fetch only new or changed issues", () => {
  const cache = new Map([["WEB-1", { updated: "t1", issue: {} }], ["WEB-2", { updated: "t2", issue: {} }], ["WEB-9", { updated: "t9", issue: {} }]]);
  const p = historyPlan([{ key: "WEB-1", updated: "t1" }, { key: "WEB-2", updated: "t2b" }, { key: "WEB-3", updated: "t3" }], cache);
  assert.deepEqual(p, { stale: ["WEB-2", "WEB-3"], keep: ["WEB-1"] }); // WEB-9 left the window
  assert.deepEqual(historyPlan([], cache), { stale: [], keep: [] });
});
test("keySearches: chunks of 50 well-formed keys", () => {
  const keys = Array.from({ length: 120 }, (_, i) => `WEB-${i}`);
  const q = keySearches([...keys, "WEB-1", "bad key)"]);
  assert.equal(q.length, 3);
  assert.ok(q[0].startsWith("key in (WEB-0,WEB-1,"));
  assert.ok(q[2].startsWith("key in (WEB-100,"));
  assert.deepEqual(keySearches([]), []);
});
```

- [ ] **Step 2:** `node --test tests/jira-brief.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** `readBrief` runs each `changedSearches` JQL with `fields: ["updated"]` and no `expand` (pass 1), collects `{ key, updated }`, then `historyPlan` against `this.histories` (a `Map` on the view). It fetches `keySearches(stale)` with `fields: ROW_FIELDS`, `expand: "changelog"`, writes each fetched issue into the cache with its `updated`, deletes cache keys not found in pass 1, and builds Changed from the cached issues of every found key. A failed chunk leaves those keys' old entries (or none) and sets the brief's problem as today; they are stale again next refresh. `clearView()` (site change, Disconnect) empties `this.histories`. The sprint search keeps its own `expand=changelog` (25 issues, 1.5 s).
- [ ] **Step 4:** `npm test` → PASS. **Step 5:** `npm run build:app && herdr-app check app/mods/dock-jira`.
- [ ] **Step 6: Commit** `fix(jira): the brief fetches history only for issues that changed`.

### After the tasks: measure (controller, with the user's yes to deploy)

- [ ] Deploy (`node scripts/deploy.mjs --no-statusline`), open Today, and time the first load and a ⟳ refresh on the real Jira. Expected from the measurements: first load ≈ 15 s with the board drawn after ≈ 4–6 s (vs 27 s), refresh ≈ 3 s.
