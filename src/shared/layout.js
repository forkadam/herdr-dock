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
  const main = { id: "dock-main", type: "block", content: { tab: "active", pane: MAIN_PANE } };
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
