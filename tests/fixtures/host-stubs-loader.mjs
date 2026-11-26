// Loader hooks for tests/fixtures/host-stubs.mjs: the Herdr host modules (gpui-kit, gpui-base, herdr)
// resolve to stubs, so a mod's real class loads under node --test. Elements chain; `.when(c, f)` runs f
// when c holds, every string handed to `.child()` is kept in globalThis.__texts (see texts()), and an
// element's handlers are kept by "<id>:<on_x>[:<button>]" (see handlers()), its last .bg() by id (see bgs());
// scroll_to_item calls go to scrolls(). theme() names each token after itself (t.selected === "selected").
import { readFileSync } from "node:fs";

// Element methods gpui-kit.d.ts declares (scripts/gpui-element-methods.mjs); anything else on a chain throws,
// so a typo in a drawn row fails the test that draws it.
const METHODS_SOURCE = `const METHODS = new Set(${readFileSync(new URL("./gpui-element-methods.json", import.meta.url), "utf8").trim()});`;

const STUBS = {
  "gpui-kit": `${METHODS_SOURCE} const chain = () => { let id = null; const p = new Proxy(function () {}, { get: (_t, k) => k === "child" ? (x) => { if (typeof x === "string") globalThis.__texts.push(x); return p; } : k === "when" ? (c, f) => (c ? f(p) : p) : k === "id" ? (v) => { id = v; return p; } : k === "bg" ? (x) => { if (id != null) globalThis.__bgs[id] = x; return p; } : typeof k === "string" && k.startsWith("on_") ? (...a) => { if (id != null) globalThis.__handlers[[id, k, ...a.slice(0, -1)].join(":")] = a.at(-1); return p; } : typeof k === "string" && !METHODS.has(k) ? () => { throw new TypeError(k + " is not an element method in gpui-kit.d.ts"); } : () => p, apply: () => p }); return p; };
    export class View {} export const div = () => chain(); export const svg = () => chain(); export const image = () => chain();`,
  "gpui-base": `${METHODS_SOURCE} const chain = () => { let id = null; const p = new Proxy(function () {}, { get: (_t, k) => k === "child" ? (x) => { if (typeof x === "string") globalThis.__texts.push(x); return p; } : k === "when" ? (c, f) => (c ? f(p) : p) : k === "id" ? (v) => { id = v; return p; } : k === "bg" ? (x) => { if (id != null) globalThis.__bgs[id] = x; return p; } : typeof k === "string" && k.startsWith("on_") ? (...a) => { if (id != null) globalThis.__handlers[[id, k, ...a.slice(0, -1)].join(":")] = a.at(-1); return p; } : typeof k === "string" && !METHODS.has(k) ? () => { throw new TypeError(k + " is not an element method in gpui-kit.d.ts"); } : () => p, apply: () => p }); return p; };
    export const h_flex = () => chain(); export const v_flex = () => chain();
    export const ScrollHandle = { new: () => ({ scroll_to_item: (i) => globalThis.__scrolls.push(i) }) };`,
  // Every herdr function reads globalThis.__herdr (set by host-stubs.mjs), which tests change freely.
  herdr: `const d = () => globalThis.__herdr;
    export const data = d();
    export const spaces = () => d().spaces; export const agents = () => d().agents; export const panes = () => d().panes;
    export const terminals = () => d().terminals; export const machines = () => d().machines;
    export const layout = () => d().layout; export const props = () => d().props; export const theme = () => new Proxy({}, { get: (_t, k) => String(k) }); // every token is its own name
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
