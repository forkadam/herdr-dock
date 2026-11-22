# Bottom bar and notification history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A quiet bottom bar (where · attention · warnings · CPU/RAM) and a notification history in the right panel that keeps every toast until cleared.

**Architecture:** dock-core is the single writer of the history (`dock.notify.history`) and of the system sample (`dock.system.sample`). Other mods send it `dock-core.notify.*` commands with arguments base64url-encoded in the command name, the way `git.*` commands work today (`src/shared/gitcmd.js`). A replacement toast mod (`dock-toast`, named by the layout root) reports every notification to dock-core before showing it. Pure logic lives in `src/shared/notify.js` and `src/shared/system.js` and is unit-tested. The mods only render and send commands.

**Tech Stack:** Herdr mods (gpui-kit / gpui-base / herdr), esbuild bundle via `scripts/build.mjs`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-22-bottom-bar-design.md`

## Global Constraints

- Bar order (default): `dock-where`, `dock-attention`, `dock-warnings`, `dock-system`; dock-system at the right edge.
- History: newest first, capped at **200** items (drop oldest cleared-or-resolved first, then oldest overall); items stay until cleared; opening the history marks all read.
- `need you` = items with `needs` and not `resolved`; `unread` = `read: false` items not counted in `need you`.
- Warnings: `⟳ N` counts pipelines with status `running` only; quota at **≥ 90%** (dock-quotas `barLevel` "high"); disk under **10%** free.
- System sample every **5 s**, this PC only; CPU/RAM text turns the warning colour (`#d29922`, as dock-git `WARN`) at **≥ 90%**.
- Notification history is in the right panel: shared default and this PC's override `machines.forkadam-pc.regions.right.features`; bell icon on the rail; dialog fallback where not placed.
- New mods are named `dock-*` (the build only picks those up), `mod.json` `place: "none"`; overlay-only mods also `overlay: true`.
- The replacement toast must look and behave like Herdr's shipped `~/.config/herdr-app/mods/toast/main.js`, including the machine-login Copy button.
- `config/dock.json` has the user's uncommitted per-PC section: commit only the base hunk (build a patch of the base change against `HEAD` and `git apply --cached` it); never commit `machines.*`.

## Review Focus

- Two toasts arriving within the same moment: both must be in the history (single writer in dock-core; pinned by the Task 2 test `applyNotifyCommand: two adds in a row keep both`).
- A history item whose agent pane no longer exists (agent closed): it counts as resolved, not "needs you" forever (Task 1 test `resolveItems: a needs-agent item whose pane is gone is resolved`).
- Corrupt or non-array `dock.notify.history` (hand-edited or from an older build): treated as empty, never throws (Task 1 test `historyOf: junk becomes []`).
- Clearing an item while a new toast is being added: the new one survives (commands are applied in order to the latest list; Task 2 test `applyNotifyCommand: clear then add keeps the new item`).
- The sample command failing (no node on PATH, timeout): the bar shows nothing for CPU/RAM and no disk warning, never stale numbers forever (Task 3 test `parseSample: bad output is null`; dock-system hides values older than 30 s).

---

### Task 1: Pure notification model

**Files:**
- Create: `src/shared/notify.js`
- Test: `tests/notify.test.mjs`

**Interfaces:**
- Consumes: `parseGitCommand(c)` from `src/shared/gitcmd.js` (to read a pipeline alert's worktree from its action name `dock-core.git.show.<b64>`).
- Produces:
  - `HISTORY_KEY = "dock.notify.history"`, `CAP = 200`
  - `historyOf(raw) -> Item[]` (junk → `[]`)
  - `Item = { id: string, at: number, title: string, body: string|null, level: string|null, icon: string|null, action: {name, args?}|null, read: boolean, needs: Needs|null, resolved: boolean }`
  - `Needs = { kind: "pipeline", worktree: string } | { kind: "agent", pane: string }`
  - `needsOf(n) -> Needs|null` from a notification's props `{ title, body, level, action }`
  - `addItem(list, n, now, id) -> Item[]` (prepends, applies the cap)
  - `clearItem(list, id) -> Item[]`, `clearAll() -> []`, `markAllRead(list) -> Item[]`
  - `resolveItems(list, { agents, gitState }) -> Item[]` (same array reference when nothing changed)
  - `counts(list) -> { needYou: number, unread: number }`

- [ ] **Step 1: Find the shape of Herdr's agent toasts**

  Herdr's own "agent needs you" toast props are not documented beyond `{title, body, level, icon, action, timeout, overlay}`. Temporarily point the herdr-dock layout root at a throwaway mod that writes `JSON.stringify(props())` to `~/.config/herdr-app/dock-toast-sample.json`, make an agent block while another space is focused, and read the file. Write the observed `action.name` / `action.args` (the pane or terminal id field) into a comment at the top of `notify.js`. Remove the throwaway mod and restore the layout.

- [ ] **Step 2: Write the failing tests** in `tests/notify.test.mjs`

```js
test("historyOf: junk becomes []", () => {
  for (const raw of [undefined, null, 5, "x", { a: 1 }]) assert.deepEqual(historyOf(raw), []);
  assert.deepEqual(historyOf([{ id: "a", at: 1, title: "t" }, 7, null]).map((i) => i.id), ["a"]);
});
test("needsOf: a pipeline alert names its worktree; an agent toast its pane; others null", () => {
  const name = `dock-core.${gitCommandName("git.show", { worktree: "|d:/r/api" })}`;
  assert.deepEqual(needsOf({ title: "Pipeline failed", level: "error", action: { name } }), { kind: "pipeline", worktree: "|d:/r/api" });
  assert.deepEqual(needsOf(AGENT_TOAST /* the props observed in Step 1 */), { kind: "agent", pane: AGENT_TOAST_PANE });
  assert.equal(needsOf({ title: "Saved", level: "info" }), null);
});
test("addItem: newest first, unread, unresolved; cap 200 drops cleared-or-resolved oldest first", () => {
  let l = [];
  for (let i = 0; i < 200; i++) l = addItem(l, { title: `n${i}` }, i, `id${i}`);
  l = resolveItems(l.map((x) => (x.id === "id150" ? { ...x, needs: { kind: "agent", pane: "gone" } } : x)), { agents: [], gitState: null });
  l = addItem(l, { title: "new" }, 999, "idnew");
  assert.equal(l.length, 200); assert.equal(l[0].id, "idnew"); assert.equal(l[0].read, false);
  assert.equal(l.some((x) => x.id === "id150"), false); // the resolved one went first
  assert.equal(l.some((x) => x.id === "id0"), true);
});
test("resolveItems: a needs-agent item resolves when its agent isn't blocked", () => { /* agents [{pane:"p1",status:"working"}] → resolved true; status "blocked" → false */ });
test("resolveItems: a needs-agent item whose pane is gone is resolved", () => { /* agents [] → resolved true */ });
test("resolveItems: a needs-pipeline item resolves when that worktree's pipeline isn't failed", () => {
  /* gitState { repos:[{ worktrees:[{ id:"|d:/r/api", pipeline:{ status:"passed" } }] }] } → resolved; status "failed" → not;
     worktree missing from state → resolved stays false (unknown is not fixed) */
});
test("counts: need you excludes resolved; unread excludes need-you items", () => {
  /* [ {needs, resolved:false, read:false}, {needs, resolved:true, read:false}, {needs:null, read:false}, {needs:null, read:true} ]
     → { needYou: 1, unread: 2 } */
});
test("clearItem / clearAll / markAllRead", () => { /* clearItem removes only that id; clearAll → []; markAllRead sets read on all */ });
```

- [ ] **Step 3: Run** `node --test tests/notify.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement `src/shared/notify.js`** with the interfaces above (pure, no host imports). `needsOf` pipeline: `action.name` starts with `dock-core.`, `parseGitCommand(rest)` gives `{cmd:"show", worktree}` with a worktree. `needsOf` agent: per Step 1.
- [ ] **Step 5: Run** `node --test tests/notify.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(notify): history model — add, cap, resolve, counts`.

### Task 2: dock-core owns the history (commands, resolve, reveal)

**Files:**
- Create: `src/shared/notifycmd.js`
- Modify: `src/shared/gitcmd.js` (export a generalised `revealPlan(merged, mod, dialog)`; `showPlan(merged)` becomes `revealPlan(merged, "dock-pipelines", DIALOG)`)
- Modify: `src/mods/dock-core/main.js` (route `notify.*` commands next to `gitCommand(c)`; run `resolveItems` every tick)
- Create: `src/mods/_notify-command.js` (like `_git-command.js`)
- Test: `tests/notifycmd.test.mjs`, `tests/core-git.test.mjs` (revealPlan)

**Interfaces:**
- Consumes: Task 1 functions; `b64urlEncode`/`b64urlDecode` from `gitcmd.js`.
- Produces:
  - `notifyCommandName(name, args) -> string` for `"notify.add"` `{ n: {title, body, level, icon, action} }` (JSON, base64url), `"notify.clear"` `{ id }`, `"notify.clearall"`, `"notify.read"`, `"notify.show"`; throws on bad args.
  - `parseNotifyCommand(c) -> { cmd: "add", n } | { cmd: "clear", id } | { cmd: "clearall" } | { cmd: "read" } | { cmd: "show" } | null`
  - `applyNotifyCommand(list, cmd, now, newId) -> Item[]` (pure: add/clear/clearall/read; `show` returns `list` unchanged)
  - `notifyCommand(name, args)` in `src/mods/_notify-command.js`: `run("dock-core." + notifyCommandName(name, args))`
  - `revealPlan(merged, mod, dialog) -> { set } | { overlay }`
  - Notifications dialog spec: `{ mod: "dock-notifications", kind: "dialog", width: 520, height: 0.7 }`

- [ ] **Step 1: Write the failing tests**

```js
test("notify commands round-trip, including unicode in the toast", () => {
  const n = { title: "Pipeline failed ✕", body: "api · main", level: "error", action: { name: "dock-core.git.show.abc" } };
  assert.deepEqual(parseNotifyCommand(notifyCommandName("notify.add", { n })), { cmd: "add", n });
  assert.deepEqual(parseNotifyCommand(notifyCommandName("notify.clear", { id: "k1" })), { cmd: "clear", id: "k1" });
  for (const c of ["clearall", "read", "show"]) assert.deepEqual(parseNotifyCommand(`notify.${c}`), { cmd: c });
  assert.equal(parseNotifyCommand("notify.add.!!"), null); assert.equal(parseNotifyCommand("git.refresh"), null);
  assert.throws(() => notifyCommandName("notify.clear", {}));
});
test("applyNotifyCommand: two adds in a row keep both", () => { /* add a then add b → [b, a] */ });
test("applyNotifyCommand: clear then add keeps the new item", () => { /* [a] clear a, add b → [b] */ });
test("revealPlan: right panel when placed, else the dialog", () => {
  const merged = { regions: { right: { features: [{ mod: "dock-notifications" }] } } };
  assert.deepEqual(revealPlan(merged, "dock-notifications", D), { set: { "dock.right.active": "dock-notifications", "dock.right.shown": true } });
  assert.deepEqual(revealPlan({ regions: { right: { features: [] } } }, "dock-notifications", D), { overlay: D });
});
```

- [ ] **Step 2: Run** `node --test tests/notifycmd.test.mjs tests/core-git.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `notifycmd.js` and `revealPlan`. Keep `showPlan` behaviour (its existing tests must still pass).
- [ ] **Step 4: Wire dock-core.** In the command loop, try `parseNotifyCommand(c)` after `gitCommand(c)`. For add/clear/clearall/read: `setShared(HISTORY_KEY, applyNotifyCommand(historyOf(shared(HISTORY_KEY)), cmd, Date.now(), <unique id>))`. For `show`: `markAllRead`, then apply `revealPlan(this.merged, "dock-notifications", NOTIFY_DIALOG)` like `git.show`. Each tick: `resolveItems(history, { agents: agents(), gitState: shared("dock.git.state") })` and write it only when the reference changed.
- [ ] **Step 5: Run** `npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(notify): dock-core keeps the history; notify.* commands`.

### Task 3: System sample

**Files:**
- Create: `src/shared/system.js`
- Modify: `src/mods/dock-core/main.js` (sample every 5 s, publish `dock.system.sample`)
- Test: `tests/system.test.mjs`

**Interfaces:**
- Produces:
  - `SAMPLE_KEY = "dock.system.sample"`
  - `sampleCommand() -> { command: "node", args: string[] }`. A `node -e` script printing one JSON line `{"cpu":<0-100>,"mem":<0-100>,"diskFree":<0-100>|null}`: CPU from `os.cpus()` times over 250 ms, memory `1 - freemem/totalmem`, disk via `fs.statfsSync(<system drive root on win32, else os.homedir()>)` `bavail/blocks`, `null` if statfs throws.
  - `parseSample(stdout, now) -> { cpu, mem, diskFree, at } | null` (numbers clamped 0–100, rounded; null on bad output)
  - `warningsFor({ sample, gitState, quotaTop, now }) -> Array<{ key: "pipelines"|"quota"|"disk", text: string, tip: string }>` in that order:
    - pipelines: count of worktrees with `pipeline.status === "running"`; text `⟳ N`
    - quota: `quotaTop.p >= 90` (and not stale); text `⚠ quota 92%`
    - disk: `sample.diskFree < 10` and sample younger than 30 s; text `⚠ disk 7%`

- [ ] **Step 1: Write the failing tests**

```js
test("parseSample: good line is clamped and rounded", () => {
  assert.deepEqual(parseSample('{"cpu":34.4,"mem":61.6,"diskFree":7.2}\n', 5), { cpu: 34, mem: 62, diskFree: 7, at: 5 });
  assert.deepEqual(parseSample('{"cpu":140,"mem":-3,"diskFree":null}', 1), { cpu: 100, mem: 0, diskFree: null, at: 1 });
});
test("parseSample: bad output is null", () => { for (const s of ["", "nope", "{}", '{"cpu":"x"}']) assert.equal(parseSample(s, 1), null); });
test("warningsFor: nothing on a normal day", () => {
  assert.deepEqual(warningsFor({ sample: { cpu: 5, mem: 40, diskFree: 50, at: 0 }, gitState: { repos: [] }, quotaTop: { p: 60 }, now: 1000 }), []);
});
test("warningsFor: running only (not pending), quota at 90, disk under 10, in order", () => {
  const gitState = { repos: [{ worktrees: [{ pipeline: { status: "running" } }, { pipeline: { status: "pending" } }] }] };
  const w = warningsFor({ sample: { diskFree: 7, at: 0 }, gitState, quotaTop: { p: 92 }, now: 1000 });
  assert.deepEqual(w.map((x) => x.text), ["⟳ 1", "⚠ quota 92%", "⚠ disk 7%"]);
  assert.deepEqual(warningsFor({ sample: { diskFree: 7, at: 0 }, gitState: null, quotaTop: { p: 89 }, now: 31000 }), []); // 89% quiet; sample 31 s old
});
test("sampleCommand prints a parseable line on this machine", async () => { /* execFileSync(cmd, args) → parseSample(...) not null */ });
```

- [ ] **Step 2: Run** `node --test tests/system.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `system.js`.
- [ ] **Step 4: Wire dock-core:** a 5 s loop beside the collector (`cx.spawn`, `cx.sleep(5000)`). It runs `exec(sampleCommand())` with `timeout: 4000` and publishes `parseSample` output only when non-null. Failures are logged once, not every 5 s.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(system): CPU, memory and disk sample in dock-core`.

### Task 4: dock-toast records every notification

**Files:**
- Create: `src/mods/dock-toast/{main.js,mod.json,manifest.json,icon.svg}`
- Modify: `src/shared/layout.js` (root gets `toast: "dock-toast"`)
- Modify: `tests/build.test.mjs:112` (expected mod list), the layout test that checks the root
- Test: `tests/layout.test.mjs` (or wherever `buildLayout` is tested)

**Interfaces:**
- Consumes: `notifyCommand("notify.add", { n })` (Task 2).
- Produces: nothing used by other tasks.

- [ ] **Step 1: Failing test:** `buildLayout(...)` root has `toast === "dock-toast"`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.** `mod.json` `{ "place": "none", "overlay": true, "title": "Notifications toast" }`; manifest `regions: []`. `main.js` is a copy of the shipped toast's behaviour. In `init`, send `notify.add` once with `{ title, body, level, icon, action }` from `props()`.
- [ ] **Step 4: Run** `npm test`, then `npm run deploy`. Check by hand: `herdr-app do` a notification (or trigger a pipeline alert). It shows as a toast and appears in `dock.notify.history` in `shared.json`.
- [ ] **Step 5: Commit** `feat(toast): dock-toast records every notification`.

### Task 5: Notification history panel

**Files:**
- Create: `src/mods/dock-notifications/{main.js,view.js,mod.json,manifest.json,icon.svg}` (icon: a bell)
- Modify: `src/shared/config.js:19` DEFAULT_CONFIG right features → `dock-pipelines, dock-notifications, dock-files, dock-changes`
- Modify: `config/dock.json` base right features (same) and this PC's override `machines.forkadam-pc.regions.right.features` → `mission-control-github, dock-notifications, dock-files, dock-changes` (override stays uncommitted)
- Modify: `tests/build.test.mjs:112`, the config default test if it lists right features
- Test: `tests/notifications-view.test.mjs`

**Interfaces:**
- Consumes: `historyOf`, `HISTORY_KEY` (Task 1); `notifyCommand` (Task 2).
- Produces: `notificationRows(list, now) -> Array<{ id, title, body, level, when: string, needs: boolean, resolved: boolean, read: boolean, hasAction: boolean }>` in `view.js` (`when`: `just now`, `5m`, `2h`, `3d`; reuse `formatAge` from `src/shared/claude.js` if it fits).

- [ ] **Step 1: Failing test** for `notificationRows`: order kept, `when` text for 30 s / 5 min / 2 h, `needs`/`resolved` flags, empty list → `[]`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `view.js`, then `main.js`:
  - Header "Notifications" with **Clear all** (`notify.clearall`), disabled when empty.
  - Rows: level dot, title, body (truncated, full text on hover), time on the right. "Needs you" rows have a red edge; resolved ones show `✓ resolved` in green. **✕** sends `notify.clear`. Clicking a row with an action `run(action.name, action.args ?? {})`.
  - Empty state: `No notifications`.
  - When the mod becomes visible (right panel active on it, or as a dialog), send `notify.read`.
- [ ] **Step 4: Run** `npm test`; `npm run deploy`. Check by hand: the bell shows on the right rail; the list shows the Task 4 items; ✕ and Clear all work.
- [ ] **Step 5: Commit** (stage the `config/dock.json` base hunk only, see Global Constraints) `feat(notifications): history panel in the right panel`.

### Task 6: Bottom bar items

**Files:**
- Create: `src/mods/dock-where/`, `src/mods/dock-attention/`, `src/mods/dock-warnings/`, `src/mods/dock-system/` (each `main.js`, `mod.json`, `manifest.json` with `regions: ["bottom"]`, `icon.svg`)
- Modify: `src/mods/dock-quotas/main.js` (publish `dock.quotas.top = { p, stale }` from `iconBadge` whenever its readings change, `null` when none)
- Modify: `src/shared/config.js:20` and `config/dock.json` base bottom features → `[{ mod: "dock-where", size: 240 }, { mod: "dock-attention", size: 190 }, { mod: "dock-warnings", size: 230 }, { mod: "dock-system" }]`
- Modify: `tests/build.test.mjs:112`, config default tests
- Test: `tests/system.test.mjs` already covers warnings; add `tests/bar.test.mjs` for `attentionText`

**Interfaces:**
- Consumes: `counts` (Task 1), `notifyCommand("notify.show")` (Task 2), `warningsFor`, `SAMPLE_KEY` (Task 3).
- Produces: `attentionText({ needYou, unread }) -> Array<{ text, tone: "bad"|"dim" }>` in `src/mods/dock-attention/view.js`: `[{text:"⚠ 2 need you",tone:"bad"},{text:"3 unread",tone:"dim"}]`, parts at zero omitted, both zero → `[{ text: "No notifications", tone: "dim" }]`.

- [ ] **Step 1: Failing test** for `attentionText` (the three cases above).
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement the four mods.** All share the bar style of Herdr's `workspace-status`: `bg(t.chrome)`, `border_t(1)`, text 11.8 px, `t.muted`, `px(14)`.
  - **dock-where:** `spaces().find(s => s.active)`; machine label (`server` icon + name, else `monitor` + "This computer") and branch label (`mods/workspace-chrome/*.svg` icons, as in workspace-status).
  - **dock-attention:** `counts(historyOf(shared(HISTORY_KEY)))` → `attentionText`; the whole item clickable → `notifyCommand("notify.show")`; tooltip "Open notifications".
  - **dock-warnings:** `warningsFor({ sample: shared(SAMPLE_KEY), gitState: shared("dock.git.state"), quotaTop: shared("dock.quotas.top"), now })`. Each warning has its `tip` as a tooltip. Pipelines → `gitCommand("git.show")`; quota → `requestFocus("dock-quotas")`.
  - **dock-system:** right-aligned `CPU 34%  RAM 61%` from `shared(SAMPLE_KEY)`, hidden when missing or older than 30 s; each value in `#d29922` at ≥ 90.
  - Herdr's `workspace-status` leaves the default bottom region and stays placeable.
- [ ] **Step 4: Run** `npm test`; `npm run deploy`; `herdr-app status` shows no errors. Check by hand: the bar reads left to right as in the spec. A test notification raises `1 unread`, and clicking it opens the history and clears the count. CPU and RAM update.
- [ ] **Step 5: Commit** (base hunk of `config/dock.json` only) `feat(bar): where, attention, warnings and system in the bottom bar`.

### Task 7: README and end-to-end check

**Files:**
- Modify: `README.md` (new "Bottom bar" and "Notifications" sections; the shared keys `dock.notify.history`, `dock.system.sample`, `dock.quotas.top`; reorder via the Dock layout dialog)

- [ ] **Step 1: Write the README sections.**
- [ ] **Step 2: End-to-end in Herdr:**
  - Make a pipeline fail, or post a notification whose action is a `git.show`. Expect `⚠ 1 need you`.
  - Fix it. Expect `✓ resolved`, and the red count drops while the item stays.
  - Clear it with ✕.
  - Reorder a bar item with the Dock layout dialog's ↑ ↓.
- [ ] **Step 3: Run** `npm test`. Expected: all pass.
- [ ] **Step 4: Commit** `docs(readme): bottom bar and notifications`.
