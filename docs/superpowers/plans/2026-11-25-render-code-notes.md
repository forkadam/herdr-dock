# Render Line Numbers, Folding, Footnotes, Side by Side — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Render panel numbers and folds long code, draws footnotes as prismantis does, and puts consecutive tables, diagrams and figures side by side when they fit.

**Architecture:** The helper rewrites footnotes before `marked` (pure `footnotes.js`) and appends a `footnotes` block; `view.js` gains pure fold, gutter and side-by-side decisions; `main.js` draws them.

**Tech Stack:** JavaScript (ESM), gpui-kit, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-render-code-notes-design.md`

## Global Constraints

- Thresholds: numbers from **10** lines; fold over **30** lines to the first **20**; button text `+N more lines` / `show less`.
- Superscript digits `⁰¹²³⁴⁵⁶⁷⁸⁹`, one per digit (prismantis `markOf`); the notes rule is 12 `─` in `dim`; notes in `dim`.
- Nothing in `view.js` (or anything else `main.js` imports) may use `Intl`.
- Ported from prismantis 0.20.0 (MIT), credited: footnote numbering and drawing, the fold thresholds.
- `app/` is generated; `herdr-app check app/mods/dock-render` must pass. Known baseline failure: `tests/dock-core-class.test.mjs`.

## Review Focus

- A footnote reference inside inline code or a fence: left alone (Task 1 test "code is untouched").
- References in a reply split by a mid-turn marker: still numbered and noted once at the reply's end (Task 1 helper test).
- A 31-line block (just over the fold) and a 30-line one (just under): fold only the first (Task 2 test).
- Two wide tables in a row: they stack, stretched, rather than squeeze (Task 2 test "sideBySide: …").
- A footnote note that itself has inline code or a link: drawn coloured like prose (Task 1 test).

---

### Task 1: Footnotes

**Files:**
- Create: `src/shared/render/footnotes.js`
- Modify: `src/shared/render/blocks.js` (`toBlocks(text, { marks })`), `src/app/render-helper.js` (`replyBlocks`, file mode)
- Test: `tests/render-footnotes.test.mjs`, `tests/render-helper.test.mjs`

**Interfaces:**
- Produces: `collectFootnotes(text: string): { marks: Map<string, string>, notes: Array<{ mark: string, md: string }> }` (marks numbered by first reference outside code; only labels that have a note); `applyFootnotes(text: string, marks: Map<string, string>): string` (references outside code → their mark; note lines removed); `footnotesBlock(notes): Block` → `{ kind: "footnotes", notes: Array<{ mark, runs }>, md, bytes, cost, buttons: [] }`.
- `toBlocks(text, options?: { marks?: Map })` applies `applyFootnotes` first when `marks` is given.

- [ ] **Step 1: Write the failing tests** (`tests/render-footnotes.test.mjs`)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { applyFootnotes, collectFootnotes, footnotesBlock } from "../src/shared/render/footnotes.js";

const TEXT = "B claim[^b] and A[^a], B again[^b], none[^x].\n\n`[^a]` stays\n\n```\n[^a]: not a note\n```\n\n[^a]: Alpha `code`.\n[^b]: Beta [link](http://x).";

test("collectFootnotes: numbered by first reference, only labels with a note, nothing in code", () => {
  const { marks, notes } = collectFootnotes(TEXT);
  assert.deepEqual([...marks], [["b", "¹"], ["a", "²"]]);
  assert.deepEqual(notes.map((n) => [n.mark, n.md]), [["¹", "Beta [link](http://x)."], ["²", "Alpha `code`."]]);
});

test("applyFootnotes: references become marks, notes are removed, code is untouched, unknown stays", () => {
  const out = applyFootnotes(TEXT, collectFootnotes(TEXT).marks);
  assert.match(out, /B claim¹ and A², B again¹, none\[\^x\]\./);
  assert.match(out, /`\[\^a\]` stays/);
  assert.match(out, /\[\^a\]: not a note/);
  assert.doesNotMatch(out, /\[\^b\]: Beta/);
});

test("footnotesBlock: notes as runs (code and links coloured); marks past 9 superscript each digit", () => {
  const b = footnotesBlock([{ mark: "¹", md: "Alpha `code`." }]);
  assert.equal(b.kind, "footnotes");
  assert.equal(b.notes[0].runs.find((r) => r.role === "code").text, "code");
  const many = "x" + Array.from({ length: 12 }, (_, i) => `[^n${i}]`).join("") + "\n\n" + Array.from({ length: 12 }, (_, i) => `[^n${i}]: n${i}`).join("\n");
  assert.equal(collectFootnotes(many).marks.get("n11"), "¹²");
});
```

and in `tests/render-helper.test.mjs`:

```js
test("claude: footnotes across a mid-turn marker are numbered once and noted at the reply's end", () => {
  const x = home();
  try {
    const t = join(x.h, "fn.jsonl");
    writeFileSync(t, [
      JSON.stringify({ type: "user", uuid: "f", origin: { kind: "human" }, message: { content: "go" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Claim[^1]." }, { type: "tool_use", id: "t1", name: "X", input: {} }], stop_reason: "tool_use" } }),
      JSON.stringify({ type: "attachment", attachment: { type: "queued_command", prompt: "also", origin: { kind: "human" }, commandMode: "prompt" } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "More.\n\n[^1]: The source." }], stop_reason: "end_turn" } }),
    ].join("\n"));
    const reply = run({ ...x.base, mode: "claude", transcript: t }).open.f.reply;
    assert.ok(JSON.stringify(reply[0]).includes("Claim¹"));
    assert.deepEqual(reply.at(-1).kind, "footnotes");
    assert.equal(reply.at(-1).notes[0].mark, "¹");
    assert.ok(!JSON.stringify(reply).includes("[^1]"));
  } finally { x.done(); }
});
```

- [ ] **Step 2: Run** `node --test tests/render-footnotes.test.mjs tests/render-helper.test.mjs` — Expected: FAIL (module not found; no footnotes block).
- [ ] **Step 3: Implement** `footnotes.js` (fence-aware, line by line; inline code spans skipped by splitting on backtick runs; a note is `^\[\^([^\]\s]+)\]:[ \t]*(.*)$` plus indented continuation lines), `toBlocks(text, { marks })`, and in the helper: `collectFootnotes(replyText(ex))`, each text run's `toBlocks(run, { marks })`, then `footnotesBlock(notes)` appended (before paging); the file mode the same over the whole file (notes on the last page).
- [ ] **Step 4: Run** the tests — Expected: all pass.
- [ ] **Step 5: Commit** `git add src/shared/render/footnotes.js src/shared/render/blocks.js src/app/render-helper.js tests/render-footnotes.test.mjs tests/render-helper.test.mjs && git commit -m "feat(render): footnotes as prismantis draws them — superscript marks, notes at the reply's end"`

### Task 2: Folding, line numbers, side by side (view model)

**Files:**
- Modify: `src/shared/render/view.js`
- Test: `tests/render-view.test.mjs`

**Interfaces:**
- Produces: `NUMBER_FROM = 10`, `FOLD_OVER = 30`, `FOLD_TO = 20`; `codeFold(lineCount: number, open: boolean): { shown: number, more: number, numbered: boolean }`; `tableWidths(natural, words, panelPx, stretch = true)` (existing, gains `stretch`); `sideBySide(widths: number[], panelPx: number, gap = 12): boolean` (true when there are 2+ and they fit in one row with gaps).

- [ ] **Step 1: Write the failing tests** (append to `tests/render-view.test.mjs`)

```js
import { codeFold, sideBySide } from "../src/shared/render/view.js";

test("codeFold: numbers from 10 lines; over 30 folds to 20 until opened", () => {
  assert.deepEqual(codeFold(9, false), { shown: 9, more: 0, numbered: false });
  assert.deepEqual(codeFold(10, false), { shown: 10, more: 0, numbered: true });
  assert.deepEqual(codeFold(30, false), { shown: 30, more: 0, numbered: true });
  assert.deepEqual(codeFold(31, false), { shown: 20, more: 11, numbered: true });
  assert.deepEqual(codeFold(31, true), { shown: 31, more: 0, numbered: true });
});

test("sideBySide: two or more that fit in one row with gaps; otherwise stacked", () => {
  assert.equal(sideBySide([200, 150], 400), true);
  assert.equal(sideBySide([200, 200], 400), false);
  assert.equal(sideBySide([300], 400), false);
});

test("tableWidths: not stretched when sharing a row", () => {
  const fitted = tableWidths([4, 6], [4, 6], 400, false);
  assert.ok(fitted.reduce((a, b) => a + b) < 400);
});
```

- [ ] **Step 2: Run** `node --test tests/render-view.test.mjs` — Expected: FAIL (not exported).
- [ ] **Step 3: Implement** in `view.js` (no `Intl`).
- [ ] **Step 4: Run** — Expected: all pass.
- [ ] **Step 5: Commit** `git add src/shared/render/view.js tests/render-view.test.mjs && git commit -m "feat(render): fold, line-number and side-by-side decisions"`

### Task 3: Drawing, README, build

**Files:**
- Modify: `src/mods/dock-render/main.js`, `README.md`; regenerate `app/`

- [ ] **Step 1: Code.** `this.unfolded = new Set()` (cleared when the agent changes) keyed by the block's element id; draw `codeFold(lines.length, this.unfolded.has(id))`: the first `shown` lines, each with a dim right-aligned gutter (`String(lineCount).length` digits, Menlo, 8 px gap) when `numbered`; under it **+N more lines** or, when opened and over 30, **show less** (11.5 px, `t.accent`, clickable).
- [ ] **Step 2: Footnotes.** A `footnotes` block: a 12-`─` rule in `t.dim`, then each note as `mark` + space + its runs through `prose` with every run's colour forced to `dim` (role kept for code and links), 12 px.
- [ ] **Step 3: Side by side.** In a block list (reply, page, file), each run of consecutive `table`, `mermaid` and `figure` blocks of length ≥ 2 is measured (tables `tableWidths(…, false)` summed + 2; pictures `shownSize(s, maxW).w`); when `sideBySide(widths, maxW)`, they're drawn in an `h_flex().gap(12).items_start()` at those widths (tables fitted); otherwise each is drawn alone as today.
- [ ] **Step 4: README.** In the Render section: line numbers and folding, footnotes, side by side (credited to prismantis).
- [ ] **Step 5: Build, check, test.** Run: `npm run build:app && herdr-app check app/mods/dock-render && npm test 2>&1 | tail -5` — Expected: check passes; tests pass except `dock-core-class`.
- [ ] **Step 6: Commit** `git add src/mods/dock-render/main.js README.md app && git commit -m "feat(render): numbered and folding code, footnotes, side-by-side tables and diagrams"`
