// Layout tree generation (pure; no Node built-ins).

const DIVIDER = { width: 1, color: "border" };

// Copied from the "main" block of the shipped layouts/main.json.
const MAIN_PANE = {
  gap: 8,
  radius: 10,
  background: "background",
  lone: true,
  border: { width: 1, color: "border" },
  focus: { width: 1, color: "accent" },
  header: {
    content: { mod: "pane" },
    height: 30,
    position: "top",
    reveal: "always",
  },
};

const blockId = (region, index, mod) => `dock-${region}-${index}-${mod}`;

function featureBlocks(region, features, extra) {
  return features.map((f, i) => {
    const id = blockId(region, i, f.mod);
    return {
      id,
      type: "block",
      size: f.size ? { px: f.size } : { weight: 1 },
      ...extra,
      ...(f.drag ? { window_drag: true } : {}),
      content: { mod: f.mod, props: { ...f.props, dockFeature: id, dockRegion: region } },
    };
  });
}

function regionNode(merged, region, type, extra) {
  const r = merged.regions[region];
  if (!r.features.length) return null;
  const node = { id: `dock-${region}`, type, size: { px: r.size }, ...extra.node };
  if (extra.hidden) node.hidden = true;
  node.children = featureBlocks(region, r.features, extra.block);
  return node;
}

// The mod the right panel shows: this PC's choice when it is still placed, else the first.
export function rightActiveOf(active, features) {
  if (!features.length) return null;
  return features.some((f) => f.mod === active) ? active : features[0].mod;
}

// The right panel's block ids, in config order (the stack's children).
export function rightFeatureIds(merged) {
  return merged.regions.right.features.map((f, i) => blockId("right", i, f.mod));
}

// The right panel: a stack showing one right mod at a time, with the dock-rail block (one icon
// per mod) on the far right. `state` is this PC's choice (shared keys, never in the config):
// { rightShown, active }. Without it, the config's right.hidden is the default and the first mod
// shows. No right mods: no panel and no rail.
function rightNodes(regions, state) {
  const r = regions.right;
  if (!r.features.length) return { right: null, rail: null };
  const shown = typeof state.rightShown === "boolean" ? state.rightShown : !r.hidden;
  const active = rightActiveOf(state.active, r.features);
  const index = r.features.findIndex((f) => f.mod === active);
  const right = {
    id: "dock-right", type: "column", size: { px: r.size }, min: 280, max: 900,
    ...(shown ? {} : { hidden: true }),
    children: [{
      id: "dock-right-stack", type: "stack", active: blockId("right", index, active),
      children: featureBlocks("right", r.features),
    }],
  };
  const rail = {
    id: "dock-rail", type: "block", size: { px: 40 }, background: "chrome",
    content: { mod: "dock-rail", props: { dockRegion: "rail" } },
  };
  return { right, rail };
}

// ---- Dock pages: mods shown one at a time in place of the terminal ----

export const WORK_STACK = "dock-work-stack";
export const MAIN_ID = "dock-main";

// The page block ids, in config order.
export function pageIds(merged) {
  return (merged.regions.pages?.features ?? []).map((f, i) => blockId("page", i, f.mod));
}

// The page shown: this PC's choice (a page mod's id) when it is still placed, else null (the terminal).
export function pageActiveOf(active, features) {
  return typeof active === "string" && (features ?? []).some((f) => f.mod === active) ? active : null;
}

// The work stack's child for a page (null: the terminal).
export function pageChildOf(active, features) {
  const mod = pageActiveOf(active, features);
  if (!mod) return MAIN_ID;
  return blockId("page", features.findIndex((f) => f.mod === mod), mod);
}

// The terminal block alone, or (with pages) a stack of it and one block per page. `page` is this PC's
// dock.page.active. Page blocks stay mounted while hidden, so switching is instant and keeps their state.
function workNode(regions, page) {
  const main = { id: MAIN_ID, type: "block", content: { tab: "active", pane: MAIN_PANE } };
  const pages = regions.pages?.features ?? [];
  if (!pages.length) return main;
  return {
    id: WORK_STACK, type: "stack", active: pageChildOf(page, pages),
    children: [main, ...pages.map((f, i) => ({
      id: blockId("page", i, f.mod), type: "block",
      content: { mod: f.mod, props: { ...f.props, dockFeature: blockId("page", i, f.mod), dockRegion: "pages" } },
    }))],
  };
}

export function buildLayout(merged, state = {}) {
  const { regions } = merged;
  const top = regionNode(merged, "top", "row", { node: { window_drag: true }, hidden: regions.top.hidden });
  const left = regionNode(merged, "left", "column", {
    node: { min: 44, max: 480, background: "chrome" },
    block: { min: 32 },
    hidden: regions.left.hidden || regions.left.mode === "hidden",
  });
  const { right, rail } = rightNodes(regions, state);
  const bottom = regionNode(merged, "bottom", "row", { node: {}, hidden: regions.bottom.hidden });
  const main = workNode(regions, state.page);
  const body = {
    id: "dock-body",
    type: "row",
    padding: 8,
    gap: 8,
    children: [main, right].filter(Boolean),
  };
  const mid = { id: "dock-mid", type: "row", resizable: false, children: [body, rail].filter(Boolean) };
  const work = {
    id: "dock-work",
    type: "column",
    resizable: false,
    children: [top, mid, bottom].filter(Boolean),
  };
  return {
    id: "root",
    toast: "dock-toast",
    type: "row",
    titlebar: "none",
    background: "canvas",
    terminal_padding: [14, 12],
    divider: DIVIDER,
    children: [left, work].filter(Boolean),
  };
}

export function leftFeatureIds(merged) {
  return merged.regions.left.features.map((f, i) => blockId("left", i, f.mod));
}

// The block id of a mod in the applied left panel (shared dock.config.applied), e.g. "dock-left-5-dock-quotas" — the
// id features compare dock.left.focus against; null when the mod isn't in the left panel.
export function leftFeatureId(applied, mod) {
  const features = Array.isArray(applied?.left?.features) ? applied.left.features : [];
  const i = features.findIndex((f) => f?.mod === mod);
  return i < 0 ? null : blockId("left", i, mod);
}
