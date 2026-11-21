// Which installed mods the config dialog lists (pure; no Node built-ins).
import { regionOf } from "./edit.js";

// Mods that other mods call into; placing them in a region makes no sense.
export const HELPER_MODS = [
  "confirm", "prompt", "toast", "menu", "new-menu", "help", "peek", "pane", "terminals-pane", "worktree",
];

// null when the mod can be placed in a region, else why not.
export function placeability(id, modJson) {
  if (id === "dock-config") return "self";
  if (id.startsWith("_") || id.startsWith(".")) return "hidden-name";
  if (modJson === null || typeof modJson !== "object") return "broken";
  if (HELPER_MODS.includes(id)) return "helper";
  if (modJson.overlay && (modJson.place === "none" || modJson.place === undefined)) return "overlay";
  return null;
}

// Mod ids out of Herdr's installed.json text (keys look like "tabs" or "layout:main").
export function installedFallbackIds(installedJsonText) {
  try {
    const parsed = JSON.parse(installedJsonText);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.keys(parsed).filter((k) => !k.startsWith("layout:"));
  } catch {
    return [];
  }
}

// One Item per installed mod, plus any mod the config names that isn't installed.
export function buildInventory(entries, draft) {
  const items = entries.map(({ id, modJson }) => ({
    id,
    title: typeof modJson?.title === "string" && modJson.title ? modJson.title : id,
    reason: placeability(id, modJson),
    installed: true,
    region: regionOf(draft, id),
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

// The "By mod" rows: every placeable mod and every mod the config already places (whatever its
// reason), then the rest, shown only with "Show all mods".
export function modRows(inventory) {
  const normal = inventory.filter((i) => i.reason === null || i.region !== null);
  return { normal, others: inventory.filter((i) => !normal.includes(i)) };
}
