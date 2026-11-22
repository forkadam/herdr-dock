// Loads dock-core's real class with stubbed host modules (gpui-kit, gpui-base, herdr), so an instance field that
// hides a method (e.g. `this.mode = …` over `mode()`) fails here instead of on a live Herdr.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const STUBS = {
  "gpui-kit": `const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
    export class View {} export const div = () => chain(); export const svg = () => chain();`,
  "gpui-base": `const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
    export const h_flex = () => chain(); export const v_flex = () => chain();`,
  herdr: `export const state = new Map(); export const runs = [];
    const noop = () => {}; const later = () => new Promise(() => {});
    export const agents = () => []; export const focused = () => null; export const appHome = () => "C:/home/app"; export const flags = { checking: true }; export const checking = () => flags.checking;
    export const exec = async () => ({ code: 0, stdout: "", stderr: "" }); export const layout = () => null;
    export const nextCommand = later; export const notify = noop; export const openOverlay = noop; export const panes = () => [];
    export const files = new Map(); export const reads = []; export const watched = [];
    export const playSound = noop; export const props = () => ({ dockRegion: "top" });
    export const readTextFile = async (p) => { reads.push(p); return files.has(p) ? files.get(p) : null; };
    export const run = (c, a) => runs.push([c, a]); export const setShared = (k, v) => state.set(k, v);
    export const shared = (k) => state.get(k); export const spaces = () => []; export const theme = () => ({});
    export const watchFolder = (d) => { watched.push(d); return later(); }; export const window = () => ({ platform: "windows" }); export const writeTextFile = async () => {};
    export const home = () => "C:/home"; export const closeOverlay = noop;`,
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: `stub:${specifier}`, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("stub:")) return { format: "module", source: STUBS[url.slice(5)], shortCircuit: true };
    return next(url, context);
  },
});

const { default: DockCore } = await import("../src/mods/dock-core/main.js");
const herdr = await import("herdr");
const cx = { spawn: () => {}, notify: () => {}, stop_propagation: () => {}, sleep: () => new Promise(() => {}) };

test("dock-core: mode() stays a method after init (no instance field hides it)", () => {
  const core = new DockCore();
  core.init({}, cx);
  for (const name of Object.getOwnPropertyNames(DockCore.prototype)) {
    if (name === "constructor" || typeof DockCore.prototype[name] !== "function") continue;
    assert.ok(!Object.prototype.hasOwnProperty.call(core, name), `init() sets this.${name}, hiding the method ${name}()`);
  }
  assert.equal(core.mode(), "expanded");
});

test("dock-core: cycle and render run on a fresh instance", () => {
  const core = new DockCore();
  core.init({}, cx);
  herdr.state.clear();
  core.command("cycle", cx);
  assert.equal(herdr.state.get("dock.left.mode"), "icons");
  assert.doesNotThrow(() => core.render(cx));
});

test("dock-core: app mode reloads from mods/dock-core/config.json and doesn't watch that folder", async () => {
  const home = "C:/home/app";
  herdr.state.clear(); herdr.files.clear(); herdr.reads.length = 0; herdr.watched.length = 0;
  herdr.files.set(`${home}/mods/dock-core/source.json`, JSON.stringify({ mode: "app" }));
  herdr.files.set(`${home}/mods/dock-core/config.json`, JSON.stringify({ v: 1, regions: {} }));
  herdr.files.set(`${home}/herdr-dock/.keep`, "");
  herdr.flags.checking = false;
  const fire = { ...cx, spawn: (fn) => { Promise.resolve().then(() => fn(fire)).catch(() => {}); } };
  try {
    const core = new DockCore();
    core.init({}, fire);
    const reads = () => herdr.reads.filter((p) => p === `${home}/mods/dock-core/config.json`).length;
    const done = await Promise.race([core.start(fire).then(() => "done"), new Promise((r) => setTimeout(() => r("hung"), 1000))]);
    assert.equal(done, "done", "start() returns (no watch of the config folder holds it)");
    assert.equal(core.installMode, "app");
    assert.ok(reads() >= 1, "reload read the shipped config");
    const before = reads();
    await core.reload(fire);
    assert.equal(reads(), before + 1, "reload reads mods/dock-core/config.json");
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(herdr.watched.includes(`${home}/herdr-dock`), `the local folder is watched: ${herdr.watched}`);
    assert.ok(!herdr.watched.includes(`${home}/mods/dock-core`), `the config folder is not watched: ${herdr.watched}`);
  } finally {
    herdr.flags.checking = true;
  }
});
