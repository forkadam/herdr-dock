// Pure helpers for wiring herdr-dock's status-line writer into Claude Code's settings.json (no Node built-ins:
// bundled into the dock-quotas mod and into herdr-statusline-setup.mjs).
//
// Claude Code passes its status-line JSON (with the 5-hour/weekly rate limits and each session's context %) only
// to a `statusLine` command. So the writer must be in that command:
// - no status line yet: the command becomes `node "<writer>"`, which prints nothing (Claude Code looks the same);
// - a simple existing command: it becomes `node "<writer>" --tee | <command>`; --tee passes the input through
//   unchanged, so the user's status line prints what it printed before;
// - a command with shell operators (&&, ;, a pipe...) is left alone: the person adds one line themselves.

export const WRITER_MARK = "herdr-statusline-cache";
// Antigravity's writer (herdr-agy-statusline.mjs): its status line is set up the same way, in its own settings.
export const AGY_MARK = "herdr-agy-statusline";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// settings.json text (null: no file) -> { ok: true, settings, command } or { ok: false, error }.
export function readSettings(text) {
  if (text == null || !String(text).trim()) return { ok: true, settings: {}, command: null };
  let settings;
  try { settings = JSON.parse(String(text).replace(/^﻿/, "")); } catch (e) { return { ok: false, error: `not valid JSON (${e.message})` }; }
  if (!isObj(settings)) return { ok: false, error: "the root is not an object" };
  const sl = settings.statusLine;
  const command = isObj(sl) && typeof sl.command === "string" && sl.command.trim() ? sl.command : null;
  return { ok: true, settings, command };
}

// Shell operators outside quotes: a command with any of these can't be safely piped into.
export function isSimpleCommand(command) {
  let q = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if ("|&;<>`\n\r".includes(c)) return false;
    if (c === "$" && command[i + 1] === "(") return false;
  }
  return q === null;
}

// Words of a command that look like file paths (the script it runs), with ~, $HOME, %USERPROFILE% and
// $env:USERPROFILE expanded against `home` (forward slashes). At most 3.
export function scriptPaths(command, home) {
  const words = String(command).match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const out = [];
  for (let w of words) {
    w = w.replace(/^["']|["']$/g, "");
    if (w.startsWith("-") || !/[\\/]/.test(w)) continue;
    w = w.replace(/^~(?=[\\/])/, home).replace(/^\$HOME(?=[\\/])/, home).replace(/^\$\{HOME\}(?=[\\/])/, home)
      .replace(/^%USERPROFILE%(?=[\\/])/i, home).replace(/^\$env:USERPROFILE(?=[\\/])/i, home).replace(/\\/g, "/");
    if (!/^([A-Za-z]:)?\//.test(w)) continue;
    out.push(w);
    if (out.length >= 3) break;
  }
  return out;
}

// The writer's command: node with the script's path in double quotes (forward slashes, so it reads the same in
// bash, cmd and PowerShell).
export const writerCommand = (writer) => `node "${String(writer).replace(/\\/g, "/")}"`;

// What setup would do. `scriptTexts`: the texts of scriptPaths(command) (null for unreadable), to spot a writer
// line already added by hand. Result:
//   { state: "fed" }                     the writer is already in the command or its script
//   { state: "missing", text }           no status line: `text` adds one
//   { state: "other", text, command }    a simple command: `text` wraps it
//   { state: "complex", command }        a command we won't touch
//   { state: "invalid", error }          settings.json can't be read as JSON
// `mark`: what in a command (or its script) shows the writer is already there (Claude's or Antigravity's).
export function statuslinePlan(settingsText, writer, scriptTexts = [], mark = WRITER_MARK) {
  const r = readSettings(settingsText);
  if (!r.ok) return { state: "invalid", error: r.error };
  const { settings, command } = r;
  if (command && (command.includes(mark) || scriptTexts.some((t) => typeof t === "string" && t.includes(mark)))) {
    return { state: "fed" };
  }
  const nl = settingsText && String(settingsText).includes("\r\n") ? "\r\n" : "\n";
  const write = (statusLine) => JSON.stringify({ ...settings, statusLine }, null, 2).replace(/\n/g, nl) + nl;
  if (!command) {
    const prev = isObj(settings.statusLine) ? settings.statusLine : {};
    return { state: "missing", text: write({ ...prev, type: "command", command: writerCommand(writer) }) };
  }
  if (!isSimpleCommand(command)) return { state: "complex", command };
  return { state: "other", command, text: write({ ...settings.statusLine, command: `${writerCommand(writer)} --tee | ${command}` }) };
}
