// The Render panel's pure core: Markdown / Mermaid segments, transcripts (Claude Code, Codex), SVG flattening.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashText, mermaidBlocks, splitSegments } from "../src/shared/render/markdown.js";
import { claudeSlug, exchangeRow, readClaude, readCodex, codexCwd, replyText } from "../src/shared/render/transcript.js";
import { flattenSvg } from "../src/shared/render/flatten.js";

const lines = (name) => readFileSync(new URL(`./fixtures/render/${name}`, import.meta.url), "utf8").split("\n");

test("splitSegments: Markdown around Mermaid fences (``` or ~~~, any case); other code stays Markdown", () => {
  const s = splitSegments("Intro\n\n```mermaid\nflowchart LR\n A-->B\n```\n\nMiddle\n~~~Mermaid\ngraph TD\n X-->Y\n~~~\n```js\nx\n```");
  assert.deepEqual(s.map((x) => x.kind), ["md", "mermaid", "md", "mermaid", "md"]);
  assert.equal(s[0].text, "Intro");
  assert.equal(s[1].source, "flowchart LR\n A-->B");
  assert.equal(s[1].id, hashText("flowchart LR\n A-->B"));
  assert.equal(s[4].text, "```js\nx\n```");
  assert.deepEqual(splitSegments("just text"), [{ kind: "md", text: "just text" }]);
  assert.deepEqual(splitSegments(""), []);
  // An unclosed fence (an answer still streaming) stays text.
  assert.deepEqual(splitSegments("a\n```mermaid\ngraph TD").map((x) => x.kind), ["md"]);
});

test("mermaidBlocks and hashText", () => {
  assert.deepEqual(mermaidBlocks("x\n```mermaid\ngraph TD\n A\n```\ny\n```mermaid\npie\n```"), ["graph TD\n A", "pie"]);
  assert.match(hashText("abc"), /^[0-9a-f]{8}$/);
  assert.notEqual(hashText("abc"), hashText("abd"));
  assert.equal(hashText("abc"), hashText("abc"));
});

test("claudeSlug: Claude Code's project folder name for a cwd", () => {
  assert.equal(claudeSlug("/home/adamcheng/Projects/herdr-dock"), "-home-adamcheng-Projects-herdr-dock");
  assert.equal(claudeSlug("C:\\Users\\a\\my.proj"), "C--Users-a-my-proj");
});

test("readClaude: the last exchange is the last real user message and the assistant text after it; tool results don't count", () => {
  const r = readClaude(lines("claude.jsonl"));
  const last = r.exchanges[0];
  assert.equal(replyText(last), "Let me look.\n\n## Sequence\n\n~~~Mermaid\nsequenceDiagram\n  U->>S: login\n~~~\n\n```js\nconst x = 1;\n```");
  assert.equal(exchangeRow(last).replyAt, Date.parse("2026-11-22T10:01:03.000Z"));
  assert.equal(last.text, "Now the sequence, and check the code");
  assert.equal(last.by, "you");
  assert.equal(last.id, "line-3");
  // Every diagram the agent wrote, newest first; none from tool results or the user.
  assert.deepEqual(r.diagrams.map((d) => [d.source.split("\n")[0], d.at]),
    [["sequenceDiagram", Date.parse("2026-11-22T10:01:03.000Z")], ["flowchart LR", Date.parse("2026-11-22T10:00:02.000Z")]]);
  assert.deepEqual(readClaude([]), { exchanges: [], diagrams: [] });
});

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

test("readCodex: the same from a Codex rollout, and its cwd", () => {
  const l = lines("codex.jsonl");
  const r = readCodex(l);
  assert.equal(replyText(r.exchanges[0]), "Sure:\n```mermaid\ngraph TD\n  P-->Q\n```");
  assert.equal(r.exchanges[0].text, "diagram please");
  assert.equal(exchangeRow(r.exchanges[0]).state, "reply");
  assert.deepEqual(r.diagrams.map((d) => d.source), ["graph TD\n  P-->Q"]);
  assert.equal(codexCwd(l), "/home/u/proj");
  assert.equal(codexCwd(["junk"]), null);
});

test("flattenSvg: no CSS variables, color-mix, @import or web fonts; a background rect", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50" style="--bg:#101010;--fg:#eeeeee;background:var(--bg)">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter');
  svg { --line: color-mix(in srgb, var(--fg) 50%, var(--bg)); }
  text { font-family: 'Inter', sans-serif; fill: var(--fg); }
  .code { font-family: 'JetBrains Mono'; }
  path { stroke: var(--line); }
</style>
<path d="M0 0" stroke="var(--line)"/><text font-family="Inter">hi</text></svg>`;
  const out = flattenSvg(svg, "#101010");
  assert.ok(!/var\(|color-mix|@import|googleapis/.test(out), out);
  assert.match(out, /fill: #eeeeee/);
  assert.match(out, /stroke="#7f7f7f"/);
  assert.match(out, /font-family: monospace/);
  assert.match(out, /<rect x="0" y="0" width="100" height="50" fill="#101010"\/>/);
  assert.throws(() => flattenSvg("<svg><foreignObject/></svg>", "#000"), /browser/);
});

// ---- Cache cleanup ----
import { CACHE_MAX_AGE_MS, CACHE_MAX_COUNT, cacheToPrune } from "../src/shared/render/cache.js";

test("cacheToPrune: diagrams not used for 14 days go, and past the newest 300; other files are left alone", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const day = 86400e3;
  const files = [
    { name: "aaaaaaaa-11111111.svg", mtimeMs: now - 1 * day },
    { name: "bbbbbbbb-11111111.svg", mtimeMs: now - 15 * day },
    { name: "notes.txt", mtimeMs: now - 99 * day },
    { name: "cccccccc-11111111.svg.123.tmp", mtimeMs: now - 2 * day },
  ];
  assert.deepEqual(cacheToPrune(files, now), ["bbbbbbbb-11111111.svg", "cccccccc-11111111.svg.123.tmp"]);
  assert.equal(CACHE_MAX_AGE_MS, 14 * day);
  assert.equal(CACHE_MAX_COUNT, 300);
  // Past the cap: the least recently used go first.
  const many = Array.from({ length: 5 }, (_, i) => ({ name: `${String(i).padStart(8, "0")}-11111111.svg`, mtimeMs: now - i * 1000 }));
  assert.deepEqual(cacheToPrune(many, now, { maxCount: 3 }), ["00000003-11111111.svg", "00000004-11111111.svg"]);
  // Clear everything: maxAge 0.
  assert.equal(cacheToPrune(many, now, { maxAgeMs: 0 }).length, 5);
  assert.deepEqual(cacheToPrune([], now), []);
});

test("cacheToPrune: a temp file left by a crashed write goes after an hour", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const tmp = [{ name: "dddddddd-11111111.svg.4242.tmp", mtimeMs: now - 2 * 3600e3 }, { name: "eeeeeeee-11111111.svg.4243.tmp", mtimeMs: now - 60e3 }];
  assert.deepEqual(cacheToPrune(tmp, now), ["dddddddd-11111111.svg.4242.tmp"]);
});

// ---- Figures beside Mermaid; the look version ----
import { blockId, pictureBlocks } from "../src/shared/render/markdown.js";
import { themeKey } from "../src/shared/render/cache.js";

test("splitSegments: ```figure blocks (any case) are pictures; an open one (still streaming) stays text", () => {
  const s = splitSegments("a\n```figure\nA {ok:B}\n```\n```FIGURE\nx\n```");
  assert.deepEqual(s.map((x) => x.kind), ["md", "figure", "figure"]);
  assert.equal(s[1].source, "A {ok:B}");
  assert.equal(s[1].id, blockId("figure", "A {ok:B}"));
  assert.deepEqual(splitSegments("a\n```figure\nA {ok:B}").map((x) => x.kind), ["md"]);
});

test("blockId: the same text as Mermaid and as a figure gives two ids", () => {
  assert.equal(blockId("mermaid", "graph TD"), hashText("graph TD"));
  assert.notEqual(blockId("figure", "graph TD"), blockId("mermaid", "graph TD"));
  assert.deepEqual(pictureBlocks("```figure\nA\n```\n```mermaid\nA\n```"), [{ kind: "figure", source: "A" }, { kind: "mermaid", source: "A" }]);
});

test("readClaude: the session's pictures hold figures too, each with its kind", () => {
  const l = [JSON.stringify({ type: "user", message: { content: "draw" }, timestamp: "2026-11-23T10:00:00Z" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "```figure\nA\n```\n```mermaid\nA\n```" }] }, timestamp: "2026-11-23T10:00:01Z" })];
  assert.deepEqual(readClaude(l).diagrams.map((d) => [d.kind, d.source]), [["mermaid", "A"], ["figure", "A"]]);
});

test("themeKey: the look version is part of the theme id, so drawings from before a look change aren't reused", () => {
  const t = { background: "#000000" };
  assert.match(themeKey(t), /^[0-9a-f]{8}$/);
  assert.notEqual(themeKey(t), hashText(JSON.stringify(t)));
});

// ---- How large the panel shows a picture ----
import { shownSize } from "../src/shared/render/size.js";

test("shownSize: natural size when it fits; never below 70% (then it scrolls); never below 40; no size → the room", () => {
  assert.deepEqual(shownSize({ w: 300, h: 150 }, 332), { w: 300, h: 150, scroll: false });
  assert.deepEqual(shownSize({ w: 424, h: 280 }, 332), { w: 332, h: 219, scroll: false });
  assert.deepEqual(shownSize({ w: 750, h: 464 }, 332), { w: 525, h: 325, scroll: true });
  assert.deepEqual(shownSize({ w: 20, h: 10 }, 332), { w: 40, h: 20, scroll: false });
  assert.deepEqual(shownSize({}, 332), { w: 332, h: 199, scroll: false });
});

// ---- Review fixes: when a turn is still going, and lines that aren't turns ----
const U = (o) => JSON.stringify({ type: "user", timestamp: "2026-11-25T10:00:00Z", ...o });
const A = (content, stop) => JSON.stringify({ type: "assistant", timestamp: "2026-11-25T10:00:01Z", message: { content, stop_reason: stop } });

test("a prompt Claude hasn't answered yet is working…, even after an ended turn", () => {
  const x = readClaude([
    U({ uuid: "a", origin: { kind: "human" }, message: { content: "first" } }), A([{ type: "text", text: "done" }], "end_turn"),
    U({ uuid: "b", origin: { kind: "human" }, message: { content: "second" } }),
  ]).exchanges;
  assert.equal(exchangeRow(x[0]).state, "working");
});

test("a slash command's output and bash mode end their turn; bash output starts nothing", () => {
  const x = readClaude([
    U({ uuid: "c", message: { content: "<command-name>/model</command-name>\n<command-args></command-args>" } }),
    U({ message: { content: "<local-command-stdout>Set model</local-command-stdout>" } }),
    U({ uuid: "d", message: { content: "<bash-input>git status</bash-input>" } }),
    U({ message: { content: "<bash-stdout>clean</bash-stdout><bash-stderr></bash-stderr>" } }),
  ]).exchanges;
  assert.deepEqual(x.map((e) => [e.id, e.by, e.text, exchangeRow(e).state]), [["d", "you", "! git status", "none"], ["c", "you", "/model", "none"]]);
});

test("an interruption starts nothing and ends the turn", () => {
  const x = readClaude([
    U({ uuid: "e", origin: { kind: "human" }, message: { content: "go" } }),
    A([{ type: "tool_use", id: "t9", name: "Bash", input: {} }], "tool_use"),
    U({ message: { content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } }),
  ]).exchanges;
  assert.deepEqual(x.map((e) => [e.id, exchangeRow(e).state]), [["e", "none"]]);
});

test("exchangeRow: size weighs fenced code double and table lines triple", () => {
  const ex = { id: "s", by: "you", event: null, text: "hi", at: null, running: false,
    parts: [{ type: "text", text: "ab\n```\ncode\n```\n| t |", at: null }] };
  // "hi" 2 + "ab" 2+1 newline + fence lines 4+1, 3+1 counted once + "code\n" 5 x2 + "| t |" 5 x3
  const row = exchangeRow(ex);
  assert.ok(row.size > Buffer.byteLength("hi") + Buffer.byteLength(ex.parts[0].text));
});

// ---- hintReach: whether a session's last typed prompts got Render's hint ----
import { hintReach } from "../src/shared/render/transcript.js";
import { HINT_PHRASE } from "../src/shared/render/hints.js";

let seq = 0;
const P = (text) => JSON.stringify({ type: "user", uuid: `u${++seq}`, message: { role: "user", content: text } });
const H = (phrase = true, asString = false) => {
  const text = phrase ? `The ${HINT_PHRASE} draws diagrams.` : "Some other hook's context.";
  return JSON.stringify({ type: "attachment", uuid: `a${++seq}`, attachment: { type: "hook_additional_context", hookEvent: "UserPromptSubmit", content: asString ? text : [text] } });
};
const Q = (text) => JSON.stringify({ type: "attachment", uuid: `q${++seq}`, attachment: { type: "queued_command", prompt: text } });
const C = (cmd) => P(`<command-name>${cmd}</command-name>\n<command-message>${cmd.slice(1)}</command-message>`);

test("hintReach: ok when the newest prompt got the hint", () => assert.deepEqual(hintReach([P("a"), H(), P("b"), H()]), { state: "ok", checked: 2 }));
test("hintReach: silent when the newest two got none", () => assert.equal(hintReach([P("a"), H(), P("b"), P("c")]).state, "silent"));
test("hintReach: one prompt with no hint is unknown", () => assert.deepEqual(hintReach([P("a")]), { state: "unknown", checked: 1 }));
test("hintReach: newest missed but the one before got it is unknown", () => assert.equal(hintReach([P("a"), H(), P("b")]).state, "unknown"));
test("hintReach: slash commands, ! commands, queued messages and task notifications aren't prompts", () => {
  assert.equal(hintReach([P("a"), H(), P("b"), H(), C("/clear"), P("<bash-input>ls</bash-input>"), Q("typed mid-turn"), P("<task-notification>x</task-notification>")]).state, "ok");
});
test("hintReach: a hint given as a plain string counts; other hooks' context doesn't", () => {
  assert.equal(hintReach([P("a"), H(true, true)]).state, "ok");
  assert.equal(hintReach([P("a"), H(false), P("b"), H(false)]).state, "silent");
});
test("hintReach: stops after 3 prompts", () => assert.equal(hintReach([P("x"), H(), P("a"), P("b"), P("c")]).checked, 3));
test("hintReach: meta, sidechain and tool-result lines aren't prompts; an empty or broken log is unknown", () => {
  const meta = JSON.stringify({ type: "user", isMeta: true, message: { content: "skill text" } });
  const side = JSON.stringify({ type: "user", isSidechain: true, message: { content: "agent prompt" } });
  const tool = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: "out" }] } });
  assert.equal(hintReach([P("a"), H(), meta, side, tool, "{ broken"]).state, "ok");
  assert.deepEqual(hintReach([]), { state: "unknown", checked: 0 });
});

test("hintReach: interruptions aren't prompts, so two of them never read as silent", () => {
  const INT = (t = "[Request interrupted by user]") => JSON.stringify({ type: "user", message: { content: [{ type: "text", text: t }] } });
  const TN = JSON.stringify({ type: "user", origin: { kind: "task-notification" }, message: { content: "<task-notification>x</task-notification>" } });
  assert.equal(hintReach([P("a"), H(), INT(), TN, INT()]).state, "ok");
  assert.equal(hintReach([P("a"), H(), INT("[Request interrupted by user for tool use]"), INT()]).state, "ok");
});

test("hintReach: the hint is found in any attachment shape or name; a queued message holding the phrase isn't a hint", () => {
  const phrase = `The ${HINT_PHRASE} draws diagrams.`;
  const objects = JSON.stringify({ type: "attachment", attachment: { type: "hook_additional_context", content: [{ type: "text", text: phrase }] } });
  const renamed = JSON.stringify({ type: "attachment", attachment: { type: "hook_context_v2", context: phrase } });
  assert.equal(hintReach([P("a"), objects]).state, "ok");
  assert.equal(hintReach([P("a"), renamed]).state, "ok");
  assert.equal(hintReach([P("a"), H(), P("b"), Q(phrase), P("c")]).state, "silent");
});

test("hintReach: a compaction summary isn't a prompt, and the note after it isn't the previous prompt's hint", () => {
  const COMPACT = JSON.stringify({ type: "user", isCompactSummary: true, message: { content: "This session is being continued from a previous conversation." } });
  assert.deepEqual(hintReach([P("a"), P("b"), COMPACT, H()]), { state: "silent", checked: 2 });
});

test("hintReach: a hint after a turn that isn't counted isn't credited to the prompt before it; a meta line between doesn't matter", () => {
  const TN = JSON.stringify({ type: "user", origin: { kind: "task-notification" }, message: { content: "<task-notification>x</task-notification>" } });
  assert.equal(hintReach([P("a"), P("b"), TN, H()]).state, "silent");
  assert.equal(hintReach([P("a"), P("b"), C("/clear"), H()]).state, "silent");
  assert.equal(hintReach([P("a"), P("b"), Q("typed mid-turn"), H()]).state, "silent");
  const META = JSON.stringify({ type: "user", isMeta: true, message: { content: "skill text" } });
  assert.equal(hintReach([P("a"), META, H()]).state, "ok");
});

test("hintReach: a peer message's hint isn't the typed prompt's; the newest prompt's time comes back when logged", () => {
  const PEER = JSON.stringify({ type: "user", isMeta: true, origin: { kind: "peer" }, message: { content: "a message from another session" } });
  assert.equal(hintReach([P("a"), P("b"), PEER, H()]).state, "silent");
  const at = JSON.stringify({ type: "user", timestamp: "2026-11-25T14:00:00.000Z", message: { role: "user", content: "timed" } });
  assert.equal(hintReach([P("a"), at]).at, Date.parse("2026-11-25T14:00:00.000Z"));
  assert.equal("at" in hintReach([P("a")]), false);
});
