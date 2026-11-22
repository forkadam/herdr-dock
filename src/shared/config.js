// Config parsing and per-host merge (pure; no Node built-ins).
import { buildLayout } from "./layout.js";

// "pages": mods shown one at a time in place of the terminal (dock pages), listed by dock-pages in the left panel.
export const REGION_NAMES = ["top", "left", "right", "bottom", "pages"];
const LEFT_MODES = ["expanded", "icons", "hidden"];
// Core features that draw the left panel modes (icon rail, collapsed header).
export const LEFT_ONLY = ["dock-header", "dock-footer", "dock-spaces", "dock-agents", "dock-git", "dock-quotas", "dock-pages"];
// Pages that only make sense filling the work area.
export const PAGE_ONLY = ["dock-overview", "dock-jira"];
const NEEDS_CORE = "dock-core draws the left-panel toggle, runs Ctrl+Alt+B and shows config errors, so it must stay in a shown top bar";

export const DEFAULT_CONFIG = {
  v: 1,
  regions: {
    top: { size: 42, features: [{ mod: "dock-core", size: 44 }, { mod: "dock-tabs" }] },
    left: {
      size: 268,
      mode: "expanded",
      features: [{ mod: "dock-header", size: 46, drag: true }, { mod: "dock-spaces" }, { mod: "dock-agents" }, { mod: "dock-git" }, { mod: "dock-quotas", size: 220 }, { mod: "dock-footer", size: 40 }],
    },
    right: { size: 360, hidden: true, features: [{ mod: "dock-pipelines" }, { mod: "dock-notifications" }, { mod: "dock-files" }, { mod: "dock-changes" }, { mod: "dock-render" }] },
    bottom: { size: 28, features: [{ mod: "dock-where" }, { mod: "dock-limits" }, { mod: "dock-warnings", size: 210 }, { mod: "dock-system", size: 150 }, { mod: "dock-attention", size: 36 }] },
    pages: { features: [] },
  },
};

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function checkRegions(regions, where) {
  if (!isObj(regions)) return `${where}: must be an object`;
  for (const [name, r] of Object.entries(regions)) {
    const at = `${where}.${name}`;
    if (!REGION_NAMES.includes(name)) return `${at}: unknown region`;
    if (!isObj(r)) return `${at}: must be an object`;
    if (name === "pages" && "size" in r) return `${at}.size: a page fills the work area, it has no size`;
    if (name === "pages" && r.hidden === true) return `${at}.hidden: pages can't be hidden; remove them instead`;
    if ("size" in r && !(Number.isInteger(r.size) && r.size > 0)) return `${at}.size: must be a positive integer`;
    if ("hidden" in r && typeof r.hidden !== "boolean") return `${at}.hidden: must be a boolean`;
    if ("mode" in r) {
      if (name !== "left") return `${at}.mode: only the left region has a mode`;
      if (!LEFT_MODES.includes(r.mode)) return `${at}.mode: must be one of ${LEFT_MODES.join(", ")}`;
    }
    if (name === "top" && r.hidden === true) return `${at}.hidden: the top bar can't be hidden: ${NEEDS_CORE}`;
    if ("features" in r) {
      if (!Array.isArray(r.features)) return `${at}.features: must be an array`;
      for (let i = 0; i < r.features.length; i++) {
        const f = r.features[i];
        const fa = `${at}.features[${i}]`;
        if (!isObj(f)) return `${fa}: must be an object`;
        if (typeof f.mod !== "string" || f.mod === "") return `${fa}.mod: must be a non-empty string`;
        if ("size" in f && !(Number.isInteger(f.size) && f.size > 0)) return `${fa}.size: must be a positive integer`;
        if (name === "pages" && "size" in f) return `${fa}.size: a page fills the work area, it has no size`;
        if ("props" in f && !isObj(f.props)) return `${fa}.props: must be an object`;
        if ("drag" in f && typeof f.drag !== "boolean") return `${fa}.drag: must be true or false`;
        if (name !== "left" && LEFT_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.left`;
        if (name !== "pages" && PAGE_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.pages`;
      }
      if (name === "top" && !r.features.some((f) => f.mod === "dock-core")) return `${at}.features: must include dock-core: ${NEEDS_CORE}`;
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
  if (!Array.isArray(c.regions?.top?.features)) return { ok: false, error: `regions.top.features: must include dock-core: ${NEEDS_CORE}` };
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

// The key of this host's machines section, matched case-insensitively (or undefined).
function hostKey(machines, hostname) {
  const host = String(hostname).toLowerCase();
  return Object.keys(machines).find((k) => k.toLowerCase() === host);
}

export function mergeForHost(config, hostname, local = null) {
  const { machines = {}, ...base } = config;
  const key = hostKey(machines, hostname);
  let merged = key ? deepMerge(base, machines[key]) : base;
  if (local) merged = deepMerge(merged, { regions: local.regions ?? {} });
  const regions = {};
  for (const name of REGION_NAMES) {
    const r = merged.regions?.[name] ?? {};
    regions[name] = { ...r, features: r.features ?? [], hidden: r.hidden ?? false };
    // left.hidden: true is the hidden mode (the mode is what dock-core applies and cycles).
    if (name === "left") regions[name].mode = r.hidden === true ? "hidden" : (r.mode ?? "expanded");
  }
  return { ...merged, regions };
}

// The per-PC local file, under the app home ($HERDR_APP_HOME or ~/.config/herdr-app).
// Shape { v: 1, regions }, the same as a machines.<host> value. Never in git.
export const LOCAL_REL = "herdr-dock/local.json";

// null text (no local file) is { ok: true, local: null }.
export function parseLocal(text) {
  if (text == null) return { ok: true, local: null };
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${LOCAL_REL}: Invalid JSON: ${e.message}` };
  }
  if (!isObj(c)) return { ok: false, error: `${LOCAL_REL}: must be an object` };
  if (c.v !== 1) return { ok: false, error: `${LOCAL_REL}: v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const regions = c.regions ?? {};
  const err = checkRegions(regions, "regions");
  if (err) return { ok: false, error: `${LOCAL_REL}: ${err}` };
  return { ok: true, local: { ...c, regions } };
}

// Base, then machines.<host> (compatibility), then the local file. Callers parse the local
// file with parseLocal first and pass null when it's missing or invalid; an invalid local
// object handed in anyway is ignored, never merged.
export function mergeWithLocal(config, hostname, local) {
  const ok = isObj(local) && local.v === 1 && !checkRegions(local.regions ?? {}, "regions");
  return mergeForHost(config, hostname, ok ? local : null);
}

// JSON equality: same values, object key order ignored.
function jsonEqual(a, b) {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && jsonEqual(a[k], b[k]));
  }
  return a === b;
}

// "machines": {} (as committed) is the same as no machines key.
function withoutEmptyMachines(c) {
  if (!isObj(c.machines) || Object.keys(c.machines).length) return c;
  const { machines, ...rest } = c;
  return rest;
}

// One-time move of this host's machines section into the local file. null when there's
// nothing to do: a local file already exists (even a corrupt one), the config is missing
// or not JSON, or it has no section for this host. Other hosts' sections stay. When the
// rest is JSON-equal to git's committed text (headText), that exact text is kept so the
// working copy is clean again.
export function migrationPlan({ configText, host, localText, headText }) {
  if (localText != null || typeof configText !== "string") return null;
  let c;
  try {
    c = JSON.parse(configText);
  } catch {
    return null;
  }
  if (!isObj(c) || !isObj(c.machines)) return null;
  const key = hostKey(c.machines, host);
  if (key === undefined || !isObj(c.machines[key])) return null;
  const { [key]: section, ...others } = c.machines;
  const rest = { ...c };
  if (Object.keys(others).length) rest.machines = others;
  else delete rest.machines;
  let head;
  try {
    head = typeof headText === "string" ? JSON.parse(headText) : undefined;
  } catch {
    head = undefined;
  }
  return {
    localText: JSON.stringify({ v: 1, regions: section.regions ?? {} }, null, 2) + "\n",
    configText: isObj(head) && jsonEqual(rest, withoutEmptyMachines(head)) ? headText : JSON.stringify(rest, null, 2) + "\n",
  };
}

// migrationPlan carried out with injected file access (dock-core passes Herdr's readTextFile and
// writeTextFile; write(path, text, expected) must refuse a stale expected). headText() resolves
// with git's committed config/dock.json; when it fails the exact-restore step is skipped. The
// local file is written first: if the config write then fails, the section is in both, which
// merges the same. Resolves true when it migrated.
export async function migrateLocal({ configPath, localPath, host, read, write, headText }) {
  const localText = await read(localPath);
  if (localText != null) return false;
  const configText = await read(configPath);
  if (migrationPlan({ configText, host, localText: null }) === null) return false;
  let head;
  try { head = await headText(); } catch { head = undefined; }
  const plan = migrationPlan({ configText, host, localText: null, headText: head });
  await write(localPath, plan.localText, null);
  if (plan.configText !== configText) await write(configPath, plan.configText, configText);
  return true;
}

// What to do with a (possibly half-saved) config, with the local file's text (null when there is
// none) merged over it: the layout text to write, or null when nothing changed or either is bad. A bad
// config or local file keeps lastGood as merged, so the window keeps its last good layout. Output matches deploy: pretty JSON + newline.
export function planApply(configText, hostname, currentLayoutText, lastGood, state = {}, localText = null) {
  if (typeof configText !== "string") return { write: null, error: "config file not found", merged: lastGood };
  const parsed = parseConfig(configText);
  if (!parsed.ok) return { write: null, error: parsed.error, merged: lastGood };
  // An invalid local file (perhaps half-saved) is reported like a bad config and never merged.
  const local = parseLocal(localText);
  if (!local.ok) return { write: null, error: local.error, merged: lastGood };
  const merged = mergeWithLocal(parsed.config, hostname, local.local);
  const text = JSON.stringify(buildLayout(merged, state), null, 2) + "\n";
  return { write: text === currentLayoutText ? null : text, error: null, merged };
}
