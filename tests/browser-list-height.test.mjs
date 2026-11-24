// src/shared/browser/list-height.js: how tall one note of the Notes bar draws, and the page's error list, for the heights
// their scroll lists are given.
import test from "node:test";
import assert from "node:assert/strict";
import { ERRORS_MAX_H, errorsHeight, noteHeight } from "../src/shared/browser/list-height.js";
import { textHeight } from "../src/shared/fit-height.js";
import { INTENTS, PRIORITIES } from "../src/shared/browser/feedback.js";

test("noteHeight: in a wide panel the chips are on one line", () => {
  // the badge row 19, the selector 17, the field 26, one line of chips 18, and the three gaps of 3 between them
  assert.equal(noteHeight(600), 19 + 17 + 26 + 18 + 9);
});

test("noteHeight: in a narrow panel the priority chips wrap under the intent chips", () => {
  assert.equal(noteHeight(200), 19 + 17 + 26 + (18 + 6 + 18) + 9);
  assert.equal(noteHeight(0), noteHeight(200)); // not laid out yet: the tall one, never clipped
});

test("noteHeight: switches to one line where both chip groups fit", () => {
  const w = (word) => Math.ceil(word.length * 10.5 * 0.55) + 14;
  const group = (words) => words.reduce((n, word) => n + w(word), 0) + 2 * (words.length - 1);
  const both = group(INTENTS) + 6 + group(PRIORITIES);
  assert.equal(noteHeight(both + 1), noteHeight(600));
  assert.equal(noteHeight(both - 40), noteHeight(200));
});

// The error list: the box's border 1 and padding 6 all round, 2 between the errors, each at 11px wrapping.
test("errorsHeight: the box around the errors' text, 2 between them", () => {
  const line = textHeight("boom", { width: 300 - 14, size: 11 });
  assert.equal(line, 18); // one line at 11px
  assert.equal(errorsHeight(["boom"], 300), 14 + 18);
  assert.equal(errorsHeight(["boom", "bang", "crash"], 300), 14 + 3 * 18 + 2 * 2);
});

test("errorsHeight: a long error takes more lines; a narrower panel takes more", () => {
  const long = "TypeError: Cannot read properties of undefined (reading 'x') at https://example.test/app.js:10:5 ".repeat(3).trim();
  const wide = errorsHeight([long], 400), narrow = errorsHeight([long], 200);
  assert.ok(wide > errorsHeight(["boom"], 400));
  assert.ok(narrow > wide);
});

test("errorsHeight: stops at the cap, and nothing to list is just the box", () => {
  assert.equal(ERRORS_MAX_H, 140);
  assert.equal(errorsHeight(Array.from({ length: 30 }, () => "boom"), 300), 140);
  assert.equal(errorsHeight([], 300), 14);
  assert.equal(errorsHeight(["boom"], 0), 14 + textHeight("boom", { width: 0, size: 11 })); // not laid out: still a number
});
