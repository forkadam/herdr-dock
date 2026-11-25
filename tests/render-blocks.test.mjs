// The Render panel's reply blocks (src/shared/render/blocks.js) and their table copies (table-copy.js).
import test from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { toBlocks, replyButtons } from "../src/shared/render/blocks.js";
import { tableArt, tableText, width } from "../src/shared/render/table-copy.js";
import { blockId } from "../src/shared/render/markdown.js";

const ALL = "# Title\n\nIntro para.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n> quoted\n> more\n\n> [!WARNING]\n> Careful now\n\n```js\nconst x = 1;\n```\n\n```mermaid\ngraph TD\n A-->B\n```\n\nEnd.";
const labels = (b) => b.buttons.map((x) => x.label);

test("toBlocks: kinds in order; consecutive text merges and has no buttons", () => {
  const b = toBlocks(ALL);
  assert.deepEqual(b.map((x) => x.kind), ["text", "table", "list", "quote", "alert", "code", "mermaid", "text"]);
  assert.equal(b[0].md, "# Title\n\nIntro para.");
  assert.deepEqual(b[0].buttons, []);
  assert.equal(b[7].md, "End.");
});

test("toBlocks: each block's buttons and what they copy", () => {
  const [, table, list, quote, alert, code, pic] = toBlocks(ALL);
  assert.deepEqual(labels(table), ["md", "art", "html"]);
  assert.equal(table.buttons[0].text, "| a | b |\n|---|---|\n| 1 | 2 |");
  assert.equal(table.buttons[2].text, "a\tb\n1\t2");
  assert.match(table.buttons[2].html, /<table>[\s\S]*<th>a<\/th>[\s\S]*<td>2<\/td>/);
  assert.deepEqual(list.buttons, [{ label: "copy", text: "- one\n- two" }]);
  assert.deepEqual(quote.buttons, [{ label: "copy", text: "quoted\nmore" }]);
  assert.equal(alert.alert, "warning");
  assert.equal(alert.md, "Careful now");
  assert.deepEqual(alert.buttons, [{ label: "copy", text: "Careful now" }]);
  assert.equal(code.lang, "js");
  assert.deepEqual(code.buttons, [{ label: "copy", text: "const x = 1;" }]);
  assert.equal(pic.source, "graph TD\n A-->B");
  assert.equal(pic.id, blockId("mermaid", "graph TD\n A-->B"));
  assert.deepEqual(pic.buttons, [{ label: "copy source", text: "graph TD\n A-->B" }]);
});

test("alerts: the five kinds in any case; an unknown tag stays a quote", () => {
  for (const k of ["NOTE", "TIP", "IMPORTANT", "WARNING", "caution"]) {
    const [b] = toBlocks(`> [!${k}]\n> body`);
    assert.equal(b.kind, "alert");
    assert.equal(b.alert, k.toLowerCase());
  }
  assert.equal(toBlocks("> [!FOO]\n> body")[0].kind, "quote");
});

test("a code block inside a list item stays in the list", () => {
  assert.deepEqual(toBlocks("- step\n\n  ```bash\n  npm test\n  ```\n- next").map((x) => x.kind), ["list"]);
});

test("an unclosed mermaid fence (still streaming) is code, not a picture", () => {
  const b = toBlocks("a\n\n```mermaid\ngraph TD");
  assert.deepEqual(b.map((x) => x.kind), ["text", "code"]);
  assert.equal(b[1].lang, "mermaid");
});

test("a table still streaming (no full delimiter row) is text", () => {
  assert.deepEqual(toBlocks("| a | b |\n|--").map((x) => x.kind), ["text"]);
});

test("CRLF text gives the same blocks as LF", () => {
  assert.deepEqual(toBlocks(ALL.replace(/\n/g, "\r\n")), toBlocks(ALL));
});

test("replyButtons: copy md is the text as written; copy html is marked's HTML with the Markdown as plain text", () => {
  const md = "**Hi** there\n\n```mermaid\ngraph TD\n A\n```";
  const [m, h] = replyButtons(md);
  assert.deepEqual(m, { label: "copy md", text: md });
  assert.equal(h.label, "copy html");
  assert.equal(h.text, md);
  assert.match(h.html, /<strong>Hi<\/strong>/);
  assert.match(h.html, /<pre><code class="language-mermaid">/);
});

test("tableArt: boxed, a rule between every row, headers centred, body aligned, wide characters two columns, fenced", () => {
  const tok = marked.lexer("| Mod | Status |\n|:--|--:|\n| core | ✓ |\n| 日本 | ok |")[0];
  assert.equal(tableArt(tok), ["```", "┌──────┬────────┐", "│ Mod  │ Status │", "├──────┼────────┤", "│ core │      ✓ │",
    "├──────┼────────┤", "│ 日本 │     ok │", "└──────┴────────┘", "```"].join("\n"));
});

test("tableArt: inline markup removed; a table wider than 100 columns wraps its cells", () => {
  const tok = marked.lexer("| a | b |\n|---|---|\n| **bold** `code` [link](http://x) | " + "word ".repeat(40) + "|")[0];
  const art = tableArt(tok).split("\n");
  assert.ok(art.some((l) => l.includes("bold code link")));
  assert.ok(art.every((l) => width(l) <= 100), "every line fits 100 columns");
  assert.equal(art.join(" ").match(/word/g).length, 40);
});

test("tableText: tab-separated plain text; cells with tabs, newlines or quotes are quoted; escaped pipes kept", () => {
  const tok = marked.lexer('| a | b |\n|---|---|\n| x \\| y | say "hi" |')[0];
  assert.equal(tableText(tok), 'a\tb\nx | y\t"say ""hi"""');
});

test("width: CJK counts two columns, ✓ one, a combining mark none", () => {
  assert.equal(width("日本"), 4);
  assert.equal(width("✓"), 1);
  assert.equal(width("e\u0301"), 1);
});
