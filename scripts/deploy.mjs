import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, hostname } from "node:os";
import { spawnSync } from "node:child_process";
import { buildAll, ROOT } from "./build.mjs";
import { parseConfig, mergeForHost } from "../src/shared/config.js";
import { buildLayout } from "../src/shared/layout.js";
import { slashPath } from "../src/shared/path.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const ai = args.indexOf("--app-home");
if (ai >= 0 && (!args[ai + 1] || args[ai + 1].startsWith("--"))) {
  console.error("usage: node scripts/deploy.mjs [--app-home <dir>] [--dry-run]");
  process.exit(1);
}
const appHome = resolve(ai >= 0 ? args[ai + 1] : join(homedir(), ".config/herdr-app"));
const KEY = "ctrl-alt-b", ACTION = "dock-core.cycle", SECTION = "layout:herdr-dock";
const say = (s) => console.log((dry ? "[dry-run] " : "") + s);
const fail = (msg) => { console.error(msg); process.exit(1); };

// Validate config first so an invalid one aborts before anything is written.
const configPath = join(ROOT, "config/dock.json");
const parsed = parseConfig(readFileSync(configPath, "utf8"));
if (!parsed.ok) fail(`config/dock.json invalid: ${parsed.error}`);
const layout = buildLayout(mergeForHost(parsed.config, hostname()));

// Read and validate keys.json before any write.
const keysPath = join(appHome, "keys.json");
const keysText = existsSync(keysPath) ? readFileSync(keysPath, "utf8").replace(/^﻿/, "") : "{}";
let keys;
try { keys = JSON.parse(keysText); } catch (e) { fail(`keys.json is not valid JSON: ${e.message}`); }
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
if (!isObj(keys)) fail("keys.json: root must be an object");
if (SECTION in keys && !isObj(keys[SECTION])) fail(`keys.json: "${SECTION}" must be an object`);

const names = await buildAll().catch((e) => fail(`build failed: ${e.message}`));
const installed = [];
for (const name of names) {
  if (!name.startsWith("dock-")) fail(`refusing to write mods/${name}: not prefixed dock-`);
  const target = join(appHome, "mods", name);
  say(`install mods/${name}`);
  if (!dry) {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(join(appHome, "mods"), { recursive: true });
    cpSync(join(ROOT, "dist/mods", name), target, { recursive: true });
    installed.push(target);
  }
}

say("write mods/dock-core/source.json");
if (!dry) writeFileSync(join(appHome, "mods/dock-core/source.json"), JSON.stringify({ config: slashPath(configPath) }, null, 2) + "\n");

say("write layouts/herdr-dock.json");
if (!dry) {
  mkdirSync(join(appHome, "layouts"), { recursive: true });
  writeFileSync(join(appHome, "layouts/herdr-dock.json"), JSON.stringify(layout, null, 2) + "\n");
}

const section = keys[SECTION] ?? {};
if (section[KEY] !== undefined && section[KEY] !== ACTION) {
  console.log(`keys.json: ${KEY} in ${SECTION} is already bound to "${section[KEY]}"; skipping`);
} else {
  say(`merge keys.json ${SECTION} ${KEY} -> ${ACTION}`);
  if (!dry && section[KEY] !== ACTION) {
    keys[SECTION] = { ...section, [KEY]: ACTION };
    // Keep the file's existing style (compact one-liner vs pretty).
    const tmp = `${keysPath}.tmp-${process.pid}`;
    mkdirSync(appHome, { recursive: true });
    writeFileSync(tmp, keysText.includes("\n") ? JSON.stringify(keys, null, 2) + "\n" : JSON.stringify(keys));
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
