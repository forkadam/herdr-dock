import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (args, env = {}) =>
  spawnSync("node", ["scripts/deploy.mjs", ...args], { encoding: "utf8", env: { ...process.env, ...env } });
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

test("missing keys.json is created with the binding", () => {
  const tmp = tmpHome();
  try {
    const r = run(["--app-home", tmp], { DOCK_SKIP_CHECK: "1" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(JSON.parse(readFileSync(join(tmp, "keys.json"), "utf8"))["layout:herdr-dock"]["ctrl-alt-b"], "dock-core.cycle");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("--app-home without a value prints usage", () => {
  const r = run(["--app-home"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
});
