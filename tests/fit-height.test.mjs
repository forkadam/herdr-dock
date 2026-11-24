// src/shared/fit-height.js: the definite height a scroll list is given (Herdr's toolkit doesn't scroll a list sized only
// by a max-height), and the estimates of how tall a text or a wrapped row of chips draws.
import test from "node:test";
import assert from "node:assert/strict";
import { fitHeight, flowLines, lineHeight, stackHeight, textHeight, textLines, textWidth } from "../src/shared/fit-height.js";

// ---- fitHeight ----

test("fitHeight: no rows is just the padding and the extra lines", () => {
  assert.equal(fitHeight({ rowH: 30, max: 300 }), 0);
  assert.equal(fitHeight({ rows: 0, rowH: 30, gap: 1, pad: 8, max: 300 }), 8);
  assert.equal(fitHeight({ rows: 0, rowH: 30, pad: 8, extra: 37, max: 300 }), 45);
});

test("fitHeight: one row has no gap", () => {
  assert.equal(fitHeight({ rows: 1, rowH: 30, gap: 1, pad: 8, max: 300 }), 38);
});

test("fitHeight: many rows have the gap only between them", () => {
  assert.equal(fitHeight({ rows: 3, rowH: 30, gap: 1, pad: 8, max: 300 }), 3 * 30 + 2 * 1 + 8);
  assert.equal(fitHeight({ rows: 3, rowH: 30, max: 300 }), 90); // no gap, no padding
  assert.equal(fitHeight({ rows: 4, rowH: 28, gap: 8, max: 999 }), 4 * 28 + 3 * 8);
});

test("fitHeight: adds the extra lines and stops at the cap", () => {
  assert.equal(fitHeight({ rows: 2, rowH: 30, gap: 1, pad: 8, extra: 33, max: 300 }), 60 + 1 + 8 + 33);
  assert.equal(fitHeight({ rows: 20, rowH: 30, gap: 1, pad: 8, max: 300 }), 300);
  assert.equal(fitHeight({ rows: 10, rowH: 30, gap: 1, pad: 10, max: 300 }), 300); // 319 drawn: capped
  assert.equal(fitHeight({ rows: 10, rowH: 28, gap: 1, pad: 10, max: 300 }), 299); // just under: not padded up to the cap
  assert.equal(fitHeight({ rows: 0, pad: 8, extra: 500, max: 200 }), 200);
});

// ---- rows of different heights ----

test("stackHeight: the heights added, with the gap between them and not around", () => {
  assert.equal(stackHeight([]), 0);
  assert.equal(stackHeight([40]), 40);
  assert.equal(stackHeight([40, 20, 60], 2), 120 + 4);
  assert.equal(stackHeight([18, 36]), 54);
});

// ---- the text estimates ----

test("lineHeight: a line is a little over one and a half times the font size, rounded up", () => {
  assert.equal(lineHeight(12), 20);
  assert.equal(lineHeight(10), 17);
  assert.equal(lineHeight(11.5), 19);
});

test("textWidth: a glyph averages about half an em; a wide (CJK) one twice that", () => {
  assert.equal(textWidth("", 12), 0);
  assert.equal(textWidth("abcd", 10), 4 * 5.5);
  assert.equal(textWidth("你好", 10), 2 * 2 * 5.5);
  assert.equal(textWidth(undefined, 10), 0);
});

test("textLines: one line when it fits, a line more for each time the words overflow", () => {
  // 100 px at 10 px: 5.5 px a glyph, 18 glyphs a line
  assert.equal(textLines("short", 100, 10), 1);
  assert.equal(textLines("", 100, 10), 1);
  assert.equal(textLines(undefined, 100, 10), 1);
  assert.equal(textLines("aaaaaaaa bbbbbbbbb", 100, 10), 1); // 8 + a space + 9 is exactly 18
  assert.equal(textLines("aaaaaaaaa bbbbbbbbb", 100, 10), 2); // 19 is over: the second word goes down
  assert.equal(textLines("aaaaaaaaaa bbbbbbbbbb cccccccccc", 100, 10), 3); // 10 + 1 + 10 is over 18 each time
});

test("textLines: a word longer than a line breaks across lines; newlines start a line", () => {
  assert.equal(textLines("x".repeat(40), 100, 10), 3); // 18 a line
  assert.equal(textLines("one\ntwo\nthree", 100, 10), 3);
  assert.equal(textLines("one\n\nthree", 100, 10), 3); // the blank line takes a line
  assert.equal(textLines("你".repeat(10), 100, 10), 2); // 2 units each: 9 per line
});

test("textLines: a box narrower than one glyph still draws a line per glyph, never zero or infinity", () => {
  assert.equal(textLines("abc", 0, 10), 3);
  assert.equal(textLines("abc", -5, 10), 3);
});

test("textHeight: its lines times the line height", () => {
  assert.equal(textHeight("short", { width: 100, size: 10 }), 17);
  assert.equal(textHeight("x".repeat(40), { width: 100, size: 10 }), 3 * 17);
  assert.equal(textHeight("a\nb", { width: 300, size: 12 }), 40);
});

// ---- flowLines: items that wrap onto new lines ----

test("flowLines: items fill a line, with the gap between them, and wrap when the next doesn't fit", () => {
  assert.equal(flowLines([], 100, 4), 0);
  assert.equal(flowLines([100], 100, 4), 1);
  assert.equal(flowLines([40, 40], 100, 4), 1);
  assert.equal(flowLines([48, 48], 100, 4), 1); // 48 + 4 + 48 = 100 fits
  assert.equal(flowLines([49, 48], 100, 4), 2); // 101 doesn't
  assert.equal(flowLines([60, 60, 60], 130, 4), 2);
  assert.equal(flowLines([150], 100, 4), 1); // one too wide for a line still takes just that line
  assert.equal(flowLines([150, 10], 100, 4), 2);
});
