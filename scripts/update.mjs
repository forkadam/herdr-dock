// npm run update: check the repo is clean and on main, pull, install packages only if they changed, deploy,
// and report through <app home>/herdr-dock/update-result.json (dock-core reads and deletes it).
// The commit the last deploy recorded (mods/dock-core/source.json) is compared with HEAD, so an update whose
// install or deploy failed after the pull is finished by the next run instead of reported as up to date.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./build.mjs";
import { resolveAppHome } from "./app-home.mjs";
import { RESULT_REL } from "../src/shared/update.js";
import { installNeeded, parseDirty, planAfterPull, preflight, resultOf } from "./update-steps.mjs";

const appHome = resolveAppHome(process.argv.slice(2));
if (!appHome) { console.error("usage: node scripts/update.mjs [--app-home <dir>]"); process.exit(1); }
const resultPath = join(appHome, RESULT_REL);
const say = (s) => console.log(`\n== ${s}`);

function finish(fields) {
  const r = resultOf(fields, Date.now());
  try {
    mkdirSync(dirname(resultPath), { recursive: true });
    writeFileSync(resultPath, JSON.stringify(r, null, 2) + "\n");
  } catch (e) { console.error(`could not write ${resultPath}: ${e.message}`); }
  if (!r.ok) console.error(`\nUpdate failed: ${r.reason}`);
  else if (r.from === r.to) console.log("\nAlready up to date.");
  else console.log(`\nUpdated ${r.from ?? "?"} -> ${r.to} (${r.commits} commit${r.commits === 1 ? "" : "s"}).`);
  process.exit(r.ok ? 0 : 1);
}

// Runs a command; returns trimmed stdout, or throws with the first line of what went wrong.
function run(cmd, args, { show = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: show ? ["ignore", "inherit", "inherit"] : "pipe", shell: cmd === "npm" });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : `${cmd} ${args[0]} exited ${r.status}`;
    const detail = String(r.stderr || "").split(/\r?\n/).map((l) => l.trim()).find((l) => l);
    throw new Error(detail && !show ? `${cmd} ${args[0]}: ${detail}` : why);
  }
  return String(r.stdout ?? "").trimEnd();
}

// The commit the last deploy recorded, or null (no source.json, or written before deploy recorded it).
function deployedCommit() {
  try {
    const src = JSON.parse(readFileSync(join(appHome, "mods/dock-core/source.json"), "utf8").replace(/^\uFEFF/, ""));
    return typeof src?.commit === "string" && src.commit.trim() ? src.commit.trim() : null;
  } catch { return null; }
}
const count = (range) => { try { return Number(run("git", ["rev-list", "--count", range])) || 0; } catch { return 0; } };

let from = null, to = null, commits = 0, step = "check";
try {
  say("check the repo");
  const dirty = parseDirty(run("git", ["status", "--porcelain"]));
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  from = run("git", ["rev-parse", "--short", "HEAD"]);
  console.log(`branch ${branch} at ${from}${dirty.length ? `, ${dirty.length} changed files` : ", clean"}`);
  const pre = preflight({ dirty, branch });
  if (!pre.ok) finish({ from, ok: false, reason: pre.reason });

  step = "pull";
  say("pull origin main");
  run("git", ["pull", "--ff-only", "origin", "main"], { show: true });
  to = run("git", ["rev-parse", "--short", "HEAD"]);
  const deployed = deployedCommit();
  const plan = planAfterPull({ from, to, deployed });
  if (plan.action === "none") {
    console.log(`already up to date (deployed ${deployed})`);
    finish({ from, to, commits: 0, ok: true });
  }
  if (plan.action === "redeploy") {
    // Report the update as running from what was deployed.
    from = deployed;
    commits = deployed ? count(`${deployed}..${to}`) : 0;
    console.log(`nothing new to pull, but ${deployed ? `the deployed commit is ${deployed}` : "no deployed commit is recorded"}: installing ${to}`);
  } else {
    commits = count(`${from}..${to}`);
    console.log(`${commits} new commits: ${from} -> ${to}`);
  }

  step = "npm ci";
  say("packages");
  let changed = null;
  if (plan.base) {
    try { changed = run("git", ["diff", "--name-only", plan.base, to]).split(/\r?\n/).filter(Boolean); } catch { changed = null; }
  }
  if (installNeeded({ changed, hasNodeModules: existsSync(join(ROOT, "node_modules")) })) run("npm", ["ci"], { show: true });
  else console.log("package files unchanged: skipping npm ci");

  step = "deploy";
  say("deploy");
  run(process.execPath, ["scripts/deploy.mjs", "--app-home", appHome], { show: true });
  finish({ from, to, commits, ok: true });
} catch (e) {
  // After a successful pull the new commit and count are kept, and the reason names the failed step.
  const pulled = to !== null && step !== "pull";
  const what = commits > 0 ? `pulling ${commits} commit${commits === 1 ? "" : "s"}` : "the pull";
  finish({ from, to: pulled ? to : null, commits, ok: false,
    reason: pulled ? `${step} failed after ${what}: ${e.message}` : e.message });
}
