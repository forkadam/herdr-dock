# Spaces Lists Its Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spaces shows each space's agents as children, each named by its Claude Code peer name
with one-click copy. The Agents panel stops showing two rows that read "herdr-dock".

**Architecture:**
- **Shared helpers.** Pure helpers go in `src/shared/claude.js` (peer names) and a new
  `src/shared/agent-rows.js` (placement and labels). Drawing helpers moved out of dock-agents go in
  a new `src/mods/_agent.js`.
- **dock-spaces** reads peer names itself (`hc get` → pid → `~/.claude/sessions/<pid>.json`) every
  15 s, and draws agent rows under each space.
- **dock-agents** takes its space labels from `spaceTags`.

**Tech Stack:** Herdr mod JS (gpui-kit / gpui-base / `herdr`), bundled by esbuild (`npm run build`);
tests run with `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-26-spaces-agents-design.md`

## Global Constraints

- A peer name is shown only when its record passes `matchSession` for the pid and `created_ms` hc
  reports for that terminal. Never guess a name from the folder.
- No new git calls. The branch for Agents labels comes from `panes()[].branch`.
- Spaces adds no agent rows in the narrow rail (`narrow()`), in the icon face or in the collapsed
  face. Name lookups run only while agent rows are drawn, never under `checking()`.
- Name lookups run every 15 000 ms, plus a 1 000 ms check that starts one when
  `claudeKey(agents())` changes.
- Copy text: the pill reads `Copy`, and `Copied` after a click. The duplicate mark reads
  `same name`.
- `main` and `master` are never added as a branch tag.
- Pins, sub-agents, context %, sorting and priority order in dock-agents behave as before.

## Review Focus

1. **Claude restarted, or the session ended, in the same terminal.** After the next pass the row
   shows no name or the new one, never the old one: a pass replaces the names map, it doesn't
   merge into it. Task 2, test `a name pass replaces the names`.
2. **One agent's `hc get` or record read throws** (a busy machine or a vanished file). The other
   agents keep their names. Task 1, test `a lookup that throws costs only that agent its name`.
3. **Agents on another machine (`vps/t7`) or not Claude Code (Codex).** They are never looked up
   with hc, and are labelled by pane, title, tab or program. Task 1 (`gets` assertion), Task 2
   (`rowLabel`).
4. **A tab named only by Herdr's automatic number ("2").** It's never used as a label. Task 2,
   `rowLabel` assertions.
5. **An agent whose space isn't drawn yet** (a space still loading, or a space removed between
   reads). It's left out, not tacked onto the end or under the wrong space. Task 2, `withAgents`
   assertion for `t4`.

---

### Task 1: Read peer names (shared, no UI change)

**Files:**
- Modify: `src/shared/claude.js`: add `sessionNameOf`, `readPeerNames`, and move in
  `isLocalClaude`, `sigOf`, `claudeKey`.
- Modify: `src/mods/dock-agents/main.js:21-25`: drop the local `isLocalClaude`, `sigOf`,
  `claudeKey`; import them, and call `claudeKey(agents())` where it called `claudeKey()`.
- Test: `tests/claude.test.mjs`.

**Interfaces:**
- **Produces:**
  - `isLocalClaude(a: {address, app, program}) -> boolean`: same rule as now; the address has no
    "/" and `app === "claude-code"` or `program.key === "claude"`.
  - `sigOf(a) -> string`: `` `${app ?? ""}|${program?.key ?? ""}|${pane}` ``.
  - `claudeKey(list: AgentInfo[]) -> string`: local Claude agents as `address=sig`, joined by ",".
  - `sessionNameOf(info: hcGetResult|null, recordText: string|null, nowMs: number) -> string|null`:
    the trimmed `name` of a record `matchSession` accepts for `identityOf(info)`, else null.
  - `readPeerNames(list: AgentInfo[], io: { get(address) -> Promise<hcGetResult|null>, readRecord(pid) -> Promise<string|null> }, nowMs) -> Promise<Map<address, { sig, pid, createdMs, name }>>`:
    - looks up only `isLocalClaude` agents;
    - an agent whose `get` or `readRecord` throws, or whose record proves no name, has no entry;
    - the rest still do.

- [ ] **Step 1: Commit the approved design and this plan**

```bash
git add docs/superpowers/specs/2026-11-26-spaces-agents-design.md docs/superpowers/plans/2026-11-26-spaces-agents.md
git commit -m "docs: design and plan — Spaces lists its agents by peer name; Agents labels same-named spaces by branch"
```

- [ ] **Step 2: Write the failing tests** (append to `tests/claude.test.mjs`, and add the new names
  to its import)

```js
const info = (o) => ({ foreground: { pid: 16604 }, created_ms: 999_000, ...o });
const claude = (address, o) => ({ address, app: "claude-code", program: { key: "claude" }, pane: "p" + address, ...o });
test("sessionNameOf reads the peer name from a record proven to be this process's", () => {
  assert.equal(sessionNameOf(info(), rec({ name: "amp-refine-ui-85" }), 2_000_000), "amp-refine-ui-85");
  assert.equal(sessionNameOf(info(), rec({ name: " api-7a " }), 2_000_000), "api-7a");
});
test("sessionNameOf: null unless the record is this process's and has a name", () => {
  assert.equal(sessionNameOf(info(), rec({ name: "x", pid: 1 }), 2_000_000), null);
  assert.equal(sessionNameOf(info(), rec({ name: "x", kind: "bg" }), 2_000_000), null);
  assert.equal(sessionNameOf(info(), rec({ name: "x", startedAt: 100 }), 2_000_000), null);
  assert.equal(sessionNameOf(info(), rec(), 2_000_000), null);
  assert.equal(sessionNameOf(info(), rec({ name: "  " }), 2_000_000), null);
  assert.equal(sessionNameOf(info(), rec({ name: 7 }), 2_000_000), null);
  assert.equal(sessionNameOf(info(), "{oops", 2_000_000), null);
  assert.equal(sessionNameOf(null, rec({ name: "x" }), 2_000_000), null);
});
test("readPeerNames: an entry per local Claude agent whose record proves its name", async () => {
  const gets = [];
  const io = {
    get: async (addr) => { gets.push(addr); return addr === "t1" ? info() : addr === "t2" ? info({ foreground: { pid: 5 } }) : null; },
    readRecord: async (pid) => (pid === 16604 ? rec({ name: "amp-refine-ui-85" }) : rec({ pid: 5, name: "other" })),
  };
  const codex = { address: "t9", app: "codex", program: { key: "codex" }, pane: "p9" };
  const m = await readPeerNames([claude("t1"), claude("t2"), claude("vps/t7"), codex], io, 2_000_000);
  assert.deepEqual(m.get("t1"), { sig: "claude-code|claude|pt1", pid: 16604, createdMs: 999_000, name: "amp-refine-ui-85" });
  assert.deepEqual([...m.keys()], ["t1", "t2"]);
  assert.deepEqual(gets, ["t1", "t2"]); // never asks hc about another machine's agent or a non-Claude one
});
test("readPeerNames: a lookup that throws costs only that agent its name", async () => {
  const io = { get: async (addr) => { if (addr === "t1") throw new Error("busy"); return info(); }, readRecord: async () => rec({ name: "kept" }) };
  const m = await readPeerNames([claude("t1"), claude("t2")], io, 2_000_000);
  assert.deepEqual([...m].map(([k, v]) => [k, v.name]), [["t2", "kept"]]);
});
test("isLocalClaude, sigOf and claudeKey keep the Agents panel's rules", () => {
  assert.equal(isLocalClaude(claude("t1")), true);
  assert.equal(isLocalClaude({ address: "t3", app: null, program: { key: "claude" }, pane: "p3" }), true);
  assert.equal(isLocalClaude(claude("vps/t7")), false);
  assert.equal(isLocalClaude({ address: "t9", app: "codex", program: { key: "codex" } }), false);
  assert.equal(sigOf(claude("t1")), "claude-code|claude|pt1");
  assert.equal(claudeKey([claude("t1"), claude("vps/t7")]), "t1=claude-code|claude|pt1");
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `node --test tests/claude.test.mjs`
Expected: FAIL. The import of `sessionNameOf` (and the other new names) doesn't resolve: "does not
provide an export named".

- [ ] **Step 4: Implement the five exports in `src/shared/claude.js`**
  - `sessionNameOf` reuses `identityOf`, `matchSession` and `parseJson`.
  - `readPeerNames` awaits one agent at a time, as dock-agents' `readContext` does, with a
    try/catch per agent.
  - In dock-agents, delete the three local helpers, import them, and change both `claudeKey()`
    calls to `claudeKey(agents())`.

- [ ] **Step 5: Run the whole suite**

Run: `node --test`
Expected: PASS, with every existing test still passing.

- [ ] **Step 6: Commit**

```bash
git add src/shared/claude.js src/mods/dock-agents/main.js tests/claude.test.mjs
git commit -m "feat(spaces): read each local Claude agent's peer name from its proven session record"
```

---

### Task 2: Spaces draws its agents

**Files:**
- Create: `src/shared/agent-rows.js`: pure, with no herdr or gpui imports.
- Create: `src/mods/_agent.js`: the drawing helpers, moved out of dock-agents.
- Modify: `src/mods/dock-agents/main.js`:
  - the `clean` → `cleanTitle` import;
  - the `icon()` function → `agentIcon` import;
  - the body of the `status()` method → `return agentStatus(t, a, compact);`.
- Modify: `src/mods/dock-spaces/main.js`: name lookups, agent rows.
- Create: `tests/fixtures/host-stubs.mjs`, `tests/agent-rows.test.mjs`,
  `tests/dock-spaces-class.test.mjs`.

**Interfaces:**
- **Consumes:** Task 1's `readPeerNames`, `isLocalClaude`, `sigOf`, `claudeKey`.
- **Produces (`src/shared/agent-rows.js`):**
  - `cleanTitle(s: string|null) -> string`: dock-agents' `clean`, moved verbatim.
  - `withAgents(rows: {w, tree}[], agents: {space}[]) -> (row | {w, agent, depth})[]`:
    - after each row come the agents whose `space === row.w.id`, in `agents` order;
    - `depth` is 1 under a top-level row (`tree` null) and 2 under a worktree row;
    - an agent row carries its space's `w`, so machine grouping and folding treat it with its space;
    - agents of spaces not in `rows` are left out.
  - `rowLabel(a, peerName: string|null) -> string`: the first non-empty of:
    - `peerName`;
    - `a.pane_name`;
    - `cleanTitle(a.title)`;
    - `a.tab_name`, unless it's all digits;
    - `a.program?.name`;
    - `a.address`.
  - `sharedNames(names: Iterable<string|null>) -> Set<string>`: the non-null names that appear
    twice or more.
- **Produces (`src/mods/_agent.js`, gpui):**
  - `agentIcon(program, size, color) -> element|null`: dock-agents' `icon`, moved.
  - `agentStatus(t, a, compact) -> element`: dock-agents' `status` body, moved.
- **Produces (`tests/fixtures/host-stubs.mjs`):**
  - importing it registers `node:module` hooks that stub `gpui-kit`, `gpui-base` and `herdr`, as
    `tests/dock-core-class.test.mjs` does (that file stays as it is);
  - every element call chains; `ScrollHandle.new()` gives an object with `scroll_to_item()`;
  - it sets a `globalThis.localStorage` stub backed by a Map;
  - the herdr stub reads mutable `data`: `spaces`, `agents`, `panes`, `layout`, `shared` (Map),
    `files` (Map path→text), `hc(args)` returning `{code, stdout, stderr}`, and `checking`.
    `home()` returns `"C:/home"` and `props()` returns `{ dockRegion: "left" }`.
  - It exports every name dock-spaces, dock-agents, `_feature.js` and `_page.js` import from
    `herdr`, including `machines`, `exec`, `watchFolder`, `window`, `terminals`, `focused`,
    `setAgentOrder` and `openOverlay`. gpui-kit gets `image` too.
  - Task 3 reuses it.

- [ ] **Step 1: Write the failing pure tests** in `tests/agent-rows.test.mjs`

```js
const row = (id, tree = null) => ({ w: { id, machine: null }, tree });
const ag = (address, space) => ({ address, space });
test("withAgents puts a space's agents right after its row, in order; a worktree's one step deeper", () => {
  const rows = [row("A"), row("Aw", "└─"), row("B")];
  const out = withAgents(rows, [ag("t1", "A"), ag("t2", "Aw"), ag("t3", "A"), ag("t4", "Z")]);
  assert.deepEqual(out.map((r) => (r.agent ? `${r.agent.address}@${r.depth}` : r.w.id)), ["A", "t1@1", "t3@1", "Aw", "t2@2", "B"]);
  assert.equal(out[1].w, rows[0].w);
});
test("rowLabel: the peer name, then pane name, title, a named tab, the program, the address", () => {
  const a = { address: "t5", pane_name: null, title: "✦  Fixing the build", tab_name: "2", program: { name: "Codex" } };
  assert.equal(rowLabel(a, "amp-refine-ui-85"), "amp-refine-ui-85");
  assert.equal(rowLabel({ ...a, pane_name: "api" }, null), "api");
  assert.equal(rowLabel(a, null), "Fixing the build");
  assert.equal(rowLabel({ ...a, title: "" }, null), "Codex");
  assert.equal(rowLabel({ ...a, title: "", tab_name: "deploy" }, null), "deploy");
  assert.equal(rowLabel({ address: "t5", title: "", tab_name: "", program: {} }, null), "t5");
});
test("sharedNames: only names two agents both have", () => {
  assert.deepEqual([...sharedNames(["account-center-mf-ff", "amp-refine-ui-85", "account-center-mf-ff", null, null])], ["account-center-mf-ff"]);
});
```

- [ ] **Step 2: Write the failing class tests** in `tests/dock-spaces-class.test.mjs` (import
  `./fixtures/host-stubs.mjs` first, then `herdr`, then the mod)

```js
const cx = { spawn: (f) => { cx.last = f(cx); }, notify() {}, stop_propagation() {}, timer: { every() {} } };
const left = (px) => ({ id: "root", children: [{ id: "dock-left", size: { px } }] });
test("dock-spaces: agent rows count toward the active space's place; the narrow rail draws none", () => {
  herdr.data.spaces = [{ id: "A", name: "api", tabs: [{ id: "ta" }], active: false }, { id: "B", name: "web", tabs: [{ id: "tb" }], active: true }];
  herdr.data.agents = [{ address: "t1", space: "A", pane: "p1", status: "idle", program: {}, title: "one" },
                       { address: "t2", space: "A", pane: "p2", status: "working", program: {}, title: "two" }];
  herdr.data.layout = left(300);
  const s = new Spaces(); s.init({}, cx);
  s.render(cx);
  assert.equal(s.activeAt, 3);
  herdr.data.layout = left(100);
  s.render(cx);
  assert.equal(s.activeAt, 1);
});
test("dock-spaces: a name pass replaces the names, never merges into old ones", async () => {
  herdr.data.checking = false;
  herdr.data.layout = left(300);
  herdr.data.agents = [{ address: "t1", space: "A", pane: "p1", app: "claude-code", program: { key: "claude" }, status: "idle", title: "" }];
  herdr.data.hc = () => ({ code: 0, stdout: JSON.stringify({ foreground: { pid: 42 }, created_ms: Date.now() - 60_000 }), stderr: "" });
  herdr.data.files.set("C:/home/.claude/sessions/42.json", JSON.stringify({ pid: 42, sessionId: "73636264-03cb-4b62-bb2d-36ccfbcbee15", kind: "interactive", startedAt: Date.now() - 1000, name: "api-7a" }));
  const s = new Spaces(); s.init({}, cx); s.render(cx);
  s.refreshNames(cx); await cx.last;
  assert.equal(s.names.get("t1")?.name, "api-7a");
  herdr.data.files.clear();
  s.refreshNames(cx); await cx.last;
  assert.equal(s.names.has("t1"), false);
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `node --test tests/agent-rows.test.mjs tests/dock-spaces-class.test.mjs`
Expected: FAIL. `agent-rows.js` is missing (ERR_MODULE_NOT_FOUND), and `activeAt` is 1 instead of
3 because Spaces draws no agent rows yet.

- [ ] **Step 4: Create `src/shared/agent-rows.js` and `src/mods/_agent.js`, and point dock-agents
  at them** (moves only; dock-agents' behavior is unchanged).

- [ ] **Step 5: Implement the agent rows in `src/mods/dock-spaces/main.js`**
  - **Imports:** add `agents`, `readTextFile`, `home`, `checking` from herdr. Add `slashPath`,
    Task 1's helpers, this task's helpers, and `_agent.js`.
  - **`init`:**
    - set `this.names = new Map()`, `this.namesKey = null`, `this.drawsAgents = false`;
    - unless `checking()`, start a `cx.timer.every(15000, refreshNames)`;
    - unless `checking()`, start a `cx.timer.every(1000, …)` that calls `refreshNames` when
      `this.drawsAgents && claudeKey(agents()) !== this.namesKey`.
  - **`refreshNames(cx)`:**
    - returns at once unless `this.drawsAgents && !checking()`;
    - sets `this.namesKey`;
    - runs one pass at a time, with a pending re-run flag, like dock-agents' `refreshContext`;
    - **replaces** `this.names` with `readPeerNames(agents(), io, Date.now())`. In `io`, `get`
      runs `hc(["get", address, "--json"])` and parses stdout only when `code === 0`, else returns
      null. `readRecord` reads `` `${slashPath(home())}/.claude/sessions/${pid}.json` ``;
    - notifies only when the names changed.
  - **`render`:** sets `this.drawsAgents = face === "full" && !collapsed`. When false, it also sets
    `this.namesKey = null`, so returning to full looks names up within a second.
  - **`grouped`:**
    - when not collapsed, `rows = withAgents(this.ordered(), agents())`;
    - `draw` sends an agent item to `this.agentRow(item, t, dupes)`;
    - `dupes = sharedNames(<names of the listed local agents>)`;
    - the existing `findIndex(r => r.w.active)` stays as it is.
  - **`agentRow({ w, agent: a, depth }, t, dupes)`:**
    - an `h_flex`: id `space-agent-${a.address}`, `h(26)`, `px(8)`, `rounded(8)`, hover background;
    - inner `pl(depth === 1 ? 22 : 44)`;
    - children: `agentIcon(a.program, 13, t.muted)` or a 13 px spacer; the `rowLabel` text
      (truncated; muted when idle); `same name` in `t.dim` when the peer name is in `dupes`;
      `flex_1`; the `Copy` pill while hovered and named; `agentStatus(t, a, true)`;
    - `nameFor(a)` returns `this.names.get(a.address)?.name` only while
      `isLocalClaude(a) && entry.sig === sigOf(a)`.
  - **Clicks and hover:**
    - **Row:** `showTerminal(); run("pane.focus", { pane: a.pane })`.
    - **Copy pill:** the same look as the machine-login `Copy`. On click: `cx.stop_propagation()`,
      `cx.write_to_clipboard(name)`, then set `this.copiedAgent = a.address`. It reads `Copied`
      while `copiedAgent` is this row.
    - **Hover:** `on_hover` keeps `this.hoveredAgent`; leaving the row clears `copiedAgent`.
    - **Tooltips:** the pill reads `Copy the name other sessions message it by`. `same name` reads
      `Another session has this name too: a message by name may reach either`.

- [ ] **Step 6: Run the whole suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 7: Build and load the two mods in Herdr's checker**

Run: `npm run build && herdr-app check dist/mods/dock-spaces && herdr-app check dist/mods/dock-agents`
Expected: the build succeeds and each check reports no errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/agent-rows.js src/mods/_agent.js src/mods/dock-agents/main.js src/mods/dock-spaces/main.js tests/fixtures/host-stubs.mjs tests/agent-rows.test.mjs tests/dock-spaces-class.test.mjs
git commit -m "feat(spaces): each space lists its agents by peer name, with Copy; agents in a worktree sit under it"
```

---

### Task 3: Agents labels same-named spaces by branch

**Files:**
- Modify: `src/shared/agent-rows.js`: add `spaceTags`.
- Modify: `src/mods/dock-agents/main.js:398-414` (labels), `:451` (row name), `:505` (group
  label).
- Test: `tests/agent-rows.test.mjs`, new `tests/dock-agents-class.test.mjs`.

**Interfaces:**
- **Consumes:** Task 2's `tests/fixtures/host-stubs.mjs`.
- **Produces:** `spaceTags(list: {address, space, space_name}[], branchOf: (a) => string|null) -> Map<address, string>`:
  - `space_name`, plus `` ` · ${branch}` `` when two or more listed agents from *different* spaces
    share that non-empty `space_name`;
  - the branch is added only when it's present and isn't `main` or `master`.

- [ ] **Step 1: Write the failing tests** (in `tests/agent-rows.test.mjs`)

```js
const sa = (address, space, space_name) => ({ address, space, space_name, pane: "p" + address });
test("spaceTags adds the branch only where different spaces share a name, never main or master", () => {
  const list = [sa("t1", "S1", "herdr-dock"), sa("t2", "S2", "herdr-dock"), sa("t3", "S3", "server"), sa("t4", "S3", "server")];
  const branch = { t1: "main", t2: "changes-minors", t3: "feat/x", t4: "feat/x" };
  assert.deepEqual([...spaceTags(list, (a) => branch[a.address])],
    [["t1", "herdr-dock"], ["t2", "herdr-dock · changes-minors"], ["t3", "server"], ["t4", "server"]]);
});
test("spaceTags: no branch or master leaves the plain name", () => {
  const tags = spaceTags([sa("t1", "S1", "api"), sa("t2", "S2", "api")], (a) => (a.address === "t1" ? "master" : null));
  assert.deepEqual([...tags.values()], ["api", "api"]);
});
```

In `tests/dock-agents-class.test.mjs`:
- two agents in spaces `S1` and `S2`, both named `herdr-dock`;
- `data.panes` gives their panes branches `main` and `changes-minors`;
- with the stub's shared `agents.sort` set to `"priority"`, then to `"grouped"`, assert
  `assert.doesNotThrow(() => agentsPanel.render(cx))`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/agent-rows.test.mjs tests/dock-agents-class.test.mjs`
Expected: FAIL. `spaceTags` isn't exported.

- [ ] **Step 3: Implement `spaceTags` and use it in dock-agents**
  - read `panes()` once: `leadPanes(ps)` and a pane→branch map;
  - `tags = spaceTags(list, …)` and `spaceName = (a) => tags.get(a.address) ?? a.space_name`;
  - use `spaceName(a)` in place of `a.space_name` in:
    - the two `seen` keys;
    - the row `name` (`full ? spaceName(a) || label(a) : …`);
    - the grouped header label.

- [ ] **Step 4: Run the whole suite, build, check**

Run: `node --test && npm run build && herdr-app check dist/mods/dock-agents`
Expected: PASS; the check reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent-rows.js src/mods/dock-agents/main.js tests/agent-rows.test.mjs tests/dock-agents-class.test.mjs
git commit -m "fix(agents): rows from different spaces with one name add their branch"
```
