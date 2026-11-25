// The Render panel's Conversation view model (src/shared/render/view.js).
import test from "node:test";
import assert from "node:assert/strict";
import { copyPlan, hintsDetails, hintsNotice, hintsWhy, reachVerdict, openIds, promptView, replyNote, shownButtons, speakerLabel, viewOf } from "../src/shared/render/view.js";

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

test("reachVerdict: silent, and the hook ran for the newest prompt (5 s slack) and spoke or didn't see Herdr; else null", () => {
  const at = Date.parse("2026-11-25T14:29:25.000Z");
  const silent = { state: "silent", checked: 3, at };
  const run = (decision, dt = 50, event = "prompt") => ({ at: at + dt, event, decision });
  assert.equal(reachVerdict(silent, run("spoke")), "spoke");
  assert.equal(reachVerdict(silent, run("not-herdr")), "not-herdr");
  assert.equal(reachVerdict(silent, run("spoke", -4000)), "spoke");
  for (const [h, r, why] of [
    [silent, run("prismantis"), "prismantis on: quiet by design"],
    [silent, run("settings-invalid"), "settings row covers it"],
    [silent, undefined, "no record: the hook never ran"],
    [silent, run("spoke", -60000), "the record is from before the newest prompt: the hook stopped running"],
    [silent, run("spoke", 50, "session"), "a session-start run says nothing about prompts"],
    [{ state: "unknown", checked: 1, at }, run("spoke"), "too early"],
    [{ state: "ok", checked: 3, at }, run("spoke"), "hints arrive"],
    [{ state: "silent", checked: 3 }, run("spoke"), "no prompt time to compare"],
  ]) assert.equal(reachVerdict(h, r), null, why);
});

test("hintsNotice: a verdict gives its row (set-up rows first; × hides it; 'don't ask again' doesn't)", () => {
  const n = (o) => hintsNotice("present", { dismissed: false, error: null, reach: "spoke", reachDismissed: false, ...o });
  assert.deepEqual(n({}), { text: "Diagram hints aren't reaching Claude in this session", action: "why" });
  assert.deepEqual(n({ reach: "not-herdr" }), { text: "The diagram-hint hook doesn't see Herdr in this session", action: "why" });
  assert.deepEqual(n({ dismissed: true }), { text: "Diagram hints aren't reaching Claude in this session", action: "why" });
  for (const o of [{ reach: null }, { reach: undefined }, { reachDismissed: true }]) assert.equal(n(o), null, JSON.stringify(o));
  assert.equal(hintsNotice("missing", { dismissed: false, error: null, reach: "spoke" }).action, "setup");
  assert.equal(hintsNotice("moved", { dismissed: false, error: null, reach: "spoke" }).action, "setup");
});

test("hintsWhy: what happened and what to do, per verdict", () => {
  assert.equal(hintsWhy("spoke"), "The hint hook ran on your last prompts and sent the hint, but it isn't in this session's log, so Claude didn't get it. Copy the details and report it.");
  assert.equal(hintsWhy("not-herdr"), "The hint hook ran on your last prompts but saw none of Herdr's terminal variables (HC_TERMINAL_ID, HC_SCOPE), so it stayed quiet. That happens when Claude was started outside Herdr and attached here, or runs through WSL, tmux or ssh in this pane. If this is a plain Herdr terminal, copy the details and report it.");
  assert.equal(hintsWhy(null), "");
});

test("hintsDetails: platform, hook commands, transcript, prompts checked, the hook's last run", () => {
  const run = { at: Date.parse("2026-11-25T14:29:25.050Z"), event: "prompt", decision: "spoke" };
  const d = hintsDetails({ platform: "linux", commands: ['node "/a/herdr-hint.mjs" prompt'], transcript: "/t.jsonl", checked: 3, run });
  for (const s of ["linux", 'node "/a/herdr-hint.mjs" prompt', "/t.jsonl", "2026-11-25T14:29:25.050Z", "prompt", "spoke"]) assert.ok(d.includes(s), s);
  assert.match(d, /^typed prompts checked: 3 \(the newest 2 got no hint\)$/m);
  assert.ok(d.split("\n").every((l) => !/ $/.test(l)), "no line ends in a space");
  const none = hintsDetails({ platform: null, commands: [], transcript: null, checked: 0, run: null });
  assert.match(none, /none found/);
  assert.match(none, /^the hook's last run: none recorded$/m);
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

test("tableWidths: measuring a fitted table again at its own width gives the same columns (no lost character)", () => {
  const fitted = tableWidths([5, 11], [5, 8], 560, false);   // | build | in progress |: [52, 95.2]
  const total = fitted.reduce((a, b) => a + b, 0);
  assert.deepEqual(tableWidths([5, 11], [5, 8], total, false), fitted);
});
