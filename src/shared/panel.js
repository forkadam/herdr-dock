// Left-panel mode helpers (pure; no Node built-ins).
import { MAIN_ID, WORK_STACK, leftFeatureIds, pageActiveOf, pageChildOf, rightActiveOf } from "./layout.js";

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

// What sizeChanges compares, kept by dock-core in shared state (dock.left.appliedSizes) so a config size
// edit made while herdr-dock wasn't shown still applies when it starts. Null for no config.
export function sizesSnapshot(merged) {
  const left = merged?.regions?.left;
  if (!left) return null;
  return { regions: { left: { size: left.size, features: (left.features ?? []).map((f) => (f.size ? { mod: f.mod, size: f.size } : { mod: f.mod })) } } };
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

// ---- The right panel: one right mod at a time, switched from the rail ----

export { rightActiveOf };
const RIGHT = "dock-right";
const RIGHT_STACK = "dock-right-stack";

// The right panel as the live tree (layout()) has it: { column: shown?, active: block id, children: the
// stack's block ids (null when there is no stack) }.
export function liveRight(tree) {
  const col = findNode(tree, RIGHT);
  const stack = findNode(tree, RIGHT_STACK);
  return {
    column: Boolean(col && !col.hidden),
    active: stack?.active ?? null,
    children: stack ? (stack.children ?? []).map((c) => c?.id).filter((id) => typeof id === "string") : null,
  };
}

// Whether the right panel shows on this PC: its own choice, else the config default.
// `applied` is the merged regions dock-core publishes (dock.config.applied).
export function rightShownOf(sharedShown, applied) {
  if (typeof sharedShown === "boolean") return sharedShown;
  return applied?.right?.hidden === false;
}

// A rail icon click: another mod shows it (opening the panel); the mod showing hides the panel.
export function railClick(shown, active, mod) {
  if (shown && active === mod) return { shown: false, active };
  return { shown: true, active: mod };
}

// The layout commands that bring the live panel in line with this PC's state.
export function planRight({ shown, active, features, live }) {
  if (!features.length) return [];
  const mod = rightActiveOf(active, features);
  const child = `dock-right-${features.findIndex((f) => f.mod === mod)}-${mod}`;
  if (!shown) return live.column ? [{ command: "layout.hide", args: { id: RIGHT } }] : [];
  // The live layout doesn't have that tab yet: dock-core already has a new config (a mod just placed in the
  // right region) but Herdr hasn't loaded the new layout file. Selecting now fails with an error toast on
  // every render until it does, so wait; the next render after the reload plans again.
  if (Array.isArray(live.children) && !live.children.includes(child)) return [];
  const out = [];
  if (live.active !== child) out.push({ command: "layout.select", args: { stack: RIGHT_STACK, child } });
  if (!live.column) out.push({ command: "layout.show", args: { id: RIGHT } });
  return out;
}

// Whether a valid config's right.hidden should become this PC's state (like modeFromConfig).
// `lastConfigHidden` is dock.right.configHidden. Returns null, or { record, shown } where shown
// null keeps the person's choice.
export function rightFromConfig(lastConfigHidden, sharedShown, configHidden) {
  if (lastConfigHidden === configHidden) return null;
  if (lastConfigHidden == null && typeof sharedShown === "boolean") return { record: configHidden, shown: null };
  return { record: configHidden, shown: !configHidden };
}

// This PC's right panel state from Herdr's shared state (shared.json), for building the layout
// file (dock-core and deploy), with anything malformed left undefined.
export function rightStateFromShared(shared) {
  const shown = shared?.["dock.right.shown"];
  const active = shared?.["dock.right.active"];
  const page = shared?.[PAGE_KEY];
  return {
    rightShown: typeof shown === "boolean" ? shown : undefined,
    active: typeof active === "string" ? active : undefined,
    page: typeof page === "string" ? page : undefined,
  };
}

// The right panel state for a newly read, valid config, decided BEFORE the layout file is built
// so the file already matches it. `prev` is the last good merged config (null on the first read),
// `saved` this PC's { shown, active, configHidden } (shared keys). Returns { set: { key: value }
// (shared keys to write), state: { rightShown, active } (for buildLayout) }.
// - a changed config right.hidden applies once (rightFromConfig);
// - a mod newly placed in the right region (compared with prev) becomes active and shown.
export function rightConfigUpdate({ prev, merged, saved }) {
  const set = {};
  let shown = saved.shown;
  let active = saved.active;
  const r = rightFromConfig(saved.configHidden, shown, merged.regions.right.hidden);
  if (r) {
    set["dock.right.configHidden"] = r.record;
    if (r.shown !== null) { shown = r.shown; set["dock.right.shown"] = r.shown; }
  }
  if (prev) {
    const before = new Set(prev.regions.right.features.map((f) => f.mod));
    const added = merged.regions.right.features.find((f) => !before.has(f.mod))?.mod;
    if (added) {
      active = added;
      set["dock.right.active"] = added;
      if (shown !== true) { shown = true; set["dock.right.shown"] = true; }
    }
  }
  return {
    set,
    state: { rightShown: rightShownOf(shown, merged.regions), active: typeof active === "string" ? active : undefined },
  };
}

// ---- Dock pages: one page at a time in place of the terminal ----

// This PC's page shown (a page mod's id), or null for the terminal. Never in the config.
export const PAGE_KEY = "dock.page.active";
export { pageActiveOf };

// The work stack as the live tree has it: { active, children } (null when there is no stack).
export function liveWork(tree) {
  const stack = findNode(tree, WORK_STACK);
  if (!stack) return null;
  return { active: stack.active ?? null, children: (stack.children ?? []).map((c) => c?.id).filter((id) => typeof id === "string") };
}

// The layout command that shows this PC's page (or the terminal), or [] when the live tree already does or
// doesn't have that child yet (a page just placed: Herdr hasn't loaded the new layout file).
export function planPage({ active, features, live }) {
  if (!live || !features?.length) return [];
  const child = pageChildOf(active, features);
  if (!live.children.includes(child) || live.active === child) return [];
  return [{ command: "layout.select", args: { stack: WORK_STACK, child } }];
}

// Ctrl+Alt+P: the terminal, then each page in order, then the terminal again.
export function nextPage(active, features) {
  const list = (features ?? []).map((f) => f.mod);
  if (!list.length) return null;
  const cur = pageActiveOf(active, features);
  const i = cur === null ? -1 : list.indexOf(cur);
  return i + 1 < list.length ? list[i + 1] : null;
}

// A Pages-list click: another page shows it; the page already shown goes back to the terminal.
export const pageClick = (active, mod) => (active === mod ? null : mod);

// Whether a focus change (another space or tab, from a click, a key or a new tab) should bring the terminal
// back. `prev` / `now` are "<space>|<tab>" keys; null `prev` is the first look (no change yet).
export const focusLeavesPage = (prev, now) => prev !== null && prev !== now;

export { MAIN_ID };
