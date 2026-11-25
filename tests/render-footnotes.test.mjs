// Footnotes as prismantis draws them (src/shared/render/footnotes.js).
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

test("a note that starts like a list item keeps its text", () => {
  const b = footnotesBlock([{ mark: "¹", md: "2024. Annual report." }, { mark: "²", md: "- see the docs" }]);
  assert.deepEqual(b.notes.map((n) => n.runs.map((r) => r.text).join("")), ["2024. Annual report.", "- see the docs"]);
});

test("a fence indented inside a nested list is code too: its references are left alone", () => {
  const text = "- a\n  - b\n\n    ```\n    x[^1]\n    ```\n\nSee[^1].\n\n[^1]: Note.";
  const out = applyFootnotes(text, collectFootnotes(text).marks);
  assert.match(out, /    x\[\^1\]/);
  assert.match(out, /See¹\./);
});
