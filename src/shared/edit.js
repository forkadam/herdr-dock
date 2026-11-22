// Placement rules and draft edits for the config UI (pure; no Node built-ins).
import { LEFT_ONLY, PAGE_ONLY, REGION_NAMES, mergeForHost, parseConfig, parseLocal } from "./config.js";

const LEFT_MODES = ["expanded", "icons", "hidden"];
const FOOTER = "dock-footer";
const PAGES_NAV = "dock-pages";

export function allowedRegions(mod) {
  if (mod === "dock-core" || mod === "dock-tabs") return ["top"];
  if (LEFT_ONLY.includes(mod)) return ["left"];
  if (PAGE_ONLY.includes(mod)) return ["pages"];
  return [...REGION_NAMES];
}

export function canTurnOff(mod) {
  return mod !== "dock-core";
}

// local: the parsed per-PC local file (or null), merged over base + machines.<host>.
export function draftFromConfig(config, host, local = null) {
  const merged = JSON.parse(JSON.stringify(mergeForHost(config, host, local)));
  const regions = {};
  for (const name of REGION_NAMES) regions[name] = merged.regions[name];
  // The mode carries "hidden" for left.
  regions.left.hidden = false;
  return { regions };
}

export function regionOf(draft, mod) {
  for (const name of REGION_NAMES) {
    if (draft.regions[name].features.some((f) => f.mod === mod)) return name;
  }
  return null;
}

// JSON with object keys sorted, so key order doesn't matter.
const canonical = (v) => JSON.stringify(v, (_k, x) => (x !== null && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
  : x));
const same = (a, b) => canonical(a) === canonical(b);

// The fields the dialog edits, per region: size, hidden (not left), mode (left) and features.
const EDITED = ["size", "hidden", "mode", "features"];
const fields = (name) => (name === "left" ? ["size", "mode", "features"] : name === "pages" ? ["features"] : ["size", "hidden", "features"]);

export function sameDraft(a, b) {
  return REGION_NAMES.every((name) => fields(name).every((k) => same(a.regions[name]?.[k], b.regions[name]?.[k])));
}

// On a conflict: the fresh draft with only the fields the user changed (draft vs baseDraft) put back on top.
export function rebaseDraft(baseDraft, draft, freshDraft) {
  const out = JSON.parse(JSON.stringify(freshDraft));
  for (const name of REGION_NAMES) {
    for (const k of fields(name)) {
      const mine = draft.regions[name]?.[k];
      if (same(mine, baseDraft.regions[name]?.[k])) continue;
      out.regions[name] ??= { features: [] };
      if (mine === undefined) delete out.regions[name][k];
      else out.regions[name][k] = JSON.parse(JSON.stringify(mine));
    }
  }
  return out;
}

// The size a step button sets: 1 when there's no size yet, never below 1.
export function stepSize(size, delta) {
  return Number.isInteger(size) ? Math.max(1, size + delta) : 1;
}

const isPosInt = (v) => Number.isInteger(v) && v > 0;

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
  // A page keeps only its props (no size, no drag).
  target.splice(at, 0, region === "pages" ? (feature.props ? { mod, props: feature.props } : { mod }) : feature);
  // The first page also puts the Pages list in the left panel (else nothing could open it).
  if (region === "pages" && regionOf(d, PAGES_NAV) === null) place(d, { mod: PAGES_NAV, region: "left" });
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

export function applyEdit(draft, op) {
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
      if (!LEFT_MODES.includes(op.value)) error = `regions.left.mode: must be one of ${LEFT_MODES.join(", ")}`;
      else d.regions.left.mode = op.value;
      break;
    default:
      error = `unknown edit: ${op.type}`;
  }
  return error ? { draft, error } : { draft: d, error: null };
}

// The regions this host overrides: only what differs from the base (config without machines;
// planSave passes the shared config already merged with machines.<host>).
export function machineSection(config, draft) {
  const base = mergeForHost({ ...config, machines: {} }, "");
  const section = {};
  for (const name of REGION_NAMES) {
    const b = base.regions[name];
    const d = draft.regions[name];
    const diff = {};
    if (d.size !== b.size && d.size !== undefined) diff.size = d.size;
    if (name === "pages") {
      // Only features: a page has no size and is never hidden.
    } else if (name === "left") {
      if (d.mode !== b.mode) diff.mode = d.mode;
      // A raw base left.hidden: true would keep forcing the hidden mode through the merge.
      if (config.regions?.left?.hidden === true && d.mode !== "hidden") diff.hidden = false;
    } else if (d.hidden !== b.hidden) {
      diff.hidden = d.hidden;
    }
    if (!same(d.features, b.features)) diff.features = d.features;
    // Keys the dialog doesn't edit (e.g. a hand-written note in this host's section) stay when they differ.
    for (const k of Object.keys(d)) {
      if (!EDITED.includes(k) && !same(d[k], b[k])) diff[k] = d[k];
    }
    if (Object.keys(diff).length) section[name] = diff;
  }
  return Object.keys(section).length ? section : null;
}

const isEmpty = (v) => (Array.isArray(v) ? !v.length : !Object.keys(v).length);
const isNested = (v) => v !== null && typeof v === "object";

function inline(v) {
  if (!isNested(v) || isEmpty(v)) return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`;
}

function pretty(v, pad, key) {
  if (!isNested(v) || isEmpty(v)) return JSON.stringify(v);
  const inner = pad + "  ";
  if (Array.isArray(v)) {
    const rows = v.map((x) => inner + (key === "features" && isNested(x) && !Array.isArray(x) ? inline(x) : pretty(x, inner)));
    return `[\n${rows.join(",\n")}\n${pad}]`;
  }
  const rows = Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner, k)}`);
  return `{\n${rows.join(",\n")}\n${pad}}`;
}

// JSON.stringify(obj, null, 2) layout, with each feature object on one line.
export function formatConfig(obj) {
  return pretty(obj, "") + "\n";
}

// The local file text that holds this draft: { v: 1, regions } with only what differs from the
// shared config merged with machines.<host> (empty regions when nothing does). Other top-level
// keys of the local file stay.
export function planSave(baseText, localText, host, draft) {
  const base = parseConfig(baseText);
  if (!base.ok) return { ok: false, error: base.error };
  const local = parseLocal(localText);
  if (!local.ok) return { ok: false, error: local.error };
  const shared = mergeForHost(base.config, host);
  const section = machineSection({ v: 1, regions: shared.regions }, draft);
  const { v: _v, regions: _r, ...rest } = local.local ?? {};
  const text = formatConfig({ v: 1, regions: section ?? {}, ...rest });
  const check = parseLocal(text);
  return check.ok ? { ok: true, text } : { ok: false, error: check.error };
}

// Back to shared: the local file goes. Herdr has no delete API, so the session writes EMPTY_LOCAL.
export function planReset() {
  return { ok: true, delete: true };
}

export const EMPTY_LOCAL = formatConfig({ v: 1, regions: {} });
