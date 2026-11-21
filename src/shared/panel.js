// Left-panel mode helpers (pure; no Node built-ins).
import { leftFeatureIds } from "./layout.js";

const ORDER = ["expanded", "icons", "hidden"];
const LEFT = "dock-left";
const ICON_PX = 48;
const COLLAPSED_PX = 32;

// The cycle: expanded -> icons -> hidden -> expanded. A focused expanded panel first goes back
// to plain expanded (the caller clears the focus), so the cycle is also the way out of a focus.
export function nextMode(mode, focus = null) {
  if (mode === "expanded" && focus != null) return "expanded";
  const i = ORDER.indexOf(mode);
  return ORDER[(i + 1) % ORDER.length];
}

const configSize = (f) => (f.size ? { px: f.size } : { weight: 1 });
const sizeArgs = (id, s) => (Number.isFinite(s?.px) ? { id, px: s.px } : { id, weight: s?.weight ?? 1 });
const resize = (args) => ({ command: "layout.resize", args });

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// The left column's live sizes in a layout tree (layout()): { px, sizes: { id: {px}|{weight} } },
// or null when the tree has no left column.
export function liveSizes(tree, merged) {
  const node = findNode(tree, LEFT);
  if (!node) return null;
  const sizes = {};
  for (const id of leftFeatureIds(merged)) {
    const s = findNode(node, id)?.size;
    if (s) sizes[id] = Number.isFinite(s.px) ? { px: s.px } : { weight: s.weight ?? 1 };
  }
  return { px: Number.isFinite(node.size?.px) ? node.size.px : null, sizes };
}

// Config sizes that changed between two good merged configs (null before the first one):
// { px?, sizes: { id: size } }, or null when no left size changed. Only blocks present in
// both are compared (a new block takes its size from the layout file).
export function sizeChanges(before, after) {
  if (!before || !after) return null;
  const out = { sizes: {} };
  if (before.regions.left.size !== after.regions.left.size) out.px = after.regions.left.size;
  const old = new Map(leftFeatureIds(before).map((id, i) => [id, before.regions.left.features[i]]));
  leftFeatureIds(after).forEach((id, i) => {
    const f = after.regions.left.features[i];
    if (old.has(id) && (old.get(id).size ?? null) !== (f.size ?? null)) out.sizes[id] = configSize(f);
  });
  return "px" in out || Object.keys(out.sizes).length ? out : null;
}

// The person's sizes to keep while the panel is ours to size (icon rail, focus). A live
// width at or under the rail is not theirs: the config sizes stand in for it.
function snapshot(merged, live) {
  const sizes = {};
  leftFeatureIds(merged).forEach((id, i) => {
    sizes[id] = live?.sizes?.[id] ?? configSize(merged.regions.left.features[i]);
  });
  const px = Number.isFinite(live?.px) && live.px > ICON_PX ? live.px : merged.regions.left.size;
  return { px, sizes };
}

function changeActions(changes) {
  if (!changes) return [];
  const out = [];
  if (Number.isFinite(changes.px)) out.push(resize({ id: LEFT, px: changes.px }));
  for (const [id, s] of Object.entries(changes.sizes ?? {})) out.push(resize(sizeArgs(id, s)));
  return out;
}

// The layout commands for a mode/focus, and the saved sizes to keep afterwards.
// `restore` (shared state) is null while the live tree holds the person's own sizes (drags
// included), and holds those sizes while dock-core has the panel at the rail or focused.
// Only what a transition needs is resized: plain expanded with nothing saved is shown as it is.
// `changes` (sizeChanges) are config edits, the one case where config sizes beat the person's.
export function planPanel({ mode, focus, merged, live, restore, changes }) {
  const ids = leftFeatureIds(merged);
  const features = merged.regions.left.features;
  const foreign = ids.filter((_, i) => !String(features[i].mod).startsWith("dock-"));
  const ours = mode === "icons" || (mode === "expanded" && focus != null);
  let saved = restore ?? null;
  if (ours && !saved) saved = snapshot(merged, live);
  if (saved && changes) {
    saved = { px: changes.px ?? saved.px, sizes: { ...saved.sizes, ...changes.sizes } };
  }
  if (mode === "hidden") {
    return { actions: [{ command: "layout.hide", args: { id: LEFT } }, ...(saved ? [] : changeActions(changes))], restore: saved };
  }
  const out = [{ command: "layout.show", args: { id: LEFT } }];
  if (mode === "icons") {
    for (const id of foreign) out.push({ command: "layout.hide", args: { id } });
    out.push(resize({ id: LEFT, px: ICON_PX }));
    return { actions: out, restore: saved };
  }
  for (const id of foreign) out.push({ command: "layout.show", args: { id } });
  if (focus != null) {
    out.push(resize({ id: LEFT, px: saved.px }));
    for (const id of ids) out.push(resize(id === focus ? { id, weight: 1 } : { id, px: COLLAPSED_PX }));
    return { actions: out, restore: saved };
  }
  if (saved) {
    out.push(resize({ id: LEFT, px: saved.px }));
    ids.forEach((id, i) => out.push(resize(sizeArgs(id, saved.sizes[id] ?? configSize(features[i])))));
    return { actions: out, restore: null };
  }
  const acts = changeActions(changes);
  if (!acts.some((a) => a.args.id === LEFT) && Number.isFinite(live?.px) && live.px <= ICON_PX) {
    acts.unshift(resize({ id: LEFT, px: merged.regions.left.size }));
  }
  out.push(...acts);
  return { actions: out, restore: null };
}

// Whether a valid config's left mode should become the panel mode. `lastConfigMode` is the
// config mode dock-core recorded last (shared state, machine-local). A changed config mode
// applies; with nothing recorded yet, a mode the person already chose stays.
export function modeFromConfig(lastConfigMode, sharedMode, configMode) {
  if (lastConfigMode === configMode) return null;
  if (lastConfigMode == null && ORDER.includes(sharedMode)) return { record: configMode, mode: null };
  return { record: configMode, mode: configMode };
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

// ---- The right column: the right region's mods with Herdr's Files/Changes panel under them ----

const RIGHT = "dock-right";
const PANEL = "panel";
const PANEL_BODY = "panel-body";
const show = (id) => ({ command: "layout.show", args: { id } });
const hide = (id) => ({ command: "layout.hide", args: { id } });

// The right column as the live tree (layout()) has it: { column, panel, active }.
export function liveRight(tree) {
  const col = findNode(tree, RIGHT);
  const panel = findNode(tree, PANEL);
  return {
    column: Boolean(col && !col.hidden),
    panel: Boolean(panel && !panel.hidden),
    active: findNode(tree, PANEL_BODY)?.active ?? null,
  };
}

// What to do for this PC's right column state. `shown` is dock.right.shown; `memory` is
// dock.panel ({ shown, active }: whether Files/Changes was open, and on which tab, while the
// column was last visible). `prev` is the live state dock-core saw last (null at first).
// Invariant kept here: a hidden column has its panel hidden, so the tab bar's Files/Changes
// buttons light up only when the panel is really on screen.
// Returns { shown, memory, actions }.
export function planRight({ shown, hasFeatures, live, prev, memory }) {
  let s = shown;
  // Only the tab bar opens the panel inside a hidden column: show the column for it.
  if (live.panel && !live.column) s = true;
  // Closing Files/Changes in a column with nothing else in it closes the column.
  if (prev?.panel && !live.panel && live.column && !hasFeatures) s = false;
  const mem = live.column
    ? { shown: live.panel, active: live.active ?? memory?.active ?? "files" }
    : { shown: memory?.shown === true, active: (live.panel ? live.active : memory?.active) ?? live.active ?? "files" };
  const actions = [];
  if (s) {
    const wantPanel = live.column ? live.panel || !hasFeatures : live.panel || mem.shown || !hasFeatures;
    if (wantPanel && !live.panel) {
      actions.push({ command: "layout.select", args: { stack: PANEL_BODY, child: mem.active } }, show(PANEL));
    }
    if (!live.column) actions.push(show(RIGHT));
  } else {
    if (live.panel) actions.push(hide(PANEL));
    if (live.column) actions.push(hide(RIGHT));
  }
  return { shown: s, memory: mem, actions };
}

// Whether a valid config's right.hidden should become this PC's column state (like
// modeFromConfig). `lastConfigHidden` is dock.right.configHidden. Returns null, or
// { record, shown } where shown null means "keep the person's choice".
export function rightFromConfig(lastConfigHidden, sharedShown, configHidden) {
  if (lastConfigHidden === configHidden) return null;
  if (lastConfigHidden == null && typeof sharedShown === "boolean") return { record: configHidden, shown: null };
  return { record: configHidden, shown: !configHidden };
}
