// beautiful-mermaid's node ids, rewritten as the Render helper is bundled (pure; no imports). beautiful-mermaid 1.1.3
// reads an id as [\w-]+, so an arrow written without spaces is swallowed into it: `A-->B` draws one node `A--`. With
// (?:\w|-(?![-.>]))+ a hyphen is part of an id only when it doesn't start an arrow (-- -. ->): `my-node-->B` still
// keeps its hyphen. The rewrite fails rather than guess if the library moved its patterns, so an upgrade can't ship
// the bug back silently.
// The id rule is prismantis's (scripts/build-vendor.mjs, MIT, (c) 2026 Nahum Litvin: https://github.com/NahumLitvin/prismantis).

export const NODE_ID = "[\\w-]+";
export const NODE_ID_BEFORE_ARROW = "(?:\\w|-(?![-.>]))+";
const START = "var NODE_PATTERNS = [";
const END = "var CLASS_SHORTHAND_REGEX";
const EXPECTED = 13; // the 12 node shapes and the bare id

// beautiful-mermaid's dist/index.js -> the same with its node-id patterns arrow-aware.
export function patchMermaidIds(source) {
  const start = source.indexOf(START);
  const end = start < 0 ? -1 : source.indexOf(END, start);
  if (start < 0 || end < 0) throw new Error("beautiful-mermaid no longer declares NODE_PATTERNS before CLASS_SHORTHAND_REGEX");
  const region = source.slice(start, end);
  const n = region.split(NODE_ID).length - 1;
  if (n !== EXPECTED) throw new Error(`beautiful-mermaid has ${n} node-id patterns, expected ${EXPECTED}`);
  return source.slice(0, start) + region.replaceAll(NODE_ID, NODE_ID_BEFORE_ARROW) + source.slice(end);
}
