// Pure view model for the Overview page (no host imports: node --test runs it).

export const STATUS_ORDER = ["blocked", "done", "working", "idle"];
export const STATUS_TITLE = { blocked: "Needs you", done: "Done", working: "Working", idle: "Idle" };

// agents() -> { counts: {status: n}, groups: [{ status, title, agents: [{ address, pane, title, where }] }] }
// in STATUS_ORDER, leaving out empty groups. Within a group: newest change first (seq).
export function overviewModel(agents) {
  const counts = { blocked: 0, done: 0, working: 0, idle: 0 };
  const by = { blocked: [], done: [], working: [], idle: [] };
  for (const a of agents ?? []) {
    const s = STATUS_ORDER.includes(a?.status) ? a.status : "idle";
    counts[s]++;
    by[s].push(a);
  }
  const groups = STATUS_ORDER.filter((s) => by[s].length).map((s) => ({
    status: s,
    title: STATUS_TITLE[s],
    agents: by[s].slice().sort((x, y) => (y.seq ?? 0) - (x.seq ?? 0)).map((a) => ({
      address: a.address,
      pane: a.pane,
      program: a.program ?? null,
      title: (a.title ?? "").trim() || a.program?.name || a.address,
      where: [a.space_name, a.tab_name || (Number.isInteger(a.tab_index) ? `tab ${a.tab_index + 1}` : null)].filter(Boolean).join(" · "),
    })),
  }));
  return { counts, groups };
}
