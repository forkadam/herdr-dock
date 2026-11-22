import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addMissingKeys, planSwap, resultFor } from "../src/app/update-app-steps.js";
import { runUpdateApp } from "../src/app/update-app.js";

// ---- pure ----

test("planSwap: replaces the new list, removes only dock-* mods the new list dropped", () => {
  const plan = planSwap(
    { mods: ["dock-core", "dock-a", "dock-gone", "other-mod"] },
    { mods: ["dock-core", "dock-a", "dock-new"] },
  );
  assert.deepEqual(plan, { replace: ["dock-core", "dock-a", "dock-new"], remove: ["dock-gone"] });
});
test("planSwap: no old list removes nothing", () => {
  assert.deepEqual(planSwap(null, { mods: ["dock-core"] }), { replace: ["dock-core"], remove: [] });
});
test("planSwap: refuses a mod name that isn't a plain dock-* folder", () => {
  assert.throws(() => planSwap({ mods: [] }, { mods: ["../evil"] }), /mod name/);
  assert.throws(() => planSwap({ mods: [] }, { mods: ["other"] }), /mod name/);
  assert.throws(() => planSwap({ mods: [] }, { mods: "dock-core" }), /mods/);
});

const APP_KEYS = JSON.stringify({ "layout:herdr-dock": { "ctrl-alt-b": "dock-core.cycle", "ctrl-alt-n": "dock-core.right" } });
test("addMissingKeys: adds a missing binding, keeps other sections", () => {
  const keys = JSON.stringify({ global: { "ctrl-q": "quit" } });
  const r = addMissingKeys(keys, APP_KEYS);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(JSON.parse(r.text), {
    global: { "ctrl-q": "quit" },
    "layout:herdr-dock": { "ctrl-alt-b": "dock-core.cycle", "ctrl-alt-n": "dock-core.right" },
  });
  assert.ok(!r.text.includes("\n"), "a compact file stays compact");
});
test("addMissingKeys: keeps an existing binding and reports it skipped", () => {
  const keys = JSON.stringify({ "layout:herdr-dock": { "ctrl-alt-b": "mine.thing" } }, null, 2) + "\n";
  const r = addMissingKeys(keys, APP_KEYS);
  assert.deepEqual(r.skipped, ["ctrl-alt-b"]);
  assert.deepEqual(JSON.parse(r.text)["layout:herdr-dock"], { "ctrl-alt-b": "mine.thing", "ctrl-alt-n": "dock-core.right" });
  assert.ok(r.text.endsWith("}\n"), "a pretty file stays pretty");
});
test("addMissingKeys: nothing to add leaves the text byte for byte", () => {
  const keys = "﻿" + JSON.stringify({ "layout:herdr-dock": { "ctrl-alt-b": "dock-core.cycle", "ctrl-alt-n": "x" } });
  const r = addMissingKeys(keys, APP_KEYS);
  assert.equal(r.text, keys);
  assert.deepEqual(r.skipped, ["ctrl-alt-n"]);
});
test("resultFor", () => {
  assert.deepEqual(resultFor({ ok: true, from: "a1", to: "b2" }, 7), { ok: true, from: "a1", to: "b2", commits: null, reason: null, at: 7 });
  assert.deepEqual(resultFor({ ok: false, from: "a1", reason: "boom" }, 8), { ok: false, from: "a1", to: null, commits: null, reason: "boom", at: 8 });
});

// ---- sandbox: a temp app home and a temp git repo standing in for GitHub ----

const temps = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); temps.push(d); return d; };
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const read = (path) => readFileSync(path, "utf8");
const git = (cwd, ...a) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const REPO = "forkadam/herdr-dock";
const NEW_VERSION = { repo: REPO, branch: "main", version: "v2v2v2v2v2v2", source: "new1234", mods: ["dock-core", "dock-a", "dock-new"] };
const OLD_VERSION = { repo: REPO, branch: "main", version: "v1v1v1v1v1v1", source: "old1234", mods: ["dock-core", "dock-a", "dock-gone"] };
const APP_KEYS_FULL = { "layout:herdr-dock": { "ctrl-alt-b": "dock-core.cycle", "ctrl-alt-,": "dock-core.config", "ctrl-alt-n": "dock-core.right" } };

function remoteRepo() {
  const dir = tmp("dock-remote-");
  put(join(dir, "README.md"), "repo\n");
  put(join(dir, "app/VERSION.json"), JSON.stringify(NEW_VERSION, null, 2) + "\n");
  put(join(dir, "app/keys.json"), JSON.stringify(APP_KEYS_FULL, null, 2) + "\n");
  put(join(dir, "app/layouts/herdr-dock.json"), "NEW LAYOUT\n");
  for (const name of NEW_VERSION.mods) put(join(dir, `app/mods/${name}/main.js`), `new ${name}\n`);
  put(join(dir, "app/mods/dock-core/VERSION.json"), JSON.stringify(NEW_VERSION, null, 2) + "\n");
  git(dir, "init", "-q", "-b", "main"); git(dir, "add", "."); git(dir, "commit", "-q", "-m", "init");
  return dir;
}
const remote = remoteRepo();

function appHome({ keys = { global: { "ctrl-q": "quit" } } } = {}) {
  const home = tmp("dock-apphome-");
  put(join(home, "mods/dock-core/main.js"), "old dock-core\n");
  put(join(home, "mods/dock-core/VERSION.json"), JSON.stringify(OLD_VERSION, null, 2) + "\n");
  put(join(home, "mods/dock-a/main.js"), "old dock-a\n");
  put(join(home, "mods/dock-a/stale.js"), "stale\n");
  put(join(home, "mods/dock-gone/main.js"), "gone\n");
  put(join(home, "mods/dock-mine/main.js"), "mine\n");
  put(join(home, "mods/other-mod/main.js"), "other\n");
  put(join(home, "layouts/herdr-dock.json"), "MY LAYOUT\n");
  put(join(home, "herdr-dock/local.json"), "{\"mine\":true}\n");
  if (keys) put(join(home, "keys.json"), JSON.stringify(keys, null, 2) + "\n");
  return home;
}
// Runs git for real; herdr-app check is faked (pass unless `fail` names the mod folder).
const fakeIo = (tmpRoot, { fail = null } = {}) => {
  const checked = [];
  const lines = [];
  return {
    checked, lines,
    io: {
      tmpRoot, log: (s) => lines.push(s), now: () => 42,
      exec(cmd, args, opts) {
        if (cmd === "herdr-app") {
          const name = args[1].split(/[\\/]/).pop();
          checked.push(name);
          return name === fail ? { status: 1, stdout: "", stderr: `bad manifest in ${name}\n` } : { status: 0, stdout: "ok\n", stderr: "" };
        }
        return spawnSync(cmd, args, { encoding: "utf8", ...opts });
      },
    },
  };
};
const result = (home) => JSON.parse(read(join(home, "herdr-dock/update-result.json")));

test("update-app: happy path swaps the dock mods and leaves the rest", () => {
  const home = appHome();
  const tmpRoot = tmp("dock-tmproot-");
  const f = fakeIo(tmpRoot);
  const r = runUpdateApp({ appHome: home, remote, io: f.io });
  assert.equal(r.ok, true, JSON.stringify(r) + f.lines.join("\n"));
  assert.deepEqual(f.checked.sort(), ["dock-a", "dock-core", "dock-new"]);
  assert.equal(read(join(home, "mods/dock-core/main.js")), "new dock-core\n");
  assert.equal(read(join(home, "mods/dock-a/main.js")), "new dock-a\n");
  assert.equal(existsSync(join(home, "mods/dock-a/stale.js")), false, "a replaced mod has no leftover files");
  assert.equal(read(join(home, "mods/dock-new/main.js")), "new dock-new\n");
  assert.equal(existsSync(join(home, "mods/dock-gone")), false);
  assert.equal(read(join(home, "mods/dock-mine/main.js")), "mine\n");
  assert.equal(read(join(home, "mods/other-mod/main.js")), "other\n");
  assert.equal(read(join(home, "layouts/herdr-dock.json")), "MY LAYOUT\n");
  assert.equal(read(join(home, "herdr-dock/local.json")), "{\"mine\":true}\n");
  assert.equal(JSON.parse(read(join(home, "mods/dock-core/VERSION.json"))).source, "new1234");
  const keys = JSON.parse(read(join(home, "keys.json")));
  assert.deepEqual(keys.global, { "ctrl-q": "quit" });
  assert.deepEqual(keys["layout:herdr-dock"], APP_KEYS_FULL["layout:herdr-dock"]);
  assert.deepEqual(result(home), { ok: true, from: "old1234", to: "new1234", commits: null, reason: null, at: 42 });
  assert.deepEqual(readdirSync(tmpRoot), [], "the temp folder is deleted");
  assert.deepEqual(readdirSync(home).sort(), ["herdr-dock", "keys.json", "layouts", "mods"], "no staging left in the app home");
});

test("update-app: a failing check replaces nothing", () => {
  const home = appHome();
  const tmpRoot = tmp("dock-tmproot-");
  const keysBefore = read(join(home, "keys.json"));
  const f = fakeIo(tmpRoot, { fail: "dock-new" });
  const r = runUpdateApp({ appHome: home, remote, io: f.io });
  assert.equal(r.ok, false);
  assert.match(r.reason, /dock-new/);
  assert.match(r.reason, /bad manifest/);
  assert.equal(read(join(home, "mods/dock-core/main.js")), "old dock-core\n");
  assert.equal(read(join(home, "mods/dock-a/stale.js")), "stale\n");
  assert.equal(read(join(home, "mods/dock-gone/main.js")), "gone\n");
  assert.equal(existsSync(join(home, "mods/dock-new")), false);
  assert.equal(read(join(home, "keys.json")), keysBefore);
  assert.equal(JSON.parse(read(join(home, "mods/dock-core/VERSION.json"))).source, "old1234");
  assert.deepEqual(result(home), { ok: false, from: "old1234", to: "new1234", commits: null, reason: r.reason, at: 42 });
  assert.deepEqual(readdirSync(tmpRoot), [], "the temp folder is deleted");
});

test("update-app: keeps a key the person uses", () => {
  const home = appHome({ keys: { "layout:herdr-dock": { "ctrl-alt-b": "mine.thing" } } });
  const tmpRoot = tmp("dock-tmproot-");
  const f = fakeIo(tmpRoot);
  const r = runUpdateApp({ appHome: home, remote, io: f.io });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(JSON.parse(read(join(home, "keys.json")))["layout:herdr-dock"], {
    "ctrl-alt-b": "mine.thing", "ctrl-alt-,": "dock-core.config", "ctrl-alt-n": "dock-core.right",
  });
  assert.ok(f.lines.some((l) => /ctrl-alt-b/.test(l) && /skip/i.test(l)), f.lines.join("\n"));
  assert.deepEqual(readdirSync(tmpRoot), []);
});

test("update-app: a failed clone reports, replaces nothing and leaves no temp folder", () => {
  const home = appHome();
  const tmpRoot = tmp("dock-tmproot-");
  const f = fakeIo(tmpRoot);
  const r = runUpdateApp({ appHome: home, remote: join(tmpRoot, "..", "no-such-repo-" + process.pid), io: f.io });
  assert.equal(r.ok, false);
  assert.match(r.reason, /clone/);
  assert.equal(result(home).from, "old1234");
  assert.equal(read(join(home, "mods/dock-core/main.js")), "old dock-core\n");
  assert.deepEqual(f.checked, []);
  assert.deepEqual(readdirSync(tmpRoot), []);
});

test("update-app: the script exits non-zero after writing the result (no VERSION.json installed)", () => {
  const home = tmp("dock-apphome-");
  const r = spawnSync(process.execPath, ["src/app/update-app.js", "--app-home", home], {
    encoding: "utf8", env: { ...process.env, DOCK_APP_REMOTE: remote },
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const res = result(home);
  assert.equal(res.ok, false);
  assert.match(res.reason, /VERSION\.json/);
  assert.equal(res.commits, null);
});

// An fs whose renameSync throws when shouldThrow(src, dest) says so (everything else is the real fs).
import * as realFs from "node:fs";
const throwingFs = (shouldThrow) => ({
  ...realFs,
  renameSync(src, dest) {
    if (shouldThrow(String(src), String(dest))) throw new Error(`EPERM: rename ${src}`);
    return realFs.renameSync(src, dest);
  },
});
const base = (p) => p.split(/[\\/]/).pop();
const inStage = (p) => /[\\/]\.dock-update-[^\\/]+[\\/]/.test(p);

test("update-app: a swap failing on the 2nd mod rolls back every mod and reports it", () => {
  const home = appHome();
  const tmpRoot = tmp("dock-tmproot-");
  const keysBefore = read(join(home, "keys.json"));
  const f = fakeIo(tmpRoot);
  // The new dock-a moving in from the stage fails.
  f.io.fs = throwingFs((src) => inStage(src) && base(src) === "dock-a");
  const r = runUpdateApp({ appHome: home, remote, io: f.io });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^update rolled back: EPERM/);
  assert.equal(read(join(home, "mods/dock-core/main.js")), "old dock-core\n");
  assert.equal(read(join(home, "mods/dock-a/main.js")), "old dock-a\n");
  assert.equal(read(join(home, "mods/dock-a/stale.js")), "stale\n");
  assert.equal(existsSync(join(home, "mods/dock-new")), false);
  assert.equal(read(join(home, "mods/dock-gone/main.js")), "gone\n");
  assert.equal(read(join(home, "keys.json")), keysBefore);
  assert.equal(result(home).reason, r.reason);
  assert.deepEqual(readdirSync(home).sort(), ["herdr-dock", "keys.json", "layouts", "mods"], "the stage is deleted after a full rollback");
  assert.deepEqual(readdirSync(tmpRoot), []);
});

test("update-app: a failed restore keeps the stage and names the missing mod and the kept copy", () => {
  const home = appHome();
  const tmpRoot = tmp("dock-tmproot-");
  const f = fakeIo(tmpRoot);
  // dock-a's swap fails, and so does putting its old folder back.
  f.io.fs = throwingFs((src) => inStage(src) && (base(src) === "dock-a" || base(src) === "dock-a.old"));
  const r = runUpdateApp({ appHome: home, remote, io: f.io });
  assert.equal(r.ok, false);
  assert.match(r.reason, /rollback is incomplete/);
  assert.match(r.reason, /mods\/dock-a missing/);
  assert.match(r.reason, /mods\/dock-core old/);
  const stage = readdirSync(home).find((n) => n.startsWith(".dock-update-"));
  assert.ok(stage, "the stage is kept");
  assert.ok(r.reason.includes(join(home, stage)), r.reason);
  assert.equal(read(join(home, stage, "dock-a.old/stale.js")), "stale\n", "the old copy survives");
  assert.equal(existsSync(join(home, "mods/dock-a")), false);
  assert.equal(read(join(home, "mods/dock-core/main.js")), "old dock-core\n", "the other mods are still rolled back");
  assert.deepEqual(readdirSync(tmpRoot), []);
});

test("update-app: a stale stage from a killed run is never reused", () => {
  const home = appHome();
  const tmpRoot = tmp("dock-tmproot-");
  const stale = join(home, `.dock-update-${process.pid}`);
  put(join(stale, "dock-a/leftover.js"), "leftover\n");
  const f = fakeIo(tmpRoot);
  const r = runUpdateApp({ appHome: home, remote, io: f.io });
  assert.equal(r.ok, true, JSON.stringify(r) + f.lines.join("\n"));
  assert.equal(existsSync(join(home, "mods/dock-a/leftover.js")), false, "nothing from the stale stage reaches the mod");
  assert.equal(read(join(home, "mods/dock-a/main.js")), "new dock-a\n");
  assert.equal(read(join(stale, "dock-a/leftover.js")), "leftover\n", "the stale folder is left alone");
});
