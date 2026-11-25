// Long content cut into pages for the Render panel (helper side): consecutive blocks while a page stays within the
// budget, cut only between blocks. A block bigger than a page is cut too: text by its paragraphs and headings, code by
// lines, a table by rows (its header repeated); anything else that can't be cut is a page of its own.
import { marked } from "marked";
import { BUDGET } from "./budget.js";
import { fenced, toBlocks } from "./blocks.js";

export { BUDGET };

const bytes = (s) => new TextEncoder().encode(String(s ?? "")).length;

// Items -> groups whose summed size stays within `room` (an item bigger than room is a group of its own).
function groups(items, size, room) {
  const out = [];
  let cur = [], n = 0;
  for (const it of items) {
    const s = size(it);
    if (cur.length && n + s > room) { out.push(cur); cur = []; n = 0; }
    cur.push(it);
    n += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

function split(b, budget) {
  if (b.kind === "code") {
    const lines = b.buttons[0].text.split("\n");
    const room = budget - bytes(b.lang) - 16;
    return groups(lines, (l) => bytes(l) + 1, room).flatMap((g) => toBlocks(fenced(g.join("\n"), b.lang ?? "")));
  }
  if (b.kind === "table") {
    const lines = b.md.split("\n");
    const head = lines.slice(0, 2);
    const room = budget - bytes(head.join("\n")) - 2;
    return groups(lines.slice(2), (l) => bytes(l) + 1, room).flatMap((g) => toBlocks([...head, ...g].join("\n")));
  }
  if (b.kind === "text") {
    const tokens = marked.lexer(b.md, { gfm: true });
    return groups(tokens, (t) => bytes(t.raw), budget).flatMap((g) => toBlocks(g.map((t) => t.raw).join("")));
  }
  return [b];
}

// Blocks -> pages (at least one, possibly empty).
export function paginate(blocks, budget = BUDGET) {
  const pieces = blocks.flatMap((b) => ((b.bytes ?? 0) > budget ? split(b, budget) : [b]));
  const pages = groups(pieces, (b) => b.bytes ?? 0, budget);
  return pages.length ? pages : [[]];
}
