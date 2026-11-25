import { agyWriterCommand } from "../src/shared/statusline.js";
import { slashPath } from "../src/shared/path.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";

// The committed config, so tests never depend on (or migrate) this working copy's config/dock.json.
const HEAD_CONFIG = spawnSync("git", ["show", "HEAD:config/dock.json"], { encoding: "utf8" }).stdout;
const git = (cwd, ...a) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
// A temp git repo with config/dock.json committed as HEAD_CONFIG; `working` replaces the working copy.
const repos = [];
const fixtureRepo = (working = null) => {
  const dir = mkdtempSync(join(tmpdir(), "dock-repo-"));
  repos.push(dir);
  mkdirSync(join(dir, "config"));
  writeFileSync(join(dir, "config/dock.json"), HEAD_CONFIG);
  git(dir, "init", "-q"); git(dir, "add", "."); git(dir, "commit", "-q", "-m", "init");
  if (working !== null) writeFileSync(join(dir, "config/dock.json"), working);
  return dir;
};
const cleanRepo = fixtureRepo();
after(() => { for (const d of repos) rmSync(d, { recursive: true, force: true }); });

// Deploy also installs the status-line writer into ~/.claude: tests point it at a temp folder.
// DOCK_REPO points deploy's config (and the migration) at a temp repo, never this one.
const noClaude = join(tmpdir(), "dock-no-claude-" + process.pid);
// The same for Antigravity's settings (~/.gemini/antigravity-cli): never the real ones.
const noAgy = join(tmpdir(), "dock-no-agy-" + process.pid);
// And Codex's folder, which the dock-browser skill is written to / removed from.
const noCodex = join(tmpdir(), "dock-no-codex-" + process.pid);
const run = (args, env = {}) =>
  spawnSync("node", ["scripts/deploy.mjs", ...args], { encoding: "utf8", env: { ...process.env, DOCK_CLAUDE_HOME: noClaude, DOCK_AGY_HOME: noAgy, DOCK_CODEX_HOME: noCodex, DOCK_REPO: cleanRepo, ...env } });
const tmpHome = () => mkdtempSync(join(tmpdir(), "dock-app-"));

test("deploy --dry-run into a temp app home writes nothing and lists actions", () => {
  const tmp = tmpHome();
  try {
    const r = run(["--app-home", tmp, "--dry-run"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /layouts\/herdr-dock\.json/);
    assert.match(r.stdout, /mods\/dock-core/);
    assert.deepEqual(readdirSync(tmp), []);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy into a temp app home installs, writes source.json, layout and keys", () => {
  const tmp = tmpHome();
  try {
    writeFileSync(join(tmp, "keys.json"), JSON.stringify({ global: { "alt-1": "space.select:1" } }));
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(tmp, "mods/dock-core/main.js")));
    assert.ok(existsSync(join(tmp, "mods/dock-core/mod.json")));
    const src = JSON.parse(readFileSync(join(tmp, "mods/dock-core/source.json"), "utf8"));
    assert.ok(src.config.endsWith("/config/dock.json"), src.config);
    assert.ok(!src.config.includes("\\"));
    assert.equal(src.repo, cleanRepo.replace(/\\/g, "/"));
    assert.equal(src.config, `${src.repo}/config/dock.json`);
    const layout = JSON.parse(readFileSync(join(tmp, "layouts/herdr-dock.json"), "utf8"));
    assert.ok(JSON.stringify(layout).includes('"id":"dock-left"'));
    const keys = JSON.parse(readFileSync(join(tmp, "keys.json"), "utf8"));
    assert.equal(keys["layout:herdr-dock"]["ctrl-alt-b"], "dock-core.cycle");
    assert.equal(keys.global["alt-1"], "space.select:1");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy skips a key already bound to something else", () => {
  const tmp = tmpHome();
  try {
    writeFileSync(join(tmp, "keys.json"), JSON.stringify({ "layout:herdr-dock": { "ctrl-alt-b": "other.thing" } }));
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(JSON.parse(readFileSync(join(tmp, "keys.json"), "utf8"))["layout:herdr-dock"]["ctrl-alt-b"], "other.thing");
    assert.match(r.stdout, /other\.thing/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("invalid keys.json aborts before anything is written", () => {
  const tmp = tmpHome();
  try {
    for (const bad of ["{not json", "[]", JSON.stringify({ "layout:herdr-dock": [] })]) {
      writeFileSync(join(tmp, "keys.json"), bad);
      const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
      assert.notEqual(r.status, 0, bad);
      assert.match(r.stderr, /keys\.json/);
      assert.deepEqual(readdirSync(tmp), ["keys.json"]);
      assert.equal(readFileSync(join(tmp, "keys.json"), "utf8"), bad);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("BOM-prefixed keys.json deploys and gets the binding", () => {
  const tmp = tmpHome();
  try {
    writeFileSync(join(tmp, "keys.json"), "\uFEFF" + JSON.stringify({ global: { a: "b" } }));
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const keys = JSON.parse(readFileSync(join(tmp, "keys.json"), "utf8"));
    assert.equal(keys["layout:herdr-dock"]["ctrl-alt-b"], "dock-core.cycle");
    assert.equal(keys.global.a, "b");
    assert.ok(!readdirSync(tmp).some((f) => f.includes(".tmp-")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("missing keys.json is left alone: deploy succeeds and says to start Herdr once", () => {
  const tmp = tmpHome();
  try {
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(existsSync(join(tmp, "keys.json")), false);
    assert.match(r.stdout, /keys\.json not found .* start Herdr once, then re-run deploy to add Ctrl\+Alt\+B/);
    assert.ok(existsSync(join(tmp, "layouts/herdr-dock.json")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("--app-home without a value prints usage", () => {
  const r = run(["--app-home"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
});

test("deploy writes the hostname into source.json and leaves no temp folders", async () => {
  const { hostname } = await import("node:os");
  const tmp = tmpHome();
  try {
    writeFileSync(join(tmp, "keys.json"), "{}");
    // Deploy twice: the second run replaces mods that are already there.
    for (let i = 0; i < 2; i++) {
      const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
      assert.equal(r.status, 0, r.stderr + r.stdout);
    }
    const src = JSON.parse(readFileSync(join(tmp, "mods/dock-core/source.json"), "utf8"));
    assert.equal(src.hostname, hostname().toLowerCase());
    assert.deepEqual(readdirSync(tmp).sort(), ["keys.json", "layouts", "mods"]);
    assert.deepEqual(readdirSync(join(tmp, "mods")).sort(), ["dock-agents", "dock-attention", "dock-changes", "dock-config", "dock-core", "dock-files", "dock-footer", "dock-git", "dock-git-delete", "dock-header", "dock-jira", "dock-limits", "dock-notifications", "dock-overview", "dock-pages", "dock-pipelines", "dock-quotas", "dock-rail", "dock-render", "dock-spaces", "dock-system", "dock-tabs", "dock-toast", "dock-warnings", "dock-where"]);
    assert.ok(existsSync(join(tmp, "mods/dock-core/main.js")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy defaults the app home to HERDR_APP_HOME", () => {
  const tmp = tmpHome();
  try {
    const r = run(["--dry-run"], { HERDR_APP_HOME: tmp });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(r.stdout.includes(tmp), r.stdout);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy installs the status-line writer into an existing Claude folder, and skips it when there is none", () => {
  const tmp = tmpHome();
  const claude = mkdtempSync(join(tmpdir(), "dock-claude-"));
  try {
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1", DOCK_CLAUDE_HOME: claude });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(claude, "herdr-statusline-cache.mjs"), "utf8"), readFileSync("scripts/herdr-statusline-cache.mjs", "utf8"));
    // No status line yet: deploy adds one running the writer installed with dock-quotas (beside the setup script).
    const writer = join(tmp, "mods/dock-quotas/herdr-statusline-cache.mjs");
    assert.ok(existsSync(writer) && existsSync(join(tmp, "mods/dock-quotas/herdr-statusline-setup.mjs")));
    assert.equal(JSON.parse(readFileSync(join(claude, "settings.json"), "utf8")).statusLine.command, `node "${slashPath(writer)}"`);
    assert.match(r.stdout, /status line: Add a status line/);
    // The diagram hints: both hook entries run the script installed with dock-render; the file was backed up first.
    const settings = JSON.parse(readFileSync(join(claude, "settings.json"), "utf8"));
    const script = slashPath(join(tmp, "mods/dock-render/herdr-hint.mjs"));
    assert.ok(existsSync(script));
    assert.deepEqual(settings.hooks.SessionStart.map((g) => g.hooks[0].command), [`node "${script}" session`]);
    assert.deepEqual(settings.hooks.UserPromptSubmit.map((g) => g.hooks[0].command), [`node "${script}" prompt`]);
    assert.ok(existsSync(join(claude, "settings.json.bak-herdr-dock")));
    const again = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1", DOCK_CLAUDE_HOME: claude });
    assert.match(again.stdout, /status line: the Claude status line already feeds herdr-dock/);
    assert.match(again.stdout, /diagram hints: already/);
    assert.deepEqual(JSON.parse(readFileSync(join(claude, "settings.json"), "utf8")), settings);
    // --no-hints leaves the hooks out.
    const plain = mkdtempSync(join(tmpdir(), "dock-claude-"));
    try {
      const r3 = run(["--app-home", tmp, "--no-hints"], { DOCK_SKIP_CHECK: "1", DOCK_CLAUDE_HOME: plain });
      assert.equal(r3.status, 0, r3.stderr);
      assert.equal(JSON.parse(readFileSync(join(plain, "settings.json"), "utf8")).hooks, undefined);
    } finally { rmSync(plain, { recursive: true, force: true }); }
    const missing = join(tmpdir(), "dock-claude-missing-" + process.pid);
    const r2 = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1", DOCK_CLAUDE_HOME: missing });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(existsSync(missing), false);
    assert.match(r2.stdout, /status-line writer/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(claude, { recursive: true, force: true });
  }
});

test("deploy moves this host's machines section into the local file, once", () => {
  const tmp = tmpHome();
  const host = hostname().toLowerCase();
  const right = { hidden: false, features: [{ mod: "dock-files" }, { mod: "dock-changes" }] };
  const working = JSON.parse(HEAD_CONFIG);
  working.machines = { [host.toUpperCase()]: { regions: { right } }, "other-pc": { regions: { left: { size: 300 } } } };
  const repo = fixtureRepo(JSON.stringify(working, null, 2) + "\n");
  try {
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1", DOCK_REPO: repo });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /migrate/);
    const local = JSON.parse(readFileSync(join(tmp, "herdr-dock/local.json"), "utf8"));
    assert.deepEqual(local, { v: 1, regions: { right } });
    const config = JSON.parse(readFileSync(join(repo, "config/dock.json"), "utf8"));
    assert.deepEqual(Object.keys(config.machines), ["other-pc"]);
    const src = JSON.parse(readFileSync(join(tmp, "mods/dock-core/source.json"), "utf8"));
    assert.equal(src.repo, repo.replace(/\\/g, "/"));
    const layoutText = readFileSync(join(tmp, "layouts/herdr-dock.json"), "utf8");
    assert.ok(layoutText.includes("dock-files"));
    assert.ok(!layoutText.includes("dock-pipelines"), "the local right features replace the base ones");
    const files = [join(tmp, "herdr-dock/local.json"), join(repo, "config/dock.json"), join(tmp, "layouts/herdr-dock.json")];
    const before = files.map((f) => readFileSync(f, "utf8"));
    const again = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1", DOCK_REPO: repo });
    assert.equal(again.status, 0, again.stderr + again.stdout);
    assert.doesNotMatch(again.stdout, /migrate/);
    assert.deepEqual(files.map((f) => readFileSync(f, "utf8")), before);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy migration writes git's exact text back, leaving config/dock.json clean", () => {
  const tmp = tmpHome();
  const working = JSON.parse(HEAD_CONFIG);
  working.machines = { [hostname().toLowerCase()]: { regions: { right: { hidden: false } } } };
  const repo = fixtureRepo(JSON.stringify(working, null, 2) + "\n");
  try {
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1", DOCK_REPO: repo });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(readFileSync(join(repo, "config/dock.json"), "utf8"), HEAD_CONFIG);
    assert.equal(git(repo, "status", "--porcelain"), "");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy --dry-run reports the migration but writes nothing", () => {
  const tmp = tmpHome();
  const working = JSON.parse(HEAD_CONFIG);
  working.machines = { [hostname().toLowerCase()]: { regions: { right: { hidden: false } } } };
  const text = JSON.stringify(working, null, 2) + "\n";
  const repo = fixtureRepo(text);
  try {
    const r = run(["--app-home", tmp, "--dry-run"], { DOCK_REPO: repo });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /migrate/);
    assert.deepEqual(readdirSync(tmp), []);
    assert.equal(readFileSync(join(repo, "config/dock.json"), "utf8"), text);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("an invalid local file aborts deploy before anything is written", () => {
  const tmp = tmpHome();
  try {
    mkdirSync(join(tmp, "herdr-dock"));
    writeFileSync(join(tmp, "herdr-dock/local.json"), "{ nope");
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /herdr-dock\/local\.json/);
    assert.deepEqual(readdirSync(tmp), ["herdr-dock"]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy records the repo's commit in source.json (null when the repo isn't a git repo)", () => {
  const tmp = tmpHome();
  const plain = mkdtempSync(join(tmpdir(), "dock-plain-"));
  repos.push(plain);
  try {
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const src = JSON.parse(readFileSync(join(tmp, "mods/dock-core/source.json"), "utf8"));
    assert.equal(src.commit, git(cleanRepo, "rev-parse", "--short", "HEAD").trim());
    mkdirSync(join(plain, "config"));
    writeFileSync(join(plain, "config/dock.json"), HEAD_CONFIG);
    const p = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1", DOCK_REPO: plain, GIT_CEILING_DIRECTORIES: tmpdir() });
    assert.equal(p.status, 0, p.stderr + p.stdout);
    assert.equal(JSON.parse(readFileSync(join(tmp, "mods/dock-core/source.json"), "utf8")).commit, null);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy sets up Antigravity's status line too, when its folder exists", () => {
  const tmp = tmpHome();
  const agy = mkdtempSync(join(tmpdir(), "dock-agy-"));
  try {
    writeFileSync(join(agy, "settings.json"), JSON.stringify({ trustedWorkspaces: ["/p"] }));
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1", DOCK_AGY_HOME: agy });
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(readFileSync(join(agy, "settings.json"), "utf8"));
    assert.deepEqual(s.trustedWorkspaces, ["/p"]);
    assert.equal(s.statusLine.command, agyWriterCommand(slashPath(join(tmp, "mods/dock-quotas/herdr-agy-statusline.mjs"))));
    assert.ok(existsSync(join(tmp, "mods/dock-quotas/herdr-agy-statusline.mjs")));
    assert.match(r.stdout, /Antigravity status line: /);
    // No Antigravity folder: nothing is created.
    const r2 = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(existsSync(noAgy), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(agy, { recursive: true, force: true });
  }
});

test("deploy: browser.enabled false installs no dock-browser, removes an installed one and its skills", () => {
  const tmp = tmpHome(), claude = tmpHome();
  try {
    mkdirSync(join(tmp, "mods/dock-browser"), { recursive: true });
    writeFileSync(join(tmp, "mods/dock-browser/browse.mjs"), "old");
    mkdirSync(join(claude, "skills/dock-browser"), { recursive: true });
    writeFileSync(join(claude, "skills/dock-browser/SKILL.md"), "<!-- herdr-dock: dock-browser -->\nold\n");
    const dry = run(["--app-home", tmp, "--dry-run"], { DOCK_CLAUDE_HOME: claude });
    assert.equal(dry.status, 0, dry.stderr + dry.stdout);
    assert.doesNotMatch(dry.stdout, /install mods\/dock-browser/);
    assert.match(dry.stdout, /remove mods\/dock-browser/);
    assert.ok(existsSync(join(tmp, "mods/dock-browser/browse.mjs")), "a dry run keeps it");
    const r = run(["--app-home", tmp], { DOCK_CLAUDE_HOME: claude, DOCK_SKIP_CHECK: "1" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(existsSync(join(tmp, "mods/dock-browser")), false);
    assert.equal(existsSync(join(claude, "skills/dock-browser")), false);
    assert.equal(existsSync(join(tmp, "herdr-dock/browser")), false);
  } finally { rmSync(tmp, { recursive: true, force: true }); rmSync(claude, { recursive: true, force: true }); }
});

test("deploy --dry-run with browser.enabled lists the agent-browser, Chrome and skill steps and writes nothing", () => {
  const tmp = tmpHome(), claude = tmpHome();
  try {
    mkdirSync(join(tmp, "herdr-dock"), { recursive: true });
    writeFileSync(join(tmp, "herdr-dock/local.json"), JSON.stringify({ v: 1, browser: { enabled: true } }));
    const r = run(["--app-home", tmp, "--dry-run"], { DOCK_CLAUDE_HOME: claude });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /install mods\/dock-browser/);
    assert.match(r.stdout, /would download agent-browser 0\.43\.0/);
    assert.match(r.stdout, /would run agent-browser install/);
    assert.match(r.stdout, /would write skill for Claude Code/);
    assert.equal(existsSync(join(claude, "skills")), false);
    assert.equal(existsSync(join(tmp, "herdr-dock/browser")), false);
    const off = run(["--app-home", tmp, "--dry-run", "--no-skills"], { DOCK_CLAUDE_HOME: claude });
    assert.match(off.stdout, /--no-skills: not writing the dock-browser skill/);
  } finally { rmSync(tmp, { recursive: true, force: true }); rmSync(claude, { recursive: true, force: true }); }
});

test("deploy exits 1 when the browser can't be set up (Chrome install fails), after installing the rest", { skip: process.platform === "win32" }, () => {
  const tmp = tmpHome();
  try {
    const cfg = JSON.parse(HEAD_CONFIG);
    const repo = fixtureRepo(JSON.stringify({ ...cfg, browser: { ...(cfg.browser ?? {}), enabled: true, chrome: "" } }, null, 2) + "\n");
    // agent-browser already in place at the pinned version, so nothing is downloaded; its `install` (Chrome) fails.
    const pins = JSON.parse(readFileSync("src/shared/browser/pins.json", "utf8"));
    const bin = join(tmp, "herdr-dock/browser/bin/agent-browser");
    mkdirSync(join(tmp, "herdr-dock/browser/bin"), { recursive: true });
    writeFileSync(bin, "#!/bin/sh\nexit 3\n", { mode: 0o755 });
    writeFileSync(`${bin}.version`, `${pins.version}\n`);
    const r = run(["--app-home", tmp, "--no-skills", "--no-statusline"], { DOCK_SKIP_CHECK: "1", DOCK_REPO: repo });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stdout + r.stderr, /Chrome install failed \(exit 3\)/);
    assert.ok(existsSync(join(tmp, "mods/dock-core/main.js")));
    const res = JSON.parse(readFileSync(join(tmp, "herdr-dock/browser/setup-result.json"), "utf8"));
    assert.deepEqual({ ...res, at: typeof res.at }, { state: "failed", at: "number", action: "on", message: "Chrome couldn't be set up" });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// A deploy with the browser on, agent-browser already at the pinned version in `tmp` and a Chrome path that exists.
function browserReadyHome(tmp, local) {
  const pins = JSON.parse(readFileSync("src/shared/browser/pins.json", "utf8"));
  const bin = join(tmp, "herdr-dock/browser/bin/agent-browser");
  mkdirSync(join(tmp, "herdr-dock/browser/bin"), { recursive: true });
  writeFileSync(bin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(`${bin}.version`, `${pins.version}\n`);
  writeFileSync(join(tmp, "herdr-dock/local.json"), JSON.stringify({ v: 1, browser: local }));
}
const setupResult = (tmp) => JSON.parse(readFileSync(join(tmp, "herdr-dock/browser/setup-result.json"), "utf8"));

test("deploy records the browser setup: ok when it is on, ok with action off when it is turned off; a dry run writes nothing", () => {
  const tmp = tmpHome();
  try {
    browserReadyHome(tmp, { enabled: true, chrome: process.execPath });
    const dry = run(["--app-home", tmp, "--dry-run", "--no-skills", "--no-statusline"]);
    assert.equal(dry.status, 0, dry.stderr + dry.stdout);
    assert.equal(existsSync(join(tmp, "herdr-dock/browser/setup-result.json")), false);
    const on = run(["--app-home", tmp, "--no-skills", "--no-statusline"], { DOCK_SKIP_CHECK: "1" });
    assert.equal(on.status, 0, on.stderr + on.stdout);
    const a = setupResult(tmp);
    assert.deepEqual({ ...a, at: typeof a.at }, { state: "ok", at: "number", action: "on", message: "" });
    writeFileSync(join(tmp, "herdr-dock/local.json"), JSON.stringify({ v: 1, browser: { enabled: false } }));
    const off = run(["--app-home", tmp, "--no-statusline"], { DOCK_SKIP_CHECK: "1" });
    assert.equal(off.status, 0, off.stderr + off.stdout);
    const b = setupResult(tmp);
    assert.deepEqual({ ...b, at: typeof b.at }, { state: "ok", at: "number", action: "off", message: "" });
    assert.equal(existsSync(join(tmp, "herdr-dock/browser/bin")), false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy: a configured Chrome that isn't there is recorded failed, and the exit code stays 0", () => {
  const tmp = tmpHome();
  try {
    browserReadyHome(tmp, { enabled: true, chrome: join(tmp, "no-such-chrome") });
    const r = run(["--app-home", tmp, "--no-skills", "--no-statusline"], { DOCK_SKIP_CHECK: "1" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const res = setupResult(tmp);
    assert.deepEqual({ ...res, at: typeof res.at }, { state: "failed", at: "number", action: "on", message: "the Chrome set in browser.chrome was not found" });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("deploy that stops before the browser step leaves a failed result, not a running one", () => {
  const tmp = tmpHome();
  try {
    mkdirSync(join(tmp, "herdr-dock"), { recursive: true });
    writeFileSync(join(tmp, "herdr-dock/local.json"), JSON.stringify({ v: 1, browser: { enabled: true } }));
    writeFileSync(join(tmp, "keys.json"), "{nope");
    const r = run(["--app-home", tmp, "--no-statusline"], { DOCK_SKIP_CHECK: "1" });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /keys\.json is not valid JSON/);
    const res = setupResult(tmp);
    assert.deepEqual({ ...res, at: typeof res.at }, { state: "failed", at: "number", action: "on", message: "deploy stopped before the browser step finished" });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
