// Agents' session logs -> the latest answer and every diagram (pure; no host imports). Lines are the log's JSONL lines;
// a line that isn't JSON is skipped (a log being written can end mid-line).
import { blockId, pictureBlocks } from "./markdown.js";

const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
const time = (s) => { const t = Date.parse(s ?? ""); return Number.isFinite(t) ? t : null; };

// Claude Code's project folder for a working folder: ~/.claude/projects/<this>/<sessionId>.jsonl.
export const claudeSlug = (cwd) => String(cwd ?? "").replace(/[^A-Za-z0-9]/g, "-");

// The shared fold: a real user message starts a new turn; assistant text since then is the answer.
function fold(events) {
  let parts = [];
  let prompt = null;
  const diagrams = new Map(); // id -> { kind, source, id, at } (newest kept): Mermaid diagrams and figures
  for (const e of events) {
    if (e.role === "user") { parts = []; prompt = e.text; continue; }
    parts.push(e);
    for (const { kind, source } of pictureBlocks(e.text)) {
      const id = blockId(kind, source);
      diagrams.delete(id);
      diagrams.set(id, { kind, source, id, at: e.at });
    }
  }
  return {
    answer: parts.length ? { text: parts.map((p) => p.text).join("\n\n"), at: parts.at(-1).at } : null,
    prompt,
    diagrams: [...diagrams.values()].reverse(),
  };
}

// A Claude Code transcript. User lines that are only tool results, meta lines (system reminders) and side chains
// (sub-agents) don't start a turn; assistant thinking and tool calls aren't text.
export function readClaude(lines) {
  const events = [];
  for (const line of lines ?? []) {
    const o = parse(line);
    if (!o || o.isSidechain) continue;
    const content = o.message?.content;
    if (o.type === "user" && !o.isMeta) {
      const text = typeof content === "string" ? content
        : Array.isArray(content) && content.some((c) => c?.type === "text") && !content.some((c) => c?.type === "tool_result")
          ? content.filter((c) => c?.type === "text").map((c) => c.text).join("\n") : null;
      if (text != null) events.push({ role: "user", text, at: time(o.timestamp) });
    } else if (o.type === "assistant" && Array.isArray(content)) {
      const text = content.filter((c) => c?.type === "text" && c.text).map((c) => c.text).join("\n\n");
      if (text) events.push({ role: "assistant", text, at: time(o.timestamp) });
    }
  }
  return fold(events);
}

// A Codex rollout (~/.codex/sessions/**/rollout-*.jsonl). Codex adds its own context as user messages
// (<environment_context>, <user_instructions>): those don't start a turn.
export function readCodex(lines) {
  const events = [];
  for (const line of lines ?? []) {
    const o = parse(line);
    const p = o?.payload;
    if (o?.type !== "response_item" || p?.type !== "message" || !Array.isArray(p.content)) continue;
    const text = p.content.filter((c) => (c?.type === "input_text" || c?.type === "output_text") && c.text).map((c) => c.text).join("\n\n");
    if (!text) continue;
    if (p.role === "user") {
      if (/^\s*<(environment_context|user_instructions)>/.test(text)) continue;
      events.push({ role: "user", text, at: time(o.timestamp) });
    } else if (p.role === "assistant") events.push({ role: "assistant", text, at: time(o.timestamp) });
  }
  return fold(events);
}

// The working folder a Codex rollout was started in.
export function codexCwd(lines) {
  for (const line of lines ?? []) {
    const o = parse(line);
    if (o?.type === "session_meta" && typeof o.payload?.cwd === "string") return o.payload.cwd;
  }
  return null;
}
