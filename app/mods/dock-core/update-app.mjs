// src/app/update-app.js
import * as nodeFs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/shared/update.js
var RESULT_REL = "herdr-dock/update-result.json";
var TIMEOUT_MS = 10 * 60 * 1e3;
var CHECK_EVERY_MS = 6 * 60 * 60 * 1e3;

// src/shared/keys.js
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function mergeKeys(keys, section, bindings) {
  const current = isObj(keys[section]) ? keys[section] : {};
  const next = { ...current };
  const added = [];
  const skipped = [];
  for (const [key, action] of bindings) {
    if (current[key] === action) continue;
    if (current[key] !== void 0) {
      skipped.push({ key, reason: `already bound to "${current[key]}"` });
      continue;
    }
    next[key] = action;
    added.push(key);
  }
  return { keys: { ...keys, [section]: next }, added, skipped };
}

// src/app/update-app-steps.js
var KEYS_SECTION = "layout:herdr-dock";
var MOD_NAME = /^dock-[a-z0-9][a-z0-9-]*$/;
var modsOf = (version, which) => {
  const mods = version?.mods;
  if (!Array.isArray(mods)) throw new Error(`the ${which} VERSION.json has no mods list`);
  return mods;
};
function planSwap(oldVersion, newVersion) {
  const replace = modsOf(newVersion, "new");
  for (const name of replace) {
    if (typeof name !== "string" || !MOD_NAME.test(name)) throw new Error(`bad mod name in the new VERSION.json: ${JSON.stringify(name)}`);
  }
  const old = oldVersion && Array.isArray(oldVersion.mods) ? oldVersion.mods : [];
  const remove = old.filter((name) => typeof name === "string" && MOD_NAME.test(name) && !replace.includes(name));
  return { replace: [...replace], remove };
}
function addMissingKeys(keysText, appKeysText) {
  const clean = (t) => String(t).replace(/^﻿/, "");
  const keys = JSON.parse(clean(keysText));
  const app = JSON.parse(clean(appKeysText));
  const bindings = Object.entries(app?.[KEYS_SECTION] ?? {});
  const merged = mergeKeys(keys, KEYS_SECTION, bindings);
  const skipped = merged.skipped.map((s) => s.key);
  if (!merged.added.length) return { text: keysText, added: [], skipped };
  const text = clean(keysText).includes("\n") ? JSON.stringify(merged.keys, null, 2) + "\n" : JSON.stringify(merged.keys);
  return { text, added: merged.added, skipped };
}
function resultFor({ ok, from, to, reason }, now) {
  return { ok: !!ok, from: from ?? null, to: to ?? null, commits: null, reason: reason ?? null, at: now };
}

// src/app/update-app.js
var VERSION_REL = "mods/dock-core/VERSION.json";
var firstLine = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l) ?? "";
function defaultIo() {
  return {
    fs: nodeFs,
    exec: (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts }),
    log: (s) => console.log(s),
    now: () => Date.now(),
    tmpRoot: tmpdir()
  };
}
function runUpdateApp({ appHome, remote = null, branch = null, io = {} }) {
  const x = { ...defaultIo(), ...io };
  const fs = x.fs;
  const say = (s) => x.log(`
== ${s}`);
  const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8").replace(/^﻿/, ""));
  let from = null, to = null, tmp = null;
  const finish = (fields) => {
    const r = resultFor({ from, to, ...fields }, x.now());
    const resultPath = join(appHome, RESULT_REL);
    try {
      fs.mkdirSync(dirname(resultPath), { recursive: true });
      fs.writeFileSync(resultPath, JSON.stringify(r, null, 2) + "\n");
    } catch (e) {
      x.log(`could not write ${resultPath}: ${e.message}`);
    }
    if (r.ok) x.log(r.from === r.to ? `
Reinstalled herdr-dock ${r.to}.` : `
Updated herdr-dock ${r.from ?? "?"} -> ${r.to}.`);
    else x.log(`
Update failed: ${r.reason}`);
    return r;
  };
  try {
    say("read the installed version");
    let old;
    try {
      old = readJson(join(appHome, VERSION_REL));
    } catch (e) {
      return finish({ ok: false, reason: `can't read ${VERSION_REL} (not an app install?): ${e.message}` });
    }
    from = old?.source ?? null;
    const br = branch || old?.branch || "main";
    const url = remote || (old?.repo ? `https://github.com/${old.repo}.git` : null);
    if (!url) return finish({ ok: false, reason: `${VERSION_REL} names no repo` });
    x.log(`installed ${from ?? "?"} (version ${old?.version ?? "?"}), app home ${appHome}`);
    say(`clone ${url} (${br})`);
    tmp = fs.mkdtempSync(join(x.tmpRoot, "herdr-dock-update-"));
    const clone = join(tmp, "repo");
    const c = x.exec("git", ["-c", "core.autocrlf=false", "clone", "--depth", "1", "--branch", br, "--", url, clone], { stdio: ["inherit", "pipe", "pipe"] });
    if (c.error || c.status !== 0) {
      return finish({ ok: false, reason: `git clone failed: ${c.error ? c.error.message : firstLine(c.stderr) || `exited ${c.status}`}` });
    }
    const app = join(clone, "app");
    let next;
    try {
      next = readJson(join(app, "VERSION.json"));
    } catch (e) {
      return finish({ ok: false, reason: `can't read app/VERSION.json in the clone: ${e.message}` });
    }
    to = next?.source ?? null;
    x.log(`published ${to ?? "?"} (version ${next?.version ?? "?"})`);
    const plan = planSwap(old, next);
    say("check every mod");
    const failed = [];
    for (const name of plan.replace) {
      const dir = join(app, "mods", name);
      if (!fs.existsSync(dir)) {
        failed.push(`${name}: missing from app/mods`);
        x.log(`check FAILED: ${name} (missing)`);
        continue;
      }
      const r = x.exec("herdr-app", ["check", dir]);
      if (r.error || r.status !== 0) {
        const why = r.error ? `herdr-app didn't run: ${r.error.message}` : firstLine(`${r.stderr ?? ""}
${r.stdout ?? ""}`) || `exited ${r.status}`;
        failed.push(`${name}: ${why}`);
        x.log(`check FAILED: ${name}
${r.error ? r.error.message : `${r.stdout ?? ""}${r.stderr ?? ""}`}`);
      } else x.log(`check passed: ${name}`);
    }
    if (failed.length) return finish({ ok: false, reason: `herdr-app check failed, nothing replaced: ${failed.join("; ")}` });
    say("keys");
    const keysPath = join(appHome, "keys.json");
    const appKeysPath = join(app, "keys.json");
    let keys = null;
    if (!fs.existsSync(keysPath)) x.log("keys.json not found (start Herdr once): no key bindings added");
    else if (!fs.existsSync(appKeysPath)) x.log("no app/keys.json in the clone: no key bindings added");
    else {
      try {
        keys = addMissingKeys(fs.readFileSync(keysPath, "utf8"), fs.readFileSync(appKeysPath, "utf8"));
      } catch (e) {
        return finish({ ok: false, reason: `can't merge keys.json, nothing replaced: ${e.message}` });
      }
      for (const key of keys.skipped) x.log(`keys.json: ${key} is already bound to something else; skipping`);
      for (const key of keys.added) x.log(`keys.json: add ${key}`);
      if (!keys.added.length && !keys.skipped.length) x.log("keys.json: every binding already there");
    }
    say("swap the mods");
    const journal = [];
    const state = /* @__PURE__ */ new Map();
    let stage = null;
    try {
      fs.mkdirSync(join(appHome, "mods"), { recursive: true });
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
      const stuck = /* @__PURE__ */ new Set();
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
        if (stage) try {
          fs.rmSync(stage, { recursive: true, force: true, maxRetries: 3 });
        } catch (err) {
          x.log(`could not remove ${stage}: ${err.message}`);
        }
        return finish({ ok: false, reason: `update rolled back: ${e.message}` });
      }
      const where = [...state].map(([name, s]) => `mods/${name} ${s}`).join(", ");
      return finish({
        ok: false,
        reason: `swap failed and the rollback is incomplete: ${e.message}. Now: ${where}. The old copies are kept in ${stage}. Rollback errors: ${errors.join("; ")}`
      });
    }
    try {
      fs.rmSync(stage, { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      x.log(`could not remove ${stage}: ${e.message}`);
    }
    if (keys?.added.length) {
      try {
        const t = `${keysPath}.tmp-${process.pid}`;
        fs.writeFileSync(t, keys.text);
        fs.renameSync(t, keysPath);
        x.log(`keys.json: added ${keys.added.join(", ")}`);
      } catch (e) {
        return finish({ ok: false, reason: `mods updated, but keys.json could not be written: ${e.message}` });
      }
    }
    return finish({ ok: true });
  } catch (e) {
    return finish({ ok: false, reason: e.message });
  } finally {
    if (tmp) {
      say("clean up");
      try {
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
        x.log(`deleted ${tmp}`);
      } catch (e) {
        x.log(`could not delete ${tmp}: ${e.message}`);
      }
    }
  }
}
function appHomeFrom(args, selfPath) {
  const i = args.indexOf("--app-home");
  if (i >= 0) return args[i + 1] && !args[i + 1].startsWith("--") ? resolve(args[i + 1]) : null;
  return resolve(dirname(selfPath), "..", "..");
}
var self = fileURLToPath(import.meta.url);
var real = (p) => {
  try {
    return nodeFs.realpathSync(p);
  } catch {
    return resolve(p);
  }
};
if (process.argv[1] && real(process.argv[1]) === real(self)) {
  const appHome = appHomeFrom(process.argv.slice(2), self);
  if (!appHome) {
    console.error("usage: node update-app.mjs [--app-home <dir>]");
    process.exit(1);
  }
  const r = runUpdateApp({ appHome, remote: process.env.DOCK_APP_REMOTE || null });
  process.exit(r.ok ? 0 : 1);
}
export {
  appHomeFrom,
  defaultIo,
  runUpdateApp
};
