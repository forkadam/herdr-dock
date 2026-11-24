// src/app/statusline-setup.js
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// src/shared/statusline.js
var WRITER_MARK = "herdr-statusline-cache";
var AGY_MARK = "herdr-agy-statusline";
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function readSettings(text) {
  if (text == null || !String(text).trim()) return { ok: true, settings: {}, command: null };
  let settings;
  try {
    settings = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: `not valid JSON (${e.message})` };
  }
  if (!isObj(settings)) return { ok: false, error: "the root is not an object" };
  const sl = settings.statusLine;
  const command = isObj(sl) && typeof sl.command === "string" && sl.command.trim() ? sl.command : null;
  return { ok: true, settings, command };
}
function isSimpleCommand(command) {
  let q = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if ("|&;<>`\n\r".includes(c)) return false;
    if (c === "$" && command[i + 1] === "(") return false;
  }
  return q === null;
}
function scriptPaths(command, home) {
  const words = String(command).match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const out = [];
  for (let w of words) {
    w = w.replace(/^["']|["']$/g, "");
    if (w.startsWith("-") || !/[\\/]/.test(w)) continue;
    w = w.replace(/^~(?=[\\/])/, home).replace(/^\$HOME(?=[\\/])/, home).replace(/^\$\{HOME\}(?=[\\/])/, home).replace(/^%USERPROFILE%(?=[\\/])/i, home).replace(/^\$env:USERPROFILE(?=[\\/])/i, home).replace(/\\/g, "/");
    if (!/^([A-Za-z]:)?\//.test(w)) continue;
    out.push(w);
    if (out.length >= 3) break;
  }
  return out;
}
var writerCommand = (writer) => `node "${String(writer).replace(/\\/g, "/")}"`;
function agyWriterCommand(writer) {
  const w = String(writer).replace(/\\/g, "/");
  if (!/^[A-Za-z]:\//.test(w)) return writerCommand(w);
  if (!/\s/.test(w)) return `node ${w}`;
  return `node -e import("file:///${encodeURI(w).replace(/[?#]/g, encodeURIComponent)}")`;
}
function statuslinePlan(settingsText, writer, scriptTexts = [], mark = WRITER_MARK) {
  const r = readSettings(settingsText);
  if (!r.ok) return { state: "invalid", error: r.error };
  const { settings, command } = r;
  const nl = settingsText && String(settingsText).includes("\r\n") ? "\r\n" : "\n";
  const write = (statusLine) => JSON.stringify({ ...settings, statusLine }, null, 2).replace(/\n/g, nl) + nl;
  const agy = mark === AGY_MARK;
  const ours = agy ? agyWriterCommand(writer) : writerCommand(writer);
  if (agy && command && command.trim() === writerCommand(writer) && ours !== command.trim()) {
    return { state: "missing", stale: true, text: write({ ...settings.statusLine, command: ours }) };
  }
  if (command && (command.includes(mark) || scriptTexts.some((t) => typeof t === "string" && t.includes(mark)))) {
    return { state: "fed" };
  }
  if (!command) {
    const prev = isObj(settings.statusLine) ? settings.statusLine : {};
    return { state: "missing", text: write({ ...prev, type: "command", command: ours }) };
  }
  if (!isSimpleCommand(command)) return { state: "complex", command };
  return { state: "other", command, text: write({ ...settings.statusLine, command: `${ours} --tee | ${command}` }) };
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/app/statusline-setup.js
var readOrNull = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
function setupStatusline({ claudeHome, writer, home = homedir(), dry = false, mark = WRITER_MARK, name = "Claude Code" }) {
  if (!existsSync(claudeHome)) {
    return { state: "no-claude", changed: false, message: `no ${slashPath(claudeHome)}: ${name} isn't set up here; nothing to do` };
  }
  const settingsPath = join(claudeHome, "settings.json");
  const text = readOrNull(settingsPath);
  const first = statuslinePlan(text, writer, [], mark);
  const plan = first.command ? statuslinePlan(text, writer, scriptPaths(first.command, slashPath(home)).map(readOrNull), mark) : first;
  const where = slashPath(settingsPath);
  switch (plan.state) {
    case "fed":
      return { state: "fed", changed: false, message: `the ${name === "Claude Code" ? "Claude" : name} status line already feeds herdr-dock` };
    case "invalid":
      return { state: "invalid", changed: false, message: `${where}: ${plan.error}; not changed` };
    case "complex":
      return {
        state: "complex",
        changed: false,
        message: `your status line (${plan.command}) is more than one command; add the herdr-dock line to it by hand (README, "Where the quota and context numbers come from")`
      };
  }
  const what = plan.stale ? `fix herdr-dock's status line in ${where} (${name} on Windows runs it without a shell, so the quoted path broke at its space)` : plan.state === "missing" ? `add a status line that feeds herdr-dock and prints nothing to ${where} (${name})` : `put herdr-dock's writer in front of your status line in ${where} (${name}; it prints the same)`;
  if (dry) return { state: plan.state, changed: false, message: `would ${what}` };
  if (text != null) copyFileSync(settingsPath, settingsPath + ".bak-herdr-dock");
  const tmp = `${settingsPath}.tmp-herdr-dock-${process.pid}`;
  try {
    writeFileSync(tmp, plan.text);
    renameSync(tmp, settingsPath);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { state: plan.state, changed: true, message: `${what[0].toUpperCase()}${what.slice(1)}` + (text != null ? ` (backup: settings.json.bak-herdr-dock)` : "") };
}
function main(argv) {
  const agy = argv.includes("--agy");
  const at = argv.indexOf("--writer");
  const beside = join(dirname(fileURLToPath(import.meta.url)), agy ? "herdr-agy-statusline.mjs" : "herdr-statusline-cache.mjs");
  const writer = resolve(at >= 0 && argv[at + 1] ? argv[at + 1] : beside);
  if (!existsSync(writer)) {
    console.error(`no writer at ${slashPath(writer)}`);
    return 1;
  }
  const claudeHome = agy ? resolve(process.env.DOCK_AGY_HOME || join(homedir(), ".gemini", "antigravity-cli")) : resolve(process.env.DOCK_CLAUDE_HOME || join(homedir(), ".claude"));
  const r = setupStatusline({
    claudeHome,
    writer: slashPath(writer),
    dry: argv.includes("--check"),
    ...agy ? { mark: AGY_MARK, name: "Antigravity" } : {}
  });
  console.log(`${r.state}: ${r.message}`);
  return r.state === "invalid" ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`status line setup failed: ${e.message}`);
    process.exitCode = 1;
  }
}
export {
  setupStatusline
};
