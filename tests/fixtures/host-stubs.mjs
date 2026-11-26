// Import first: stubs Herdr's host modules for a mod's real class (module.register, so it runs on
// Node 22.14 too, unlike registerHooks). Tests set what the host reports through `herdr.data`.
import { register } from "node:module";

const fresh = () => ({
  spaces: [], agents: [], panes: [], terminals: [], machines: [], layout: null,
  props: { dockRegion: "left" }, shared: new Map(), files: new Map(), runs: [], checking: true,
  hc: () => ({ code: 1, stdout: "", stderr: "no hc in tests" }),
});
globalThis.__herdr = fresh();
// Herdr gives mods localStorage; Node 22 has none.
const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
export const resetHost = () => Object.assign(globalThis.__herdr, fresh());
register("./host-stubs-loader.mjs", import.meta.url);
