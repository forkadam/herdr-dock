# Long links drawn at their length — design

Date: 2026-11-24. Follows [beautiful-mermaid's limits](2026-11-23-mermaid-limits-design.md). Adam asked for long links
(`A ---> B`, `A ----> B`) to be drawn longer, as Mermaid does, after first deciding to skip it; he approved this design.

## Why not the obvious ways

- ELK (beautiful-mermaid's layout) has no per-edge length.
- `layerChoiceConstraint` pins a node to a layer but can't create empty layers: tested, a pinned node falls back to the
  last existing layer.
- Stretching the drawing after layout would mean re-routing edges by hand.

## Design (proven in a scratch bundle)

- A link of length n is drawn through n − 1 invisible waypoint nodes (shape `waypoint`, 0 × 0, drawn as nothing,
  registered with beautiful-mermaid's own `registerNode`, so they join the subgraph being written). ELK then lays out
  the extra layers; the hops meet at the waypoints and read as one line.
- The first hop takes the start head, the last the end head, the middle hop the label; every hop keeps the style.
- Length follows Mermaid's table: dots count in a dotted link (`-.->` 1, `-..->` 2); otherwise the `-` / `=` / `~`
  count, minus 1 with a head (`-->` 1, `--->` 2, `--o` 1), minus 2 without (`---` 1, `----` 2, `~~~` 1). Text links use
  their closing operator (`-- t ---> B` 2).
- `linkStyle N` keeps meaning the N-th link: every flowchart edge carries its link's index (counted per link, not per
  hop) and the style lookup uses it; state-diagram edges, which carry none, keep using their position.
- Links of length 1 (nearly all) take exactly today's path: one edge, no waypoint.

Measured (LR): `A --> B` 108 px apart, `A ---> B` 156, `A ----> B` 204; in `A --> B; A ----> C; B --> C`, C moves a layer
out and the long link routes around B as one line.

## Patched (guarded rewrites of beautiful-mermaid's `dist/index.js`)

The `linkLength` and `addLinkWaypoint` helpers (before `consumeNodeGroup`); `let linkLen = 1` in the arrow loop; the
length from the arrow operator (with the end-head rewrite) and from a text link's closing operator; the edge emission
as a waypoint chain with `linkIndex`; `estimateNodeSize` (waypoints 0 × 0); `renderNode` (waypoints draw nothing); the
style lookup (`originalEdge.linkIndex ?? edgeIndex`). `LOOK_VERSION` 10 → 11. README: long links are drawn longer.

## Known limit

A long link written inside a subgraph places its waypoints in that subgraph, as any node defined on that line.
