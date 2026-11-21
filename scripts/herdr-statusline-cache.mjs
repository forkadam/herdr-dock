#!/usr/bin/env node
// Writes a sanitized Claude Code status-line snapshot for herdr-dock's Quotas and Agents.
// A Node port of herdr-statusline-cache.py, so it runs the same on Windows, macOS and Linux with no Python.
//
// Your status line pipes Claude Code's status-line JSON here (stdin). Per session this keeps only the
// context-window percentage and when it was seen, plus the account's 5-hour/weekly usage windows when Claude
// Code reports them. No paths, prompts or transcripts. Output: ~/.claude/statusline-cache/claude-statusline.json
// Never throws and never prints: the status line must keep working whatever happens here.
// `npm run deploy` installs this file as ~/.claude/herdr-statusline-cache.mjs.
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = join(homedir(), ".claude", "statusline-cache");
const CACHE_FILE = join(CACHE_DIR, "claude-statusline.json");
const KEEP_SECONDS = 7 * 86400;
const MAX_SESSIONS = 200;

const number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function windowsFrom(limits) {
  const rows = [];
  if (!isObj(limits)) return rows;
  for (const [key, kind] of [["five_hour", "five_hour"], ["seven_day", "weekly"]]) {
    const w = limits[key];
    if (!isObj(w)) continue;
    const used = number(w.used_percentage ?? w.used_percent);
    if (used === null || used < 0 || used > 100) continue;
    let reset = number(w.resets_at);
    if (reset !== null && reset > 1e12) reset = reset / 1000; // milliseconds
    rows.push({ kind, used_percent: used, remaining_percent: 100 - used, resets_at: reset });
  }
  return rows;
}

function main() {
  // Windows PowerShell can prefix piped text with one or more UTF-8 byte-order marks.
  const text = readFileSync(0, "utf8").slice(0, 1 << 20).replace(/^﻿+/, "");
  const event = JSON.parse(text);
  if (!isObj(event)) return;
  const session = event.session_id;
  if (typeof session !== "string" || session.length < 8 || session.length > 64) return;
  const now = Date.now() / 1000;
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (!isObj(cache)) cache = {};
  } catch {
    cache = {};
  }
  const contexts = isObj(cache.session_contexts) ? cache.session_contexts : {};
  const ctx = isObj(event.context_window) ? event.context_window : {};
  const used = number(ctx.used_percentage);
  if (used !== null && used >= 0 && used <= 100) {
    contexts[session] = { used_percent: used, cache: { session_id: session, last_activity_unix: now } };
  }
  const seen = (v) => number(isObj(v?.cache) ? v.cache.last_activity_unix : null) ?? 0;
  const newest = Object.entries(contexts)
    .filter(([, v]) => isObj(v) && now - seen(v) < KEEP_SECONDS)
    .sort((a, b) => seen(b[1]) - seen(a[1]))
    .slice(0, MAX_SESSIONS);
  const out = { provider: "claude", source: "claude-statusline", fetched_at_unix: now, session_contexts: Object.fromEntries(newest) };
  const windows = windowsFrom(event.rate_limits);
  if (windows.length) {
    out.windows = windows;
  } else if (Array.isArray(cache.windows)) {
    out.windows = cache.windows;
    out.fetched_at_unix = number(cache.fetched_at_unix) || now;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = join(CACHE_DIR, `.claude-statusline-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(tmp, JSON.stringify(out));
    renameSync(tmp, CACHE_FILE);
  } finally {
    try { rmSync(tmp, { force: true }); } catch {}
  }
}

try {
  main();
} catch {
  // Never break the status line.
}
