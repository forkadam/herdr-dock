import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { tarFile } from "../src/shared/browser/tar.js";
import pins from "../src/shared/browser/pins.json" with { type: "json" };
import {
  SKILL_MARK, ensureChrome, installAgentBrowser, installSkills, main, pinFor, removeBrowser, removeSkills, skillTargets, skillText, writeSetupResult,
} from "../src/app/browser-install.js";
import { SETUP_RESULT_REL, endResult } from "../src/shared/browser/setup-result.js";

const tmp = () => mkdtempSync(join(tmpdir(), "dock-bi-"));
const enc = new TextEncoder();

// A ustar entry: 512-byte header + data padded to 512.
function entry(name, data, prefix = "") {
  const h = new Uint8Array(512);
  h.set(enc.encode(name), 0);
  h.set(enc.encode(data.length.toString(8).padStart(11, "0")), 124);
  h.set(enc.encode(prefix), 345);
  const body = new Uint8Array(Math.ceil(data.length / 512) * 512);
  body.set(data);
  return Buffer.concat([h, body]);
}
const tarOf = (...entries) => Buffer.concat([...entries, Buffer.alloc(1024)]);
const integrityOf = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

test("tarFile finds a member, one named through the prefix field, and returns null for a missing one", () => {
  const tar = tarOf(entry("a.txt", enc.encode("hello")), entry("bin/agent-browser", enc.encode("BIN"), "package"));
  assert.equal(new TextDecoder().decode(tarFile(tar, "a.txt")), "hello");
  assert.equal(new TextDecoder().decode(tarFile(tar, "package/bin/agent-browser")), "BIN");
  assert.equal(tarFile(tar, "nope"), null);
  assert.equal(tarFile(new Uint8Array(0), "a"), null);
});

test("pins: version 0.43.0 and every package has an integrity and a member", () => {
  assert.equal(pins.version, "0.43.0");
  for (const p of Object.values(pins.packages)) assert.match(p.integrity, /^sha512-/), assert.ok(p.member && p.name);
  assert.equal(pinFor("linux", "x64").name, "@agent-browser/cli-linux-x64-gnu");
  assert.equal(pinFor("win32", "x64").member, "package/bin/agent-browser.exe");
  assert.equal(pinFor("freebsd", "x64"), null);
  assert.equal(pinFor("linux", "ia32"), null);
});

// A fake download for linux-x64 with the real pin's shape but a test integrity.
function fakeDownload(binBytes = enc.encode("#!fake agent-browser")) {
  const member = pinFor("linux", "x64").member;
  const [dir, ...rest] = member.split("/");
  const tgz = gzipSync(tarOf(entry(rest.join("/"), binBytes, dir)));
  return { tgz, binBytes, integrity: integrityOf(tgz) };
}
const withPin = (integrity, fn) => {
  const saved = pins.packages["linux-x64"].integrity;
  pins.packages["linux-x64"].integrity = integrity;
  return Promise.resolve(fn()).finally(() => { pins.packages["linux-x64"].integrity = saved; });
};

test("installAgentBrowser: wrong integrity throws and writes nothing", async () => {
  const home = tmp();
  const { tgz } = fakeDownload();
  await assert.rejects(
    installAgentBrowser({ appHome: home, platform: "linux", arch: "x64", fetchBytes: async () => tgz, say: () => {} }),
    /agent-browser 0\.43\.0: the download does not match the pinned checksum/);
  assert.equal(existsSync(join(home, "herdr-dock/browser/bin")), false);
});

test("installAgentBrowser: right integrity writes the binary and .version; a second run is present without fetching", async () => {
  const home = tmp();
  const { tgz, binBytes, integrity } = fakeDownload();
  const urls = [];
  await withPin(integrity, async () => {
    const r = await installAgentBrowser({ appHome: home, platform: "linux", arch: "x64", fetchBytes: async (u) => (urls.push(u), tgz), say: () => {} });
    assert.equal(r, "installed");
    const bin = join(home, "herdr-dock/browser/bin/agent-browser");
    assert.ok(readFileSync(bin).equals(binBytes));
    assert.equal(readFileSync(`${bin}.version`, "utf8").trim(), "0.43.0");
    if (process.platform !== "win32") assert.equal(statSync(bin).mode & 0o777, 0o755);
    assert.deepEqual(urls, ["https://registry.npmjs.org/@agent-browser/cli-linux-x64-gnu/-/cli-linux-x64-gnu-0.43.0.tgz"]);
    const again = await installAgentBrowser({ appHome: home, platform: "linux", arch: "x64", fetchBytes: async () => { throw new Error("fetched"); }, say: () => {} });
    assert.equal(again, "present");
  });
});

test("installAgentBrowser: dry run fetches and writes nothing; unknown platform is unsupported", async () => {
  const home = tmp();
  const fetchBytes = async () => { throw new Error("fetched"); };
  const lines = [];
  assert.equal(await installAgentBrowser({ appHome: home, platform: "linux", arch: "x64", fetchBytes, dry: true, say: (s) => lines.push(s) }), "installed");
  assert.match(lines.join("\n"), /would download agent-browser 0\.43\.0/);
  assert.equal(existsSync(join(home, "herdr-dock")), false);
  assert.equal(await installAgentBrowser({ appHome: home, platform: "sunos", arch: "x64", fetchBytes, say: () => {} }), "unsupported");
});

test("installAgentBrowser: a stale version is replaced", async () => {
  const home = tmp();
  const bin = join(home, "herdr-dock/browser/bin/agent-browser");
  mkdirSync(join(home, "herdr-dock/browser/bin"), { recursive: true });
  writeFileSync(bin, "old"); writeFileSync(`${bin}.version`, "0.1.0\n");
  const { tgz, binBytes, integrity } = fakeDownload();
  await withPin(integrity, async () => {
    assert.equal(await installAgentBrowser({ appHome: home, platform: "linux", arch: "x64", fetchBytes: async () => tgz, say: () => {} }), "installed");
    assert.ok(readFileSync(bin).equals(binBytes));
  });
});

test("ensureChrome: a set path is checked; empty runs `install` once and remembers", () => {
  const home = tmp();
  const bin = join(home, "herdr-dock/browser/bin/agent-browser");
  const calls = [], lines = [];
  const run = (cmd, args) => (calls.push([cmd, ...args]), { status: 0 });
  const say = (s) => lines.push(s);
  const here = join(home, "chrome");
  assert.equal(ensureChrome({ bin, chrome: here, run, say }), "missing");
  assert.match(lines.at(-1), /chrome.*not found/i);
  writeFileSync(here, "x");
  assert.equal(ensureChrome({ bin, chrome: here, run, say }), "set");
  assert.deepEqual(calls, []);
  assert.equal(ensureChrome({ bin, chrome: "", run, say }), "installed");
  assert.deepEqual(calls, [[bin, "install"]]);
  assert.equal(ensureChrome({ bin, chrome: "", run, say }), "present");
  assert.equal(calls.length, 1);
  // dry: nothing runs
  const other = join(tmp(), "herdr-dock/browser/bin/agent-browser");
  assert.equal(ensureChrome({ bin: other, chrome: "", run, say, dry: true }), "installed");
  assert.equal(calls.length, 1);
});

test("ensureChrome: a failed install reports failed and leaves no marker", () => {
  const bin = join(tmp(), "herdr-dock/browser/bin/agent-browser");
  const run = () => ({ status: 1 });
  assert.equal(ensureChrome({ bin, chrome: "", run, say: () => {} }), "failed");
  assert.equal(ensureChrome({ bin, chrome: "", run: () => ({ status: 0 }), say: () => {} }), "installed");
});

test("skillTargets: the three tools, DOCK_* overrides, Antigravity's documented global skills folder", () => {
  const t = skillTargets({ home: "/h", env: {} });
  assert.deepEqual(t.map((x) => x.name), ["Claude Code", "Codex", "Antigravity"]);
  assert.deepEqual(t.map((x) => x.dir), ["/h/.claude/skills", "/h/.codex/skills", "/h/.gemini/config/skills"]);
  const o = skillTargets({ home: "/h", env: { DOCK_CLAUDE_HOME: "/c", DOCK_CODEX_HOME: "/x", DOCK_AGY_HOME: "/a" } });
  assert.deepEqual(o.map((x) => x.dir), ["/c/skills", "/x/skills", "/a/skills"]);
});

test("installSkills/removeSkills: only where the parent exists (Antigravity: where skills/ exists); markless files stay", () => {
  const root = tmp();
  mkdirSync(join(root, "claude"));
  mkdirSync(join(root, "agy/skills"), { recursive: true });
  const targets = skillTargets({ home: root, env: { DOCK_CLAUDE_HOME: join(root, "claude"), DOCK_CODEX_HOME: join(root, "nocodex"), DOCK_AGY_HOME: join(root, "agy") } });
  const lines = [];
  const text = `${SKILL_MARK}\nbody\n`;
  const r = installSkills({ targets, text, say: (s) => lines.push(s) });
  assert.deepEqual(r.written.sort(), ["Antigravity", "Claude Code"]);
  assert.equal(readFileSync(join(root, "claude/skills/dock-browser/SKILL.md"), "utf8"), text);
  assert.equal(existsSync(join(root, "nocodex")), false);
  // agy without skills/: skipped and said so
  const bare = skillTargets({ home: root, env: { DOCK_AGY_HOME: join(root, "agy2"), DOCK_CLAUDE_HOME: join(root, "none"), DOCK_CODEX_HOME: join(root, "none2") } });
  mkdirSync(join(root, "agy2"));
  const lines2 = [];
  assert.deepEqual(installSkills({ targets: bare, text, say: (s) => lines2.push(s) }).written, []);
  assert.match(lines2.join("\n"), /Antigravity.*no skills folder/);
  assert.equal(existsSync(join(root, "agy2/skills")), false);
  // remove: only marked files
  writeFileSync(join(root, "agy/skills/dock-browser/SKILL.md"), "mine, no marker\n");
  const rm = removeSkills({ targets, say: () => {} });
  assert.deepEqual(rm.removed, ["Claude Code"]);
  assert.equal(existsSync(join(root, "claude/skills/dock-browser")), false);
  assert.equal(readFileSync(join(root, "agy/skills/dock-browser/SKILL.md"), "utf8"), "mine, no marker\n");
});

test("installSkills/removeSkills: dry run changes nothing", () => {
  const root = tmp();
  mkdirSync(join(root, "claude"));
  const targets = skillTargets({ home: root, env: { DOCK_CLAUDE_HOME: join(root, "claude"), DOCK_CODEX_HOME: join(root, "x"), DOCK_AGY_HOME: join(root, "y") } });
  installSkills({ targets, text: `${SKILL_MARK}\n`, dry: true, say: () => {} });
  assert.equal(existsSync(join(root, "claude/skills")), false);
  installSkills({ targets, text: `${SKILL_MARK}\n`, say: () => {} });
  removeSkills({ targets, dry: true, say: () => {} });
  assert.equal(existsSync(join(root, "claude/skills/dock-browser/SKILL.md")), true);
});

const template = readFileSync(join(import.meta.dirname, "../src/app/browser-skill.md"), "utf8");

test("skillText fills {{BROWSE}} with the slash path and leaves no {{", () => {
  const t = skillText(template, { browse: "/home/u/.config/herdr-app/mods/dock-browser/browse.mjs" });
  assert.ok(!t.includes("{{"));
  assert.ok(t.includes('node "/home/u/.config/herdr-app/mods/dock-browser/browse.mjs" open'));
});

test("the skill template: front matter, marker, and the rules", () => {
  assert.match(template, /^---\nname: dock-browser\ndescription: Use the browser beside this conversation in Herdr/);
  assert.ok(template.includes(SKILL_MARK));
  for (const re of [/\bwait\b/, /exit 3/, /exit 4/, /--profile clean/, /PRODUCTION/, /handoff/, /Design Feedback/, /password/i, /cockpit/, /tab new/, /tab close/])
    assert.match(template, re);
});

test("removeBrowser deletes the binary folder and keeps the signed-in profile", () => {
  const home = tmp();
  mkdirSync(join(home, "herdr-dock/browser/bin"), { recursive: true });
  mkdirSync(join(home, "herdr-dock/browser/profiles"), { recursive: true });
  writeFileSync(join(home, "herdr-dock/browser/profiles/signed-in.json"), "{}");
  writeFileSync(join(home, "herdr-dock/browser/bin/agent-browser"), "x");
  removeBrowser({ appHome: home, dry: true, say: () => {} });
  assert.equal(existsSync(join(home, "herdr-dock/browser/bin")), true);
  removeBrowser({ appHome: home, say: () => {} });
  assert.equal(existsSync(join(home, "herdr-dock/browser/bin")), false);
  assert.equal(existsSync(join(home, "herdr-dock/browser/profiles/signed-in.json")), true);
});

// The standalone script: an app install's config is mods/dock-core/config.json + herdr-dock/local.json.
function appHome(browser) {
  const home = tmp();
  mkdirSync(join(home, "mods/dock-core"), { recursive: true });
  mkdirSync(join(home, "herdr-dock"), { recursive: true });
  writeFileSync(join(home, "mods/dock-core/source.json"), JSON.stringify({ mode: "app" }));
  writeFileSync(join(home, "mods/dock-core/config.json"), readFileSync(join(import.meta.dirname, "../config/dock.json")));
  if (browser) writeFileSync(join(home, "herdr-dock/local.json"), JSON.stringify({ v: 1, browser }));
  return home;
}
const sink = () => { const out = []; return { out, io: { out: (s) => out.push(s), err: (s) => out.push(s) } }; };

test("main --check: disabled prints the state and changes nothing", async () => {
  const home = appHome();
  const { out, io } = sink();
  const code = await main(["--app-home", home, "--check"], { env: { DOCK_CLAUDE_HOME: join(home, "c"), DOCK_CODEX_HOME: join(home, "x"), DOCK_AGY_HOME: join(home, "y") }, io,
    fetchBytes: async () => { throw new Error("fetched"); }, run: () => { throw new Error("ran"); }, template });
  assert.equal(code, 0);
  assert.match(out.join("\n"), /browser is off/);
  assert.equal(existsSync(join(home, "herdr-dock/browser")), false);
});

test("main: enabled installs the binary and the skills; later disabled removes both", async () => {
  const home = appHome({ enabled: true, chrome: process.execPath });
  const claude = join(home, "c"); mkdirSync(claude);
  const env = { DOCK_CLAUDE_HOME: claude, DOCK_CODEX_HOME: join(home, "x"), DOCK_AGY_HOME: join(home, "y") };
  const { tgz, binBytes, integrity } = fakeDownload();
  await withPin(integrity, async () => {
    const { out, io } = sink();
    const deps = { env, io, fetchBytes: async () => tgz, run: () => { throw new Error("ran"); }, template, platform: "linux", arch: "x64" };
    assert.equal(await main(["--app-home", home], deps), 0);
    assert.ok(readFileSync(join(home, "herdr-dock/browser/bin/agent-browser")).equals(binBytes));
    const skill = readFileSync(join(claude, "skills/dock-browser/SKILL.md"), "utf8");
    assert.ok(skill.includes(`node "${home.replaceAll("\\", "/")}/mods/dock-browser/browse.mjs"`));
    assert.match(out.join("\n"), /installed/);
    // --no-skills on a fresh home writes none
    // turn it off: removed
    writeFileSync(join(home, "herdr-dock/local.json"), JSON.stringify({ v: 1, browser: { enabled: false } }));
    assert.equal(await main(["--app-home", home], deps), 0);
    assert.equal(existsSync(join(home, "herdr-dock/browser/bin")), false);
    assert.equal(existsSync(join(claude, "skills/dock-browser")), false);
  });
});

test("main --remove removes even when enabled; --no-skills leaves skills out", async () => {
  const home = appHome({ enabled: true, chrome: process.execPath });
  const claude = join(home, "c"); mkdirSync(claude);
  const env = { DOCK_CLAUDE_HOME: claude, DOCK_CODEX_HOME: join(home, "x"), DOCK_AGY_HOME: join(home, "y") };
  const { tgz, integrity } = fakeDownload();
  await withPin(integrity, async () => {
    const deps = { env, io: sink().io, fetchBytes: async () => tgz, run: () => { throw new Error("ran"); }, template, platform: "linux", arch: "x64" };
    assert.equal(await main(["--app-home", home, "--no-skills"], deps), 0);
    assert.equal(existsSync(join(claude, "skills")), false);
    assert.equal(existsSync(join(home, "herdr-dock/browser/bin/agent-browser")), true);
    assert.equal(await main(["--app-home", home, "--remove"], deps), 0);
    assert.equal(existsSync(join(home, "herdr-dock/browser/bin")), false);
  });
});

test("main: a checksum mismatch exits 1 with the message", async () => {
  const home = appHome({ enabled: true, chrome: process.execPath });
  const { out, io } = sink();
  const code = await main(["--app-home", home], { env: { DOCK_CLAUDE_HOME: join(home, "c"), DOCK_CODEX_HOME: join(home, "x"), DOCK_AGY_HOME: join(home, "y") }, io,
    fetchBytes: async () => enc.encode("not a tarball"), run: () => ({ status: 0 }), template, platform: "linux", arch: "x64" });
  assert.equal(code, 1);
  assert.match(out.join("\n"), /does not match the pinned checksum/);
});

// What each setup run records for the Dock layout dialog's Browser section.
const resultOf = (home) => JSON.parse(readFileSync(join(home, SETUP_RESULT_REL), "utf8"));
const envFor = (home) => ({ DOCK_CLAUDE_HOME: join(home, "c"), DOCK_CODEX_HOME: join(home, "x"), DOCK_AGY_HOME: join(home, "y") });

test("main: a computer agent-browser has no build for records `unsupported` (exit 0)", async () => {
  const home = appHome({ enabled: true });
  const code = await main(["--app-home", home], { env: envFor(home), io: sink().io, fetchBytes: async () => { throw new Error("fetched"); }, template, platform: "sunos", arch: "x64", now: () => 42 });
  assert.equal(code, 0);
  assert.deepEqual(resultOf(home), { state: "unsupported", at: 42, action: "on", message: "no agent-browser build for this computer" });
});

test("main: a Chrome step that fails records `failed` (exit 1)", async () => {
  const home = appHome({ enabled: true });
  const { tgz, integrity } = fakeDownload();
  await withPin(integrity, async () => {
    const code = await main(["--app-home", home], { env: envFor(home), io: sink().io, fetchBytes: async () => tgz, run: () => ({ status: 1 }), template, platform: "linux", arch: "x64", now: () => 7 });
    assert.equal(code, 1);
    assert.deepEqual(resultOf(home), { state: "failed", at: 7, action: "on", message: "Chrome couldn't be set up" });
  });
});

test("main: a thrown error records `failed` with its first line", async () => {
  const home = appHome({ enabled: true });
  await main(["--app-home", home], { env: envFor(home), io: sink().io, fetchBytes: async () => { throw new Error("first line\nsecond line"); }, template, platform: "linux", arch: "x64", now: () => 9 });
  assert.deepEqual(resultOf(home), { state: "failed", at: 9, action: "on", message: "first line" });
});

test("main: records running before it installs, then ok; turning off records ok with action off", async () => {
  const home = appHome({ enabled: true, chrome: process.execPath });
  const { tgz, integrity } = fakeDownload();
  await withPin(integrity, async () => {
    let clock = 100, seen = null;
    const deps = { env: envFor(home), io: sink().io, template, platform: "linux", arch: "x64", run: () => { throw new Error("ran"); }, now: () => clock++,
      fetchBytes: async () => { seen = resultOf(home); return tgz; } };
    assert.equal(await main(["--app-home", home, "--no-skills"], deps), 0);
    assert.deepEqual(seen, { state: "running", startedAt: 100, action: "on" });
    assert.deepEqual(resultOf(home), { state: "ok", at: 101, action: "on", message: "" });
    writeFileSync(join(home, "herdr-dock/local.json"), JSON.stringify({ v: 1, browser: { enabled: false } }));
    assert.equal(await main(["--app-home", home], deps), 0);
    assert.deepEqual(resultOf(home), { state: "ok", at: 103, action: "off", message: "" });
    assert.equal(await main(["--app-home", home, "--remove"], deps), 0);
    assert.deepEqual(resultOf(home), { state: "ok", at: 105, action: "off", message: "" });
  });
});

test("main --check writes no result file, enabled or not", async () => {
  const off = appHome();
  const on = appHome({ enabled: true });
  for (const home of [off, on]) {
    const code = await main(["--app-home", home, "--check"], { env: envFor(home), io: sink().io, fetchBytes: async () => { throw new Error("fetched"); }, run: () => { throw new Error("ran"); }, template, platform: "linux", arch: "x64" });
    assert.equal(code, 0);
    assert.equal(existsSync(join(home, "herdr-dock/browser")), false);
  }
});

test("main: a result that can't be written never fails the setup", async () => {
  const home = appHome({ enabled: true });
  mkdirSync(join(home, SETUP_RESULT_REL), { recursive: true }); // a folder where the file goes: the write throws
  const code = await main(["--app-home", home], { env: envFor(home), io: sink().io, fetchBytes: async () => { throw new Error("fetched"); }, template, platform: "sunos", arch: "x64" });
  assert.equal(code, 0);
});

test("writeSetupResult writes the whole file, creating the folder, and says whether it could", () => {
  const home = tmp();
  assert.equal(writeSetupResult(home, endResult("on", "ok", "", 1)), true);
  assert.deepEqual(resultOf(home), { state: "ok", at: 1, action: "on", message: "" });
  assert.equal(writeSetupResult(home, endResult("off", "failed", "x", 2)), true);
  assert.deepEqual(resultOf(home), { state: "failed", at: 2, action: "off", message: "x" });
  assert.equal(writeSetupResult(join(home, "herdr-dock/browser/setup-result.json"), endResult("on", "ok", "", 3)), false);
});
