// src/mods/dock-config/main.js
import { View, div as div5 } from "gpui-kit";
import { h_flex as h_flex5, v_flex as v_flex4, InputState, Tabs, Tab } from "gpui-base";
import {
  appHome,
  checking,
  closeOverlay,
  exec,
  props,
  readTextFile,
  run,
  setShared,
  shared,
  theme,
  window,
  writeTextFile
} from "herdr";

// src/shared/browser/config.js
var DEFAULT_BROWSER = { enabled: false, chrome: "", production: [], handoffMinutes: 15 };
var isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var HOST_PATTERN = /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
function checkBrowser(value, where = "browser") {
  if (!isObj(value)) return `${where}: must be an object`;
  for (const [k, v] of Object.entries(value)) {
    const at = `${where}.${k}`;
    if (k === "enabled") {
      if (typeof v !== "boolean") return `${at}: must be true or false`;
    } else if (k === "chrome") {
      if (typeof v !== "string") return `${at}: must be a string`;
    } else if (k === "handoffMinutes") {
      if (!(Number.isInteger(v) && v > 0)) return `${at}: must be a positive integer`;
    } else if (k === "production") {
      if (!Array.isArray(v)) return `${at}: must be an array`;
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] !== "string" || !HOST_PATTERN.test(v[i])) return `${at}[${i}]: must be a host pattern like example.com or *.example.com`;
      }
    } else return `${at}: unknown setting`;
  }
  return null;
}
function browserOf(merged) {
  return { ...DEFAULT_BROWSER, ...isObj(merged?.browser) ? merged.browser : {} };
}
function withBrowserFeature(regions, enabled) {
  const out = {};
  for (const [name, r] of Object.entries(regions)) {
    out[name] = { ...r, features: enabled ? [...r.features] : r.features.filter((f) => f.mod !== "dock-browser") };
  }
  if (enabled && !Object.values(out).some((r) => r.features.some((f) => f.mod === "dock-browser"))) {
    out.right.features.push({ mod: "dock-browser" });
  }
  return out;
}

// src/shared/config.js
var REGION_NAMES = ["top", "left", "right", "bottom", "pages"];
var LEFT_MODES = ["expanded", "icons", "hidden"];
var LEFT_ONLY = ["dock-header", "dock-footer", "dock-spaces", "dock-agents", "dock-git", "dock-quotas", "dock-pages"];
var PAGE_ONLY = ["dock-overview", "dock-jira"];
var NEEDS_CORE = "dock-core draws the left-panel toggle, runs Ctrl+Alt+B and shows config errors, so it must stay in a shown top bar";
var DEFAULT_CONFIG = {
  v: 1,
  regions: {
    top: { size: 42, features: [{ mod: "dock-core", size: 44 }, { mod: "dock-tabs" }] },
    left: {
      size: 268,
      mode: "expanded",
      features: [{ mod: "dock-header", size: 46, drag: true }, { mod: "dock-spaces" }, { mod: "dock-agents" }, { mod: "dock-git" }, { mod: "dock-quotas", size: 270 }, { mod: "dock-footer", size: 40 }]
    },
    right: { size: 360, hidden: true, features: [{ mod: "dock-pipelines" }, { mod: "dock-notifications" }, { mod: "dock-files" }, { mod: "dock-changes" }, { mod: "dock-render" }] },
    bottom: { size: 28, features: [{ mod: "dock-where" }, { mod: "dock-limits" }, { mod: "dock-warnings", size: 210 }, { mod: "dock-system", size: 150 }, { mod: "dock-attention", size: 36 }] },
    pages: { features: [] }
  }
};
var isObj2 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function checkRegions(regions, where) {
  if (!isObj2(regions)) return `${where}: must be an object`;
  for (const [name, r] of Object.entries(regions)) {
    const at = `${where}.${name}`;
    if (!REGION_NAMES.includes(name)) return `${at}: unknown region`;
    if (!isObj2(r)) return `${at}: must be an object`;
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
        if (!isObj2(f)) return `${fa}: must be an object`;
        if (typeof f.mod !== "string" || f.mod === "") return `${fa}.mod: must be a non-empty string`;
        if ("size" in f && !(Number.isInteger(f.size) && f.size > 0)) return `${fa}.size: must be a positive integer`;
        if (name === "pages" && "size" in f) return `${fa}.size: a page fills the work area, it has no size`;
        if ("props" in f && !isObj2(f.props)) return `${fa}.props: must be an object`;
        if ("drag" in f && typeof f.drag !== "boolean") return `${fa}.drag: must be true or false`;
        if (name !== "left" && LEFT_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.left`;
        if (name !== "pages" && PAGE_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.pages`;
      }
      if (name === "top" && !r.features.some((f) => f.mod === "dock-core")) return `${at}.features: must include dock-core: ${NEEDS_CORE}`;
    }
  }
  return null;
}
function parseConfig(text) {
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }
  if (!isObj2(c)) return { ok: false, error: "config: must be an object" };
  if (c.v !== 1) return { ok: false, error: `v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const err = checkRegions(c.regions ?? {}, "regions");
  if (err) return { ok: false, error: err };
  if (!Array.isArray(c.regions?.top?.features)) return { ok: false, error: `regions.top.features: must include dock-core: ${NEEDS_CORE}` };
  if ("browser" in c) {
    const be = checkBrowser(c.browser, "browser");
    if (be) return { ok: false, error: be };
  }
  if ("machines" in c) {
    if (!isObj2(c.machines)) return { ok: false, error: "machines: must be an object" };
    for (const [host, m] of Object.entries(c.machines)) {
      if (!isObj2(m)) return { ok: false, error: `machines.${host}: must be an object` };
      const e = checkRegions(m.regions ?? {}, `machines.${host}.regions`);
      if (e) return { ok: false, error: e };
      if ("browser" in m) {
        const be = checkBrowser(m.browser, `machines.${host}.browser`);
        if (be) return { ok: false, error: be };
      }
    }
  }
  return { ok: true, config: c };
}
function deepMerge(base, over) {
  if (!isObj2(base) || !isObj2(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}
function hostKey(machines, hostname) {
  const host = String(hostname).toLowerCase();
  return Object.keys(machines).find((k) => k.toLowerCase() === host);
}
function mergeForHost(config, hostname, local = null) {
  const { machines = {}, ...base } = config;
  const key = hostKey(machines, hostname);
  let merged = key ? deepMerge(base, machines[key]) : base;
  if (local) merged = deepMerge(merged, { regions: local.regions ?? {}, ..."browser" in local ? { browser: local.browser } : {} });
  const regions = {};
  for (const name of REGION_NAMES) {
    const r = merged.regions?.[name] ?? {};
    regions[name] = { ...r, features: r.features ?? [], hidden: r.hidden ?? false };
    if (name === "left") regions[name].mode = r.hidden === true ? "hidden" : r.mode ?? "expanded";
  }
  return { ...merged, regions: withBrowserFeature(regions, browserOf(merged).enabled) };
}
var LOCAL_REL = "herdr-dock/local.json";
function parseLocal(text) {
  if (text == null) return { ok: true, local: null };
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${LOCAL_REL}: Invalid JSON: ${e.message}` };
  }
  if (!isObj2(c)) return { ok: false, error: `${LOCAL_REL}: must be an object` };
  if (c.v !== 1) return { ok: false, error: `${LOCAL_REL}: v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const regions = c.regions ?? {};
  const err = checkRegions(regions, "regions");
  if (err) return { ok: false, error: `${LOCAL_REL}: ${err}` };
  if ("browser" in c) {
    const be = checkBrowser(c.browser, "browser");
    if (be) return { ok: false, error: `${LOCAL_REL}: ${be}` };
  }
  return { ok: true, local: { ...c, regions } };
}

// src/shared/edit.js
var LEFT_MODES2 = ["expanded", "icons", "hidden"];
var FOOTER = "dock-footer";
var PAGES_NAV = "dock-pages";
var PAGES_NAV_PX = 52;
function allowedRegions(mod) {
  if (mod === "dock-core" || mod === "dock-tabs") return ["top"];
  if (LEFT_ONLY.includes(mod)) return ["left"];
  if (PAGE_ONLY.includes(mod)) return ["pages"];
  return [...REGION_NAMES];
}
function canTurnOff(mod) {
  return mod !== "dock-core";
}
function draftFromConfig(config, host, local = null) {
  const merged = JSON.parse(JSON.stringify(mergeForHost(config, host, local)));
  const regions = {};
  for (const name of REGION_NAMES) regions[name] = merged.regions[name];
  regions.left.hidden = false;
  return { regions, production: [...browserOf(merged).production] };
}
function regionOf(draft, mod) {
  for (const name of REGION_NAMES) {
    if (draft.regions[name].features.some((f) => f.mod === mod)) return name;
  }
  return null;
}
var canonical = (v) => JSON.stringify(v, (_k, x) => x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
var same = (a, b) => canonical(a) === canonical(b);
var EDITED = ["size", "hidden", "mode", "features"];
var fields = (name) => name === "left" ? ["size", "mode", "features"] : name === "pages" ? ["features"] : ["size", "hidden", "features"];
var hostsOf = (d) => d.production ?? [];
function sameDraft(a, b) {
  return REGION_NAMES.every((name) => fields(name).every((k) => same(a.regions[name]?.[k], b.regions[name]?.[k]))) && same(hostsOf(a), hostsOf(b));
}
function rebaseDraft(baseDraft, draft, freshDraft) {
  const out = JSON.parse(JSON.stringify(freshDraft));
  if (draft.production !== void 0 && !same(draft.production, hostsOf(baseDraft))) out.production = [...draft.production];
  for (const name of REGION_NAMES) {
    for (const k of fields(name)) {
      const mine = draft.regions[name]?.[k];
      if (same(mine, baseDraft.regions[name]?.[k])) continue;
      out.regions[name] ??= { features: [] };
      if (mine === void 0) delete out.regions[name][k];
      else out.regions[name][k] = JSON.parse(JSON.stringify(mine));
    }
  }
  return out;
}
function stepSize(size, delta) {
  return Number.isInteger(size) ? Math.max(1, size + delta) : 1;
}
var isPosInt = (v) => Number.isInteger(v) && v > 0;
function place(d, { mod, region }) {
  const from = regionOf(d, mod);
  if (region === "off") {
    if (!canTurnOff(mod)) return `regions.top.features: ${mod} can't be turned off`;
    if (from === null) return null;
    d.regions[from].features = d.regions[from].features.filter((f) => f.mod !== mod);
    return null;
  }
  if (!REGION_NAMES.includes(region)) return `regions.${region}: unknown region`;
  if (!allowedRegions(mod).includes(region)) {
    return `regions.${region}.features: ${mod} can only be placed in regions.${allowedRegions(mod)[0]}`;
  }
  if (from === region) return null;
  let feature = { mod };
  if (from !== null) {
    const list = d.regions[from].features;
    const i = list.findIndex((f) => f.mod === mod);
    feature = list[i];
    list.splice(i, 1);
  }
  const target = d.regions[region].features;
  const at = mod !== FOOTER && target.at(-1)?.mod === FOOTER ? target.length - 1 : target.length;
  target.splice(at, 0, region === "pages" ? feature.props ? { mod, props: feature.props } : { mod } : feature);
  if (region === "pages" && regionOf(d, PAGES_NAV) === null) {
    place(d, { mod: PAGES_NAV, region: "left" });
    d.regions.left.features.find((f) => f.mod === PAGES_NAV).size = PAGES_NAV_PX;
  }
  return null;
}
function move(d, { region, index, delta }) {
  const r = d.regions[region];
  if (!r) return `regions.${region}: unknown region`;
  if (delta !== -1 && delta !== 1) return `regions.${region}.features: delta must be -1 or 1`;
  const to = index + delta;
  const list = r.features;
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return `regions.${region}.features[${index}]: no such feature`;
  if (to < 0 || to >= list.length) return null;
  if (region === "top" && (list[index].mod === "dock-core" || list[to].mod === "dock-core")) {
    return "regions.top.features: dock-core must stay first in the top bar";
  }
  [list[index], list[to]] = [list[to], list[index]];
  return null;
}
function applyEdit(draft, op) {
  const d = JSON.parse(JSON.stringify(draft));
  let error;
  switch (op.type) {
    case "place":
      error = place(d, op);
      break;
    case "move":
      error = move(d, op);
      break;
    case "size":
      if (!d.regions[op.region]) error = `regions.${op.region}: unknown region`;
      else if (op.region === "pages") error = "regions.pages.size: a page fills the work area, it has no size";
      else if (!isPosInt(op.value)) error = `regions.${op.region}.size: must be a positive integer`;
      else d.regions[op.region].size = op.value;
      break;
    case "hidden":
      if (!d.regions[op.region]) error = `regions.${op.region}: unknown region`;
      else if (typeof op.value !== "boolean") error = `regions.${op.region}.hidden: must be a boolean`;
      else if (op.region === "top" && op.value) error = "regions.top.hidden: the top bar can't be hidden";
      else if (op.region === "left") error = "regions.left.hidden: use the left mode instead";
      else if (op.region === "pages") error = "regions.pages.hidden: pages can't be hidden";
      else d.regions[op.region].hidden = op.value;
      break;
    case "mode":
      if (!LEFT_MODES2.includes(op.value)) error = `regions.left.mode: must be one of ${LEFT_MODES2.join(", ")}`;
      else d.regions.left.mode = op.value;
      break;
    case "production":
      error = checkBrowser({ production: op.hosts });
      if (!error) d.production = [...op.hosts];
      break;
    default:
      error = `unknown edit: ${op.type}`;
  }
  return error ? { draft, error } : { draft: d, error: null };
}
function machineSection(config, draft) {
  const base = mergeForHost({ ...config, machines: {} }, "");
  const section = {};
  for (const name of REGION_NAMES) {
    const b = base.regions[name];
    const d = draft.regions[name];
    const diff = {};
    if (d.size !== b.size && d.size !== void 0) diff.size = d.size;
    if (name === "pages") {
    } else if (name === "left") {
      if (d.mode !== b.mode) diff.mode = d.mode;
      if (config.regions?.left?.hidden === true && d.mode !== "hidden") diff.hidden = false;
    } else if (d.hidden !== b.hidden) {
      diff.hidden = d.hidden;
    }
    if (!same(d.features, b.features)) diff.features = d.features;
    for (const k of Object.keys(d)) {
      if (!EDITED.includes(k) && !same(d[k], b[k])) diff[k] = d[k];
    }
    if (Object.keys(diff).length) section[name] = diff;
  }
  return Object.keys(section).length ? section : null;
}
var isEmpty = (v) => Array.isArray(v) ? !v.length : !Object.keys(v).length;
var isNested = (v) => v !== null && typeof v === "object";
function inline(v) {
  if (!isNested(v) || isEmpty(v)) return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`;
}
function pretty(v, pad, key) {
  if (!isNested(v) || isEmpty(v)) return JSON.stringify(v);
  const inner = pad + "  ";
  if (Array.isArray(v)) {
    const rows2 = v.map((x) => inner + (key === "features" && isNested(x) && !Array.isArray(x) ? inline(x) : pretty(x, inner)));
    return `[
${rows2.join(",\n")}
${pad}]`;
  }
  const rows = Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner, k)}`);
  return `{
${rows.join(",\n")}
${pad}}`;
}
function formatConfig(obj) {
  return pretty(obj, "") + "\n";
}
function withProduction(browser, hosts, shared2) {
  const out = { ...browser ?? {} };
  if (same(hosts, shared2)) delete out.production;
  else out.production = [...hosts];
  return out;
}
function planSave(baseText, localText, host, draft) {
  const base = parseConfig(baseText);
  if (!base.ok) return { ok: false, error: base.error };
  const local = parseLocal(localText);
  if (!local.ok) return { ok: false, error: local.error };
  const shared2 = mergeForHost(base.config, host);
  const { enabled } = browserOf(mergeForHost(base.config, host, local.local));
  const section = machineSection({ v: 1, regions: shared2.regions, browser: { enabled } }, draft);
  const { v: _v, regions: _r, ...rest } = local.local ?? {};
  if (draft.production !== void 0) {
    const browser = withProduction(rest.browser, draft.production, browserOf(shared2).production);
    if (Object.keys(browser).length) rest.browser = browser;
    else delete rest.browser;
  }
  const text = formatConfig({ v: 1, regions: section ?? {}, ...rest });
  const check = parseLocal(text);
  return check.ok ? { ok: true, text } : { ok: false, error: check.error };
}
function planReset(localText = null) {
  const { ok, local } = parseLocal(localText);
  if (ok && local && "browser" in local) return { ok: true, text: formatConfig({ v: 1, regions: {}, browser: local.browser }) };
  return { ok: true, delete: true };
}
var EMPTY_LOCAL = formatConfig({ v: 1, regions: {} });

// src/shared/inventory.js
var HELPER_MODS = [
  "confirm",
  "prompt",
  "toast",
  "menu",
  "new-menu",
  "help",
  "peek",
  "pane",
  "terminals-pane",
  "worktree"
];
function placeability(id, modJson) {
  if (id === "dock-config" || id === "dock-rail") return "self";
  if (id.startsWith("_") || id.startsWith(".")) return "hidden-name";
  if (modJson === null || typeof modJson !== "object") return "broken";
  if (HELPER_MODS.includes(id)) return "helper";
  if (modJson.overlay && modJson.dock !== true && (modJson.place === "none" || modJson.place === void 0)) return "overlay";
  return null;
}
function installedFallbackIds(installedJsonText) {
  try {
    const parsed = JSON.parse(installedJsonText);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.keys(parsed).filter((k) => !k.startsWith("layout:"));
  } catch {
    return [];
  }
}
function buildInventory(entries, draft, { browserEnabled = true } = {}) {
  const listed = browserEnabled ? entries : entries.filter((e) => e.id !== "dock-browser");
  const items = listed.map(({ id, modJson }) => ({
    id,
    title: typeof modJson?.title === "string" && modJson.title ? modJson.title : id,
    reason: placeability(id, modJson),
    installed: true,
    region: regionOf(draft, id)
  }));
  const seen = new Set(entries.map((e) => e.id));
  for (const name of Object.keys(draft.regions)) {
    for (const { mod } of draft.regions[name].features) {
      if (seen.has(mod)) continue;
      seen.add(mod);
      items.push({ id: mod, title: mod, reason: null, installed: false, region: regionOf(draft, mod) });
    }
  }
  const key = (i) => i.title.toLowerCase();
  return items.sort((a, b) => (a.reason === null ? 0 : 1) - (b.reason === null ? 0 : 1) || key(a).localeCompare(key(b)));
}
function modRows(inventory) {
  const normal = inventory.filter((i) => i.reason === null || i.region !== null);
  return { normal, others: inventory.filter((i) => !normal.includes(i)) };
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/shared/update.js
var UPDATE_KEY = "dock.update.state";
var TIMEOUT_MS = 10 * 60 * 1e3;
var CHECK_EVERY_MS = 6 * 60 * 60 * 1e3;

// src/shared/browser/session.js
var BROWSER_REL = "herdr-dock/browser";
var binRel = (platform) => `${BROWSER_REL}/bin/agent-browser${platform === "win32" ? ".exe" : ""}`;

// src/shared/browser/setup-result.js
var SETUP_RESULT_REL = "herdr-dock/browser/setup-result.json";
var ABANDON_MS = 15 * 6e4;
var OUTCOMES = ["ok", "failed", "unsupported"];
var isObj3 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var startResult = (action, now) => ({ state: "running", startedAt: now, action });
function parseSetupResult(text) {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj3(r)) return null;
  if (r.state === "running") return Number.isFinite(r.startedAt) ? r : null;
  return OUTCOMES.includes(r.state) ? r : null;
}
function runState(result, now) {
  if (!result) return null;
  if (result.state === "running") return now - result.startedAt >= ABANDON_MS ? "abandoned" : "running";
  return result.state;
}

// src/shared/install.js
var isText = (v) => typeof v === "string" && v.trim() !== "";
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function modeOf(src) {
  if (!isObject(src)) return null;
  if (isText(src.repo) || isText(src.config)) return "clone";
  if (src.mode === "app") return "app";
  return null;
}
function installOf(src, home) {
  const mode = modeOf(src);
  if (mode === "app") {
    return { mode, configPath: `${home}/mods/dock-core/config.json`, repo: null, versionPath: `${home}/mods/dock-core/VERSION.json` };
  }
  if (mode !== "clone" || !isText(src.config)) return null;
  const configPath = slashPath(src.config);
  const repo = isText(src.repo) ? slashPath(src.repo) : configPath.split("/").slice(0, -2).join("/");
  return { mode, configPath, repo, versionPath: null };
}
function fixHint(mode) {
  if (mode === "app") return "reinstall herdr-dock from its app/ folder";
  if (mode === "clone") return "run npm run deploy";
  return "run npm run deploy (a clone install) or reinstall herdr-dock from its app/ folder";
}

// src/shared/platform.js
function listDirCommand(platform, dir) {
  if (platform === "windows") return { command: "cmd", args: ["/c", "dir", "/b", "/ad", dir.replaceAll("/", "\\")] };
  return { command: "ls", args: ["-1", "-p", dir] };
}
function parseDirListing(platform, stdout) {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (platform === "windows") return lines;
  return lines.filter((l) => l.endsWith("/")).map((l) => l.slice(0, -1));
}

// src/mods/dock-config/browser-view.js
var ABANDONED = "the setup tab was closed or stopped";
var TAB = '"Set up the browser" tab';
var BROWSER_OFF_TIP = "Turn the browser off in the Browser section";
var isObj4 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function chromeCandidates(platform, env = {}) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    ];
  }
  if (platform === "win32") {
    return [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean).map((base) => `${base}\\Google\\Chrome\\Application\\chrome.exe`);
  }
  if (platform === "linux") {
    return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  }
  return [];
}
function browserSection({ enabled, modInstalled, binInstalled, result, updateRunning, now }) {
  const run2 = runState(result, now);
  const busy = run2 === "running" || Boolean(updateRunning);
  if (run2 === "running") return { state: "running", action: null, busy, message: "" };
  if (run2 === "abandoned") return { state: "failed", action: result.action === "off" ? "off" : "setup", busy, message: ABANDONED };
  const stale = result?.action === "on" && !enabled || result?.action === "off" && enabled;
  if (run2 && !stale) {
    const message = String(result.message ?? "");
    if (run2 === "failed") return { state: "failed", action: result.action === "off" ? "off" : "setup", busy, message };
    if (run2 === "unsupported") return { state: "unsupported", action: "off", busy, message };
  }
  if (!enabled) return { state: "off", action: "on", busy, message: "" };
  if (modInstalled && binInstalled) return { state: "on", action: "off", busy, message: "" };
  return { state: "notSetUp", action: "setup", busy, message: "" };
}
function browserRun({ mode, repo, home }) {
  const tab = (folder, argv) => ({ command: "tab.new", args: { name: "Set up the browser", folder, argv } });
  if (mode === "app") return tab(home, ["node", `${home}/mods/dock-browser/herdr-browser-setup.mjs`]);
  return tab(repo, ["node", `${repo}/scripts/deploy.mjs`]);
}
function withBrowserSetting(localText, { enabled, chrome }) {
  let file = { v: 1, regions: {} };
  if (localText != null) {
    try {
      file = JSON.parse(localText);
    } catch (e) {
      throw new Error(`local.json is not valid JSON: ${e.message}`);
    }
    if (!isObj4(file)) throw new Error("local.json must be a JSON object");
  }
  if ("browser" in file && !isObj4(file.browser)) throw new Error("local.json: browser must be an object");
  const browser = { ...file.browser, enabled: enabled === true };
  if (typeof chrome === "string") browser.chrome = chrome;
  else delete browser.chrome;
  return formatConfig({ ...file, browser });
}
function parseHosts(text) {
  const hosts = String(text ?? "").split(/[\s,]+/).filter(Boolean).map((h) => h.toLowerCase());
  const problem = checkBrowser({ production: hosts });
  if (!problem) return { ok: true, hosts };
  const bad = hosts.find((h) => checkBrowser({ production: [h] }));
  return { ok: false, error: bad ? `"${bad}" isn't a host like example.com or *.example.com` : problem };
}
function clickedResult(result, clicked) {
  if (!clicked) return result;
  const t = result?.state === "running" ? result.startedAt : result?.at;
  if (Number.isFinite(t) && t >= clicked.at) return result;
  return startResult(clicked.action, clicked.at);
}
var KNOWN_CHROMES = { chrome: "Google Chrome", "google-chrome": "Google Chrome", "google-chrome-stable": "Google Chrome", chromium: "Chromium", "chromium-browser": "Chromium" };
function chromeName(path) {
  const p = String(path ?? "");
  const app = /([^/\\]+)\.app(?:[/\\]|$)/.exec(p);
  if (app) return app[1];
  const base = p.split(/[/\\]/).pop().replace(/\.exe$/i, "");
  return KNOWN_CHROMES[base.toLowerCase()] ?? base;
}
function chromeChoices({ chrome, chromeExists, found }) {
  const out = [];
  if (chrome && chromeExists) out.push({ value: chrome, label: `${chromeName(chrome)} (from your settings)` });
  else if (found) out.push({ value: found, label: `${chromeName(found)} (found on this PC)` });
  out.push({ value: null, label: "Download Chrome for Testing" });
  return out;
}
var chosenChrome = (choices, pick) => choices.some((c) => c.value === pick) ? pick : choices[0].value;
var turnOnChrome = (pick, sharedChrome) => typeof pick === "string" ? pick : sharedChrome ? "" : null;
var SETUP_WAITS_TIP = "Save or cancel your layout edits first: setting up redeploys herdr-dock, which reloads this dialog";
var setupWaits = ({ mode, dirty }) => mode !== "app" && dirty ? SETUP_WAITS_TIP : null;
var pollDue = ({ state, reading }) => state === "running" && !reading;
var button = (label2, action, primary) => ({ label: label2, action, primary });
function sectionCopy(section, { chrome, modInstalled, binInstalled, result }) {
  const out = { head: "", tone: "dim", intro: "", note: "", button: null, secondary: null, chrome: false, hosts: false };
  switch (section.state) {
    case "off":
      return {
        ...out,
        head: "\u25CB Off",
        intro: "Let agents open and drive a real browser beside the terminal.",
        note: "Turning it on downloads agent-browser (~20 MB) and, without a Chrome, Chrome for Testing (~150 MB).",
        button: button("Turn on", "on", true),
        chrome: true
      };
    case "running":
      return { ...out, head: `${result?.action === "off" ? "Turning off\u2026" : "Setting up\u2026"} see the ${TAB}` };
    case "on":
      return { ...out, head: `\u25CF On \xB7 ${chrome ? chromeName(chrome) : "Chrome for Testing"}`, tone: "ok", button: button("Turn off", "off", false), hosts: true };
    case "failed":
      return {
        ...out,
        head: section.message ? `Setup failed: ${section.message}` : `Setup failed \u2014 see the ${TAB}`,
        tone: "bad",
        button: section.action === "off" ? button("Turn off", "off", false) : button("Set up again", "setup", true),
        secondary: section.action === "off" ? null : button("Turn off", "off", false)
      };
    case "unsupported":
      return { ...out, head: "Not available on this computer", tone: "bad", note: section.message, button: button("Turn off", "off", false) };
    default: {
      const missing = [!modInstalled && "dock-browser", !binInstalled && "agent-browser"].filter(Boolean).join(" and ");
      return { ...out, head: `\u25CF On \xB7 not set up (${missing} missing)`, tone: "accent", button: button("Set up", "setup", true) };
    }
  }
}
var PROBE = "const fs=require('fs');const names=process.argv[1].split(',').filter(Boolean);console.log(JSON.stringify({env:Object.fromEntries(names.map((n)=>[n,process.env[n]??null])),exists:process.argv.slice(2).map((p)=>fs.existsSync(p))}))";
var probeCommand = (names2, paths) => ({ command: "node", args: ["-e", PROBE, "--", names2.join(","), ...paths] });
function parseProbe(stdout, paths) {
  let r;
  try {
    r = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isObj4(r) || !isObj4(r.env) || !Array.isArray(r.exists) || r.exists.length !== paths.length) return null;
  const there = new Set(paths.filter((_p, i) => r.exists[i] === true));
  return { env: r.env, exists: (p) => there.has(p) };
}

// src/mods/dock-config/session.js
var CHANGED_NOTICE = "the dock config changed on disk; your edits were re-applied, check and save again";
var INCOMPLETE_NOTICE = "mod list may be incomplete";
var parseJson = (t) => {
  try {
    return JSON.parse(t ?? "null");
  } catch {
    return null;
  }
};
async function resolvePaths(io) {
  let path = io.shared("dock.config.path");
  let host = io.shared("dock.host");
  let localPath = io.shared("dock.config.localPath");
  let mode = null;
  if (typeof path !== "string" || !path || typeof host !== "string" || !host) {
    const src = parseJson(await io.readTextFile(`${io.appHome}/mods/dock-core/source.json`).catch(() => null));
    mode = modeOf(src);
    if (typeof path !== "string" || !path) path = installOf(src, io.appHome)?.configPath ?? null;
    if (typeof host !== "string" || !host) host = typeof src?.hostname === "string" ? src.hostname.trim().toLowerCase() : "";
  }
  if (typeof localPath !== "string" || !localPath) localPath = `${io.appHome}/${LOCAL_REL}`;
  if (!mode && path === installOf({ mode: "app" }, io.appHome).configPath) mode = "app";
  return { path, localPath: slashPath(localPath), host: host || null, mode };
}
async function loadEntries(io) {
  const modsDir = `${io.appHome}/mods`;
  let ids = null;
  try {
    const { command, args } = listDirCommand(io.platform, modsDir);
    const r = await io.exec(command, args);
    if (r.code === 0) {
      const listed = parseDirListing(io.platform, r.stdout ?? "");
      if (listed.length) ids = listed;
    }
  } catch {
    ids = null;
  }
  let notice = null;
  if (!ids) {
    notice = INCOMPLETE_NOTICE;
    ids = installedFallbackIds(await io.readTextFile(`${io.appHome}/installed.json`).catch(() => null) ?? "");
  }
  const entries = [];
  for (const id of ids) {
    const modJson = parseJson(await io.readTextFile(`${modsDir}/${id}/mod.json`).catch(() => null));
    entries.push({ id, modJson: modJson !== null && typeof modJson === "object" ? modJson : null });
  }
  return { entries, notice };
}
function parseFiles(baseText, localText, host, localPath) {
  const base = baseText === null || baseText === void 0 ? { ok: false, error: "dock.json could not be read" } : parseConfig(baseText);
  if (!base.ok) return { ok: false, error: base.error, file: "config/dock.json" };
  const local = parseLocal(localText ?? null);
  if (!local.ok) return { ok: false, error: local.error, file: localPath };
  return { ok: true, draft: draftFromConfig(base.config, host ?? "", local.local) };
}
function browserSettings(session) {
  const base = session.baseText == null ? null : parseConfig(session.baseText);
  const local = parseLocal(session.opened ?? null);
  if (!base?.ok || !local.ok) return { enabled: regionOf(session.draft, "dock-browser") !== null, chrome: "", localChrome: null, sharedChrome: "" };
  const text = (v) => typeof v === "string" ? v : "";
  const b = browserOf(mergeForHost(base.config, session.host ?? "", local.local));
  const shared2 = browserOf(mergeForHost(base.config, session.host ?? ""));
  const mine = local.local?.browser?.chrome;
  return { enabled: b.enabled === true, chrome: text(b.chrome), localChrome: typeof mine === "string" ? mine : null, sharedChrome: text(shared2.chrome) };
}
async function loadSession(io) {
  const { path, localPath, host, mode } = await resolvePaths(io);
  const baseText = path ? await io.readTextFile(path).catch(() => null) : null;
  const opened = await io.readTextFile(localPath).catch(() => null);
  const { entries, notice } = await loadEntries(io);
  let draft, readOnly = false, error = null;
  const parsed = path ? parseFiles(baseText, opened, host, localPath) : { ok: false, error: "dock.json path is unknown", file: "config/dock.json" };
  if (!parsed.ok) {
    readOnly = true;
    const applied = io.shared("dock.config.applied");
    draft = applied ? { regions: { pages: { features: [], hidden: false }, ...applied } } : draftFromConfig(DEFAULT_CONFIG, host ?? "");
    error = `${parsed.error} \u2014 fix ${parsed.file} by hand, then reopen`;
  } else {
    draft = parsed.draft;
  }
  if (!host) {
    readOnly = true;
    error = mode === "app" ? "could not read this computer's hostname" : `this computer's hostname is unknown: ${fixHint(mode)}`;
  }
  const browserEnabled = browserSettings({ baseText, opened, host, draft }).enabled;
  return {
    path,
    localPath,
    host,
    mode,
    baseText,
    opened,
    draft,
    baseDraft: draft,
    browserEnabled,
    inventory: buildInventory(entries, draft, { browserEnabled }),
    entries,
    readOnly,
    notice,
    error
  };
}
var withInventory = (s, draft) => ({ ...s, draft, inventory: buildInventory(s.entries, draft, { browserEnabled: s.browserEnabled }) });
var parseSession = (s, baseText = s.baseText, opened = s.opened) => parseFiles(baseText, opened, s.host, s.localPath);
function rebase(session, baseText, opened) {
  const parsed = parseSession(session, baseText, opened);
  if (!parsed.ok) {
    return { ...session, baseText, opened, notice: null, error: `${parsed.error} \u2014 fix ${parsed.file} by hand, then save again (your edits are kept)` };
  }
  const draft = rebaseDraft(session.baseDraft, session.draft, parsed.draft);
  const next = { ...session, baseDraft: parsed.draft, baseText, opened, notice: CHANGED_NOTICE, error: null };
  return withInventory({ ...next, browserEnabled: browserSettings(next).enabled }, draft);
}
var reread = (io, path) => path ? io.readTextFile(path).catch(() => null) : Promise.resolve(null);
async function writeLocal(session, io, makePlan) {
  const baseText = await reread(io, session.path);
  if (!parseSession(session).ok || baseText !== session.baseText) {
    return { session: rebase(session, baseText, await reread(io, session.localPath)) };
  }
  const plan = makePlan();
  if (!plan.ok) return { session: { ...session, error: plan.error } };
  const text = plan.delete ? EMPTY_LOCAL : plan.text;
  try {
    await io.writeTextFile(session.localPath, text, session.opened);
  } catch (e) {
    const fresh = await reread(io, session.localPath);
    if (fresh === session.opened) return { session: { ...session, notice: null, error: String(e) } };
    return { session: rebase(session, baseText, fresh) };
  }
  return { text };
}
async function commit(session, io, makePlan) {
  const w = await writeLocal(session, io, makePlan);
  if (w.session) return w.session;
  return { ...session, opened: w.text, baseDraft: session.draft, notice: null, error: null };
}
async function saveSession(session, io) {
  if (session.readOnly) return session;
  return commit(session, io, () => planSave(session.baseText, session.opened, session.host, session.draft));
}
async function resetSession(session, io) {
  if (session.readOnly) return session;
  const next = await commit(session, io, () => planReset(session.opened));
  if (next.error || next.notice) return next;
  const parsed = parseSession(next);
  if (!parsed.ok) return next;
  return { ...withInventory(next, parsed.draft), baseDraft: parsed.draft };
}
function isDirty(session) {
  const parsed = parseSession(session);
  if (!parsed.ok) return !session.readOnly;
  return !sameDraft(session.draft, parsed.draft);
}
var WIN_ENV = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"];
var nodePlatform = (p) => ({ windows: "win32", macos: "darwin", linux: "linux" })[p] ?? p;
async function probe(io, names2, paths) {
  const { command, args } = probeCommand(names2, paths);
  const r = await io.exec(command, args);
  const p = r.code === 0 ? parseProbe(r.stdout ?? "", paths) : null;
  if (!p) throw new Error(String(r.stderr || `node exit ${r.code}`).trim());
  return p;
}
async function readBrowserStatus(session, io) {
  const { enabled, chrome, localChrome, sharedChrome } = browserSettings(session);
  const platform = nodePlatform(io.platform);
  const mod = `${io.appHome}/mods/dock-browser`;
  const bin = `${io.appHome}/${binRel(platform)}`;
  const result = parseSetupResult(await io.readTextFile(`${io.appHome}/${SETUP_RESULT_REL}`).catch(() => null));
  let exists = () => false;
  let candidates = [];
  let problem = null;
  try {
    const env = platform === "win32" ? (await probe(io, WIN_ENV, [])).env : {};
    candidates = chromeCandidates(platform, env);
    exists = (await probe(io, [], [mod, bin, ...chrome ? [chrome] : [], ...candidates])).exists;
  } catch (e) {
    problem = `couldn't check the browser's files: ${e?.message ?? e}`;
  }
  return {
    enabled,
    chrome,
    localChrome,
    sharedChrome,
    modInstalled: exists(mod),
    binInstalled: exists(bin),
    chromeExists: Boolean(chrome) && exists(chrome),
    found: candidates.find(exists) ?? null,
    result,
    problem
  };
}
async function writeStart(io, result) {
  const path = `${io.appHome}/${SETUP_RESULT_REL}`;
  try {
    const now = await io.readTextFile(path).catch(() => null);
    await io.writeTextFile(path, JSON.stringify(result), now);
    return true;
  } catch {
    return false;
  }
}
async function setBrowser(session, io, { action, chrome = null, mode, repo, now }) {
  const none = (s) => ({ session: s, ran: false, recorded: false });
  if (session.readOnly) return none(session);
  if (mode !== "app" && !repo) return none({ ...session, error: `can't set up the browser: herdr-dock's folder is unknown (${fixHint(mode)})` });
  const enabled = action !== "off";
  const w = await writeLocal(session, io, () => {
    try {
      return { ok: true, text: withBrowserSetting(session.opened, { enabled, chrome }) };
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });
  if (w.session) return none(w.session);
  let next = { ...session, opened: w.text, notice: null, error: null };
  const parsed = parseSession(next);
  if (parsed.ok) {
    const on = browserSettings(next).enabled;
    const kept = rebaseDraft(session.baseDraft, session.draft, parsed.draft);
    const draft = { ...kept, regions: withBrowserFeature(kept.regions, on) };
    next = withInventory({ ...next, baseDraft: parsed.draft, browserEnabled: on }, draft);
  }
  const recorded = await writeStart(io, startResult(enabled ? "on" : "off", now));
  const { command, args } = browserRun({ mode, repo, home: io.appHome });
  io.run(command, args);
  return { session: next, ran: true, recorded };
}

// src/mods/dock-config/browser-section.js
import { div as div2 } from "gpui-kit";
import { h_flex as h_flex2, v_flex, Input } from "gpui-base";

// src/mods/dock-config/ui.js
import { div, svg } from "gpui-kit";
import { h_flex, Switch } from "gpui-base";
var icon = (name) => svg(`mods/dock-config/${name}.svg`);
function iconButton(t, id, name, tip, enabled, onClick) {
  return h_flex().id(id).size(22).flex_none().items_center().justify_center().rounded(6).tooltip(tip).when(enabled, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick)).when(!enabled, (el) => el.text_color(t.dim).opacity(0.35)).child(icon(name).size(12));
}
function button2(t, id, label2, { primary = false, enabled = true, tip = null } = {}, onClick) {
  return h_flex().id(id).h(28).px(12).flex_none().items_center().rounded(7).text_size(12.5).when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground)).when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.foreground)).when(enabled, (el) => el.cursor_pointer().on_click(onClick).hover((s) => primary ? s.opacity(0.9) : s.bg(t.hover))).when(!enabled, (el) => el.opacity(0.4)).when(Boolean(tip), (el) => el.tooltip(tip)).child(label2);
}
function toggle(t, id, on, enabled, onChange) {
  return Switch.new(id).checked(on).disabled(!enabled).on_change(onChange).flex().flex_row().items_center().flex_none().w(28).h(16).p(2).rounded_full().bg(on ? t.accent : t.border).when(enabled, (el) => el.cursor_pointer()).when(!enabled, (el) => el.opacity(0.4)).child(div().size(12).rounded_full().bg(on ? t.accent_foreground : t.muted).when(on, (el) => el.ml(12)));
}
function segmented(t, id, options, selected, onPick) {
  return h_flex().flex_none().p(2).gap(2).rounded(7).bg(t.background).border_1().border_color(t.border).children(options.map((o) => {
    const on = o.value === selected;
    return h_flex().id(`${id}-${o.value}`).h(22).px(8).items_center().rounded(5).text_size(12).when(Boolean(o.tip), (el) => el.tooltip(o.tip)).when(on, (el) => el.bg(t.selected).text_color(t.foreground)).when(!on && o.enabled, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => onPick(o.value, cx))).when(!on && !o.enabled, (el) => el.text_color(t.dim).opacity(0.4)).child(o.label);
  }));
}
var tag = (t, text) => div().flex_none().px(6).py(1).rounded(4).text_size(11).text_color(t.dim).border_1().border_color(t.border).child(text);

// src/mods/dock-config/browser-section.js
var HOSTS_NOTE = "Agents get a warning on these sites; nothing is blocked.";
function chromeRow(dlg, t, choices, picked, enabled) {
  return h_flex2().gap(10).items_center().min_h(24).child(div2().flex_none().text_color(t.muted).child("Chrome:")).children(choices.map((c, i) => {
    const on = c.value === picked;
    return h_flex2().id(`dc-chrome-${i}`).flex_none().h(22).px(4).gap(6).items_center().rounded(5).text_color(on ? t.foreground : t.muted).when(enabled && !on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => dlg.pickChrome(c.value, cx))).when(!enabled, (el) => el.opacity(0.5)).child(div2().flex_none().text_color(on ? t.accent : t.dim).child(on ? "\u25CF" : "\u25CB")).child(c.label);
  }));
}
function hostsRow(dlg, t, enabled) {
  const error = dlg.hostsError;
  return v_flex().gap(4).child(h_flex2().gap(8).items_center().child(div2().flex_none().text_color(t.muted).child("Production hosts")).child(Input.new(dlg.hostsInput).disabled(!enabled).flex_1().min_w(0).h(26).px(8).rounded(6).bg(t.background).border_1().border_color(error ? t.blocked : t.border).text_size(12.5).text_color(t.foreground))).child(div2().text_size(12).text_color(error ? t.blocked : t.dim).child(error ?? HOSTS_NOTE));
}
function browserSectionView(dlg, t) {
  const m = dlg.browserModel();
  const label2 = div2().flex_none().text_size(12.5).text_color(t.muted).child("Browser");
  const row = h_flex2().id("dc-browser").gap(8).items_start().text_size(12.5);
  if (!m) return row.child(label2.mt(6)).child(div2().min_h(28).flex().items_center().text_color(t.dim).child("Checking\u2026"));
  const { copy, status, editable, enabled, tip } = m;
  const tone = { ok: t.done ?? t.accent, bad: t.blocked, accent: t.accent, dim: t.dim }[copy.tone] ?? t.dim;
  const draw = (b) => button2(
    t,
    `dc-browser-${b.action}`,
    dlg.busy === "browser" && dlg.browserDoing === b.action ? "Working\u2026" : b.label,
    { primary: b.primary, enabled, tip },
    (_e, cx) => dlg.browserAction(b.action, cx)
  );
  const act = copy.button && editable ? draw(copy.button) : null;
  const second = copy.secondary && editable ? draw(copy.secondary) : null;
  const choices = chromeChoices(status);
  const picked = chosenChrome(choices, dlg.chromePick);
  const head = h_flex2().gap(10).items_center().min_h(28).child(div2().flex_none().text_color(tone).child(copy.head)).child(div2().flex_1().min_w(0).text_color(t.muted).child(copy.intro)).when(Boolean(second), (el) => el.child(second)).when(Boolean(act) && !copy.chrome, (el) => el.child(act));
  return row.child(label2.mt(6)).child(v_flex().flex_1().min_w(0).gap(4).child(head).when(Boolean(copy.note), (el) => el.child(div2().text_color(t.dim).child(copy.note))).when(Boolean(status.problem), (el) => el.child(div2().text_color(t.dim).child(status.problem))).when(copy.chrome && editable, (el) => el.child(chromeRow(dlg, t, choices, picked, enabled))).when(Boolean(act) && copy.chrome, (el) => el.child(h_flex2().child(act))).when(copy.hosts && editable, (el) => el.child(hostsRow(dlg, t, dlg.editable()))));
}

// src/mods/dock-config/by-mod.js
import { div as div3 } from "gpui-kit";
import { h_flex as h_flex3, v_flex as v_flex2 } from "gpui-base";
var SEGMENTS = [["off", "Off"], ["top", "Top"], ["left", "Left"], ["right", "Right"], ["bottom", "Bottom"], ["pages", "Page"]];
var REASONS = {
  self: "this dialog",
  "hidden-name": "hidden folder",
  broken: "broken mod.json",
  helper: "used by other mods",
  overlay: "dialog or popup"
};
var names = (t, item) => [
  div3().w(200).flex_none().truncate().child(item.title),
  div3().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(item.id)
];
function modRow(dlg, t, item, dimmed) {
  const s = dlg.session;
  const options = SEGMENTS.map(([value, text]) => {
    if (value === "off" && item.id === "dock-browser") return { value, label: text, enabled: false, tip: BROWSER_OFF_TIP };
    const error = applyEdit(s.draft, { type: "place", mod: item.id, region: value }).error;
    return { value, label: text, enabled: dlg.editable() && !error, tip: error };
  });
  return h_flex3().id(`dc-mod-${item.id}`).h(34).px(4).gap(8).items_center().rounded(6).hover((st) => st.bg(t.hover)).children(names(t, item).map((el) => dimmed ? el.opacity(0.5) : el)).when(!item.installed, (el) => el.child(tag(t, "not installed"))).when(item.reason !== null, (el) => el.child(tag(t, REASONS[item.reason] ?? item.reason))).child(segmented(
    t,
    `dc-seg-${item.id}`,
    options,
    item.region ?? "off",
    (region, cx) => dlg.act(cx, { type: "place", mod: item.id, region })
  ));
}
function byMod(dlg, t) {
  const { normal, others } = modRows(dlg.session.inventory);
  return [
    h_flex3().h(36).gap(8).items_center().child(div3().flex_1().text_size(12).text_color(t.dim).child(`${normal.length} mods can be placed`)).child(div3().text_size(12).text_color(t.muted).child("Show all mods")).child(toggle(t, "dc-show-all", dlg.showAll, true, (on, cx) => {
      dlg.showAll = on;
      cx.notify();
    })),
    v_flex2().gap(1).children(normal.map((i) => modRow(dlg, t, i, false))),
    ...dlg.showAll && others.length ? [v_flex2().gap(1).pt(8).mt(6).border_t(1).border_color(t.border).children(others.map((i) => modRow(dlg, t, i, true)))] : []
  ];
}

// src/mods/dock-config/by-region.js
import { div as div4 } from "gpui-kit";
import { h_flex as h_flex4, v_flex as v_flex3, NumberInput, Popover } from "gpui-base";

// src/shared/fit-height.js
function fitHeight({ rows = 0, rowH = 0, gap = 0, pad = 0, extra = 0, max = Infinity } = {}) {
  const n = Math.max(0, rows);
  return Math.min(max, n * rowH + Math.max(0, n - 1) * gap + pad + extra);
}
var GLYPH = 0.55;
var LINE = 1.618;
var lineHeight = (size) => Math.ceil(size * LINE);
var units = (text) => {
  let n = 0;
  for (const ch of String(text ?? "")) n += ch.codePointAt(0) >= 11904 ? 2 : 1;
  return n;
};
function textLines(text, width, size) {
  const cap = Math.max(1, Math.floor(width / (size * GLYPH)));
  let lines = 0;
  for (const paragraph of String(text ?? "").split("\n")) {
    let n = 1, used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const w = units(word);
      if (used === 0) used = w;
      else if (used + 1 + w <= cap) used += 1 + w;
      else {
        n++;
        used = w;
      }
      while (used > cap) {
        n++;
        used -= cap;
      }
    }
    lines += n;
  }
  return lines;
}
var textHeight = (text, { width, size }) => textLines(text, width, size) * lineHeight(size);

// src/mods/dock-config/by-region.js
var LEFT_MODES3 = [["expanded", "expanded"], ["icons", "icons"], ["hidden", "hidden"]];
var LABEL_W = 64;
var ADD_W = 280;
var ADD_MAX_H = 300;
var ADD_NONE = "Every mod that fits here is already in it";
var label = (t, text) => div4().flex_none().text_size(12).text_color(t.dim).child(text);
function sizeInput(dlg, t, region) {
  const step = (h) => h_flex4().w(18).h(11).items_center().justify_center().text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground)).child(icon(h).size(10));
  return NumberInput.new(dlg.sizes[region]).controls_right().disabled(!dlg.editable()).flex().flex_row().items_center().w(84).h(26).pl(8).pr(2).rounded(6).bg(t.background).border_1().border_color(t.border).text_size(12.5).on_step((action, cx) => dlg.step(region, action === "increment" ? 1 : -1, cx)).decrement_button(step("chevron-down")).increment_button(step("chevron-up"));
}
function regionControls(dlg, t, region) {
  const r = dlg.session.draft.regions[region];
  const on = dlg.editable();
  const title = div4().w(LABEL_W).flex_none().text_size(11.5).font_semibold().text_color(t.muted).child(region.toUpperCase());
  if (region === "pages") {
    return h_flex4().h(32).gap(10).items_center().child(title).child(label(t, "shown one at a time in place of the terminal, from the Pages list (Ctrl+Alt+P cycles)"));
  }
  const row = h_flex4().h(32).gap(10).items_center().child(title).child(label(t, "size")).child(sizeInput(dlg, t, region));
  if (region === "right" || region === "bottom") {
    const text = region === "right" ? "shown by default" : "shown";
    return row.child(label(t, text)).child(toggle(
      t,
      `dc-shown-${region}`,
      !r.hidden,
      on,
      (shown, cx) => dlg.act(cx, { type: "hidden", region, value: !shown })
    ));
  }
  if (region === "left") {
    return row.child(label(t, "start as")).child(segmented(
      t,
      "dc-mode",
      LEFT_MODES3.map(([value, text]) => ({ value, label: text, enabled: on })),
      r.mode,
      (value, cx) => dlg.act(cx, { type: "mode", value })
    ));
  }
  return row;
}
function featureRow(dlg, t, region, list, i) {
  const f = list[i];
  const item = dlg.item(f.mod);
  const on = dlg.editable();
  const pinned = (m) => region === "top" && m === "dock-core";
  const canUp = on && i > 0 && !pinned(f.mod) && !pinned(list[i - 1].mod);
  const canDown = on && i < list.length - 1 && !pinned(f.mod) && !pinned(list[i + 1].mod);
  const controls = f.mod === "dock-core" ? [h_flex4().id("dc-lock").size(22).items_center().justify_center().text_color(t.dim).tooltip("dock-core stays first in the top bar").child(icon("lock").size(12))] : [
    iconButton(t, `dc-up-${region}-${i}`, "chevron-up", "Move up", canUp, (_e, cx) => dlg.act(cx, { type: "move", region, index: i, delta: -1 })),
    iconButton(t, `dc-down-${region}-${i}`, "chevron-down", "Move down", canDown, (_e, cx) => dlg.act(cx, { type: "move", region, index: i, delta: 1 })),
    f.mod === "dock-browser" ? iconButton(t, `dc-off-${region}-${i}`, "x", BROWSER_OFF_TIP, false, null) : iconButton(t, `dc-off-${region}-${i}`, "x", "Turn off", on, (_e, cx) => dlg.act(cx, { type: "place", mod: f.mod, region: "off" }))
  ];
  return h_flex4().id(`dc-row-${region}-${f.mod}`).h(28).pl(LABEL_W + 10).pr(4).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover)).child(div4().w(200).flex_none().truncate().child(item?.title ?? f.mod)).child(div4().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(f.mod)).when(item && !item.installed, (el) => el.child(tag(t, "not installed"))).child(h_flex4().flex_none().gap(2).children(controls));
}
function addMod(dlg, t, region) {
  const trigger = (enabled) => h_flex4().id(`dc-add-${region}-trigger`).h(26).px(8).gap(6).items_center().rounded(6).text_size(12.5).text_color(t.muted).when(enabled, (el) => el.cursor_pointer().hover((s2) => s2.bg(t.hover).text_color(t.foreground))).when(!enabled, (el) => el.opacity(0.4)).child(icon("plus").size(12)).child("Add mod").child(icon("chevron-down").size(11));
  const wrap = (el) => h_flex4().pl(LABEL_W + 6).child(el);
  if (!dlg.editable()) return wrap(trigger(false));
  const s = dlg.session;
  const candidates = s.inventory.filter((i) => i.reason === null && i.region !== region && allowedRegions(i.id).includes(region));
  const rows = candidates.map((i) => h_flex4().id(`dc-add-${region}-${i.id}`).h(28).px(8).gap(8).flex_none().items_center().rounded(6).cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => {
    dlg.addOpen = null;
    dlg.act(cx, { type: "place", mod: i.id, region });
  }).child(div4().flex_1().min_w(0).truncate().child(i.title)).child(div4().flex_none().text_size(11.5).text_color(t.dim).child(i.region ? `in ${i.region}` : i.id)));
  const height = fitHeight({
    rows: rows.length,
    rowH: 28,
    gap: 1,
    pad: 10,
    max: ADD_MAX_H,
    extra: rows.length ? 0 : textHeight(ADD_NONE, { width: ADD_W - 2 - 8 - 16, size: 12.5 }) + 16
  });
  const content = v_flex3().flex_none().w(ADD_W).h(height).min_h(0).rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).child(v_flex3().id(`dc-add-${region}-list`).flex_1().min_h(0).overflow_y_scrollbar().p(4).gap(1).children(rows.length ? rows : [div4().p(8).text_color(t.dim).child(ADD_NONE)]));
  return wrap(Popover.new(`dc-add-${region}`).open(dlg.addOpen === region).on_open_change((open, cx) => {
    dlg.addOpen = open ? region : null;
    cx.notify();
  }).trigger(trigger(true)).content(content));
}
function byRegion(dlg, t) {
  const regions = dlg.session.draft.regions;
  return ["top", "left", "right", "bottom", "pages"].map((region) => {
    const list = regions[region].features;
    return v_flex3().gap(2).py(8).border_b(1).border_color(t.border).child(regionControls(dlg, t, region)).children(list.map((_f, i) => featureRow(dlg, t, region, list, i))).when(!list.length, (el) => el.child(div4().pl(LABEL_W + 10).h(24).text_size(12).text_color(t.dim).child("no mods"))).child(addMod(dlg, t, region));
  });
}

// src/shared/claude.js
function formatAge(ms) {
  if (ms < 6e4) return "just now";
  const m = Math.floor(ms / 6e4);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// src/mods/dock-config/update-view.js
var CHECK = { label: "Check now", kind: "check" };
var UPDATE = { label: "Update", kind: "update" };
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function updateStrip(state, now) {
  if (!state || typeof state !== "object") return { text: "herdr-dock \xB7 not checked yet", tone: "dim", action: CHECK };
  const reason = String(state.reason ?? "").trim() || "unknown error";
  const app = state.mode === "app";
  if (app && state.status === "available") {
    return { text: `Update available \xB7 ${state.current ?? "?"} \u2192 ${state.latest ?? "?"}`, tone: "accent", action: UPDATE };
  }
  if (app && state.status === "blocked") {
    return { text: reason.startsWith("Can't check:") ? reason : `Can't check: ${reason}`, tone: "bad", action: CHECK };
  }
  switch (state.status) {
    case "checking":
      return { text: "Checking\u2026", tone: "dim", action: null };
    case "updating":
      return { text: 'Updating\u2026 see the "Update herdr-dock" tab', tone: "dim", action: null };
    case "available": {
      if (state.redeploy) {
        return { text: `Not deployed yet \xB7 ${state.deployed ?? "?"} \u2192 ${state.current ?? "?"}`, tone: "accent", action: UPDATE };
      }
      const latest = state.subject ? ` (latest: "${state.subject}")` : "";
      return { text: `Update available \xB7 ${plural(state.behind ?? 0, "new commit")}${latest}`, tone: "accent", action: UPDATE };
    }
    case "updated": {
      const commits = typeof state.commits === "number" ? ` \xB7 ${plural(state.commits, "commit")}` : "";
      return { text: `\u2713 Updated to ${state.current ?? "?"}${commits}`, tone: "ok", action: CHECK };
    }
    case "blocked":
      return { text: `Can't update: ${reason}`, tone: "bad", action: CHECK };
    case "failed":
      return { text: reason.startsWith("Can't check:") ? reason : `Update failed: ${reason}`, tone: "bad", action: CHECK };
    default: {
      const sha = state.current ? ` ${state.current}` : "";
      const age = typeof state.checkedAt === "number" ? ` \xB7 checked ${formatAge(Math.max(0, now - state.checkedAt))}` : "";
      return { text: `herdr-dock${sha} \xB7 up to date${age}`, tone: "dim", action: CHECK };
    }
  }
}
function updateRuns(state, { repo, home }) {
  const tab = (folder, argv) => ({ command: "tab.new", args: { name: "Update herdr-dock", folder, argv } });
  if (state?.mode === "app") {
    if (!home) return null;
    return [{ command: "dock-core.update.start" }, tab(home, ["node", `${home}/mods/dock-core/update-app.mjs`])];
  }
  if (!repo) return null;
  return [{ command: "dock-core.update.start" }, tab(repo, ["node", "scripts/update.mjs"])];
}
var UPDATE_WAITS_TIP = "Save or cancel your layout edits first: updating replaces herdr-dock's mods, which reloads this dialog";
var updateWaits = ({ kind, dirty }) => kind === "update" && dirty ? UPDATE_WAITS_TIP : null;

// src/mods/dock-config/main.js
var REGIONS = ["top", "left", "right", "bottom"];
var VIEW_KEY = "dock.config.view";
var VIEWS = [["region", "By region"], ["mod", "By mod"]];
var REPO_KEY = "dock.config.repo";
var BROWSER_POLL_MS = 3e3;
var makeIo = () => ({
  readTextFile,
  writeTextFile,
  exec,
  run,
  shared,
  appHome: slashPath(appHome()),
  platform: window()?.platform
});
function checkSession() {
  const draft = draftFromConfig(DEFAULT_CONFIG, "");
  return {
    path: null,
    localPath: null,
    host: null,
    mode: null,
    baseText: null,
    opened: null,
    draft,
    baseDraft: draft,
    browserEnabled: false,
    inventory: buildInventory([], draft, { browserEnabled: false }),
    entries: [],
    readOnly: true,
    notice: null,
    error: null
  };
}
var CHECK_BROWSER = { enabled: false, chrome: "", localChrome: null, sharedChrome: "", modInstalled: false, binInstalled: false, chromeExists: false, found: null, result: null, problem: null };
var DockConfig = class extends View {
  init(_props, cx) {
    this.session = null;
    this.loadError = null;
    this.editError = null;
    this.busy = null;
    this.confirmReset = false;
    this.showAll = false;
    this.addOpen = null;
    this.browser = null;
    this.clicked = null;
    this.reading = false;
    this.browserDoing = null;
    this.readAgain = false;
    this.chromePick = void 0;
    this.hostsError = null;
    this.hostsInput = InputState.new({ placeholder: "example.com, *.example.com" });
    this.hostsInput.on("change", (_e, cx2) => this.typedHosts(cx2));
    this.sizes = {};
    for (const region of REGIONS) {
      const state = InputState.new({ value: "" });
      state.set_step(1);
      state.set_min(1);
      state.on("change", (_e, cx2) => this.typedSize(region, cx2));
      state.on("blur", (_e, cx2) => {
        this.editError = null;
        this.showSize(region);
        cx2.notify();
      });
      this.sizes[region] = state;
    }
    if (checking()) {
      this.session = checkSession();
      this.browser = CHECK_BROWSER;
      return;
    }
    cx.timer.every(BROWSER_POLL_MS, (cx2) => {
      if (pollDue({ state: this.browserModel()?.section.state, reading: this.reading })) cx2.spawn(async (cx3) => this.readBrowser(cx3));
    });
    cx.spawn(async (cx2) => {
      try {
        this.session = await loadSession(makeIo());
        this.showSizes();
        this.showHosts();
      } catch (e) {
        this.loadError = `could not load the dock config: ${e?.message ?? e}`;
      }
      cx2.notify();
      if (this.session) await this.readBrowser(cx2);
    });
  }
  editable() {
    return Boolean(this.session) && !this.session.readOnly && !this.busy;
  }
  item(id) {
    return this.session.inventory.find((i) => i.id === id) ?? null;
  }
  // Every edit goes through applyEdit; a refused one leaves the draft and shows why.
  act(cx, op) {
    if (!this.editable()) return;
    const s = this.session;
    const ops = [op];
    if (op.type === "place" && (op.region === "right" || op.region === "bottom") && s.draft.regions[op.region].hidden) {
      ops.push({ type: "hidden", region: op.region, value: false });
    }
    let draft = s.draft;
    for (const o of ops) {
      const r = applyEdit(draft, o);
      if (r.error) {
        this.editError = r.error;
        cx.notify();
        return;
      }
      draft = r.draft;
    }
    this.editError = null;
    this.session = { ...s, draft, inventory: buildInventory(s.entries, draft, { browserEnabled: s.browserEnabled }), error: null };
    cx.notify();
  }
  showSize(region) {
    const size = this.session?.draft.regions[region].size;
    this.sizes[region].set_value(size === void 0 ? "" : String(size));
  }
  showSizes() {
    for (const region of REGIONS) this.showSize(region);
  }
  typedSize(region, cx) {
    const text = this.sizes[region].value().trim();
    if (!text || !this.session || Number(text) === this.session.draft.regions[region].size) return;
    this.act(cx, { type: "size", region, value: Number(text) });
  }
  // The production hosts field shows the draft's hosts again (after load, Save, Reset, a browser action).
  showHosts() {
    this.hostsError = null;
    this.hostsInput.set_value((this.session?.draft.production ?? []).join(", "));
  }
  // Valid hosts go into the draft; invalid ones show why under the field and hold Save back.
  typedHosts(cx) {
    if (!this.session) return;
    const r = parseHosts(this.hostsInput.value());
    this.hostsError = r.ok ? null : r.error;
    const now = this.session.draft.production ?? [];
    if (r.ok && r.hosts.join(",") !== now.join(",")) this.act(cx, { type: "production", hosts: r.hosts });
    else cx.notify();
  }
  step(region, delta, cx) {
    if (!this.session) return;
    const size = this.session.draft.regions[region].size;
    const value = stepSize(size, delta);
    if (value !== size) this.act(cx, { type: "size", region, value });
    this.showSize(region);
  }
  // Save or reset; edits wait (editable() is false) until it's done.
  write(cx, fn, kind) {
    if (!this.session || this.session.readOnly || this.busy) return;
    this.busy = kind;
    this.confirmReset = false;
    cx.notify();
    cx.spawn(async (cx2) => {
      try {
        this.session = await fn(this.session, makeIo());
        this.editError = null;
        this.showSizes();
        this.showHosts();
      } catch (e) {
        this.editError = `${e?.message ?? e}`;
      } finally {
        this.busy = null;
        cx2.notify();
      }
      await this.readBrowser(cx2);
    });
  }
  cancel() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }
  header(t) {
    const host = this.session?.host ?? shared("dock.host");
    return h_flex5().gap(10).items_baseline().child(div5().text_size(15).font_semibold().child("Dock layout")).child(div5().text_size(12.5).text_color(t.dim).child(`this PC: ${host || "unknown"}`));
  }
  // The Updates strip: dock-core's update state, with Check now or Update.
  updates(t) {
    const state = checking() ? null : shared(UPDATE_KEY);
    const strip = updateStrip(state, Date.now());
    const color = { accent: t.accent, ok: t.done ?? t.accent, bad: t.blocked, dim: t.dim }[strip.tone] ?? t.dim;
    const runs = updateRuns(state, { repo: shared(REPO_KEY), home: slashPath(appHome()) });
    const action = strip.action;
    const waits = this.updateWaits(action?.kind);
    const canUpdate = action?.kind !== "update" || Boolean(runs) && !this.browserRunning() && !waits;
    return h_flex5().id("dc-updates").gap(8).items_center().min_h(28).child(div5().flex_none().text_size(12.5).text_color(t.muted).child("Updates")).child(div5().flex_1().min_w(0).text_size(12.5).text_color(color).truncate().child(strip.tone === "accent" ? `\u25CF ${strip.text}` : strip.text)).when(Boolean(action), (el) => el.child(button2(
      t,
      `dc-update-${action.kind}`,
      action.label,
      { primary: action.kind === "update", enabled: canUpdate && !checking(), tip: waits },
      () => this.updateAction(action.kind, runs)
    )));
  }
  updateWaits(kind) {
    return updateWaits({ kind, dirty: Boolean(this.session) && isDirty(this.session) });
  }
  updateAction(kind, runs) {
    if (kind === "check") {
      run("dock-core.update.check");
      return;
    }
    if (!runs || this.browserRunning() || this.updateWaits(kind)) return;
    for (const r of runs) {
      if (r.args) run(r.command, r.args);
      else run(r.command);
    }
  }
  browserRunning() {
    return this.browserModel()?.section.state === "running";
  }
  // The Browser section's model: { section (browserSection), copy (sectionCopy), status, editable, enabled, tip (why the
  // buttons wait for unsaved edits, or null) }, or null until the status is read.
  browserModel() {
    const s = this.session;
    const st = this.browser;
    if (!s || !st) return null;
    const result = clickedResult(st.result, this.clicked);
    const updating = !checking() && shared(UPDATE_KEY)?.status === "updating";
    const section = browserSection({ ...st, result, updateRunning: updating, now: Date.now() });
    const editable = !s.readOnly;
    const how = this.browserRunsWith();
    const tip = editable && how ? setupWaits({ mode: how.mode, dirty: isDirty(s) }) : null;
    const enabled = editable && !this.busy && !section.busy && Boolean(how) && !tip;
    return { section, copy: sectionCopy(section, { ...st, result }), status: st, editable, enabled, tip };
  }
  // Where the setup runs, as the Updates strip's Update does: the clone's repo, or the app install's home. null: unknown.
  browserRunsWith() {
    const repo = shared(REPO_KEY) ?? null;
    const mode = this.session?.mode ?? shared(UPDATE_KEY)?.mode ?? (repo ? "clone" : null);
    return mode === "app" || repo ? { mode, repo } : null;
  }
  // Reads the status (again, when asked during a read). The init timer re-reads it while a setup runs.
  async readBrowser(cx) {
    if (!this.session) return;
    if (this.reading) {
      this.readAgain = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.readAgain = false;
        this.browser = await readBrowserStatus(this.session, makeIo());
        if (this.clicked && clickedResult(this.browser.result, this.clicked) === this.browser.result) this.clicked = null;
      } while (this.readAgain);
    } catch (e) {
      console.log(`dock-config: browser status not read: ${e?.message ?? e}`);
    } finally {
      this.reading = false;
    }
    cx.notify();
  }
  pickChrome(value, cx) {
    this.chromePick = value;
    cx.notify();
  }
  // Turn on (with the chosen Chrome; the download wins over a shared chrome), Turn off or Set up (this PC's chrome
  // passed through): written at once, then the "Set up the browser" tab. A local.json changed on disk is refused with
  // the changed-on-disk notice.
  browserAction(action, cx) {
    const how = this.browserRunsWith();
    if (!this.browserModel()?.enabled || !how) return;
    const chrome = action === "on" ? turnOnChrome(chosenChrome(chromeChoices(this.browser), this.chromePick), this.browser.sharedChrome) : this.browser.localChrome;
    const now = Date.now();
    this.busy = "browser";
    this.browserDoing = action;
    this.confirmReset = false;
    cx.notify();
    cx.spawn(async (cx2) => {
      try {
        const r = await setBrowser(this.session, makeIo(), { action, chrome, ...how, now });
        this.session = r.session;
        this.editError = null;
        if (r.ran) this.clicked = { at: now, action: action === "off" ? "off" : "on" };
        this.showSizes();
        this.showHosts();
      } catch (e) {
        this.editError = `${e?.message ?? e}`;
      } finally {
        this.busy = null;
        this.browserDoing = null;
        cx2.notify();
      }
      await this.readBrowser(cx2);
    });
  }
  banner(t) {
    const s = this.session;
    const errors = [...new Set([shared("dock.config.error"), s?.error, this.editError, this.loadError].filter(Boolean))];
    return v_flex4().gap(6).children(errors.map((e, i) => h_flex5().id(`dc-error-${i}`).px(10).py(6).gap(8).rounded(8).text_size(12.5).bg(t.blocked + "14").border_1().border_color(t.blocked + "40").text_color(t.foreground).child(div5().flex_none().text_color(t.blocked).child("\u26A0")).child(div5().flex_1().min_w(0).child(String(e))))).when(Boolean(s?.notice), (el) => el.child(div5().px(2).text_size(12.5).text_color(t.muted).child(s.notice)));
  }
  tabs(t, view) {
    return h_flex5().child(Tabs.new("dc-tabs").flex().flex_row().gap(2).p(2).rounded(8).bg(t.background).border_1().border_color(t.border).children(VIEWS.map(([value, text], i) => Tab.new(`dc-tab-${value}`).selected(view === value).set_position(i + 1, VIEWS.length).flex().flex_row().items_center().h(24).px(12).rounded(6).text_size(12.5).when(view === value, (el) => el.bg(t.selected).text_color(t.foreground)).when(view !== value, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))).on_click(() => setShared(VIEW_KEY, value)).child(text))));
  }
  footer(t) {
    const s = this.session;
    const canWrite = Boolean(s) && !s.readOnly && !this.busy;
    const dirty = Boolean(s) && isDirty(s);
    const reset = this.confirmReset ? h_flex5().gap(6).items_center().child(div5().text_size(12.5).child("Reset this PC to shared?")).child(button2(t, "dc-reset-yes", "Yes", { enabled: canWrite }, (_e, cx) => this.write(cx, resetSession, "reset"))).child(button2(t, "dc-reset-no", "No", {}, (_e, cx) => {
      this.confirmReset = false;
      cx.notify();
    })) : h_flex5().id("dc-reset").h(28).px(8).items_center().rounded(7).text_size(12.5).text_color(t.muted).when(canWrite, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => {
      this.confirmReset = true;
      cx.notify();
    })).when(!canWrite, (el) => el.opacity(0.4)).child("Reset this PC to shared");
    return h_flex5().flex_none().h(52).px(16).gap(8).items_center().border_t(1).border_color(t.border).child(reset).child(div5().flex_1()).child(button2(t, "dc-cancel", "Cancel", {}, () => this.cancel())).child(button2(
      t,
      "dc-save",
      this.busy === "save" ? "Saving\u2026" : "Save",
      { primary: true, enabled: canWrite && dirty && !this.hostsError },
      (_e, cx) => this.write(cx, saveSession, "save")
    )).when(dirty, (el) => el.child(div5().flex_none().text_size(12).text_color(t.accent).child("\u25CF unsaved")));
  }
  render() {
    const t = theme();
    const view = shared(VIEW_KEY) === "mod" ? "mod" : "region";
    const body = this.session ? view === "mod" ? byMod(this, t) : byRegion(this, t) : [div5().py(24).text_color(t.dim).child(this.loadError ? "Couldn't load the dock config." : "Loading\u2026")];
    return v_flex4().id("dock-config").size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground).child(v_flex4().flex_none().px(16).pt(14).pb(10).gap(10).child(this.header(t)).child(this.updates(t)).child(browserSectionView(this, t)).child(this.banner(t)).child(this.tabs(t, view))).child(v_flex4().id("dc-body").flex_1().min_h(0).overflow_y_scrollbar().px(16).pb(8).children(body)).child(this.footer(t));
  }
};
export {
  DockConfig as default
};
