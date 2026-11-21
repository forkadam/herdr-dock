// Placement rules and draft edits for the config UI (pure; no Node built-ins).
import { LEFT_ONLY, REGION_NAMES, mergeForHost } from "./config.js";

const LEFT_MODES = ["expanded", "icons", "hidden"];
const FOOTER = "dock-footer";

export function allowedRegions(mod) {
  if (mod === "dock-core") return ["top"];
  if (LEFT_ONLY.includes(mod)) return ["left"];
  return [...REGION_NAMES];
}

export function canTurnOff(mod) {
  return mod !== "dock-core";
}

export function draftFromConfig(config, host) {
  const merged = JSON.parse(JSON.stringify(mergeForHost(config, host)));
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

export function sameDraft(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
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
  target.splice(at, 0, feature);
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
      else if (!isPosInt(op.value)) error = `regions.${op.region}.size: must be a positive integer`;
      else d.regions[op.region].size = op.value;
      break;
    case "hidden":
      if (!d.regions[op.region]) error = `regions.${op.region}: unknown region`;
      else if (typeof op.value !== "boolean") error = `regions.${op.region}.hidden: must be a boolean`;
      else if (op.region === "top" && op.value) error = "regions.top.hidden: the top bar can't be hidden";
      else if (op.region === "left") error = "regions.left.hidden: use the left mode instead";
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
