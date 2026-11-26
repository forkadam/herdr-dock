# Spaces lists its agents, by the name other sessions message them by

Date: 2026-11-26 · Size: small change · Status: approved 2026-11-26

## Why

Adam asks one agent to hand work to another, and the agent answers with a session name: "I sent the
handover to the amp-refine-ui-85 session". That name, Claude Code's peer name, appears nowhere in
Herdr, so Adam can't see which agent it is or pick one by name. Neither dock panel organizes agents
the way he thinks about them:
- **Spaces** lists folders but nothing about who works in them ("it really does nothing").
- **Agents** shows two rows both reading "herdr-dock" when the main checkout and a worktree each have
  an agent.

## Goals

1. **Agents under their space.** Spaces shows each space's agents as children: directly under the
   space, before its worktrees. An agent in a worktree space sits under that worktree.
2. **The name to pass around.** Each local Claude Code agent's row shows its peer name (the one
   `SendMessage` / `ListAgents` use, e.g. `amp-refine-ui-85`). Adam can copy it in one click.
3. **No more twin rows.** In the Agents panel, two rows from different spaces with the same space
   name no longer read the same: each adds its branch.

## Non-goals

- Spaces does not take over the Agents panel's work. Pins, sub-agents, context %, the priority
  order and the sort menu stay in Agents. Adam chose two panels: the urgency order is the one thing
  a tree by folder can't give.
- No terminal address (`t16`) and no Claude session UUID on the rows. Adam is after the peer name.
- No agent rows in the narrow icon rail, or when Spaces is collapsed to its header.
- No new messaging. The panel shows and copies the name; sending stays with the agents.

## Anti-goals

- Spaces must not get slower to draw, or call git more often. Agent rows use the agent list Herdr
  already gives every mod; only the name lookup is new.
- Never show the wrong name on a row. A name is shown only when its session record is proven to
  belong to the process now running in that terminal. A name that isn't proven is left out.

## Where the name comes from

Claude Code writes a record per running session at `~/.claude/sessions/<pid>.json`. It holds `pid`,
`sessionId`, `kind`, `startedAt`, `name` (e.g. `"amp-refine-ui-85"`, `nameSource: "derived"`: the
folder name plus two characters) and `status`.

The Agents panel already reads this record for "NN% used":
- `hc get <address> --json` gives the terminal's foreground pid and `created_ms`;
- `matchSession` (`src/shared/claude.js:17`) proves the record belongs to that process.

The name is read the same way.

Known limits:
- **Shared names.** Two sessions can share a name: today there are two `account-center-mf-ff`.
  Messaging tells them apart by a short code (`[de8388]`) that Claude Code doesn't write to the
  record, so the panel can't show it. Both rows get a dim "same name" mark.
- **No name to show.** There's no name for an agent that isn't Claude Code (Codex, pi), for one on
  another machine (address `vps/t7`), or for a Claude Code too old to write `name`.

## Approaches

| | Approach | Trade-off | |
|-|-|-|-|
| 1 | **Each panel looks names up itself**, through shared code in `src/shared/claude.js` | Works whichever panels a machine's dock has (Mac and Omarchy docks differ). About 10 extra `hc get` calls every 15 s | **Chosen** |
| 2 | Agents publishes names through `setShared`; Spaces reads them | No extra lookups. But Spaces shows no names on a dock without Agents, and every change re-renders every mod and rewrites `shared.json` | Not chosen |
| 3 | Match records to agents by folder, without `hc get` | Cheapest. But it picks the wrong name whenever two sessions share a folder (account-center-mf has five today) | Ruled out: breaks the "never wrong" anti-goal |

## Decisions

**Spaces (`src/mods/dock-spaces/main.js`)**
- **Which agents.** Agent rows come from `agents()`, matched to a space by `a.space`, in the order
  `agents()` gives them (space, tab, pane).
- **Indentation.** A space's own agents are indented like a worktree row. A worktree's agents are
  indented one step further.
- **Row look.** A row mirrors an Agents row, shorter:
  - the agent's program icon (Agents' `icon()` rule) on the left;
  - the label;
  - on hover, a `Copy` pill on the right, the same look as the machine-login `Copy` in this file.
    It shows `Copied` after a click.
  - the status mark at the far right (spinner while working, colored dot for needs-you or done,
    dim when idle), as Agents draws it.
- **Label.** The peer name when one is proven. Otherwise the pane's name, else the agent's cleaned
  title, else the tab name, else the program name. Only a peer name gets the `Copy` pill.
- **Clicks.** Clicking a row goes to that agent (`showTerminal()`, then `pane.focus {pane}`), as in
  Agents. An agent row has no right-click menu and doesn't take part in dragging spaces.
- **Scrolling.** The active space's scroll position (`activeAt`) counts the agent rows.
- **Name lookups.** These run only while Spaces is drawn in full: not in the rail, not collapsed,
  not under `checking()`. They run every 15 s, and within a second when the set of local Claude
  agents changes (the same trigger Agents uses). An entry is dropped when its agent goes, or when
  hc reports another pid or `created_ms` for that terminal (`keepEntry`).

**Shared (`src/shared/claude.js`)**
- **Peer name.** A pure function gives the peer name from an `hc get` result and the record's text.
  It returns null unless `matchSession` accepts the record and `name` is a non-empty string.
- **Moved here.** `isLocalClaude` and `sigOf` move here from dock-agents, so both panels use the
  same rules for which agents are local Claude and when an entry stops matching.

**Agents (`src/mods/dock-agents/main.js`)**
- **When a branch is added.** It's added when two or more listed agents come from *different*
  spaces with the same space name.
- **What changes.** The space part of each such row becomes `herdr-dock · changes-minors`. The
  branch comes from that agent's pane (`panes()[].branch`), so there are no git calls. `main` and
  `master` are left off, as in Spaces.
- **Group headers.** The grouped view's space headers get the same treatment.

## Tests

- **Peer name:** the name from a matching record; null for another pid, a non-interactive record, a
  missing or blank `name`, a record started before the terminal, and unparsable text.
- **Spaces placement:** Spaces' row building puts each agent under the right space or worktree, in
  order, with nothing for a space that has none. It must be a pure function, so it can be tested
  without the UI.
- **Same name:** the "same name" mark appears only when two listed agents share a peer name.
- **Agents labels:** the branch is added only for same-named *different* spaces; `main`/`master` are
  left off; one space with two agents is unchanged.
- **Agents panel unchanged:** its existing tests still pass after the helpers move.

## Left to the builder

- **Exact layout values:** pixel sizes and indents, the row height (between 24 and 28), and the
  tooltip text.
- **Where helpers live:** how the pure placement function and the label rule are split into
  testable helpers.

## Sketch

```
 Spaces
 [H] herdr-dock
   ├─ ✳ herdr-dock-e9                         ○
   └─ ⎇ herdr-dock          changes-minors
        └─ ✳ git-project-not-show-mac-7a  Copy ◌
 [A] amp-refine-ui
   └─ ✳ amp-refine-ui-85                      ●
 [C] account-center-mf
   ├─ ✳ account-center-mf-ff  same name       ○
   └─ ✳ account-center-mf-ff  same name       ○
```
