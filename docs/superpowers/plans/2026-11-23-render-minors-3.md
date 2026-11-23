# Render: the three minors from the 0888ca8 review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** close the three minors (tests and docs only; no product code changes). Adam asked for them and for the merge
and push.

**Spec:** `docs/superpowers/specs/2026-11-23-mermaid-limits-design.md`

## Global Constraints

- Branch `render-minors-3` from `main` (0888ca8). The known failure `tests/dock-core-class.test.mjs` is the only
  expected one.
- Merge with a fast-forward; push `main`; deploy from `~/Dev/Workspace/herdr-dock`.

### Task 1: the three minors

- [ ] In `tests/render-mermaid-patch.test.mjs`, a `linkStyle`-coloured edge keeps a coloured arrowhead:
  `flowchart LR\n  A --> B\n  linkStyle 0 stroke:#ff0000` draws `marker-end="url(#arrowhead-23ff0000)"`. Probed:
  that is today's output.
- [ ] In the same file, the invisible-link test also proves layout. In LR, `A ~~~ B` puts B's rect at the same `y` as
  A's (40 and 40). Two unlinked nodes (`A` and `B` on their own lines) stack (40 and 104.9), so the check can fail.
- [ ] `README.md`: "circle and cross heads (`--o`, `--x`, `o--o`) are drawn; invisible links (`~~~`) are laid out but
  not drawn".
- [ ] Run the render tests and the full suite; commit `test(render): …` / `docs(render): …`.
- [ ] Final review, merge, push, deploy from the main repo.
