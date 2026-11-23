// src/app/browser-install.js
import { chmodSync, existsSync, mkdirSync, readFileSync as readFileSync2, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join as join2, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

// src/shared/browser/pins.json
var pins_default = {
  version: "0.43.0",
  packages: {
    "linux-x64": { name: "@agent-browser/cli-linux-x64-gnu", integrity: "sha512-WY8vy2Saa3oRt6XEmz4Sae1W5qS9TjYcbX6IE+dxb8s2APfL9XyQjMHC6jBZrhwqDBIvUeTMCT/P2cq3XLPSBw==", member: "package/bin/agent-browser" },
    "linux-arm64": { name: "@agent-browser/cli-linux-arm64-gnu", integrity: "sha512-8DC234LGlXCn8A2YXGk6woy1uTjyexvtHd/TOQHLrV2sfUMZD647HTHEJyF+2z1J1oR34LaB5jqHJ9d0REC+Cw==", member: "package/bin/agent-browser" },
    "darwin-arm64": { name: "@agent-browser/cli-darwin-arm64", integrity: "sha512-HV6GP59IjNnowlrXR/5rVM8msPWwQDEONt/tWC8STzUfKZQHKZI/Iv9sf2h2ZhwK8xwoqLhxpf+KxcFgJ0sExQ==", member: "package/bin/agent-browser" },
    "darwin-x64": { name: "@agent-browser/cli-darwin-x64", integrity: "sha512-3NKnKFOWLYDYTz4bJxo4jt+GwjM4VtcW5FDrQY35eUrytig65FEDdXmXKuRbZGq9jEEWxh6rmpS4R6xS53XCaw==", member: "package/bin/agent-browser" },
    "win32-x64": { name: "@agent-browser/cli-win32-x64-msvc", integrity: "sha512-xhk8wnHk3aiBFSR0pd1Ye3ay2jKjgRardgBJLiB9nXJv0ZkbeP/wh3X7jMiKUfUGE1qqJrKdaM5szQ6iz8/8+w==", member: "package/bin/agent-browser.exe" }
  }
};

// src/shared/browser/tar.js
var dec = new TextDecoder();
var field = (b, from, to) => {
  const s = b.subarray(from, to);
  const z = s.indexOf(0);
  return dec.decode(z < 0 ? s : s.subarray(0, z));
};
function tarFile(tar, member) {
  for (let at = 0; at + 512 <= tar.length; ) {
    const head = tar.subarray(at, at + 512);
    if (head.every((x) => x === 0)) return null;
    const name = field(head, 0, 100);
    const prefix = field(head, 345, 500);
    const size = parseInt(field(head, 124, 136).trim() || "0", 8);
    if (!Number.isFinite(size)) return null;
    const start = at + 512;
    if ((prefix ? `${prefix}/${name}` : name) === member) return start + size <= tar.length ? tar.subarray(start, start + size) : null;
    at = start + Math.ceil(size / 512) * 512;
  }
  return null;
}

// src/shared/browser/session.js
var BROWSER_REL = "herdr-dock/browser";
var binRel = (platform) => `${BROWSER_REL}/bin/agent-browser${platform === "win32" ? ".exe" : ""}`;

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/app/browser-settings.js
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

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

// src/app/browser-settings.js
var readText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
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

// src/app/browser-install.js
var SKILL_MARK = "<!-- herdr-dock: dock-browser -->";
var SKILL_DIR = "dock-browser";
var CHROME_MARKER = `${BROWSER_REL}/chrome-installed`;
function pinFor(platform, arch) {
  return pins_default.packages[`${platform}-${arch}`] ?? null;
}
var tarballUrl = (name, version) => `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;
async function realFetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
var readOrNull = (p) => {
  try {
    return readFileSync2(p, "utf8");
  } catch {
    return null;
  }
};
async function installAgentBrowser({ appHome, platform = process.platform, arch = process.arch, fetchBytes = realFetchBytes, dry = false, say = console.log }) {
  const pin = pinFor(platform, arch);
  if (!pin) {
    say(`agent-browser has no build for ${platform}-${arch}; the browser is not available here`);
    return "unsupported";
  }
  const bin = join2(appHome, binRel(platform));
  if (existsSync(bin) && readOrNull(`${bin}.version`)?.trim() === pins_default.version) {
    say(`agent-browser ${pins_default.version} already installed`);
    return "present";
  }
  const url = tarballUrl(pin.name, pins_default.version);
  if (dry) {
    say(`would download agent-browser ${pins_default.version} (${url}) to ${slashPath(bin)}`);
    return "installed";
  }
  say(`downloading agent-browser ${pins_default.version} (about 20 MB)`);
  const bytes = await fetchBytes(url);
  const got = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (got !== pin.integrity) throw new Error(`agent-browser ${pins_default.version}: the download does not match the pinned checksum`);
  const file = tarFile(gunzipSync(bytes), pin.member);
  if (!file) throw new Error(`agent-browser ${pins_default.version}: ${pin.member} not found in the download`);
  mkdirSync(dirname(bin), { recursive: true });
  const tmp = `${bin}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, file);
    chmodSync(tmp, 493);
    renameSync(tmp, bin);
  } finally {
    rmSync(tmp, { force: true });
  }
  writeFileSync(`${bin}.version`, `${pins_default.version}
`);
  say(`installed agent-browser ${pins_default.version} at ${slashPath(bin)}`);
  return "installed";
}
function ensureChrome({ bin, chrome, run = (c, a) => spawnSync(c, a, { encoding: "utf8", stdio: "inherit", windowsHide: true }), say = console.log, dry = false }) {
  if (chrome) {
    if (existsSync(chrome)) {
      say(`Chrome: using ${slashPath(chrome)}`);
      return "set";
    }
    say(`warning: browser.chrome is ${slashPath(chrome)}, which was not found`);
    return "missing";
  }
  const marker = join2(dirname(dirname(dirname(dirname(bin)))), CHROME_MARKER);
  if (existsSync(marker)) {
    say("Chrome for Testing already installed");
    return "present";
  }
  if (dry) {
    say("would run agent-browser install (Chrome for Testing, about 150 MB)");
    return "installed";
  }
  say("installing Chrome for Testing (about 150 MB)");
  const r = run(bin, ["install"]);
  if (r.error || r.status !== 0) {
    say(`Chrome install failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}; set browser.chrome to an existing Chrome or Chromium, or run agent-browser install`);
    return "failed";
  }
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, `${(/* @__PURE__ */ new Date()).toISOString()}
`);
  return "installed";
}
function skillTargets({ home = homedir(), env = process.env } = {}) {
  const h = slashPath(home);
  const claude = env.DOCK_CLAUDE_HOME ? slashPath(env.DOCK_CLAUDE_HOME) : `${h}/.claude`;
  const codex = env.DOCK_CODEX_HOME ? slashPath(env.DOCK_CODEX_HOME) : `${h}/.codex`;
  const agy = env.DOCK_AGY_HOME ? slashPath(env.DOCK_AGY_HOME) : `${h}/.gemini/config`;
  return [
    { name: "Claude Code", dir: `${claude}/skills`, needs: claude },
    { name: "Codex", dir: `${codex}/skills`, needs: codex },
    { name: "Antigravity", dir: `${agy}/skills`, needs: `${agy}/skills` }
  ];
}
function installSkills({ targets, text, dry = false, say = console.log }) {
  const written = [];
  for (const t of targets) {
    if (!existsSync(t.needs)) {
      say(t.name === "Antigravity" ? `skill: Antigravity has no skills folder (${slashPath(t.dir)}); skipped` : `skill: no ${slashPath(t.needs)}; ${t.name} skipped`);
      continue;
    }
    const file = join2(t.dir, SKILL_DIR, "SKILL.md");
    say(`${dry ? "would write" : "wrote"} skill for ${t.name}: ${slashPath(file)}`);
    if (!dry) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    written.push(t.name);
  }
  return { written };
}
function removeSkills({ targets, dry = false, say = console.log }) {
  const removed = [];
  for (const t of targets) {
    const dir = join2(t.dir, SKILL_DIR);
    const text = readOrNull(join2(dir, "SKILL.md"));
    if (text == null) continue;
    if (!text.split(/\r?\n/).some((l, i) => i < 8 && l.trim() === SKILL_MARK)) {
      say(`skill: ${slashPath(dir)} is not herdr-dock's; left alone`);
      continue;
    }
    say(`${dry ? "would remove" : "removed"} skill for ${t.name}: ${slashPath(dir)}`);
    if (!dry) rmSync(dir, { recursive: true, force: true });
    removed.push(t.name);
  }
  return { removed };
}
function skillText(template, { browse }) {
  return template.replaceAll("{{BROWSE}}", `node "${slashPath(browse)}"`);
}
function removeBrowser({ appHome, dry = false, say = console.log }) {
  const dir = join2(appHome, BROWSER_REL, "bin");
  if (!existsSync(dir)) return false;
  say(`${dry ? "would remove" : "removed"} ${slashPath(dir)}`);
  if (!dry) rmSync(dir, { recursive: true, force: true });
  return true;
}
var defaultIo = () => ({ out: (s) => console.log(s), err: (s) => console.error(s) });
async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const io = deps.io ?? defaultIo();
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const at = argv.indexOf("--app-home");
  const here = dirname(fileURLToPath(import.meta.url));
  const appHome = resolve(at >= 0 && argv[at + 1] ? argv[at + 1] : join2(here, "..", ".."));
  const check = argv.includes("--check");
  const cfg = browserSettings(slashPath(appHome));
  const enabled = cfg.enabled && !argv.includes("--remove");
  const targets = skillTargets({ env });
  const bin = join2(appHome, binRel(platform));
  const say = (s) => io.out(check ? `[check] ${s}` : s);
  try {
    if (!enabled) {
      io.out(cfg.enabled ? "browser removal requested" : "browser is off (browser.enabled is false)");
      removeSkills({ targets, dry: check, say });
      removeBrowser({ appHome, dry: check, say });
      return 0;
    }
    const template = deps.template ?? readOrNull(join2(here, "browser-skill.md"));
    const r = await installAgentBrowser({ appHome, platform, arch, fetchBytes: deps.fetchBytes, dry: check, say });
    if (r === "unsupported") return 0;
    const c = ensureChrome({ bin, chrome: cfg.chrome, run: deps.run, say, dry: check });
    if (argv.includes("--no-skills")) say("--no-skills: not writing the skill");
    else if (template == null) {
      io.err("no browser-skill.md beside this script; the skill was not written");
      return 1;
    } else installSkills({ targets, text: skillText(template, { browse: join2(appHome, "mods/dock-browser/browse.mjs") }), dry: check, say });
    return c === "failed" ? 1 : 0;
  } catch (e) {
    io.err(`browser setup failed: ${e.message}`);
    return 1;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
export {
  SKILL_MARK,
  ensureChrome,
  installAgentBrowser,
  installSkills,
  main,
  pinFor,
  realFetchBytes,
  removeBrowser,
  removeSkills,
  skillTargets,
  skillText
};
