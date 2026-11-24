# Jira page: severity on a tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A view with a `severity` block shows each ticket's level as a coloured chip, groups by severity with a red "Needs attention now" box on top, and turns its tab count red while anything at an attention level is open.

**Architecture:** Everything decidable without Jira or the UI lives in a new pure `src/shared/jira/severity.js` (parsing the block, a ticket's level, colours, the attention JQL, the sections) plus small additions to `settings.js` and `views.js`. The page (`src/mods/dock-jira/main.js`, `tabs.js`) asks the extra field, runs one count-only attention search per count, and draws chips, the box and the red count.

**Tech Stack:** Node 22 ESM, `node --test`, esbuild via `npm run build:app`, gpui-kit views.

**Spec:** `docs/superpowers/specs/2026-11-24-jira-severity-design.md`

## Global Constraints

- Pure logic never imports `herdr`, `gpui-kit` or `gpui-base`; tests in `tests/*.test.mjs` (`node:test`, `node:assert/strict`).
- After any change under `src/`, `npm run build:app` and commit `app/` in the same commit (drift test). `npm test` passes except the known `tests/dock-core-class.test.mjs` (Node 22.14).
- No company specifics in code, tests, README or RECIPE: no real field ids from the user's Jira, no `V1`–`V5`, no project keys. Tests use neutral values (e.g. `customfield_10001`, labels `S1`–`S3`, values `High`/`Medium`/`Low`).
- A malformed `severity` block never breaks the tab or the page: it is one warning and the view works without severity.
- At most one extra Jira request per view per count (the attention count, `maxResults: 0`), and only for views with attention levels.
- Commits `feat(jira): …` / `fix(jira): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No deploy without the user's yes.

## Review Focus

1. A view whose `severity` block is malformed → one warning, the view still lists (ungrouped, or by type if it says so). (Task 1)
2. A ticket whose field holds a value no level lists (or is empty) → no chip, in the unrated section, never in the box. (Task 2)
3. An attention-level ticket in Jira's Done category → not in the box and not counted; it shows in its level's section below the box. (Task 2)
4. A view JQL with `OR` and `ORDER BY` → the attention JQL keeps its meaning (parenthesised, `ORDER BY` dropped). (Task 2)
5. The attention search fails while the list search succeeds → the count keeps its number, is not red, shows no "!". (Task 3)

---

### Task 1: The `severity` block in the settings

**Files:**
- Create: `src/shared/jira/severity.js` (this task: `COLOR_NAMES`, `parseSeverity`)
- Modify: `src/shared/jira/settings.js` (`jiraOptions`, the views loop ~line 168–190), `src/shared/jira/views.js` (`fromView`, `tabList`'s `builtin`)
- Test: `tests/jira-severity.test.mjs` (new), `tests/jira-settings.test.mjs`, `tests/jira-views.test.mjs`

**Interfaces:**
- Produces:
  - `COLOR_NAMES = ["red", "orange", "yellow", "green", "blue", "purple", "gray"]`
  - `parseSeverity(value, at) -> { severity: Severity | null, warning: string | null }` where `Severity = { field: string, levels: Level[], unrated: string }`, `Level = { values: string[], label: string, color: string, attention: boolean }`. Valid when `field` is a non-empty string; `levels` a non-empty list; each level has `values` (non-empty list of non-empty strings), `label` (non-empty), `color` (a `COLOR_NAMES` entry or `#rrggbb`), optional boolean `attention` (default false); optional non-empty `unrated` (default `"No severity"`). Strings are trimmed; a hex colour is lower-cased. Anything else → `{ severity: null, warning: "<at>.severity: <what is wrong>" }`.
  - Views from `jiraOptions` gain `severity: Severity | null`. `group`: `"type"`, `"severity"` or null. No `group` + valid severity → `"severity"`. `group: "severity"` without a valid severity → warning `<at>: group "severity" needs a valid severity block`, group null. Any other group value → warning `<at>: group "<g>" is not "type" or "severity"` (the existing test's expected text changes accordingly).
  - Tabs from `tabList` carry `severity` (`fromView`, and a `mine`/`all` view through `builtin`), null when absent.

- [ ] **Step 1: Write the failing tests**

```js
// tests/jira-severity.test.mjs
const block = { field: "customfield_10001", levels: [
  { values: ["Highest", "High"], label: "S1", color: "red", attention: true },
  { values: ["Medium"], label: "S2", color: "#ABCDEF" },
  { values: ["Low"], label: "S3", color: "gray" } ] };
test("parseSeverity: a valid block, defaults filled", () => {
  const { severity, warning } = parseSeverity(block, "views[0]");
  assert.equal(warning, null);
  assert.equal(severity.unrated, "No severity");
  assert.deepEqual(severity.levels[1], { values: ["Medium"], label: "S2", color: "#abcdef", attention: false });
});
test("parseSeverity: each malformed shape is one warning and no severity", () => {
  for (const bad of [null, "x", {}, { field: "f" }, { field: "f", levels: [] }, { field: "f", levels: [{ values: [], label: "a", color: "red" }] },
    { field: "f", levels: [{ values: ["v"], color: "red" }] }, { field: "f", levels: [{ values: ["v"], label: "a", color: "pink" }] },
    { field: "f", levels: [{ values: ["v"], label: "a", color: "red", attention: "yes" }] }]) {
    const r = parseSeverity(bad, "views[0]");
    assert.equal(r.severity, null, JSON.stringify(bad));
    assert.match(r.warning, /^views\[0\]\.severity: /);
  }
});
```

  In `tests/jira-settings.test.mjs`: a view with `block` and no `group` → `group: "severity"`, `severity` set, no warnings; with `group: "type"` → `"type"` and severity set; `group: "severity"` with a malformed block → two warnings (the block's, then `group "severity" needs a valid severity block`), group null, the view kept; the existing `group: "status"` test expects `'views[0]: group "status" is not "type" or "severity"'`. In `tests/jira-views.test.mjs`: `tabList` carries `severity` for an own view and for a `mine` view; null otherwise.
- [ ] **Step 2:** `node --test tests/jira-severity.test.mjs tests/jira-settings.test.mjs tests/jira-views.test.mjs` → FAIL.
- [ ] **Step 3: Implement** (severity.js imports nothing from the host).
- [ ] **Step 4:** `npm test` → PASS. **Step 5:** `npm run build:app`, commit `feat(jira): a severity block on a tab's settings`.

### Task 2: A ticket's level, its colour, the attention search and the sections

**Files:**
- Modify: `src/shared/jira/severity.js`, `src/shared/jira/views.js`
- Test: `tests/jira-severity.test.mjs`, `tests/jira-views.test.mjs`

**Interfaces:**
- Consumes: `Severity`/`Level` (Task 1); `groupByCategory` (`src/shared/jira/model.js`); rows from `issueRow` (`category` is `"new" | "indeterminate" | "done"`).
- Produces (severity.js):
  - `severityValue(issue, field) -> string | null` — `issue.fields[field]`: a string as is; an object's `value ?? name`; a list's first element read the same way; anything else null.
  - `levelOf(value, severity) -> Level | null` — the first level whose `values` holds `value`.
  - `colorOf(color) -> { theme: "blocked" | "done" | "dim" } | { hex: string }` — red → `blocked`, green → `done`, gray → `dim`; orange `#f97316`, yellow `#eab308`, blue `#3b82f6`, purple `#8b5cf6`; a `#rrggbb` as given.
  - `attentionJql(jql, severity) -> string | null` — null without attention levels; else `(<jql without its ORDER BY>) AND <field> in (<attention values, quoted>) AND statusCategory != Done`, where `<field>` is `cf[N]` for `customfield_N`, otherwise the name (quoted when not a plain word). Quoting as `jql.js`'s `quote` (export it).
  - `severitySections(rows, severity) -> { attention: Section[], sections: Section[] }`, `Section = { title, level: Level | null, parts }` (`parts` from `groupByCategory`), rows carrying `severity` (the raw value). `attention`: each attention level, in order, with its rows not in category `done`, title `"<label> · <values joined by '/'>"`. `sections`: each level in order with its remaining rows (an attention level's `done` rows; every row of the others), same title; then the rows with no level under `{ title: severity.unrated, level: null }`. Empty ones are left out.
- Produces (views.js):
  - `countTone(count) -> "problem" | "attention" | "plain"` — `problem` when `count?.problem`; `attention` when `count?.attention > 0`; else `plain`.
  - `attentionTip(count) -> string | null` — `"<n> need attention now"` when `count?.attention > 0`, else null.

- [ ] **Step 1: Write the failing tests**

```js
const sev = parseSeverity(block, "v").severity;
const row = (key, value, category = "new") => ({ key, severity: value, category, summary: key });
test("severitySections: attention box, the rest in level order, unrated last", () => {
  const { attention, sections } = severitySections([row("A-1", "Low"), row("A-2", "High"), row("A-3", "High", "done"), row("A-4", null), row("A-5", "Unknown"), row("A-6", "Medium", "indeterminate")], sev);
  assert.deepEqual(attention.map((s) => [s.title, s.parts.flatMap((p) => p.rows.map((r) => r.key))]), [["S1 · Highest/High", ["A-2"]]]);
  assert.deepEqual(sections.map((s) => [s.title, s.parts.flatMap((p) => p.rows.map((r) => r.key))]),
    [["S1 · Highest/High", ["A-3"]], ["S2 · Medium", ["A-6"]], ["S3 · Low", ["A-1"]], ["No severity", ["A-4", "A-5"]]]);
});
test("attentionJql: parenthesised, ORDER BY dropped, values quoted, open only", () => {
  assert.equal(attentionJql('project = X OR labels = y ORDER BY updated DESC', sev),
    '(project = X OR labels = y) AND cf[10001] in ("Highest", "High") AND statusCategory != Done');
  assert.equal(attentionJql("project = X", parseSeverity({ ...block, levels: block.levels.map((l) => ({ ...l, attention: false })) }, "v").severity), null);
});
test("severityValue / levelOf / colorOf", () => {
  assert.equal(severityValue({ fields: { customfield_10001: { value: "High" } } }, "customfield_10001"), "High");
  assert.equal(severityValue({ fields: { customfield_10001: [{ name: "Low" }] } }, "customfield_10001"), "Low");
  assert.equal(severityValue({ fields: {} }, "customfield_10001"), null);
  assert.equal(levelOf("High", sev).label, "S1");
  assert.equal(levelOf("Unknown", sev), null);
  assert.deepEqual(colorOf("red"), { theme: "blocked" });
  assert.deepEqual(colorOf("#abcdef"), { hex: "#abcdef" });
});
test("countTone / attentionTip", () => {
  assert.equal(countTone({ total: 3, attention: 1 }), "attention");
  assert.equal(countTone({ problem: { message: "x" }, attention: 2 }), "problem");
  assert.equal(countTone({ total: 3, attention: 0 }), "plain");
  assert.equal(attentionTip({ attention: 2 }), "2 need attention now");
  assert.equal(attentionTip({ total: 2 }), null);
});
```

- [ ] **Step 2:** run them → FAIL. **Step 3: Implement.** **Step 4:** `npm test` → PASS. **Step 5:** `npm run build:app` if `app/` changes, commit `feat(jira): severity levels, sections and the attention search`.

### Task 3: The page draws it

**Files:**
- Modify: `src/mods/dock-jira/main.js` (`refresh` ~line 376–408, `refreshCounts` ~773–789, `listView` ~1410, `row` ~1383, `card` ~1436), `src/mods/dock-jira/tabs.js`, `README.md` ("Your own tabs", ~line 268), `app/RECIPE.md` if it lists view keys
- Test: pure helpers added here get tests in `tests/jira-severity.test.mjs` or `tests/jira-views.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–2; tabs carry `severity`; `ROW_FIELDS`, `withSearch` (jql.js); `this.counts` entries `{ total?, problem?, loading? }` gain `attention?: number`.

- [ ] **Step 1: Rows carry the level.** A tab with `severity` searches with `fields: [...ROW_FIELDS, severity.field]` and its rows are `{ ...issueRow(i, base), severity: severityValue(i, severity.field) }`; other tabs are unchanged.
- [ ] **Step 2: The attention count.** For a tab whose `attentionJql(source jql, severity)` is not null: after its list search succeeds (shown tab) and after its count search (hidden tab, `refreshCounts`), one `search(attentionJql, { maxResults: 0 })` sets the count's `attention` to the answer's `total`. It ignores the header's search text. Until it answers, a count keeps the `attention` it had (setting `total` must not drop it); when it fails, `attention` stays as it was (not red when there was none) and no "!" is shown for it alone. A rejected token is handled as any search's (`countFailure`).
- [ ] **Step 3: The red count.** `tabs.js` colours the count by `countTone`: `problem` → `t.blocked` (as now), `attention` → `t.blocked` with the `attentionTip` tooltip, `plain` → `t.dim`.
- [ ] **Step 4: The list.** When the shown tab's `group` is `"severity"` and it has `severity`: draw `severitySections(rows, severity)` — first the box "Needs attention now" (red title, a red-tinted border, the `attention` sections inside, split To do / In progress) or, with none, one quiet line "Nothing needs attention now"; when the count's `attention` is larger than the attention rows loaded, the box ends with "<n> more not loaded" and the existing Load more action; then `sections` as the list draws sections today. `group: "type"` and no group draw as today.
- [ ] **Step 5: Chips.** In a tab with `severity`, each row and board card whose `levelOf(r.severity)` is a level shows its `label` as a small chip (before the key) in `colorOf(level.color)` (`theme` → `t[theme]`, falling back to `t.accent`; `hex` as is). No chip for unrated rows.
- [ ] **Step 6: Docs.** README "Your own tabs": the `severity` block (field, levels with values/label/color/attention, unrated), `group: "severity"`, the box, the red count, with a neutral example (S1–S3, `customfield_10001`).
- [ ] **Step 7:** `npm test`, `npm run build:app`, `herdr-app check app/mods/dock-jira` → pass. Commit `feat(jira): severity chips, the attention box and a red tab count`.

### After the tasks (controller, with the user's yes)

- [ ] Add the user's block to their security view in `jira-work.json` (`field: "customfield_11700"`; levels Blocker/Critical → V5 red attention, Major → V4 orange attention, Normal → V3 yellow, Minor → V2 blue, Trivial → V1 gray; `unrated: "Not assessed yet"`; `group: "severity"`), deploy with `--no-statusline`, and picture the tab.
