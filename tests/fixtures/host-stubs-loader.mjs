// Loader hooks for tests/fixtures/host-stubs.mjs: the Herdr host modules (gpui-kit, gpui-base, herdr)
// resolve to stubs, so a mod's real class loads under node --test. Elements chain; `.when(c, f)` runs f
// when c holds, and every string handed to `.child()` is kept in globalThis.__texts (see texts()).
const STUBS = {
  "gpui-kit": `const chain = () => { const p = new Proxy(function () {}, { get: (_t, k) => k === "child" ? (x) => { if (typeof x === "string") globalThis.__texts.push(x); return p; } : k === "when" ? (c, f) => (c ? f(p) : p) : () => p, apply: () => p }); return p; };
    export class View {} export const div = () => chain(); export const svg = () => chain(); export const image = () => chain();`,
  "gpui-base": `const chain = () => { const p = new Proxy(function () {}, { get: (_t, k) => k === "child" ? (x) => { if (typeof x === "string") globalThis.__texts.push(x); return p; } : k === "when" ? (c, f) => (c ? f(p) : p) : () => p, apply: () => p }); return p; };
    export const h_flex = () => chain(); export const v_flex = () => chain();
    export const ScrollHandle = { new: () => ({ scroll_to_item() {} }) };`,
  // Every herdr function reads globalThis.__herdr (set by host-stubs.mjs), which tests change freely.
  herdr: `const d = () => globalThis.__herdr;
    export const data = d();
    export const spaces = () => d().spaces; export const agents = () => d().agents; export const panes = () => d().panes;
    export const terminals = () => d().terminals; export const machines = () => d().machines;
    export const layout = () => d().layout; export const props = () => d().props; export const theme = () => ({});
    export const shared = (k) => d().shared.get(k); export const setShared = (k, v) => d().shared.set(k, v);
    export const checking = () => d().checking; export const home = () => "C:/home"; export const appHome = () => "C:/home/app";
    export const readTextFile = async (p) => (d().files.has(p) ? d().files.get(p) : null);
    export const writeTextFile = async () => {};
    export const hc = async (args) => d().hc(args);
    export const exec = async () => ({ code: 1, stdout: "", stderr: "not a git repository" });
    export const run = (c, a) => d().runs.push([c, a]);
    export const window = () => ({ active: false, platform: "macos" });
    export const watchFolder = () => new Promise(() => {});
    const noop = () => {};
    export const focused = () => null; export const setAgentOrder = noop; export const openOverlay = noop; export const closeOverlay = noop;
    export const notify = noop; export const playSound = noop; export const nextCommand = () => new Promise(() => {});`,
};
export async function resolve(specifier, context, next) {
  if (specifier in STUBS) return { url: `stub:${specifier}`, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith("stub:")) return { format: "module", source: STUBS[url.slice(5)], shortCircuit: true };
  return next(url, context);
}
