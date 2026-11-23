# Jira page: a button on a tab that opens Claude — design (short)

Date: 2026-11-23. Status: approved by the user, not built. Builds on `2026-11-23-jira-views-design.md` (tabs from
settings `views`, Start/Finish opening Claude in a Herdr tab).

- **Intent.** The user wants a button at the top of their PSIRT tab, **Assessing PSIRT ISSUES**, that opens Claude
  with their `/psirt-triage` skill — one click from the list of PSIRT tickets to triaging them.
- **Goal.** A tab from settings `views` can carry one button: `"button": { "label": "…", "task": "…" }`. When that tab
  is shown, the button sits in the header row, right of the search box. A click opens a new Herdr tab named after the
  label, running `claude` with `task` as its first message (the same way Start work opens Claude), then shows the
  terminal.
- **Non-goals.** No placeholders in `task` (it's not about one issue; the skill reads Jira itself). One button per tab.
  No form for editing it (settings file, like `views`). Nothing changes in Jira.
- **Anti-goal.** No company specifics in herdr-dock's code, defaults, tests, README or RECIPE: the label and the skill
  name live only in the user's settings file.
- **Constraints.** Settings stay backward compatible: `button` is optional; a `button` without a non-empty `label` and
  `task` is skipped with a line in Settings (`views[i]: button needs a label and a task`), and the tab itself is kept.
  A view that replaces a built-in (`id` "mine" or "all") may carry a button too.
- **Approaches.** (1) **Button from settings, per tab (chosen):** generic, the user changes label or skill without
  code. (2) A hard-wired button on a tab named PSIRT: rejected, puts company names in the code. (3) A global list of
  launch buttons shown on every tab: rejected, not what was asked and clutters other tabs.
- **The user's settings** (their file, not committed): the `psirt` view gets
  `"button": { "label": "Assessing PSIRT ISSUES", "task": "/psirt-triage" }`.
- **Left to the builder.** The button's style (the page's existing secondary button), its tooltip (the message it
  sends), and whether `task` honours the typed `\n` line-break convention of the Start-work template (yes, for
  consistency).
