# Render follow-ups: long links and the deferred minors — design

Date: 2026-11-23. Follows [the prismantis look](2026-11-23-render-prismantis-look-design.md) and
[Mermaid arrows without spaces](2026-11-23-mermaid-arrow-ids-design.md). Adam asked for the long links and every
deferred minor from the four reviews (not the hyphenated `classDef` names, not where dock-core reads its config).

## Long links

Mermaid lengthens a link with more of its characters: `A---->B`, `A-----B`, `A-..->B`, `A-...-B`, `A====>B`,
`A=====B`, `A<---->B`, `A-- text --->B`, `A-. text ..->B`, `A== text ===>B`. beautiful-mermaid's
`var ARROW_REGEX = /^(<)?(-->|-.->|==>|---|-\.-|===)(?:\|([^|]*)\|)?/;` knows fixed lengths only, so these draw a stray
node (`A---->B` → `A----`) and no edge; its `arrowStyleFromOp` compares exact strings, so a long dotted or thick
operator would come out solid.

- `patchMermaidIds` (bundle time, same guard: each exact line once, else the build fails) also:
  - widens `ARROW_REGEX` to `/^(<)?(-{2,}>|-\.+->|={2,}>|-{3,}|-\.+-|={3,})(?:\|([^|]*)\|)?/`;
  - widens `TEXT_ARROW_REGEX`'s closing operator to `(-{2,}>|-{3,}|\.+->|-\.+-|={2,}>|={3,})`;
  - starts `arrowStyleFromOp(op)` by normalising `op` to its short form (`---->`→`-->`, `-----`→`---`, `-..->`→`-.->`,
    `-...-`→`-.-`, `====>`→`==>`, `=====`→`===`).
- Checked in a scratch bundle: every form above draws two nodes and one edge, in its style (solid, dotted, thick).
- Not: drawing a long link longer (Mermaid adds rank spacing for it); beautiful-mermaid lays it out like a short one.
  State-diagram transitions keep `-->` only.

## The deferred minors

1. **A stick-figure `actor`'s name is painted.** Its group holds a nested `<g>` (the icon); the node walk now finds each
   group's end by counting nested groups, not at the first `</g>`.
2. **One palette colour: series keep beautiful-mermaid's colours.** With fewer than two palette colours, series painting
   is skipped (it would make every series the same).
3. **All-negative bar charts:** the highlighted bar is the one with the largest magnitude, not the least negative.
4. **Figure role colours are readable.** `warn`, `ok`, `note` take `ansi1/2/3` only when the contrast ratio against the
   background is at least 3 (the palette's rule), else `foreground` (`warn` bold).
5. **Noncharacters in a figure:** U+FFFE, U+FFFF and unpaired surrogates (not allowed in XML, they broke the SVG) are a
   finding: "noncharacter, use plain text".
6. **No seams in stacked blocks.** All `█` of one colour in a figure are one `<path>` (a rectangle per row run), so
   adjacent cells, across columns and rows, are filled as one shape.
7. **Wording:** the Diagrams view's empty note says "No diagrams or figures in this session yet."; the mod's header
   comment says diagrams and figures.
8. **`mermaid-patch.js` header** says that, as in Mermaid, an id can't contain `--`, `-.` or `->`.
9. **Missing tests:** `A-. text .->B` in the arrow test, with a check of one result per case; bare `A:::hot` (class
   kept, one node); `A:::my-cls-->B` (two nodes, one edge: the hyphen stays in the class name); `A---my-node:::x`
   (`styledIds` gives `my-node`). These pin behaviour that already works.

## Cache and finishing

`LOOK_VERSION` 6 → 7 (drawing changes for long links, actors, figures). Branch `render-followups` from `main` (8a0edf5);
before merging, rebase if `main` moved, regenerate `app/`, rerun, fast-forward, deploy from the merged state; push if
Adam asks.
