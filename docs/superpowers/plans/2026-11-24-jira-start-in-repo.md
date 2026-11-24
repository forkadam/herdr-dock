# Jira page: Start work in the ticket's repo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start work and Finish open Claude in the ticket's repo — the remembered folder, else the project's mapped folder, else a picker — in the space already working there; Start in… always asks.

**Architecture:** A pure `src/shared/jira/start-in.js` decides everything that doesn't need the host: the `projects` setting, path matching, which folder a ticket resolves to, which space has a folder, the picker's rows, the remembered map, and the Herdr command to run. The page (`src/mods/dock-jira/main.js`) gathers `spaces()`, `panes()`, `focused()` and a folder-exists probe, draws the picker, and runs the command.

**Tech Stack:** Node 22 ESM, `node --test`, esbuild via `npm run build:app`, gpui-kit views, Herdr API (`~/.config/herdr-app/herdr.d.ts`).

**Spec:** `docs/superpowers/specs/2026-11-24-jira-start-in-repo-design.md`

## Global Constraints

- Pure logic never imports `herdr`, `gpui-kit` or `gpui-base`; tests in `tests/*.test.mjs` (`node:test`, `node:assert/strict`).
- After any change under `src/`, `npm run build:app` and commit `app/` in the same commit (drift test). `npm test` passes except the known `tests/dock-core-class.test.mjs` (Node 22.14).
- No company specifics in code, tests, README or RECIPE (no real project keys or repo names; tests use e.g. `ABC`, `/home/u/code/app`).
- Never start Claude in a guessed or missing folder: a remembered or mapped folder that doesn't exist goes to the picker.
- A plain Start/Finish never asks when the answer is known (remembered, or mapped and existing); only Start in… always asks.
- Commits `feat(jira): …` / `fix(jira): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No deploy without the user's yes.

## Review Focus

1. A space whose own `folder` is home but whose terminal is in the repo → it matches, and the tab is opened with the repo folder explicitly. (Task 1, Task 2)
2. A mapped folder that doesn't exist on this PC → the picker, never a start there. (Task 2)
3. Two spaces in the same folder → the shown one is used. (Task 1)
4. Escape / click outside the picker, or cancelling Other folder… → nothing starts, nothing is remembered. (Task 2)
5. Start in… with Remember unticked → opens there once; the remembered folder is unchanged. (Task 1, Task 2)

---

### Task 1: The pure model and the `projects` setting

**Files:**
- Create: `src/shared/jira/start-in.js`
- Modify: `src/shared/jira/settings.js` (`jiraOptions` returns `projects`)
- Test: `tests/jira-start-in.test.mjs` (new), `tests/jira-settings.test.mjs`

**Interfaces:**
- Produces (start-in.js):
  - `normPath(path, home) -> string` — `~` / `~/…` expanded with `home`, backslashes to `/`, a trailing `/` dropped (not for a bare `/`).
  - `inside(path, folder) -> boolean` — `path` is `folder` or below it (both normalised; `/a/bc` is not inside `/a/b`).
  - `parseProjects(value) -> { projects: { [key]: string }, warnings: string[] }` — a map of project key (non-empty) → non-empty string; anything else in an entry is a warning `projects.<key>: must be a folder path`, a non-object `projects` is one warning `projects: not a map of project key to folder`. Values trimmed, kept unexpanded.
  - `resolveFolder(issue, { remembered, projects, home }) -> { folder, source: "remembered" | "mapped" } | null` — `issue = { key, project }`; `remembered[key]` first, then `projects[project]`; folders returned normalised.
  - `suggestFolder(issue, { remembered, projects, home }) -> string | null` — for the picker's preselection: the ticket's remembered folder, else its parent's (`issue.parent?.key`), else the mapped one.
  - `spaceFor(folder, { spaces, panes, shownSpace, home }) -> space | null` — among spaces with `machine == null`: a space matches when `normPath(space.folder)` equals `folder`, or one of its panes (joined by `pane.tab` ∈ `space.tabs[].id`) has a `cwd` inside `folder`. Prefer the space whose id is `shownSpace`, else the first match in order.
  - `pickerRows({ spaces, panes, home, mapped }) -> [{ folder, label, path, spaces: string[] }]` — one row per distinct folder that local spaces work in (each space's `folder` unless it is home or empty, and each of its panes' `cwd`, normalised), `label` = last path part, `path` = the folder with `home` shown as `~`, `spaces` = the names of the spaces it's in; the `mapped` folder first (added if absent), the rest by label.
  - `remember(map, key, folder, cap = 300) -> map` — a new map with `key` → `folder` set last (an existing key moves to last); when over `cap`, the oldest keys are dropped.
  - `openCommand({ folder, space, name, task }) -> { command, args }` — with a `space`: `{ command: "tab.new", args: { space: space.id, folder, name, argv: ["claude"], task } }`; without: `{ command: "space.new", args: { name: <folder's last part>, folder, tab: name, argv: ["claude"], task } }`.
- `jiraOptions(...)` gains `projects` (from `parseProjects(s.projects)`; its warnings join the others; absent → `{}`).

- [ ] **Step 1: Write the failing tests** (in `tests/jira-start-in.test.mjs`)

```js
const home = "/home/u";
const spaces = [
  { id: "s1", name: "app", folder: "/home/u", machine: null, tabs: [{ id: "t1" }] },
  { id: "s2", name: "tools", folder: "/home/u/code", machine: null, tabs: [{ id: "t2" }, { id: "t3" }] },
  { id: "s3", name: "app", folder: "/home/u/code/app", machine: null, tabs: [{ id: "t4" }] },
  { id: "s4", name: "far", folder: "/home/u/code/app", machine: "box", tabs: [{ id: "t5" }] },
];
const panes = [
  { tab: "t1", cwd: "/home/u/code/app/src" }, { tab: "t2", cwd: "/home/u/code/tools" }, { tab: "t3", cwd: null },
  { tab: "t4", cwd: "/home/u/code/app" }, { tab: "t5", cwd: "/home/u/code/app" },
];
test("normPath / inside", () => {
  assert.equal(normPath("~/code/app/", home), "/home/u/code/app");
  assert.equal(normPath("C:\\x\\y", home), "C:/x/y");
  assert.equal(inside("/a/b/c", "/a/b"), true);
  assert.equal(inside("/a/bc", "/a/b"), false);
});
test("resolveFolder: remembered beats mapped; unknown project is null", () => {
  const o = { remembered: { "ABC-1": "/home/u/code/other" }, projects: { ABC: "~/code/app" }, home };
  assert.deepEqual(resolveFolder({ key: "ABC-1", project: "ABC" }, o), { folder: "/home/u/code/other", source: "remembered" });
  assert.deepEqual(resolveFolder({ key: "ABC-2", project: "ABC" }, o), { folder: "/home/u/code/app", source: "mapped" });
  assert.equal(resolveFolder({ key: "XYZ-1", project: "XYZ" }, o), null);
});
test("suggestFolder: own, then the parent's remembered, then mapped", () => {
  const o = { remembered: { "ABC-1": "/p" }, projects: { ABC: "/m" }, home };
  assert.equal(suggestFolder({ key: "ABC-2", project: "ABC", parent: { key: "ABC-1" } }, o), "/p");
  assert.equal(suggestFolder({ key: "ABC-3", project: "ABC", parent: null }, o), "/m");
});
test("spaceFor: a live terminal in the repo counts; the shown space wins; other machines never", () => {
  assert.equal(spaceFor("/home/u/code/app", { spaces, panes, shownSpace: null, home }).id, "s1");
  assert.equal(spaceFor("/home/u/code/app", { spaces, panes, shownSpace: "s3", home }).id, "s3");
  assert.equal(spaceFor("/home/u/code/none", { spaces, panes, shownSpace: null, home }), null);
});
test("pickerRows: distinct folders, home left out, mapped first", () => {
  const rows = pickerRows({ spaces, panes, home, mapped: "/home/u/code/zed" });
  // Mapped first (added though no space is in it); the rest by label: app, code, src, tools. s4 is another machine.
  assert.deepEqual(rows.map((r) => r.folder), ["/home/u/code/zed", "/home/u/code/app", "/home/u/code", "/home/u/code/app/src", "/home/u/code/tools"]);
  assert.deepEqual(rows[0].spaces, []);
  assert.ok(!rows.some((r) => r.folder === "/home/u"));
  assert.ok(rows.find((r) => r.folder === "/home/u/code/app").spaces.includes("app"));
  assert.equal(rows.find((r) => r.folder === "/home/u/code/tools").path, "~/code/tools");
});
test("remember: newest last, capped", () => {
  const m = remember(remember({ a: "/1", b: "/2" }, "a", "/3"), "c", "/4", 2);
  assert.deepEqual(m, { a: "/3", c: "/4" });
});
test("openCommand: a tab in the space with the folder given, else a new space", () => {
  assert.deepEqual(openCommand({ folder: "/home/u/code/app", space: { id: "s1" }, name: "ABC-1", task: "go" }),
    { command: "tab.new", args: { space: "s1", folder: "/home/u/code/app", name: "ABC-1", argv: ["claude"], task: "go" } });
  assert.deepEqual(openCommand({ folder: "/home/u/code/app", space: null, name: "ABC-1", task: "go" }),
    { command: "space.new", args: { name: "app", folder: "/home/u/code/app", tab: "ABC-1", argv: ["claude"], task: "go" } });
});
test("parseProjects", () => {
  assert.deepEqual(parseProjects({ ABC: " ~/code/app ", BAD: 3 }), { projects: { ABC: "~/code/app" }, warnings: ["projects.BAD: must be a folder path"] });
  assert.deepEqual(parseProjects("x").warnings, ["projects: not a map of project key to folder"]);
  assert.deepEqual(parseProjects(undefined), { projects: {}, warnings: [] });
});
```

  In `tests/jira-settings.test.mjs`: `jiraOptions({ projects: { ABC: "~/x" } }).projects` is `{ ABC: "~/x" }`; a bad entry adds its warning and the good ones stay.
- [ ] **Step 2:** `node --test tests/jira-start-in.test.mjs tests/jira-settings.test.mjs` → FAIL.
- [ ] **Step 3: Implement** (start-in.js imports nothing from the host).
- [ ] **Step 4:** `npm test` → PASS. **Step 5:** `npm run build:app`, commit `feat(jira): where a ticket's work starts (pure) and the projects setting`.

### Task 2: The page: resolve, pick, remember, open

**Files:**
- Modify: `src/mods/dock-jira/main.js` (`startWork` ~1129, `finishWork` ~1148, the detail's Start button ~1677, the row's start icon, `command` ~191), a new `src/mods/dock-jira/start-picker.js` for the picker's drawing (like `tabs.js`), `README.md` (Jira: `projects`, the picker, Remember, Start in…), `app/RECIPE.md` if it lists the Jira settings
- Test: pure helpers added here get tests in `tests/jira-start-in.test.mjs`

**Interfaces:**
- Consumes: everything from Task 1; Herdr `spaces()`, `panes()`, `focused()`, `pickFolder({ prompt })`, `shared` / `setShared`, `run`, `exec`; the existing `startWork(issue, template)` / `finishWork(issue, rules)` (page.js) for the task text and name; `showTerminal()`.
- Folder-exists and home: one `exec` of node per Start (the pattern of `probeCommand` / `parseProbe` in `src/mods/dock-config/browser-view.js`: it prints `HOME`/`USERPROFILE` and which paths exist); a failed probe counts as "doesn't exist" (→ the picker).

- [ ] **Step 1:** Start and Finish: compute the task as today, then `resolveFolder`; if it resolves and the folder exists → `openCommand({ folder, space: spaceFor(...), name, task })`, `run`, `showTerminal()`; else open the picker for that action. Finish's tab name stays `<key> finish`.
- [ ] **Step 2: The picker** (`start-picker.js`, drawn over the page like the status menu): title "Start <key> in…" (Finish: "Finish <key> in…"); rows from `pickerRows` (label, dim path, the spaces it's in), preselected `suggestFolder`; then **Here** (the focused terminal's `cwd`) and **Other folder…** (`pickFolder({ prompt: "Start here" })`; cancel returns to the picker); a **Remember for this ticket** checkbox (off); arrows move, Enter picks, Escape or a click outside closes without starting or remembering.
- [ ] **Step 3: Remember:** on a pick with the box ticked, `setShared("dock.jira.startIn", remember(shared("dock.jira.startIn") ?? {}, key, folder))`.
- [ ] **Step 4: Start in…:** a small ▾ button beside the detail's **Start work** (tooltip "Start in another folder…") and a `start-in` page command: always the picker for Start; a pick with Remember replaces the remembered folder, without it the remembered folder stays.
- [ ] **Step 5:** README (and RECIPE if relevant): `projects` with a neutral example, the order (remembered → mapped → picker), Remember, Start in…, and that Finish follows the same choice.
- [ ] **Step 6:** `npm test`, `npm run build:app`, `herdr-app check app/mods/dock-jira` → pass. Commit `feat(jira): Start work opens in the ticket's repo, with a picker and Start in…`.

### After the tasks (controller, with the user's yes)

- [ ] Add the user's `projects` map (`CLDACC00` → `~/Dev/Workspace/account-center-mf`, plus the one-repo projects they confirm), deploy with `--no-statusline`, and picture the picker.
