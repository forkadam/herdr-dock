// Which agent the Render panel follows, and where its session log is (pure; no host imports).
import { matchSession } from "../claude.js";
import { claudeSlug } from "./transcript.js";

// The focused pane's agent, else the first agent in the focused tab; null without one. focused(): { pane, terminal,
// tab }; agents(): Herdr's list.
export function pickAgent(focus, agents) {
  if (!focus || !Array.isArray(agents)) return null;
  return agents.find((a) => (focus.pane && a.pane === focus.pane) || (focus.terminal && a.address === focus.terminal))
    ?? agents.find((a) => a.tab === focus.tab) ?? null;
}

// "claude" or "codex" for an agent on this machine (its log is local), else null.
export function agentKind(a) {
  if (!a || String(a.address).includes("/")) return null;
  const key = a.program?.key, app = String(a.app ?? "");
  if (key === "claude" || /^claude/.test(app)) return "claude";
  if (key === "codex" || /^codex/.test(app)) return "codex";
  return null;
}

// Claude Code's transcript for a terminal: hc's info (foreground pid, created_ms) and the session record at
// ~/.claude/sessions/<pid>.json (its sessionId and cwd); null when they don't match.
export function transcriptPath(home, info, recordText, nowMs) {
  const pid = info?.foreground?.pid;
  if (typeof pid !== "number" || typeof info?.created_ms !== "number") return null;
  const sessionId = matchSession(recordText, { pid }, info.created_ms, nowMs);
  let cwd = null;
  try { cwd = JSON.parse(recordText)?.cwd ?? null; } catch { cwd = null; }
  if (!sessionId || typeof cwd !== "string" || !cwd) return null;
  return `${String(home).replace(/[\\/]+$/, "")}/.claude/projects/${claudeSlug(cwd)}/${sessionId}.jsonl`;
}
