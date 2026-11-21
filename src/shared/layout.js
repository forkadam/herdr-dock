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

export function buildLayout(merged) {
  const { regions } = merged;
  const top = regionNode(merged, "top", "row", { node: { window_drag: true }, hidden: regions.top.hidden });
  const left = regionNode(merged, "left", "column", {
    node: { min: 44, max: 480, background: "chrome" },
    block: { min: 32 },
    hidden: regions.left.hidden || regions.left.mode === "hidden",
  });
  const right = regionNode(merged, "right", "column", { node: {}, hidden: regions.right.hidden });
  const bottom = regionNode(merged, "bottom", "row", { node: {}, hidden: regions.bottom.hidden });
  const main = { id: "dock-main", type: "block", content: { tab: "active", pane: MAIN_PANE }, padding: 8 };
  const body = {
    id: "dock-body",
    type: "row",
    divider: DIVIDER,
    children: [left, main, right].filter(Boolean),
  };
  return {
    id: "root",
    type: "column",
    titlebar: "none",
    background: "canvas",
    terminal_padding: [14, 12],
    divider: DIVIDER,
    children: [top, body, bottom].filter(Boolean),
  };
}

export function leftFeatureIds(merged) {
  return merged.regions.left.features.map((f, i) => blockId("left", i, f.mod));
}
