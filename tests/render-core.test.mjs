// The Render panel's pure core: Markdown / Mermaid segments, transcripts (Claude Code, Codex), SVG flattening.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashText, mermaidBlocks, splitSegments } from "../src/shared/render/markdown.js";
import { claudeSlug, readClaude, readCodex, codexCwd } from "../src/shared/render/transcript.js";
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

test("readClaude: the latest answer is the assistant text after the last real user message; tool results don't count", () => {
  const r = readClaude(lines("claude.jsonl"));
  assert.equal(r.answer.text, "Let me look.\n\n## Sequence\n\n~~~Mermaid\nsequenceDiagram\n  U->>S: login\n~~~\n\n```js\nconst x = 1;\n```");
  assert.equal(r.answer.at, Date.parse("2026-11-22T10:01:03.000Z"));
  assert.equal(r.prompt, "Now the sequence, and check the code");
  // Every diagram the agent wrote, newest first; none from tool results or the user.
  assert.deepEqual(r.diagrams.map((d) => [d.source.split("\n")[0], d.at]),
    [["sequenceDiagram", Date.parse("2026-11-22T10:01:03.000Z")], ["flowchart LR", Date.parse("2026-11-22T10:00:02.000Z")]]);
  assert.deepEqual(readClaude([]), { answer: null, prompt: null, diagrams: [] });
});

test("readCodex: the same from a Codex rollout, and its cwd", () => {
  const l = lines("codex.jsonl");
  const r = readCodex(l);
  assert.equal(r.answer.text, "Sure:\n```mermaid\ngraph TD\n  P-->Q\n```");
  assert.equal(r.prompt, "diagram please");
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
