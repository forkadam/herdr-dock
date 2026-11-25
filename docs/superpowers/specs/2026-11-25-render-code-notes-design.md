# Render panel: line numbers, folding, footnotes, side by side — design (short)

**Why.** The last part of replacing prismantis (project 3): the Render panel already colours replies; these are the
remaining things prismantis does to them. Adam approved this design as proposed.

**Goals.**
- **Code**: a block of 10 or more lines gets dim line numbers; one over 30 lines folds to its first 20 with
  **+N more lines**, and **show less** folds it back; **copy** still copies the whole block. Open/folded is kept per
  block until the focused agent changes.
- **Footnotes**: `[^label]` references become superscript marks (¹ ² ³ …) numbered by first reference; the notes
  (`[^label]: text`) are drawn at the end of the reply (or file page) under a short dim rule, as "¹ text" in dim colour.
  Collected over the whole reply, so a note at the end matches a reference anywhere before it. A reference without a
  note stays as written; nothing inside code (fences or inline code) counts.
- **Side by side**: consecutive tables, diagrams and figures share a row when all of them fit the panel's width at
  their own size (tables fitted to their content, diagrams at their natural size); otherwise they stack as today
  (tables stretched). *My call:* all or nothing per run, not prismantis's progressive wrapping, so a table is either
  fitted beside its neighbours or stretched on its own, never fitted alone.

**Non-goals.** Anything else prismantis does to the terminal; remembering open code blocks across agent switches or
restarts (prismantis remembers 500; the panel keeps them while you stay on an agent).

**Approach.** As prismantis (ported, MIT, credited): `marked` 18 has no footnotes (`[^1]: text` stays a paragraph,
`[^1]` literal text), so the helper rewrites them before `marked`: a pure `footnotes.js` collects the notes over the
whole text and replaces references outside code with their marks. The line numbers, folding and side-by-side decision
are pure functions in `view.js`, drawn by `main.js`.

**Left to the builder.** Exact spacing; the mark for numbers past 9 (prismantis: each digit superscripted); the
code's line-number gutter width; tests (footnotes: order, unknown references, code untouched, notes block; fold and
number thresholds; the side-by-side decision; a reply whose references sit in runs split by mid-turn markers).
