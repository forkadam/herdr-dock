# herdr-dock: design

Date: 2026-11-21 · Status: draft for approval · Working name: herdr-dock

## Intent

herdr-dock is a personal Herdr setup for one developer who works every day on **Windows, macOS and
Omarchy** (Arch Linux + Hyprland). It may be published later (herdr.dev).

Herdr is a desktop app for terminals and coding agents; its window is described by a layout file
(`~/.config/herdr-app/layouts/<name>.json`) whose blocks show **mods** (small JavaScript programs in
`~/.config/herdr-app/mods/<name>/`, written with gpui-kit). The reference for all of this is
`~/.config/herdr-app/AGENTS.md`, `herdr.d.ts` and `gpui-kit.d.ts` (rewritten by Herdr on every start).

Existing community layouts were tried and rejected:

- **Mission Control** (github.com/CiprianSpiridon/herdr-mission-control) is built for macOS/Linux. It
  needed a large patch to run on Windows (python3 missing, POSIX `ps`/`lsof`/`fcntl`/dir-fds,
  `/`-only paths, `os.kill(pid, 0)` killing processes, PowerShell UTF-8 BOMs), and its Context/Quota
  readings are confusing (they show *remaining* percent with no label).
- **cockpit** has the UI and features the user likes most.

Both stay installed as references for ideas and UI. herdr-dock does not depend on either.

**The concept:** a small **core** owns the Herdr layout and treats every feature as a mod placed into
fixed **regions**. The user decides, through config (and later a config UI), which features show and
where. Features come in two kinds:

1. **Own feature mods**, built in this repo against a contract. herdr-dock guarantees these work on all
   three platforms.
2. **Any third-party mod** the user points at a region. The core places it exactly as instructed and
   does not check, restyle or patch it. If it works, good. If not, that is not herdr-dock's concern.

## Goals

- One core that reads a config, merges per-machine overrides, generates the Herdr layout and applies
  it live.
- Fixed regions, each holding an ordered stack of features (see Layout model).
- Own feature mods built on one shared, platform-aware helper layer, so OS differences live in one
  place and a new platform is one more branch there.
- The same layout on all three computers, synced through git, with per-machine tweaks.
- **First version (v1):** usable daily on Windows, replacing cockpit and Mission Control for this user.

## Non-goals (for now)

- A config UI (v1 is configured by editing the config file; the UI comes later on the same core).
- An installer or first-run experience for other people.
- Testing on macOS and Omarchy (the helper layer is designed for them from day one, but v1 is verified
  on Windows only).
- Validating, restyling or fixing third-party mods.
- Automatic config sync (the user commits and pulls like any other change).
- Keeping cockpit or Mission Control features running while the herdr-dock layout is shown: inbox,
  queue drawer, bell, home board, routines, monitor, `show` panes, and the Jira/GitHub/GitLab/sessions
  sources. Losing them while on herdr-dock is accepted (decided by the user). The user can switch back
  with `ctrl-shift-l`. Floating blocks are therefore not part of the region model for now.

## Anti-goals (a failure even if it technically works)

- **Platform lock-in.** Any feature that only works on one OS because of how it was written, not
  because the OS genuinely lacks something.
- **A Python (or other runtime) dependency inside Herdr mods.** It was the root of most of the Mission
  Control Windows trouble. Mods use Herdr's API, `hc`, and per-OS shell commands chosen by the helper
  layer. Node may be used by the *build* (it is installed on all three machines), not at mod run time.
- **Unlabelled or unverifiable numbers.** Quotas show what was actually reported, say what each number
  is (used, not remaining), and say where it came from.
- **A broken generated layout spreading to other machines.** Only the config is synced, never the
  generated layout.

## Layout model

Five fixed regions:

```
┌────────────────── top bar ──────────────────┐
│ LEFT PANEL │                   │ right panel │
│ core       │     terminals     │ (any mods)  │
│ features   │  (active tab's    │             │
│            │   panes)          │             │
├────────────┴──── bottom bar ────┴────────────┤
```

- **Left panel:** the core features, present nearly all the time. Core features ship there and cannot
  be moved to other regions. The user can reorder, resize and collapse them.
  - Three modes: **expanded**, **icons only** (each core feature shows its icon), **hidden**.
  - One control cycles expanded → icons → hidden → expanded, and each mode can be chosen directly.
    The control lives in the **top bar**, and there is also a key binding, because a hidden panel cannot
    hold its own button.
  - In icon mode, clicking a feature's icon expands the panel with that feature given most of the
    height and the other features collapsed to their headers. (Claude's call: the panel is a column of
    separate mod blocks, so it can't scroll across features.)
  - **Where UI changes are saved (Claude's call).** Drag-resizes and collapses are machine-local Herdr
    state and are not written back to the git-synced config. The core only rewrites layout fields whose
    config values changed, so regeneration doesn't wipe them. The panel mode and region visibility live
    in shared state, also machine-local. In v1, reordering is done by editing the config.
- **Right panel and top bar:** any mods, own or third-party.
- **Bottom bar:** intended for messages, info and resources (the default content), but any mod may be
  placed there.
- **Terminals:** the active tab's panes, always present.
- Every region other than the terminals can be hidden. A region hidden at start can be toggled by
  button or key. Bars collapse to a thin strip rather than icons (proposal; confirm during UI design).
- Each region stacks several features in a configured order.

Left panel core features (full set): **Machines, Agent quotas, Spaces, Agents, Git projects,
Settings**. How each looks is decided in a later UI design phase.

## The feature contract (own mods)

Each own feature mod declares (in a manifest file in its source folder; exact format left to the
builder):

- `id`, display name, and an **icon** (required: icon mode needs it).
- Which regions it may be placed in (core features: left panel only).
- Its settings (names, types, defaults), so a future config UI can build a form for it.
- That it supports the modes it is shown in: full, and **icon** mode for left-panel features.

The core passes each placed feature its settings and its current mode through the block's `props`.
Live changes (panel mode switching) go through Herdr shared state, because block props changes restart
the mod. Exact key names are left to the builder.

Third-party mods have no contract. A config entry names the mod folder, the region and optional
`props`, and the core places it as a plain block. In icon mode a third-party mod in the left panel
(placing one there is allowed but unusual) shows a generic icon.

## Config

- **One config file in the herdr-dock repo**, synced through git (the user's existing way of moving
  things between machines). It holds the regions, the features in each (order, size, hidden-at-start),
  and each feature's settings.
- **Per-machine overrides keyed by hostname.** A section per computer changes only what differs there.
  Everything else comes from the shared base. The core merges base + this machine's override.
- When the config UI exists, saving asks "all machines" or "only this machine" and writes the matching
  section.
- The core generates the Herdr layout file locally on each machine from the merged config. The
  generated layout is never committed or synced.
- Editing the config file updates the window live: the core watches it (`watchFolder`) and re-applies.
- How the core finds the config file in the repo checkout (for example, a path written by the deploy
  step) is left to the builder.

## Architecture (approach A, chosen)

### Repo and build

- One git repo (`D:\workspace\herdr-dock` on this machine): source for the core, each feature mod and
  the shared helper layer, plus the config file.
- A Node build step bundles the shared helper layer into every mod, because Herdr mods cannot load
  each other's code at run time. A deploy step copies the built mod folders and the layout into
  `~/.config/herdr-app/`. Mod folder names use a prefix (for example `dock-`) so they never clash
  with shipped or third-party mods.
- Every built mod must pass `herdr-app check <folder>`.

### Core mod

- Reads the config, merges the per-machine override, generates the layout tree with the five regions
  and their stacks, writes `layouts/<name>.json` and applies changes live (`layout.set` /
  `layout.switch`).
- Owns the left-panel mode (expanded, icons, hidden) and region visibility, and publishes them in
  shared state. It renders the top-bar toggle and registers commands the user can bind in `keys.json`.
- Never needs to understand what a feature does inside.
- If the config is invalid, it keeps the last good layout and reports the error visibly (Herdr itself
  keeps the last good layout file and writes a `.error` file; the core does the same for its config).

### Helper layer (shared, bundled into each mod)

- Picks behaviour by the **target machine's** OS. Herdr runs commands on other machines via
  `exec(..., { on: machine })`, so a feature on the Windows laptop may act on the Mac. The local OS is
  `herdr.window().platform`. How a remote machine's OS is detected is left to the builder (for example,
  a cached one-time probe).
- Wraps program execution (PowerShell on Windows, `sh` on macOS/Linux), path handling (Herdr returns
  `C:\...` on Windows; normalize consistently), and process facts.
- Prefers Herdr's own API over shell commands: `spaces()`, `agents()`, `machines()`, `terminals()`,
  `hc get <terminal> --json` (gives the shell PID and the foreground process PID and argv),
  `readTextFile`, `watchFolder`, shared state.

## v1 scope

The first version the user will switch to:

- **Core** with config file, per-machine overrides, layout generation and live apply.
- **Left panel** with three own feature mods: **Spaces, Agents, Agent quotas**. Expanded / icons /
  hidden modes, toggled from the top-bar button and a key.
- **Top bar:** the panel toggle plus tabs. Tabs reuse Herdr's shipped `tabs` mod, placed as a
  third-party mod.
- **Terminals** in the middle. Other regions exist in the model, but nothing is required in them for v1.
- Verified on **Windows**.
- Not in v1: Machines, Git projects, Settings, the config UI, right panel and bottom bar content,
  macOS/Omarchy verification.

### Spaces and Agents in v1

- **Start from Herdr's shipped `spaces` and `agents` mods** (decided by the user). Copy their source
  into the repo (`mod.clone` gives an editable copy) as the starting point for the own Spaces and
  Agents feature mods. This keeps everything the user already relies on: machine groups, worktree
  nesting, drag-to-reorder, rename/close menus, pinning, sub-agents, `setAgentOrder`, New space.
- Then add what the contract needs: icon mode, the shared helper layer, and per-agent context % on
  Agents rows.
- If a more specific view is needed later, these can be swapped out for purpose-built mods.
- Before any publication, check the license terms for redistributing modified Herdr mod code.

### Agent quotas in v1

- Claude only (the agent tool in daily use). Other tools come later.
- **Data source:** the Claude Code status-line snapshot already set up on this machine. The script
  `~/.claude/statusline.ps1` pipes Claude Code's status-line JSON to `~/.claude/herdr-statusline-cache.py`,
  which writes `~/.claude/statusline-cache/claude-statusline.json` containing:
  - `session_contexts[<sessionId>].used_percent` and `.cache.last_activity_unix` (per session)
  - `windows[]`: `{kind: "five_hour" | "weekly", used_percent, remaining_percent, resets_at}` (account)
  - `fetched_at_unix`
- That writer currently runs Python on Windows, through the status-line script. This sits outside Herdr
  and is acceptable for v1. Making it cross-platform without Python (for example, rewriting the writer
  in the status-line script's own language per OS, or in Node) is part of the macOS/Omarchy work and is
  left to the builder to propose.
- **Per-agent context (Claude's call).** The agent-to-session matching and the cache reading live in
  the shared helper layer. Each Agents row shows its session's context **used** %. Quotas shows the
  account-wide windows.
- Display: **used** percentages, labelled as used, with the 5-hour and weekly windows, their reset
  times, and how old the reading is. Stale readings are marked.
- **Matching an agent to its Claude session:** Claude Code writes `~/.claude/sessions/<pid>.json`
  (`pid`, `sessionId`, `startedAt` in ms, `kind: "interactive"`, `pidDomain` such as
  `win32:<hostname>`). Herdr gives each agent terminal's foreground PID (`hc get <t> --json` →
  `foreground.pid`). Read the record for that PID and accept it when `kind` is `interactive` and
  `startedAt` falls within the terminal's lifetime. On Windows the process may be `claude.exe` under
  `C:\...\.local\bin\`, so match names by basename without `.exe`.

## Platform notes learned the hard way (from the Mission Control port)

- Herdr's PATH on Windows has no `python3` (it opens the Microsoft Store), no `sleep`, `mkdir`, `test`,
  `ps` or `lsof`. `bash` may resolve to WSL's bash.
- Windows caps a command line at 32,767 characters. Don't pass large scripts as arguments.
- `herdr.home()` and other paths come back with backslashes on Windows.
- Windows PowerShell 5.1 adds UTF-8 BOMs when piping text to native programs.
- In Python, `os.kill(pid, 0)` on Windows terminates the process. This is a reason to avoid shelling
  out for process checks at all.
- Herdr's shells on Windows are PowerShell. Typed commands must use PowerShell syntax (no `&&` in 5.1,
  and a quoted program path needs `& `).
- The first time Herdr sees a new mod folder, it docks one copy per `mod.json` `place` into the shown
  layout. Use `"place": "none"` for feature mods so installing doesn't edit the user's current layout.

## Approaches considered

- **A. Core mod generates the layout inside Herdr (chosen).** The core reads the config and applies
  the layout live, and it owns the panel modes. The future config UI is the same core with a screen on
  top. It costs a slightly bigger core in v1.
- **B. Command-line generator outside Herdr.** A Node script writes the layout file and Herdr reloads
  it. It is the simplest v1, but you rerun it after every config edit, and the config UI would have to
  call it from inside Herdr or reimplement it. Rejected: rework later.
- **C. One big mod containing every feature.** It gives free code sharing and a consistent style, but
  contradicts the concept of features as separate mods. Rejected.

## Decided by the user

- Approach A.
- Own feature mods with a contract, plus third-party mods placed as instructed and not their concern.
- Fixed regions with stacked features; the left panel holds the core features; the bottom bar is for
  messages, info and resources.
- Left panel modes: icons-only (minimized) and hidden, with a toggle to bring it back or cycle modes.
- Left panel features: Machines, Agent quotas, Spaces, Agents, Git projects, Settings. Their look is
  decided later.
- Personal first, on Windows, macOS and Omarchy; maybe published later.
- Same layout synced across all three computers, with per-machine tweaks.
- v1 = left panel with Spaces, Agents and Quotas working on Windows.
- New repo at `D:\workspace\herdr-dock`.
- Losing cockpit and Mission Control features while on the herdr-dock layout is fine.
- Spaces and Agents start from Herdr's shipped mods, to be swapped for purpose-built ones later if
  needed.

## Proposals made in the conversation (Claude's calls, open to correction)

- The left panel stays configurable (reorder, resize, collapse), but core features can't leave it.
- The toggle lives in the top bar, plus a key.
- Clicking an icon in icon mode expands the panel to that feature.
- Every own left-panel feature must provide an icon.
- Bottom bar is a default, not a rule.
- Config in git with hostname-keyed overrides; only the config is synced, never the generated layout.
- No config UI in v1; Herdr's shipped `tabs` mod in the top bar for v1.
- No Python inside mods.
- Icon click expands the panel with that feature given most of the height.
- Resizes and collapses stay machine-local, and the core rewrites only changed config fields.
- Agent-to-session matching lives in the helper layer: Agents rows show per-session context, and
  Quotas shows the account windows.

## Left to the builder

- Exact config file format and schema, manifest format, shared-state key names, the prefix for mod
  folder names, and the layout name.
- How the core locates the repo's config file.
- Remote machine OS detection.
- Build and deploy tooling details (bundler, scripts).
- Visual design of Quotas, and of the icon mode added to Spaces and Agents, for v1 (functional and
  clean; full UI design comes later).
