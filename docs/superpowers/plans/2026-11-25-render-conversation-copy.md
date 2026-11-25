# Render Conversation and Copy Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Render panel's Answer tab becomes a Conversation tab (every exchange, newest first, speakers on coloured rails) whose replies are drawn as blocks carrying prismantis's copy buttons (md / art / html, copy, copy source, copy md / copy html).

**Architecture:** The Node helper does the reading: `transcript.js` folds a log into exchanges, `blocks.js` (with `marked`) cuts a reply into blocks and works out each block's copies, and the helper returns light rows for every exchange plus blocks only for the open ones. A pure view model (`src/shared/render/view.js`) decides what is open, labels, colours and which buttons show; `main.js` draws it. Formatted copies run a ported macOS pasteboard script through the helper's new `clip` mode.

**Tech Stack:** JavaScript (ESM), gpui-kit / gpui-base mod UI, Node helper bundled by esbuild, `marked` 18.2.0, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-render-conversation-copy-design.md`

## Global Constraints

- `marked` pinned exactly at **18.2.0** (MIT, released 2026-11-09), a devDependency bundled by esbuild into `herdr-render.mjs` like beautiful-mermaid: nothing to install at run time.
- Pictures are untouched: Mermaid and figure blocks are still found by `splitSegments` (same ids, same cache files); `LOOK_VERSION` stays 11.
- Speaker colours from the Herdr theme: you `ansi4`, Claude `ansi5`, events `ansi3`; tints are the colour with hex alpha `"14"` (~8 %). Alerts: NOTE `ansi4`, TIP `ansi2`, IMPORTANT `ansi5`, WARNING `ansi3`, CAUTION `ansi1`.
- Button labels exactly: `md`, `art`, `html`, `copy`, `copy source`, `copy md`, `copy html`. A clicked button reads `copied` in `ansi2` for 1.5 s.
- html buttons only when the helper says `canHtml` (`process.platform === "darwin"`). A payload over 512 KB (html + text) copies as plain text with a note. osascript runs with a 5 s timeout and the payload on stdin.
- The newest 3 exchanges are open; at most 200 exchanges are returned; a turn's text over 12 lines shows 12 and `show all`.
- The `answer` command and a stored view of `"answer"` both mean `conversation`.
- Credits: the table art, width/wrap helpers and pasteboard script are ported from prismantis 0.20.0 (MIT): keep a credit comment in each ported file and in the README, as figures do.
- `app/` is generated: after source changes run `npm run build:app` (tests/build-app.test.mjs checks it). Known baseline failure: `tests/dock-core-class.test.mjs` (Node 22.14 lacks `module.registerHooks`).

## Review Focus

- A reply still streaming mid-table or mid-fence: blocks must come out as text or code, never throw (Task 1 test "a table still streaming…" and "an unclosed mermaid fence…").
- Table cells holding escaped pipes, quotes or inline markup: md keeps them as written, art and TSV show the cell's plain text (Task 1 test "tableText: …").
- Replies with Windows line endings: same blocks as LF (Task 1 test "CRLF text…").
- A session over 200 exchanges: only the newest 200 come back, and an `open` id that fell off is ignored (Task 2 test "at most 200 exchanges…", Task 3 test "open ids that aren't there are ignored").
- The html copy failing or unavailable: the plain text still lands on the clipboard and the button says why (Task 3 test "copyHtml: off macOS…", Task 4 test "copyPlan: …").

---

### Task 1: Blocks and their copies

**Files:**
- Modify: `package.json`, `package-lock.json` (add `"marked": "18.2.0"` to devDependencies)
- Create: `src/shared/render/table-copy.js`
- Create: `src/shared/render/blocks.js`
- Test: `tests/render-blocks.test.mjs`

**Interfaces:**
- Consumes: `splitSegments`, `blockId` from `src/shared/render/markdown.js` (unchanged).
- Produces:
  - `type Button = { label: string, text: string, html?: string }` (`html` set only on formatted copies; `text` is then the plain-text side).
  - `type Block = { kind: "text"|"table"|"code"|"list"|"quote"|"alert", md: string, lang?: string, alert?: "note"|"tip"|"important"|"warning"|"caution", buttons: Button[] } | { kind: "mermaid"|"figure", source: string, id: string, buttons: Button[] }`
  - `toBlocks(text: string): Block[]` in `blocks.js`
  - `replyButtons(text: string): Button[]` in `blocks.js` → `[{ label: "copy md", text }, { label: "copy html", text, html }]`
  - `width(s: string): number`, `cellText(tokens: object[]): string`, `tableArt(token): string`, `tableText(token): string` in `table-copy.js` (`token` is a `marked` table token)

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-dev --save-exact marked@18.2.0`
Expected: `package.json` devDependencies list `"marked": "18.2.0"`; `node -e "import('marked').then(m => console.log(typeof m.marked.lexer))"` prints `function`.

- [ ] **Step 2: Write the failing tests** in `tests/render-blocks.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { toBlocks, replyButtons } from "../src/shared/render/blocks.js";
import { tableArt, tableText, width } from "../src/shared/render/table-copy.js";
import { blockId } from "../src/shared/render/markdown.js";

const ALL = "# Title\n\nIntro para.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n> quoted\n> more\n\n> [!WARNING]\n> Careful now\n\n```js\nconst x = 1;\n```\n\n```mermaid\ngraph TD\n A-->B\n```\n\nEnd.";
const labels = (b) => b.buttons.map((x) => x.label);

test("toBlocks: kinds in order; consecutive text merges and has no buttons", () => {
  const b = toBlocks(ALL);
  assert.deepEqual(b.map((x) => x.kind), ["text", "table", "list", "quote", "alert", "code", "mermaid", "text"]);
  assert.equal(b[0].md, "# Title\n\nIntro para.");
  assert.deepEqual(b[0].buttons, []);
  assert.equal(b[7].md, "End.");
});

test("toBlocks: each block's buttons and what they copy", () => {
  const [, table, list, quote, alert, code, pic] = toBlocks(ALL);
  assert.deepEqual(labels(table), ["md", "art", "html"]);
  assert.equal(table.buttons[0].text, "| a | b |\n|---|---|\n| 1 | 2 |");
  assert.equal(table.buttons[2].text, "a\tb\n1\t2");
  assert.match(table.buttons[2].html, /<table>[\s\S]*<th>a<\/th>[\s\S]*<td>2<\/td>/);
  assert.deepEqual(list.buttons, [{ label: "copy", text: "- one\n- two" }]);
  assert.deepEqual(quote.buttons, [{ label: "copy", text: "quoted\nmore" }]);
  assert.equal(alert.alert, "warning");
  assert.equal(alert.md, "Careful now");
  assert.deepEqual(alert.buttons, [{ label: "copy", text: "Careful now" }]);
  assert.equal(code.lang, "js");
  assert.deepEqual(code.buttons, [{ label: "copy", text: "const x = 1;" }]);
  assert.equal(pic.source, "graph TD\n A-->B");
  assert.equal(pic.id, blockId("mermaid", "graph TD\n A-->B"));
  assert.deepEqual(pic.buttons, [{ label: "copy source", text: "graph TD\n A-->B" }]);
});

test("alerts: the five kinds in any case; an unknown tag stays a quote", () => {
  for (const k of ["NOTE", "TIP", "IMPORTANT", "WARNING", "caution"]) {
    const [b] = toBlocks(`> [!${k}]\n> body`);
    assert.equal(b.kind, "alert");
    assert.equal(b.alert, k.toLowerCase());
  }
  assert.equal(toBlocks("> [!FOO]\n> body")[0].kind, "quote");
});

test("a code block inside a list item stays in the list", () => {
  assert.deepEqual(toBlocks("- step\n\n  ```bash\n  npm test\n  ```\n- next").map((x) => x.kind), ["list"]);
});

test("an unclosed mermaid fence (still streaming) is code, not a picture", () => {
  const b = toBlocks("a\n\n```mermaid\ngraph TD");
  assert.deepEqual(b.map((x) => x.kind), ["text", "code"]);
  assert.equal(b[1].lang, "mermaid");
});

test("a table still streaming (no full delimiter row) is text", () => {
  assert.deepEqual(toBlocks("| a | b |\n|--").map((x) => x.kind), ["text"]);
});

test("CRLF text gives the same blocks as LF", () => {
  assert.deepEqual(toBlocks(ALL.replace(/\n/g, "\r\n")), toBlocks(ALL));
});

test("replyButtons: copy md is the text as written; copy html is marked's HTML with the Markdown as plain text", () => {
  const md = "**Hi** there\n\n```mermaid\ngraph TD\n A\n```";
  const [m, h] = replyButtons(md);
  assert.deepEqual(m, { label: "copy md", text: md });
  assert.equal(h.label, "copy html");
  assert.equal(h.text, md);
  assert.match(h.html, /<strong>Hi<\/strong>/);
  assert.match(h.html, /<pre><code class="language-mermaid">/);
});

test("tableArt: boxed, a rule between every row, headers centred, body aligned, wide characters two columns, fenced", () => {
  const tok = marked.lexer("| Mod | Status |\n|:--|--:|\n| core | ✓ |\n| 日本 | ok |")[0];
  assert.equal(tableArt(tok), ["```", "┌──────┬────────┐", "│ Mod  │ Status │", "├──────┼────────┤", "│ core │      ✓ │",
    "├──────┼────────┤", "│ 日本 │     ok │", "└──────┴────────┘", "```"].join("\n"));
});

test("tableArt: inline markup removed; a table wider than 100 columns wraps its cells", () => {
  const tok = marked.lexer("| a | b |\n|---|---|\n| **bold** `code` [link](http://x) | " + "word ".repeat(40) + "|")[0];
  const art = tableArt(tok).split("\n");
  assert.ok(art.some((l) => l.includes("bold code link")));
  assert.ok(art.every((l) => width(l) <= 100), "every line fits 100 columns");
  assert.equal(art.join(" ").match(/word/g).length, 40);
});

test("tableText: tab-separated plain text; cells with tabs, newlines or quotes are quoted; escaped pipes kept", () => {
  const tok = marked.lexer('| a | b |\n|---|---|\n| x \\| y | say "hi" |')[0];
  assert.equal(tableText(tok), 'a\tb\nx | y\t"say ""hi"""');
});

test("width: CJK counts two columns, ✓ one, a combining mark none", () => {
  assert.equal(width("日本"), 4);
  assert.equal(width("✓"), 1);
  assert.equal(width("é"), 1);
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --test tests/render-blocks.test.mjs`
Expected: FAIL, `Cannot find module '…/src/shared/render/blocks.js'`.

- [ ] **Step 4: Write `table-copy.js`**

Port `width`, `wrapRanges`, `longestWord`, `columnWidths` and `tableArt` from prismantis 0.20.0 `~/.claude/plugins/cache/prismantis/prismantis/0.20.0/hooks/render.tsx` (lines 19–50, 292–350; `ART_WIDTH = 100`) to plain JavaScript, with a credit comment (MIT). Their `displayText(cell)` becomes `cellText(cell.tokens)`: the plain text of `marked` inline tokens (a token with `tokens` recurses; otherwise its `text`; `escape` tokens give their character). `tableText` follows prismantis `html.ts` `tableText`/`tsvCell` over `cellText`. Alignment comes from `token.align` (`null` means left).

- [ ] **Step 5: Write `blocks.js`**

`toBlocks`: `splitSegments(text)` first (pictures keep today's rules and ids; it also turns CRLF into LF); each Markdown segment goes through `marked.lexer(seg.text, { gfm: true })` and each token maps by type: `table` → table (md `raw` trimmed; buttons md / art `tableArt` / html `{ text: tableText, html: marked.parser([token]) }`); `code` → code (`lang` = first word of `token.lang`, md `raw`, copy `token.text`); `list` → list (copy `raw` trimmed); `blockquote` → alert when `token.text` starts with `[!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` (any case; `md` and copy are the text after that first line, trimmed) else quote (copy `token.text` trimmed); anything else (`paragraph`, `heading`, `hr`, `html`, `space`, `def`, `text`) appends its `raw` to the current text block, which closes when another kind starts (`md` trimmed; empty text blocks dropped). Picture segments become `{ kind, source, id, buttons: [{ label: "copy source", text: source }] }`. `replyButtons` uses `marked.parse(text, { gfm: true })`.

- [ ] **Step 6: Run the tests**

Run: `node --test tests/render-blocks.test.mjs`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/shared/render/table-copy.js src/shared/render/blocks.js tests/render-blocks.test.mjs
git commit -m "feat(render): replies cut into blocks with prismantis's copies (md, art, html, copy, copy source)"
```

### Task 2: The conversation fold

**Files:**
- Modify: `src/shared/render/transcript.js` (`fold`, `readClaude`, `readCodex`)
- Create: `tests/fixtures/render/claude-conversation.jsonl`
- Modify: `tests/render-core.test.mjs` (the two `readClaude`/`readCodex` answer tests move to the new shape; the rest stay)

**Interfaces:**
- Produces (in `transcript.js`):
  - `MAX_EXCHANGES = 200`
  - `type Part = { type: "text", text: string, at: number|null } | { type: "marker", by: "you"|"event", event: string|null, text: string, at: number|null }`
  - `type Exchange = { id: string, by: "you"|"event", event: string|null, text: string, at: number|null, parts: Part[], running: boolean }`
  - `readClaude(lines: string[]): { exchanges: Exchange[], diagrams }` and `readCodex(lines)`: same shape; exchanges newest first, at most `MAX_EXCHANGES`; `diagrams` as today.
  - `replyText(ex: Exchange): string`: its text parts joined by `"\n\n"`.
  - `type Row = { id, by, event, text, at, preview: string, state: "reply"|"working"|"none", replyAt: number|null }`
  - `exchangeRow(ex: Exchange): Row`: `preview` is the first 120 characters of `replyText` with fenced blocks (fences and what's inside) dropped, `#*_>|` and backticks removed and whitespace collapsed; `state` is `"reply"` when `replyText` isn't empty, else `"working"` when `running`, else `"none"`; `replyAt` the last part's `at`.

- [ ] **Step 1: Write the fixture** `tests/fixtures/render/claude-conversation.jsonl`, one JSON object per line, in this order (timestamps one minute apart from `2026-11-25T09:00:00.000Z`):

| # | line | fields that matter |
|---|---|---|
| 1 | user | `uuid "u1"`, `origin {kind:"human"}`, content `"Draw the login flow"` |
| 2 | assistant | text "Here:\n\n```mermaid\nflowchart LR\n A-->B\n```", `stop_reason "end_turn"` |
| 3 | user | `uuid "u2"`, `origin {kind:"task-notification"}`, content `"<task-notification>\n<task-id>b1</task-id>\n<summary>Deploy finished (exit 0)</summary>\n</task-notification>"` |
| 4 | assistant | text "Deployed.", `stop_reason "end_turn"` |
| 5 | user | `uuid "u3"`, no origin, content `"<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>"` |
| 6 | user | `isMeta: true`, content `"<system-reminder>meta</system-reminder>"` |
| 7 | user | no origin, content `"<local-command-stdout>cleared</local-command-stdout>"` |
| 8 | user | `uuid "u4"`, no origin, content `"<task-notification>\n<summary>Old style event</summary>\n</task-notification>"` |
| 9 | user | `uuid "u5"`, `isCompactSummary: true`, content "This session is being continued…" |
| 10 | user | `uuid "u6"`, `origin {kind:"human"}`, content "Now the table" |
| 11 | assistant | text "Part one.", plus a `tool_use` `id "t1"`, `stop_reason "tool_use"` |
| 12 | attachment | `attachment {type:"queued_command", prompt:"also add a chart", origin:{kind:"human"}, commandMode:"prompt"}` |
| 13 | attachment | `attachment {type:"queued_command", prompt:"<task-notification>\n<summary>Lint passed</summary>\n</task-notification>", commandMode:"task-notification"}` |
| 14 | user | content `[{type:"tool_result", tool_use_id:"t1", content:"ok"}]` |
| 15 | assistant | text "Part two.", `stop_reason "end_turn"` |
| 16 | user | `uuid "u7"`, `origin {kind:"human"}`, content "And one more" |
| 17 | assistant | only a `tool_use` `id "t2"`, `stop_reason "tool_use"` (no result yet) |
| 18 | user | `isSidechain: true`, content "sub-agent prompt" |

- [ ] **Step 2: Write the failing tests** in `tests/render-core.test.mjs`

```js
test("readClaude: exchanges newest first; who started each; hidden lines start nothing", () => {
  const { exchanges: x } = readClaude(lines("claude-conversation.jsonl"));
  assert.deepEqual(x.map((e) => [e.id, e.by, e.event, e.text]), [
    ["u7", "you", null, "And one more"],
    ["u6", "you", null, "Now the table"],
    ["u5", "event", "compaction", ""],
    ["u4", "event", "task-notification", "Old style event"],
    ["u3", "you", null, "/clear"],
    ["u2", "event", "task-notification", "Deploy finished (exit 0)"],
    ["u1", "you", null, "Draw the login flow"],
  ]);
});

test("readClaude: what's sent while Claude works is a marker inside the running reply", () => {
  const ex = readClaude(lines("claude-conversation.jsonl")).exchanges.find((e) => e.id === "u6");
  assert.deepEqual(ex.parts.map((p) => [p.type, p.by ?? null, p.event ?? null, p.text]), [
    ["text", null, null, "Part one."],
    ["marker", "you", null, "also add a chart"],
    ["marker", "event", "task-notification", "Lint passed"],
    ["text", null, null, "Part two."],
  ]);
  assert.equal(replyText(ex), "Part one.\n\nPart two.");
});

test("exchangeRow: working only for the newest while Claude goes on; otherwise no reply text", () => {
  const x = readClaude(lines("claude-conversation.jsonl")).exchanges;
  assert.equal(exchangeRow(x[0]).state, "working");
  assert.equal(exchangeRow(x.find((e) => e.id === "u3")).state, "none");
  const u1 = exchangeRow(x.find((e) => e.id === "u1"));
  assert.equal(u1.state, "reply");
  assert.equal(u1.preview, "Here:");
});

test("readClaude: at most 200 exchanges, the newest", () => {
  const many = Array.from({ length: 250 }, (_, i) => JSON.stringify({ type: "user", uuid: `m${i}`, origin: { kind: "human" }, message: { content: `p${i}` } }));
  const x = readClaude(many).exchanges;
  assert.equal(x.length, 200);
  assert.equal(x[0].id, "m249");
});
```

Rewrite the existing answer tests on `claude.jsonl` / `codex.jsonl` to read `exchanges[0].text` (the last prompt, unchanged value) and `replyText(exchanges[0])` (the old `answer.text`, unchanged value); lines without `uuid` get `id` `"line-<index>"`.

- [ ] **Step 3: Run them to see them fail**

Run: `node --test tests/render-core.test.mjs`
Expected: FAIL (`replyText` is not exported / `exchanges` undefined).

- [ ] **Step 4: Implement the fold**

`readClaude` walks lines (skipping side chains and non-JSON). A `user` line: tool results remove their ids from the open-tool set and start nothing; `isMeta` starts nothing; `isCompactSummary` starts an event `compaction` with text `""`; otherwise `origin.kind === "human"` → you, another `origin.kind` → event with that kind; with no `origin`: text starting with `<task-notification>` → event `task-notification`, text holding `<command-name>` → you (text = the command name, plus a space and `<command-args>` when not empty), text starting with `<local-command-caveat>`, `<local-command-stdout>` or `<system-reminder>` → nothing, else you. An event's text is its `<summary>` when it has one, else its first non-empty line with tags removed, cut to 140 characters with `…`. An `attachment` line of type `queued_command` becomes a marker on the newest exchange (by you when `origin.kind === "human"` or `commandMode === "prompt"`, else event `origin.kind ?? commandMode`, text as above) or, with no exchange yet, starts one. Assistant text joins the newest exchange's parts; assistant `tool_use` ids join the open-tool set; the last assistant `stop_reason` is kept. At the end only the newest exchange can be `running`: last stop isn't `"end_turn"` or a tool call is open. `readCodex`: user messages (minus its injected context) start you exchanges; `running` is true for the newest when it has no text. `fold`'s diagram walk is unchanged.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/render-core.test.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/render/transcript.js tests/render-core.test.mjs tests/fixtures/render/claude-conversation.jsonl
git commit -m "feat(render): a session folds into exchanges — who started each, markers for what arrives mid-reply"
```

### Task 3: The helper — rows, open blocks, file blocks, `clip`

**Files:**
- Create: `src/app/clipboard.js`
- Modify: `src/app/render-helper.js` (`fromLog`, `run`, header comment)
- Modify: `tests/render-helper.test.mjs` (claude/codex/file expectations move to the new shape)
- Create: `tests/render-clipboard.test.mjs`

**Interfaces:**
- Consumes: Task 1 `toBlocks`, `replyButtons`; Task 2 `readClaude`, `readCodex`, `exchangeRow`, `replyText`; Task 4's `OPEN_NEWEST` (defined here first as `export const OPEN_NEWEST = 3` in `src/shared/render/view.js`; Task 4 adds the rest of that file).
- Produces:
  - `claude` / `codex` request gains `open?: string[]`; response `{ ok: true, source, file, canHtml: boolean, exchanges: Row[], open: { [id]: { reply: Array<Block | { kind: "marker", by, event, text }>, buttons: Button[] } }, diagrams }`. Without `open`, the newest `OPEN_NEWEST` are opened. Picture blocks carry `svg`/`w`/`h` or `error` (today's `render`).
  - `file` response `{ ok: true, path, canHtml, blocks: Block[], buttons: Button[] }` (`buttons` = `replyButtons` of the whole file).
  - `clip` request `{ mode: "clip", html, text }` → `{ ok: true }` or `{ ok: false, error }`.
  - `clipboard.js`: `MAC_HTML_COPY: string`; `copyHtml({ html, text }, { platform = process.platform, run } = {}): { ok: true } | { ok: false, error: string }`, where `run(cmd, args, input)` defaults to `spawnSync(cmd, args, { input, encoding: "utf8", timeout: 5000 })`.

- [ ] **Step 1: Write the failing tests**

`tests/render-clipboard.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { copyHtml, MAC_HTML_COPY } from "../src/app/clipboard.js";

test("copyHtml: runs osascript's JavaScript with the payload on stdin", () => {
  let call;
  const r = copyHtml({ html: "<b>x</b>", text: "x" }, { platform: "darwin", run: (cmd, args, input) => { call = { cmd, args, input }; return { status: 0, stdout: "", stderr: "" }; } });
  assert.deepEqual(r, { ok: true });
  assert.equal(call.cmd, "/usr/bin/osascript");
  assert.deepEqual(call.args, ["-l", "JavaScript", "-e", MAC_HTML_COPY]);
  assert.deepEqual(JSON.parse(call.input), { html: "<b>x</b>", text: "x" });
  assert.match(MAC_HTML_COPY, /NSPasteboardTypeHTML/);
});

test("copyHtml: a failed or timed-out run says why; off macOS it is refused", () => {
  assert.equal(copyHtml({ html: "h", text: "t" }, { platform: "darwin", run: () => ({ status: 1, stderr: "Cannot write clipboard" }) }).error, "Cannot write clipboard");
  assert.match(copyHtml({ html: "h", text: "t" }, { platform: "darwin", run: () => ({ status: null, error: new Error("spawnSync ETIMEDOUT") }) }).error, /ETIMEDOUT/);
  assert.equal(copyHtml({ html: "h", text: "t" }, { platform: "linux", run: () => assert.fail("must not run") }).error, "formatted copy works on macOS only");
});
```

In `tests/render-helper.test.mjs` (keeping its `run`/`home` helpers), replace the claude/file expectations with:

```js
test("claude: rows for every exchange, blocks for the newest three, canHtml", () => {
  const x = home();
  try {
    const out = run({ ...x.base, mode: "claude", transcript: join(FIX, "claude-conversation.jsonl") });
    assert.equal(out.ok, true);
    assert.equal(out.canHtml, process.platform === "darwin");
    assert.deepEqual(out.exchanges.map((r) => r.id), ["u7", "u6", "u5", "u4", "u3", "u2", "u1"]);
    assert.deepEqual(Object.keys(out.open).sort(), ["u5", "u6", "u7"]);
    assert.deepEqual(out.open.u6.reply.map((b) => b.kind), ["text", "marker", "marker", "text"]);
    assert.deepEqual(out.open.u6.buttons.map((b) => b.label), ["copy md", "copy html"]);
  } finally { x.done(); }
});

test("claude: open ids choose the blocks sent; ids that aren't there are ignored; pictures are drawn", () => {
  const x = home();
  try {
    const out = run({ ...x.base, mode: "claude", transcript: join(FIX, "claude-conversation.jsonl"), open: ["u1", "gone"] });
    assert.deepEqual(Object.keys(out.open), ["u1"]);
    const pic = out.open.u1.reply.find((b) => b.kind === "mermaid");
    assert.match(pic.svg, /^herdr-dock\/render\/.+\.svg$/);
  } finally { x.done(); }
});

test("file: blocks with their buttons and the whole file's copy md / copy html", () => {
  const x = home();
  try {
    const path = join(x.h, "plan.md");
    writeFileSync(path, "# Plan\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```sh\nnpm test\n```\n");
    const out = run({ ...x.base, mode: "file", path });
    assert.deepEqual(out.blocks.map((b) => b.kind), ["text", "table", "code"]);
    assert.deepEqual(out.buttons.map((b) => b.label), ["copy md", "copy html"]);
    assert.equal(out.canHtml, process.platform === "darwin");
  } finally { x.done(); }
});

test("clip: a request without html and text is refused without touching the clipboard", () => {
  assert.deepEqual(run({ mode: "clip" }), { ok: false, error: "clip needs html and text" });
});
```

The existing `claude.jsonl` / codex / figure tests switch from `out.answer.segments` to `out.open[<newest id>].reply` and from `out.prompt` to `out.exchanges[0].text`, same values.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/render-clipboard.test.mjs tests/render-helper.test.mjs`
Expected: FAIL (`clipboard.js` missing; `out.exchanges` undefined).

- [ ] **Step 3: Write `clipboard.js`**

`MAC_HTML_COPY` is prismantis 0.20.0 `hooks/clipboard.ts` `MAC_TABLE_COPY` (MIT, credit comment) with its error text `Cannot encode table` reading `Cannot encode copy`. `copyHtml` returns `{ ok: false, error: "formatted copy works on macOS only" }` off darwin; otherwise runs it, and a non-zero status or `error` gives `{ ok: false, error }` from the first line of stderr, else `error.message`.

- [ ] **Step 4: Rework the helper**

`fromLog` reads exchanges, maps them through `exchangeRow`, and for each requested-and-present id (default: the newest `OPEN_NEWEST`) builds `reply` (text parts → `toBlocks`, pictures through `render`; marker parts → `{ kind: "marker", by, event, text }`) and `buttons` (`replyButtons(replyText(ex))`). `canHtml: process.platform === "darwin"` on claude, codex and file responses. `file` returns `blocks` (pictures rendered) and `buttons`. `clip` answers `{ ok: false, error: "clip needs html and text" }` unless both are strings, then returns `copyHtml(req)`. Update the header comment's mode list.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/render-clipboard.test.mjs tests/render-helper.test.mjs tests/render-core.test.mjs tests/render-blocks.test.mjs`
Expected: all pass.

- [ ] **Step 6: Check the timing on a real session**

Run: `ls -S ~/.claude/projects/*/*.jsonl | head -1` to pick the largest transcript, then time `node src/app/render-helper.js '<claude request with that transcript and a temp cacheDir>'` three times.
Expected: under 0.4 s wall once its diagrams are cached (today's 0.11 s plus the blocks). Note the numbers in the ledger.

- [ ] **Step 7: Commit**

```bash
git add src/app/clipboard.js src/app/render-helper.js src/shared/render/view.js tests/render-helper.test.mjs tests/render-clipboard.test.mjs
git commit -m "feat(render): the helper returns every exchange, blocks for the open ones, and copies formatted text on macOS"
```

### Task 4: The view model

**Files:**
- Modify: `src/shared/render/view.js` (created in Task 3 with `OPEN_NEWEST`)
- Test: `tests/render-view.test.mjs`

**Interfaces:**
- Consumes: `Row`, `Button` (Tasks 1–3).
- Produces (in `view.js`):
  - `OPEN_NEWEST = 3`, `HTML_LIMIT = 512 * 1024`, `PROMPT_LINES = 12`
  - `openIds(rows: Row[], toggled: Map<string, boolean>): string[]`: newest `OPEN_NEWEST` open unless toggled closed; others open when toggled open; in row order.
  - `ROLE_COLOR = { you: "ansi4", claude: "ansi5", event: "ansi3" }`
  - `ALERTS = { note: { title: "Note", color: "ansi4" }, tip: { title: "Tip", color: "ansi2" }, important: { title: "Important", color: "ansi5" }, warning: { title: "Warning", color: "ansi3" }, caution: { title: "Caution", color: "ansi1" } }`
  - `speakerLabel(role: "you"|"claude"|"event", event?: string|null): string`
  - `shownButtons(buttons: Button[], canHtml: boolean): Button[]`
  - `copyPlan(button: Button, canHtml: boolean): { how: "plain" } | { how: "html" } | { how: "plain", note: string }`
  - `promptView(text: string, showAll: boolean): { text: string, more: boolean }`
  - `replyNote(row: Row): string | null`
  - `viewOf(stored: unknown): "conversation" | "diagrams" | "files"`

- [ ] **Step 1: Write the failing tests** in `tests/render-view.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { copyPlan, openIds, promptView, replyNote, shownButtons, speakerLabel, viewOf } from "../src/shared/render/view.js";

const rows = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

test("openIds: the newest three, plus or minus what was toggled", () => {
  assert.deepEqual(openIds(rows, new Map()), ["a", "b", "c"]);
  assert.deepEqual(openIds(rows, new Map([["b", false], ["e", true]])), ["a", "c", "e"]);
});

test("speakerLabel: you, Claude, events by kind", () => {
  assert.equal(speakerLabel("you"), "YOU");
  assert.equal(speakerLabel("claude"), "CLAUDE");
  assert.equal(speakerLabel("event", "task-notification"), "BACKGROUND TASK");
  assert.equal(speakerLabel("event", "compaction"), "CONTEXT COMPACTED");
  assert.equal(speakerLabel("event", "scheduled_wakeup"), "SCHEDULED WAKEUP");
  assert.equal(speakerLabel("event", null), "EVENT");
});

test("shownButtons and copyPlan: html only where it works and fits", () => {
  const md = { label: "md", text: "x" }, html = { label: "html", text: "x", html: "<p>x</p>" };
  assert.deepEqual(shownButtons([md, html], false), [md]);
  assert.deepEqual(shownButtons([md, html], true), [md, html]);
  assert.deepEqual(copyPlan(md, true), { how: "plain" });
  assert.deepEqual(copyPlan(html, true), { how: "html" });
  assert.deepEqual(copyPlan({ ...html, html: "x".repeat(512 * 1024) }, true), { how: "plain", note: "too large for a formatted copy" });
});

test("promptView: twelve lines, then show all", () => {
  const long = Array.from({ length: 15 }, (_, i) => `l${i}`).join("\n");
  assert.deepEqual(promptView(long, false), { text: long.split("\n").slice(0, 12).join("\n"), more: true });
  assert.deepEqual(promptView(long, true), { text: long, more: false });
});

test("replyNote and viewOf", () => {
  assert.equal(replyNote({ state: "working" }), "working…");
  assert.equal(replyNote({ state: "none" }), "no reply text");
  assert.equal(replyNote({ state: "reply" }), null);
  assert.equal(viewOf("answer"), "conversation");
  assert.equal(viewOf("files"), "files");
  assert.equal(viewOf(undefined), "conversation");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/render-view.test.mjs`
Expected: FAIL (`openIds` is not exported).

- [ ] **Step 3: Implement the rest of `view.js`** (pure, no host imports). `copyPlan` measures `html.length + text.length` against `HTML_LIMIT`. Unknown event kinds: `-`/`_` runs become spaces, upper-cased.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/render-view.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/render/view.js tests/render-view.test.mjs
git commit -m "feat(render): the Conversation view model — what's open, labels, colours, which copies show"
```

### Task 5: Drawing it, the README, the app build

**Files:**
- Modify: `src/mods/dock-render/main.js`
- Modify: `README.md` (the Render section)
- Regenerate: `app/` (`npm run build:app`)

**Interfaces:**
- Consumes: the helper responses (Task 3) and everything in `view.js` (Task 4).
- Produces: the drawn panel; no new exports.

- [ ] **Step 1: Tabs and state**

`VIEWS` = `[["conversation", "Conversation"], ["diagrams", "Diagrams"], ["files", "Files"]]`; `view()` returns `viewOf(shared(VIEW_KEY))`; the `answer` command calls `setView("conversation")`. New state, reset in `follow` when the agent changes: `toggled = new Map()`, `showAll = new Set()`, `opening = new Set()`, `copied = null` (`{ key, note? }`). `load` sends `open: openIds(this.data?.exchanges ?? [], this.toggled)` once data exists (none on the first read: the helper opens the newest three).

- [ ] **Step 2: Draw the conversation**

For each row: an open one draws its turn (3 px left border in `t[ROLE_COLOR[by]]`, background that colour + `"14"`, a label `speakerLabel(by, event) · <ago> ago` in that colour at 11 px semibold, then `promptView` text as `TextView.markdown`, selectable, with `show all` when `more`), then Claude's reply (border `t.ansi5`, no tint, label `CLAUDE`; `replyNote(row)` in `t.dim` when set; else the blocks; then the reply's `shownButtons` right-aligned). A folded row is one line: the rail, the label, the turn text and `· preview`, truncated; clicking it toggles `this.toggled`, and when `this.data.open[id]` is missing it adds the id to `opening` (the row shows `opening…`) and calls `load`. Exchanges are separated by a dashed rule (`border_dashed` if the kit has it, else a 1 px `t.border` line).

Blocks: `text`/`list`/`quote`/`table` → `TextView.markdown(md)` selectable, with their buttons above on the right (table) or at the top right (list, quote); `code` → a row with the language in `t.dim` and `copy` on the right, over `TextView.markdown("```" + lang + "\n" + copy text + "\n```")`; `alert` → a box with a 3 px left border in `t[ALERTS[a].color]`, background that colour + `"14"`, the title in that colour, `TextView.markdown(md)`, `copy` top right; pictures → today's `diagram(...)` with `copy source` beside it; `marker` → a one-line row with a 3 px rail in its speaker's colour: `YOU, while Claude worked: <text>` or `<speakerLabel> · <text>`.

- [ ] **Step 3: Copying**

A button: 10.5 px text in `t.muted`, 1 px `t.border` border, rounded 5, `hover` to `t.foreground`. On click: `copyPlan(button, this.data.canHtml)`; `plain` → `cx.write_to_clipboard(button.text)`; `html` → `await this.helper({ mode: "clip", html: button.html, text: button.text })`, and on `!ok` write `button.text` with `note: "copied as plain text: " + error`; a plan with `note` writes the text and shows that note. Set `this.copied = { key, note }`, notify, and clear it after `cx.sleep(1500)` if unchanged. While `copied.key` matches, the label reads `copied` in `t.ansi2`; a note shows under the block in `t.dim`.

- [ ] **Step 4: Files tab**

An opened file draws `blocks` through the same block drawing, with its `buttons` (`copy md` / `copy html`) at the top on the right.

- [ ] **Step 5: README**

In the Render section: the Answer bullet becomes **Conversation** (every exchange newest first; you / Claude / events on blue / magenta / amber rails; newest three open, older ones fold; what arrives while Claude works shows inside its reply); a **Copy buttons** bullet listing the labels and what each copies, html on macOS only; credits: `marked` (MIT) bundled; table art, width and wrapping, and the pasteboard script ported from prismantis (MIT); keys `dock-render.conversation|diagrams|files|refresh|clear` (`answer` still works).

- [ ] **Step 6: Build, check, test**

Run: `npm run build:app && herdr-app check app/mods/dock-render && npm test 2>&1 | tail -5`
Expected: build passes (the mermaid patch check included), `herdr-app check` passes, tests pass except the known `tests/dock-core-class.test.mjs`.

- [ ] **Step 7: Look at it in Herdr**

Run the built mod in the user's Herdr only through the normal deploy when asked; before that, check by hand what can be checked without deploying: `node app/mods/dock-render/herdr-render.mjs '<claude request for this session's transcript>'` returns rows and open blocks, and `{ "mode": "clip", "html": "<b>copy test</b>", "text": "copy test" }` returns `{ "ok": true }` on macOS (this writes the real clipboard; say so in the report).
Expected: as described; note anything off in the ledger.

- [ ] **Step 8: Commit**

```bash
git add src/mods/dock-render/main.js README.md app
git commit -m "feat(render): the Conversation tab — speakers on coloured rails, replies as blocks with copy buttons"
```
