# Diagram Hints Setup for the Herdr-way Install — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Herdr-way install sets up the diagram-hint hooks and tells the person; the Render panel offers **Set up** when they're missing.

**Architecture:** `setupHints` gets a command line, bundled as `mods/dock-render/herdr-hints-setup.mjs`; `app/RECIPE.md` runs it; the Render panel checks `~/.claude/settings.json` with `hintsPlan` and shows a one-line row (text and action from a pure `hintsNotice` in `view.js`).

**Tech Stack:** JavaScript (ESM), gpui-kit mod UI, esbuild, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-render-hints-setup-design.md`

## Global Constraints

- One way of editing settings.json: `setupHints` / `hintsPlan` (backup `settings.json.bak-herdr-dock`), never a second.
- Command line: `node herdr-hints-setup.mjs [--check] [--script <path>]`; Claude folder from `DOCK_CLAUDE_HOME`, else `~/.claude`; prints `<state>: <message>`; exit 1 for `invalid` or a thrown error, else 0.
- Row texts exactly: `Diagram hints for Claude aren't set up` (Set up), `Diagram hints point at another install` (Set up), `~/.claude/settings.json can't be read: diagram hints aren't set up` (no button), `Set up failed: <error>` (Set up); nothing when present, without Claude Code, or dismissed.
- Dismissed for good with **×**: shared key `dock.render.hintsDismissed` = `true`.
- `app/` is generated (`npm run build:app`); `app/RECIPE.md` is hand-written and kept by the build. Known baseline failure: `tests/dock-core-class.test.mjs`.

## Review Focus

- `--check` on a settings.json without the hooks: says what it would do and writes nothing (Task 1 test).
- The panel on a machine without Claude Code: no row (Task 2 test "hintsNotice: …").
- A Set up that fails (unreadable settings): the row says why and keeps **Set up** (Task 2 test).
- A person who dismissed the row: it never comes back, even when the hooks are missing (Task 2 test).
- The installed path differs from the one in settings.json (app home moved): the row offers to point them back (Task 2 test).

---

### Task 1: The setup command

**Files:**
- Modify: `src/app/hints-setup.js` (add the command line)
- Modify: `scripts/build.mjs` (bundle it into `mods/dock-render/herdr-hints-setup.mjs`)
- Test: `tests/render-hints.test.mjs`

**Interfaces:**
- Consumes: `setupHints` (existing).
- Produces: `node <app home>/mods/dock-render/herdr-hints-setup.mjs [--check] [--script <path>]` → stdout `<state>: <message>`, exit as in Global Constraints.

- [ ] **Step 1: Write the failing tests** (appended to `tests/render-hints.test.mjs`)

```js
const SETUP_JS = join(import.meta.dirname, "..", "src", "app", "hints-setup.js");
const setupCli = (args, claude) => spawnSync(process.execPath, [SETUP_JS, ...args], { encoding: "utf8", env: { ...process.env, DOCK_CLAUDE_HOME: claude } });

test("the setup command: adds the hooks; --check says what it would do and writes nothing; invalid exits 1", () => {
  const claude = mkdtempSync(join(tmpdir(), "hint-claude-"));
  try {
    writeFileSync(join(claude, "settings.json"), "{}");
    const check = setupCli(["--check", "--script", "/x/herdr-hint.mjs"], claude);
    assert.equal(check.status, 0);
    assert.match(check.stdout, /^added: would add/);
    assert.equal(readFileSync(join(claude, "settings.json"), "utf8"), "{}");
    const r = setupCli(["--script", "/x/herdr-hint.mjs"], claude);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^added: /);
    assert.equal(JSON.parse(readFileSync(join(claude, "settings.json"), "utf8")).hooks.SessionStart[0].hooks[0].command, 'node "/x/herdr-hint.mjs" session');
    assert.match(setupCli(["--script", "/x/herdr-hint.mjs"], claude).stdout, /^present: /);
    writeFileSync(join(claude, "settings.json"), "{ nope");
    assert.equal(setupCli(["--script", "/x/herdr-hint.mjs"], claude).status, 1);
  } finally { rmSync(claude, { recursive: true, force: true }); }
});
```

(add `readFileSync` to the file's `node:fs` import.)

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/render-hints.test.mjs`
Expected: FAIL (the module runs nothing: empty stdout).

- [ ] **Step 3: Add `main(argv)` to `hints-setup.js`**, run only when it is the entry (`process.argv[1]` resolves to this file, as `statusline-setup.js` does); `--script` defaults to `herdr-hint.mjs` beside the file; `console.log(\`${r.state}: ${r.message}\`)`. In `scripts/build.mjs`'s `dock-render` block, bundle `src/app/hints-setup.js` to `herdr-hints-setup.mjs` beside `herdr-hint.mjs`.

- [ ] **Step 4: Run the tests and the build**

Run: `node --test tests/render-hints.test.mjs && npm run build:app >/dev/null && DOCK_CLAUDE_HOME=/tmp/none-$$ node app/mods/dock-render/herdr-hints-setup.mjs --check`
Expected: tests pass; the built command prints `no-claude: no /tmp/none-…: Claude Code isn't set up here; nothing to do`.

- [ ] **Step 5: Commit**

```bash
git add src/app/hints-setup.js scripts/build.mjs tests/render-hints.test.mjs app
git commit -m "feat(render): herdr-hints-setup.mjs — set up the diagram-hint hooks without deploy"
```

### Task 2: The Render panel's row

**Files:**
- Modify: `src/shared/render/view.js` (add `hintsNotice`)
- Modify: `src/mods/dock-render/main.js` (check, row, Set up, ×)
- Test: `tests/render-view.test.mjs`

**Interfaces:**
- Consumes: `hintsPlan` (`src/shared/render/hints.js`); `listDirCommand` (`src/shared/platform.js`); the Task 1 command.
- Produces: `hintsNotice(state: "present" | "missing" | "moved" | "invalid" | "no-claude" | null, { dismissed: boolean, error: string | null }): { text: string, action: "setup" | null } | null` in `view.js`.

- [ ] **Step 1: Write the failing test** (appended to `tests/render-view.test.mjs`, importing `hintsNotice`)

```js
test("hintsNotice: missing or moved offers Set up; unreadable says so; present, no Claude Code or dismissed show nothing; a failure says why", () => {
  const n = (state, o = {}) => hintsNotice(state, { dismissed: false, error: null, ...o });
  assert.deepEqual(n("missing"), { text: "Diagram hints for Claude aren't set up", action: "setup" });
  assert.deepEqual(n("moved"), { text: "Diagram hints point at another install", action: "setup" });
  assert.deepEqual(n("invalid"), { text: "~/.claude/settings.json can't be read: diagram hints aren't set up", action: null });
  for (const s of ["present", "no-claude", null]) assert.equal(n(s), null, String(s));
  assert.equal(n("missing", { dismissed: true }), null);
  assert.deepEqual(n("missing", { error: "Cannot write" }), { text: "Set up failed: Cannot write", action: "setup" });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/render-view.test.mjs`
Expected: FAIL (`hintsNotice` is not exported).

- [ ] **Step 3: Implement `hintsNotice`** in `view.js`, then the panel in `main.js`:
  - state `this.hints = { state: null, busy: false, error: null, checked: false }`;
  - `checkHints(cx)`: `readTextFile(\`${home}/.claude/settings.json\`)`; on no file, `listDirCommand(window()?.platform, \`${home}/.claude\`)` through `exec` decides `missing` vs `no-claude`; else `hintsPlan(text, <app home>/mods/dock-render/herdr-hint.mjs).state` (`present` / `missing` / `moved` / `invalid`); run once when the panel is first shown (from `render` via `follow`'s shown check), not while `checking()` or zoomed;
  - `runHintsSetup(cx)`: `exec("node", [<app home>/mods/dock-render/herdr-hints-setup.mjs], { timeout: 30000 })`; non-zero → `error` = first line of stderr or stdout; then `checkHints` again;
  - `hintsRow(t)` under the header when `hintsNotice(...)` isn't null: a 12 px muted line (error in `t.blocked`), a **Set up** button (as Quotas draws it) when `action === "setup"` and not busy, and a 13 px **×** (`mods/workspace-chrome/x.svg`) that sets shared `dock.render.hintsDismissed` to `true`.

- [ ] **Step 4: Run the tests, build and check**

Run: `node --test tests/render-view.test.mjs && npm run build:app >/dev/null && herdr-app check app/mods/dock-render`
Expected: tests pass; `check passed: app/mods/dock-render`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/render/view.js src/mods/dock-render/main.js tests/render-view.test.mjs app
git commit -m "feat(render): the panel offers Set up when the diagram-hint hooks are missing"
```

### Task 3: The recipe and the README

**Files:**
- Modify: `app/RECIPE.md` (hand-written; kept by the build)
- Modify: `README.md` ("Install the Herdr way" and the Render section's Diagram hints bullet)

- [ ] **Step 1: RECIPE.md**, four edits:
  - **Tell the person before adding:** "… and it adds two Claude Code hooks to `~/.claude/settings.json` that tell Claude what the Render panel draws: a note once per session and a one-line reminder (about 40 tokens) on each prompt, quiet outside Herdr and while prismantis's own diagram hints are on."
  - **After the status-line step**, a new bullet: run `node <app home>/mods/dock-render/herdr-hints-setup.mjs` and tell the person what it printed (it backs up settings.json first and keeps their own hooks; no `~/.claude`: nothing); if it didn't run, Render shows "Diagram hints for Claude aren't set up" with **Set up**.
  - **Files written outside the mod folders:** add "and its `hooks` (two `herdr-hint` entries, by `herdr-hints-setup.mjs`)" to the `~/.claude/settings.json` item.
  - **Done when:** "`~/.claude/settings.json` has `SessionStart` and `UserPromptSubmit` hooks running `herdr-hint.mjs`, unless the person has no Claude Code or chose not to."
  - The `dock-render` item in **Mods** adds: "ships `herdr-hint.mjs` (the hooks) and `herdr-hints-setup.mjs` (puts them in settings.json)".

- [ ] **Step 2: README**: under "Install the Herdr way" a **Diagram hints** bullet like the status line's (the install runs `mods/dock-render/herdr-hints-setup.mjs`; if it didn't, Render shows the row with **Set up**; **×** hides it for good); in the Render section's Diagram hints bullet, "deploy (or, for a Herdr-way install, the install or Render's **Set up**) adds two hooks".

- [ ] **Step 3: Check and test**

Run: `npm run build:app >/dev/null && git diff --stat app/RECIPE.md && node --test tests/build-app.test.mjs tests/render-hints.test.mjs tests/render-view.test.mjs`
Expected: RECIPE.md kept with the edits; tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/RECIPE.md README.md app
git commit -m "docs(render): the Herdr-way install sets up the diagram-hint hooks and tells the person"
```
