// Installs what dock-browser needs: the pinned agent-browser binary, Chrome (unless a path is configured) and the
// dock-browser skill for the agent tools found on this machine. `npm run deploy` (a clone install) calls these
// functions; an app install runs this file bundled as mods/dock-browser/herdr-browser-setup.mjs:
//
//   node herdr-browser-setup.mjs [--app-home <dir>] [--check] [--remove] [--no-skills]
//
// Enabled (browser.enabled): install agent-browser, Chrome, the skills. Disabled or --remove: remove the skills this
// wrote and the binary folder. The signed-in profile is never touched. --check prints the state and changes nothing.
// The app home defaults to two folders above this script. Exit code 0 unless it failed.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import pins from "../shared/browser/pins.json" with { type: "json" };
import { tarFile } from "../shared/browser/tar.js";
import { BROWSER_REL, binRel } from "../shared/browser/session.js";
import { slashPath } from "../shared/path.js";
import { browserSettings } from "./browser-settings.js";

export const SKILL_MARK = "<!-- herdr-dock: dock-browser -->";
const SKILL_DIR = "dock-browser";
const CHROME_MARKER = `${BROWSER_REL}/chrome-installed`;

// {name, integrity, member} for this platform and CPU, or null when agent-browser has no build for it.
export function pinFor(platform, arch) {
  return pins.packages[`${platform}-${arch}`] ?? null;
}

const tarballUrl = (name, version) => `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;

export async function realFetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const readOrNull = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// -> "present" | "installed" | "unsupported". Verifies the whole .tgz against the pinned sha512 before it is unpacked.
export async function installAgentBrowser({ appHome, platform = process.platform, arch = process.arch, fetchBytes = realFetchBytes, dry = false, say = console.log }) {
  const pin = pinFor(platform, arch);
  if (!pin) { say(`agent-browser has no build for ${platform}-${arch}; the browser is not available here`); return "unsupported"; }
  const bin = join(appHome, binRel(platform));
  if (existsSync(bin) && readOrNull(`${bin}.version`)?.trim() === pins.version) {
    say(`agent-browser ${pins.version} already installed`);
    return "present";
  }
  const url = tarballUrl(pin.name, pins.version);
  if (dry) { say(`would download agent-browser ${pins.version} (${url}) to ${slashPath(bin)}`); return "installed"; }
  say(`downloading agent-browser ${pins.version} (about 20 MB)`);
  const bytes = await fetchBytes(url);
  const got = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (got !== pin.integrity) throw new Error(`agent-browser ${pins.version}: the download does not match the pinned checksum`);
  const file = tarFile(gunzipSync(bytes), pin.member);
  if (!file) throw new Error(`agent-browser ${pins.version}: ${pin.member} not found in the download`);
  mkdirSync(dirname(bin), { recursive: true });
  // Written beside, then renamed in, so a running agent-browser is never half-replaced.
  const tmp = `${bin}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, file);
    chmodSync(tmp, 0o755);
    renameSync(tmp, bin);
  } finally {
    rmSync(tmp, { force: true });
  }
  writeFileSync(`${bin}.version`, `${pins.version}\n`);
  say(`installed agent-browser ${pins.version} at ${slashPath(bin)}`);
  return "installed";
}

// -> "set" | "missing" | "present" | "installed" | "failed". `chrome` set: only checked. Empty: `<bin> install` (Chrome
// for Testing, about 150 MB) once; the marker file remembers it.
export function ensureChrome({ bin, chrome, run = (c, a) => spawnSync(c, a, { encoding: "utf8", stdio: "inherit", windowsHide: true }), say = console.log, dry = false }) {
  if (chrome) {
    if (existsSync(chrome)) { say(`Chrome: using ${slashPath(chrome)}`); return "set"; }
    say(`warning: browser.chrome is ${slashPath(chrome)}, which was not found`);
    return "missing";
  }
  const marker = join(dirname(dirname(dirname(dirname(bin)))), CHROME_MARKER);
  if (existsSync(marker)) { say("Chrome for Testing already installed"); return "present"; }
  if (dry) { say("would run agent-browser install (Chrome for Testing, about 150 MB)"); return "installed"; }
  say("installing Chrome for Testing (about 150 MB)");
  const r = run(bin, ["install"]);
  if (r.error || r.status !== 0) { say(`Chrome install failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}; set browser.chrome to an existing Chrome or Chromium, or run agent-browser install`); return "failed"; }
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, `${new Date().toISOString()}\n`);
  return "installed";
}

// Where each tool keeps user skills. Antigravity documents its global customizations under ~/.gemini/config
// (agy-customizations: "Global Discovery"), so its skills go to <that>/skills, and only when that folder exists.
// DOCK_CLAUDE_HOME / DOCK_CODEX_HOME / DOCK_AGY_HOME replace the tool folders (tests); DOCK_AGY_HOME is the one
// Antigravity's status line uses.
export function skillTargets({ home = homedir(), env = process.env } = {}) {
  const h = slashPath(home);
  const claude = env.DOCK_CLAUDE_HOME ? slashPath(env.DOCK_CLAUDE_HOME) : `${h}/.claude`;
  const codex = env.DOCK_CODEX_HOME ? slashPath(env.DOCK_CODEX_HOME) : `${h}/.codex`;
  const agy = env.DOCK_AGY_HOME ? slashPath(env.DOCK_AGY_HOME) : `${h}/.gemini/config`;
  return [
    { name: "Claude Code", dir: `${claude}/skills`, needs: claude },
    { name: "Codex", dir: `${codex}/skills`, needs: codex },
    { name: "Antigravity", dir: `${agy}/skills`, needs: `${agy}/skills` },
  ];
}

// Writes <dir>/dock-browser/SKILL.md where the tool's folder exists. -> { written: [names] }
export function installSkills({ targets, text, dry = false, say = console.log }) {
  const written = [];
  for (const t of targets) {
    if (!existsSync(t.needs)) {
      say(t.name === "Antigravity" ? `skill: Antigravity has no skills folder (${slashPath(t.dir)}); skipped` : `skill: no ${slashPath(t.needs)}; ${t.name} skipped`);
      continue;
    }
    const file = join(t.dir, SKILL_DIR, "SKILL.md");
    say(`${dry ? "would write" : "wrote"} skill for ${t.name}: ${slashPath(file)}`);
    if (!dry) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    written.push(t.name);
  }
  return { written };
}

// Deletes <dir>/dock-browser only when its SKILL.md is ours (starts with the marker line). -> { removed: [names] }
export function removeSkills({ targets, dry = false, say = console.log }) {
  const removed = [];
  for (const t of targets) {
    const dir = join(t.dir, SKILL_DIR);
    const text = readOrNull(join(dir, "SKILL.md"));
    if (text == null) continue;
    if (!text.split(/\r?\n/).some((l, i) => i < 8 && l.trim() === SKILL_MARK)) { say(`skill: ${slashPath(dir)} is not herdr-dock's; left alone`); continue; }
    say(`${dry ? "would remove" : "removed"} skill for ${t.name}: ${slashPath(dir)}`);
    if (!dry) rmSync(dir, { recursive: true, force: true });
    removed.push(t.name);
  }
  return { removed };
}

// The template with {{BROWSE}} replaced by the command that runs browse.mjs (a slash path).
export function skillText(template, { browse }) {
  return template.replaceAll("{{BROWSE}}", `node "${slashPath(browse)}"`);
}

// Removes the downloaded binary. The signed-in profile and the sessions are not touched.
export function removeBrowser({ appHome, dry = false, say = console.log }) {
  const dir = join(appHome, BROWSER_REL, "bin");
  if (!existsSync(dir)) return false;
  say(`${dry ? "would remove" : "removed"} ${slashPath(dir)}`);
  if (!dry) rmSync(dir, { recursive: true, force: true });
  return true;
}

const defaultIo = () => ({ out: (s) => console.log(s), err: (s) => console.error(s) });

// deps (tests): env, io, fetchBytes, run, template, platform, arch. -> exit code.
export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const io = deps.io ?? defaultIo();
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const at = argv.indexOf("--app-home");
  const here = dirname(fileURLToPath(import.meta.url));
  const appHome = resolve(at >= 0 && argv[at + 1] ? argv[at + 1] : join(here, "..", ".."));
  const check = argv.includes("--check");
  const cfg = browserSettings(slashPath(appHome));
  const enabled = cfg.enabled && !argv.includes("--remove");
  const targets = skillTargets({ env });
  const bin = join(appHome, binRel(platform));
  const say = (s) => io.out(check ? `[check] ${s}` : s);
  try {
    if (!enabled) {
      io.out(cfg.enabled ? "browser removal requested" : "browser is off (browser.enabled is false)");
      removeSkills({ targets, dry: check, say });
      removeBrowser({ appHome, dry: check, say });
      return 0;
    }
    const template = deps.template ?? readOrNull(join(here, "browser-skill.md"));
    const r = await installAgentBrowser({ appHome, platform, arch, fetchBytes: deps.fetchBytes, dry: check, say });
    if (r === "unsupported") return 0;
    const c = ensureChrome({ bin, chrome: cfg.chrome, run: deps.run, say, dry: check });
    if (argv.includes("--no-skills")) say("--no-skills: not writing the skill");
    else if (template == null) { io.err("no browser-skill.md beside this script; the skill was not written"); return 1; }
    else installSkills({ targets, text: skillText(template, { browse: join(appHome, "mods/dock-browser/browse.mjs") }), dry: check, say });
    return c === "failed" ? 1 : 0;
  } catch (e) {
    io.err(`browser setup failed: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
