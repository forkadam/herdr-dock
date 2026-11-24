import * as setupNoticeModule from "../src/mods/dock-quotas/view.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isSimpleCommand, readSettings, scriptPaths, statuslinePlan, writerCommand } from "../src/shared/statusline.js";
import { setupStatusline } from "../src/app/statusline-setup.js";
import { setupNotice } from "../src/mods/dock-quotas/view.js";

const W = "/home/u/.config/herdr-app/mods/dock-quotas/herdr-statusline-cache.mjs";
const WRITER = join(import.meta.dirname, "..", "scripts", "herdr-statusline-cache.mjs");

test("statuslinePlan: no status line adds one that runs the writer, keeping the other settings", () => {
  for (const text of [null, "", '{"theme":"dark"}', '{"statusLine":{"type":"command","command":"  "}}']) {
    const p = statuslinePlan(text, W);
    assert.equal(p.state, "missing", String(text));
    const s = JSON.parse(p.text);
    assert.equal(s.statusLine.type, "command");
    assert.equal(s.statusLine.command, `node "${W}"`);
    if (text?.includes("theme")) assert.equal(s.theme, "dark");
  }
});

test("statuslinePlan: a simple command gets the writer in front with --tee; options are kept", () => {
  const p = statuslinePlan(JSON.stringify({ statusLine: { type: "command", command: "~/.claude/statusline.sh", padding: 1 } }), W);
  assert.equal(p.state, "other");
  assert.deepEqual(JSON.parse(p.text).statusLine, { type: "command", command: `node "${W}" --tee | ~/.claude/statusline.sh`, padding: 1 });
});

test("statuslinePlan: fed, complex and invalid are left alone", () => {
  assert.equal(statuslinePlan('{"statusLine":{"command":"node ~/.claude/herdr-statusline-cache.mjs"}}', W).state, "fed");
  assert.equal(statuslinePlan('{"statusLine":{"command":"bash ~/s.sh"}}', W, [null, "x | node herdr-statusline-cache.mjs"]).state, "fed");
  assert.equal(statuslinePlan('{"statusLine":{"command":"a && b"}}', W).state, "complex");
  assert.equal(statuslinePlan("{nope", W).state, "invalid");
  assert.equal(statuslinePlan("[]", W).state, "invalid");
});

test("statuslinePlan keeps CRLF and a BOM-prefixed file reads", () => {
  const p = statuslinePlan('\uFEFF{\r\n  "theme": "x"\r\n}\r\n', W);
  assert.equal(p.state, "missing");
  assert.ok(p.text.includes("\r\n") && !/[^\r]\n/.test(p.text));
  assert.equal(readSettings(p.text).command, `node "${W}"`);
});

test("isSimpleCommand / scriptPaths / writerCommand", () => {
  assert.ok(isSimpleCommand('powershell -NoProfile -File "C:\\a b\\s.ps1"'));
  assert.ok(isSimpleCommand("echo 'a|b'"));
  for (const c of ["a | b", "a; b", "a & b", "a > f", "echo $(x)", "echo `x`", 'echo "open']) assert.ok(!isSimpleCommand(c), c);
  assert.deepEqual(scriptPaths('bash ~/.claude/s.sh --x "$HOME/b c.sh" %USERPROFILE%\\s.ps1 rel/x.sh', "/h"),
    ["/h/.claude/s.sh", "/h/b c.sh", "/h/s.ps1"]);
  assert.equal(writerCommand("C:\\Users\\a\\w.mjs"), 'node "C:/Users/a/w.mjs"');
});

test("setupStatusline: writes settings with a backup, then reports fed; leaves a missing ~/.claude alone", () => {
  const home = mkdtempSync(join(tmpdir(), "sls-"));
  const claude = join(home, ".claude");
  assert.equal(setupStatusline({ claudeHome: claude, writer: W, home }).state, "no-claude");
  assert.ok(!existsSync(claude));
  mkdirSync(claude);
  writeFileSync(join(claude, "settings.json"), '{"theme":"dark"}');
  const dry = setupStatusline({ claudeHome: claude, writer: W, home, dry: true });
  assert.equal(dry.changed, false);
  assert.equal(readFileSync(join(claude, "settings.json"), "utf8"), '{"theme":"dark"}');
  const r = setupStatusline({ claudeHome: claude, writer: W, home });
  assert.equal(r.state, "missing");
  assert.ok(r.changed);
  assert.equal(readFileSync(join(claude, "settings.json.bak-herdr-dock"), "utf8"), '{"theme":"dark"}');
  assert.equal(JSON.parse(readFileSync(join(claude, "settings.json"), "utf8")).statusLine.command, `node "${W}"`);
  assert.equal(setupStatusline({ claudeHome: claude, writer: W, home }).state, "fed");
});

test("setupStatusline: a script with the writer line added by hand counts as fed", () => {
  const home = mkdtempSync(join(tmpdir(), "sls-"));
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeFileSync(join(claude, "s.sh"), 'input=$(cat)\nprintf %s "$input" | node ~/.claude/herdr-statusline-cache.mjs\n');
  writeFileSync(join(claude, "settings.json"), '{"statusLine":{"type":"command","command":"~/.claude/s.sh"}}');
  const r = setupStatusline({ claudeHome: claude, writer: W, home });
  assert.equal(r.state, "fed");
  assert.ok(!existsSync(join(claude, "settings.json.bak-herdr-dock")));
});

test("the wrapped command prints what the status line printed, and caches the limits", { skip: process.platform === "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "sls-"));
  const claude = join(home, ".claude");
  mkdirSync(claude);
  const own = join(claude, "s.sh");
  writeFileSync(own, '#!/bin/sh\njq -r .model.display_name\n');
  chmodSync(own, 0o755);
  writeFileSync(join(claude, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: own } }));
  setupStatusline({ claudeHome: claude, writer: WRITER, home });
  const command = JSON.parse(readFileSync(join(claude, "settings.json"), "utf8")).statusLine.command;
  const event = { session_id: "0123456789abcdef", model: { display_name: "Opus" }, rate_limits: { five_hour: { used_percentage: 30 } } };
  const r = spawnSync("sh", ["-c", command], { input: JSON.stringify(event), encoding: "utf8", env: { ...process.env, HOME: home } });
  if (spawnSync("jq", ["--version"]).status !== 0) return; // no jq here: the setup part above still ran
  assert.equal(r.stdout.trim(), "Opus");
  const cache = JSON.parse(readFileSync(join(claude, "statusline-cache", "claude-statusline.json"), "utf8"));
  assert.equal(cache.windows[0].used_percent, 30);
});

test("the bundled setup script runs from the CLI with --check", () => {
  const home = mkdtempSync(join(tmpdir(), "sls-"));
  mkdirSync(join(home, ".claude"));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "src/app/statusline-setup.js"), "--check", "--writer", WRITER],
    { encoding: "utf8", env: { ...process.env, DOCK_CLAUDE_HOME: join(home, ".claude") } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^missing: would add a status line/);
  assert.ok(!existsSync(join(home, ".claude", "settings.json")));
});

test("setupNotice: what Quotas says while there's no Claude reading", () => {
  assert.equal(setupNotice(null), null);
  assert.match(setupNotice("fed").text, /waiting for Claude Code's next reply/);
  assert.equal(setupNotice("fed").action, null);
  assert.equal(setupNotice("no-claude"), null);
  assert.equal(setupNotice("missing").action, "setup");
  assert.equal(setupNotice("other").action, "setup");
  assert.equal(setupNotice("complex").action, null);
  assert.equal(setupNotice("invalid").action, null);
  assert.equal(setupNotice("missing", { busy: true }).action, null);
  assert.equal(setupNotice("fed", { error: "boom" }).tip, "boom");
});

// ---- Antigravity: the same setup, its own settings file and writer ----
import { AGY_MARK } from "../src/shared/statusline.js";

test("statuslinePlan with Antigravity's mark: Claude's writer doesn't count as Antigravity's", () => {
  const AW = "/h/.config/herdr-app/mods/dock-quotas/herdr-agy-statusline.mjs";
  const text = JSON.stringify({ trustedWorkspaces: ["/p"] });
  const p = statuslinePlan(text, AW, [], AGY_MARK);
  assert.equal(p.state, "missing");
  assert.deepEqual(JSON.parse(p.text), { trustedWorkspaces: ["/p"], statusLine: { type: "command", command: `node "${AW}"` } });
  assert.equal(statuslinePlan(JSON.stringify({ statusLine: { command: `node "${AW}"` } }), AW, [], AGY_MARK).state, "fed");
  assert.equal(statuslinePlan(JSON.stringify({ statusLine: { command: "node ~/x/herdr-statusline-cache.mjs" } }), AW, [], AGY_MARK).state, "other");
});

test("setupStatusline for Antigravity: its settings get the agy writer, the rest kept; no folder, nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "sls-"));
  const dir = join(home, ".gemini", "antigravity-cli");
  const AW = "/h/mods/dock-quotas/herdr-agy-statusline.mjs";
  const agy = { claudeHome: dir, writer: AW, home, mark: AGY_MARK, name: "Antigravity" };
  assert.equal(setupStatusline(agy).state, "no-claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ trustedWorkspaces: ["/p"] }, null, 2));
  const r = setupStatusline(agy);
  assert.equal(r.state, "missing");
  assert.match(r.message, /Antigravity/);
  const s = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  assert.deepEqual(s.trustedWorkspaces, ["/p"]);
  assert.equal(s.statusLine.command, `node "${AW}"`);
  assert.equal(setupStatusline(agy).state, "fed");
});

test("the setup script's --agy targets Antigravity's settings with the agy writer beside it", () => {
  const home = mkdtempSync(join(tmpdir(), "sls-"));
  const dir = join(home, ".gemini", "antigravity-cli");
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "src/app/statusline-setup.js"), "--agy", "--check", "--writer", join(import.meta.dirname, "..", "scripts", "herdr-agy-statusline.mjs")],
    { encoding: "utf8", env: { ...process.env, DOCK_AGY_HOME: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^missing: would add a status line .*Antigravity/);
});

test("agySetupNotice: Antigravity's own wording and settings file", () => {
  const { agySetupNotice } = setupNoticeModule;
  assert.equal(agySetupNotice(null), null);
  assert.equal(agySetupNotice("no-claude"), null);
  assert.match(agySetupNotice("missing").text, /^Antigravity: status line not set up$/);
  assert.match(agySetupNotice("missing").tip, /agy/);
  assert.equal(agySetupNotice("missing").action, "setup");
  assert.match(agySetupNotice("fed").text, /waiting for an Antigravity session/);
  assert.equal(agySetupNotice("fed").action, null);
  assert.match(agySetupNotice("invalid").text, /antigravity-cli\/settings\.json/);
  assert.match(agySetupNotice("missing", { busy: true }).tip, /antigravity-cli/);
});

// Antigravity on Windows runs its statusLine command without a shell: it splits on whitespace and keeps quotes, so
// `node "C:/Users/Adam Cheng/..."` reached node as `"C:\Users\Adam`. A Windows path is never quoted, and one with a
// space is loaded through `node -e import("file:///...%20...")`, a single word.
import { agyWriterCommand } from "../src/shared/statusline.js";

test("agyWriterCommand: POSIX quoted as before; Windows unquoted, or a file-URL import when it has a space", () => {
  assert.equal(agyWriterCommand("/home/u/x/herdr-agy-statusline.mjs"), 'node "/home/u/x/herdr-agy-statusline.mjs"');
  assert.equal(agyWriterCommand("D:\\apps\\herdr\\herdr-agy-statusline.mjs"), "node D:/apps/herdr/herdr-agy-statusline.mjs");
  const c = agyWriterCommand("C:/Users/Adam Cheng/.config/herdr-app/mods/dock-quotas/herdr-agy-statusline.mjs");
  assert.equal(c, 'node -e import("file:///C:/Users/Adam%20Cheng/.config/herdr-app/mods/dock-quotas/herdr-agy-statusline.mjs")');
  assert.deepEqual(c.split(/\s+/).length, 3);
  assert.equal(agyWriterCommand("C:/a b/#1?/w.mjs"), 'node -e import("file:///C:/a%20b/%231%3F/w.mjs")');
});

test("statuslinePlan for Antigravity: a Windows path gets the shell-free command, and the old quoted one is rewritten", () => {
  const AW = "C:/Users/Adam Cheng/.config/herdr-app/mods/dock-quotas/herdr-agy-statusline.mjs";
  const p = statuslinePlan(JSON.stringify({ trustedWorkspaces: ["D:\p"] }), AW, [], AGY_MARK);
  assert.equal(p.state, "missing");
  assert.equal(JSON.parse(p.text).statusLine.command, agyWriterCommand(AW));
  const old = JSON.stringify({ trustedWorkspaces: ["D:\p"], statusLine: { type: "command", command: `node "${AW}"` } });
  const s = statuslinePlan(old, AW, [], AGY_MARK);
  assert.equal(s.state, "missing");
  assert.equal(s.stale, true);
  assert.deepEqual(JSON.parse(s.text), { trustedWorkspaces: ["D:\p"], statusLine: { type: "command", command: agyWriterCommand(AW) } });
  assert.equal(statuslinePlan(s.text, AW, [], AGY_MARK).state, "fed");
  // Claude Code runs its command through a shell: its quoted form stays.
  const CW = "C:/Users/Adam Cheng/.claude/herdr-statusline-cache.mjs";
  assert.equal(JSON.parse(statuslinePlan(null, CW).text).statusLine.command, `node "${CW}"`);
});

test("setupStatusline for Antigravity rewrites the old quoted Windows command and says so", () => {
  const home = mkdtempSync(join(tmpdir(), "sls-"));
  const dir = join(home, ".gemini", "antigravity-cli");
  mkdirSync(dir, { recursive: true });
  const AW = "C:/Users/Adam Cheng/mods/dock-quotas/herdr-agy-statusline.mjs";
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: `node "${AW}"` } }));
  const r = setupStatusline({ claudeHome: dir, writer: AW, home, mark: AGY_MARK, name: "Antigravity" });
  assert.equal(r.changed, true);
  assert.match(r.message, /^Fix herdr-dock's status line/);
  assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).statusLine.command, agyWriterCommand(AW));
});

test("the shell-free Antigravity command runs the writer from a folder with a space", { skip: process.platform !== "win32" && "a Windows path" }, () => {
  const home = mkdtempSync(join(tmpdir(), "sls home-"));
  const at = join(home, "w x", "herdr-agy-statusline.mjs").replace(/\\/g, "/");
  mkdirSync(join(home, "w x"));
  writeFileSync(at, 'process.stdout.write("ran:" + require("fs").readFileSync(0, "utf8"))'.replace('require("fs")', "(await import('node:fs'))"));
  const [, ...args] = agyWriterCommand(at).split(/\s+/);
  const r = spawnSync(process.execPath, args, { input: "{}", encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "ran:{}");
});
