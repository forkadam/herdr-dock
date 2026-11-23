# Jira page: a tab button that opens Claude — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tab from settings `views` can carry a button (`label`, `task`) that opens Claude with `task` in a new Herdr tab.

**Architecture:** Settings parsing (`settings.js`) validates the button, the tab model (`views.js`) carries it, a pure command builder (`page.js`) turns it into a `tab.new`, and the header (`main.js`) draws it. Same split as the rest of the page: decisions pure and tested, drawing in the mod.

**Tech Stack:** Node 22 ESM, `node --test`, esbuild via `npm run build:app`.

**Spec:** `docs/superpowers/specs/2026-11-23-jira-tab-button-design.md`

## Global Constraints

- Pure logic in `src/shared/jira/*.js`, never importing `herdr`, `gpui-kit` or `gpui-base`; tests in `tests/jira-*.test.mjs` (`node:test`, `node:assert/strict`).
- After any change under `src/`, `npm run build:app` and commit `app/` in the same commit (drift test). `npm test` passes except the known `tests/dock-core-class.test.mjs` (Node 22.14).
- No company specifics in code, defaults, tests, README or RECIPE (no "PSIRT", no skill names). No deploy without the user's yes.
- Commits `feat(jira): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A `button` with an empty `label` or `task`, or that isn't an object → skipped with `views[i]: button needs a label and a task`; the tab stays. (tested below)
2. A view replacing a built-in (`id: "all"`) keeps its button on that tab. (tested below)
3. A typed `\n` in `task` becomes a line break, as in the Start-work template. (tested below)
4. Switching to a tab without a button hides it; the Today tab never shows one. (review — drawing)
5. Clicking while not connected still opens Claude (it needs no Jira call). (review — drawing)

---

### Task 1: A tab button that opens Claude

**Files:**
- Modify: `src/shared/jira/settings.js` (views parsing), `src/shared/jira/views.js` (`fromView`, the built-in override), `src/shared/jira/page.js` (new export), `src/mods/dock-jira/main.js` (`header()`), `README.md` (tabs section), `app/RECIPE.md` (tabs paragraph)
- Test: `tests/jira-settings.test.mjs`, `tests/jira-views.test.mjs`, `tests/jira-page.test.mjs`

**Interfaces:**
- Produces:
  - `View` and `Tab` gain `button: { label: string, task: string } | null` (label and task trimmed; built-in tabs `null` unless a view with their id gives one).
  - `tabButtonWork(button) -> { command: "tab.new", args: { name: string, argv: ["claude"], task: string } } | null` in `page.js` — `name` = the label, `task` = the task with a typed `\n` turned into a line break; `null` for no button.

- [ ] **Step 1: Write the failing tests**

```js
// tests/jira-settings.test.mjs
test("jiraOptions: a view's button", () => {
  const o = jiraOptions({ views: [
    { id: "sec", name: "Security", jql: "project = SEC", button: { label: " Triage all ", task: " /triage " } },
    { id: "ops", name: "Ops", jql: "project = OPS", button: { label: "", task: "/x" } },
    { id: "web", name: "Web", jql: "project = WEB", button: "go" },
    { id: "api", name: "API", jql: "project = API" },
  ] });
  assert.deepEqual(o.views.map((v) => v.button), [{ label: "Triage all", task: "/triage" }, null, null, null]);
  assert.deepEqual(o.warnings, ["views[1]: button needs a label and a task", "views[2]: button needs a label and a task"]);
});

// tests/jira-views.test.mjs
test("tabList: a view's button rides on its tab, a built-in's too", () => {
  const b = { label: "Triage all", task: "/triage" };
  const tabs = tabList([{ id: "sec", name: "Security", jql: "x", group: null, button: b }, { id: "all", name: "All", jql: "y", group: null, button: b }], { today: true });
  assert.deepEqual(tabs.map((t) => [t.id, t.button]), [["today", null], ["sec", b], ["mine", null], ["all", b]]);
});

// tests/jira-page.test.mjs
test("tabButtonWork: a Claude tab named after the label", () => {
  assert.deepEqual(tabButtonWork({ label: "Triage all", task: "/triage\\nall of them" }),
    { command: "tab.new", args: { name: "Triage all", argv: ["claude"], task: "/triage\nall of them" } });
  assert.equal(tabButtonWork(null), null);
});
```

- [ ] **Step 2:** `node --test tests/jira-settings.test.mjs tests/jira-views.test.mjs tests/jira-page.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** Parse `button` in `jiraOptions` (`isObj` + non-empty trimmed `label`/`task`, else `null` and the warning when `button` is present). `fromView` copies it; the built-in override keeps the view's button. `tabButtonWork` as above. In `header()`, when the shown tab has a `button` (never Today), draw it with the existing `this.button(t, "jira-tab-button", label, onClick, { tip })` right of the search box; the tooltip is the task it sends. The click runs `tabButtonWork(...)` the same way `startWork` runs its command, then shows the terminal (as Start work does).
- [ ] **Step 4:** `npm test` → PASS (except the known baseline).
- [ ] **Step 5:** README (tabs section) and `app/RECIPE.md`: document `button` with a generic example (`{ "label": "Triage all", "task": "/triage" }`), one per tab, opens Claude with the task, the typed `\n`.
- [ ] **Step 6:** `npm run build:app && herdr-app check app/mods/dock-jira` → "check passed".
- [ ] **Step 7: Commit** `feat(jira): a tab can carry a button that opens Claude` (src, tests, README, app/).

### After the task (controller, with the user's yes)

- [ ] Add the button to the user's `psirt` view in their settings file; deploy; picture the PSIRT tab's header.
