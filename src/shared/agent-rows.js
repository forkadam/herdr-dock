// Pure helpers for agent rows in dock panels (no herdr or gpui imports, so node --test can load it).

// Drops what an agent puts before its title: a status glyph or spinner and the separator
// after it ("✦  Working", "⠋ - Thinking"), and Codex's blinking "[ ! ] " / "[ . ] " mark.
// Stops at an opening bracket or quote, so a title that starts with one ("[web] login") keeps it.
export const cleanTitle = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// Spaces' rows with each space's agents right after its row, in `agents` order: one step in under
// a top-level space, two under a worktree. An agent row carries its space's `w`, so machine
// grouping and folding treat it with its space. Agents of a space not in `rows` are left out.
export function withAgents(rows, agents) {
  const bySpace = new Map();
  for (const a of agents) {
    if (!bySpace.has(a.space)) bySpace.set(a.space, []);
    bySpace.get(a.space).push(a);
  }
  return rows.flatMap((r) => [r, ...(bySpace.get(r.w.id) ?? []).map((agent) => ({ w: r.w, agent, depth: r.tree ? 2 : 1 }))]);
}

// What an agent row reads: its peer name, else its pane's name, its title, a tab someone named
// (not Herdr's automatic number), its program, its address.
export function rowLabel(a, peerName) {
  const tab = a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : "";
  return peerName || a.pane_name || cleanTitle(a.title) || tab || a.program?.name || a.address;
}

// Names that two or more agents share (a message by name may reach either).
export function sharedNames(names) {
  const seen = new Set(), twice = new Set();
  for (const n of names) {
    if (n == null) continue;
    if (seen.has(n)) twice.add(n);
    seen.add(n);
  }
  return twice;
}
