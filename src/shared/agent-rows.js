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

// The Agents panel's space part of each row: the space's name, plus " · <branch>" where agents
// from different spaces share that name (a checkout and its worktree are both "herdr-dock").
// main and master say nothing, as in Spaces. branchOf(a): the branch at the agent's pane, or null.
export function spaceTags(list, branchOf) {
  const spacesByName = new Map();
  for (const a of list) {
    if (!a.space_name) continue;
    if (!spacesByName.has(a.space_name)) spacesByName.set(a.space_name, new Set());
    spacesByName.get(a.space_name).add(a.space);
  }
  const tags = new Map();
  for (const a of list) {
    const branch = branchOf(a);
    const shared = (spacesByName.get(a.space_name)?.size ?? 0) > 1;
    tags.set(a.address, shared && branch && branch !== "main" && branch !== "master" ? `${a.space_name} · ${branch}` : a.space_name);
  }
  return tags;
}

const URGENCY = { blocked: 4, done: 3, working: 2, idle: 1 };

// Spaces' rows (withAgents output) with each space row's children counted and a folded space's
// children left out. A top-level space's children are every row up to the next top-level space (its
// agents, its worktrees and theirs); a worktree's are its own agent rows right after it. A folded row
// also says how many rows it hides, the most urgent hidden agent state, and whether the active
// space is hidden inside it.
export function foldRows(rows, folded) {
  const childrenOf = (k) => {
    const r = rows[k], kids = [];
    for (let j = k + 1; j < rows.length; j++) {
      const x = rows[j];
      if (r.tree ? !(x.agent && x.w === r.w) : !x.agent && !x.tree) break;
      kids.push(x);
    }
    return kids;
  };
  const out = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    if (r.agent) { out.push(r); continue; }
    const kids = childrenOf(k);
    if (!kids.length || !folded.has(r.w.id)) { out.push({ ...r, children: kids.length, folded: false }); continue; }
    const top = kids.filter((x) => x.agent).reduce((m, x) => ((URGENCY[x.agent.status] ?? 0) > (URGENCY[m] ?? 0) ? x.agent.status : m), null);
    const holdsActive = kids.some((x) => !x.agent && x.w.active);
    out.push({ ...r, children: kids.length, folded: true, hidden: kids.length, top, holdsActive });
    k += kids.length;
  }
  return out;
}
