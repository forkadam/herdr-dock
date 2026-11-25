// The Render panel's Conversation view model (pure; no host imports; no Intl, the mod imports it): what's open, labels,
// colours, which copies show.
import { BUDGET } from "./budget.js";
import { columnWidths } from "./columns.js";

// The newest exchanges open by default; older ones are folded to a row.
export const OPEN_NEWEST = 3;
// A formatted copy above this (html + text) goes as plain text: it travels to the helper as a command-line argument.
export const HTML_LIMIT = 512 * 1024;
// A turn's text shows this many lines, then "show all".
export const PROMPT_LINES = 12;

// The Herdr theme colour of each speaker's rail and label.
export const ROLE_COLOR = { you: "ansi4", claude: "ansi5", event: "ansi3" };

// GitHub alerts: title and colour.
export const ALERTS = {
  note: { title: "Note", color: "ansi4" },
  tip: { title: "Tip", color: "ansi2" },
  important: { title: "Important", color: "ansi5" },
  warning: { title: "Warning", color: "ansi3" },
  caution: { title: "Caution", color: "ansi1" },
};

// The exchanges drawn open, in row order: the newest OPEN_NEWEST unless folded by hand, and any opened by hand.
export function openIds(rows, toggled) {
  return rows.filter((r, i) => toggled.get(r.id) ?? i < OPEN_NEWEST).map((r) => r.id);
}

const EVENTS = { "task-notification": "BACKGROUND TASK", compaction: "CONTEXT COMPACTED" };

// A rail's label: YOU, CLAUDE, or the event's kind in words.
export function speakerLabel(role, event = null) {
  if (role === "you") return "YOU";
  if (role === "claude") return "CLAUDE";
  if (!event) return "EVENT";
  return EVENTS[event] ?? String(event).replace(/[-_]+/g, " ").trim().toUpperCase();
}

// The buttons drawn: formatted ones only where formatted copies work.
export const shownButtons = (buttons, canHtml) => (buttons ?? []).filter((b) => canHtml || b.html === undefined);

// How a click copies: plain text, formatted through the helper, or plain with a note why not formatted.
export function copyPlan(button, canHtml) {
  if (button.html === undefined) return { how: "plain" };
  if (!canHtml) return { how: "plain", note: "formatted copy works on macOS only" };
  if (button.html.length + button.text.length > HTML_LIMIT) return { how: "plain", note: "too large for a formatted copy" };
  return { how: "html" };
}

// A turn's text as shown: its first PROMPT_LINES lines unless shown in full.
export function promptView(text, showAll) {
  const lines = String(text ?? "").split("\n");
  if (showAll || lines.length <= PROMPT_LINES) return { text: String(text ?? ""), more: false };
  return { text: lines.slice(0, PROMPT_LINES).join("\n"), more: true };
}

// What a reply without text says instead.
export const replyNote = (row) => (row.state === "working" ? "working…" : row.state === "none" ? "no reply text" : null);

// The stored view, "answer" (before the Conversation tab) included.
export function viewOf(stored) {
  return stored === "diagrams" || stored === "files" ? stored : "conversation";
}

// The Render panel's row about the diagram-hint hooks, from what the check found in ~/.claude/settings.json
// ("present" | "missing" | "moved" | "invalid" | "no-claude" | null), or null when there's nothing to say.
export function hintsNotice(state, { dismissed, error }) {
  if (dismissed) return null;
  if (error) return { text: `Set up failed: ${error}`, action: "setup" };
  if (state === "missing") return { text: "Diagram hints for Claude aren't set up", action: "setup" };
  if (state === "moved") return { text: "Diagram hints point at another install", action: "setup" };
  if (state === "invalid") return { text: "~/.claude/settings.json can't be read: diagram hints aren't set up", action: null };
  return null;
}

// ---- Colour ----

// Every colour the panel draws with, as a Herdr theme key (so light and dark themes both work): the run roles, the
// drawing roles, and code's roles (prismantis's slots mapped onto the theme).
export const COLOURS = {
  heading: "ansi6", strong: "foreground", em: "ansi5", del: "dim", code: "ansi6", link: "ansi4", number: "ansi5", path: "ansi6",
  bullet: "ansi6", quote: "ansi4", tableHeader: "ansi3", rule: "border", codeText: "foreground", codeBg: "surface", inlineCodeBg: "raised",
  note: "dim", comment: "dim", string: "ansi2", keyword: "ansi4", function: "ansi6", property: "ansi4", attr: "ansi5", regex: "ansi6",
};

// Runs -> the pieces the panel draws: each word with its following spaces, in its run's style, so prose wraps between
// words. A line break and inline code stay whole.
export function pieces(runs) {
  const out = [];
  for (const r of runs ?? []) {
    if (r.text === "\n" || r.role === "code") { out.push(r); continue; }
    for (const w of r.text.match(/\S+\s*|\s+/g) ?? []) out.push({ ...r, text: w });
  }
  return out;
}

// The exchanges drawn open, in row order, keeping what's drawn within the budget: the ones opened by hand (most
// recently opened first), then the newest OPEN_NEWEST not folded by hand, each kept while the total size fits; the
// first is always kept.
export function openWithin(rows, toggled, budget = BUDGET) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hand = [...toggled].filter(([id, on]) => on && byId.has(id)).map(([id]) => id).reverse();
  const defaults = rows.slice(0, OPEN_NEWEST).map((r) => r.id).filter((id) => !toggled.has(id));
  const keep = new Set();
  let total = 0;
  for (const id of [...hand, ...defaults]) {
    if (keep.has(id)) continue;
    const size = byId.get(id).size ?? 0;
    if (!keep.size || total + size <= budget) { keep.add(id); total += size; }
  }
  return rows.filter((r) => keep.has(r.id)).map((r) => r.id);
}

// A character's width in the panel's prose, in px (13 px text), and each cell's padding.
export const CHAR_PX = 7.2;
const CELL_PAD = 16;

// ---- Code folding and line numbers, side by side (prismantis 0.20.0's thresholds, MIT) ----

export const NUMBER_FROM = 10; // a code block this long or longer gets line numbers
export const FOLD_OVER = 30; // one longer than this folds...
export const FOLD_TO = 20; // ...to its first this many lines

// How much of a code block shows: { shown, more (lines folded away), numbered }.
export function codeFold(lineCount, open) {
  const folded = lineCount > FOLD_OVER && !open;
  return { shown: folded ? FOLD_TO : lineCount, more: folded ? lineCount - FOLD_TO : 0, numbered: lineCount >= NUMBER_FROM };
}

// Whether consecutive tables, diagrams and figures (their widths in px) share a row: two or more that all fit.
export function sideBySide(widths, panelPx, gap = 12) {
  return widths.length >= 2 && widths.reduce((a, w) => a + w, 0) + gap * (widths.length - 1) <= panelPx;
}

// A table's column widths in px for a panel `panelPx` wide: columnWidths in characters, never below a column's longest
// word (a table that can't fit then scrolls sideways). A table that fits is stretched to the panel's width, the spare
// width shared by the columns' natural widths (Adam's call: stretched, as the Markdown view drew tables).
export function tableWidths(natural, words, panelPx, stretch = true) {
  // + 1e-9: 115.2 / 7.2 is 15.999999…, and a lost character would wrap a fitted table measured again at its own width.
  const chars = Math.max(natural.length, Math.floor((panelPx - CELL_PAD * natural.length) / CHAR_PX + 1e-9));
  const fitted = columnWidths(natural, chars, 0, words).map((w, c) => Math.max(w, words[c] ?? 1) * CHAR_PX + CELL_PAD);
  const used = fitted.reduce((a, w) => a + w, 0);
  if (!stretch || used >= panelPx) return fitted;
  const weight = natural.reduce((a, n) => a + Math.max(1, n), 0);
  const out = fitted.map((w, c) => Math.floor(w + ((panelPx - used) * Math.max(1, natural[c])) / weight));
  out[out.length - 1] += panelPx - out.reduce((a, w) => a + w, 0);
  return out;
}
