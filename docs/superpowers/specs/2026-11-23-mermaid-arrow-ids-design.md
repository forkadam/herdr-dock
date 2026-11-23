# Mermaid arrows without spaces — design (short)

Date: 2026-11-23. Follows [the prismantis look](2026-11-23-render-prismantis-look-design.md).

## Intent

beautiful-mermaid 1.1.3 (the latest release) reads a node id as `[\w-]+`, so an arrow written without spaces is
swallowed into the id: `A-->B` draws one node `A--`, `A-.->B` one node `A-`, `A---B` one node `A---B`. Claude often
writes arrows that way. Adam asked for it fixed in the Render panel.

## Goals and non-goals

- `A-->B`, `A-->|x|B`, `A---B`, `A-.->B`, `A-- text -->B`, `A-. text .->B`, `my-node-->other-node`: two nodes and the
  edge. Spaced arrows and `==>` stay as they are.
- Not: circle / cross arrow heads (`--o`, `--x`, `o--o`) and a label with no spaces at all (`A--text-->B`):
  beautiful-mermaid doesn't draw them spaced either.

## Approaches

- **Patch beautiful-mermaid as it is bundled** (picked; prismantis does the same, `scripts/build-vendor.mjs`). Small,
  nothing installed, `node_modules` untouched; a guard fails the build if the library changes.
- Patch `node_modules` after install: edits a dependency in place; an install that skips scripts brings the bug back.
- Rewrite arrows in the source before rendering: re-parsing Mermaid ourselves, and wrong on arrows inside labels
  (`A["a-->b"]`).

## Design

- In beautiful-mermaid's `dist/index.js`, the 13 node-id patterns (`[\w-]+`, from `var NODE_PATTERNS = [` to
  `var CLASS_SHORTHAND_REGEX`) become `(?:\w|-(?![-.>]))+`: a hyphen is part of an id only when it doesn't start an
  arrow. A pure function does the rewrite and throws if the anchors are missing or the count isn't 13, so an upgrade
  that moves them stops the build. Credit prismantis (MIT).
- `scripts/build.mjs` applies it (an esbuild `onLoad`) when bundling the Render helper.
- `LOOK_VERSION` 3 → 4: diagrams cached with the wrong node are drawn again.
- Tests: the rewrite on the real `dist/index.js` (13 replaced, nothing else changed; throws when the anchors move);
  the built helper (`app/mods/dock-render/herdr-render.mjs`, kept equal to a fresh build by `tests/build-app.test.mjs`)
  draws two nodes for each goal case.
- Trade-off: only the bundle is patched. Running `src/app/render-helper.js` directly (the existing helper tests) still
  uses the unpatched library.
- Branch `mermaid-arrow-ids` from `main`, merged back by fast-forward.
