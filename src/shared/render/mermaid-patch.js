// beautiful-mermaid's node ids, rewritten as the Render helper is bundled (pure; no imports). beautiful-mermaid 1.1.3
// reads an id as [\w-]+, so an arrow written without spaces is swallowed into it: `A-->B` draws one node `A--`. With
// (?:\w|-(?![-.>]))+ a hyphen is part of an id only when it doesn't start an arrow (-- -. ->): `my-node-->B` still
// keeps its hyphen. As in Mermaid, an id can't contain `--`, `-.` or `->` (`my--node` reads as `my`). The `:::class`
// shorthand after a node ([\w][\w-]*) swallows the same way (`A:::hot-->B` is one node of class `hot--`), so it gets
// the same rule. The rewrite fails rather than guess if the library moved its patterns, so an upgrade can't ship the
// bug back silently.
// The id rule is prismantis's (scripts/build-vendor.mjs, MIT, (c) 2026 Nahum Litvin: https://github.com/NahumLitvin/prismantis).

export const NODE_ID = "[\\w-]+";
export const NODE_ID_BEFORE_ARROW = "(?:\\w|-(?![-.>]))+";
const START = "var NODE_PATTERNS = [";
const END = "var CLASS_SHORTHAND_REGEX";
const EXPECTED = 13; // the 12 node shapes and the bare id
export const CLASS_SHORTHAND = "var CLASS_SHORTHAND_REGEX = /^:::([\\w][\\w-]*)/;";
export const CLASS_SHORTHAND_BEFORE_ARROW = "var CLASS_SHORTHAND_REGEX = /^:::(\\w(?:\\w|-(?![-.>]))*)/;";
// Long links (A---->B, A-..->B, A====>B, A-- text --->B): beautiful-mermaid's arrow patterns know fixed lengths
// only, so a longer link left a stray node and no edge; its style lookup compares exact operators, so a long one is
// normalised to its short form first. A long link is drawn at the usual length.
export const ARROW = "var ARROW_REGEX = /^(<)?(-->|-.->|==>|---|-\\.-|===)(?:\\|([^|]*)\\|)?/;";
export const ARROW_WIDE = "var ARROW_REGEX = /^(<)?(-{2,}>|-\\.+->|={2,}>|-{3,}|-\\.+-|={3,})(?:\\|([^|]*)\\|)?/;";
export const TEXT_ARROW = "var TEXT_ARROW_REGEX = /^(<)?(--|-\\.|==)\\s+(.+?)\\s+(-->|---|\\.\\->|-\\.\\-|==>|===)/;";
// A dotted text link also closes with -.-> (tried before -.-) or .- (no head).
export const TEXT_ARROW_WIDE = "var TEXT_ARROW_REGEX = /^(<)?(--|-\\.|==)\\s+(.+?)\\s+(-{2,}>|-{3,}|\\.+->|-\\.+->|-\\.+-|\\.+-|={2,}>|={3,})/;";
export const ARROW_STYLE_HEAD = "function arrowStyleFromOp(op) {";
export const ARROW_STYLE_NORMALISE = '\n  op = op.replace(/^-{2,}>$/, "-->").replace(/^-{3,}$/, "---").replace(/^-\\.+->$/, "-.->").replace(/^-\\.+-$/, "-.-").replace(/^={2,}>$/, "==>").replace(/^={3,}$/, "===");';
// A text arrow's closing operator (`-- text ..->`) is looked up the same way: normalised to its short form first.
export const TEXT_ARROW_STYLE_HEAD = "function textArrowStyleFromOps(openOp, closeOp) {";
export const TEXT_ARROW_STYLE_NORMALISE = '\n  closeOp = closeOp.replace(/^\\.+->$/, ".->").replace(/^-\\.+-$/, "-.-").replace(/^-{2,}>$/, "-->").replace(/^-{3,}$/, "---").replace(/^={2,}>$/, "==>").replace(/^={3,}$/, "===").replace(/^-\\.+->$/, ".->").replace(/^\\.+-$/, "-.-");';
// Class names may hold hyphens (classDef my-cls, class B my-cls): beautiful-mermaid read them as \w+, so such a line
// was drawn as a stray node `classDef` and the class never applied.
export const CLASS_DEF = "line.match(/^classDef\\s+(\\w+)\\s+(.+)$/);";
export const CLASS_DEF_WIDE = "line.match(/^classDef\\s+([\\w-]+)\\s+(.+)$/);";
export const CLASS_ASSIGN = "line.match(/^class\\s+([\\w,-]+)\\s+(\\w+)$/);";
export const CLASS_ASSIGN_WIDE = "line.match(/^class\\s+([\\w,-]+)\\s+([\\w-]+)$/);";
// Each must be in the source exactly once, or the build fails.
export const LINE_REWRITES = [
  { name: "class shorthand pattern", from: CLASS_SHORTHAND, to: CLASS_SHORTHAND_BEFORE_ARROW },
  { name: "arrow pattern", from: ARROW, to: ARROW_WIDE },
  { name: "text arrow pattern", from: TEXT_ARROW, to: TEXT_ARROW_WIDE },
  { name: "arrow style", from: ARROW_STYLE_HEAD, to: ARROW_STYLE_HEAD + ARROW_STYLE_NORMALISE },
  { name: "text arrow style", from: TEXT_ARROW_STYLE_HEAD, to: TEXT_ARROW_STYLE_HEAD + TEXT_ARROW_STYLE_NORMALISE },
  { name: "classDef name", from: CLASS_DEF, to: CLASS_DEF_WIDE },
  { name: "class assignment", from: CLASS_ASSIGN, to: CLASS_ASSIGN_WIDE },
];

// beautiful-mermaid's dist/index.js -> the same with its node ids and class shorthand arrow-aware, and long links read.
export function patchMermaidIds(source) {
  const start = source.indexOf(START);
  const end = start < 0 ? -1 : source.indexOf(END, start);
  if (start < 0 || end < 0) throw new Error("beautiful-mermaid no longer declares NODE_PATTERNS before CLASS_SHORTHAND_REGEX");
  const region = source.slice(start, end);
  const n = region.split(NODE_ID).length - 1;
  if (n !== EXPECTED) throw new Error(`beautiful-mermaid has ${n} node-id patterns, expected ${EXPECTED}`);
  let out = source.slice(0, start) + region.replaceAll(NODE_ID, NODE_ID_BEFORE_ARROW) + source.slice(end);
  for (const { name, from, to } of LINE_REWRITES) {
    if (out.split(from).length !== 2) throw new Error(`beautiful-mermaid's ${name} changed`);
    out = out.replace(from, () => to);
  }
  return out;
}
