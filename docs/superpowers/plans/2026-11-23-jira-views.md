# Jira page: tabs, daily brief, sprint board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Jira page tabs (Today · user views · Mine · All), a Today tab with a daily brief and the team's
sprint board, a board that no longer sprawls, and Start/Finish messages chosen per flow.

**Architecture:** Every decision is a pure, tested function in `src/shared/jira/` (no host imports); the mod
`src/mods/dock-jira/` draws and keeps state, split into small render files beside `main.js`. Jira Software's agile
REST (`/rest/agile/1.0`) supplies the board's columns and sprints; issue history (`expand=changelog`) supplies
description edits and sprint/assignee changes. The mock Jira grows the same endpoints so everything is tested
without the company network.

**Tech Stack:** Node 22 ESM, `node --test`, esbuild bundling (existing `scripts/build.mjs`), Herdr's gpui-kit /
gpui-base / herdr host modules.

**Spec:** `docs/superpowers/specs/2026-11-23-jira-views-design.md`

## Global Constraints

- Node 22 or newer; no new dependencies.
- Pure logic lives in `src/shared/jira/*.js` and never imports `herdr`, `gpui-kit` or `gpui-base`; it is tested in
  `tests/jira-*.test.mjs` with `node:test` and `node:assert/strict`.
- After any change under `src/`, run `npm run build:app` and commit `app/` in the same commit (`tests/build-app.test.mjs`
  "drift" fails otherwise). `npm test` passes before every commit.
- **No company specifics in code, defaults, fixtures or tests:** no `INTSI000`, `TEM61510`, board 546, `qnap`, skill
  names. Tests use generic names (`WEB`, `SEC`, `Sprint 42`, `Otter Sprint 7`, `/triage {key}`).
- New settings keys (`board`, `highPriorities`, `briefBugs`, `views`, `actions`, `checkTask`) are optional;
  `formatSettings` never writes their defaults; unknown keys stay kept (existing `parseSettings` behaviour).
- No issue description text ever goes into a message the page sends to Claude.
- Per-PC state: `dock.jira.tab`, `dock.jira.layout.<tabId>` (falls back to the old `dock.jira.view`),
  `dock.jira.read`, plus the existing `dock.jira.filter`.
- JQL dates are relative (`updated >= -<n>m`), never absolute: Jira reads absolute dates in the user's time zone.
- Today's refresh is: one "changed" search for your issues, one per 50 parent keys, the sprint search and the bugs
  search (4 for the user today); board config, statuses and sprints are cached for an hour; hidden tabs' counts
  refresh every `HIDDEN_EVERY_MS` (10 min).
- Deploying (`npm run deploy`) replaces the user's installed app-mode copy with this clone: **ask the user first.**
- Commit messages: `feat(jira): …` / `fix(jira): …` / `docs(jira): …`, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A remembered tab whose view was deleted from settings → the first tab (Today), never a blank page. (Task 3)
2. One view's JQL rejected by Jira (400) → only that tab shows the problem and a "!" count; other tabs keep theirs. (Task 3, Task 4)
3. More than 50 parent keys → the parents search splits into `key in (…)` chunks of ≤ 50. (Task 11)
4. A description going from empty to text, or text to empty → the diff shows all added / all removed, no crash. (Task 10)
5. A current sprint whose name has no number, or a board with no active sprint → the sprint menu falls back to
   sprints holding your issues; Today says "No active sprint" instead of an empty board. (Task 7, Task 8)

---

## Part 1 — The board stops sprawling, and tabs

### Task 1: Empty workflow columns only on one-project boards

**Files:**
- Modify: `src/shared/jira/page.js` (after `unionStatuses`)
- Modify: `src/mods/dock-jira/main.js` (`boardStatuses`, `loadProjectStatuses`)
- Test: `tests/jira-page.test.mjs`

**Interfaces:**
- Produces: `workflowStatuses(rows, statusesByProject: Map<string, Array|"loading">) -> [{ name, category }]`

- [ ] **Step 1: Write the failing test**

```js
test("workflowStatuses: a project's whole workflow only when every row is from that project", () => {
  const m = new Map([["WEB", [{ name: "To Do", category: "new" }, { name: "QA", category: "indeterminate" }]], ["OPS", "loading"]]);
  assert.deepEqual(workflowStatuses([{ key: "WEB-1" }, { key: "WEB-2" }], m).map((s) => s.name), ["To Do", "QA"]);
  assert.deepEqual(workflowStatuses([{ key: "WEB-1" }, { key: "OPS-3" }], m), []);
  assert.deepEqual(workflowStatuses([{ key: "OPS-3" }], m), []); // still loading
  assert.deepEqual(workflowStatuses([], m), []);
});
```

- [ ] **Step 2:** `node --test tests/jira-page.test.mjs` → FAIL (`workflowStatuses` is not exported).
- [ ] **Step 3: Implement `workflowStatuses` in `page.js`** with `boardProjects` + `unionStatuses`; in `main.js`,
  `boardStatuses()` returns `workflowStatuses(this.rows, this.projectStatuses)` and `loadProjectStatuses` asks only
  when `boardProjects(this.rows).length === 1` (no requests for mixed boards). Dragging still adds reachable statuses
  through `dragColumns` (unchanged).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `npm run build:app && herdr-app check app/mods/dock-jira` → "check passed".
- [ ] **Step 6: Commit** `fix(jira): empty workflow columns only when the board is one project` (src, tests, app/).

### Task 2: Settings options — views, actions, board, priorities

**Files:**
- Modify: `src/shared/jira/settings.js`
- Test: `tests/jira-settings.test.mjs`

**Interfaces:**
- Produces (all from `settings.js`):
  - `DEFAULT_HIGH_PRIORITIES = ["Highest", "High"]`
  - `DEFAULT_BRIEF_BUGS = "issuetype = Bug AND assignee = currentUser() AND resolution = Unresolved"`
  - `DEFAULT_CHECK_TASK = "The description of {key} ({summary}) changed {when}. Read the change with your Jira tools and check it against my work on {mine} in this repo."`
  - `jiraOptions(settings) -> { board: number|null, highPriorities: string[], briefBugs: string, views: View[], actions: Rule[], checkTask: string, warnings: string[] }`
  - `View = { id: string, name: string, jql: string, group: "type"|null }` — id matches `/^[a-z][a-z0-9-]{0,23}$/`, never `"today"`.
  - `Rule = { project?: string, type?: string, subtask?: boolean, parentType?: string[], start?: string, finish?: string }` — at least one of `start`/`finish`.

- [ ] **Step 1: Write the failing tests**

```js
test("jiraOptions: defaults when nothing is set", () => {
  const o = jiraOptions(parseSettings("").settings);
  assert.deepEqual(o, { board: null, highPriorities: ["Highest", "High"], briefBugs: DEFAULT_BRIEF_BUGS, views: [], actions: [], checkTask: DEFAULT_CHECK_TASK, warnings: [] });
});

test("jiraOptions: views, actions, board and priorities, bad entries skipped with a warning each", () => {
  const o = jiraOptions({ board: "12", highPriorities: ["P0", "P1"], views: [
    { id: "sec", name: "Security", jql: "project = SEC", group: "type" },
    { id: "today", name: "Mine", jql: "x" },
    { id: "bugs", name: "Bugs" },
    { id: "sec", name: "Again", jql: "y" },
  ], actions: [{ project: "SEC", start: "/triage {key}" }, { subtask: true, parentType: "Story", finish: "/close {key}" }, { project: "X" }] });
  assert.equal(o.board, 12);
  assert.deepEqual(o.highPriorities, ["P0", "P1"]);
  assert.deepEqual(o.views, [{ id: "sec", name: "Security", jql: "project = SEC", group: "type" }]);
  assert.deepEqual(o.actions[1], { subtask: true, parentType: ["Story"], finish: "/close {key}" });
  assert.equal(o.actions.length, 2);
  assert.deepEqual(o.warnings, [
    'views[1]: "today" is the Today tab\'s id',
    "views[2]: needs a name and a jql",
    'views[3]: the id "sec" is already used',
    "actions[2]: needs a start or a finish",
  ]);
});

test("formatSettings never writes option defaults", () => {
  const text = formatSettings(parseSettings('{"baseUrl":"https://j"}').settings);
  for (const k of ["views", "actions", "board", "highPriorities", "briefBugs", "checkTask"]) assert.ok(!text.includes(`"${k}"`), k);
});
```

- [ ] **Step 2:** `node --test tests/jira-settings.test.mjs` → FAIL.
- [ ] **Step 3: Implement `jiraOptions`** in `settings.js`. `board`: a positive integer (number or digits) else
  `null` with `board: not a board id` when present. `highPriorities`: a non-empty array of non-empty strings, else
  the default. `briefBugs` / `checkTask`: non-empty strings, else defaults. Unknown `group` → `null` with
  `views[i]: group "<g>" is not "type"`. `parentType` string → `[string]`. Leave `DEFAULT_SETTINGS`,
  `parseSettings` and `formatSettings` unchanged.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(jira): settings options for tabs, actions, board and priorities` (no `app/` change:
  nothing in the mod imports it yet; run `npm test` to confirm the drift test still passes).

### Task 3: The tab model

**Files:**
- Create: `src/shared/jira/views.js`
- Test: `tests/jira-views.test.mjs`

**Interfaces:**
- Consumes: `BUILTIN_FILTERS` (`jql.js`), `groupByCategory` (`model.js`), `View` (Task 2).
- Produces:
  - `ALL_JQL = "assignee = currentUser() ORDER BY updated DESC"`
  - `Tab = { id, name, kind: "today"|"search", jql: string|null, group: "type"|null, filters: boolean }`
  - `tabList(views: View[], { today: boolean }) -> Tab[]` — order: Today (when `today`), the views (except ids `mine`/`all`), Mine, All. A view with id `mine` or `all` replaces that built-in's name/jql/group in place. Mine's jql is `BUILTIN_FILTERS[0].jql`; All has `filters: true`.
  - `pickTab(tabs, id) -> Tab` — the remembered one, else `tabs[0]`.
  - `stepTab(tabs, id, dir: 1|-1) -> string` — the next/previous id, wrapping.
  - `sectionsFor(rows, group) -> [{ title: string|null, parts: ReturnType<groupByCategory> }]` — `null` group: one section with `title: null`; `"type"`: one per issue type in first-appearance order.
  - `tabCountText({ total?, problem?, loading? }) -> string` — `""` unknown, `"!"` on a problem, the number, `"99+"` past 99.

- [ ] **Step 1: Write the failing tests** (Review Focus 1 and 2)

```js
const views = [{ id: "sec", name: "Security", jql: "project = SEC", group: "type" }, { id: "all", name: "Everything", jql: "assignee = currentUser()", group: null }];

test("tabList: Today, views, Mine, All; a view can replace a built-in", () => {
  const tabs = tabList(views, { today: true });
  assert.deepEqual(tabs.map((t) => t.id), ["today", "sec", "mine", "all"]);
  assert.equal(tabs[3].name, "Everything");
  assert.equal(tabs[3].filters, true);
  assert.deepEqual(tabList([], { today: false }).map((t) => t.id), ["mine", "all"]);
});

test("pickTab: a removed tab falls back to the first", () => {
  const tabs = tabList(views, { today: true });
  assert.equal(pickTab(tabs, "sec").id, "sec");
  assert.equal(pickTab(tabs, "gone").id, "today");
  assert.equal(pickTab(tabs, undefined).id, "today");
});

test("stepTab wraps", () => {
  const tabs = tabList(views, { today: true });
  assert.equal(stepTab(tabs, "all", 1), "today");
  assert.equal(stepTab(tabs, "today", -1), "all");
});

test("sectionsFor: by issue type, then status category", () => {
  const rows = [{ key: "SEC-1", type: "Task", category: "new" }, { key: "SEC-2", type: "Bug", category: "indeterminate" }, { key: "SEC-3", type: "Task", category: "done" }];
  const s = sectionsFor(rows, "type");
  assert.deepEqual(s.map((x) => x.title), ["Task", "Bug"]);
  assert.deepEqual(s[0].parts.map((p) => p.category), ["new", "done"]);
  assert.equal(sectionsFor(rows, null)[0].title, null);
});

test("tabCountText", () => {
  assert.equal(tabCountText({}), "");
  assert.equal(tabCountText({ total: 9 }), "9");
  assert.equal(tabCountText({ total: 157 }), "99+");
  assert.equal(tabCountText({ total: 9, problem: { kind: "jql" } }), "!");
});
```

- [ ] **Step 2:** `node --test tests/jira-views.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement `views.js`** with the signatures above.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(jira): the tab model`.

### Task 4: Tabs on the page

**Files:**
- Create: `src/mods/dock-jira/tabs.js` — `tabBar(page, t) -> element` (the row under the header: one tab per `Tab`, name + `tabCountText`, the shown one raised).
- Modify: `src/mods/dock-jira/main.js`
- Modify: `README.md` (Jira page section)

**Interfaces:**
- Consumes: `jiraOptions` (Task 2); `tabList`, `pickTab`, `stepTab`, `sectionsFor`, `tabCountText`, `ALL_JQL` (Task 3).
- Produces (on the `Jira` view, used by Tasks 8, 12, 14): `this.options` (`jiraOptions` result, refreshed on every
  `load()`), `this.tab()` (the shown `Tab`), `this.state(id)` → that tab's
  `{ rows, total, query, selected, fetchedAt, listProblem, loading, seq }` (a `Map` in memory, created on first use),
  `this.counts: Map<id, { total?, problem?, loading? }>`, `this.showTab(id, cx)`.

- [ ] **Step 1: Move the list state into per-tab state.** `rows`, `total`, `query`, `selected`, `fetchedAt`,
  `listProblem`, `listLoading`, `seq` become fields of `this.state(this.tab().id)`; `refresh` searches the shown
  tab's jql (All: the picked filter's jql from the existing menu, whose list gains a first item "All my issues" =
  `ALL_JQL`) and stores the result in that tab's state and in `this.counts`. The search box text is per tab.
- [ ] **Step 2: Remembered tab and layout.** `TAB_KEY = "dock.jira.tab"`; layout per tab in
  `dock.jira.layout.<id>`, reading the old `dock.jira.view` when the per-tab key is unset. The filter menu shows only
  on a tab with `filters: true`. Today isn't listed yet (`tabList(views, { today: false })`; Task 8 turns it on).
- [ ] **Step 3: Counts for hidden tabs.** Every `HIDDEN_EVERY_MS`, one `search(jql, { maxResults: 0 })` per tab not
  shown; a failed one stores `{ problem }` for that tab only (Review Focus 2); the shown tab's count comes from its
  own search. A problem kind in `PAGE_PROBLEMS` still takes the whole page, as today.
- [ ] **Step 4: Commands.** `tab-next`, `tab-prev`, `tab-<id>` in `command()`; `list`/`board` write the shown tab's
  layout key. A `views` group of `"type"` renders `sectionsFor(rows, "type")` in `listView`.
- [ ] **Step 5: Settings warnings and reload.** The settings form lists `this.options.warnings` (one line each) and
  the file's path, under the existing fields. Each `tick` re-reads the settings file's text (`readTextFile`, cheap);
  when it differs from `this.jira.settingsText`, `load()` again and rebuild the tabs (`views` edited by hand show up
  within 30 s, without a restart).
- [ ] **Step 6: README.** Jira page section: tabs, built-ins, `views` with a generic example, per-tab layout, keys.
- [ ] **Step 7:** `npm test && npm run build:app && herdr-app check app/mods/dock-jira` → all pass, "check passed".
- [ ] **Step 8: Try it (ask the user before deploying).** With the user's yes: `npm run deploy`, open the Jira page,
  `herdr-app shot` it: tabs Mine and All, plus any `views` the user added; switching keeps each tab's place.
- [ ] **Step 9: Commit** `feat(jira): tabs — views from settings, Mine and All` (src, README, app/).

---

## Part 2 — The sprint board

### Task 5: Check the real board, then a mock agile API

**Files:**
- Create: `tests/fixtures/jira/agile.json`
- Modify: `tests/fixtures/jira/issues.json` (a story `WEB-40` with sub-tasks `WEB-41`, `WEB-42`; `rank` and `sprints` on issues)
- Modify: `scripts/mock-jira.mjs`
- Test: `tests/mock-jira.test.mjs`

**Interfaces:**
- Produces (mock routes, Jira's shapes):
  - `GET /rest/agile/1.0/board?type=scrum&name=<part>` → `{ startAt, maxResults, isLast: true, values: [{ id, name, type }] }`
  - `GET /rest/agile/1.0/board/{id}/configuration` → `{ id, name, columnConfig: { columns: [{ name, statuses: [{ id }] }] } }`
  - `GET /rest/agile/1.0/board/{id}/sprint?state=<csv>&startAt&maxResults` → `{ startAt, maxResults, isLast, values: [{ id, name, state, startDate, endDate, completeDate?, originBoardId }] }`
  - JQL: `sprint = <id>`, `sprint in openSprints()`, `ORDER BY Rank`; `fields=parent` returns `parent: { key, fields: { summary, status, issuetype } }` and `issuetype.subtask: true` on sub-tasks.
  - Fixture: board 1 "WEB board"; columns To Do (`10000`), In Progress (`3`, `10001`), Done (the done ids); sprints: `Sprint 41` closed, `Sprint 42` active, `Sprint 43` future, `Otter Sprint 7` active (holds none of the mock user's issues); dates shifted like issues.

- [ ] **Step 0: Check first, against the real Jira** (the spec's "Check first"). Run on the user's Mac:

```bash
curl -sS -K ~/.config/herdr-app/herdr-dock/secrets/jira-work.curlrc "$(node -e 'console.log(require(process.env.HOME+"/.config/herdr-app/herdr-dock/jira-work.json").baseUrl)')/rest/agile/1.0/board/546/configuration" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.columnConfig.columns.map(c=>c.name+":"+c.statuses.length).join(" | "))})'
```

  Expected: `To Do:… | RD In Progress:… | Test:… | Done:…`. A 401/403/404 or HTML → stop and tell the user; Part 2 needs it.
- [ ] **Step 1: Write the failing mock tests** (in `tests/mock-jira.test.mjs`, with its `call` / `search` / `keys` helpers)

```js
const agile = (path) => call(`/rest/agile/1.0${path}`);
test("agile: boards, configuration, sprints", async () => {
  assert.deepEqual((await agile("/board?type=scrum&name=WEB")).data.values.map((b) => b.name), ["WEB board"]);
  const cols = (await agile("/board/1/configuration")).data.columnConfig.columns;
  assert.deepEqual(cols.map((c) => c.name), ["To Do", "In Progress", "Done"]);
  assert.deepEqual(cols[1].statuses.map((s) => s.id), ["3", "10001"]);
  assert.deepEqual((await agile("/board/1/sprint?state=active")).data.values.map((s) => s.name), ["Sprint 42", "Otter Sprint 7"]);
  assert.deepEqual((await agile("/board/1/sprint?state=closed")).data.values.map((s) => s.name), ["Sprint 41"]);
});
test("search: sprint clauses, rank order, parent field", async () => {
  const r = await search("sprint = 42 AND assignee = currentUser() ORDER BY Rank", "&fields=parent,issuetype");
  assert.ok(keys(r).includes("WEB-41"));
  const sub = r.data.issues.find((i) => i.key === "WEB-41");
  assert.equal(sub.fields.parent.key, "WEB-40");
  assert.equal(sub.fields.issuetype.subtask, true);
  assert.equal((await search("sprint = 7 AND assignee = currentUser()")).data.total, 0);
  assert.ok((await search("sprint in openSprints() AND assignee = currentUser()")).data.total >= r.data.total);
});
```

- [ ] **Step 2:** `node --test tests/mock-jira.test.mjs` → FAIL.
- [ ] **Step 3: Implement** the routes and JQL clauses in `mock-jira.mjs` (fixture `sprints: [ids]` and `rank` are
  mock-internal; `pick` never returns them).
- [ ] **Step 4:** `npm test` → PASS. The new fixture issues assigned to the mock user change existing totals (e.g.
  "assigned to me and unresolved" `total: 10`); update those numbers in `tests/mock-jira.test.mjs`,
  `tests/jira-client.test.mjs` and `README.md` ("30 issues") to the new fixture, and nothing else in them.
- [ ] **Step 5: Commit** `feat(jira): mock Jira boards, sprints and sub-tasks`.

### Task 6: Client calls and row fields for boards and parents

**Files:**
- Modify: `src/shared/jira/client.js`, `src/shared/jira/jql.js`, `src/shared/jira/model.js`
- Test: `tests/jira-client.test.mjs`, `tests/jira-model.test.mjs`

**Interfaces:**
- Produces:
  - `searchUrl(base, jql, { startAt, maxResults, fields, expand })` — `expand` added to the query only when given.
  - `ROW_FIELDS` gains `"parent"`.
  - client: `boards(name?) -> { ok, data: [{ id, name, type }] }` (scrum only); `boardConfiguration(id) -> { ok, data: { columns: [{ name, statusIds: string[] }] } }`; `sprints(boardId, states: string[]) -> { ok, data: Sprint[] }` following `isLast` pages of 50; `issueHistory(key) -> { ok, data: { description, histories } }` (`GET /issue/{key}?fields=description&expand=changelog`).
  - `Sprint = { id: number, name, state, startMs: number|null, endMs: number|null }`.
  - `issueRow` adds `project` (key prefix), `subtask: boolean`, `parent: { key, summary, status, type } | null`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/jira-client.test.mjs, inside the `for (const transport …)` loop, with its client(transport):
test(`${transport}: boards, configuration, sprints`, { skip }, async () => {
  const c = client(transport);
  assert.deepEqual((await c.boards("WEB")).data.map((b) => b.id), [1]);
  assert.deepEqual((await c.boardConfiguration(1)).data.columns[1], { name: "In Progress", statusIds: ["3", "10001"] });
  const s = (await c.sprints(1, ["active"])).data;
  assert.deepEqual(s.map((x) => x.name), ["Sprint 42", "Otter Sprint 7"]);
  assert.ok(Number.isFinite(s[0].startMs) && typeof s[0].id === "number");
});
// tests/jira-model.test.mjs (or jira-client for searchUrl):
test("searchUrl: expand only when given", () => {
  assert.ok(searchUrl("https://j", "a = 1", { expand: "changelog" }).includes("expand=changelog"));
  assert.ok(!searchUrl("https://j", "a = 1").includes("expand"));
});
test("issueRow: project, subtask, parent", () => {
  const row = issueRow({ key: "WEB-41", fields: { issuetype: { name: "Sub-task", subtask: true },
    parent: { key: "WEB-40", fields: { summary: "Story", status: { name: "Spec design" }, issuetype: { name: "Story" } } } } }, "https://j");
  assert.equal(row.project, "WEB");
  assert.equal(row.subtask, true);
  assert.deepEqual(row.parent, { key: "WEB-40", summary: "Story", status: "Spec design", type: "Story" });
  assert.equal(issueRow({ key: "WEB-1", fields: {} }, "https://j").parent, null);
});
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement** with the agile base `${root}/rest/agile/1.0`; map dates with `Date.parse`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `npm run build:app` (row fields change the bundle) **and commit** `feat(jira): client calls for boards, sprints and history`.

### Task 7: The sprint model

**Files:**
- Create: `src/shared/jira/sprint.js`
- Test: `tests/jira-sprint.test.mjs`

**Interfaces:**
- Consumes: `Sprint` (Task 6), `issueRow` rows with `parent` (Task 6), transitions as `page.js` uses them.
- Produces:
  - `sprintColumns(columns: [{ name, statusIds }], statuses: [{ id, name }]) -> [{ name, statuses: string[] }]` (unknown ids skipped, empty columns kept).
  - `pickSprint(active: Sprint[], mineBySprint: Map<number, number>) -> Sprint|null` — most of yours, tie → earliest `startMs`; all zero → earliest start; none → `null`.
  - `seriesKey(name) -> string|null` — the name with its last number replaced by `#`; `null` without a number.
  - `sprintSeries(current, sprints, mineBySprint) -> Sprint[]` — same `seriesKey`: the next future one, the active one, the last 5 closed, newest first; with `seriesKey(current.name) === null`: every sprint with mine > 0, newest first.
  - `sprintRows(rows) -> [{ parent: { key, summary, status } | null, rows }]` — lanes by parent in first-appearance order; a row that is another row's parent becomes that lane's header, not a card; `parent: null` lane ("Other issues") last.
  - `columnDrop(transitions, column, current) -> { kind: "run", transition } | { kind: "choose", transitions } | { kind: "none" }` — moves whose `to.name` is in `column.statuses` and isn't `current`.
  - `sprintLabel(sprint, now) -> string` — `"Sprint 42 · Nov 16 – Nov 27 · 5 days left"`; `"· ends today"`; `"· ended"`.

- [ ] **Step 1: Write the failing tests** (Review Focus 5)

```js
const S = (id, name, state, start, end) => ({ id, name, state, startMs: start, endMs: end });
const s41 = S(41, "Sprint 41", "closed", 1, 2), s42 = S(42, "Sprint 42", "active", 3, 9), s43 = S(43, "Sprint 43", "future", null, null), otter = S(7, "Otter Sprint 7", "active", 2, 8);

test("pickSprint: the active sprint holding most of yours", () => {
  assert.equal(pickSprint([otter, s42], new Map([[42, 17], [7, 0]])).id, 42);
  assert.equal(pickSprint([s42, otter], new Map()).id, 7); // all zero: earliest start
  assert.equal(pickSprint([], new Map()), null);
});

test("sprintSeries: one series, newest first; no number falls back to sprints with yours", () => {
  assert.deepEqual(sprintSeries(s42, [s41, s42, s43, otter], new Map()).map((s) => s.id), [43, 42, 41]);
  const plan = S(5, "Planning", "active", 2, 9); // starts before Sprint 42, so 42 is newer
  assert.deepEqual(sprintSeries(plan, [plan, s42, otter], new Map([[5, 2], [42, 1]])).map((s) => s.id), [42, 5]);
  assert.equal(seriesKey("Lapras Sprint 19"), "Lapras Sprint #");
  assert.equal(seriesKey("Planning"), null);
});

test("sprintColumns: names from ids", () => {
  const cols = sprintColumns([{ name: "To Do", statusIds: ["1"] }, { name: "RD In Progress", statusIds: ["3", "4", "99"] }, { name: "Empty", statusIds: [] }],
    [{ id: "1", name: "To Do" }, { id: "3", name: "In Progress" }, { id: "4", name: "Handling" }]);
  assert.deepEqual(cols, [{ name: "To Do", statuses: ["To Do"] }, { name: "RD In Progress", statuses: ["In Progress", "Handling"] }, { name: "Empty", statuses: [] }]);
});

test("sprintRows: lanes by parent; a parent in the sprint heads its lane; Other issues last", () => {
  const p = { key: "WEB-40", summary: "Story", status: "Spec design" };
  const lanes = sprintRows([{ key: "WEB-9", parent: null }, { key: "WEB-41", parent: p }, { key: "WEB-40", parent: null }, { key: "WEB-42", parent: p }]);
  assert.deepEqual(lanes.map((l) => [l.parent?.key ?? null, l.rows.map((r) => r.key)]), [["WEB-40", ["WEB-41", "WEB-42"]], [null, ["WEB-9"]]]);
});

test("columnDrop: a column of several statuses", () => {
  const tr = (id, to) => ({ id, to: { name: to } });
  const col = { name: "RD In Progress", statuses: ["In Progress", "Handling"] };
  assert.deepEqual(columnDrop([tr("1", "In Progress"), tr("2", "Done")], col, "To Do"), { kind: "run", transition: tr("1", "In Progress") });
  assert.equal(columnDrop([tr("1", "In Progress"), tr("5", "Handling")], col, "To Do").kind, "choose");
  assert.equal(columnDrop([tr("2", "Done")], col, "To Do").kind, "none");
});
```

- [ ] **Step 2:** `node --test tests/jira-sprint.test.mjs` → FAIL.
- [ ] **Step 3: Implement `sprint.js`.** `sprintLabel` formats dates with `toLocaleDateString("en-US", { month: "short", day: "numeric" })` and counts calendar days to `endMs`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(jira): the sprint model`.

### Task 8: Today with the sprint board

**Files:**
- Create: `src/mods/dock-jira/sprint-view.js` — `sprintBoard(page, t) -> element`, `sprintMenu(page, t) -> element`
- Modify: `src/mods/dock-jira/main.js` (Today data and drag), settings form (Scrum board, High priorities)
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 4, 6, 7.
- Produces (on the view, used by Task 12): `this.sprint` (`{ board, columns, active: Sprint[], all: Sprint[], current: Sprint|null, shown: Sprint|null, rows, problem, at }`), `this.refreshToday(cx)`.

- [ ] **Step 1: Today appears when a board is set:** `tabList(views, { today: this.options.board != null })`.
- [ ] **Step 2: Sprint data.** Cached hourly (and on ⟳): `boardConfiguration`, `statuses()`, `sprints(board, ["active","future","closed"])`, and one `search("sprint = <id> AND assignee = currentUser()", { maxResults: 0 })` per active sprint for `mineBySprint`. Every refresh: `search("sprint = <shown.id> AND assignee = currentUser() ORDER BY Rank", { maxResults: refreshSize(...) })`. No active sprint → "No active sprint on <board name>" with the sprint menu (Review Focus 5).
- [ ] **Step 3: Draw** `sprintLabel`, the sprint menu (`sprintSeries`; picking one shows it, not remembered), lanes from `sprintRows` with collapsible headers (key, status, summary), cards in `sprintColumns` order sharing the width, vertical scroll only.
- [ ] **Step 4: Drag** reuses the existing press/drag/drop code with `columnDrop` over the column's statuses: run, the existing choose box, or the existing refused text.
- [ ] **Step 5: Settings form:** a **Scrum board** field that searches `boards(name)` as you type and stores the picked `board` id; **High priorities** (comma-separated) stored as `highPriorities`. Both through `saveSettings`.
- [ ] **Step 6: README:** Today tab, Scrum board setting, the sprint menu.
- [ ] **Step 7:** `npm test && npm run build:app && herdr-app check app/mods/dock-jira` → pass.
- [ ] **Step 8: Try it (ask first).** With the user's yes: deploy, set the board, `herdr-app shot` Today: 4 columns
  To Do · RD In Progress · Test · Done, one lane per parent story, the current sprint's label.
- [ ] **Step 9: Commit** `feat(jira): Today shows the sprint board`.

---

## Part 3 — The daily brief

### Task 9: Mock history

**Files:**
- Modify: `tests/fixtures/jira/issues.json`, `tests/fixtures/jira/workflow.json`, `scripts/mock-jira.mjs`
- Test: `tests/mock-jira.test.mjs`

**Interfaces:**
- Produces: `expand=changelog` on `GET /search` and `GET /issue/{key}` adds
  `changelog: { startAt: 0, maxResults: n, total: n, histories: [{ id, author: { name, displayName }, created, items: [{ field, fieldtype, from, fromString, to, toString }] }] }`.
  Fixture histories (times relative to `now`, shifted like other dates): on `WEB-40` (parent of the mock user's
  sub-tasks) three `description` edits during Sprint 42, oldest first: by user `ana`, by the mock user, by `ana`; on a Sprint 42 issue a
  `Sprint` item `from: "" → to: "42"` after Sprint 42's start; on another `from: "41" → to: "41, 42"` (carry-over);
  on a third an `assignee` item to the mock user after the start; one issue created into Sprint 42 after its start.
  A workflow status `Resolved` in category `indeterminate`, with one unresolved `Bug` in it. Priorities `P0`–`P3` on
  the new issues (ids 1–4); existing issues keep theirs.

- [ ] **Step 1: Write the failing mock tests**

```js
test("history: expand=changelog on search and issue, in Jira's shape", async () => {
  const r = await search("key = WEB-40", "&fields=summary&expand=changelog");
  const h = r.data.issues[0].changelog.histories;
  const desc = h.flatMap((x) => x.items.map((i) => ({ ...i, by: x.author.name }))).filter((i) => i.field === "description");
  assert.deepEqual(desc.map((d) => d.by), ["ana", "me", "ana"]); // oldest first, as in the fixture
  assert.ok(desc.every((d) => "fromString" in d && "toString" in d));
  assert.equal((await search("key = WEB-40", "&fields=summary")).data.issues[0].changelog, undefined);
  assert.ok((await call("/rest/api/2/issue/WEB-40?fields=description&expand=changelog")).data.changelog.histories.length >= 3);
  const resolved = await search('status = Resolved AND resolution = Unresolved AND issuetype = Bug');
  assert.equal(resolved.data.total, 1);
});
```
- [ ] **Step 2:** `node --test tests/mock-jira.test.mjs` → FAIL.
- [ ] **Step 3: Implement**; update any existing test that counts the workflow's statuses.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(jira): mock issue history`.

### Task 10: A line diff

**Files:**
- Create: `src/shared/jira/diff.js`
- Test: `tests/jira-diff.test.mjs`

**Interfaces:**
- Produces: `lineDiff(before: string|null, after: string|null) -> [{ op: "same"|"add"|"del", text }]`;
  `diffStats(ops) -> { added, removed }`.

- [ ] **Step 1: Write the failing tests** (Review Focus 4)

```js
test("lineDiff: changes in the middle", () => {
  assert.deepEqual(lineDiff("a\nb\nc", "a\nx\nc"), [{ op: "same", text: "a" }, { op: "del", text: "b" }, { op: "add", text: "x" }, { op: "same", text: "c" }]);
});
test("lineDiff: from nothing, to nothing", () => {
  assert.deepEqual(lineDiff(null, "a\nb"), [{ op: "add", text: "a" }, { op: "add", text: "b" }]);
  assert.deepEqual(lineDiff("a", ""), [{ op: "del", text: "a" }]);
  assert.deepEqual(lineDiff("", ""), []);
});
test("lineDiff: a 3000-line text stays fast", () => {
  const a = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
  const t = performance.now();
  assert.deepEqual(diffStats(lineDiff(a, a.replace("line 1500", "changed"))), { added: 1, removed: 1 });
  assert.ok(performance.now() - t < 500);
});
```

- [ ] **Step 2:** `node --test tests/jira-diff.test.mjs` → FAIL.
- [ ] **Step 3: Implement**: trim the common prefix and suffix first, then an LCS over the middle lines; when the
  middle is larger than 2000 × 2000, give the middle as all `del` then all `add`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(jira): a line diff for description changes`.

### Task 11: The brief model

**Files:**
- Create: `src/shared/jira/brief.js`
- Test: `tests/jira-brief.test.mjs`

**Interfaces:**
- Consumes: `Sprint` (Task 6), options (Task 2), `wikiToText` (`model.js`), `lineDiff` (Task 10).
- Produces:
  - `sinceMinutes(sprint: Sprint|null, now) -> number` — minutes since `sprint.startMs`, else 14 days.
  - `changedSearches({ since: number, parentKeys: string[] }) -> string[]` — `assignee = currentUser() AND resolution = Unresolved AND updated >= -<since>m`, then `key in (…) AND updated >= -<since>m` per ≤ 50 keys.
  - `bugsSearch({ briefBugs, highPriorities }) -> string` — `<briefBugs, its ORDER BY moved to the end> AND priority in ("P0", "P1") ORDER BY …`, names quoted.
  - `descriptionEdits(issue, { me }) -> [{ at, author, from, to }]` — `description` items not by `me`, oldest first.
  - `changedItem(issue, { me, sinceMs, marks }) -> { key, summary, edits, before, after, at } | null` — edits after `max(sinceMs, marks[key]?.changed ?? 0)`; `before` = the first of those edits' `fromString`, `after` = the last one's `toString`; `null` without such edits.
  - `newInSprintItem(issue, { sprint, me }) -> { key, summary, why: "added"|"created"|"assigned", at, sprintId } | null` — a `Sprint` item after `sprint.startMs` whose `to` ids (comma list, compared as strings) include `sprint.id` and whose `from` is empty → `added` (non-empty `from` = carry-over → not new); `issue.fields.created` after the start → `created`; an `assignee` item whose `to` is `me` after the start → `assigned`. `withRead(marks, "sprint", item)` stores `item.sprintId`.
  - `Marks = { [key]: { changed?: number, sprint?: number, bug?: true } }`; `isUnread(kind: "changed"|"sprint"|"bug", item, marks) -> boolean`; `withRead(marks, kind, item) -> Marks` (new object); `pruneBugs(marks, bugKeys: string[]) -> Marks` (drops `bug` from keys not listed).
  - `briefBadge({ changed, sprint, bugs }, marks) -> { count, tone: "warn"|"info" } | null`.
  - `checkMessage(template, { key, summary, edits, mine: string[] }) -> string` — `{when}` = `"Nov 19 15:46–15:54"` on one day, `"Nov 12 – Nov 19"` across days; `{mine}` = keys joined by `", "`.

- [ ] **Step 1: Write the failing tests** (Review Focus 3), using the Task 9 fixture's shapes built inline:

```js
const me = "me";
const edit = (author, created, from, to) => ({ author: { name: author }, created, items: [{ field: "description", fromString: from, toString: to }] });
const issue = { key: "WEB-40", fields: { summary: "Story" }, changelog: { histories: [
  edit("ana", "2026-11-12T10:00:00.000+0000", "v1", "v2"),
  edit(me, "2026-11-13T10:00:00.000+0000", "v2", "v3"),
  edit("ana", "2026-11-19T15:46:00.000+0000", "v3", "v4"),
  edit("ana", "2026-11-19T15:54:00.000+0000", "v4", "v5"),
] } };

test("changedItem: others' edits since the window or the read mark", () => {
  const c = changedItem(issue, { me, sinceMs: Date.parse("2026-11-16T00:00:00Z"), marks: {} });
  assert.equal(c.edits.length, 2);
  assert.equal(c.before, "v3");
  assert.equal(c.after, "v5");
  const read = withRead({}, "changed", c);
  assert.equal(changedItem(issue, { me, sinceMs: 0, marks: read }), null);
});

test("newInSprintItem: added, carried over, created, assigned", () => {
  const sprint = { id: 42, startMs: Date.parse("2026-11-16T00:00:00Z") };
  const before = "2026-11-01T00:00:00.000+0000", after = "2026-11-18T00:00:00.000+0000";
  const h = (at, items, created = before) => ({ key: "WEB-1", fields: { summary: "s", created }, changelog: { histories: [{ author: { name: "lead" }, created: at, items }] } });
  const added = newInSprintItem(h(after, [{ field: "Sprint", from: "", to: "42" }]), { sprint, me });
  assert.deepEqual([added.why, added.sprintId], ["added", 42]);
  assert.equal(newInSprintItem(h(after, [{ field: "Sprint", from: "41", to: "41, 42" }]), { sprint, me }), null);
  assert.equal(newInSprintItem(h(after, [{ field: "assignee", to: me }]), { sprint, me }).why, "assigned");
  assert.equal(newInSprintItem(h(after, [], after), { sprint, me }).why, "created");
  assert.equal(newInSprintItem(h(before, [{ field: "Sprint", from: "", to: "42" }]), { sprint, me }), null); // before the start
});

test("changedSearches: parents split by 50", () => {
  const keys = Array.from({ length: 120 }, (_, i) => `WEB-${i}`);
  const q = changedSearches({ since: 10080, parentKeys: keys });
  assert.equal(q.length, 4);
  assert.equal(q[0], "assignee = currentUser() AND resolution = Unresolved AND updated >= -10080m");
  assert.ok(q[3].startsWith("key in (WEB-100,"));
});

test("bugsSearch keeps ORDER BY last", () => {
  assert.equal(bugsSearch({ briefBugs: "issuetype = Bug ORDER BY updated DESC", highPriorities: ["P0", "P1"] }),
    'issuetype = Bug AND priority in ("P0", "P1") ORDER BY updated DESC');
});

test("briefBadge: unread only; warn when a bug is unread", () => {
  const items = { changed: [{ key: "WEB-40", at: 5 }], sprint: [], bugs: [{ key: "WEB-7" }] };
  assert.deepEqual(briefBadge(items, {}), { count: 2, tone: "warn" });
  assert.deepEqual(briefBadge(items, { "WEB-7": { bug: true } }), { count: 1, tone: "info" });
  assert.equal(briefBadge({ changed: [], sprint: [], bugs: [] }, {}), null);
  assert.deepEqual(pruneBugs({ "WEB-7": { bug: true, changed: 3 } }, []), { "WEB-7": { changed: 3 } });
});

test("checkMessage never carries description text", () => {
  const c = changedItem(issue, { me, sinceMs: 0, marks: {} });
  const msg = checkMessage(DEFAULT_CHECK_TASK, { key: c.key, summary: "Story", edits: c.edits, mine: ["WEB-41", "WEB-42"] });
  assert.ok(msg.includes("WEB-41, WEB-42"));
  for (const v of ["v2", "v4", "v5"]) assert.ok(!msg.includes(v), v);
});
```

- [ ] **Step 2:** `node --test tests/jira-brief.test.mjs` → FAIL.
- [ ] **Step 3: Implement `brief.js`.** `{when}` uses the local time zone (`toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })`); tests that assert on `{when}` set `TZ=UTC` in the test file via `process.env.TZ = "UTC"` before importing.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(jira): the brief model`.

### Task 12: The brief on Today

**Files:**
- Create: `src/mods/dock-jira/brief-view.js` — `briefView(page, t) -> element`, `changeView(page, t) -> element` (the detail's What changed / Recent changes)
- Modify: `src/mods/dock-jira/main.js`, `README.md`

**Interfaces:**
- Consumes: Tasks 8, 10, 11; `startWork` pattern (`tab.new`) from `page.js`.
- Produces: `READ_KEY = "dock.jira.read"`; `this.brief = { changed, sprint, bugs, at, problem }`; Today's count and the
  Pages badge from `briefBadge`.

- [ ] **Step 1: Today always shows** (`tabList(views, { today: true })`); without a board, Today is the brief only.
- [ ] **Step 2: Brief data** in `refreshToday`: the sprint search gains `expand: "changelog"`; `changedSearches`
  (parent keys from the unresolved sub-tasks' `parent`, fetched with `ROW_FIELDS` + `expand: "changelog"`);
  `bugsSearch`. Build items with `changedItem`, `newInSprintItem`, the bug rows; `pruneBugs` the marks; write marks
  with `setShared(READ_KEY, …)`.
- [ ] **Step 3: Draw the brief**: Changed, New in sprint, High-priority bugs (unread first, marked "new"), each row
  key · summary · reason · `ago(at)`; **Mark all read**. Opening a New-in-sprint or bug item marks it read; a Changed
  item only via **Mark read** or **Mark all read**.
- [ ] **Step 4: The detail's What changed** (for an unread Changed item): `lineDiff(wikiToText(before), wikiToText(after))`,
  editors and span, **Mark read**, **Open in browser**, **Check against my work** (`tab.new` with `checkMessage`,
  `{mine}` = the user's sub-tasks under that key, else the key). The ops are kept on the view while that detail is
  open, so a poll doesn't change what's being read. **Recent changes** on any detail: `issueHistory(key)` diffs
  within the brief's window.
- [ ] **Step 5: Badge**: `setShared(BADGE_KEY, briefBadge(...))` replaces `updateBadge`'s count of all issues;
  Today's tab count is the same number.
- [ ] **Step 6: README:** the brief, read marks, `briefBugs`, `highPriorities`, `checkTask` (generic examples), the
  badge's new meaning.
- [ ] **Step 7:** `npm test && npm run build:app && herdr-app check app/mods/dock-jira` → pass.
- [ ] **Step 8: Try it (ask first).** With the user's yes: deploy and `herdr-app shot` Today on the real Jira:
  a parent with a description edit this sprint shows under Changed with a diff; P1 bugs listed.
- [ ] **Step 9: Commit** `feat(jira): the daily brief on Today`.

---

## Part 4 — Start and Finish per flow

### Task 13: Action rules

**Files:**
- Create: `src/shared/jira/actions.js`
- Test: `tests/jira-actions.test.mjs`

**Interfaces:**
- Consumes: `Rule` (Task 2); rows/details with `project`, `type`, `subtask`, `parent.type` (Task 6).
- Produces: `matchAction(rules, issue) -> { start: string|null, finish: string|null }` — the first rule whose every
  given key matches (`parentType` matches when it includes `issue.parent?.type`) gives both; none → both `null`.

- [ ] **Step 1: Write the failing test**

```js
const rules = [
  { project: "SEC", type: "Bug", start: "/triage {key}", finish: "/resolve {key}" },
  { project: "SEC", start: "/triage {key}" },
  { subtask: true, parentType: ["Story", "Enhancement"], finish: "/report {key}" },
  { type: "Bug", finish: "/resolve {key}" },
];
test("matchAction: first match wins", () => {
  assert.deepEqual(matchAction(rules, { project: "SEC", type: "Bug" }), { start: "/triage {key}", finish: "/resolve {key}" });
  assert.deepEqual(matchAction(rules, { project: "SEC", type: "Task" }), { start: "/triage {key}", finish: null });
  assert.deepEqual(matchAction(rules, { project: "WEB", type: "Sub-task", subtask: true, parent: { type: "Story" } }), { start: null, finish: "/report {key}" });
  assert.deepEqual(matchAction(rules, { project: "WEB", type: "Sub-task", subtask: true, parent: { type: "Epic" } }), { start: null, finish: null });
  assert.deepEqual(matchAction([], { project: "WEB" }), { start: null, finish: null });
});
```

- [ ] **Step 2:** `node --test tests/jira-actions.test.mjs` → FAIL.
- [ ] **Step 3: Implement `actions.js`.**
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(jira): action rules`.

### Task 14: Start and Finish on the page

**Files:**
- Modify: `src/mods/dock-jira/main.js`, `src/shared/jira/page.js` (`startWork` takes the template it's given, unchanged)
- Modify: `README.md`, `app/RECIPE.md` (hand-written; `build:app` leaves it alone)

**Interfaces:**
- Consumes: `matchAction` (Task 13), `startWork`, `startTask`, `previewTask` (`page.js` / `model.js`).

- [ ] **Step 1:** Start work (detail button, row ▶, command `start`) uses `matchAction(...).start ?? settings.startTask`;
  the ▶ tooltip and the settings preview use the same choice.
- [ ] **Step 2:** A **Finish** button in the detail when `matchAction(...).finish` is set: `tab.new` named
  `<key> finish` running Claude with that message filled by `startTask`; command `finish`. The page changes nothing
  in Jira itself.
- [ ] **Step 3: README / RECIPE:** `actions` rules with a generic example, first match wins, Finish.
- [ ] **Step 4:** `npm test && npm run build:app && herdr-app check app/mods/dock-jira` → pass.
- [ ] **Step 5: Commit** `feat(jira): Start and Finish per flow`.
- [ ] **Step 6: The user's settings (their call, not committed):** show them the `views` and `actions` blocks from
  the spec to paste into their `jira-work.json`, and offer to deploy.
