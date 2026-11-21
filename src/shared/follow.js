// Which folder Files and Changes show (pure): "last thing you did wins". A new Git projects
// selection (dock.git.selected) switches them to that worktree; a change of the focused terminal's
// location switches them back to the terminal, as Herdr's own panels do. At startup they follow
// the terminal. A selection that is no longer listed falls back to the terminal.

// The selected worktree's { cwd, on } from dock.git.state, or null when it isn't listed.
export function selectedLocation(state, selected) {
  if (!selected || !state?.repos) return null;
  for (const repo of state.repos) {
    const wt = (repo.worktrees ?? []).find((w) => w.id === selected);
    if (wt) return { cwd: wt.path, on: repo.machine ?? null };
  }
  return null;
}

// memo: what was seen last ({ focusKey, selected, mode }), null at first. focus: the focused
// terminal's location ({ cwd, on, ...extra }). Returns { loc, memo }.
export function followLocation(memo, { focus, selected, state }) {
  const focusKey = JSON.stringify([focus?.cwd ?? null, focus?.on ?? null]);
  const sel = selected ?? null;
  let mode = memo?.mode ?? "focus";
  if (memo) {
    if (sel !== memo.selected && sel !== null) mode = "selection";
    if (focusKey !== memo.focusKey) mode = "focus";
  }
  const next = { focusKey, selected: sel, mode };
  const picked = mode === "selection" ? selectedLocation(state, sel) : null;
  return { loc: picked ? { ...focus, ...picked } : focus, memo: next };
}
