// Agents' session logs -> the conversation (exchanges, newest first) and every diagram (pure; no host imports). Lines
// are the log's JSONL lines; a line that isn't JSON is skipped (a log being written can end mid-line).
//
// Exchange: { id, by: "you" | "event", event, text, at, parts, running }
//   by/event   who started it: you, or an event of that kind ("task-notification", "compaction", …)
//   parts      Claude's reply: { type: "text", text, at } and, for what arrived while Claude worked,
//              { type: "marker", by, event, text, at }
//   running    only the newest can be: Claude hasn't ended its turn
import { blockId, pictureBlocks } from "./markdown.js";
import { HINT_PHRASE } from "./hints.js";

const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
const time = (s) => { const t = Date.parse(s ?? ""); return Number.isFinite(t) ? t : null; };

export const MAX_EXCHANGES = 200;
const EVENT_TEXT = 140;

// Claude Code's project folder for a working folder: ~/.claude/projects/<this>/<sessionId>.jsonl.
export const claudeSlug = (cwd) => String(cwd ?? "").replace(/[^A-Za-z0-9]/g, "-");

// An event's one line: its <summary> when it has one, else its first line without tags; at most 140 characters.
function eventText(text) {
  const s = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]
    ?? String(text).replace(/<[^>]+>/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > EVENT_TEXT ? `${one.slice(0, EVENT_TEXT - 1)}…` : one;
}

// A slash command's line: "/clear", plus its arguments.
function commandText(text) {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim() ?? "";
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? "";
  return args ? `${name} ${args}` : name;
}

// What you sent, as shown: a slash command as "/name args", a bash-mode command as "! cmd", else the text.
function youText(text) {
  if (/<command-name>/.test(text)) return commandText(text);
  const bash = /^\s*<bash-input>([\s\S]*?)<\/bash-input>/.exec(text);
  return bash ? `! ${bash[1].trim()}` : text;
}

// Lines that end a turn without starting one: an interruption, a slash command's or bash mode's output.
const TURN_ENDS = /^\s*(\[Request interrupted by user|<(local-command-stdout|bash-stdout|bash-stderr)>)/;

// Who a user line (or a queued message) comes from: { by, event, text }, or null when it isn't shown.
function speaker(text, originKind, mode) {
  if (originKind === "human" || mode === "prompt") return { by: "you", event: null, text: youText(text) };
  if (originKind) return { by: "event", event: originKind, text: eventText(text) };
  if (mode) return { by: "event", event: mode, text: eventText(text) };
  const s = text.trimStart();
  if (s.startsWith("<task-notification>")) return { by: "event", event: "task-notification", text: eventText(text) };
  if (/^<(local-command-caveat|local-command-stdout|system-reminder|bash-stdout|bash-stderr)>/.test(s)) return null;
  return { by: "you", event: null, text: youText(text) };
}

// The shared fold. Events: { role: "user", id, by, event, text, at } | { role: "marker", by, event, text, at }
// | { role: "assistant", text, at }. `running` says whether the log's last turn is still going.
function fold(events, running) {
  const exchanges = [];
  const diagrams = new Map(); // id -> { kind, source, id, at } (newest kept): Mermaid diagrams and figures
  const start = (e) => exchanges.push({ id: e.id, by: e.by, event: e.event, text: e.text, at: e.at, parts: [], running: false });
  for (const e of events) {
    if (e.role === "user") { start(e); continue; }
    if (e.role === "marker") {
      if (!exchanges.length) start({ ...e, id: e.id ?? "marker-0" });
      else exchanges.at(-1).parts.push({ type: "marker", by: e.by, event: e.event, text: e.text, at: e.at });
      continue;
    }
    if (!exchanges.length) start({ id: "start", by: "you", event: null, text: "", at: e.at });
    exchanges.at(-1).parts.push({ type: "text", text: e.text, at: e.at });
    for (const { kind, source } of pictureBlocks(e.text)) {
      const id = blockId(kind, source);
      diagrams.delete(id);
      diagrams.set(id, { kind, source, id, at: e.at });
    }
  }
  if (exchanges.length) exchanges.at(-1).running = running(exchanges.at(-1));
  return { exchanges: exchanges.slice(-MAX_EXCHANGES).reverse(), diagrams: [...diagrams.values()].reverse() };
}

// Claude's reply as written: its text parts, joined.
export const replyText = (ex) => ex.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n\n");

// What Markdown costs the panel to draw, in prose-byte units (as blocks.js counts it, cheaply, line by line): fenced
// code counts twice its bytes and table lines three times.
export function costOf(text) {
  const enc = new TextEncoder();
  let fence = null, n = 0;
  const lines = String(text ?? "").split("\n");
  for (const [i, line] of lines.entries()) {
    const b = enc.encode(line).length + (i < lines.length - 1 ? 1 : 0);
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { n += b * 2; if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; }
    else if (m) { fence = m[1]; n += b * 2; }
    else n += /^\s*\|/.test(line) ? b * 3 : b;
  }
  return n;
}

// An exchange as the panel's row: preview (the reply's first words), state ("reply" | "working" | "none"), replyAt.
export function exchangeRow(ex) {
  const reply = replyText(ex);
  let fence = null; // the open fence's marker while inside a fenced block (its lines are left out)
  const prose = reply.split("\n").filter((line) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) fence = null; return false; }
    if (m) { fence = m[1]; return false; }
    return true;
  });
  const preview = prose.join(" ").replace(/[#*_>|`]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    id: ex.id, by: ex.by, event: ex.event, text: ex.text, at: ex.at, preview, size: costOf(ex.text) + costOf(reply),
    state: reply.trim() ? "reply" : ex.running ? "working" : "none",
    replyAt: ex.parts.at(-1)?.at ?? null,
  };
}

const userText = (content) => (typeof content === "string" ? content
  : Array.isArray(content) && content.some((c) => c?.type === "text") && !content.some((c) => c?.type === "tool_result")
    ? content.filter((c) => c?.type === "text").map((c) => c.text).join("\n") : null);

// A Claude Code transcript. Tool results, meta lines (system reminders) and side chains (sub-agents) start nothing;
// assistant thinking and tool calls aren't text. A turn is still going while Claude's last line didn't end it or a
// tool call has no result.
export function readClaude(lines) {
  const events = [];
  const openTools = new Set();
  let lastStop = null;
  (lines ?? []).forEach((line, i) => {
    const o = parse(line);
    if (!o || o.isSidechain) return;
    const content = o.message?.content;
    const at = time(o.timestamp);
    if (o.type === "user") {
      if (Array.isArray(content)) for (const c of content) if (c?.type === "tool_result") openTools.delete(c.tool_use_id);
      if (o.isMeta) return;
      const id = o.uuid ?? `line-${i}`;
      // A new turn: Claude hasn't answered it yet (its first line can take a while), and earlier tool calls are over.
      const begin = () => { lastStop = null; openTools.clear(); };
      if (o.isCompactSummary) { begin(); events.push({ role: "user", id, by: "event", event: "compaction", text: "", at }); return; }
      const text = userText(content);
      if (text == null) return;
      if (TURN_ENDS.test(text)) { lastStop = "end_turn"; openTools.clear(); return; }
      const who = speaker(text, o.origin?.kind ?? null, null);
      if (who) { begin(); events.push({ role: "user", id, ...who, at }); }
    } else if (o.type === "attachment" && o.attachment?.type === "queued_command") {
      const a = o.attachment;
      const who = speaker(String(a.prompt ?? ""), a.origin?.kind ?? null, a.commandMode ?? null);
      if (who) events.push({ role: "marker", id: o.uuid ?? `line-${i}`, ...who, at });
    } else if (o.type === "assistant" && Array.isArray(content)) {
      for (const c of content) if (c?.type === "tool_use" && c.id) openTools.add(c.id);
      if (o.message?.stop_reason !== undefined) lastStop = o.message.stop_reason;
      const text = content.filter((c) => c?.type === "text" && c.text).map((c) => c.text).join("\n\n");
      if (text) events.push({ role: "assistant", text, at });
    }
  });
  return fold(events, () => lastStop !== "end_turn" || openTools.size > 0);
}

// Whether a Claude Code session's last typed prompts got Render's hint: Claude Code logs each hint it hands Claude as
// a hook_additional_context attachment after the prompt. Read from the log's end, at most REACH_PROMPTS prompts.
// "ok": the newest got it; "silent": the newest 2 both didn't; else "unknown" (too few prompts, or a single miss).
// Slash and ! commands may not run prompt hooks, and queued messages and task notifications don't: none counts.
const REACH_PROMPTS = 3;
const NOT_TYPED = /^<(command-name|command-message|bash-input)>/;
const hintIn = (content) => (Array.isArray(content) ? content : [content]).some((c) => typeof c === "string" && c.includes(HINT_PHRASE));

export function hintReach(lines) {
  const got = []; // newest first
  let hinted = false; // a hint after the line being read, before the next typed prompt
  for (let i = (lines?.length ?? 0) - 1; i >= 0 && got.length < REACH_PROMPTS; i--) {
    const o = parse(lines[i]);
    if (!o || o.isSidechain) continue;
    if (o.type === "attachment") {
      if (o.attachment?.type === "hook_additional_context" && hintIn(o.attachment.content)) hinted = true;
      continue;
    }
    if (o.type !== "user" || o.isMeta) continue;
    const text = userText(o.message?.content);
    if (text == null || NOT_TYPED.test(text.trimStart()) || speaker(text, o.origin?.kind ?? null, null)?.by !== "you") continue;
    got.push(hinted);
    hinted = false;
  }
  const state = got[0] ? "ok" : got.length >= 2 && !got[1] ? "silent" : "unknown";
  return { state, checked: got.length };
}

// A Codex rollout (~/.codex/sessions/**/rollout-*.jsonl). Codex adds its own context as user messages
// (<environment_context>, <user_instructions>): those start nothing. The newest exchange is still going until its
// reply has text.
export function readCodex(lines) {
  const events = [];
  (lines ?? []).forEach((line, i) => {
    const o = parse(line);
    const p = o?.payload;
    if (o?.type !== "response_item" || p?.type !== "message" || !Array.isArray(p.content)) return;
    const text = p.content.filter((c) => (c?.type === "input_text" || c?.type === "output_text") && c.text).map((c) => c.text).join("\n\n");
    if (!text) return;
    if (p.role === "user") {
      if (/^\s*<(environment_context|user_instructions)>/.test(text)) return;
      events.push({ role: "user", id: `line-${i}`, by: "you", event: null, text, at: time(o.timestamp) });
    } else if (p.role === "assistant") events.push({ role: "assistant", text, at: time(o.timestamp) });
  });
  return fold(events, (ex) => !ex.parts.some((pt) => pt.type === "text"));
}

// The working folder a Codex rollout was started in.
export function codexCwd(lines) {
  for (const line of lines ?? []) {
    const o = parse(line);
    if (o?.type === "session_meta" && typeof o.payload?.cwd === "string") return o.payload.cwd;
  }
  return null;
}
