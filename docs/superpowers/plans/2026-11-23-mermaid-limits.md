# beautiful-mermaid's limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** hyphenated class names, the two missing text-arrow closings, invisible links and circle / cross heads work in
the Render panel.

**Spec:** `docs/superpowers/specs/2026-11-23-mermaid-limits-design.md`

## Global Constraints

- Branch `mermaid-limits` from `main` (6353b8a). Regenerate `app/` before committing. Only the known failure,
  `tests/dock-core-class.test.mjs`, is expected. Write files with `\u`, `$` or many backslashes through a script.
- Every rewrite is an entry of `LINE_REWRITES` in `src/shared/render/mermaid-patch.js`: `from` occurs once, or the
  build fails.
- Deploy only from `~/Dev/Workspace/herdr-dock` after the merge. Ask Adam about merging and pushing.
- Each rewrite below is given as the line beautiful-mermaid ships, then the line it becomes.

## Review Focus

1. **Short arrows, long links, ids, classes and text arrows from the earlier branches** read as before. Covered by
   the existing tests, which must stay green.
2. **`A --- other` (spaced)** stays an open link to `other`, and `A-->o1` stays an arrow to `o1`. Test in Task 2.
3. **`linkStyle`-coloured edges** keep their coloured arrowheads. Circle and cross markers are not coloured. Checked by
   the marker test in Task 2.
4. **An invisible link** affects layout (both nodes drawn) but draws no line and no label. Test in Task 2.
5. **The guard:** each new rewrite's `from` exists exactly once. Covered by the count test.

### Task 1: class names and text-arrow closings

**Files:** `src/shared/render/mermaid-patch.js`, `tests/render-mermaid-patch.test.mjs`, `app/`

**Rewrites:**

- New entry, "classDef name":
  - `line.match(/^classDef\s+(\w+)\s+(.+)$/);`
  - `line.match(/^classDef\s+([\w-]+)\s+(.+)$/);`
- New entry, "class assignment":
  - `line.match(/^class\s+([\w,-]+)\s+(\w+)$/);`
  - `line.match(/^class\s+([\w,-]+)\s+([\w-]+)$/);`
- `TEXT_ARROW_WIDE`'s closing group becomes `(-{2,}>|-{3,}|\.+->|-\.+->|-\.+-|\.+-|={2,}>|={3,})`.
- `TEXT_ARROW_STYLE_NORMALISE` gains `.replace(/^-\.+->$/, ".->").replace(/^\.+-$/, "-.-")` at the end of its chain.

**Steps:**

- [ ] **Tests:** `LINE_REWRITES.length` is 7. Append a built-helper test with these cases:
  - `flowchart LR\n  A-->B\n  classDef my-cls fill:#ff0000\n  class B my-cls`: B's shape is filled `#ff0000`, and no
    node has id `classDef`;
  - `A:::my-cls-->B` with the same `classDef`: A is filled `#ff0000`;
  - `A-. text -.->B`: 2 nodes, the edge dotted, `data-arrow-end="true"`;
  - `A-. text .-B`: 2 nodes, the edge dotted, `data-arrow-end="false"`.
- [ ] Run them and see them fail.
- [ ] Implement, `npm run build:app`, see them pass.
- [ ] Commit `fix(render): hyphenated classDef names apply; dotted text links -. text -.-> and -. text .- parse`.

### Task 2: invisible links and circle / cross heads

**Files:** `src/shared/render/mermaid-patch.js`, `src/shared/render/cache.js` (`LOOK_VERSION = 9`), `README.md`,
`tests/render-mermaid-patch.test.mjs`, `app/`

**Rewrites:**

- `ARROW_WIDE` becomes
  `var ARROW_REGEX = /^([<ox])?(-{2,}>|-\.+->|={2,}>|-{2,}[ox]|-\.+-[ox]|={2,}[ox]|-{3,}|-\.+-|={3,}|~{3,})(?:\|([^|]*)\|)?/;`.
- `ARROW_STYLE_NORMALISE` is prefixed with
  `\n  if (/^~{3,}$/.test(op)) return "invisible";\n  op = op.replace(/[ox]$/, ">");`.
- New entry, "arrow start kind":
  - `hasArrowStart = Boolean(arrowMatch[1]);`
  - `hasArrowStart = arrowMatch[1] === "o" ? "circle" : arrowMatch[1] === "x" ? "cross" : Boolean(arrowMatch[1]);`
- New entry, "arrow end kind":
  - `hasArrowEnd = arrowOp.endsWith(">");`
  - `hasArrowEnd = arrowOp.endsWith(">") ? true : arrowOp.endsWith("o") ? "circle" : arrowOp.endsWith("x") ? "cross" : false;`
- New entry, "invisible edge": `function renderEdge(edge) {\n  if (edge.points.length < 2) return "";` becomes the same
  with the condition `edge.points.length < 2 || edge.style === "invisible"`.
- New entry, "end marker":
  - ``if (edge.hasArrowEnd) markers += ` marker-end="url(#arrowhead${suffix})"`;``
  - ``if (edge.hasArrowEnd) markers += edge.hasArrowEnd === true ? ` marker-end="url(#arrowhead${suffix})"` : ` marker-end="url(#${edge.hasArrowEnd}head)"`;``
- New entry, "start marker": the same for `hasArrowStart`, with `arrowhead-start${suffix}` and `${kind}head-start`.
- New entry, "head markers": `  parts.push(arrowMarkerDefs());` is followed by a second `parts.push` of four markers,
  all coloured `var(--_arrow)`:
  - `circlehead`: 8×8, `refX` 7, a circle of r 3;
  - `circlehead-start`: the same with `refX` 1;
  - `crosshead`: 8×8, `refX` 6, the path `M1 1 L7 7 M7 1 L1 7` with stroke-width 1.5;
  - `crosshead-start`: the same with `refX` 2.
- New entry, "invisible label":
  - `if (edge.label) {\n      parts.push(renderEdgeLabel(edge, font));`
  - the same with `if (edge.label && edge.style !== "invisible") {`.

**Steps:**

- [ ] **Tests:** `LINE_REWRITES.length` is 14. Append a built-helper test. Each case gives 2 nodes (3 for the chain),
  and the edge's `[data-style, marker-start target, marker-end target]`:
  - `A --o B` → `[solid, -, circlehead]`
  - `A --x B` → `[solid, -, crosshead]`
  - `A o--o B` → `[solid, circlehead-start, circlehead]`
  - `A x--x B` → `[solid, crosshead-start, crosshead]`
  - `A ==o B` → `[thick, -, circlehead]`
  - `A -.-o B` → `[dotted, -, circlehead]`
  - `A-->o1` → `[solid, -, arrowhead]`, with node `o1`
  - `A --- other` → `[solid, -, -]`, with node `other`
  - `A --> B --o C` → two edges, `arrowhead` then `circlehead`

  Also:
  - `A ~~~ B` and `A~~~B`: 2 nodes, no `<polyline class="edge"`;
  - `A ~~~|x| B`: no `class="edge-label"`;
  - the SVG holds `<marker id="circlehead"` and `<marker id="crosshead"`.
- [ ] Run them and see them fail.
- [ ] Implement. Bump `LOOK_VERSION` to 9. The README's beautiful-mermaid bullet lists what is patched: unspaced and
  long arrows, circle / cross heads, invisible links, hyphenated class names. Run `npm run build:app` and see the tests
  pass.
- [ ] Full suite. Commit `fix(render): invisible links (~~~) and circle / cross heads (--o, --x, o--o) draw`.
- [ ] Final review, then the merge question.
