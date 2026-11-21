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

// Herdr's Files/Changes panel, as in its main layout, living at the bottom of the right column.
// The shipped tabs mod's Files and Changes buttons run layout.select {stack: "panel-body"} and
// layout.show/hide {id: "panel"}, so these ids must exist or the buttons error.
function herdrPanel(shown, active) {
  return {
    id: "panel", type: "column", ...(shown ? {} : { hidden: true }), size: { weight: 1 },
    children: [{
      id: "panel-body", type: "stack", active: active === "changes" ? "changes" : "files",
      children: [
        { id: "files", type: "block", content: { mod: "files" } },
        { id: "changes", type: "block", content: { mod: "changes" } },
      ],
    }],
  };
}

// `state` is this PC's right column state (shared keys, never in the config): { rightShown,
// panel: { shown, active } }. Without it, the config's right.hidden is the default and the panel
// is closed (opened when the column would otherwise be empty).
export function buildLayout(merged, state = {}) {
  const { regions } = merged;
  const top = regionNode(merged, "top", "row", { node: { window_drag: true }, hidden: regions.top.hidden });
  const left = regionNode(merged, "left", "column", {
    node: { min: 44, max: 480, background: "chrome" },
    block: { min: 32 },
    hidden: regions.left.hidden || regions.left.mode === "hidden",
  });
  const rightShown = typeof state.rightShown === "boolean" ? state.rightShown : !regions.right.hidden;
  const hasRight = regions.right.features.length > 0;
  const panelShown = rightShown && (!hasRight || state.panel?.shown === true);
  const right = {
    id: "dock-right", type: "column", size: { px: regions.right.size },
    ...(rightShown ? {} : { hidden: true }),
    children: [...featureBlocks("right", regions.right.features), herdrPanel(panelShown, state.panel?.active)],
  };
  const bottom = regionNode(merged, "bottom", "row", { node: {}, hidden: regions.bottom.hidden });
  const main = { id: "dock-main", type: "block", content: { tab: "active", pane: MAIN_PANE } };
  const body = {
    id: "dock-body",
    type: "row",
    padding: 8,
    gap: 8,
    children: [main, right],
  };
  const work = {
    id: "dock-work",
    type: "column",
    resizable: false,
    children: [top, body, bottom].filter(Boolean),
  };
  return {
    id: "root",
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
