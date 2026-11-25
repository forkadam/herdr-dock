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
