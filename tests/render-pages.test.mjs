// Long content cut into pages within the 64 KB budget (src/shared/render/pages.js).
import test from "node:test";
import assert from "node:assert/strict";
import { BUDGET, paginate } from "../src/shared/render/pages.js";
import { toBlocks } from "../src/shared/render/blocks.js";

test("small content is one page; pages never exceed the budget and cut only between blocks", () => {
  assert.equal(BUDGET, 65536);
  assert.equal(paginate(toBlocks("a\n\n- b")).length, 1);
  const para = "word ".repeat(2000);
  const pages = paginate(toBlocks(Array.from({ length: 20 }, () => para).join("\n\n```sh\nls\n```\n\n")));
  assert.ok(pages.length >= 3);
  assert.ok(pages.every((p) => p.reduce((n, b) => n + b.bytes, 0) <= BUDGET));
});

test("a code block bigger than a page is cut by lines; a table by rows with its header repeated", () => {
  const code = "```js\n" + Array.from({ length: 4000 }, (_, i) => `let v${i} = ${i}; // some text`).join("\n") + "\n```";
  const pages = paginate(toBlocks(code));
  assert.ok(pages.length > 1 && pages.every((p) => p[0].kind === "code" && p[0].bytes <= BUDGET));
  assert.equal(pages.flatMap((p) => p[0].lines).length, 4000);
  const table = "| a | b |\n|---|---|\n" + Array.from({ length: 3000 }, (_, i) => `| row ${i} | ${"x".repeat(20)} |`).join("\n");
  const tp = paginate(toBlocks(table));
  assert.ok(tp.length > 1 && tp.every((p) => p[0].header.length === 2));
  assert.equal(tp.flatMap((p) => p[0].rows).length, 3000);
});

test("pages are cut by cost: 40 KB of code (cost 80 KB) takes two pages", () => {
  const code = "```js\n" + Array.from({ length: 1400 }, (_, i) => `let v${i} = ${i}; // text`).join("\n") + "\n```";
  const [b] = toBlocks(code);
  assert.ok(b.bytes < 65536 && b.cost > 65536);
  assert.ok(paginate([b]).length >= 2);
});
