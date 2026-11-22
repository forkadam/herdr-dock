// update-app: the updater of a Herdr-style (app/) install, run in a visible Herdr tab as
//   node <app home>/mods/dock-core/update-app.mjs [--app-home <dir>]
// (bundled into that single file by build:app, so it runs without the repo). Steps, in order:
//   1. git clone --depth 1 --branch <branch> <url> into a temp folder (url: $DOCK_APP_REMOTE, else
//      https://github.com/<repo>.git, repo and branch from the installed mods/dock-core/VERSION.json);
//   2. herdr-app check every app/mods/<name> the new VERSION.json lists; any failure stops before anything is replaced;
//   3. replace each of those mods/<name>; 4. remove a dock-* mod the old list has and the new one doesn't
//      (a failure part way through 3-4 rolls every move back; if a rollback fails, the old copies are kept);
//   5. add only the missing layout:herdr-dock bindings to keys.json. layouts/herdr-dock.json, herdr-dock/local.json,
//      other mods and existing bindings are never touched (dock-core rebuilds the layout on its next reload);
//   6. write <app home>/herdr-dock/update-result.json (dock-core reads and deletes it); 7. delete the temp folder.
// Exits non-zero on failure, always after writing the result file.
import * as nodeFs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULT_REL } from "../shared/update.js";
import { addMissingKeys, planSwap, resultFor } from "./update-app-steps.js";

const VERSION_REL = "mods/dock-core/VERSION.json";
const firstLine = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l) ?? "";

export function defaultIo() {
  return {
    fs: nodeFs,
    exec: (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts }),
    log: (s) => console.log(s),
    now: () => Date.now(),
    tmpRoot: tmpdir(),
  };
}

// Runs the update; writes the result file and returns the result ({ ok, from, to, commits: null, reason, at }).
export function runUpdateApp({ appHome, remote = null, branch = null, io = {} }) {
  const x = { ...defaultIo(), ...io };
  const fs = x.fs;
  const say = (s) => x.log(`\n== ${s}`);
  const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8").replace(/^﻿/, ""));
  let from = null, to = null, tmp = null;

  const finish = (fields) => {
    const r = resultFor({ from, to, ...fields }, x.now());
    const resultPath = join(appHome, RESULT_REL);
    try {
      fs.mkdirSync(dirname(resultPath), { recursive: true });
      fs.writeFileSync(resultPath, JSON.stringify(r, null, 2) + "\n");
    } catch (e) { x.log(`could not write ${resultPath}: ${e.message}`); }
    if (r.ok) x.log(r.from === r.to ? `\nReinstalled herdr-dock ${r.to}.` : `\nUpdated herdr-dock ${r.from ?? "?"} -> ${r.to}.`);
    else x.log(`\nUpdate failed: ${r.reason}`);
    return r;
  };

  try {
    say("read the installed version");
    let old;
    try { old = readJson(join(appHome, VERSION_REL)); }
    catch (e) { return finish({ ok: false, reason: `can't read ${VERSION_REL} (not an app install?): ${e.message}` }); }
    from = old?.source ?? null;
    const br = branch || old?.branch || "main";
    const url = remote || (old?.repo ? `https://github.com/${old.repo}.git` : null);
    if (!url) return finish({ ok: false, reason: `${VERSION_REL} names no repo` });
    x.log(`installed ${from ?? "?"} (version ${old?.version ?? "?"}), app home ${appHome}`);

    say(`clone ${url} (${br})`);
    tmp = fs.mkdtempSync(join(x.tmpRoot, "herdr-dock-update-"));
    const clone = join(tmp, "repo");
    // autocrlf off: the mods are installed byte for byte as published, whatever this machine's git config says.
    const c = x.exec("git", ["-c", "core.autocrlf=false", "clone", "--depth", "1", "--branch", br, "--", url, clone], { stdio: ["inherit", "pipe", "pipe"] });
    if (c.error || c.status !== 0) {
      return finish({ ok: false, reason: `git clone failed: ${c.error ? c.error.message : firstLine(c.stderr) || `exited ${c.status}`}` });
    }
    const app = join(clone, "app");
    let next;
    try { next = readJson(join(app, "VERSION.json")); }
    catch (e) { return finish({ ok: false, reason: `can't read app/VERSION.json in the clone: ${e.message}` }); }
    to = next?.source ?? null;
    x.log(`published ${to ?? "?"} (version ${next?.version ?? "?"})`);
    const plan = planSwap(old, next);

    say("check every mod");
    const failed = [];
    for (const name of plan.replace) {
      const dir = join(app, "mods", name);
      if (!fs.existsSync(dir)) { failed.push(`${name}: missing from app/mods`); x.log(`check FAILED: ${name} (missing)`); continue; }
      const r = x.exec("herdr-app", ["check", dir]);
      if (r.error || r.status !== 0) {
        const why = r.error ? `herdr-app didn't run: ${r.error.message}` : firstLine(`${r.stderr ?? ""}\n${r.stdout ?? ""}`) || `exited ${r.status}`;
        failed.push(`${name}: ${why}`);
        x.log(`check FAILED: ${name}\n${r.error ? r.error.message : `${r.stdout ?? ""}${r.stderr ?? ""}`}`);
      } else x.log(`check passed: ${name}`);
    }
    if (failed.length) return finish({ ok: false, reason: `herdr-app check failed, nothing replaced: ${failed.join("; ")}` });

    // keys.json is merged before any swap, so an unreadable file stops the update with nothing replaced.
    say("keys");
    const keysPath = join(appHome, "keys.json");
    const appKeysPath = join(app, "keys.json");
    let keys = null;
    if (!fs.existsSync(keysPath)) x.log("keys.json not found (start Herdr once): no key bindings added");
    else if (!fs.existsSync(appKeysPath)) x.log("no app/keys.json in the clone: no key bindings added");
    else {
      try { keys = addMissingKeys(fs.readFileSync(keysPath, "utf8"), fs.readFileSync(appKeysPath, "utf8")); }
      catch (e) { return finish({ ok: false, reason: `can't merge keys.json, nothing replaced: ${e.message}` }); }
      for (const key of keys.skipped) x.log(`keys.json: ${key} is already bound to something else; skipping`);
      for (const key of keys.added) x.log(`keys.json: add ${key}`);
      if (!keys.added.length && !keys.skipped.length) x.log("keys.json: every binding already there");
    }

    // Each mod is copied to a staging folder in the app home, then swapped in by rename, so Herdr never sees a
    // half-copied mod folder. Every move is journaled; a failure part way rolls the moves back in reverse order
    // from the copies kept in the stage, and the stage is deleted only when nothing in it is still needed.
    say("swap the mods");
    const journal = []; // { kind: "aside" | "in" | "gone", name, target, path?, hadOld? }
    const state = new Map(); // name -> "old" | "new" | "missing" for every mod this run touched
    let stage = null;
    try {
      fs.mkdirSync(join(appHome, "mods"), { recursive: true });
      // A fresh, uniquely named stage: a folder left by a killed run is never reused.
      stage = fs.mkdtempSync(join(appHome, ".dock-update-"));
      for (const name of plan.replace) {
        const target = join(appHome, "mods", name);
        const fresh = join(stage, name), aside = join(stage, `${name}.old`);
        fs.cpSync(join(app, "mods", name), fresh, { recursive: true });
        const hadOld = fs.existsSync(target);
        if (hadOld) {
          fs.renameSync(target, aside);
          journal.push({ kind: "aside", name, target, path: aside });
          state.set(name, "missing");
        }
        fs.renameSync(fresh, target);
        journal.push({ kind: "in", name, target, hadOld });
        state.set(name, "new");
        x.log(`replaced mods/${name}`);
      }
      for (const name of plan.remove) {
        const target = join(appHome, "mods", name);
        if (!fs.existsSync(target)) continue;
        const gone = join(stage, `${name}.gone`);
        fs.renameSync(target, gone);
        journal.push({ kind: "gone", name, target, path: gone });
        state.set(name, "missing");
        x.log(`removed mods/${name}`);
      }
    } catch (e) {
      x.log(`swap failed: ${e.message}`);
      say("roll back");
      const errors = [];
      const stuck = new Set(); // a mod whose new folder couldn't be moved out: its old copy stays in the stage
      for (const j of [...journal].reverse()) {
        if (stuck.has(j.name)) continue;
        try {
          if (j.kind === "in") {
            fs.renameSync(j.target, join(stage, `${j.name}.new`));
            state.set(j.name, j.hadOld ? "missing" : "old");
          } else {
            fs.renameSync(j.path, j.target);
            state.set(j.name, "old");
          }
          x.log(`rolled back mods/${j.name}`);
        } catch (err) {
          if (j.kind === "in") stuck.add(j.name);
          errors.push(`mods/${j.name}: ${err.message}`);
          x.log(`rollback FAILED: mods/${j.name}: ${err.message}`);
        }
      }
      if (!errors.length) {
        if (stage) try { fs.rmSync(stage, { recursive: true, force: true, maxRetries: 3 }); } catch (err) { x.log(`could not remove ${stage}: ${err.message}`); }
        return finish({ ok: false, reason: `update rolled back: ${e.message}` });
      }
      const where = [...state].map(([name, s]) => `mods/${name} ${s}`).join(", ");
      return finish({
        ok: false,
        reason: `swap failed and the rollback is incomplete: ${e.message}. Now: ${where}. ` +
          `The old copies are kept in ${stage}. Rollback errors: ${errors.join("; ")}`,
      });
    }
    try { fs.rmSync(stage, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { x.log(`could not remove ${stage}: ${e.message}`); }

    if (keys?.added.length) {
      try {
        const t = `${keysPath}.tmp-${process.pid}`;
        fs.writeFileSync(t, keys.text);
        fs.renameSync(t, keysPath);
        x.log(`keys.json: added ${keys.added.join(", ")}`);
      } catch (e) { return finish({ ok: false, reason: `mods updated, but keys.json could not be written: ${e.message}` }); }
    }
    return finish({ ok: true });
  } catch (e) {
    return finish({ ok: false, reason: e.message });
  } finally {
    if (tmp) {
      say("clean up");
      try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); x.log(`deleted ${tmp}`); }
      catch (e) { x.log(`could not delete ${tmp}: ${e.message}`); }
    }
  }
}

// The app home: --app-home <dir>, else the folder two levels above this file (<home>/mods/dock-core/update-app.mjs).
export function appHomeFrom(args, selfPath) {
  const i = args.indexOf("--app-home");
  if (i >= 0) return args[i + 1] && !args[i + 1].startsWith("--") ? resolve(args[i + 1]) : null;
  return resolve(dirname(selfPath), "..", "..");
}

// Run as a script (not imported by the tests): argv[1] is this file, compared through realpath (symlinks, 8.3 names).
const self = fileURLToPath(import.meta.url);
const real = (p) => { try { return nodeFs.realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(self)) {
  const appHome = appHomeFrom(process.argv.slice(2), self);
  if (!appHome) { console.error("usage: node update-app.mjs [--app-home <dir>]"); process.exit(1); }
  const r = runUpdateApp({ appHome, remote: process.env.DOCK_APP_REMOTE || null });
  process.exit(r.ok ? 0 : 1);
}
