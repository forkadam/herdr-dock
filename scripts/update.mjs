// npm run update: check the repo is clean and on main, pull, install packages only if they changed, deploy,
// and report through <app home>/herdr-dock/update-result.json (dock-core reads and deletes it).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./build.mjs";
import { resolveAppHome } from "./app-home.mjs";
import { RESULT_REL } from "../src/shared/update.js";
import { needsInstall, parseDirty, preflight, resultOf } from "./update-steps.mjs";

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
  if (r.ok) console.log(r.commits ? `\nUpdated ${r.from} -> ${r.to} (${r.commits} commits).` : "\nAlready up to date.");
  else console.error(`\nUpdate failed: ${r.reason}`);
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
  if (to === from) {
    console.log("already up to date");
    finish({ from, to, commits: 0, ok: true });
  }
  commits = Number(run("git", ["rev-list", "--count", `${from}..${to}`])) || 0;
  console.log(`${commits} new commits: ${from} -> ${to}`);

  step = "npm install";
  say("packages");
  const changed = run("git", ["diff", "--name-only", from, to]).split(/\r?\n/).filter(Boolean);
  if (needsInstall(changed)) run("npm", ["install"], { show: true });
  else console.log("package files unchanged: skipping npm install");

  step = "deploy";
  say("deploy");
  run("node", ["scripts/deploy.mjs", "--app-home", appHome], { show: true });
  finish({ from, to, commits, ok: true });
} catch (e) {
  // After a successful pull the new commit and count are kept, and the reason names the failed step.
  const pulled = commits > 0;
  finish({ from, to: pulled ? to : null, commits, ok: false,
    reason: pulled ? `${step} failed after pulling ${commits} commit${commits === 1 ? "" : "s"}: ${e.message}` : e.message });
}
