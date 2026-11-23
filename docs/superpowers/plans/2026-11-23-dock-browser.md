# dock-browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser beside each agent session, built on agent-browser, on Windows, macOS and Omarchy: a `browse`
command and skill for the agent (step 1), and a right-panel mod that shows the page live with take-over, handoff,
sizes, and Pick/Notes (step 2).

**Architecture:** agents run `node <app home>/mods/dock-browser/browse.mjs …`, a Node wrapper over a pinned
agent-browser binary, one agent-browser session per Herdr terminal (`HC_TERMINAL_ID`). The wrapper and the panel share
a two-file registry per terminal under `<app home>/herdr-dock/browser/sessions/`. The panel holds agent-browser's
stream WebSocket, draws frames with `image()` and forwards input. Pure logic lives in `src/shared/browser/` and is
unit-tested; the mod and the wrapper are thin.

**Tech Stack:** Node 22+ (wrapper, deploy), gpui-kit mods (panel), esbuild (bundling), `node --test`, agent-browser
0.43.0.

**Spec:** `docs/superpowers/specs/2026-11-23-dock-browser-design.md`

## Global Constraints

- Works on Windows, macOS and Linux: paths through `slashPath`/`path.join`, the binary is `agent-browser.exe` on Windows.
- No background service of herdr-dock's own; agent-browser's per-session daemon is the only long-lived process.
- The person's typed input (take-over) goes only to the stream socket: never to the registry, logs, stdout or the agent's terminal.
- Mods: no web view, Node APIs or `setTimeout`; `fs` writes only under the app home; `image()` paths are **relative to the app home**.
- Config `browser` defaults: `{ "enabled": false, "chrome": "", "production": [], "handoffMinutes": 15 }`.
- `browser.enabled: false` ⇒ deploy installs no agent-browser, no `dock-browser` mod, no skills, and `dock-browser` is in no region.
- agent-browser pinned at **0.43.0**; downloaded binaries checked against the pinned npm `integrity` (sha512) before use.
- Session name: `dock-<last 8 alphanumerics of HC_SCOPE>-<HC_TERMINAL_ID>`.
- `browse wait` waits at most **9 minutes** per call.
- Exit codes: `0` ok/done/free · `1` cancel or handoff timeout (wait) · `2` usage, refused or no Herdr terminal · `3` the person has control (action) · `4` still waiting at the limit (wait) · otherwise agent-browser's own code.
- Credits: port from cockpit (MIT) and agent-browser (Apache-2.0) noted in `README.md` credits and `THIRD_PARTY` lines, the way Render credits herdr-chat.
- Commit to `main` locally after each task; never push (the user says when).

## Review Focus

1. **Run outside a Herdr terminal** (no `HC_TERMINAL_ID`, e.g. a plain shell or a remote agent): `browse` says the agent isn't in a Herdr terminal and exits 2; it never opens an unnamed shared session. → Task 4 test `refuses without HC_TERMINAL_ID`.
2. **The browser went away under the panel** (agent-browser's 1 h idle timeout, `browse close`, a crash): the panel shows "The browser closed" and stops, instead of freezing on the last frame or reconnect-looping hot. → Task 6 test `afterLoss: socket lost with no session → closed`.
3. **What people type as a URL**: `localhost:3000`, `127.0.0.1:8080/x`, `example.com`, `/home/me/a.html`, `C:\site\a.html`, `file:///…`, `https://…`. Each opens the right thing. → Task 2 test `normalizeUrl`.
4. **Production patterns meet real hosts**: upper case, a port, the bare apex vs `*.`, an IP. `*.corp.com` matches `a.corp.com` and `a.b.corp.com` but not `corp.com`; matching ignores case and port. → Task 2 test `isProduction`.
5. **A terminal id reused after its terminal closed** (a stale `t3` registry with an answered handoff, or a session whose terminal is gone): it never pauses or answers the new agent's commands. → Task 3 tests `stale answer id is ignored` and `goneSessions`.

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/browser/config.js` | `browser` config: defaults, validation, merge, the dock-browser feature rule |
| `src/shared/browser/session.js` | session names, registry/frames/profile paths, URL normalisation |
| `src/shared/browser/hosts.js` | production host patterns |
| `src/shared/browser/args.js` | `browse` argv parsing, refused agent-browser commands |
| `src/shared/browser/registry.js` | registry and control records: parse, transitions, who has control, wait outcome, stale sessions |
| `src/shared/browser/tar.js` | minimal tar reader (to take one file out of an npm `.tgz`) |
| `src/shared/browser/pins.json` | agent-browser version, per-OS package, integrity |
| `src/shared/browser/frame.js` | JPEG size, click mapping, key/wheel events, frame rotation, stream message handling |
| `src/shared/browser/feedback.js` | the `## Design Feedback` prompt, secret redaction |
| `src/shared/browser/pick-script.js` | the in-page Pick/Notes script (a string) and its result parsing |
| `src/app/browse.js` | the `browse` CLI (bundled to `mods/dock-browser/browse.mjs`) |
| `src/app/browser-install.js` | download/verify agent-browser, Chrome for Testing, skills install/remove |
| `src/app/browser-skill.md` | the skill text, with `{{BROWSE}}` placeholder |
| `src/mods/dock-browser/{main.js,stream.js,manifest.json,mod.json,icon.svg}` | the panel |
| `scripts/build.mjs`, `scripts/deploy.mjs`, `src/shared/config.js`, `config/dock.json`, `README.md` | wiring |

---

### Task 1: The `browser` config section and the feature rule

**Files:**
- Create: `src/shared/browser/config.js`
- Modify: `src/shared/config.js` (`parseConfig`, `parseLocal`, `mergeForHost`), `config/dock.json`
- Test: `tests/browser-config.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_BROWSER` (the Global Constraints object); `checkBrowser(value, where): string | null` (error text or null); `browserOf(merged): {enabled, chrome, production, handoffMinutes}` (defaults filled); `withBrowserFeature(regions, enabled): regions` (returns new regions: when enabled and no region lists `dock-browser`, appends `{ mod: "dock-browser" }` to `right.features`; when disabled, removes `dock-browser` from every region).
- `mergeForHost` result gains `browser` (base ⟵ `machines.<host>.browser` ⟵ `local.browser`, key by key) and its regions pass through `withBrowserFeature`.

- [ ] **Step 1: Write the failing tests**

```js
test("defaults when absent", () => {
  const m = mergeForHost(parseConfig(BASE).config, "pc");
  assert.deepEqual(browserOf(m), { enabled: false, chrome: "", production: [], handoffMinutes: 15 });
  assert.ok(!m.regions.right.features.some((f) => f.mod === "dock-browser"));
});
test("enabled adds dock-browser after the right region's features", () => {
  const m = mergeForHost(withBrowser({ enabled: true }), "pc");
  assert.equal(m.regions.right.features.at(-1).mod, "dock-browser");
});
test("enabled keeps a user-placed dock-browser where it is", () => { /* listed first in right → stays first, once */ });
test("disabled removes a listed dock-browser", () => { /* listed in right, enabled false → absent */ });
test("local file overrides chrome per machine", () => {
  const local = parseLocal(JSON.stringify({ v: 1, browser: { chrome: "/usr/bin/chromium" } })).local;
  assert.equal(browserOf(mergeWithLocal(withBrowser({ enabled: true }), "pc", local)).chrome, "/usr/bin/chromium");
});
test("validation", () => {
  assert.match(parseConfig(cfg({ browser: { enabled: "yes" } })).error, /^browser\.enabled: must be true or false/);
  assert.match(parseConfig(cfg({ browser: { production: ["ok.com", 3] } })).error, /^browser\.production\[1\]: must be a host pattern/);
  assert.match(parseConfig(cfg({ browser: { production: ["https://x.com"] } })).error, /^browser\.production\[0\]: must be a host pattern/);
  assert.match(parseConfig(cfg({ browser: { handoffMinutes: 0 } })).error, /^browser\.handoffMinutes: must be a positive integer/);
  assert.match(parseConfig(cfg({ browser: { chrome: 1 } })).error, /^browser\.chrome: must be a string/);
  assert.match(parseConfig(cfg({ browser: { other: 1 } })).error, /^browser\.other: unknown setting/);
});
```

A host pattern is `[*.]label(.label)*` of letters, digits, `-` (no scheme, path or port). `machines.<host>.browser` and the local file's `browser` are validated with the same function (`where` prefixes the message).

- [ ] **Step 2: Run** `node --test tests/browser-config.test.mjs` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/shared/browser/config.js`, call `checkBrowser` from `parseConfig`/`parseLocal` (and from `mergeWithLocal`'s own validity check of the local object), merge `browser` and apply `withBrowserFeature` at the end of `mergeForHost`. Add `"browser": { "enabled": false, "chrome": "", "production": [], "handoffMinutes": 15 }` to `config/dock.json`.
- [ ] **Step 4: Run** `npm test` — Expected: all pass (existing config/layout tests unchanged).
- [ ] **Step 5: Commit** `feat(browser): the browser config section, and dock-browser placed only when enabled`

---

### Task 2: Names, paths, URLs, hosts, argv

**Files:**
- Create: `src/shared/browser/session.js`, `src/shared/browser/hosts.js`, `src/shared/browser/args.js`
- Test: `tests/browser-core.test.mjs`

**Interfaces:**
- Produces (`session.js`):
  - `sessionName(scope: string, terminal: string): string` → `dock-<last 8 [a-z0-9] of scope, lower-cased>-<terminal>`; throws on an empty terminal.
  - `BROWSER_REL = "herdr-dock/browser"`; `sessionsRel()`, `sessionFileRel(t)` → `herdr-dock/browser/sessions/<t>.json`, `controlFileRel(t)` → `…/<t>.control.json`, `framesRel(t)` → `herdr-dock/browser/frames/<t>`, `picksRel()` → `herdr-dock/browser/picks`, `signedInRel()` → `herdr-dock/browser/profiles/signed-in.json`, `binRel(platform)` → `herdr-dock/browser/bin/agent-browser` (+`.exe` on `win32`). All relative to the app home, `/`-separated.
  - `normalizeUrl(input: string): string`.
- Produces (`hosts.js`): `hostOf(url): string | null` (lower-case, no port); `isProduction(url, patterns): string | null` (the matching host, else null).
- Produces (`args.js`): `parseBrowse(argv: string[]): { cmd, ...}` where `cmd` ∈ `open|action|handoff|wait|status|close|login|window-open|window-done|help` and fields: `open {profile: "clean"|"signed-in", url}`, `action {args: string[]}`, `handoff {message}`, `login {url}`, `window-open|window-done {terminal}`; throws `UsageError` (exported) with a one-line message. `refused(args: string[]): string | null` → the reason for `close`, `connect`, `--cdp`, `--session`, `--profile`, `--state`, `--auto-connect`, `-p`/`--provider` anywhere in `args`.

- [ ] **Step 1: Write the failing tests**

```js
test("sessionName", () => {
  assert.equal(sessionName("5154-a375d9e35f2601246f10b2838c38c1e2", "t3"), "dock-8c38c1e2-t3");
  assert.throws(() => sessionName("x", ""));
});
test("normalizeUrl", () => {
  const cases = [
    ["localhost:3000", "http://localhost:3000"], ["127.0.0.1:8080/x", "http://127.0.0.1:8080/x"],
    ["example.com", "https://example.com"], ["https://a.b/c?d", "https://a.b/c?d"], ["file:///tmp/a.html", "file:///tmp/a.html"],
    ["/home/me/a.html", "file:///home/me/a.html"], ["C:\\site\\a.html", "file:///C:/site/a.html"], ["about:blank", "about:blank"],
  ];
  for (const [i, o] of cases) assert.equal(normalizeUrl(i), o, i);
});
test("isProduction", () => {
  const p = ["*.corp.com", "app.example.com"];
  assert.equal(isProduction("https://A.Corp.com:8443/x", p), "a.corp.com");
  assert.equal(isProduction("https://a.b.corp.com", p), "a.b.corp.com");
  assert.equal(isProduction("https://corp.com", p), null);
  assert.equal(isProduction("https://app.example.com/", p), "app.example.com");
  assert.equal(isProduction("http://10.0.0.5", p), null);
  assert.equal(isProduction("http://localhost:3000", ["localhost"]), "localhost");
  assert.equal(isProduction("about:blank", p), null);
});
test("parseBrowse", () => {
  assert.deepEqual(parseBrowse(["open", "x.com"]), { cmd: "open", profile: "clean", url: "x.com" });
  assert.deepEqual(parseBrowse(["open", "--profile", "signed-in", "x.com"]), { cmd: "open", profile: "signed-in", url: "x.com" });
  assert.deepEqual(parseBrowse(["action", "--", "click", "@e3"]), { cmd: "action", args: ["click", "@e3"] });
  assert.deepEqual(parseBrowse(["handoff", "Sign in"]), { cmd: "handoff", message: "Sign in" });
  assert.throws(() => parseBrowse(["open", "--profile", "work", "x"]), UsageError);
  assert.throws(() => parseBrowse(["handoff"]), UsageError);
});
test("refused", () => {
  assert.match(refused(["close"]), /close/);
  assert.match(refused(["--cdp", "9222", "snapshot"]), /--cdp/);
  assert.equal(refused(["tab", "close"]), null); // a tab of its own browser is fine
  assert.equal(refused(["snapshot", "-i"]), null);
});
```

(`refused` looks at the first word for `close`/`connect`; flags anywhere.)

- [ ] **Step 2: Run** `node --test tests/browser-core.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** the three modules (pure; no Node built-ins).
- [ ] **Step 4: Run** `node --test tests/browser-core.test.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(browser): session names, URLs, production hosts and browse arguments`

---

### Task 3: Registry and control state

**Files:**
- Create: `src/shared/browser/registry.js`
- Test: `tests/browser-registry.test.mjs`

**Interfaces:**
- Records (JSON, `v: 1`):
  - **session** (written only by the wrapper) `{ v, session, terminal, profile, port, url, title, opened, handoff: { id, message, since } | null }`
  - **control** (written only by the panel) `{ v, takeover: { reason: "person"|"pick"|"notes"|"window", since } | null, answer: { id, value: "done"|"cancel" } | null }`
- Produces:
  - `parseSession(text): Session | null`, `parseControl(text): Control` (missing/invalid → `{ v:1, takeover:null, answer:null }`).
  - `startHandoff(session, message, now, id): Session`; `clearHandoff(session): Session`.
  - `personHas(session, control, now, handoffMinutes): boolean` — true when `control.takeover`, or a handoff is pending (no `answer` with its `id`) and not older than `handoffMinutes`.
  - `waitOutcome(session, control, now, handoffMinutes): "free" | "waiting" | "done" | "cancel" | "timeout"` — `done`/`cancel` only when `answer.id === session.handoff.id`; `timeout` when the handoff is older than the limit; `waiting` while `personHas`; else `free`.
  - `answer(control, id, value): Control`; `takeOver(control, reason, now)`, `handBack(control)`.
  - `goneSessions(sessions: Session[], liveTerminals: Set<string>): Session[]`.
  - `newId(): string` (time + random, short).

- [ ] **Step 1: Write the failing tests**: `personHas` true during a fresh handoff, false after its answer, false after 15 min; `waitOutcome` gives `done`, `cancel`, `timeout`, `waiting` (take-over with no handoff), `free`; `stale answer id is ignored` (answer `{id:"old"}` with handoff `{id:"new"}` → `waiting`); `goneSessions` returns only terminals absent from the set; `parseControl("garbage")` → defaults; `parseSession` rejects records without `session`/`terminal`.
- [ ] **Step 2: Run** `node --test tests/browser-registry.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** `registry.js` (pure).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(browser): the session registry and who has the page`

---

### Task 4: The `browse` command, and the mod's skeleton

**Files:**
- Create: `src/app/browse.js`, `tests/fixtures/fake-agent-browser.mjs`, `src/mods/dock-browser/{main.js,manifest.json,mod.json,icon.svg}`
- Modify: `scripts/build.mjs` (bundle `src/app/browse.js` → `dist/mods/dock-browser/browse.mjs`, `platform: "node"`, like `herdr-render.mjs`)
- Test: `tests/browser-browse.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `main(argv, env, io): Promise<number>` exported from `src/app/browse.js` (exit code; `io = { out(line), err(line), readLine(): Promise<string> }`), and the CLI entry calling it. Environment it reads: `HC_TERMINAL_ID`, `HC_SCOPE`, `DOCK_APP_HOME` (tests; default: three folders up from the script, `<app home>/mods/dock-browser/browse.mjs`), `DOCK_AGENT_BROWSER` (tests; default `<app home>/` + `binRel(process.platform)`), `DOCK_BROWSE_POLL_MS` (default 500), `DOCK_BROWSE_WAIT_MS` (default 540000), `DOCK_SKIP_SWEEP` (tests: `1` skips the `herdr-app ls` sweep). Config (`browser.chrome`, `production`, `handoffMinutes`) is read from the merged config via dock-core's `source.json` (`mods/dock-core/source.json` → `config`, plus the local file); unreadable → defaults.
- Subcommands (agent-browser always called with `--session <name>`, plus `--executable-path <chrome>` when set):
  - `open`: profile change on a running session → `close` first and print `restarted the browser on the <profile> profile`. Signed-in with a saved file → `--state <file>` at launch. Then `open <normalizeUrl(url)>`, `stream status --json` → `port`, `get url`, `get title`; write the session record (atomic: write `.tmp` then rename). Also sweep `goneSessions` using `herdr-app ls` terminal ids (skip the sweep when `herdr-app` fails).
  - `action -- …`: `refused` → exit 2 with the reason. `personHas` → exit 3, `the person has control; run browse wait`. Else run it with stdio passed through, then `get url` and update the record's `url`; when `isProduction`, print `PRODUCTION (<host>): no probing, nothing that writes without the person.` before the output.
  - `handoff "<msg>"`: `startHandoff`; print `waiting for the person: run browse wait`; exit 0.
  - `wait`: poll every `DOCK_BROWSE_POLL_MS` up to `DOCK_BROWSE_WAIT_MS`. `done` → clear handoff (and, on the signed-in profile, `state save` it to the signed-in file) → exit 0; `free` → 0; `cancel` → clear, print `the person cancelled`, 1; `timeout` → clear, print `nobody answered in <n> minutes`, 1; limit reached → print `still waiting; run browse wait again`, 4.
  - `status`: one line each: session, profile, url, `person has control: yes|no`.
  - `close`: agent-browser `close`, delete both records and `framesRel(t)`.
  - `login <url>` (the spec says the person closes the window; Enter in the terminal is used instead, because the state must be saved while the window is still open): session `dock-login-<scope8>`, `--headed`, `--state` when the file exists; print `Sign in in the window, then press Enter here.`; `readLine()`; `state save <file>`; `close`. The saved file is `chmod 0o600` (ignored on Windows).
  - `window-open --terminal t` / `window-done --terminal t` (the panel runs these): open saves the agent session's state to `herdr-dock/browser/tmp/<t>.json` and opens `<session>-real` `--headed --state <tmp>` at the record's url; done saves `<session>-real` state to `<t>.done.json`, closes it, `state load`s it into the agent session, `reload`s, deletes both temp files.
  - No `HC_TERMINAL_ID` (for agent commands) → `browse runs inside a Herdr terminal (HC_TERMINAL_ID is not set)`, exit 2. Missing binary → `agent-browser is not installed: set browser.enabled and run npm run deploy`, exit 2.
- Mod skeleton: `manifest.json` `{ "id": "dock-browser", "name": "Browser", "icon": "icon.svg", "regions": ["right"], "settings": {} }`, `mod.json` `{ "place": "none", "title": "Browser" }`, a globe `icon.svg` in the rail's icon style, `main.js` drawing only the empty state `No page yet. The agent opens one with browse open.`

- [ ] **Step 1: Write the fake** `tests/fixtures/fake-agent-browser.mjs`: appends its argv (JSON line) to `$FAKE_AB_LOG`, answers `stream status --json` with `{"success":true,"data":{"port":4567}}`, `get url` with `$FAKE_AB_URL` (default `http://localhost:3000/`), `get title` with `Title`, exits `$FAKE_AB_EXIT` (default 0). Tests run it through a tiny launcher (`node fake…` via a `.cmd`/shell shim written into a temp dir, so `DOCK_AGENT_BROWSER` points at an executable on every OS).
- [ ] **Step 2: Write the failing tests** (temp app home, `DOCK_SKIP_SWEEP=1` to skip `herdr-app`):
  - `refuses without HC_TERMINAL_ID` → exit 2, no agent-browser call.
  - `open writes the session record` → record has `session: "dock-…-t3"`, `port: 4567`, `profile: "clean"`, `url`.
  - `open on signed-in passes --state when the file exists`, and not when it doesn't.
  - `profile change restarts the session` → log has `close` before `open`.
  - `action is refused for close` → exit 2; `action while the person has control` (control file with `takeover`) → exit 3, no call.
  - `action on a production page prints the banner` (`FAKE_AB_URL=https://a.corp.com`, config production `["*.corp.com"]`).
  - `handoff then wait`: with `DOCK_BROWSE_WAIT_MS=300`, no answer → exit 4; write an answer with the handoff's id → exit 0 and `handoff` cleared; `cancel` → exit 1.
  - `close removes the records and frames`.
  - `session record holds only the listed keys` (`v, session, terminal, profile, port, url, title, opened, handoff`).
- [ ] **Step 3: Run** `node --test tests/browser-browse.test.mjs` — Expected: FAIL.
- [ ] **Step 4: Implement** `src/app/browse.js`, the build entry, and the mod skeleton.
- [ ] **Step 5: Run** `npm test && npm run build` — Expected: PASS; `dist/mods/dock-browser/browse.mjs` exists; `herdr-app check dist/mods/dock-browser` passes.
- [ ] **Step 6: Commit** `feat(browser): the browse command agents drive the browser with`

---

### Task 5: Install: agent-browser, Chrome, the skill, and deploy

**Files:**
- Create: `src/shared/browser/pins.json`, `src/shared/browser/tar.js`, `src/app/browser-install.js`, `src/app/browser-skill.md`
- Modify: `scripts/deploy.mjs`, `scripts/build.mjs` (skip nothing; deploy decides), `INSTALL.md`
- Test: `tests/browser-install.test.mjs`, `tests/fixtures/agent-browser-fake.tgz` (built by the test from `tar`-format bytes, not committed if generated)

**Interfaces:**
- `pins.json`:

```json
{
  "version": "0.43.0",
  "packages": {
    "linux-x64":   { "name": "@agent-browser/cli-linux-x64-gnu",   "integrity": "sha512-WY8vy2Saa3oRt6XEmz4Sae1W5qS9TjYcbX6IE+dxb8s2APfL9XyQjMHC6jBZrhwqDBIvUeTMCT/P2cq3XLPSBw==", "member": "package/bin/agent-browser" },
    "linux-arm64": { "name": "@agent-browser/cli-linux-arm64-gnu", "integrity": "sha512-8DC234LGlXCn8A2YXGk6woy1uTjyexvtHd/TOQHLrV2sfUMZD647HTHEJyF+2z1J1oR34LaB5jqHJ9d0REC+Cw==", "member": "package/bin/agent-browser" },
    "darwin-arm64":{ "name": "@agent-browser/cli-darwin-arm64",    "integrity": "sha512-HV6GP59IjNnowlrXR/5rVM8msPWwQDEONt/tWC8STzUfKZQHKZI/Iv9sf2h2ZhwK8xwoqLhxpf+KxcFgJ0sExQ==", "member": "package/bin/agent-browser" },
    "darwin-x64":  { "name": "@agent-browser/cli-darwin-x64",      "integrity": "sha512-3NKnKFOWLYDYTz4bJxo4jt+GwjM4VtcW5FDrQY35eUrytig65FEDdXmXKuRbZGq9jEEWxh6rmpS4R6xS53XCaw==", "member": "package/bin/agent-browser" },
    "win32-x64":   { "name": "@agent-browser/cli-win32-x64-msvc",  "integrity": "sha512-xhk8wnHk3aiBFSR0pd1Ye3ay2jKjgRardgBJLiB9nXJv0ZkbeP/wh3X7jMiKUfUGE1qqJrKdaM5szQ6iz8/8+w==", "member": "package/bin/agent-browser.exe" }
  }
}
```

  Tarball URL: `https://registry.npmjs.org/<name>/-/<name without scope>-<version>.tgz`. Verify the **whole `.tgz`** against `integrity` (sha512, base64) before extracting.
- `tar.js`: `tarFile(tarBytes: Uint8Array, member: string): Uint8Array | null` (ustar: 512-byte headers, name at 0..100 + prefix at 345..500, size octal at 124..136).
- `browser-install.js`:
  - `pinFor(platform, arch): {name, integrity, member} | null`.
  - `installAgentBrowser({ appHome, platform, arch, fetchBytes, dry, say }): Promise<"present"|"installed"|"unsupported">` — skips when `<bin>` exists and `<bin>.version` holds the pinned version; else download (`fetchBytes(url)`), verify, gunzip (`node:zlib`), `tarFile`, write the binary (mode 0755) and `<bin>.version`. Integrity mismatch throws `agent-browser <v>: the download does not match the pinned checksum`.
  - `ensureChrome({ bin, chrome, run, say })`: `chrome` set → check it exists (warn if not); empty → run `<bin> install` once (skip when `<bin> doctor` / a marker `herdr-dock/browser/chrome-installed` says it's there).
  - `skillTargets({ home, env })`: `[{ name: "Claude Code", dir: <DOCK_CLAUDE_HOME or ~/.claude>/skills }, { name: "Codex", dir: <DOCK_CODEX_HOME or ~/.codex>/skills }, { name: "Antigravity", dir: <DOCK_AGY_HOME or ~/.gemini/antigravity-cli>/skills }]`; a target is used only when its **parent** folder exists (Antigravity: only when `skills/` itself exists — before building, read `~/.gemini/antigravity-cli/builtin/skills/agy-customizations` for its documented user-skills folder and use that if it names one).
  - `installSkills({ targets, text, dry, say })` writes `<dir>/dock-browser/SKILL.md`; `removeSkills({ targets, dry, say })` deletes `<dir>/dock-browser` only when its `SKILL.md` starts with the marker line `<!-- herdr-dock: dock-browser -->`.
  - `skillText(template, { browse })`: replaces `{{BROWSE}}` with `node "<app home>/mods/dock-browser/browse.mjs"` (slash path).
- `browser-skill.md`: front matter `name: dock-browser`, `description:` "Use the browser beside this conversation in Herdr (herdr-dock) to debug a UI workflow end to end, check a page for security bugs, check layout at phone, tablet and desktop sizes, or act on Design Feedback the person sends. Use it whenever a task needs a real browser and this session runs in a Herdr terminal."; then the marker line; then the rules from the spec's **The skill** section, in that order, with every command spelled `{{BROWSE}} …`. Must state: run `wait` with the shell tool's longest timeout and run it again on exit 4; exit 3 means run `wait`; security checks only with `open --profile clean`; on a `PRODUCTION` banner no probing and nothing that writes unless the person asked in this task; hand off instead of typing credentials or solving captchas; never read credential fields (`eval` on password inputs, `get value` on them); sizes in a `tab new` of its own then `tab close`; Design Feedback prompts list pictures to open and selectors/sources to change; leave Submit/Send/Approve/Merge/Delete to the person. Adapted from cockpit's `side-browser` skill (MIT) — credit line at the end.
- Deploy (`scripts/deploy.mjs`), after the mods are installed, using `browserOf(merged)`:
  - enabled: `installAgentBrowser`, `ensureChrome`, `installSkills` (unless `--no-skills`); print each result.
  - disabled: don't install `dock-browser` (filter it out of `names` before the install loop), delete an installed `mods/dock-browser`, `removeSkills`. The signed-in profile is left alone.
  - `--dry-run` prints what it would do and changes nothing.

- [ ] **Step 1: Write the failing tests**: `tarFile` finds a member in a tar built in the test (and a long name using the prefix field) and returns null for a missing one; `installAgentBrowser` with a fake `fetchBytes` returning a test `.tgz`: wrong integrity → throws the message above and writes nothing; right integrity → binary written with its bytes, `.version` = `0.43.0`; second run → `"present"` without fetching; unknown platform → `"unsupported"`; `installSkills`/`removeSkills` in temp homes: writes only where the parent exists; `removeSkills` leaves a `dock-browser/SKILL.md` without the marker; `skillText` has no `{{` left and contains the browse path; the skill template mentions `wait`, `exit 3`, `--profile clean`, `PRODUCTION`, `handoff`.
- [ ] **Step 2: Run** `node --test tests/browser-install.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** the modules and the deploy wiring (real `fetchBytes` = `fetch(url).then(r => r.arrayBuffer())`, failing on `!r.ok`).
- [ ] **Step 4: Run** `npm test` and `node scripts/deploy.mjs --dry-run` with `browser.enabled` false then true in a temp copy of the config (`DOCK_REPO`) — Expected: tests pass; dry runs print the skip/install lines.
- [ ] **Step 5: Live check on this machine**: set `browser.enabled: true` and `chrome: "/usr/bin/chromium"` in the local file, `npm run deploy` — Expected: agent-browser installed under `~/.config/herdr-app/herdr-dock/browser/bin/`, `~/.claude/skills/dock-browser/SKILL.md` and `~/.codex/skills/dock-browser/SKILL.md` written, `herdr-app status` no errors. From this terminal: `node ~/.config/herdr-app/mods/dock-browser/browse.mjs open https://example.com` then `… action -- snapshot -i` → prints a snapshot.
- [ ] **Step 6: Update `INSTALL.md`** (an **Ask first** step: "Turn on the browser beside agents? Downloads agent-browser (~20 MB) and, without a `chrome` path, Chrome for Testing (~150 MB)") and commit `feat(browser): deploy installs agent-browser, Chrome and the dock-browser skill when enabled`

---

### Task 6: Frame and input logic (pure)

**Files:**
- Create: `src/shared/browser/frame.js`
- Test: `tests/browser-frame.test.mjs`

**Interfaces:**
- Produces:
  - `jpegSize(bytes: Uint8Array): { w, h } | null` (first SOFn marker other than C4/C8/CC).
  - `toPage(local: {x,y}, frameW: number, drawnW: number): {x, y}` — both axes × `frameW / drawnW`, rounded.
  - `drawnHeight(frame: {w,h}, drawnW): number`.
  - `keyEvents(e: {key, key_char?, modifiers}): object[]` → `[keyDown, keyUp]` stream messages. Named keys: `enter→Enter` (text `"\r"`), `backspace→Backspace`, `delete→Delete`, `tab→Tab`, `escape→Escape`, `left/right/up/down→Arrow*`, `home`, `end`, `pageup→PageUp`, `pagedown→PageDown`, `space→" "` (text `" "`); else `key_char` as key and text. Modifiers → CDP bitmask `modifiers` (alt 1, ctrl 2, meta/cmd 4, shift 8); with ctrl or cmd no `text` is sent (so ctrl-a selects all rather than typing).
  - `wheelEvent(e, frameW, drawnW)` → `{type:"input_mouse", eventType:"mouseWheel", x, y, deltaX: -dx, deltaY: -dy}`.
  - `mouseEvents(kind: "down"|"up"|"move", e, frameW, drawnW)` → `down` = `[mouseMoved, mousePressed]`, `up` = `[mouseReleased]`, `move` = `[mouseMoved]`; `button: "left"`, `clickCount: e.click_count ?? 1`.
  - `FrameRing` class: `constructor(dirRel, keep = 6)`, `next(seq): { rel, drop: string[] }` (the new frame's app-home-relative path and the ones to delete), `prev`/`current` getters, `clear(): string[]`.
  - `streamStep(state, msg | {error}): state` — reducer for the panel: `frame` → `{frame: rel?, size}` handled by the caller; `url`, `tabs`, `status`, `console` (count `level === "error"` and keep the last 20 error texts); `{error}` → `{ phase: "lost" }`; the caller decides reconnect vs closed (`closed` when the session record is gone).
- Spike-proven values (from the spec): previous frame kept under the current one; frame size from the JPEG header, never `metadata.deviceHeight`.

- [ ] **Step 1: Write the failing tests**: `jpegSize` on a real 1280×633 JPEG fixture (`tests/fixtures/frame-1280x633.jpg`, a tiny generated one is fine) and on garbage → null; `toPage({x:440,y:100},1280,880)` → `{x:640,y:145}`; `keyEvents` for `enter`, `a`, `shift`+`A`, `ctrl`+`a` (no text, modifiers 2), `backspace`; `wheelEvent` flips sign; `FrameRing` keeps 6 and drops the oldest; `streamStep` counts console errors and caps the list at 20; `afterLoss: socket lost with no session → closed` (helper `afterLoss(state, sessionExists)` → `"closed"` when false, `"reconnect"` otherwise, at most once per 2 s).
- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.** **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(browser): frame, click and key mapping for the live panel`

---

### Task 7: The panel: follow the agent and draw the page live

**Files:**
- Create: `src/mods/dock-browser/stream.js`
- Modify: `src/mods/dock-browser/main.js`
- Test: `herdr-app check` + live check (the view logic is in Tasks 3 and 6)

**Interfaces:**
- Consumes: `pickAgent` (`src/shared/render/agent.js`), registry (Task 3), frame (Task 6), session paths (Task 2).
- `stream.js`: `class Stream { constructor({ port, framesRel, onChange }); start(cx); stop(); send(msg) }` — connects `ws://127.0.0.1:<port>/?maxFps=15`, decodes frames (`Buffer.from(data, "base64")`; fall back to a JS decoder if `Buffer` is missing), writes them via `FrameRing`, deletes dropped files, feeds `streamStep`, calls `onChange()` after each state change.
- `main.js` behaviour:
  - The agent in front: `pickAgent(focused(), agents())`; its terminal is `agent.address`. Its records: `sessionFileRel(t)`/`controlFileRel(t)`, re-read on `watchFolder(<app home>/herdr-dock/browser/sessions)` changes.
  - No record → the empty state. Record → `Stream` started while the panel is shown (reuse Render's `rightShownOf`/`rightActiveOf` from `src/shared/panel.js`), stopped when hidden or when the agent in front changes; frames folder cleared on stop.
  - Page: width = the panel's width (`on_size_change`) minus padding; height = `drawnHeight`; two absolutely placed `image()` layers (previous under current).
  - Header: title, url (one line, ellipsis), profile chip, `Production` tag when `isProduction(url, browser.production)` (read the merged config the way dock-core does via `source.json`), console error count (click → a small list of the last errors), tabs row when more than one tab (switching comes in Task 8).
  - Outside take-over the picture is view-only except the wheel (forwarded). 
  - Every 30 s while shown: `herdr-app ls` terminal ids → `goneSessions` → for each, run `node browse.mjs close` with that terminal's env (`HC_TERMINAL_ID`) — or delete records and `agent-browser --session <s> close` directly.
  - Lost socket: `afterLoss` → reconnect (re-read `port` via `agent-browser --session <s> stream status --json`) or show `The browser closed.`
- [ ] **Step 1: Implement** `stream.js` and the main view.
- [ ] **Step 2: Run** `npm run build && herdr-app check dist/mods/dock-browser` — Expected: `check passed`.
- [ ] **Step 3: Live check**: `npm run deploy`; in an agent terminal `browse open https://en.wikipedia.org/wiki/Web_browser`; open the Browser panel. Expected: page live and sharp; `herdr-app shot` ×15 while `browse action -- scroll down 300` runs shows no blank frame; switch to another agent → empty state; `browse close` → `The browser closed.` then empty state.
- [ ] **Step 4: Commit** `feat(browser): the Browser panel shows the agent's page live`

---

### Task 8: The panel: take-over, handoff, real window, sizes, enlarge

**Files:**
- Modify: `src/mods/dock-browser/main.js`, `src/mods/dock-browser/mod.json` (add `"focusable": true`)
- Test: live check (state rules are covered by Task 3)

**Interfaces:**
- Consumes: `takeOver`, `handBack`, `answer`, `personHas`, `waitOutcome` (Task 3); `keyEvents`, `mouseEvents`, `wheelEvent` (Task 6); `notifyCommandName` (`src/shared/notifycmd.js`) for notifications.
- Behaviour:
  - **Take over** button → control `takeOver(control, "person", now)`; the picture takes clicks and keys (focus handle focused on mouse down, `on_key_down` → `keyEvents`, mouse down/up → `mouseEvents`), highlighted border. **Hand back** → `handBack`.
  - **Handoff pending** (session `handoff` with no matching answer): the take-over mode with the agent's message, **Done** (`answer(id, "done")` + `handBack`), **Cancel** (`answer(id, "cancel")` + `handBack`), **Open in a real window** (runs `node browse.mjs window-open --terminal t`, shows "Finish in the window, then press Done"; Done then runs `window-done` before answering). A new handoff id posts one notification (`title: "The agent needs you"`, `body: message`, action shows the Browser panel — use the same mechanism `notify.show` uses to bring a panel into view).
  - **Tabs**: clicking another tab → `takeOver(control, "person", now)` if not already, then `agent-browser --session s tab <tN>`.
  - **Sizes** (phone/tablet/desktop): `tab new <url>` then `set device "iPhone 16"` / `set device "iPad"` / `set viewport 1440 900`; no take-over needed (the agent's tab is untouched).
  - **Enlarge**: `openOverlay({ mod: "dock-browser", kind: "window", width: 0.8, height: 0.85, props: { big: true } })`; the big copy follows the same terminal (passed in props) and has the same controls.
  - Nothing the person types is logged, stored or sent anywhere but `Stream.send`.
- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm run build && herdr-app check dist/mods/dock-browser` — Expected: pass.
- [ ] **Step 3: Live check**:
  - In an agent terminal, `browse open https://en.wikipedia.org`, then `browse handoff "Search for Herdr, then press Done"`. Expected: a notification; the panel in take-over mode; your clicks/typing work; while pending, `browse action -- snapshot -i` exits 3; Done → `browse wait` exits 0.
  - Repeat with Cancel → exit 1.
  - Open in a real window: a visible Chromium window opens at the same page; log in to a test site there; Done → the panel's page is logged in.
  - The sizes buttons open a new tab at that size.
  - Enlarge opens the big window.
  - `grep -r` for a typed test string under `~/.config/herdr-app/herdr-dock/browser` finds nothing.
- [ ] **Step 4: Commit** `feat(browser): take over, hand back, and handoffs in the Browser panel`

---

### Task 9: Pick and Notes

**Files:**
- Create: `src/shared/browser/pick-script.js`, `src/shared/browser/feedback.js`
- Modify: `src/mods/dock-browser/main.js`
- Test: `tests/browser-feedback.test.mjs`

**Interfaces:**
- `pick-script.js`: `PICK_SCRIPT: string` — an IIFE for `agent-browser eval` that installs (idempotently, `window.__dockPick`) a capturing `mousemove` highlight and a capturing `click` that `preventDefault`s, `stopPropagation`s and records `{ n, selector, text (≤200 chars), tag, box: {x,y,w,h}, source: {file, line} | null }` for the element (React dev builds: `__reactFiber$*` → `_debugSource`), drawing numbered badges for Notes; `READ_PICKS: string` (returns and clears the records as JSON); `STOP_SCRIPT: string` (removes everything). `parsePicks(text): Pick[]`.
  Port the selector and React-source logic from cockpit's `browser/main/design.js` and its grab scripts (MIT, credit in a header comment).
- `feedback.js`: `designFeedback({ url, items: [{ selector, text, note, intent?, priority?, source?, picture? }] }): string` — `## Design Feedback` heading, the page URL, then one numbered section per element: selector, source `file:line` when known, text, `Note:`, intent/priority when given, `Picture: <path>`. `redact(s)` replaces values that look like secrets (JWTs, `Bearer …`, 32+ char hex/base64 runs, `password=…`/`token=…` pairs) with `[redacted]`; applied to `text` and `note`.
- Panel: **Pick** → `takeOver(control, "pick", now)`, eval `PICK_SCRIPT`, forward mouse moves; after a click, poll `READ_PICKS`, show a one-line note field (gpui-base input), **Send**. **Notes** → `takeOver(control, "notes", now)`, up to 20 picks, each with note, intent (fix, change, question, approve) and priority, a list to remove items, **Copy** (Markdown) and **Send**. Picture: `agent-browser screenshot <picksRel>/<id>.png` taken while the picked element's highlight is drawn (whole viewport, element outlined; agent-browser has no element screenshot, so this replaces the spec's cropped picture). Send = `hc send <terminal> <designFeedback(...)>`, then `STOP_SCRIPT`, `handBack`.
- [ ] **Step 1: Write the failing tests**: `designFeedback` output for one and for two items (exact heading `## Design Feedback`, numbered sections, `Picture:` lines, source line only when known); `redact` on a JWT, `Bearer abc…`, `password=hunter2`, a 40-char hex string, and leaves `the button is blue` alone; `parsePicks` on valid and invalid JSON; `PICK_SCRIPT` parses (`new Function(PICK_SCRIPT)` does not throw).
- [ ] **Step 2: Run** `node --test tests/browser-feedback.test.mjs` — Expected: FAIL. **Step 3: Implement.** **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Live check**: `browse open` a local page with buttons (a file under the scratchpad); Pick a button, write a note, Send → the agent's terminal receives the Design Feedback prompt with the picture path, and the picture shows the outlined button; Notes with three elements → one prompt with three sections; the page's own click handler never fired during Pick.
- [ ] **Step 6: Commit** `feat(browser): Pick and Notes send elements to the agent as Design Feedback`

---

### Task 10: Docs and the whole-feature check

**Files:**
- Modify: `README.md` (a **Browser** section after Render: what it is, turning it on, the two profiles and `browse login`, production patterns and that they are guidance plus warnings, handoff and take-over, Pick/Notes, where things are kept under `<app home>/herdr-dock/browser/`, that the signed-in file holds live cookies, that agent-browser's debugging port is reachable by any program running as you, credits for agent-browser (Apache-2.0) and cockpit (MIT)), `app/` recipe if it lists features.
- [ ] **Step 1: Write the README section.**
- [ ] **Step 2: Run** `npm test && npm run deploy && herdr-app status` — Expected: tests pass, deploy checks pass, no errors.
- [ ] **Step 3: Turn it off and redeploy** (`browser.enabled: false`) — Expected: `mods/dock-browser` and both `SKILL.md` folders removed, the right region has no Browser, the signed-in file still there. Turn it back on.
- [ ] **Step 4: Commit** `docs(browser): the Browser section in the README`
