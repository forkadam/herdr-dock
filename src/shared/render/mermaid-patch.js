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
// Also circle / cross heads (--o, --x, o--o, ==o, -.-o) and invisible links (~~~).
export const ARROW_WIDE = "var ARROW_REGEX = /^([<ox])?(-{2,}>|-\\.+->|={2,}>|-{2,}[ox]|-\\.+-[ox]|={2,}[ox]|-{3,}|-\\.+-|={3,}|~{3,})(?:\\|([^|]*)\\|)?/;";
export const TEXT_ARROW = "var TEXT_ARROW_REGEX = /^(<)?(--|-\\.|==)\\s+(.+?)\\s+(-->|---|\\.\\->|-\\.\\-|==>|===)/;";
// A dotted text link (opened by -.) also closes with -.-> (tried before -.-) or .- (no head); the lookbehind keeps
// those two for dotted links, so a label holding " .-" in a -- or == link stays whole, as in Mermaid.
export const TEXT_ARROW_WIDE = "var TEXT_ARROW_REGEX = /^(<)?(--|-\\.|==)\\s+(.+?)\\s+(-{2,}>|-{3,}|\\.+->|(?<=^<?-\\.\\s.*)-\\.+->|-\\.+-|(?<=^<?-\\.\\s.*)\\.+-|={2,}>|={3,})/;";
export const ARROW_STYLE_HEAD = "function arrowStyleFromOp(op) {";
export const ARROW_STYLE_NORMALISE = '\n  if (/^~{3,}$/.test(op)) return "invisible";\n  op = op.replace(/[ox]$/, ">");\n  op = op.replace(/^-{2,}>$/, "-->").replace(/^-{3,}$/, "---").replace(/^-\\.+->$/, "-.->").replace(/^-\\.+-$/, "-.-").replace(/^={2,}>$/, "==>").replace(/^={3,}$/, "===");';
// A text arrow's closing operator (`-- text ..->`) is looked up the same way: normalised to its short form first.
export const TEXT_ARROW_STYLE_HEAD = "function textArrowStyleFromOps(openOp, closeOp) {";
export const TEXT_ARROW_STYLE_NORMALISE = '\n  closeOp = closeOp.replace(/^\\.+->$/, ".->").replace(/^-\\.+-$/, "-.-").replace(/^-{2,}>$/, "-->").replace(/^-{3,}$/, "---").replace(/^={2,}>$/, "==>").replace(/^={3,}$/, "===").replace(/^-\\.+->$/, ".->").replace(/^\\.+-$/, "-.-");';
// Class names may hold hyphens (classDef my-cls, class B my-cls): beautiful-mermaid read them as \w+, so such a line
// was drawn as a stray node `classDef` and the class never applied.
export const CLASS_DEF = "line.match(/^classDef\\s+(\\w+)\\s+(.+)$/);";
export const CLASS_DEF_WIDE = "line.match(/^classDef\\s+([\\w-]+)\\s+(.+)$/);";
export const CLASS_ASSIGN = "line.match(/^class\\s+([\\w,-]+)\\s+(\\w+)$/);";
export const CLASS_ASSIGN_WIDE = "line.match(/^class\\s+([\\w,-]+)\\s+([\\w-]+)$/);";
// The kind of head rides on hasArrowStart / hasArrowEnd (true, "circle" or "cross"), which the layout already copies to
// the drawn edge; the renderer picks its marker from it and gains circle / cross markers. An invisible edge (~~~) is
// laid out but draws neither line nor label.
export const ARROW_START = 'hasArrowStart = Boolean(arrowMatch[1]);';
export const ARROW_START_KIND = 'hasArrowStart = arrowMatch[1] === "o" ? "circle" : arrowMatch[1] === "x" ? "cross" : Boolean(arrowMatch[1]);';
export const ARROW_END = 'hasArrowEnd = arrowOp.endsWith(">");';
export const ARROW_END_KIND = 'hasArrowEnd = arrowOp.endsWith(">") ? true : arrowOp.endsWith("o") ? "circle" : arrowOp.endsWith("x") ? "cross" : false;\n      linkLen = linkLength(arrowOp);';
export const RENDER_EDGE = 'function renderEdge(edge) {\n  if (edge.points.length < 2) return "";';
export const RENDER_EDGE_INVISIBLE = 'function renderEdge(edge) {\n  if (edge.points.length < 2 || edge.style === "invisible") return "";';
export const END_MARKER = 'if (edge.hasArrowEnd) markers += ` marker-end="url(#arrowhead${suffix})"`;';
export const END_MARKER_KIND = 'if (edge.hasArrowEnd) markers += edge.hasArrowEnd === true ? ` marker-end="url(#arrowhead${suffix})"` : ` marker-end="url(#${edge.hasArrowEnd}head)"`;';
export const START_MARKER = 'if (edge.hasArrowStart) markers += ` marker-start="url(#arrowhead-start${suffix})"`;';
export const START_MARKER_KIND = 'if (edge.hasArrowStart) markers += edge.hasArrowStart === true ? ` marker-start="url(#arrowhead-start${suffix})"` : ` marker-start="url(#${edge.hasArrowStart}head-start)"`;';
export const MARKER_DEFS = '  parts.push(arrowMarkerDefs());';
export const MARKER_DEFS_HEADS = MARKER_DEFS + '\n  parts.push(`<marker id="circlehead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><circle cx="4" cy="4" r="3" fill="var(--_arrow)" /></marker>' +
  '<marker id="circlehead-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><circle cx="4" cy="4" r="3" fill="var(--_arrow)" /></marker>' +
  '<marker id="crosshead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M1 1 L7 7 M7 1 L1 7" stroke="var(--_arrow)" stroke-width="1.5" fill="none" /></marker>' +
  '<marker id="crosshead-start" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto"><path d="M1 1 L7 7 M7 1 L1 7" stroke="var(--_arrow)" stroke-width="1.5" fill="none" /></marker>`);';
export const EDGE_LABEL = 'if (edge.label) {\n      parts.push(renderEdgeLabel(edge, font));';
export const EDGE_LABEL_VISIBLE = 'if (edge.label && edge.style !== "invisible") {\n      parts.push(renderEdgeLabel(edge, font));';
// A two-way arrow's start head: beautiful-mermaid flipped its polygon AND set orient="auto-start-reverse", reversing it
// twice, so it pointed away from its node and hid inside it. It takes the end head's shape and refX; the orient turns it.
export const START_HEAD = '  <marker id="arrowhead-start" markerWidth="${w}" markerHeight="${h}" refX="1" refY="${h / 2}" orient="auto-start-reverse">\n    <polygon points="${w} 0, 0 ${h / 2}, ${w} ${h}" ${arrowStyle} />';
export const START_HEAD_TURNED = '  <marker id="arrowhead-start" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto-start-reverse">\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />';
export const START_HEAD_COLOURED = '  <marker id="arrowhead-start-${suffix}" markerWidth="${w}" markerHeight="${h}" refX="1" refY="${h / 2}" orient="auto-start-reverse">\n    <polygon points="${w} 0, 0 ${h / 2}, ${w} ${h}" ${arrowStyle} />';
export const START_HEAD_COLOURED_TURNED = '  <marker id="arrowhead-start-${suffix}" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto-start-reverse">\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />';
// Long links drawn at their length: ELK has no per-edge length, so a link of length n runs through n - 1 invisible
// 0 x 0 waypoint nodes (shape "waypoint", drawn as nothing), which make it lay out the extra layers. Length as in
// Mermaid: the dots of a dotted link; else the - / = / ~ count, minus 1 with a head, minus 2 without. The first hop
// takes the start head, the last the end head, the middle one the label; every hop carries its link's index, so
// linkStyle N still names the N-th link.
export const LINK_HELPERS = 'function consumeNodeGroup(text, graph, subgraphStack) {';
export const LINK_HELPERS_ADDED = 'function linkLength(op) {\n  const dots = (op.match(/\\./g) || []).length;\n  if (dots) return dots;\n  const n = (op.match(/[-=~]/g) || []).length;\n  return Math.max(1, /[>ox]$/.test(op) ? n - 1 : n - 2);\n}\nfunction addLinkWaypoint(graph, subgraphStack) {\n  graph.linkWaypoints = (graph.linkWaypoints || 0) + 1;\n  const id = "__bm_link_" + graph.linkWaypoints;\n  registerNode(graph, subgraphStack, { id, label: "", shape: "waypoint" });\n  return id;\n}\n' + LINK_HELPERS;
export const LINK_LOOP = '  while (remaining.length > 0) {\n    let hasArrowStart;';
export const LINK_LOOP_LENGTH = '  while (remaining.length > 0) {\n    let linkLen = 1;\n    let hasArrowStart;';
export const TEXT_LINK_END = 'hasArrowEnd = closeOp.endsWith(">");';
export const TEXT_LINK_END_LENGTH = 'hasArrowEnd = closeOp.endsWith(">");\n      linkLen = linkLength(closeOp);';
export const LINK_EDGES = '      for (const targetId of nextGroup.ids) {\n        graph.edges.push({\n          source: sourceId,\n          target: targetId,\n          label: edgeLabel,\n          style,\n          hasArrowStart,\n          hasArrowEnd\n        });\n      }';
export const LINK_EDGES_CHAIN = '      for (const targetId of nextGroup.ids) {\n        const linkIndex = graph.linkCount = (graph.linkCount ?? -1) + 1;\n        const stops = [sourceId, ...Array.from({ length: linkLen - 1 }, () => addLinkWaypoint(graph, subgraphStack)), targetId];\n        const labelled = Math.floor((stops.length - 2) / 2);\n        for (let i = 0; i + 1 < stops.length; i++) {\n          graph.edges.push({\n            source: stops[i],\n            target: stops[i + 1],\n            label: i === labelled ? edgeLabel : void 0,\n            style,\n            hasArrowStart: i === 0 ? hasArrowStart : false,\n            hasArrowEnd: i + 2 === stops.length ? hasArrowEnd : false,\n            linkIndex\n          });\n        }\n      }';
export const NODE_SIZE = 'function estimateNodeSize(id, label, shape) {';
export const NODE_SIZE_WAYPOINT = NODE_SIZE + '\n  if (shape === "waypoint") return { width: 0, height: 0 };';
export const NODE_DRAW = 'function renderNode(node, font) {';
export const NODE_DRAW_WAYPOINT = NODE_DRAW + '\n  if (node.shape === "waypoint") return "";';
export const LINK_STYLE = 'inlineStyle: resolveEdgeStyle(edgeIndex, graph)';
export const LINK_STYLE_INDEX = 'inlineStyle: resolveEdgeStyle(originalEdge.linkIndex ?? edgeIndex, graph)';
// Each must be in the source exactly once, or the build fails.
export const LINE_REWRITES = [
  { name: "class shorthand pattern", from: CLASS_SHORTHAND, to: CLASS_SHORTHAND_BEFORE_ARROW },
  { name: "arrow pattern", from: ARROW, to: ARROW_WIDE },
  { name: "text arrow pattern", from: TEXT_ARROW, to: TEXT_ARROW_WIDE },
  { name: "arrow style", from: ARROW_STYLE_HEAD, to: ARROW_STYLE_HEAD + ARROW_STYLE_NORMALISE },
  { name: "text arrow style", from: TEXT_ARROW_STYLE_HEAD, to: TEXT_ARROW_STYLE_HEAD + TEXT_ARROW_STYLE_NORMALISE },
  { name: "classDef name", from: CLASS_DEF, to: CLASS_DEF_WIDE },
  { name: "class assignment", from: CLASS_ASSIGN, to: CLASS_ASSIGN_WIDE },
  { name: "arrow start kind", from: ARROW_START, to: ARROW_START_KIND },
  { name: "arrow end kind", from: ARROW_END, to: ARROW_END_KIND },
  { name: "invisible edge", from: RENDER_EDGE, to: RENDER_EDGE_INVISIBLE },
  { name: "end marker", from: END_MARKER, to: END_MARKER_KIND },
  { name: "start marker", from: START_MARKER, to: START_MARKER_KIND },
  { name: "head markers", from: MARKER_DEFS, to: MARKER_DEFS_HEADS },
  { name: "invisible label", from: EDGE_LABEL, to: EDGE_LABEL_VISIBLE },
  { name: "start marker shape", from: START_HEAD, to: START_HEAD_TURNED },
  { name: "coloured start marker shape", from: START_HEAD_COLOURED, to: START_HEAD_COLOURED_TURNED },
  { name: "link helpers", from: LINK_HELPERS, to: LINK_HELPERS_ADDED },
  { name: "link length variable", from: LINK_LOOP, to: LINK_LOOP_LENGTH },
  { name: "text link length", from: TEXT_LINK_END, to: TEXT_LINK_END_LENGTH },
  { name: "link waypoint chain", from: LINK_EDGES, to: LINK_EDGES_CHAIN },
  { name: "waypoint size", from: NODE_SIZE, to: NODE_SIZE_WAYPOINT },
  { name: "waypoint drawing", from: NODE_DRAW, to: NODE_DRAW_WAYPOINT },
  { name: "link style index", from: LINK_STYLE, to: LINK_STYLE_INDEX },
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
