import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, hostname } from "node:os";
import { spawnSync } from "node:child_process";
import { buildAll, ROOT } from "./build.mjs";
import { LOCAL_REL, mergeWithLocal, migrationPlan, parseConfig, parseLocal } from "../src/shared/config.js";
import { buildLayout } from "../src/shared/layout.js";
import { rightStateFromShared } from "../src/shared/panel.js";
import { slashPath } from "../src/shared/path.js";
import { BINDINGS, mergeKeys, SECTION } from "./keys.mjs";
import { resolveAppHome } from "./app-home.mjs";
import { setupStatusline } from "../src/app/statusline-setup.js";
import { setupHints } from "../src/app/hints-setup.js";
import { AGY_MARK } from "../src/shared/statusline.js";
import { browserOf } from "../src/shared/browser/config.js";
import { BROWSER_REL, binRel } from "../src/shared/browser/session.js";
import { endResult, startResult } from "../src/shared/browser/setup-result.js";
import { MISSING_CHROME, ensureChrome, installAgentBrowser, installSkills, removeBrowser, removeSkills, skillTargets, skillText, writeSetupResult } from "../src/app/browser-install.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const noStatusline = args.includes("--no-statusline");
const noHints = args.includes("--no-hints");
const noSkills = args.includes("--no-skills");
const appHome = resolveAppHome(args);
if (!appHome) {
  console.error("usage: node scripts/deploy.mjs [--app-home <dir>] [--dry-run] [--no-statusline] [--no-hints] [--no-skills]");
  process.exit(1);
}
const say = (s) => console.log((dry ? "[dry-run] " : "") + s);
const fail = (msg) => { console.error(msg); process.exit(1); };
say(`app home: ${appHome}`);

// The repo whose config/dock.json is read (DOCK_REPO: tests point it at a temp repo).
const repo = resolve(process.env.DOCK_REPO || ROOT);
// Validate config and the local file first so an invalid one aborts before anything is written.
const configPath = join(repo, "config/dock.json");
const localPath = join(appHome, LOCAL_REL);
const host = hostname().toLowerCase();
let configText = readFileSync(configPath, "utf8");
const localText = existsSync(localPath) ? readFileSync(localPath, "utf8") : null;
const original = parseConfig(configText);
if (!original.ok) fail(`config/dock.json invalid: ${original.error}`);
// One-time move of machines.<host> into the local file (written below, after the other checks).
// git's committed text lets a migrated config/dock.json match HEAD again; without git it is skipped.
const head = spawnSync("git", ["show", "HEAD:config/dock.json"], { cwd: repo, encoding: "utf8" });
const migration = migrationPlan({ configText, host, localText, headText: head.status === 0 ? head.stdout : undefined });
if (migration) configText = migration.configText;
const parsed = parseConfig(configText);
if (!parsed.ok) fail(`config/dock.json invalid: ${parsed.error}`);
const local = parseLocal(migration ? migration.localText : localText);
if (!local.ok) fail(`invalid local file ${slashPath(localPath)}: ${local.error}`);
// Build with this PC's right panel state (Herdr's shared.json) so a deploy keeps it.
let sharedState = null;
try { sharedState = JSON.parse(readFileSync(join(appHome, "shared.json"), "utf8").replace(/^\uFEFF/, "")); } catch { sharedState = null; }
const merged = mergeWithLocal(parsed.config, host, local.local);
const layout = buildLayout(merged, rightStateFromShared(sharedState));
const browser = browserOf(merged);

// The browser setup records its outcome for the Dock layout dialog (herdr-dock/browser/setup-result.json): running now,
// ok / failed / unsupported at the browser step. Only when the browser is on or has been set up here, so a deploy of a
// never-enabled browser creates no folder; never on a dry run. A deploy that stops before the browser step ends it as failed.
const browserAction = browser.enabled ? "on" : "off";
const recordBrowser = !dry && (browser.enabled || existsSync(join(appHome, BROWSER_REL)));
let browserEnded = false;
const endBrowser = (outcome, message) => {
  if (!recordBrowser) return;
  browserEnded = true;
  writeSetupResult(appHome, endResult(browserAction, outcome, message, Date.now()));
};
if (recordBrowser) {
  writeSetupResult(appHome, startResult(browserAction, Date.now()));
  process.on("exit", () => { if (!browserEnded) endBrowser("failed", "deploy stopped before the browser step finished"); });
}

// Read and validate keys.json before any write.
const keysPath = join(appHome, "keys.json");
// No keys.json yet: Herdr writes it (with its default shortcuts) on its first start. Creating
// it here would replace those defaults, so the binding waits for the next deploy.
const hasKeys = existsSync(keysPath);
const keysText = hasKeys ? readFileSync(keysPath, "utf8").replace(/^\uFEFF/, "") : "{}";
let keys;
try { keys = JSON.parse(keysText); } catch (e) { fail(`keys.json is not valid JSON: ${e.message}`); }
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
if (!isObj(keys)) fail("keys.json: root must be an object");
if (SECTION in keys && !isObj(keys[SECTION])) fail(`keys.json: "${SECTION}" must be an object`);

const built = await buildAll().catch((e) => fail(`build failed: ${e.message}`));
// browser.enabled false: dock-browser isn't installed (and an installed one is removed below).
const names = browser.enabled ? built : built.filter((n) => n !== "dock-browser");
for (const name of names) {
  if (!name.startsWith("dock-")) fail(`refusing to write mods/${name}: not prefixed dock-`);
}

if (migration) {
  say(`migrate machines.${host} from config/dock.json to ${slashPath(localPath)}`);
  if (!dry) {
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, migration.localText);
    writeFileSync(configPath, migration.configText);
  }
}

// source.json goes into the built dock-core before it is copied, so the installed mod never
// runs without it. It points at this repo and its config (re-run deploy after moving the repo) and
// carries the hostname dock-core falls back on when it can't run the hostname command, and the commit
// deployed (null without git): the update check and npm run update compare it with HEAD.
const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" });
const commit = rev.status === 0 ? rev.stdout.trim() || null : null;
say(`write mods/dock-core/source.json (commit ${commit ?? "unknown"})`);
writeFileSync(join(ROOT, "dist/mods/dock-core/source.json"),
  JSON.stringify({ config: slashPath(configPath), hostname: host, repo: slashPath(repo), commit }, null, 2) + "\n");

// Each mod is copied to a staging folder in the app home, then swapped in by rename, so Herdr
// never sees a half-copied or missing mod folder.
const installed = [];
const stage = join(appHome, `.dock-deploy-${process.pid}`);
try {
  for (const name of names) {
    const target = join(appHome, "mods", name);
    say(`install mods/${name}`);
    if (dry) continue;
    mkdirSync(join(appHome, "mods"), { recursive: true });
    const fresh = join(stage, name), old = join(stage, `${name}.old`);
    cpSync(join(ROOT, "dist/mods", name), fresh, { recursive: true });
    if (existsSync(target)) {
      // Moved aside first (a rename can't replace a folder); removed with the stage below.
      try { renameSync(target, old); } catch { rmSync(target, { recursive: true, force: true }); }
    }
    renameSync(fresh, target);
    installed.push(target);
  }
} finally {
  if (!dry) rmSync(stage, { recursive: true, force: true });
}

if (!browser.enabled && existsSync(join(appHome, "mods/dock-browser"))) {
  say("remove mods/dock-browser (browser.enabled is false)");
  if (!dry) rmSync(join(appHome, "mods/dock-browser"), { recursive: true, force: true });
}

say("write layouts/herdr-dock.json");
if (!dry) {
  mkdirSync(join(appHome, "layouts"), { recursive: true });
  writeFileSync(join(appHome, "layouts/herdr-dock.json"), JSON.stringify(layout, null, 2) + "\n");
}

// The status-line writer (Quotas and per-agent context): your Claude Code status line runs it with node.
// Installed only where Claude Code already keeps its folder; DOCK_CLAUDE_HOME overrides (tests).
const claudeHome = resolve(process.env.DOCK_CLAUDE_HOME || join(homedir(), ".claude"));
if (existsSync(claudeHome)) {
  say(`install the status-line writer: ${join(claudeHome, "herdr-statusline-cache.mjs")}`);
  if (!dry) cpSync(join(ROOT, "scripts/herdr-statusline-cache.mjs"), join(claudeHome, "herdr-statusline-cache.mjs"));
  // Claude Code's statusLine runs the writer installed with dock-quotas (no status line of your own needed).
  let statusChanged = false; // the status line backed settings.json up and changed it: the hints keep that backup
  if (noStatusline) console.log("--no-statusline: leaving the status line alone");
  else {
    const writer = slashPath(join(appHome, "mods/dock-quotas/herdr-statusline-cache.mjs"));
    try {
      const r = setupStatusline({ claudeHome, writer, dry });
      statusChanged = r.changed;
      say(`status line: ${r.message}`);
    } catch (e) {
      console.error(`status line setup failed (Quotas offers Set up): ${e.message}`);
    }
  }
  // The Render panel's diagram hints: Claude Code's SessionStart and UserPromptSubmit hooks run herdr-hint.mjs.
  if (noHints) console.log("--no-hints: leaving the diagram-hint hooks out");
  else {
    try {
      const r = setupHints({ claudeHome, script: slashPath(join(appHome, "mods/dock-render/herdr-hint.mjs")), dry, backup: !statusChanged });
      say(`diagram hints: ${r.message}`);
    } catch (e) {
      console.error(`diagram hints setup failed: ${e.message}`);
    }
  }
} else {
  console.log(`no ${claudeHome}: skipping the status-line writer (install Claude Code, then re-run deploy)`);
}

// Antigravity's status line (its quota buckets for Quotas): its agy CLI runs the writer installed with dock-quotas.
// Only where Antigravity keeps its settings folder; DOCK_AGY_HOME overrides (tests). Nothing is created otherwise.
const agyHome = resolve(process.env.DOCK_AGY_HOME || join(homedir(), ".gemini", "antigravity-cli"));
if (existsSync(agyHome) && !noStatusline) {
  try {
    const r = setupStatusline({ claudeHome: agyHome, writer: slashPath(join(appHome, "mods/dock-quotas/herdr-agy-statusline.mjs")), dry, mark: AGY_MARK, name: "Antigravity" });
    say(`Antigravity status line: ${r.message}`);
  } catch (e) {
    console.error(`Antigravity status line setup failed (Quotas offers Set up): ${e.message}`);
  }
}

// The browser beside agents (dock-browser): agent-browser, Chrome and the skill when browser.enabled; otherwise
// the binary and the skill are removed. The signed-in profile is left alone either way.
const skillTargetList = skillTargets({});
try {
  let outcome = ["ok", ""];
  if (browser.enabled) {
    const r = await installAgentBrowser({ appHome, dry, say });
    if (r === "unsupported") outcome = ["unsupported", "no agent-browser build for this computer"];
    else {
      // A browser that can't start is a failed deploy, even though everything else went in.
      const chrome = ensureChrome({ bin: join(appHome, binRel(process.platform)), chrome: browser.chrome, dry, say });
      if (chrome === "failed") {
        process.exitCode = 1;
        outcome = ["failed", "Chrome couldn't be set up"];
      } else if (chrome === "missing") outcome = ["failed", MISSING_CHROME]; // recorded only: the exit code stays 0
      if (noSkills) console.log("--no-skills: not writing the dock-browser skill");
      else {
        const template = readFileSync(join(ROOT, "src/app/browser-skill.md"), "utf8");
        installSkills({ targets: skillTargetList, text: skillText(template, { browse: join(appHome, "mods/dock-browser/browse.mjs") }), dry, say });
      }
    }
  } else {
    removeSkills({ targets: skillTargetList, dry, say });
    removeBrowser({ appHome, dry, say });
  }
  endBrowser(...outcome);
} catch (e) {
  console.error(`browser setup failed (run node mods/dock-browser/herdr-browser-setup.mjs to retry): ${e.message}`);
  process.exitCode = 1;
  endBrowser("failed", String(e.message).split("\n")[0]);
}

if (!hasKeys) {
  console.log("keys.json not found — start Herdr once, then re-run deploy to add Ctrl+Alt+B, Ctrl+Alt+N and Ctrl+Alt+,");
} else {
  const merged = mergeKeys(keys, SECTION, BINDINGS);
  for (const { key, reason } of merged.skipped) console.log(`keys.json: ${key} in ${SECTION} is ${reason}; skipping`);
  for (const key of merged.added) say(`merge keys.json ${SECTION} ${key} -> ${BINDINGS.find((b) => b[0] === key)[1]}`);
  for (const [key] of BINDINGS) {
    if (!merged.added.includes(key) && !merged.skipped.some((x) => x.key === key)) say(`keys.json ${SECTION} ${key} already bound`);
  }
  if (!dry && merged.added.length) {
    // Keep the file's existing style (compact one-liner vs pretty).
    const tmp = `${keysPath}.tmp-${process.pid}`;
    writeFileSync(tmp, keysText.includes("\n") ? JSON.stringify(merged.keys, null, 2) + "\n" : JSON.stringify(merged.keys));
    renameSync(tmp, keysPath);
  }
}

if (!dry && !process.env.DOCK_SKIP_CHECK) {
  let bad = 0;
  for (const dir of installed) {
    const name = dir.split(/[\\/]/).pop();
    const r = spawnSync("herdr-app", ["check", dir], { encoding: "utf8" });
    if (r.error || r.status === null) {
      bad++;
      console.error(`check FAILED: ${name}\n${r.error ? r.error.message : "herdr-app did not run"}`);
    } else if (r.status === 0) console.log(`check passed: ${name}`);
    else { bad++; console.error(`check FAILED: ${name}\n${r.stdout}${r.stderr}`); }
  }
  if (bad) process.exit(1);
}
