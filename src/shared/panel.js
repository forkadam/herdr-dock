// Left-panel mode helpers (pure; no Node built-ins).
import { leftFeatureIds } from "./layout.js";

const ORDER = ["expanded", "icons", "hidden"];
const LEFT = "dock-left";
const ICON_PX = 48;
const COLLAPSED_PX = 32;

export function nextMode(mode) {
  const i = ORDER.indexOf(mode);
  return ORDER[(i + 1) % ORDER.length];
}

export function panelActions(mode, merged, focusId) {
  const ids = leftFeatureIds(merged);
  const features = merged.regions.left.features;
  const foreign = ids.filter((_, i) => !String(features[i].mod).startsWith("dock-"));
  if (mode === "hidden") return [{ command: "layout.hide", args: { id: LEFT } }];
  if (mode === "icons") {
    return [
      { command: "layout.show", args: { id: LEFT } },
      ...foreign.map((id) => ({ command: "layout.hide", args: { id } })),
      { command: "layout.resize", args: { id: LEFT, px: ICON_PX } },
    ];
  }
  const out = [{ command: "layout.show", args: { id: LEFT } }];
  for (const id of foreign) out.push({ command: "layout.show", args: { id } });
  out.push({ command: "layout.resize", args: { id: LEFT, px: merged.regions.left.size } });
  ids.forEach((id, i) => {
    let args;
    if (focusId) args = id === focusId ? { id, weight: 1 } : { id, px: COLLAPSED_PX };
    else args = features[i].size ? { id, px: features[i].size } : { id, weight: 1 };
    out.push({ command: "layout.resize", args });
  });
  return out;
}

// What dock-core should apply for the current shared state, or null when `applied` already
// matches. Focus only counts while expanded and only for a known left block id (an unknown id
// is cleared). A focus left over when the panel leaves a focused "expanded" is cleared too;
// a request made while icons/hidden waits (focus is set before mode by feature mods).
export function planSync({ mode, focus, leftIds, applied }) {
  let f = mode === "expanded" ? (focus ?? null) : null;
  let clearFocus = false;
  if (f !== null && !leftIds.includes(f)) { f = null; clearFocus = true; }
  const key = `${mode}|${f}`;
  if (key === applied) return null;
  const appliedMode = typeof applied === "string" ? applied.split("|")[0] : null;
  if (mode !== "expanded" && focus != null && appliedMode === "expanded" && applied !== "expanded|null") clearFocus = true;
  return { key, focus: f, clearFocus };
}
