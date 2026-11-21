# Main-aligned top and bottom bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rearrange the generated layout like Herdr's shipped `main`: a full-height left panel, then a
work column with the top bar, the terminals and right panel, and the bottom bar.

**Architecture:** Change only the tree that `buildLayout` produces, the default config, and dock-core's
toggle width. Region ids, block ids, props, panel modes and size restoring stay the same.

**Tech Stack:** as in `2026-11-21-herdr-dock-v1.md`.

**Spec:** `docs/superpowers/specs/2026-11-21-herdr-dock-design.md` (Layout model, revised arrangement).

## Global Constraints

- The ids `dock-top`, `dock-left`, `dock-right`, `dock-bottom`, `dock-main` and the feature block ids
  `dock-<region>-<index>-<mod>` are unchanged, because `panelActions`, `planPanel` and the feature mods
  depend on them.
- Every built mod passes `herdr-app check`. `npm test` stays green.

## Review Focus

1. **Hidden left panel:** the work column fills the window, and the toggle stays reachable in the top bar.
2. **An existing user config with `top.features[0].size: 132`:** it still validates and the bar renders.
   Only the default config changes.
3. **Bottom bar with `workspace-status`:** it shows Herdr's status line, and `herdr-app status` reports
   no errors.

---

### Task 1: Main-aligned layout tree

**Files:**
- Modify: `src/shared/layout.js`, `tests/layout.test.mjs`, `config/dock.json`, `src/shared/config.js`
  (`DEFAULT_CONFIG`, if it mirrors the file), `src/mods/dock-core/main.js` (toggle render),
  `README.md` (layout picture and the default bottom bar)

**Interfaces:**
- Produces: `buildLayout(merged)` returns this tree (empty regions are still omitted; hidden flags as
  before):

```
root row     { titlebar:"none", background:"canvas", terminal_padding:[14,12], divider:{width:1,color:"border"} }
  dock-left  column { size:{px:left.size}, min:44, max:480, background:"chrome", hidden?, children: left blocks (min 32) }
  dock-work  column { resizable:false }
    dock-top    row { size:{px:top.size}, window_drag:true, hidden? }        top blocks
    dock-body   row { padding:8, gap:8 }
      dock-main   block { content:{ tab:"active", pane: MAIN_PANE } }        (no padding of its own)
      dock-right  column { size:{px:right.size}, hidden? }                   right blocks
    dock-bottom row { size:{px:bottom.size}, hidden? }                       bottom blocks
```

- Default `config/dock.json`: `top` = `{ size: 42, features: [ { mod: "dock-core", size: 44 }, { mod: "tabs" } ] }`;
  `bottom` = `{ size: 28, features: [ { mod: "workspace-status" } ] }` with no `hidden`. `left` and
  `right` are unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/layout.test.mjs`:
  - the root is a `row`, its first child is `dock-left`, and its second is `dock-work` (a column);
  - the `dock-work` children are `[dock-top, dock-body, dock-bottom]` in that order;
  - the `dock-body` children are `[dock-main, dock-right]` (when right has features) and it has `padding: 8, gap: 8`;
  - `dock-main` has no `padding`;
  - the default config's bottom shows `workspace-status`, and the first top feature is `{px: 44}`;
  - the left hidden mode still sets `hidden` on `dock-left`.

  Update existing tests that assumed the old nesting.
- [ ] **Step 2: Run to verify they fail.** `npm test` → the new assertions FAIL.
- [ ] **Step 3: Implement** the tree in `layout.js`, then update the config and `DEFAULT_CONFIG`.
  Change the dock-core toggle render so it fits 44 px: the toggle is centered, and the config-error dot
  sits on the toggle's top-right corner instead of beside it.
- [ ] **Step 4: Verify:**
  - `npm test` → PASS.
  - `npm run deploy` → all checks passed.
  - Take a shot on herdr-dock. The tabs start at the terminal's left edge, and the status bar sits under
    the terminals.
  - Run `herdr-app do dock-core.hidden`. The work column fills the window and the toggle is visible.
    Then run `dock-core.expanded`.
  - `herdr-app status` reports no errors.
- [ ] **Step 5: Commit**: `feat: arrange bars like Herdr's main layout`
