# Render: a two-way arrow's start head — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** in `A <--> B` (coloured by `linkStyle` or not), the start arrowhead points at A at the line's end, instead of
pointing at B from inside node A, where it hid.

**Spec:** `docs/superpowers/specs/2026-11-23-mermaid-limits-design.md` (the patch approach; this is one more guarded
rewrite). Adam asked for the fix, the merge and the push.

## Cause

beautiful-mermaid 1.1.3 defines `arrowhead-start` and `arrowhead-start-${suffix}` with an already-flipped polygon
(`${w} 0, 0 ${h / 2}, ${w} ${h}`) and `refX="1"`, then also sets `orient="auto-start-reverse"`, so the head is reversed
twice. Its own sequence-diagram markers do it right: one forward shape with `auto-start-reverse`.

## Global Constraints

- Branch `render-two-way-head` from `main` (bd992c6). Regenerate `app/` before committing. The only expected failure is
  the known `tests/dock-core-class.test.mjs`. Fast-forward `main`, push, and deploy from `~/Dev/Workspace/herdr-dock`.
- Two new `LINE_REWRITES` entries, "start marker shape" and "coloured start marker shape". In each, the start marker's
  `refX="1"` becomes `refX="${refX}"`, and its polygon becomes the end marker's `0 0, ${w} ${h / 2}, 0 ${h}`.
- `LOOK_VERSION` 9 → 10.

### Task 1: the start head

- [ ] **Test** (`tests/render-mermaid-patch.test.mjs`): for `A <--> B`, plain and with `linkStyle 0 stroke:#ff0000`,
  each marker the edge names has these properties:
  - its polygon's apex (the point at mid-height) has the largest x, and lies 0 to 2 units past `refX`;
  - its `orient` is `auto` for the end and `auto-start-reverse` for the start.

  This fails today: the start apex has the smallest x.
- [ ] Implement, rebuild `app/`, and see it pass.
- [ ] Check it visually, then run the full suite, commit, review, merge, push and deploy.
