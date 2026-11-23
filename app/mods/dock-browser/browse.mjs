// src/app/browse.js
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

// src/shared/browser/config.js
var DEFAULT_BROWSER = { enabled: false, chrome: "", production: [], handoffMinutes: 15 };
var isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var HOST_PATTERN = /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
function checkBrowser(value, where = "browser") {
  if (!isObj(value)) return `${where}: must be an object`;
  for (const [k, v] of Object.entries(value)) {
    const at = `${where}.${k}`;
    if (k === "enabled") {
      if (typeof v !== "boolean") return `${at}: must be true or false`;
    } else if (k === "chrome") {
      if (typeof v !== "string") return `${at}: must be a string`;
    } else if (k === "handoffMinutes") {
      if (!(Number.isInteger(v) && v > 0)) return `${at}: must be a positive integer`;
    } else if (k === "production") {
      if (!Array.isArray(v)) return `${at}: must be an array`;
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] !== "string" || !HOST_PATTERN.test(v[i])) return `${at}[${i}]: must be a host pattern like example.com or *.example.com`;
      }
    } else return `${at}: unknown setting`;
  }
  return null;
}
function browserOf(merged) {
  return { ...DEFAULT_BROWSER, ...isObj(merged?.browser) ? merged.browser : {} };
}
function withBrowserFeature(regions, enabled) {
  const out = {};
  for (const [name, r] of Object.entries(regions)) {
    out[name] = { ...r, features: enabled ? [...r.features] : r.features.filter((f) => f.mod !== "dock-browser") };
  }
  if (enabled && !Object.values(out).some((r) => r.features.some((f) => f.mod === "dock-browser"))) {
    out.right.features.push({ mod: "dock-browser" });
  }
  return out;
}

// src/shared/config.js
var REGION_NAMES = ["top", "left", "right", "bottom", "pages"];
var LEFT_MODES = ["expanded", "icons", "hidden"];
var LEFT_ONLY = ["dock-header", "dock-footer", "dock-spaces", "dock-agents", "dock-git", "dock-quotas", "dock-pages"];
var PAGE_ONLY = ["dock-overview", "dock-jira"];
var NEEDS_CORE = "dock-core draws the left-panel toggle, runs Ctrl+Alt+B and shows config errors, so it must stay in a shown top bar";
var isObj2 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function checkRegions(regions, where) {
  if (!isObj2(regions)) return `${where}: must be an object`;
  for (const [name, r] of Object.entries(regions)) {
    const at = `${where}.${name}`;
    if (!REGION_NAMES.includes(name)) return `${at}: unknown region`;
    if (!isObj2(r)) return `${at}: must be an object`;
    if (name === "pages" && "size" in r) return `${at}.size: a page fills the work area, it has no size`;
    if (name === "pages" && r.hidden === true) return `${at}.hidden: pages can't be hidden; remove them instead`;
    if ("size" in r && !(Number.isInteger(r.size) && r.size > 0)) return `${at}.size: must be a positive integer`;
    if ("hidden" in r && typeof r.hidden !== "boolean") return `${at}.hidden: must be a boolean`;
    if ("mode" in r) {
      if (name !== "left") return `${at}.mode: only the left region has a mode`;
      if (!LEFT_MODES.includes(r.mode)) return `${at}.mode: must be one of ${LEFT_MODES.join(", ")}`;
    }
    if (name === "top" && r.hidden === true) return `${at}.hidden: the top bar can't be hidden: ${NEEDS_CORE}`;
    if ("features" in r) {
      if (!Array.isArray(r.features)) return `${at}.features: must be an array`;
      for (let i = 0; i < r.features.length; i++) {
        const f = r.features[i];
        const fa = `${at}.features[${i}]`;
        if (!isObj2(f)) return `${fa}: must be an object`;
        if (typeof f.mod !== "string" || f.mod === "") return `${fa}.mod: must be a non-empty string`;
        if ("size" in f && !(Number.isInteger(f.size) && f.size > 0)) return `${fa}.size: must be a positive integer`;
        if (name === "pages" && "size" in f) return `${fa}.size: a page fills the work area, it has no size`;
        if ("props" in f && !isObj2(f.props)) return `${fa}.props: must be an object`;
        if ("drag" in f && typeof f.drag !== "boolean") return `${fa}.drag: must be true or false`;
        if (name !== "left" && LEFT_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.left`;
        if (name !== "pages" && PAGE_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.pages`;
      }
      if (name === "top" && !r.features.some((f) => f.mod === "dock-core")) return `${at}.features: must include dock-core: ${NEEDS_CORE}`;
    }
  }
  return null;
}
function parseConfig(text) {
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }
  if (!isObj2(c)) return { ok: false, error: "config: must be an object" };
  if (c.v !== 1) return { ok: false, error: `v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const err = checkRegions(c.regions ?? {}, "regions");
  if (err) return { ok: false, error: err };
  if (!Array.isArray(c.regions?.top?.features)) return { ok: false, error: `regions.top.features: must include dock-core: ${NEEDS_CORE}` };
  if ("browser" in c) {
    const be = checkBrowser(c.browser, "browser");
    if (be) return { ok: false, error: be };
  }
  if ("machines" in c) {
    if (!isObj2(c.machines)) return { ok: false, error: "machines: must be an object" };
    for (const [host, m] of Object.entries(c.machines)) {
      if (!isObj2(m)) return { ok: false, error: `machines.${host}: must be an object` };
      const e = checkRegions(m.regions ?? {}, `machines.${host}.regions`);
      if (e) return { ok: false, error: e };
      if ("browser" in m) {
        const be = checkBrowser(m.browser, `machines.${host}.browser`);
        if (be) return { ok: false, error: be };
      }
    }
  }
  return { ok: true, config: c };
}
function deepMerge(base, over) {
  if (!isObj2(base) || !isObj2(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}
function hostKey(machines, hostname2) {
  const host = String(hostname2).toLowerCase();
  return Object.keys(machines).find((k) => k.toLowerCase() === host);
}
function mergeForHost(config, hostname2, local = null) {
  const { machines = {}, ...base } = config;
  const key = hostKey(machines, hostname2);
  let merged = key ? deepMerge(base, machines[key]) : base;
  if (local) merged = deepMerge(merged, { regions: local.regions ?? {}, ..."browser" in local ? { browser: local.browser } : {} });
  const regions = {};
  for (const name of REGION_NAMES) {
    const r = merged.regions?.[name] ?? {};
    regions[name] = { ...r, features: r.features ?? [], hidden: r.hidden ?? false };
    if (name === "left") regions[name].mode = r.hidden === true ? "hidden" : r.mode ?? "expanded";
  }
  return { ...merged, regions: withBrowserFeature(regions, browserOf(merged).enabled) };
}
var LOCAL_REL = "herdr-dock/local.json";
function parseLocal(text) {
  if (text == null) return { ok: true, local: null };
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${LOCAL_REL}: Invalid JSON: ${e.message}` };
  }
  if (!isObj2(c)) return { ok: false, error: `${LOCAL_REL}: must be an object` };
  if (c.v !== 1) return { ok: false, error: `${LOCAL_REL}: v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const regions = c.regions ?? {};
  const err = checkRegions(regions, "regions");
  if (err) return { ok: false, error: `${LOCAL_REL}: ${err}` };
  if ("browser" in c) {
    const be = checkBrowser(c.browser, "browser");
    if (be) return { ok: false, error: `${LOCAL_REL}: ${be}` };
  }
  return { ok: true, local: { ...c, regions } };
}
function mergeWithLocal(config, hostname2, local) {
  const ok = isObj2(local) && local.v === 1 && !checkRegions(local.regions ?? {}, "regions") && !("browser" in local && checkBrowser(local.browser, "browser"));
  return mergeForHost(config, hostname2, ok ? local : null);
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/shared/install.js
var isText = (v) => typeof v === "string" && v.trim() !== "";
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function modeOf(src) {
  if (!isObject(src)) return null;
  if (isText(src.repo) || isText(src.config)) return "clone";
  if (src.mode === "app") return "app";
  return null;
}
function installOf(src, home) {
  const mode = modeOf(src);
  if (mode === "app") {
    return { mode, configPath: `${home}/mods/dock-core/config.json`, repo: null, versionPath: `${home}/mods/dock-core/VERSION.json` };
  }
  if (mode !== "clone" || !isText(src.config)) return null;
  const configPath = slashPath(src.config);
  const repo = isText(src.repo) ? slashPath(src.repo) : configPath.split("/").slice(0, -2).join("/");
  return { mode, configPath, repo, versionPath: null };
}

// src/shared/browser/args.js
var UsageError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
};
var need = (v, msg) => {
  if (!v) throw new UsageError(msg);
  return v;
};
function parseBrowse(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case void 0:
    case "help":
    case "--help":
    case "-h":
      return { cmd: "help" };
    case "wait":
    case "status":
    case "close":
      return { cmd };
    case "open": {
      let profile = "clean";
      const pos = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--profile") {
          profile = rest[++i];
          if (profile !== "clean" && profile !== "signed-in") throw new UsageError("--profile must be clean or signed-in");
        } else pos.push(rest[i]);
      }
      return { cmd, profile, url: need(pos[0], "usage: browse open [--profile clean|signed-in] <url>") };
    }
    case "action": {
      const args = rest[0] === "--" ? rest.slice(1) : rest;
      if (!args.length) throw new UsageError("usage: browse action -- <agent-browser command...>");
      return { cmd, args };
    }
    case "handoff":
      return { cmd, message: need(rest.join(" ").trim(), "usage: browse handoff <message>") };
    case "login":
      return { cmd, url: need(rest[0], "usage: browse login <url>") };
    case "window-open":
    case "window-done": {
      const i = rest.indexOf("--terminal");
      return { cmd, terminal: need(i >= 0 && rest[i + 1], `usage: browse ${cmd} --terminal <id>`) };
    }
    default:
      throw new UsageError(`unknown browse command: ${cmd}`);
  }
}
var REASONS = {
  close: "close is not allowed: the person's browser stays open (use `browse close` to end it)",
  connect: "connect is not allowed: this browser is managed by herdr-dock"
};
var FLAGS = ["--cdp", "--session", "--profile", "--state", "--auto-connect", "-p", "--provider"];
function refused(args) {
  const word = args.find((a) => !a.startsWith("-"));
  if (REASONS[word]) return REASONS[word];
  for (const a of args) {
    const flag = a.startsWith("--") ? a.split("=")[0] : a;
    if (FLAGS.includes(flag)) return `${flag} is not allowed: this browser is managed by herdr-dock`;
  }
  return null;
}

// src/shared/browser/hosts.js
function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(String(url ?? "").trim());
  if (!m) return null;
  let h = m[1].slice(m[1].lastIndexOf("@") + 1);
  h = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.replace(/:\d*$/, "");
  h = h.replace(/\.$/, "");
  return h ? h.toLowerCase() : null;
}
function isProduction(url, patterns) {
  const host = hostOf(url);
  if (!host) return null;
  for (const raw of patterns ?? []) {
    const p = String(raw).toLowerCase();
    if (p.startsWith("*.") ? host.endsWith(p.slice(1)) && host.length > p.length - 1 : host === p) return host;
  }
  return null;
}

// src/shared/browser/session.js
function sessionName(scope, terminal) {
  if (!terminal) throw new Error("sessionName: a terminal id is required");
  const tail = String(scope ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(-8);
  return `dock-${tail}-${terminal}`;
}
var BROWSER_REL = "herdr-dock/browser";
var sessionsRel = () => `${BROWSER_REL}/sessions`;
var sessionFileRel = (t) => `${sessionsRel()}/${t}.json`;
var controlFileRel = (t) => `${sessionsRel()}/${t}.control.json`;
var framesRel = (t) => `${BROWSER_REL}/frames/${t}`;
var signedInRel = () => `${BROWSER_REL}/profiles/signed-in.json`;
var binRel = (platform) => `${BROWSER_REL}/bin/agent-browser${platform === "win32" ? ".exe" : ""}`;
function normalizeUrl(input) {
  const s = String(input ?? "").trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data|blob|javascript|mailto):/i.test(s)) return s;
  if (/^[A-Za-z]:[\\/]/.test(s)) return `file:///${s.replace(/\\/g, "/")}`;
  if (s.startsWith("/")) return `file://${s}`;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-fA-F:]+\])(:\d+)?([/?#]|$)/i.test(s)) return `http://${s}`;
  return `https://${s}`;
}

// src/shared/browser/registry.js
var DEFAULT_CONTROL = { v: 1, takeover: null, answer: null };
var REASONS2 = ["person", "pick", "notes", "window"];
var VALUES = ["done", "cancel"];
var isObj3 = (x) => x && typeof x === "object" && !Array.isArray(x);
var isStr = (x) => typeof x === "string" && x !== "";
var created = (o) => Number.isFinite(o.terminalCreated) ? { terminalCreated: o.terminalCreated } : {};
function json(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
}
function parseSession(text) {
  const o = json(text);
  if (!isObj3(o) || !isStr(o.session) || !isStr(o.terminal)) return null;
  const h = o.handoff;
  const handoff = isObj3(h) && isStr(h.id) && Number.isFinite(h.since) ? { id: h.id, message: String(h.message ?? ""), since: h.since } : null;
  return {
    v: 1,
    session: o.session,
    terminal: o.terminal,
    profile: String(o.profile ?? ""),
    port: Number.isFinite(o.port) ? o.port : 0,
    url: String(o.url ?? ""),
    title: String(o.title ?? ""),
    opened: Number.isFinite(o.opened) ? o.opened : 0,
    handoff,
    ...created(o)
  };
}
function parseControl(text) {
  const o = json(text);
  if (!isObj3(o)) return { ...DEFAULT_CONTROL };
  const t = o.takeover, a = o.answer;
  return {
    v: 1,
    takeover: isObj3(t) && REASONS2.includes(t.reason) && Number.isFinite(t.since) ? { reason: t.reason, since: t.since } : null,
    answer: isObj3(a) && isStr(a.id) && VALUES.includes(a.value) ? { id: a.id, value: a.value } : null,
    ...created(o)
  };
}
var startHandoff = (session, message, now, id) => ({ ...session, handoff: { id, message, since: now } });
var clearHandoff = (session) => ({ ...session, handoff: null });
var limit = (m) => Number.isFinite(m) && m > 0 ? m : 15;
var expired = (h, now, minutes) => now - h.since > limit(minutes) * 6e4;
var isStale = (record, createdMs) => !record || !Number.isFinite(record.terminalCreated) || record.terminalCreated !== createdMs;
var answerOf = (session, control) => session.handoff && control.answer && control.answer.id === session.handoff.id ? control.answer.value : null;
function personHas(session, control, now, handoffMinutes) {
  if (control.takeover) return true;
  const h = session.handoff;
  return !!h && !answerOf(session, control) && !expired(h, now, handoffMinutes);
}
function waitOutcome(session, control, now, handoffMinutes) {
  const h = session.handoff;
  if (h) {
    const a = answerOf(session, control);
    if (a) return a;
    return expired(h, now, handoffMinutes) ? "timeout" : "waiting";
  }
  return control.takeover ? "waiting" : "free";
}
var goneSessions = (sessions, liveTerminals) => sessions.filter((s) => !liveTerminals.has(s.terminal));
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// src/app/browse.js
var USAGE = `browse: drive a real browser from this terminal.
  browse open [--profile clean|signed-in] <url>   open a page (the person sees it in the Browser panel)
  browse action -- <agent-browser command...>      snapshot, click, fill, ... (agent-browser's own commands)
  browse handoff "<message>"                       ask the person to do something in the page
  browse wait                                      wait for the person (at most 9 minutes per call)
  browse status                                    this terminal's browser
  browse close                                     end this terminal's browser
  browse login <url>                               the person signs in once; the signed-in profile keeps it`;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var num = (v, d) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d;
var tailOf = (scope) => String(scope ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(-8);
function run(cmd, args, opts = {}) {
  const win = process.platform === "win32";
  const go = (shell) => spawnSync(cmd, args, { encoding: "utf8", shell, windowsHide: true, ...opts });
  const r = go(win && /\.(cmd|bat)$/i.test(cmd));
  return win && r.error?.code === "ENOENT" ? go(true) : r;
}
var appHomeOf = (scriptUrl) => resolve(dirname(fileURLToPath(scriptUrl)), "..", "..");
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function writeAtomic(file, text, mode) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, mode ? { mode } : void 0);
  renameSync(tmp, file);
}
function browserSettings(home) {
  try {
    const src = JSON.parse(readText(join(home, "mods/dock-core/source.json")));
    const inst = installOf(src, home);
    const parsed = parseConfig(readText(inst.configPath));
    if (!parsed.ok) return browserOf(null);
    const local = parseLocal(readText(join(home, LOCAL_REL)));
    return browserOf(mergeWithLocal(parsed.config, hostname().toLowerCase(), local.ok ? local.local : null));
  } catch {
    return browserOf(null);
  }
}
async function main(argv, env = process.env, io = defaultIo()) {
  let args;
  try {
    args = parseBrowse(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(e.message);
      return 2;
    }
    throw e;
  }
  if (args.cmd === "help") {
    USAGE.split("\n").forEach((l) => io.out(l));
    return 0;
  }
  const home = env.DOCK_APP_HOME || appHomeOf(import.meta.url);
  const bin = env.DOCK_AGENT_BROWSER || join(home, binRel(process.platform));
  const cfg = browserSettings(home);
  const scope = env.HC_SCOPE ?? "";
  const abs = (rel) => join(home, rel);
  const needsTerminal = !["login", "window-open", "window-done"].includes(args.cmd);
  const terminal = args.terminal || env.HC_TERMINAL_ID || "";
  if (needsTerminal && !terminal) {
    io.err("browse runs inside a Herdr terminal (HC_TERMINAL_ID is not set)");
    return 2;
  }
  if (!existsSync(bin)) {
    io.err("agent-browser is not installed: set browser.enabled and run npm run deploy");
    return 2;
  }
  const ab = (session2, rest, opts) => run(bin, ["--session", session2, ...cfg.chrome ? ["--executable-path", cfg.chrome] : [], ...rest], { env, ...opts });
  const query = (session2, rest) => {
    const r = ab(session2, rest);
    return r.status === 0 ? String(r.stdout ?? "").trim() : "";
  };
  if (args.cmd === "login") return login(args, { io, ab, scope, abs });
  if (args.cmd === "window-open" || args.cmd === "window-done") return windowCmd(args, { io, ab, abs, terminal });
  const sessionFile = abs(sessionFileRel(terminal)), controlFile = abs(controlFileRel(terminal)), frames = abs(framesRel(terminal));
  const name = sessionName(scope, terminal);
  const readSession = () => {
    const t = readText(sessionFile);
    return t == null ? null : parseSession(t);
  };
  const wipe = () => {
    rmSync(sessionFile, { force: true });
    rmSync(controlFile, { force: true });
    rmSync(frames, { recursive: true, force: true });
  };
  const save = (rec) => writeAtomic(sessionFile, JSON.stringify(rec, null, 2) + "\n");
  let created2 = null;
  {
    const r = run(env.DOCK_HC || "hc", ["get", terminal], { env });
    if (!r.error && r.status === 0) {
      try {
        const c = JSON.parse(r.stdout).created_ms;
        if (Number.isFinite(c)) created2 = c;
      } catch {
      }
    }
  }
  let session = readSession();
  if (created2 != null && session && isStale(session, created2)) {
    ab(session.session, ["close"]);
    wipe();
    session = null;
  }
  const readControl = () => {
    const t = readText(controlFile);
    const c = parseControl(t);
    return t != null && created2 != null && isStale(c, created2) ? parseControl(null) : c;
  };
  const noSession = () => {
    io.err("no browser is open in this terminal: run browse open <url>");
    return 2;
  };
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
      try {
        port = Number(JSON.parse(query(name, ["stream", "status", "--json"])).data?.port) || 0;
      } catch {
      }
      save({
        v: 1,
        session: name,
        terminal,
        ...created2 != null ? { terminalCreated: created2 } : {},
        profile: args.profile,
        port,
        url: query(name, ["get", "url"]) || url,
        title: query(name, ["get", "title"]),
        opened: Date.now(),
        handoff: null
      });
      if (env.DOCK_SKIP_SWEEP !== "1") sweep(abs, bin, cfg, env);
      return 0;
    }
    case "action": {
      if (!session) return noSession();
      const why = refused(args.args);
      if (why) {
        io.err(why);
        return 2;
      }
      if (personHas(session, readControl(), Date.now(), cfg.handoffMinutes)) {
        io.err("the person has control; run browse wait");
        return 3;
      }
      const banner = (url2) => {
        if (isProduction(url2, cfg.production)) io.out(`PRODUCTION (${hostOf(url2)}): no probing, nothing that writes without the person.`);
      };
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
    case "wait":
      return waitFor({ session, readSession, readControl, save, ab, cfg, env, io, abs });
    case "status": {
      if (!session) {
        io.out("no browser is open in this terminal");
        return 0;
      }
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
  const poll = num(env.DOCK_BROWSE_POLL_MS, 500), limit2 = Date.now() + num(env.DOCK_BROWSE_WAIT_MS, 54e4);
  for (; ; ) {
    const cur = readSession();
    if (!cur) return 0;
    const outcome = waitOutcome(cur, readControl(), Date.now(), cfg.handoffMinutes);
    if (outcome === "free") return 0;
    if (outcome === "done") {
      save(clearHandoff(cur));
      if (cur.profile === "signed-in") saveState(ab, cur.session, abs(signedInRel()));
      return 0;
    }
    if (outcome === "cancel") {
      save(clearHandoff(cur));
      io.out("the person cancelled");
      return 1;
    }
    if (outcome === "timeout") {
      save(clearHandoff(cur));
      io.out(`nobody answered in ${cfg.handoffMinutes} minutes`);
      return 1;
    }
    if (Date.now() >= limit2) {
      io.out("still waiting; run browse wait again");
      return 4;
    }
    await sleep(poll);
  }
}
function saveState(ab, session, file) {
  mkdirSync(dirname(file), { recursive: true });
  const r = ab(session, ["state", "save", file]);
  if (r.status === 0) {
    try {
      chmodSync(file, 384);
    } catch {
    }
  }
  return r;
}
async function login(args, { io, ab, scope, abs }) {
  const session = `dock-login-${tailOf(scope)}`;
  const file = abs(signedInRel());
  ab(session, ["--headed", ...existsSync(file) ? ["--state", file] : [], "open", normalizeUrl(args.url)], { stdio: ["ignore", "inherit", "inherit"] });
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
  if (!rec) {
    io.err(`no browser session for ${t}`);
    return 2;
  }
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
function sweep(abs, bin, cfg, env) {
  try {
    const r = run("herdr-app", ["ls"], { env });
    if (r.error || r.status !== 0) return;
    const live = /* @__PURE__ */ new Set();
    for (const s of JSON.parse(r.stdout).spaces ?? []) for (const tab of s.tabs ?? []) for (const x of tab.terminals ?? []) live.add(x.terminal);
    const dir = abs(sessionsRel());
    const sessions = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".control.json")).map((f) => parseSession(readText(join(dir, f)))).filter(Boolean);
    for (const g of goneSessions(sessions, live)) {
      run(bin, ["--session", g.session, ...cfg.chrome ? ["--executable-path", cfg.chrome] : [], "close"], { env });
      rmSync(abs(sessionFileRel(g.terminal)), { force: true });
      rmSync(abs(controlFileRel(g.terminal)), { force: true });
      rmSync(abs(framesRel(g.terminal)), { recursive: true, force: true });
    }
  } catch {
  }
}
function defaultIo() {
  let rl = null;
  return {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    readLine: () => new Promise((res) => {
      rl = rl ?? createInterface({ input: process.stdin });
      rl.once("line", (l) => {
        rl.close();
        res(l);
      });
      rl.once("close", () => res(""));
    })
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  }).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
export {
  appHomeOf,
  main
};
