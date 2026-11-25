# Render panel: colour everything, like prismantis — design

## Why

The Conversation tab draws replies with Herdr's built-in Markdown view (`TextView.markdown`), which can't be coloured
per element ("CSS in HTML is not supported"), so headings, tables, lists and prose are all one colour and blend into
each other. Prismantis, which Adam is replacing, colours them: table headers, rules, numbers, paths, bold, inline code,
links, bullets, headings, and code by syntax. Adam wants that look in the panel, all of it: "either we have colour or
not". They accept what it costs: text drawn this way can't be mouse-selected; copy buttons (md and the rest) and the
plain text in the terminal cover copying.

This is project 3 of replacing prismantis (after the Conversation tab and the diagram hints). Line numbers, folding
long code, footnotes and side-by-side tables and diagrams come after it.

## Goals

1. Every reply block in the Conversation and Files tabs is drawn by the panel itself, in the Herdr theme's colours:
   headings, paragraphs, lists, quotes, alerts, tables and code.
2. Inside prose (paragraphs, list items, table cells, quotes, alerts, headings) bold, italic, strikethrough, inline
   code, links, numbers and paths each get their colour, as prismantis colours them.
3. Code blocks are coloured by syntax (Prism), for the languages prismantis colours.
4. Tables look like prismantis's: a ruled grid, coloured bold headers, columns aligned as the table says, cells that
   wrap, sideways scrolling when they can't fit.
5. Nothing that copies today stops working, and each stretch of prose between other blocks (a text block) gains a
   **copy** button; each reply's **copy md** still copies all of it.
6. It stays light: the helper does the reading; the panel only paints.

## Non-goals

- Mouse selection of reply text (gone by Adam's choice; your own turn's text included, for one consistent look).
- Line numbers, folding long code, footnotes, side-by-side layout (the next project).
- Prismantis's theme presets and colour overrides: colours come from the Herdr theme, so they follow it, light or dark.
- LaTeX and right-to-left text.

## Anti-goals

- Losing content: anything the Markdown view showed (raw HTML, odd Markdown) still shows, as plain text at worst.
- A panel that stutters on a long reply.
- Colour that only works in a dark theme.

## Today

- `src/shared/render/blocks.js` cuts text into blocks with `marked` (text, table, code, list, quote, alert, pictures)
  and works out their copy buttons; `src/app/render-helper.js` sends blocks for the open exchanges (newest three plus
  those opened by hand) and the Files tab's file; `src/mods/dock-render/main.js` draws each block's Markdown with
  `TextView.markdown` and its buttons, pictures as images. Your turn's text is drawn with `TextView.markdown` too.
- Herdr's kit has no element for text that changes colour mid-line and wraps; a coloured paragraph has to be a
  wrapping row of small pieces of text, each with its own colour (as prismantis draws in the terminal).
- `cx.open_url(url)` opens a link; `theme()` gives `foreground`, `muted`, `dim`, `border`, `surface`, `raised`,
  `ansi0`–`ansi15` and more, named the same in light and dark themes.
- Measured: a read of an 18 MB session returns ~60 KB for three open exchanges.

## Approaches

Adam picked "colour everything" over "colour the structure" (tables, headings, alerts coloured; paragraphs and lists
left in the selectable Markdown view) and today's look, from mockups in the browser.

How (one sensible way):
- **The helper works out coloured runs** (chosen). It already reads every open reply with `marked`; it also turns
  inline Markdown into runs and code into Prism tokens, so the panel only paints. Heavy work stays off Herdr's UI
  thread and is tested in Node. Costs a bigger reply (estimated 2–3x).
- Parsing in the panel: the mod runtime lacks `Intl` (it already broke `figure.js` there) and Prism there is untested.
- Drawing each block as a picture, like figures: wrapping proportional text in an SVG means measuring fonts in Node.

## Design

### 1. Runs (helper side, `src/shared/render/`)

A **run** is a piece of text with how it looks: `{ text, role?, bold?, italic?, strike?, href? }`, `role` one of
`strong`, `em`, `code`, `link`, `number`, `path`, `del`, or (in code) a Prism colour role. Made from `marked`'s inline
tokens: strong → bold (role `strong`), em → italic (role `em`), del → strike, codespan → role `code` (nothing inside
it is decorated), link → role `link` with `href`, line breaks → a `"\n"` run, raw inline HTML → its text. In plain
text runs (not in code or links), **numbers and paths** become their own runs, with prismantis 0.20.0's patterns
(`markdown.ts`, MIT, credited):
`NUMBER = /(?<![\w.#/-])(v?\d+(?:[.,:]\d+)*(?:%|ms|s|m|h|d|Gi|Mi|GB|MB|KB|x)?)(?![\w/])/g`,
`PATH = /(?<![\w/.:])((?:~|\.{1,2})?\/[\w.@+-]+(?:\/[\w.@+-]*)*)/g`, a path winning where they overlap.

### 2. Blocks carry what the panel draws

Each block keeps its kind, its Markdown and its copy buttons, and gains its drawn content:

| Block | Drawn content |
|---|---|
| text | `parts`: headings `{ level, runs }`, paragraphs `{ runs }`, rules, and raw HTML blocks as plain text |
| list | items, each with its marker (`•`, its number, `☐` or `☑`) and its own blocks (paragraph runs, nested lists, code) |
| quote | its blocks, inside a bar |
| alert | its blocks, inside the coloured box (title as today) |
| table | header cells and row cells as runs, and the column alignment |
| code | lines, each a list of runs: shell and unlabelled code coloured as prismantis does, other languages by Prism (plain when neither knows it) |
| mermaid, figure | unchanged |

Text blocks gain a **copy** button (their Markdown); the other buttons are unchanged. Your turn's text is sent as
blocks too (for open exchanges), drawn the same way. A turn longer than 12 lines is sent as the blocks of its first 12
lines with a `more` flag; **show all** asks the helper for that turn's full blocks (sent with the next read, like an
exchange opened by hand), so a long paste costs nothing until it's opened.

**Shell and unlabelled code** (`bash`, `sh`, `zsh`, `fish`, `shell`, `console`, `powershell`, `ps1`, and a fence with no
language) is coloured as prismantis 0.20.0 does it (`render.tsx` `isShellLang` / `codeLine`, MIT, credited): `#`
comment lines and trailing comments dim, the command word (again after `|`, `&&`, `||`, `;`) as a function, `-f` /
`--flags` as keywords, quoted strings as strings. Prism (`prismjs` 1.30.0, MIT, bundled into the helper) colours:
JavaScript, TypeScript, JSX, TSX, Python,
Go, Rust, Java, Kotlin, Swift, C, C++, C#, Ruby, JSON, YAML, TOML, SQL, HTML/markup, CSS, Dockerfile, HCL and diff (the
languages prismantis lists), plus common aliases (`sh`, `zsh`, `js`, `ts`, `py`, `yml`, …).

### 3. Colours (from the Herdr theme)

| Role | Colour |
|---|---|
| Headings | `ansi6`, bold, a little larger for `#` and `##` |
| Bold | `foreground`, bold |
| Italic | `ansi5`, italic |
| Strikethrough | `dim`, struck through |
| Inline code | `ansi6`, monospace, on `raised` |
| Links | `ansi4`, underlined; clicking opens them (`cx.open_url`) |
| Numbers | `ansi5` |
| Paths | `ansi6` |
| Bullets and list numbers | `ansi6` |
| Quote bar | `ansi4` |
| Table headers | `ansi3`, bold; rules and grid `border` |
| Code text | `foreground`, monospace, on `surface` |
| Code: comments | `dim` |
| Code: strings, chars, template strings, attribute values, URLs | `ansi2` |
| Code: numbers, booleans, constants, symbols, inserted | `ansi5` |
| Code: keywords, important, at-rules, rules, deleted | `ansi4` |
| Code: functions, class names, builtins, keys, selectors | `ansi6` |
| Code: properties, tags | `ansi4` |
| Code: attribute names, variables | `ansi5` |
| Code: regexes | `ansi6` |

The code roles follow prismantis's `PRISM_COLORS` mapping onto its slots (`codeComment`, `codeString`, `number`,
`codeFlag`, `codeCommand`, `link`, `emphasis`, `path`), each slot mapped to the theme colour above.

### 4. Drawing (panel side)

- **Prose** (paragraphs, headings, list items, cells): a wrapping row of pieces, one per word with its following
  space, each with its run's colour and weight, so text wraps between words as text does. A `"\n"` run starts a new line.
- **Code**: one row per line, monospace, no wrapping; the block scrolls sideways when a line is wider than the panel.
  The language label and **copy** stay in its header.
- **Tables**: a ruled grid with a rounded border, header row tinted and coloured, a rule between rows. Every cell of a
  column has the same width, from the column's widest cell (wide characters count two), shrunk to fit the panel the
  way the table art does it (`columnWidths`), never below its longest word; cells wrap. When even that doesn't fit,
  the table scrolls sideways. A table that fits is **stretched to the panel's width**, the spare width shared by the
  columns' natural widths (Adam's call after seeing the preview: stretched, as today's panel draws tables).
- **Lists**: the marker in its colour, then the item's blocks, indented; nested lists indent again.
- **Quotes**: a 3 px `ansi4` bar left of their blocks. **Alerts**: as today, with their blocks drawn this way.
- **Raw HTML** (a block or inline): shown as its text, never lost.

### 5. Performance

Only open exchanges are drawn (the newest three plus those opened), and only their blocks are sent. The helper's
output grows with runs; the builder measures it on a real session and keeps a read under a few tenths of a second and
the output far under `exec`'s 8 MiB.

**A budget of 64 KB drawn at once, measured.** A throwaway test mod drew the README, repeated to each size, as one
coloured piece per word (the helper side took at most 0.28 s and 5.2 MB of output even at 2 MB):

| Markdown | Pieces | Building the view | Herdr | Adam's feel |
|---|---|---|---|---|
| 10 KB (a long reply) | 1,497 | 3 ms | drew | |
| 64 KB (a big plan) | 10,289 | 17 ms | drew | fine, acceptable |
| 128 KB | 20,682 | 44 ms | drew | |
| 192 KB | 31,042 | 49 ms | drew | very laggy |
| 256 KB and up | 41,549+ | — | stopped the redraw ("interrupted") | |

So the panel keeps what it draws at once under **64 KB of Markdown**, and everything stays coloured (Adam picked
this over drawing large content plain, and over a lazy list that would move copy buttons off their blocks):

- **Files tab: pages.** A file over 64 KB is split into pages of at most 64 KB, cut only between blocks; a code block
  or table bigger than a page is cut into parts (code by lines; a table by rows, its header repeated). The helper sends
  one page at a time (`page` in the request; the page count and the page's blocks in the answer). The panel shows
  "Page 2 of 5" with **Prev** and **Next** above and below the page. The file's **copy md** / **copy html** still copy
  the whole file.
- **Conversation: a budget for open exchanges.** Each row carries its exchange's Markdown size (turn and reply). The
  newest exchanges open by default only as far as they fit the budget (always at least one). Opening one by hand that
  would pass the budget folds the open exchanges furthest from it in time until it fits. A single reply bigger than
  the budget is paged inside its exchange the same way as a file ("Part 1 of 2", **Prev** / **Next**).

## Left to the builder

- The exact JSON of runs and parts, and how list items and nested blocks are represented.
- How words are split (spaces kept with the word before), and how a run spanning words keeps its style.
- How table column widths are estimated in pixels from display widths.
- The Prism component set and how it is bundled into the helper; the `LOOK_VERSION` question (pictures don't change).
- Tests: runs (each inline kind, numbers and paths and their overlap, nothing decorated inside code or links), each
  block's drawn content (nested lists with code, task lists, quotes, alerts, tables with alignment and wrapping input,
  raw HTML), Prism lines (a known language, an unknown one, an unclosed fence), and the helper's output size on a real
  transcript.
- By hand in Herdr: a reply with each kind, in a dark and a light theme.
