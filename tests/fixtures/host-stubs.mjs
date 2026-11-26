// Import first: stubs Herdr's host modules for a mod's real class (module.register, so it runs on
// Node 22.14 too, unlike registerHooks). Tests set what the host reports through `herdr.data`.
import { register } from "node:module";

const fresh = () => ({
  spaces: [], agents: [], panes: [], terminals: [], machines: [], layout: null,
  props: { dockRegion: "left" }, shared: new Map(), files: new Map(), runs: [], closedOverlays: [], checking: true,
  hc: () => ({ code: 1, stdout: "", stderr: "no hc in tests" }),
});
globalThis.__herdr = fresh();
globalThis.__texts = [];
globalThis.__handlers = {};
globalThis.__scrolls = [];
globalThis.__bgs = {};
// Herdr gives mods localStorage; Node 22 has none.
const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
export const resetHost = () => { Object.assign(globalThis.__herdr, fresh()); globalThis.__texts = []; globalThis.__handlers = {}; globalThis.__scrolls = []; globalThis.__bgs = {}; };
// Handlers of the last render, by "<element id>:<on_x>[:<button>]"; and the list's scroll_to_item calls.
export const handlers = () => globalThis.__handlers;
export const scrolls = () => globalThis.__scrolls;
// Each element's last .bg() by id; clearBgs() before a render whose backgrounds a test reads.
export const bgs = () => globalThis.__bgs;
export const clearBgs = () => { globalThis.__bgs = {}; };
// The strings rendered since the last clearTexts(): what a row or header would read.
export const texts = () => globalThis.__texts;
export const clearTexts = () => { globalThis.__texts = []; };
register("./host-stubs-loader.mjs", import.meta.url);
