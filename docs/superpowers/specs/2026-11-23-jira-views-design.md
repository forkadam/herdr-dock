# Jira page: tabs, a daily brief and the sprint board — design

Date: 2026-11-23. Status: designed, not built. Builds on `2026-11-22-dock-pages-jira-design.md` (the Jira page as
built: list, status board, detail, actions, Start work, fetch/curl transport, mock Jira).

## Intent

The page was connected to the real Jira on 2026-11-23 (`qnap-jira.qnap.com.tw`, Jira Server 9.12.22, PAT over
fetch, no errors). With real data it doesn't fit how the user works:

- **The board is unusable.** "Assigned to me" holds 157 open issues from 14 projects. The board adds an empty
  column for every status of every loaded project's workflow, so it runs far off to the right. Only 9 statuses hold
  anything (To Do 80, In Progress 40, Assigned 13, Handling 10, resolved 8, then Open, Suspended, Assigned (T2),
  Assigned (T3) with 1–2 each).
- **The badge says nothing.** It counts all 157 ("99+"), so it never moves.
- **One flat list mixes four different flows.** The user's tickets follow these flows (their words, plus their
  skills in `my-qnap-claude-tools`):

  | Flow | Tickets today | How it ends |
  |---|---|---|
  | Normal task | TEM61510 and others | the user moves it To Do → In Progress → Done |
  | PSIRT Task (assess) | INTSI000, issue type Task: 38 | `/qnap-psirt` investigates, drafts, posts the RD reply and reassigns to PSIRT. It never changes the status, so it just leaves the user's list. |
  | PSIRT Bug (fix) | INTSI000, issue type Bug: 20 | `/qnap-psirt` fix path, then `qnap-jira-resolve-bug` fills the Resolved screen (Fix Version/s, Build Number, Root cause, solution, RD Resolved reason) |
  | RD sub-task (SDD) | sub-tasks under a `Spec Main Task` / `Enhancement` parent, e.g. CLDACC00-783 FE / -784 BE under CLDACC00-625 | `/qnap-sdd:unit-test-report`: test report, as-built SDD docs, report field, Done with Fix Version/s, GDPR, Build Date |

- **What the user wants first each morning** (their words): new tasks added to the current sprint, high-priority
  bugs, and their tasks or their parent tasks whose description or spec changed. On a change, they "read what
  changed and check it against my work".
- **The daily scrum board** is a Jira Software board: "TEM 61510" (id 546, scrum), quick filter on the user. It has
  4 columns (To Do, RD In Progress, Test, Done), each covering several statuses, and one row per parent story with
  its FE/BE sub-tasks. The team's sprint comes from this board: today **Sprint 317**, 2026-11-16 → 2026-11-27,
  two weeks, numbered.

## Goals

- **Tabs** across the top of the page, each with its own search, layout, count, and remembered place. For this
  user: **Today** (default) · **PSIRT** · **Bugs** · **Mine** · **All**.
- **Today** = a **brief** (what's new or changed for you) above the **sprint board**, a copy of the TEM 61510
  board's layout for the current sprint.
- **Read a description change** as a before/after diff, and **hand it to Claude** to check against your work.
- **Pick a sprint by number** (the current one by default).
- **The board stops sprawling** on every tab.
- **Start / Finish hand the ticket to the right skill** for its flow (see "Action rules").

## Non-goals

- Sprint planning: creating, starting or closing sprints, ranking, story points.
- Filling transition screens that need more than one picked value: unchanged (the page names what's missing and
  links to Jira; the skills fill them).
- Knowing whether a PSIRT Task already has an RD reply (needs each ticket's comments): later.
- Toasts or other notifications outside the page: the Pages badge is the only signal.
- Jira Cloud (unchanged from the first design).
- A form for editing tabs and action rules: v1 edits them in the settings file (see Settings).

## Anti-goals (it fails even if it works)

- **QNAP specifics in herdr-dock's code or shared config.** The page is generic; the Jira page "isn't in the shared
  config: it is company-specific". Project keys, the bugs query, `P0`/`P1`, skill names and board 546 live only in
  the user's per-PC settings file. The code ships generic defaults.
- **Description text in Claude's first message.** Anyone who can edit an issue writes its description (the README
  already warns about `{description}`). "Check against my work" names the issue and the time span; Claude reads the
  change itself with its Jira tools.
- **The page acting on its own.** It never posts, transitions or reassigns except on a click, as today.
- **A heavier poll.** Today must stay at a few requests per refresh (see "Requests").

## Constraints

- Jira Server 9.12.22, PAT (`Authorization: Bearer`), REST v2 plus **Jira Software REST `/rest/agile/1.0`**
  (boards, board configuration, sprints). The user's Jira MCP reads boards and sprints over the same kind of PAT.
- Board 546 has **three** active sprints: Sprint 317 (the user's team), Lapras Sprint 19 and Hamster Sprint 4
  (other teams whose projects the board's filter also covers).
- JQL `CHANGED` doesn't cover `description`. Description edits are only in each issue's history. Search can return
  it in the same request (`expand=changelog`). Each `description` item carries the **full old and new text**
  (`fromString` / `toString`). Checked on CLDACC00-625: 8 description edits from 2026-10-13 to 2026-11-19, the text
  growing from 1.6k to 5.5k characters, two edits 8 minutes apart on Nov 19. The same history has a `Sprint` item
  on the day an issue was added to a sprint.
- Priorities in this Jira are named `P0`, `P1`, `P2`…; the user's highest today is P1 (7 open P1 bugs, no P0).
- The code's shape stays: pure modules in `src/shared/jira/` tested with `node --test`, rendering in
  `src/mods/dock-jira/main.js`, per-PC state in Herdr shared keys (`dock.jira.*`), settings in
  `<app home>/herdr-dock/jira-<site>.json` (`parseSettings` keeps keys it doesn't know). The mock Jira
  (`scripts/mock-jira.mjs`) grows whatever new endpoints the page calls.

## Approaches

Three ways to give the user several views:

- **A. Tabs (chosen).** One tab per view; each has its own search, layout, count and remembered place.
- **B. One query switcher.** Today's filter menu with the user's searches added to `filters`. Nothing to build
  (it works today through Settings), but every search gets the same layout, only the shown search has a count, and
  the brief has no place because it isn't one search.
- **C. Brief on top, switcher below.** The brief always visible, the filter menu under it. Medium cost; the brief
  takes room from every view and the views still share one layout.

The user chose **A** on 2026-11-23. Why: the views differ in shape, not just in query. Today is several searches
plus change history; the sprint wants the board's 4 columns with a row per story; PSIRT wants Tasks apart from
Bugs. And the tab counts are what the user scans each morning.

## Design

### Tabs

- A row of tabs under the header: each shows its name and count. A tab's count is its search's total; Today's is
  the number of unread brief items (below). The header keeps the site name, search box, List/Board switch (where
  the tab allows it), refresh and settings.
- **Built-in tabs** (every user): **Today**, **Mine** (the existing "Assigned to me" search), **All**
  (`assignee = currentUser() ORDER BY updated DESC`: everything assigned to you, closed included, the place to find
  an old ticket). Today's sprint board appears only when a board is set (Settings).
- **The user's own tabs** come from settings `views` (below), placed between Today and Mine in their order. A view
  can also replace a built-in's search by using its id.
- **The existing filter menu** (Assigned to me, Reported by me, Recently viewed, Jira favourites, settings
  `filters`) moves into the **All** tab, so nothing the page offers today is lost.
- **Remembered per PC:** the shown tab (`dock.jira.tab`) and each tab's List/Board choice
  (`dock.jira.layout.<tab>`). In memory while Herdr runs: each tab's search text, loaded rows, selection and scroll,
  so switching tabs is instant and returns to the same place.
- Tabs are bindable keys like the page's other commands (`dock-jira.tab` with the tab's id, and next/previous tab).

The user's settings, as proposed (values to paste into their `jira-work.json`; their call):

```json
"views": [
  { "id": "psirt", "name": "PSIRT",
    "jql": "project = INTSI000 AND assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
    "group": "type" },
  { "id": "bugs", "name": "Bugs",
    "jql": "issuetype = Bug AND status in (Open, \"Need more info\", Handling, Assigned) AND project != 61510-CloudRD1 AND project != INTSI000 AND assignee = currentUser() ORDER BY priority DESC, updated DESC" }
]
```

- The Bugs query is the user's own, shortened (it repeated itself), with `assignee = currentUser()` in place of an
  email address, and **without INTSI000**: 15 of its 24 bugs are PSIRT Bugs, which belong to the PSIRT tab's flow.
  That leaves 9 bugs here. (My call; the user can drop the `INTSI000` clause.)
- `group: "type"` lists a tab's issues by issue type first (PSIRT: Task = assess, Bug = fix), then by status
  category as today.

### The board on list tabs (fixes the sprawl)

- Columns are the statuses that hold an issue in the tab, in the order they have today.
- Empty workflow columns (from `GET /project/{key}/statuses`, added by commit 5adac41) appear **only when every
  issue in the tab comes from one project**. That keeps 5adac41's full workflow on a one-project board, and on a
  mixed one it was the sprawl.
- While dragging, the statuses the card can reach still appear as temporary empty columns (`dragColumns`, as
  today), so no drop target is lost.

### Today: the brief

Three sections above the sprint board. Each item is a row: key, summary, the reason it's there, and when. Clicking
it opens the detail, as everywhere.

1. **Changed** — description edits by **someone other than you** on:
   - your unresolved issues (`assignee = currentUser() AND resolution = Unresolved`), and
   - the parents of your unresolved sub-tasks (the user's example: CLDACC00-625, parent of CLDACC00-783/-784).
2. **New in sprint** — your issues in the current sprint that **became yours in it after it started** (my call on
   the rule; "started" is the sprint's `startDate`, the moment it was started):
   - its history adds this sprint after the start, **unless** the same `Sprint` item already held another sprint
     (`fromString` not empty): that is a carry-over from the previous sprint closing, not new work, or
   - it was created into this sprint after the start, or
   - it was already in the sprint and its history assigns it to you after the start (new to you, in the user's
     words "new added tasks").
3. **High-priority bugs** — a standing list: settings `briefBugs` (a JQL) narrowed with
   `AND priority in (<highPriorities>)`. Defaults: `briefBugs` =
   `issuetype = Bug AND assignee = currentUser() AND resolution = Unresolved`, `highPriorities` =
   `["Highest","High"]` (Jira's own names). The user's values (my call):
   `highPriorities: ["P0","P1"]` and `briefBugs` = their Bugs statuses **across every project**,
   `issuetype = Bug AND status in (Open, "Need more info", Handling, Assigned) AND assignee = currentUser()`. A P1
   is urgent wherever it lives, PSIRT and 61510-CloudRD1 included, while a bug in "resolved" (still Unresolved in
   this Jira, waiting for someone else to close it) isn't the user's to act on. Today: 6 bugs (the 7 open P1 bugs
   less QTS00000-35701, which is in "resolved").

**Unread / read** (my call; replaces a single "last looked" time):

- The brief looks back to the **current sprint's start** (14 days when no board is set).
- **Changed** items are marked read **only** by **Mark read** (in the detail) or **Mark all read** (on the brief).
  Opening the detail doesn't: the user reads the diff, then checks it against their work, and the item must not
  vanish on the next poll in between. While a detail is open, the page keeps the diff it showed even if a poll
  marks things otherwise.
- **New in sprint** and **high-priority bug** items have no diff, so opening their detail marks them read.
- **The stored shape:** `dock.jira.read` maps issue key → `{ changed?: <time of the latest edit covered>,
  sprint?: <sprint id>, bug?: true }`, per PC. A newer description edit than `changed` makes the item unread
  again. `sprint` is the sprint the New-in-sprint mark covers. `bug` records that a bug was seen on the list.
- **What shows:** Changed and New-in-sprint list only unread items; read ones drop off. High-priority bugs lists
  **every** bug its query returns, with unread ones (`bug` not set) marked **new** and first. When a bug leaves the
  list (fixed, reprioritised, reassigned), its `bug` mark is removed, so it reads as new if it comes back.
- **A read change can be read again:** the detail of any issue has **Recent changes**. It shows the description
  edits from the brief's window (back to the sprint start) as the same kind of diff, read or not.
- Today's count and the **Pages badge** are the number of unread items across the three sections. The tone is
  `warn` when one is a high-priority bug, else `info`; there's no badge when nothing is unread. This replaces the
  157 / "99+".

**Reading a change.** For a Changed item, the detail opens with a **What changed** section above the description:

- A line diff of the description (`wikiToText` on both sides), added lines and removed lines marked. It compares
  the text before the **first unread edit** with the text now, so 8 edits read as one change.
- Who edited it and when ("2 edits by <name>, Nov 19 15:46–15:54").
- **Mark read**, **Open in browser**, and **Check against my work**.

**Check against my work** opens a Claude tab, the same way Start work does (`tab.new`, then the terminal), with a
first message from settings `checkTask`, default:

```
The description of {key} ({summary}) changed {when}. Read the change with your Jira tools and check it against my work on {mine} in this repo.
```

- `{when}` is the span of the unread edits. `{mine}` is your sub-task keys under that issue when it is a parent,
  otherwise the issue's own key.
- **No description text in the message** (anti-goal).

### Today: the sprint board

- **Board:** settings `board` (a board id; the user: 546). The settings form gets a **Scrum board** picker that
  lists boards by name (`GET /rest/agile/1.0/board?type=scrum&name=`).
- **Which sprint:** among the board's active sprints, the one holding the most issues assigned to you (Sprint 317
  today; Lapras and Hamster hold none of yours); a tie goes to the earliest start. The board shows the sprint's
  name, dates and days left.
- **Another sprint:** a sprint menu by number. It lists only **the current sprint's series**: the board's sprints
  whose name is the current one's with its number swapped (`Sprint 317` → `Sprint <n>`; `Lapras Sprint 19` and
  `Hamster Sprint 4` are other series). It shows the active one, the next future one and the last 5 closed, newest
  first. Not remembered: Today always opens on the current sprint. A current name with no number (no series to
  find) lists the board's sprints that hold any of your issues instead. (My call: the series rule is generic and
  matches how this board names sprints.)
- **Columns:** the board's own (`GET /rest/agile/1.0/board/{id}/configuration`: column names and status ids,
  resolved to names with `GET /status`, which the page already calls). For 546: To Do · RD In Progress · Test · Done.
- **Issues:** `sprint = <id> AND assignee = currentUser() ORDER BY Rank`, done ones included as on Jira's board,
  with `parent` added to the row fields.
- **Rows:** one per parent story (parent key, its status and summary), in rank order of first appearance, then
  **Other issues** for issues without a parent, as on Jira's board. A row's header collapses it.
- **Drag between columns:** a column covers several statuses. A drop runs the issue's transition into any of them.
  One move: run it. Several (the existing choose box): pick. None: say so in that column (the existing refusal text).
  This is `dropPlan` with a set of statuses instead of one.
- The 4 columns share the width; the board scrolls down, not sideways.

### Action rules: Start and Finish per flow

Today Start work sends one template for every issue. With four flows, the right first message depends on the
issue, and so does the step that ends it. Settings `actions`: a list of rules, **first match wins**, each with
optional match keys `project`, `type` (issue type name), `subtask` (true/false), `parentType` (the parent's issue
type name), and the messages `start` and/or `finish`. With no rule matching, Start uses the existing `startTask` and
there is no Finish button.

- **Start work** (detail button, row ▶) sends the matched `start`.
- **Finish** (a new detail button, shown only when a rule gives `finish`) opens a Claude tab with the matched
  `finish` message, in the same way. The skills do the gated steps (each asks the user before it writes); the page
  changes nothing in Jira itself.

The user's rules, as proposed (their call):

```json
"actions": [
  { "project": "INTSI000", "type": "Bug", "start": "/qnap-psirt {key}", "finish": "/qnap-jira-resolve-bug {key}" },
  { "project": "INTSI000", "start": "/qnap-psirt {key}" },
  { "subtask": true, "parentType": ["Spec Main Task", "Enhancement"], "finish": "/qnap-sdd:unit-test-report {key}" },
  { "type": "Bug", "finish": "/qnap-jira-resolve-bug {key}" }
]
```

- `/qnap-psirt` picks its own path from the issue type, so one Start rule covers both PSIRT Tasks and Bugs.
- A PSIRT Task has no Finish: `/qnap-psirt` hands it back to PSIRT itself.

### Settings

New keys in `jira-<site>.json`, all optional, unknown keys still kept: `board` (number), `highPriorities`
(strings), `briefBugs` (JQL), `views` (`[{ id, name, jql, group? }]`), `actions` (rules above), `checkTask`
(string). The settings form
gains **Scrum board** and **High priorities**; tabs and rules are edited in the file. The form says where the file
is and reloads it when it changes. Bad entries are skipped with a line in the form saying which.

### Requests

- **Today, per refresh** (every 2 minutes while shown, as today): one search for Changed (your open issues and the
  parents, `updated >= <sprint start>`, `expand=changelog`, row fields only), one for the sprint's issues (also
  `expand=changelog`, for the `Sprint` and assignee items New in sprint reads), one for high-priority bugs. Board configuration, statuses and sprints are cached and re-read hourly or on refresh.
- **Other tabs:** the shown tab's search as today. Counts for the tabs not shown: one count-only search each
  (`maxResults=0`) every 10 minutes, the badge's current cadence.
- Parent keys come from the `parent` field of your open sub-tasks. A JQL `key in (...)` list over 50 keys is split.

### Mock Jira

`npm run mock:jira` grows: a scrum board with a column configuration of several statuses per column; two sprint
series on it (`Sprint <n>`, and another team's active sprint holding none of the mock user's issues, like Lapras),
each with closed, active and future sprints; a `Sprint` field and `parent` on issues; `expand=changelog` with
description edits (by the mock user and by another user), a mid-sprint `Sprint` add, a carry-over from the previous
sprint, and a mid-sprint reassignment to the mock user; bugs in a "resolved" status that are still Unresolved;
priorities named `P0`–`P3`.

### Order of work (my call)

1. Tabs, `views`, Mine/All (filter menu moved into All), the user's list tabs, and the board's empty-column rule.
   This alone makes the page usable with the user's 157 issues.
2. The sprint board on Today (agile API, sprint picker, rows per parent, drag over column → statuses).
3. The brief: Changed with read marks and the diff, New in sprint, high-priority bugs, Check against my work, badge.
4. Action rules: Start and Finish per flow.

### Check first, against the real Jira

- `GET /rest/agile/1.0/board/546/configuration` through the page's own transport and PAT (fetch), before building
  step 2.
- The issue type name of the user's RD sub-tasks (the MCP used to check this hides it), for the `actions` rule
  (`subtask: true` with `parentType` already avoids depending on it).

## Left to the builder

- The diff algorithm (a line LCS is enough) and its colours; how long a diff shows before "show all".
- Tab styling, the count's format past 99, and keyboard bindings' default keys (none bound by default, as today).
- Cache lifetimes inside the stated cadence; how the count-only searches are staggered.
- The order of items inside each brief section (newest first is the expected default).
- Whether a sprint row's collapsed state is remembered (in memory is enough).
- README and RECIPE updates for the new settings, tabs and brief.
