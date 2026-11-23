// browse: the command an agent in a Herdr terminal drives a real browser with. A thin wrapper over agent-browser
// (one daemon per --session): it names the session after the terminal, keeps a small record the Browser panel reads
// (herdr-dock/browser/sessions/<terminal>.json), and keeps the agent out of the way while the person has the page.
// Bundled into mods/dock-browser/browse.mjs. Exit codes: 0 ok, 1 cancelled or handoff timed out, 2 usage/refused/no
// Herdr terminal, 3 the person has control, 4 still waiting at the limit, otherwise agent-browser's own code.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { mergeWithLocal, parseConfig, parseLocal, LOCAL_REL } from "../shared/config.js";
import { installOf } from "../shared/install.js";
import { browserOf } from "../shared/browser/config.js";
import { UsageError, parseBrowse, refused } from "../shared/browser/args.js";
import { isProduction, hostOf } from "../shared/browser/hosts.js";
import { BROWSER_REL, binRel, controlFileRel, framesRel, normalizeUrl, sessionFileRel, sessionName, sessionsRel, signedInRel } from "../shared/browser/session.js";
import {
  clearHandoff, goneSessions, isStale, newId, parseControl, parseSession, personHas, startHandoff, waitOutcome,
} from "../shared/browser/registry.js";

const USAGE = `browse: drive a real browser from this terminal.
  browse open [--profile clean|signed-in] <url>   open a page (the person sees it in the Browser panel)
  browse action -- <agent-browser command...>      snapshot, click, fill, ... (agent-browser's own commands)
  browse handoff "<message>"                       ask the person to do something in the page
  browse wait                                      wait for the person (at most 9 minutes per call)
  browse status                                    this terminal's browser
  browse close                                     end this terminal's browser
  browse login <url>                               the person signs in once; the signed-in profile keeps it`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const tailOf = (scope) => String(scope ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(-8);

// Runs a program; .cmd/.bat shims (Windows) need a shell.
function run(cmd, args, opts = {}) {
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
  return spawnSync(cmd, args, { encoding: "utf8", shell, windowsHide: true, ...opts });
}

function readText(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

// Write atomically: a reader never sees half a file.
function writeAtomic(file, text, mode) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, mode ? { mode } : undefined);
  renameSync(tmp, file);
}

// browser settings from the merged config (dock-core's source.json -> config, plus the local file); defaults if unreadable.
function browserSettings(home) {
  try {
    const src = JSON.parse(readText(join(home, "mods/dock-core/source.json")));
    const inst = installOf(src, home);
    const parsed = parseConfig(readText(inst.configPath));
    if (!parsed.ok) return browserOf(null);
    const local = parseLocal(readText(join(home, LOCAL_REL)));
    return browserOf(mergeWithLocal(parsed.config, hostname().toLowerCase(), local.ok ? local.local : null));
  } catch { return browserOf(null); }
}

export async function main(argv, env = process.env, io = defaultIo()) {
  let args;
  try { args = parseBrowse(argv); } catch (e) {
    if (e instanceof UsageError) { io.err(e.message); return 2; }
    throw e;
  }
  if (args.cmd === "help") { USAGE.split("\n").forEach((l) => io.out(l)); return 0; }

  const home = env.DOCK_APP_HOME || resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const bin = env.DOCK_AGENT_BROWSER || join(home, binRel(process.platform));
  const cfg = browserSettings(home);
  const scope = env.HC_SCOPE ?? "";
  const abs = (rel) => join(home, rel);

  const needsTerminal = !["login", "window-open", "window-done"].includes(args.cmd);
  const terminal = args.terminal || env.HC_TERMINAL_ID || "";
  if (needsTerminal && !terminal) { io.err("browse runs inside a Herdr terminal (HC_TERMINAL_ID is not set)"); return 2; }
  if (!existsSync(bin)) { io.err("agent-browser is not installed: set browser.enabled and run npm run deploy"); return 2; }

  // agent-browser for one session.
  const ab = (session, rest, opts) => run(bin, ["--session", session, ...(cfg.chrome ? ["--executable-path", cfg.chrome] : []), ...rest], { env, ...opts });
  const query = (session, rest) => { const r = ab(session, rest); return r.status === 0 ? String(r.stdout ?? "").trim() : ""; };

  // login and the panel's window commands don't need the stale check.
  if (args.cmd === "login") return login(args, { io, ab, scope, abs });
  if (args.cmd === "window-open" || args.cmd === "window-done") return windowCmd(args, { io, ab, abs, terminal });

  const sessionFile = abs(sessionFileRel(terminal)), controlFile = abs(controlFileRel(terminal)), frames = abs(framesRel(terminal));
  const name = sessionName(scope, terminal);
  const readSession = () => { const t = readText(sessionFile); return t == null ? null : parseSession(t); };
  const wipe = () => { rmSync(sessionFile, { force: true }); rmSync(controlFile, { force: true }); rmSync(frames, { recursive: true, force: true }); };
  const save = (rec) => writeAtomic(sessionFile, JSON.stringify(rec, null, 2) + "\n");

  // The terminal's own creation time: a reused id (an older terminal's records) must start clean.
  let created = null;
  {
    const r = run(env.DOCK_HC || "hc", ["get", terminal], { env });
    if (!r.error && r.status === 0) {
      try { const c = JSON.parse(r.stdout).created_ms; if (Number.isFinite(c)) created = c; } catch {}
    }
  }
  let session = readSession();
  if (created != null && session && isStale(session, created)) {
    ab(session.session, ["close"]);
    wipe();
    session = null;
  }
  const readControl = () => {
    const t = readText(controlFile);
    const c = parseControl(t);
    return t != null && created != null && isStale(c, created) ? parseControl(null) : c;
  };
  const noSession = () => { io.err("no browser is open in this terminal: run browse open <url>"); return 2; };

  switch (args.cmd) {
    case "open": {
      const url = normalizeUrl(args.url);
      if (session && session.profile !== args.profile) {
        ab(session.session, ["close"]);
        io.out(`restarted the browser on the ${args.profile} profile`);
      }
      const state = abs(signedInRel());
      const launch = args.profile === "signed-in" && existsSync(state) ? ["--state", state] : [];
      const r = ab(name, [...launch, "open", url], { stdio: ["ignore", "inherit", "inherit"] });
      if (r.status !== 0) return r.status ?? 2;
      let port = 0;
      try { port = Number(JSON.parse(query(name, ["stream", "status", "--json"])).data?.port) || 0; } catch {}
      save({
        v: 1, session: name, terminal, ...(created != null ? { terminalCreated: created } : {}), profile: args.profile, port,
        url: query(name, ["get", "url"]) || url, title: query(name, ["get", "title"]), opened: Date.now(), handoff: null,
      });
      if (env.DOCK_SKIP_SWEEP !== "1") sweep(abs, bin, cfg, env);
      return 0;
    }
    case "action": {
      if (!session) return noSession();
      const why = refused(args.args);
      if (why) { io.err(why); return 2; }
      if (personHas(session, readControl(), Date.now(), cfg.handoffMinutes)) { io.err("the person has control; run browse wait"); return 3; }
      const banner = (url) => { if (isProduction(url, cfg.production)) io.out(`PRODUCTION (${hostOf(url)}): no probing, nothing that writes without the person.`); };
      banner(session.url);
      const r = ab(session.session, args.args, { stdio: "inherit" });
      const url = query(session.session, ["get", "url"]);
      if (url && url !== session.url) {
        if (!isProduction(session.url, cfg.production)) banner(url);
        const cur = readSession();
        if (cur) save({ ...cur, url });
      }
      return r.status ?? 1;
    }
    case "handoff": {
      if (!session) return noSession();
      save(startHandoff(session, args.message, Date.now(), newId()));
      io.out("waiting for the person: run browse wait");
      return 0;
    }
    case "wait": return waitFor({ session, readSession, readControl, save, ab, cfg, env, io, abs });
    case "status": {
      if (!session) { io.out("no browser is open in this terminal"); return 0; }
      io.out(session.session);
      io.out(session.profile);
      io.out(session.url);
      io.out(`person has control: ${personHas(session, readControl(), Date.now(), cfg.handoffMinutes) ? "yes" : "no"}`);
      return 0;
    }
    case "close": {
      ab(session?.session ?? name, ["close"]);
      wipe();
      return 0;
    }
  }
  return 2;
}

async function waitFor({ session, readSession, readControl, save, ab, cfg, env, io, abs }) {
  if (!session) return 0;
  const poll = num(env.DOCK_BROWSE_POLL_MS, 500), limit = Date.now() + num(env.DOCK_BROWSE_WAIT_MS, 540000);
  for (;;) {
    const cur = readSession();
    if (!cur) return 0;
    const outcome = waitOutcome(cur, readControl(), Date.now(), cfg.handoffMinutes);
    if (outcome === "free") return 0;
    if (outcome === "done") {
      save(clearHandoff(cur));
      if (cur.profile === "signed-in") saveState(ab, cur.session, abs(signedInRel()));
      return 0;
    }
    if (outcome === "cancel") { save(clearHandoff(cur)); io.out("the person cancelled"); return 1; }
    if (outcome === "timeout") { save(clearHandoff(cur)); io.out(`nobody answered in ${cfg.handoffMinutes} minutes`); return 1; }
    if (Date.now() >= limit) { io.out("still waiting; run browse wait again"); return 4; }
    await sleep(poll);
  }
}

// Saved state holds cookies: only the person's account reads it.
function saveState(ab, session, file) {
  mkdirSync(dirname(file), { recursive: true });
  const r = ab(session, ["state", "save", file]);
  if (r.status === 0) { try { chmodSync(file, 0o600); } catch {} }
  return r;
}

async function login(args, { io, ab, scope, abs }) {
  const session = `dock-login-${tailOf(scope)}`;
  const file = abs(signedInRel());
  ab(session, ["--headed", ...(existsSync(file) ? ["--state", file] : []), "open", normalizeUrl(args.url)], { stdio: ["ignore", "inherit", "inherit"] });
  io.out("Sign in in the window, then press Enter here.");
  await io.readLine();
  const r = saveState(ab, session, file);
  ab(session, ["close"]);
  return r.status ?? 0;
}

function windowCmd(args, { io, ab, abs, terminal }) {
  const t = args.terminal;
  const text = readText(abs(sessionFileRel(t)));
  const rec = text == null ? null : parseSession(text);
  if (!rec) { io.err(`no browser session for ${t}`); return 2; }
  const tmpDir = abs(`${BROWSER_REL}/tmp`);
  const out = join(tmpDir, `${t}.json`), done = join(tmpDir, `${t}.done.json`);
  const real = `${rec.session}-real`;
  mkdirSync(tmpDir, { recursive: true });
  if (args.cmd === "window-open") {
    saveState(ab, rec.session, out);
    return ab(real, ["--headed", "--state", out, "open", rec.url], { stdio: ["ignore", "inherit", "inherit"] }).status ?? 0;
  }
  saveState(ab, real, done);
  ab(real, ["close"]);
  ab(rec.session, ["state", "load", done]);
  ab(rec.session, ["reload"]);
  rmSync(out, { force: true });
  rmSync(done, { force: true });
  return 0;
}

// Sessions whose terminal is gone: closed and forgotten. Skipped when herdr-app can't say who is alive.
function sweep(abs, bin, cfg, env) {
  try {
    const r = run("herdr-app", ["ls"], { env });
    if (r.error || r.status !== 0) return;
    const live = new Set();
    for (const s of JSON.parse(r.stdout).spaces ?? []) for (const tab of s.tabs ?? []) for (const x of tab.terminals ?? []) live.add(x.terminal);
    const dir = abs(sessionsRel());
    const sessions = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".control.json"))
      .map((f) => parseSession(readText(join(dir, f)))).filter(Boolean);
    for (const g of goneSessions(sessions, live)) {
      run(bin, ["--session", g.session, ...(cfg.chrome ? ["--executable-path", cfg.chrome] : []), "close"], { env });
      rmSync(abs(sessionFileRel(g.terminal)), { force: true });
      rmSync(abs(controlFileRel(g.terminal)), { force: true });
      rmSync(abs(framesRel(g.terminal)), { recursive: true, force: true });
    }
  } catch {}
}

function defaultIo() {
  let rl = null;
  return {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    readLine: () => new Promise((res) => {
      rl = rl ?? createInterface({ input: process.stdin });
      rl.once("line", (l) => { rl.close(); res(l); });
      rl.once("close", () => res(""));
    }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; }).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
