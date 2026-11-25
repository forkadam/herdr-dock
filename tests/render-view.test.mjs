// The Render panel's Conversation view model (src/shared/render/view.js).
import test from "node:test";
import assert from "node:assert/strict";
import { copyPlan, hintsNotice, openIds, promptView, replyNote, shownButtons, speakerLabel, viewOf } from "../src/shared/render/view.js";

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

test("hintsNotice: missing or moved offers Set up; unreadable says so; present, no Claude Code or dismissed show nothing; a failure says why", () => {
  const n = (state, o = {}) => hintsNotice(state, { dismissed: false, error: null, ...o });
  assert.deepEqual(n("missing"), { text: "Diagram hints for Claude aren't set up", action: "setup" });
  assert.deepEqual(n("moved"), { text: "Diagram hints point at another install", action: "setup" });
  assert.deepEqual(n("invalid"), { text: "~/.claude/settings.json can't be read: diagram hints aren't set up", action: null });
  for (const s of ["present", "no-claude", null]) assert.equal(n(s), null, String(s));
  assert.equal(n("missing", { dismissed: true }), null);
  assert.deepEqual(n("missing", { error: "Cannot write" }), { text: "Set up failed: Cannot write", action: "setup" });
});

// ---- Colour ----
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

test("tableWidths: a table that fits is stretched to the panel, columns sharing the spare width by their natural width", () => {
  const w = tableWidths([4, 12], [4, 6], 400);
  assert.equal(w.reduce((a, b) => a + b), 400);
  assert.ok(w[1] > w[0] * 2);
});

// ---- Folding, line numbers, side by side ----
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
