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
