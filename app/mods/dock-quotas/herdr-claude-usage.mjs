#!/usr/bin/env node
// Asks your own `claude` CLI for your usage limits (the same numbers /usage shows) and prints them as one JSON line,
// for herdr-dock's Quotas. No status line needed, no token read: the CLI uses its own sign-in, and asking it costs no
// model usage. The idea comes from nozikov/herdr-usage-limits (MIT); this is a Node version, so it runs the same on
// Windows, macOS and Linux.
//
//   node herdr-claude-usage.mjs  ->  {"ok":true,"plan":"team","limits":{five_hour,seven_day,seven_day_opus,
//                                     seven_day_sonnet,model_scoped}}   or   {"ok":false,"error":"..."}
//
// Only the limits are passed on (utilization, resets_at, a model's display_name): nothing else from the CLI's answer.
// HERDR_DOCK_CLAUDE: the command to run instead of `claude` (tests); HERDR_DOCK_CLAUDE_TIMEOUT_MS: how long to wait.
import { spawn } from "node:child_process";

const REQUEST = { type: "control_request", request_id: "herdr-dock-usage", request: { subtype: "get_usage", skip_behaviors: true } };
const ARGS = ["-p", "--safe-mode", "--no-session-persistence", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
const TIMEOUT_MS = Number(process.env.HERDR_DOCK_CLAUDE_TIMEOUT_MS) || 20000;

const limit = (l) => (l && typeof l === "object" ? { utilization: l.utilization ?? null, resets_at: l.resets_at ?? null } : null);
function limitsOf(rl) {
  const r = rl && typeof rl === "object" ? rl : {};
  return {
    five_hour: limit(r.five_hour), seven_day: limit(r.seven_day),
    seven_day_opus: limit(r.seven_day_opus), seven_day_sonnet: limit(r.seven_day_sonnet),
    model_scoped: Array.isArray(r.model_scoped) ? r.model_scoped.map((m) => ({ display_name: String(m?.display_name ?? ""), ...limit(m) })) : [],
  };
}

let done = false;
function finish(out, child) {
  if (done) return;
  done = true;
  process.stdout.write(JSON.stringify(out) + "\n");
  try { child?.kill(); } catch {}
  process.exit(0);
}

const [command, ...pre] = (process.env.HERDR_DOCK_CLAUDE || "claude").split(" ").filter(Boolean);
let child;
try {
  // Windows installs claude as claude.cmd, which only a shell runs.
  child = spawn(command, [...pre, ...ARGS], { stdio: ["pipe", "pipe", "ignore"], shell: process.platform === "win32" && !process.env.HERDR_DOCK_CLAUDE, windowsHide: true });
} catch (e) {
  finish({ ok: false, error: `couldn't run claude: ${e.message}` });
}
child.on("error", (e) => finish({ ok: false, error: e.code === "ENOENT" ? "claude isn't installed (or not on PATH)" : `couldn't run claude: ${e.message}` }, child));
let buf = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line.includes('"control_response"')) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const res = msg?.response;
    if (res?.subtype !== "success") finish({ ok: false, error: String(res?.error ?? "claude couldn't read your usage") }, child);
    else finish({ ok: true, plan: res.response?.subscription_type ?? null, limits: limitsOf(res.response?.rate_limits) }, child);
  }
});
child.on("exit", () => finish({ ok: false, error: "claude gave no answer (is it logged in?)" }));
setTimeout(() => finish({ ok: false, error: `no answer from claude within ${Math.round(TIMEOUT_MS / 1000)}s` }, child), TIMEOUT_MS).unref?.();
child.stdin.on("error", () => {});
child.stdin.end(JSON.stringify(REQUEST) + "\n");
