// Inline Markdown as coloured runs (src/shared/render/runs.js).
import test from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { decorate, inlineRuns } from "../src/shared/render/runs.js";

const runs = (md) => inlineRuns(marked.lexer(md)[0].tokens);

test("inlineRuns: bold, italic, strike, code, links, line breaks", () => {
  assert.deepEqual(runs("a **b** *c* ~~d~~ `e` [f](http://g)"), [
    { text: "a " }, { text: "b", role: "strong", bold: true }, { text: " " }, { text: "c", role: "em", italic: true },
    { text: " " }, { text: "d", strike: true, role: "del" }, { text: " " }, { text: "e", role: "code" }, { text: " " },
    { text: "f", role: "link", href: "http://g" },
  ]);
  assert.deepEqual(runs("x  \ny").map((r) => r.text), ["x", "\n", "y"]);
});

test("decorate: numbers and paths in plain text; a path wins an overlap; nothing inside code or links", () => {
  assert.deepEqual(decorate("26 checks in 41s at ~/a/b.json v1.2"), [
    { text: "26", role: "number" }, { text: " checks in " }, { text: "41s", role: "number" }, { text: " at " },
    { text: "~/a/b.json", role: "path" }, { text: " " }, { text: "v1.2", role: "number" },
  ]);
  assert.deepEqual(runs("`port 80` [see /x](http://h)").map((r) => r.role ?? null), ["code", null, "link"]);
});

test("inlineRuns: bold keeps numbers coloured inside it, still bold", () => {
  assert.deepEqual(runs("**26 passed**"), [{ text: "26", role: "number", bold: true }, { text: " passed", role: "strong", bold: true }]);
});

test("inlineRuns: raw inline HTML shows as its text", () => {
  assert.equal(runs("a <kbd>Ctrl</kbd> b").map((r) => r.text).join(""), "a <kbd>Ctrl</kbd> b");
});
