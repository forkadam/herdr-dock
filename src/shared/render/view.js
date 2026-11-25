// The Render panel's Conversation view model (pure; no host imports): what's open, labels, colours, which copies show.

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
