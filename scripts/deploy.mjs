import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, hostname } from "node:os";
import { spawnSync } from "node:child_process";
import { buildAll, ROOT } from "./build.mjs";
import { parseConfig, mergeForHost } from "../src/shared/config.js";
import { buildLayout } from "../src/shared/layout.js";
import { slashPath } from "../src/shared/path.js";
import { mergeKeys } from "./keys.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const ai = args.indexOf("--app-home");
if (ai >= 0 && (!args[ai + 1] || args[ai + 1].startsWith("--"))) {
  console.error("usage: node scripts/deploy.mjs [--app-home <dir>] [--dry-run]");
  process.exit(1);
}
const appHome = resolve(ai >= 0 ? args[ai + 1] : process.env.HERDR_APP_HOME || join(homedir(), ".config/herdr-app"));
const BINDINGS = [["ctrl-alt-b", "dock-core.cycle"], ["ctrl-alt-,", "dock-core.config"]];
const SECTION = "layout:herdr-dock";
const say = (s) => console.log((dry ? "[dry-run] " : "") + s);
const fail = (msg) => { console.error(msg); process.exit(1); };
say(`app home: ${appHome}`);

// Validate config first so an invalid one aborts before anything is written.
const configPath = join(ROOT, "config/dock.json");
const parsed = parseConfig(readFileSync(configPath, "utf8"));
if (!parsed.ok) fail(`config/dock.json invalid: ${parsed.error}`);
const host = hostname().toLowerCase();
const layout = buildLayout(mergeForHost(parsed.config, host));

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

const names = await buildAll().catch((e) => fail(`build failed: ${e.message}`));
for (const name of names) {
  if (!name.startsWith("dock-")) fail(`refusing to write mods/${name}: not prefixed dock-`);
}

// source.json goes into the built dock-core before it is copied, so the installed mod never
// runs without it. It points at this repo's config (re-run deploy after moving the repo) and
// carries the hostname dock-core falls back on when it can't run the hostname command.
say("write mods/dock-core/source.json");
writeFileSync(join(ROOT, "dist/mods/dock-core/source.json"),
  JSON.stringify({ config: slashPath(configPath), hostname: host }, null, 2) + "\n");

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

say("write layouts/herdr-dock.json");
if (!dry) {
  mkdirSync(join(appHome, "layouts"), { recursive: true });
  writeFileSync(join(appHome, "layouts/herdr-dock.json"), JSON.stringify(layout, null, 2) + "\n");
}

if (!hasKeys) {
  console.log("keys.json not found — start Herdr once, then re-run deploy to add Ctrl+Alt+B and Ctrl+Alt+,");
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
