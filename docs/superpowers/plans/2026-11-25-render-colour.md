# Render Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Render panel draws every reply block itself, coloured like prismantis in the Herdr theme's colours, within a measured 64 KB budget (pages for long files and replies, folding for open exchanges).

**Architecture:** The helper turns Markdown into runs (inline styles, numbers, paths) and code into coloured lines (prismantis's shell colouring, Prism for other languages), cuts long content into pages, and sends only what's drawn; the panel paints runs as word pieces, tables as a grid, lists, quotes and alerts around their blocks. Pure logic lives in `src/shared/render/` with Node tests; nothing the panel imports may use `Intl`.

**Tech Stack:** JavaScript (ESM), `marked` 18.2.0, `prismjs` 1.30.0, gpui-kit mod UI, esbuild, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-render-colour-design.md`

## Global Constraints

- `prismjs` pinned exactly at **1.30.0** (MIT), a devDependency bundled into `herdr-render.mjs`; credit prismantis 0.20.0 (MIT) for the number/path patterns, the shell colouring and the Prism colour mapping, in code comments and the README.
- Budget: `BUDGET = 64 * 1024` bytes of Markdown (UTF-8) drawn at once, measured in the spike (64 KB fine, 192 KB very laggy, 256 KB interrupted).
- Nothing imported by `src/mods/dock-render/main.js` may use `Intl` (the mod runtime lacks it; `table-copy.js` and `figure.js` do use it).
- Patterns verbatim: `NUMBER = /(?<![\w.#/-])(v?\d+(?:[.,:]\d+)*(?:%|ms|s|m|h|d|Gi|Mi|GB|MB|KB|x)?)(?![\w/])/g`, `PATH = /(?<![\w/.:])((?:~|\.{1,2})?\/[\w.@+-]+(?:\/[\w.@+-]*)*)/g`; a path wins where they overlap; neither applies inside inline code or links.
- Shell languages: `lang === ""` or `/^(sh|bash|zsh|shell|console|fish|powershell|ps1)$/i`.
- Colours (role → theme key) exactly as the spec's §3 table; code roles: `comment`→`dim`, `string`→`ansi2`, `number`→`ansi5`, `keyword`→`ansi4`, `function`→`ansi6`, `property`→`ansi4`, `attr`→`ansi5`, `regex`→`ansi6`, plain→`foreground`.
- Pictures (mermaid, figure) unchanged; `LOOK_VERSION` unchanged.
- `app/` is generated (`npm run build:app`); `herdr-app check app/mods/dock-render` must pass. Known baseline failure: `tests/dock-core-class.test.mjs`.

## Review Focus

- A reply still streaming (unclosed fence, half a table, a list item cut mid-word): drawn content never throws (Task 3 test "streaming input").
- A table wider than the panel, or with a cell holding one very long word: columns fit, cells wrap, the table scrolls sideways rather than overflow (Task 5 test "columnWidths: …").
- A single reply or code block bigger than the budget: it's paged, never drawn whole (Task 4 test "a code block bigger than a page is cut by lines").
- Opening exchange after exchange: the open total stays under the budget, the newest one opened stays open (Task 5 test "openWithin: …").
- A light theme: every role uses a theme key, none hard-coded (Task 5 test "COLOURS: every role is a theme key").

---

### Task 1: Runs

**Files:**
- Create: `src/shared/render/runs.js`
- Test: `tests/render-runs.test.mjs`

**Interfaces:**
- Produces: `type Run = { text: string, role?: "strong"|"em"|"code"|"link"|"number"|"path"|"del", bold?: true, italic?: true, strike?: true, href?: string }`; `inlineRuns(tokens: object[]): Run[]` (marked inline tokens); `decorate(text: string, base?: object): Run[]`.

- [ ] **Step 1: Write the failing tests** in `tests/render-runs.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { decorate, inlineRuns } from "../src/shared/render/runs.js";

const runs = (md) => inlineRuns(marked.lexer(md)[0].tokens);

test("inlineRuns: bold, italic, strike, code, links, line breaks", () => {
  assert.deepEqual(runs("a **b** *c* ~~d~~ `e` [f](http://g)"), [
    { text: "a " }, { text: "b", role: "strong", bold: true }, { text: " " }, { text: "c", role: "em", italic: true },
    { text: " " }, { text: "d", strike: true, role: "del" }, { text: " " }, { text: "e", role: "code" }, { text: " " },
    { text: "f", role: "link", href: "http://g" },
  ]);
  assert.deepEqual(runs("x  \ny").map((r) => r.text), ["x", "\n", "y"]);
});

test("decorate: numbers and paths in plain text; a path wins an overlap; nothing inside code or links", () => {
  assert.deepEqual(decorate("26 checks in 41s at ~/a/b.json v1.2"), [
    { text: "26", role: "number" }, { text: " checks in " }, { text: "41s", role: "number" }, { text: " at " },
    { text: "~/a/b.json", role: "path" }, { text: " " }, { text: "v1.2", role: "number" },
  ]);
  assert.deepEqual(runs("`port 80` [see /x](http://h)").map((r) => r.role ?? null), ["code", null, "link"]);
});

test("inlineRuns: bold keeps numbers coloured inside it, still bold", () => {
  assert.deepEqual(runs("**26 passed**"), [{ text: "26", role: "number", bold: true }, { text: " passed", role: "strong", bold: true }]);
});

test("inlineRuns: raw inline HTML shows as its text", () => {
  assert.equal(runs("a <kbd>Ctrl</kbd> b").map((r) => r.text).join(""), "a <kbd>Ctrl</kbd> b");
});
```

- [ ] **Step 2: Run** `node --test tests/render-runs.test.mjs` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement `runs.js`** (credit prismantis for NUMBER/PATH): walk tokens with an inherited base (`strong` → `{bold, role:"strong"}`, `em` → `{italic, role:"em"}`, `del` → `{strike, role:"del"}`); `codespan` → `{role:"code"}` (no decorate); `link` → `{role:"link", href}` over its text (no decorate); `br` → `"\n"`; `escape` → its text; `html` and `text` → `decorate(text, base)` where a number or path keeps the base's `bold`/`italic`/`strike` but takes role `number`/`path`. Adjacent runs with identical style merge. No `Intl`.
- [ ] **Step 4: Run** the tests — Expected: all pass.
- [ ] **Step 5: Commit** `git add src/shared/render/runs.js tests/render-runs.test.mjs && git commit -m "feat(render): inline Markdown as coloured runs — numbers and paths as prismantis marks them"`

### Task 2: Coloured code lines

**Files:**
- Modify: `package.json`, `package-lock.json` (`prismjs` 1.30.0)
- Create: `src/shared/render/code-colour.js`
- Test: `tests/render-code-colour.test.mjs`

**Interfaces:**
- Produces: `type CodeRun = { text: string, role?: "comment"|"string"|"number"|"keyword"|"function"|"property"|"attr"|"regex" }`; `codeLines(code: string, lang: string): CodeRun[][]` (one array per line, empty line → `[]`); `isShellLang(lang: string): boolean`.

- [ ] **Step 1: Add the dependency** — Run: `npm install --save-dev --save-exact prismjs@1.30.0` — Expected: `"prismjs": "1.30.0"` in devDependencies.
- [ ] **Step 2: Write the failing tests** in `tests/render-code-colour.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { codeLines, isShellLang } from "../src/shared/render/code-colour.js";

const roles = (line) => line.map((r) => [r.text, r.role ?? null]);

test("shell (and unlabelled) code: command, flags, strings, comments, restarting after | && ; ||", () => {
  assert.ok(isShellLang("") && isShellLang("BASH") && isShellLang("ps1") && !isShellLang("js"));
  const [a, b] = codeLines('npm run deploy --dry-run "x" | grep ok\n# done', "bash");
  assert.deepEqual(roles(a).filter(([t]) => t.trim()), [["npm", "function"], ["run", null], ["deploy", null], ["--dry-run", "keyword"], ['"x"', "string"], ["|", null], ["grep", "function"], ["ok", null]]);
  assert.deepEqual(roles(b), [["# done", "comment"]]);
  assert.deepEqual(codeLines("ls  -la", "").length, 1);
});

test("Prism languages: keywords, strings, numbers, comments, functions", () => {
  const [line] = codeLines('const x = f("a", 2); // c', "js");
  const got = Object.fromEntries(roles(line).filter(([, r]) => r));
  assert.equal(got.const, "keyword");
  assert.equal(got['"a"'], "string");
  assert.equal(got["2"], "number");
  assert.equal(got["// c"], "comment");
  assert.equal(got.f, "function");
  assert.equal(roles(codeLines("def f(): pass", "py")[0]).find(([t]) => t === "def")[1], "keyword");
});

test("a language neither knows is plain; lines and empty lines are kept; text is never lost", () => {
  const code = "a b\n\n  c";
  const lines = codeLines(code, "brainfuck-ish");
  assert.deepEqual(lines.map((l) => l.map((r) => r.text).join("")), ["a b", "", "  c"]);
  assert.ok(lines.flat().every((r) => !r.role));
  const ts = codeLines("let s: string = `t${1}`;\n", "ts");
  assert.equal(ts.map((l) => l.map((r) => r.text).join("")).join("\n"), "let s: string = `t${1}`;\n");
});
```

- [ ] **Step 3: Run** `node --test tests/render-code-colour.test.mjs` — Expected: FAIL, module not found.
- [ ] **Step 4: Implement `code-colour.js`**: `isShellLang` and the shell colouring are prismantis 0.20.0 `render.tsx` `isShellLang`/`codeLine` (credited): a line with box-drawing glyphs is plain; `/^\s*#/` → one `comment` run; else split on `/("[^"]*"|'[^']*'|\s+)/`, quotes → `string`, `/^--?[\w-]/` → `keyword`, the first part that isn't `/^[$>|&;]+$/` → `function`, and `|`, `&&`, `;`, `||` reset it. Other languages: `import Prism from "prismjs"` then the components (`prism-markup`, `prism-css`, `prism-clike`, `prism-javascript`, `prism-typescript`, `prism-jsx`, `prism-tsx`, `prism-python`, `prism-go`, `prism-rust`, `prism-java`, `prism-kotlin`, `prism-swift`, `prism-c`, `prism-cpp`, `prism-csharp`, `prism-ruby`, `prism-json`, `prism-yaml`, `prism-toml`, `prism-sql`, `prism-docker`, `prism-hcl`, `prism-diff`) in that order; aliases `js`, `ts`, `py`, `yml`, `rb`, `cs`, `c++`, `dockerfile`, `html`, `xml`, `golang`; `Prism.tokenize(code, grammar)`, flattened with the token type (and its alias) mapped by prismantis's `PRISM_COLORS` onto the roles in Global Constraints (`codeComment`→`comment`, `codeString`→`string`, `number`→`number`, `codeFlag`→`keyword`, `codeCommand`→`function`, `link`→`property`, `emphasis`→`attr`, `path`→`regex`), split at `\n` into lines.
- [ ] **Step 5: Run** the tests — Expected: all pass.
- [ ] **Step 6: Commit** `git add package.json package-lock.json src/shared/render/code-colour.js tests/render-code-colour.test.mjs && git commit -m "feat(render): code coloured as prismantis colours it — shell by hand, other languages by Prism"`

### Task 3: Blocks carry what the panel draws

**Files:**
- Create: `src/shared/render/columns.js` (move `columnWidths` here from `table-copy.js`; `table-copy.js` imports it)
- Modify: `src/shared/render/blocks.js`, `src/shared/render/table-copy.js`
- Test: `tests/render-blocks.test.mjs` (existing tests keep passing; add)

**Interfaces:**
- Consumes: `inlineRuns` (Task 1), `codeLines` (Task 2).
- Produces (each block keeps `kind`, `md`, `buttons`, and gains `bytes` = UTF-8 length of `md`, or of `source` for pictures):
  - text: `parts: Array<{ type: "heading", level: 1-6, runs: Run[] } | { type: "para", runs: Run[] } | { type: "rule" } | { type: "html", text: string }>`, and a `copy` button (`{ label: "copy", text: md }`).
  - list: `items: Array<{ marker: string, blocks: Block[] }>` — marker `"•"`, `"<n>."` (from the list's `start`), `"☐"`, `"☑"`; a tight item's text becomes one text block.
  - quote and alert: `blocks: Block[]`.
  - table: `header: Run[][]`, `rows: Run[][][]`, `align: ("left"|"center"|"right"|null)[]`, `natural: number[]`, `words: number[]` (per-column display widths of the widest cell and the longest word, for `columnWidths`).
  - code: `lines: CodeRun[][]`.
  - `columns.js`: `columnWidths(natural: number[], available: number, gap: number, words?: number[]): number[]` (unchanged arithmetic, no `Intl`).

- [ ] **Step 1: Write the failing tests** (append to `tests/render-blocks.test.mjs`)

```js
import { columnWidths } from "../src/shared/render/columns.js";

test("drawn content: headings, paragraphs and rules as parts with runs; a text block gets copy", () => {
  const [b] = toBlocks("# Deploy\n\nMain at **6b1**.\n\n---");
  assert.deepEqual(b.parts.map((p) => p.type), ["heading", "para", "rule"]);
  assert.equal(b.parts[0].level, 1);
  assert.deepEqual(b.parts[1].runs.find((r) => r.bold), { text: "6b1", role: "strong", bold: true });
  assert.deepEqual(b.buttons, [{ label: "copy", text: b.md }]);
  assert.equal(b.bytes, Buffer.byteLength(b.md));
});

test("drawn content: lists nest, number from their start, tick tasks, keep code in an item", () => {
  const [l] = toBlocks("3. a\n4. b\n   - c\n\n     ```sh\n     ls\n     ```");
  assert.deepEqual(l.items.map((i) => i.marker), ["3.", "4."]);
  const inner = l.items[1].blocks;
  assert.equal(inner.find((x) => x.kind === "list").items[0].marker, "•");
  assert.ok(JSON.stringify(inner).includes('"kind":"code"'));
  assert.deepEqual(toBlocks("- [x] done\n- [ ] todo")[0].items.map((i) => i.marker), ["☑", "☐"]);
});

test("drawn content: quotes and alerts hold blocks; tables carry runs, alignment and widths; code carries lines", () => {
  assert.equal(toBlocks("> a **b**")[0].blocks[0].parts[0].runs[1].role, "strong");
  assert.equal(toBlocks("> [!NOTE]\n> x")[0].blocks[0].kind, "text");
  const [t] = toBlocks("| Step | Time |\n|---|--:|\n| Push | 3s |");
  assert.deepEqual(t.header.map((c) => c.map((r) => r.text).join("")), ["Step", "Time"]);
  assert.deepEqual(t.rows[0][1], [{ text: "3s", role: "number" }]);
  assert.deepEqual(t.align, [null, "right"]);
  assert.deepEqual(t.natural, [4, 4]);
  assert.equal(toBlocks("```js\nlet a = 1\n```")[0].lines[0][0].role, "keyword");
});

test("streaming input never throws: unclosed fence, half a table, an item cut mid-word", () => {
  for (const s of ["```js\nlet a", "| a | b |\n|--", "- ite", "> [!WARN", "**bo"]) assert.doesNotThrow(() => toBlocks(s), s);
});

test("columnWidths moved to columns.js, same results", () => {
  assert.deepEqual(columnWidths([4, 6], 96, 3), [4, 6]);
  assert.deepEqual(columnWidths([14, 199], 93, 3, [14, 4]).reduce((a, b) => a + b), 90);
});
```

- [ ] **Step 2: Run** `node --test tests/render-blocks.test.mjs` — Expected: the new tests FAIL (`parts` undefined / module not found); the old ones still pass. The old test "toBlocks: kinds in order; consecutive text merges and has no buttons" changes its `assert.deepEqual(b[0].buttons, [])` to `assert.deepEqual(b[0].buttons, [{ label: "copy", text: "# Title\n\nIntro para." }])` (and its name to "…and has a copy button"): the spec gives text blocks a copy button.
- [ ] **Step 3: Implement**: create `columns.js` with `columnWidths` moved verbatim (prismantis credit) and import it in `table-copy.js`; in `blocks.js` build the drawn content from the tokens already lexed (`heading`/`paragraph`/`hr`/`html`/`space` → text parts; list items via their own `tokens`, recursively through the same token mapping, a tight item's `text` token giving one text block; quote/alert via `marked.lexer` of their body; table cells via `inlineRuns(cell.tokens)`, `natural`/`words` via `width`/`longestWord` from `table-copy.js`; code via `codeLines(token.text, lang)`), and `bytes` on every block.
- [ ] **Step 4: Run** `node --test tests/render-blocks.test.mjs tests/render-runs.test.mjs tests/render-code-colour.test.mjs` — Expected: all pass.
- [ ] **Step 5: Commit** `git add src/shared/render/{blocks,table-copy,columns}.js tests/render-blocks.test.mjs && git commit -m "feat(render): blocks carry their drawn content — runs, list items, table cells, coloured code"`

### Task 4: Pages and the helper

**Files:**
- Create: `src/shared/render/budget.js` (`export const BUDGET = 64 * 1024;` — its own file so the panel can import it without `Intl`)
- Create: `src/shared/render/pages.js`
- Modify: `src/app/render-helper.js`, `src/shared/render/transcript.js` (rows carry `size`)
- Test: `tests/render-pages.test.mjs`, `tests/render-helper.test.mjs`

**Interfaces:**
- Consumes: `toBlocks` with `bytes` (Task 3).
- Produces:
  - `budget.js`: `BUDGET = 64 * 1024`. `pages.js` re-exports it and has `paginate(blocks: Block[], budget = BUDGET): Block[][]` — consecutive blocks while the page's `bytes` stay within budget; a code block over the budget cut into code blocks by lines (each ≤ budget), a table by rows with its header repeated; any other single block over the budget forms its own page.
  - `exchangeRow(ex)` gains `size` (UTF-8 bytes of the turn text plus the reply text).
  - `claude`/`codex` request gains `pages?: { [id]: number }` (0-based) and `full?: string[]`; `open[id]` becomes `{ turn: Block[], turnMore: boolean, reply: Block[], page: number, pageCount: number, buttons: Button[] }` — `turn` is the blocks of the turn's first 12 lines unless the id is in `full`; `reply` is that page of `paginate(replyBlocks)`.
  - `file` request gains `page?: number`; the answer gains `page`, `pageCount`, and `blocks` is that page.

- [ ] **Step 1: Write the failing tests**

`tests/render-pages.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { BUDGET, paginate } from "../src/shared/render/pages.js";
import { toBlocks } from "../src/shared/render/blocks.js";

test("small content is one page; pages never exceed the budget and cut only between blocks", () => {
  assert.equal(BUDGET, 65536);
  assert.equal(paginate(toBlocks("a\n\n- b")).length, 1);
  const para = "word ".repeat(2000);                    // ~10 KB a paragraph
  const pages = paginate(toBlocks(Array.from({ length: 20 }, () => para).join("\n\n```sh\nls\n```\n\n")));
  assert.ok(pages.length >= 3);
  assert.ok(pages.every((p) => p.reduce((n, b) => n + b.bytes, 0) <= BUDGET));
});

test("a code block bigger than a page is cut by lines; a table by rows with its header repeated", () => {
  const code = "```js\n" + Array.from({ length: 4000 }, (_, i) => `let v${i} = ${i}; // some text`).join("\n") + "\n```";
  const pages = paginate(toBlocks(code));
  assert.ok(pages.length > 1 && pages.every((p) => p[0].kind === "code" && p[0].bytes <= BUDGET));
  assert.equal(pages.flatMap((p) => p[0].lines).length, 4000);
  const table = "| a | b |\n|---|---|\n" + Array.from({ length: 3000 }, (_, i) => `| row ${i} | ${"x".repeat(20)} |`).join("\n");
  const tp = paginate(toBlocks(table));
  assert.ok(tp.length > 1 && tp.every((p) => p[0].header.length === 2));
  assert.equal(tp.flatMap((p) => p[0].rows).length, 3000);
});
```

`tests/render-helper.test.mjs` (append):
```js
test("file: a file over the budget comes a page at a time", () => {
  const x = home();
  try {
    const path = join(x.h, "big.md");
    writeFileSync(path, Array.from({ length: 30 }, (_, i) => `## Part ${i}\n\n${"text ".repeat(1000)}`).join("\n\n"));
    const first = run({ ...x.base, mode: "file", path });
    assert.ok(first.pageCount >= 3);
    assert.equal(first.page, 0);
    const second = run({ ...x.base, mode: "file", path, page: 1 });
    assert.equal(second.page, 1);
    assert.notDeepEqual(second.blocks[0], first.blocks[0]);
    assert.equal(second.buttons[0].text.length, first.buttons[0].text.length);   // copy md is the whole file
  } finally { x.done(); }
});

test("claude: rows carry their size; a long turn comes as its first 12 lines unless asked in full", () => {
  const x = home();
  try {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const t = join(x.h, "t.jsonl");
    writeFileSync(t, [JSON.stringify({ type: "user", uuid: "u", origin: { kind: "human" }, message: { content: long } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" } })].join("\n"));
    const out = run({ ...x.base, mode: "claude", transcript: t });
    assert.equal(out.exchanges[0].size, Buffer.byteLength(long) + 2);
    assert.equal(out.open.u.turnMore, true);
    assert.ok(!JSON.stringify(out.open.u.turn).includes("line 12"));
    const full = run({ ...x.base, mode: "claude", transcript: t, full: ["u"] });
    assert.equal(full.open.u.turnMore, false);
    assert.ok(JSON.stringify(full.open.u.turn).includes("line 19"));
    assert.deepEqual([full.open.u.page, full.open.u.pageCount], [0, 1]);
  } finally { x.done(); }
});
```

- [ ] **Step 2: Run** `node --test tests/render-pages.test.mjs tests/render-helper.test.mjs` — Expected: FAIL (module not found; `pageCount` undefined).
- [ ] **Step 3: Implement** `pages.js` (cut code by lines into blocks whose `md` is a fence of those lines, table rows into tables with the same header, each with its `bytes`), `size` in `exchangeRow`, and the helper's `page`/`pages`/`full` handling; pictures inside a page are rendered as today.
- [ ] **Step 4: Run** `node --test tests/render-pages.test.mjs tests/render-helper.test.mjs tests/render-core.test.mjs` — Expected: all pass.
- [ ] **Step 5: Measure** on this session's transcript: the helper's wall time and output (as in the spike) — Expected: under 0.4 s and under 1 MB with the newest three open. Ledger the numbers.
- [ ] **Step 6: Commit** `git add src/shared/render/pages.js src/shared/render/transcript.js src/app/render-helper.js tests/render-pages.test.mjs tests/render-helper.test.mjs && git commit -m "feat(render): pages — long files and replies come 64 KB at a time"`

### Task 5: The view model

**Files:**
- Modify: `src/shared/render/view.js`
- Test: `tests/render-view.test.mjs`

**Interfaces:**
- Consumes: `BUDGET` from `budget.js` (Task 4; never from `pages.js`, which imports `blocks.js` → `table-copy.js` → `Intl`), `columnWidths` from `columns.js` (Task 3).
- Produces:
  - `COLOURS: Record<string, string>` — run roles and drawing roles → theme keys, exactly the spec's §3 table (`heading`, `strong`, `em`, `del`, `code`, `link`, `number`, `path`, `bullet`, `quote`, `tableHeader`, `rule`, `codeText`, and the code roles).
  - `pieces(runs: Run[]): Array<Run & { text: string }>` — each run split into words with their following spaces; `"\n"` stays a piece of its own; a `code` run stays whole.
  - `openWithin(rows: Row[], toggled: Map<string, boolean>, budget = BUDGET): string[]` — replaces `openIds` in `main.js`.
  - `tableWidths(natural: number[], words: number[], panelPx: number): number[]` — pixel widths: `columnWidths` in characters over `panelPx / CHAR_PX` (`CHAR_PX = 7.2`), times `CHAR_PX`, plus 16 px padding per column.

- [ ] **Step 1: Write the failing tests** (append to `tests/render-view.test.mjs`)

```js
import { COLOURS, openWithin, pieces, tableWidths } from "../src/shared/render/view.js";

test("COLOURS: every role is a theme key, none hard-coded", () => {
  const keys = new Set(["foreground", "muted", "dim", "border", "surface", "raised", ...Array.from({ length: 16 }, (_, i) => `ansi${i}`)]);
  for (const [role, key] of Object.entries(COLOURS)) assert.ok(keys.has(key), `${role}: ${key}`);
  assert.equal(COLOURS.tableHeader, "ansi3");
  assert.equal(COLOURS.number, "ansi5");
});

test("pieces: words keep their spaces; line breaks and code stay whole", () => {
  assert.deepEqual(pieces([{ text: "two words " }, { text: "\n" }, { text: "a b", role: "code" }]).map((p) => p.text),
    ["two ", "words ", "\n", "a b"]);
});

test("openWithin: the newest that fit, at least one; a hand-opened one stays and older open ones fold to fit", () => {
  const rows = [{ id: "a", size: 30000 }, { id: "b", size: 30000 }, { id: "c", size: 30000 }, { id: "d", size: 100 }];
  assert.deepEqual(openWithin(rows, new Map()), ["a", "b"]);
  assert.deepEqual(openWithin(rows, new Map([["d", true]])), ["a", "b", "d"]);
  assert.deepEqual(openWithin([{ id: "x", size: 200000 }], new Map()), ["x"]);
  assert.deepEqual(openWithin(rows, new Map([["a", false]])), ["b", "c"]);
});

test("tableWidths: fits the panel, never below a column's longest word, wide tables keep their minimum", () => {
  const w = tableWidths([4, 199], [4, 6], 360);
  assert.ok(w.reduce((a, b) => a + b) <= 360 + 32);
  assert.ok(w[1] >= 6 * 7.2);
});
```

- [ ] **Step 2: Run** `node --test tests/render-view.test.mjs` — Expected: FAIL (not exported).
- [ ] **Step 3: Implement** in `view.js` (no `Intl`): `openWithin` orders candidates as the hand-opened ones (toggled `true`, most recently opened first; a `Map` keeps insertion order and `toggle` re-inserts) then the default ones (the first `OPEN_NEWEST` rows by position, minus those toggled `false`), keeps the first candidate always, and adds the rest while the total `size` stays within the budget; returns them in row order. (`["a","b","d"]` above: d is hand-opened and small, then a and b fit, c would pass the budget.)
- [ ] **Step 4: Run** the tests — Expected: all pass.
- [ ] **Step 5: Commit** `git add src/shared/render/view.js tests/render-view.test.mjs && git commit -m "feat(render): the colour view model — theme colours, word pieces, the open budget, table widths"`

### Task 6: Drawing, the README, the build

**Files:**
- Modify: `src/mods/dock-render/main.js`, `README.md`
- Regenerate: `app/`

**Interfaces:**
- Consumes: everything above. No new exports.

- [ ] **Step 1: Prose and parts.** A `prose(t, runs, id)` draws `pieces(runs)` in an `h_flex().flex_wrap()`: each piece a `div` with `t[COLOURS[role ?? "codeText"]]`… (text runs default to `foreground`), `font_bold()` for `bold`, `italic()`, `line_through()`, links underlined with an `id` and `on_click` → `cx.open_url(href)`, `code` in `font_family("Menlo")` on `t.raised` with 4 px padding; a `"\n"` piece is a `div().w_full().h(0)` forcing a new line. Text parts: headings sized 17 / 15 / 13.5 px by level in `COLOURS.heading`, bold; rules a 1 px `t.border` line; HTML parts as `muted` text. A text block's `copy` sits top right as lists' does.
- [ ] **Step 2: The other blocks.** Lists: a row with the marker in `COLOURS.bullet` (fixed 22 px column) and the item's blocks; nested lists indent by that column. Quotes: `border_l(3)` in `COLOURS.quote`, its blocks. Alerts: today's box, its blocks inside. Tables: `tableWidths(b.natural, b.words, panelWidth - 2)`; a rounded `t.border` frame; the header row on `t[COLOURS.tableHeader] + "10"` with bold header cells in `COLOURS.tableHeader`; rows separated by `border_t(1)`; cells `w(px)`, padded, aligned by `b.align`; the whole table in a sideways scroll area when its width exceeds the panel. Code: header (language, copy), then one `div` per line of runs in Menlo on `t.surface`, `whitespace_nowrap`, in a sideways scroll area.
- [ ] **Step 3: Turn, pages, budget.** The turn draws `open.turn` blocks; `show all` (when `turnMore`) adds the id to `this.full` (sent as `full`) and reloads. Exchanges open by `openWithin`; `toggle` deletes and re-sets the id in `this.toggled`. A reply with `pageCount > 1` shows "Part n of m" with **Prev** / **Next** above and below (`this.pages` sent as `pages`, reload). The Files tab shows "Page n of m" with **Prev** / **Next** above and below and asks the helper for that `page`.
- [ ] **Step 4: README.** The Render section: replies are drawn in colour (the roles and their theme colours), text isn't mouse-selectable (copy buttons, and the terminal's text), the 64 KB budget (pages, open exchanges folding), Prism 1.30.0 (MIT) bundled, prismantis credited for numbers/paths, shell colouring and the code colour mapping.
- [ ] **Step 5: Build, check, test, look.** Run: `npm run build:app && herdr-app check app/mods/dock-render && npm test 2>&1 | tail -5`. Expected: the check passes; tests pass except `dock-core-class`. Then, without deploying, open the built mod in a Herdr tab the way the spike was opened (`mod.clone` a small mod as `render-colour-preview`, copy `app/mods/dock-render/*` into it, `tab.new` with it) on this session, screenshot it with `herdr-app shot`, and delete the preview mod after. Ledger what it looked like.
- [ ] **Step 6: Commit** `git add src/mods/dock-render/main.js README.md app && git commit -m "feat(render): replies drawn in colour — prose, lists, quotes, alerts, tables and code, within the budget"`
