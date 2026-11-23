# Render: the last two minors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** close the two minors from the review of 96a8c14. (1) The guard test for the arrow pattern is specific, not also
matching "text arrow pattern changed". (2) A long closing operator in a text arrow takes its style like the short one
(`A-- text ..->B` is dotted, as `A-- text .->B` is).

**Spec:** `docs/superpowers/specs/2026-11-23-render-followups-design.md` (the long-links section; this extends its rule
to the text arrow's style lookup). Adam asked for both and for the merge back to `main` (no push).

## Global Constraints

- Branch `render-minors-2` from `main` (96a8c14). `app/` regenerated before committing. The known failure
  `tests/dock-core-class.test.mjs` is the only expected one.
- New `LINE_REWRITES` entry, `name` "text arrow style": `function textArrowStyleFromOps(openOp, closeOp) {` becomes
  itself followed by the line
  `  closeOp = closeOp.replace(/^\.+->$/, ".->").replace(/^-\.+-$/, "-.-").replace(/^-{2,}>$/, "-->").replace(/^-{3,}$/, "---").replace(/^={2,}>$/, "==>").replace(/^={3,}$/, "===");`
- `LOOK_VERSION` 7 → 8.
- Deploy only from `~/Dev/Workspace/herdr-dock` after the merge, so dock-core keeps reading its config from there.

### Task 1: the two minors

- [ ] Tests (`tests/render-mermaid-patch.test.mjs`):
  - `/arrow pattern changed/` becomes `/beautiful-mermaid's arrow pattern changed$/`.
  - `LINE_REWRITES.length` is 5.
  - Append a built-helper test: `A-- text ..->B` and `A-- text .->B` are dotted, and `A-- text --->B` is solid.
- [ ] Run them and see the new ones fail.
- [ ] Implement the rewrite entry and the look version; `npm run build:app`; see them pass.
- [ ] Full suite; commit `fix(render): …`.
- [ ] Final review, then merge: rebase if `main` moved, rerun, fast-forward, deploy from the main repo.
