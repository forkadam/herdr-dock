# Render: the two test pins from the b5fdf51 review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** pin both ends of a `linkStyle`-coloured edge's arrowheads, and check the coloured `<marker>` definitions, not
only the references (tests only). Adam asked for both and for the merge and push.

**Spec:** `docs/superpowers/specs/2026-11-23-mermaid-limits-design.md`

## Global Constraints

- Branch `render-pins` from `main` (b5fdf51). The known failure `tests/dock-core-class.test.mjs` is the only expected
  one. Merge with a fast-forward, push `main`, and deploy from `~/Dev/Workspace/herdr-dock`.

### Task 1: the two pins

- [ ] Add a test to `tests/render-mermaid-patch.test.mjs`:
  - `A --> B` with `linkStyle 0 stroke:#ff0000`: the edge's `marker-end` names a `<marker>` whose shape is filled
    `#ff0000`, and there is no `marker-start`.
  - `A <--> B` with the same `linkStyle`: both `marker-start` and `marker-end` name `<marker>`s filled `#ff0000`, and
    they are different markers.
  - The marker ids are read from the edge, not written into the test. Probed: today's output.
- [ ] Run the render tests and the full suite. Commit, review, merge, push, deploy.
