# Long links drawn at their length — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `A ---> B` is one layer longer than `A --> B`, `A ----> B` two, in the Render panel; heads, labels and
`linkStyle` stay right.

**Spec:** `docs/superpowers/specs/2026-11-24-mermaid-long-link-length-design.md`

## Global Constraints

- Branch `mermaid-long-links` from `main` (27e7fd3). Regenerate `app/` before committing. The only expected failure is
  the known `tests/dock-core-class.test.mjs`. Write the patch constants through a script (they hold backticks, `${}`,
  `\n` and regex escapes).
- Each rewrite is a `LINE_REWRITES` entry with the exactly-once guard. The anchors were all proven once each by the
  scratch prototype (`scratchpad/hyp5/build.mjs`):
  - `function consumeNodeGroup(text, graph, subgraphStack) {`
  - `  while (remaining.length > 0) {\n    let hasArrowStart;`
  - `hasArrowEnd = closeOp.endsWith(">");`
  - the 8-line `for (const targetId of nextGroup.ids) { graph.edges.push({ … }); }` block
  - `function estimateNodeSize(id, label, shape) {`
  - `function renderNode(node, font) {`
  - `inlineStyle: resolveEdgeStyle(edgeIndex, graph)`

  `ARROW_END_KIND`'s `to` also gains `\n      linkLen = linkLength(arrowOp);`. Waypoint ids are `__bm_link_N`.
- `LOOK_VERSION` 10 → 11. Deploy only from `~/Dev/Workspace/herdr-dock` after the merge.

## Review Focus

1. **Short links** take exactly today's path, with no waypoints. Test in step 1, and the existing tests stay green.
2. **`linkStyle` indices after a long link** still name the right link. Test in step 1.
3. **Heads and labels:** one end head on the last hop, one start head on the first hop, the label once, mid-link.
   Test in step 1.
4. **Dotted, thick, invisible and text long links** get their length. Test in step 1.
5. **No waypoint is ever drawn:** no node group or label for `__bm_link_`. Test in step 1.

### Task 1: long links

- [ ] **Tests** (`tests/render-mermaid-patch.test.mjs`): `LINE_REWRITES.length` is 23. Using `drawAll`:
  - **Spacing (LR):** the x distance from A to B for `A --> B`, `A ---> B` and `A ----> B` grows in two equal steps
    (within 1 px). `A -..-> B`, `A ===> B` and `A -- t ---> B` each match `A ---> B`.
  - **Short links:** `A --> B --> C` has 2 edges, and no `data-from` or `data-to` starts with `__bm_link_`.
  - **Heads and hops:** for `A ----> B`:
    - 3 edges;
    - exactly 1 `marker-end`, on the edge with `data-to="B"`;
    - no `data-id="__bm_link_`.

    `A <----> B` has its `marker-start` on the edge with `data-from="A"`.
  - **Label:** `A -- yes ----> B` has exactly 1 `edge-label`, reading `yes`.
  - **`linkStyle`:** with `A ----> B\n  B --> C\n  linkStyle 1 stroke:#ff0000`, the edge `data-from="B"` is stroked
    `#ff0000` and no edge into B is. With `linkStyle 0 stroke:#00ff00`, all 3 hops of A→B are `#00ff00`.
- [ ] Run them and see them fail.
- [ ] Implement as in the spec. Set `LOOK_VERSION` to 11. The README's beautiful-mermaid bullet now says a long link
  is drawn longer, one layer per extra character. Run `npm run build:app` and see the tests pass.
- [ ] Check it visually. Run the full suite, commit, review, then do the merge Adam asked for.
