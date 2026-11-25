# Render panel: the conversation, with copy buttons — design

## Why

Adam reads long Claude Code sessions, and plain Claude Code gets hard to follow once the context grows: their prompts,
Claude's replies and the background events that arrive as turns (40 of the 81 user-side turns in one recent session
were task notifications) all look alike. He runs [prismantis](https://github.com/NahumLitvin/prismantis) (MIT) for
its styled replies and its copy buttons, which they use to paste into Slack, Teams, Jira, Confluence, email and
Obsidian. Prismantis draws inside Claude Code, on the thread that also handles keystrokes, and with it on the terminal
has frozen in fullscreen (the cause isn't proven).

The Render panel (dock-render) runs in the Herdr app, outside Claude Code. The aim is for it to take over what
prismantis gives so prismantis can be removed. This design is the first of three projects:

1. **This one**: the panel shows the whole conversation, speakers told apart by colour, replies drawn as blocks with
   prismantis's copy buttons.
2. A diagram-hints hook, so Claude keeps writing figures, charts and tables once prismantis's hint is gone.
3. The rest of the reply styling (code highlighting, line numbers, folding long code, coloured numbers and paths,
   footnotes, side-by-side layout).

Prismantis stays installed until 2 and 3 are done.

## Goals

1. A **Conversation** tab replaces the Answer tab: every exchange of the session, newest at the top, each one the turn
   that started it followed by Claude's reply.
2. Who is speaking is clear at a glance: **coloured rails** (you blue, Claude magenta, events amber).
3. Replies are drawn as blocks with copy buttons, so each table, code block, list, quote, alert and diagram copies in
   the format that fits where it's pasted.
4. Formatted (HTML) copies paste with their formatting into Jira, Confluence and email.
5. The Files tab draws Markdown files with the same blocks and buttons.
6. It stays light: nothing runs while the panel is hidden, and the helper's run after a settled reply stays around a
   few tenths of a second on a 16 MB transcript.

## Non-goals

- The terminal's own look. Tool rows, diff cards, prompt bubbles, the turn footer and themes restyle the terminal; once
  prismantis is removed the terminal is plain Claude Code. The panel shows no tool rows either.
- Project 2 (diagram hints) and project 3 (the styling listed above).
- LaTeX and right-to-left text (Adam has LaTeX off and writes no Hebrew or Arabic).
- Hover-only buttons (prismantis's `copyButtonStyle: hover`; Adam uses `inline`), and keyboard copy commands like
  `/prismantis copy`.
- Formatted copies on Windows and Linux: there the html buttons are hidden; every plain copy still works.

## Anti-goals

- Anything that runs inside Claude Code or can slow the terminal.
- A copy that silently gives the wrong thing: when the formatted copy fails, the panel says so and copies plain text.
- A long session that makes the panel heavy: older exchanges are folded and draw one row.

## Today

- `src/mods/dock-render/main.js` draws three views: Answer (the latest reply), Diagrams (every diagram and figure of
  the session, newest first) and Files (Markdown files under the agent's folder). Markdown is drawn by gpui-kit's
  `TextView.markdown`; ```` ```mermaid ```` and ```` ```figure ```` blocks are drawn as SVG pictures.
- The helper `herdr-render.mjs` (`src/app/render-helper.js`, bundled with beautiful-mermaid by `scripts/build.mjs`)
  is started with `exec("node", [script, <JSON request>])` once a log has been still for 600 ms (`SETTLE_MS`). Modes:
  `claude`, `codex`, `file`, `files`, `clear`. It reads a session log up to its last 64 MB (`MAX_LOG`) and a Markdown
  file up to 2 MB (`MAX_FILE`). `exec`'s output is capped at 8 MiB.
- `src/shared/render/transcript.js` folds a log: a real user message starts a turn; assistant text since then is the
  answer. Tool results, meta lines and side chains don't start a turn. `src/shared/render/markdown.js`
  (`splitSegments`) splits text into Markdown and pictures; an unclosed fence stays text.
- A mod can write plain text to the clipboard (`cx.write_to_clipboard`) but not HTML, and `exec` has no stdin.
- Render runs on Windows, macOS and Linux (the README; v1 was verified on Windows). Adam uses it on macOS.
- How Claude Code records turns (checked in a real session): a typed prompt is a `user` line with `origin.kind` `"human"`;
  a background event delivered while Claude is idle is a `user` line with another `origin.kind` (all 41 task
  notifications in that session arrived idle). Anything sent **while Claude is working** (a prompt typed mid-turn, a
  task notification from another plugin) is instead an `attachment` line of type `queued_command`, with `prompt`,
  `origin` and `commandMode`; today's fold ignores these.
- Measured on this session's 16.7 MB transcript: the helper runs in 0.11 s warm (0.15 s drawing 4 new diagrams), peak
  ~150 MB for that moment, then exits; reading the whole file takes ~35 ms and `readClaude` over it ~26 ms.

## Approaches

**How replies become blocks** (Adam picked A):

- **A. The helper parses with `marked`**, bundled at build time like beautiful-mermaid, and works out every block's
  copies when it reads. A real GFM parser gets the whole-reply HTML right (nested lists, code in tables, links inside
  bold). Cost: one build dependency of ~40 KB.
- B. Port prismantis's parser (~460 lines of TypeScript). Copies would match prismantis exactly, but it's built for the
  terminal, says it isn't full CommonMark, makes HTML only for tables, and would be kept in step by hand.
- C. Grow `splitSegments` and write HTML by hand. No dependency, but hand-written Markdown→HTML is where the bugs are.

**How speakers look** (shown as mockups; Adam picked A): A coloured rails; B chat bubbles (prompts right-aligned);
C a tinted header band on every turn.

**What the panel shows** (Adam picked the middle): latest reply only (today); **every reply under its prompt**; the
full conversation with tool rows and diffs (several times the work, rebuilds Claude Code's transcript).

## Design

### 1. Reading the conversation

The fold in `transcript.js` returns exchanges instead of the latest answer. The Diagrams list is unchanged.

- An exchange: `{ id, by: "you" | "event", kind, text, at, reply: { text, at } | null }`. `id` is the uuid of the
  line that started it (Codex: its line number), stable across reads so a folded or opened exchange stays that way.
  Newest first.
- **Who started it** (Claude Code). The user line's `origin.kind` decides: `"human"` is you; any other kind
  (`"task-notification"`, and whatever Claude Code uses for loop wake-ups or messages from other sessions) is an event,
  labelled by that kind (`task-notification` → "Background task"; unknown kinds → the kind in words). Lines without
  `origin` (older logs) fall back on their text: `<task-notification>` → event; `<command-name>` → you, shown as the
  command (`/clear`); a compaction summary (`isCompactSummary`) → event "Context compacted". Meta lines, system
  reminders, local-command caveats and outputs, tool results and side chains start nothing and are not shown (today's
  rule, plus the compaction summary becoming an event).
- **Sent while Claude works.** A `queued_command` attachment doesn't start an exchange: it shows inside the running
  exchange, at that point in Claude's reply, as a one-line marker in its speaker's colour (`YOU, while Claude worked:
  …` with your text in full; an event as its one-line summary). Claude's reply continues under it.
- **An event's text** is one line: a task notification's `<summary>`, otherwise its first line with tags removed, at
  most 140 characters.
- **Claude's reply** is all assistant text since the turn started, joined by blank lines (today's rule), with the
  markers above in place. An exchange without reply text shows "working…" only while it is the newest and Claude is
  still going (its last assistant line didn't end the turn, or a tool call has no result yet); otherwise a dim "no reply
  text" (Claude answered with tools only, or was interrupted).
- **Codex**: user messages are you; its own injected context stays hidden (today's rule); there are no events.
- **How much**: the whole session (logs are already read up to 64 MB). The newest 200 exchanges are returned.
- **Blocks only for open exchanges.** Every read returns all exchanges as light rows (turn text, the reply's first
  words, ids); blocks and their copies come only for the exchanges the panel has open (the request lists their ids). So
  the output stays far under `exec`'s 8 MiB cap. Opening a folded exchange runs the helper for it (about 0.1–0.2 s,
  plus any of its diagrams not drawn yet); the row shows "opening…" meanwhile.

### 2. Blocks

A new `src/shared/render/blocks.js` (pure, Node-tested) turns a Markdown text into blocks with `marked`'s GFM lexer.
Each block carries the Markdown it is drawn from and its copies, all worked out when the helper reads:

| Block | Made from | Drawn as | Buttons → what's copied |
|---|---|---|---|
| text | paragraphs, headings, rules, HTML (consecutive ones merged) | `TextView.markdown` | none (select to copy, as today) |
| table | a GFM table | `TextView.markdown` | **md** the table as written · **art** a boxed text table · **html** a formatted table plus tab-separated text |
| code | a fenced or indented code block (not mermaid/figure) | a header row (language, **copy**) over the code | **copy** the code without its fences |
| list | a list (code blocks inside it stay in it) | `TextView.markdown` | **copy** the list as Markdown |
| quote | a blockquote that isn't an alert | `TextView.markdown` | **copy** the text without `> ` markers |
| alert | a blockquote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` | a box with a bar in the alert's colour and its title | **copy** the body without markers or the tag |
| mermaid, figure | as today (`splitSegments` rules) | picture | **copy source** the block as written |

Per reply: **copy md** (the reply exactly as written) and **copy html** (the reply as HTML, with the Markdown as its
plain-text side).

- **art** follows prismantis's `tableArt` (MIT, credited): `┌─┬─┐` frame, a `├─┼─┤` rule between every row, headers
  centred, body cells aligned as the table says, inline markup removed, columns sized to fit 100 columns with cells
  wrapped, the whole wrapped in ```` ``` ```` fences so Slack shows it monospaced. Width counts wide characters (CJK)
  as two columns.
- **html** for a table follows prismantis's `tableHtml`/`tableText`: headers, alignment and inline formatting (bold,
  italic, code, links); the plain side is tab-separated, cells with tabs, newlines or quotes quoted.
- In HTML copies, a Mermaid diagram or figure goes in as its source in a `<pre><code>` block (pictures don't paste
  reliably into Jira or Confluence). *Builder's call made here.*
- An unclosed fence while a reply streams: a picture stays text until it closes (today's rule); other code may show as
  code to the end of the reply.

### 3. Copying

- Plain copies use `cx.write_to_clipboard`.
- Formatted copies (macOS only; the html buttons are hidden elsewhere) go through the helper: a new mode `clip` takes `{ html, text }` and runs
  `/usr/bin/osascript -l JavaScript` with the pasteboard script ported from prismantis's `clipboard.ts` (MIT,
  credited), which writes HTML and plain text as one pasteboard item and reads both back to check. The payload goes on
  osascript's stdin; 5 s timeout. The request reaches the helper as its argv argument like every other request (the
  mod's `exec` has no stdin); a payload over 512 KB copies as plain text with a note instead.
- If it fails, the plain text is copied with `cx.write_to_clipboard` and the button says why ("copied as plain text:
  <reason>").
- A clicked button reads "copied" in the theme's green for 1.5 s.

### 4. Drawing

- Tabs: **Conversation** · Diagrams · Files. The `answer` command stays as another name for `conversation`, so
  existing keys.json bindings keep working.
- An exchange is its starting turn, then Claude's reply, each with a 3 px rail on the left in the speaker's colour and
  a small label: `YOU · 5m ago`, `BACKGROUND TASK · 2m ago`, `CLAUDE`. Your turns and events get a faint tint of their
  colour (~8 %); Claude's reply sits on the plain background. A dashed rule separates exchanges. A reply not started
  yet shows a dim "working…" under the turn.
- Colours from the Herdr theme: you `ansi4`, Claude `ansi5`, events `ansi3`; alerts NOTE `ansi4`, TIP `ansi2`,
  IMPORTANT `ansi5`, WARNING `ansi3`, CAUTION `ansi1`.
- **Folding**: the newest 3 exchanges are open; older ones are one row (rail, label, the turn's text and the reply's
  first words, truncated). Clicking a row opens or folds it. The state lives in the panel, keyed by exchange id, and
  resets when the focused agent changes.
- Your turn's text is drawn as Markdown and selectable; one longer than 12 lines shows its first 12 and "show all".
- Buttons sit inline: a table's above it on the right; code's in its header row; a list's, quote's or alert's at its
  top right; a diagram's next to it; the reply's at its end.
- Only open exchanges draw blocks, which keeps a long session light.
- **Selecting.** Each block is its own text view, so a mouse selection stays inside one block (a stretch of text, a
  list, a table); it can't run from one block into the next as it can across today's single reply. The whole reply
  copies with **copy md** or **copy html**. (Herdr can't place buttons inside one text view, so buttons on each block
  and one selection across the reply exclude each other; buttons on each block, prismantis's way, was picked.)

### 5. Files tab

A file is drawn with the same blocks and block buttons, and gets **copy md** / **copy html** for the whole file at the
top.

### 6. Credits and docs

`marked` (MIT) is bundled by the build. The table art, table HTML and pasteboard script are ported from prismantis
(MIT) and credited in the README the way figures are. The README's Render section describes the Conversation tab and
the buttons.

## Left to the builder

- The `marked` version: pinned exactly, at least two weeks old; bundled through the existing esbuild step.
- The JSON shapes between helper and panel, the file split, and how folded exchanges get their first words.
- Test fixtures with `origin` fields and `queued_command` attachments, modelled on a real session (the current ones
  under `tests/fixtures/render/` have neither).
- Tests: Node tests for blocks (each kind and its copies, all five alerts, quote markers, code inside a list, pictures,
  unclosed fences), the art table (alignment, wrapping, wide characters, markup removed), table HTML and TSV quoting,
  reply HTML, the conversation fold (origin kinds, the text fallbacks, hidden lines, compaction, mid-turn
  `queued_command` markers, "working…" against "no reply text", Codex), and the `clip` mode's osascript call and its plain-text fallback without touching the real clipboard.
- A timing check that the helper stays around a few tenths of a second on a 16 MB transcript.
- By hand, in Herdr: html into Confluence, Jira and an email; art into Slack; md into Teams and Obsidian.
