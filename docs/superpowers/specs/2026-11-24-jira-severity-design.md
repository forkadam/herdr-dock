# Jira page: severity on a tab — design

Date: 2026-11-24. Status: designed, not built. Builds on the Jira page's own tabs (`views` in `jira-work.json`,
`2026-11-23-jira-views-design.md`).

## Intent

The user works a security-report queue in its own tab (one of their `views`). What matters first in that queue is how
severe each report is, and anything severe "requires attention right away". Today the tab groups by issue type and
shows no severity at all; the user reads it from each title. The tab should show each ticket's severity as a coloured
label, put the severe ones in a box at the top, and make the tab's count turn red when anything severe is open, so
it's noticed from any other tab.

## What exists (the builder's starting point)

- **Views** (`src/shared/jira/settings.js` `jiraOptions`): `{ id, name, jql, group?: "type", button? }`; a bad entry is
  dropped with a warning, the rest of the file keeps working.
- **Rows** (`src/shared/jira/model.js` `issueRow`) come from searches asking `ROW_FIELDS` (`src/shared/jira/jql.js`);
  `client.search(jql, { fields })` takes other fields.
- **List view** (`src/mods/dock-jira/main.js` `listView`): `sectionsFor(rows, group)` (`src/shared/jira/views.js`) → titled
  sections (by type when `group: "type"`), each split To do / In progress / Done (`groupByCategory`).
- **Tab counts** (`src/mods/dock-jira/tabs.js`): `tabCountText` per tab; a failed search shows "!" in `t.blocked`. The
  shown tab is counted by its own search; the others by a `maxResults: 0` search every `HIDDEN_EVERY_MS`
  (`countsDue`, main.js ~780). `withSearch(jql, text)` (jql.js) already splits a view's `ORDER BY` off to add a clause.
- **Theme colours** used on the page: `t.blocked` (red), `t.done` (green), `t.accent`, `t.dim`, `t.muted`; `TYPE_COLOR`
  already mixes theme colours with a hex.

The user's Jira (checked 2026-11-24, 500 of their security-report bugs over two years): a select field **Severity**
(`customfield_11700`, options Blocker < Critical < Major < Normal < Minor < Trivial < Enhancement) is set on every bug,
and maps one-to-one onto the `[Vn]` tag their titles carry: Critical V5, Major V4, Normal V3, Minor V2, Trivial V1.
18 of the 500 have the field but no tag in the title. Their open queue (29): 20 bugs (V1 1, V2 10, V3 9) and 9
assessment tasks with no severity.

## Goals

A view may carry a **`severity`** block. Shape (the user's own values go in their settings file, not in the code):

```json
"severity": {
  "field": "customfield_11700",
  "levels": [
    { "values": ["Blocker", "Critical"], "label": "V5", "color": "red",    "attention": true },
    { "values": ["Major"],               "label": "V4", "color": "orange", "attention": true },
    { "values": ["Normal"],              "label": "V3", "color": "yellow" },
    { "values": ["Minor"],               "label": "V2", "color": "blue" },
    { "values": ["Trivial"],             "label": "V1", "color": "gray" }
  ],
  "unrated": "Not assessed yet"
}
```

- `levels` are listed worst first; that order is the display order. A ticket's level is the first level whose `values`
  holds the field's value (a select's `value`/`name`, or a plain string).
- **Rows:** in that tab, each row (and board card) shows its level's `label` as a small coloured chip. A ticket whose
  field is empty or holds a value no level lists has no chip and counts as unrated.
- **Grouping:** a view with `severity` and no `group` groups by severity; `group: "severity"` says so explicitly, and
  `group: "type"` keeps type sections and only adds the chips and the red count (no box). `group: "severity"` without
  a valid `severity` block is a warning and the view lists ungrouped. Sections in level order, titled
  `<label> · <values joined by "/">` (e.g. "V3 · Normal") with their count, each still split To do / In progress /
  Done; then one section titled `unrated` (default "No severity") for the rest. Empty levels are not shown.
- **"Open"** means not in Jira's Done status category (my call: a view's JQL may include finished work, and finished
  work never needs attention).
- **Needs attention now:** the open rows of `attention` levels are drawn first, by level, inside one box titled "Needs
  attention now" in the alert colour (red), split To do / In progress. Done-category rows of those levels go in their
  level's normal section below the box. With none open, a single quiet line "Nothing needs attention now" stands in
  the box's place, so the user can see the check ran. When the attention count (below) is larger than the attention
  rows loaded, the box ends with "<n> more not loaded" and the tab's Load more action (my call: rows arrive in the
  view's own order, so a severe ticket can sit past the loaded page).
- **Red tab count:** when the view has at least one open ticket at an `attention` level, its tab count is drawn in red
  (`t.blocked`), with a tooltip "<n> need attention now". It comes from one `maxResults: 0` search, the view's JQL (its
  `ORDER BY` dropped) `AND <field> in (<attention values>) AND statusCategory != Done` (for `customfield_NNNNN`, JQL's
  `cf[NNNNN]`), run with each count of that tab: every refresh while it's shown, every count round while hidden. It
  ignores the header's search text (my call: red means the queue has something severe, whatever is being searched).
- **Colours:** `color` is one of `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray`, or `#rrggbb`. Red maps to
  `t.blocked`, green to `t.done`, gray to `t.dim`; the others are fixed hex values chosen to read on both light and dark
  themes.
- **Settings check:** a `severity` block that is malformed (no `field`, no `levels`, a level without `values` or
  `label`, an unknown colour) is a warning on the Settings form, and the view keeps working without severity, as a bad
  `button` does today.
- **Docs:** README's "Your own tabs" gains `severity` with a generic example (no company names, no `[Vn]`).

## Non-goals

- Severity anywhere but the configured view: Today's brief, the sprint board, the detail pane, other tabs.
- A Settings form for editing `severity` (file only, like `views` and `button` today; the form for tabs is a planned
  follow-up).
- Reading severity from the title.
- Sounds or notifications for a new severe ticket.

## Anti-goals

- Company specifics (field ids, V labels, project keys) in code, tests, README or RECIPE.
- Hiding unrated tickets: the assessment tasks must stay visible.
- A broken `severity` block breaking the tab or the page.
- More than one extra Jira request per view per count round.

## Approaches

- **A. A severity field set on the view (chosen, 2026-11-24).** The settings name the Jira field and its levels; the
  page fetches the field with the tab's search. Correct for the user's data (catches the 18/500 untagged titles),
  generic for other teams, one extra field and one extra count search.
- **B. Parse `[Vn]` from the title.** Cheapest, but misses untagged titles and typos; specific to one team's titles.
- **C. One Jira search per section.** Most flexible, but one request per section per refresh, and rows still carry no
  chip without fetching the field.

The user picked **A**, with the red tab count, and set the attention levels to **V4 and V5** (Major and Critical).

## Left to the builder

- Where the pure pieces live (a `severity.js` under `src/shared/jira/` is the expected shape: parse the block, a row's
  level, sections, the attention JQL) and their tests; how `issueRow` carries the field (e.g. a `severity` key holding
  the raw value) without changing other tabs' searches.
- Exact hex values for orange, yellow, blue and purple; the chip's size and placement (before the key is the expected
  place); the box's styling within the page's existing look.
- Whether the count search runs only for views with `attention` levels (expected) and how its failure shows (expected:
  the count stays as it was, not red, no "!" for this extra search alone).
- The user's settings change is applied by the controller after the build, with their yes: their security view gets the
  block above, and its `"group": "type"` becomes `"severity"` (they agreed to severity sections replacing type
  sections, 2026-11-24).
