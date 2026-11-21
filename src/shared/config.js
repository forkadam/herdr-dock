// Config parsing and per-host merge (pure; no Node built-ins).
import { buildLayout } from "./layout.js";

export const REGION_NAMES = ["top", "left", "right", "bottom"];
const LEFT_MODES = ["expanded", "icons", "hidden"];

export const DEFAULT_CONFIG = {
  v: 1,
  regions: {
    top: { size: 42, features: [{ mod: "dock-core", size: 132 }, { mod: "tabs" }] },
    left: {
      size: 268,
      mode: "expanded",
      features: [{ mod: "dock-spaces" }, { mod: "dock-agents" }, { mod: "dock-quotas", size: 150 }],
    },
    right: { size: 360, hidden: true, features: [] },
    bottom: { size: 28, hidden: true, features: [] },
  },
};

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function checkRegions(regions, where) {
  if (!isObj(regions)) return `${where}: must be an object`;
  for (const [name, r] of Object.entries(regions)) {
    const at = `${where}.${name}`;
    if (!REGION_NAMES.includes(name)) return `${at}: unknown region`;
    if (!isObj(r)) return `${at}: must be an object`;
    if ("size" in r && !(Number.isInteger(r.size) && r.size > 0)) return `${at}.size: must be a positive integer`;
    if ("hidden" in r && typeof r.hidden !== "boolean") return `${at}.hidden: must be a boolean`;
    if ("mode" in r) {
      if (name !== "left") return `${at}.mode: only the left region has a mode`;
      if (!LEFT_MODES.includes(r.mode)) return `${at}.mode: must be one of ${LEFT_MODES.join(", ")}`;
    }
    if ("features" in r) {
      if (!Array.isArray(r.features)) return `${at}.features: must be an array`;
      for (let i = 0; i < r.features.length; i++) {
        const f = r.features[i];
        const fa = `${at}.features[${i}]`;
        if (!isObj(f)) return `${fa}: must be an object`;
        if (typeof f.mod !== "string" || f.mod === "") return `${fa}.mod: must be a non-empty string`;
        if ("size" in f && !(Number.isInteger(f.size) && f.size > 0)) return `${fa}.size: must be a positive integer`;
        if ("props" in f && !isObj(f.props)) return `${fa}.props: must be an object`;
      }
    }
  }
  return null;
}

export function parseConfig(text) {
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }
  if (!isObj(c)) return { ok: false, error: "config: must be an object" };
  if (c.v !== 1) return { ok: false, error: `v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const err = checkRegions(c.regions ?? {}, "regions");
  if (err) return { ok: false, error: err };
  if ("machines" in c) {
    if (!isObj(c.machines)) return { ok: false, error: "machines: must be an object" };
    for (const [host, m] of Object.entries(c.machines)) {
      if (!isObj(m)) return { ok: false, error: `machines.${host}: must be an object` };
      const e = checkRegions(m.regions ?? {}, `machines.${host}.regions`);
      if (e) return { ok: false, error: e };
    }
  }
  return { ok: true, config: c };
}

// Objects merge key by key; arrays and scalars replace.
function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

export function mergeForHost(config, hostname) {
  const { machines = {}, ...base } = config;
  const host = String(hostname).toLowerCase();
  const key = Object.keys(machines).find((k) => k.toLowerCase() === host);
  const merged = key ? deepMerge(base, machines[key]) : base;
  const regions = {};
  for (const name of REGION_NAMES) {
    const r = merged.regions?.[name] ?? {};
    regions[name] = { ...r, features: r.features ?? [], hidden: r.hidden ?? false };
    if (name === "left") regions[name].mode = r.mode ?? "expanded";
  }
  return { ...merged, regions };
}

// What to do with a (possibly half-saved) config: the layout text to write, or null when
// nothing changed or the config is bad. A bad config keeps lastGood as merged, so the
// window keeps its last good layout. Output matches deploy: pretty JSON + newline.
export function planApply(configText, hostname, currentLayoutText, lastGood) {
  if (typeof configText !== "string") return { write: null, error: "config file not found", merged: lastGood };
  const parsed = parseConfig(configText);
  if (!parsed.ok) return { write: null, error: parsed.error, merged: lastGood };
  const merged = mergeForHost(parsed.config, hostname);
  const text = JSON.stringify(buildLayout(merged), null, 2) + "\n";
  return { write: text === currentLayoutText ? null : text, error: null, merged };
}
