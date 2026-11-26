// Pure view model for the Git projects feature (no host imports: node --test runs it).
import { worktreeId } from "../../shared/git.js";
import { slashPath } from "../../shared/path.js";
import { resumeClock } from "../../shared/ci-budget.js";

export const EMPTY_TEXT = "No repos yet: + Add repo, or open a terminal in a repo.";

const PROVIDER = { gitlab: "GitLab", github: "GitHub" };

// A worktree's pipeline -> its badge. null (no CI / not polled yet) draws nothing.
export function badgeOf(pipeline) {
  if (!pipeline) return { glyph: "", tone: "dim" };
  if (pipeline.error || pipeline.status === "unknown") return { glyph: "⚠", tone: "warn" };
  switch (pipeline.status) {
    case "passed": return { glyph: "✓", tone: "ok" };
    case "failed": return { glyph: "✕", tone: "bad" };
    case "running": case "pending": return { glyph: "⟳", tone: "busy" };
    default: return { glyph: "–", tone: "dim" };
  }
}

// The badge's tooltip: the status, why it's unknown or stale, and, while the host is paused at its API limit, that
// the status is the last one fetched before the pause.
function pipelineTip(p, now) {
  if (!p) return "No pipeline";
  const limited = typeof p.limitedUntil === "number" && p.limitedUntil > now
    ? ` · API limit reached — status from before, resumes at ${resumeClock(p.limitedUntil)}` : "";
  if (p.error) return `Pipeline: ${p.error}${p.hint ? ` · run ${p.hint}` : ""}${limited}`;
  const s = p.status === "none" ? "no pipeline yet" : p.status;
  // number is the display number (GitHub: run_number); id is a 40-char sha on GitHub, so never shown.
  return `Pipeline ${p.number != null ? `#${p.number} ` : ""}${s}${p.stale ? " · older commit than local HEAD" : ""}${limited} · click for details`;
}

export function repoWebUrl(repo) {
  return repo?.host && repo?.path ? `https://${repo.host}/${repo.path}` : null;
}

// dock.git.state + dock.git.selected -> rows: each repo, then its worktrees; one "empty" row with no repos. now (ms)
// tells whether a worktree's limit pause is still on.
export function gitRows(state, selected, now = Date.now()) {
  const repos = Array.isArray(state?.repos) ? state.repos : [];
  if (!repos.length) return [{ kind: "empty", text: EMPTY_TEXT }];
  const rows = [];
  for (const r of repos) {
    const wts = Array.isArray(r.worktrees) ? r.worktrees : [];
    rows.push({
      kind: "repo", id: r.id, name: r.name, machine: r.machine ?? null, provider: r.provider ?? null,
      added: Boolean(r.added), error: r.error ?? null,
      // The machine is already in the name ("tool · devbox"): the detail is just the provider.
      detail: r.provider ?? "",
      webUrl: repoWebUrl(r), webLabel: `Open in ${PROVIDER[r.provider] ?? "browser"}`,
      mainPath: wts[0]?.path ?? null,
      tooltip: [r.name, r.machine && `on ${r.machine}`, r.host && r.path && `${r.host}/${r.path}`, r.error].filter(Boolean).join(" · "),
    });
    for (const w of wts) {
      const branch = w.branch || `detached @${String(w.sha ?? "").slice(0, 7)}`;
      rows.push({
        kind: "worktree", id: w.id, repoId: r.id, branch, path: w.path,
        open: Boolean(w.open), space: w.space ?? null, selected: w.id === selected,
        badge: badgeOf(w.pipeline), badgeTip: pipelineTip(w.pipeline, now),
        ahead: w.ahead > 0 ? `↑${w.ahead}` : null,
        behind: w.behind > 0 ? `↓${w.behind}` : null,
        noUpstream: !w.upstream && !w.detached,
        dirty: Boolean(w.dirty),
        tooltip: `${branch} · ${w.path}${w.dirty ? " · uncommitted changes" : ""}${w.open ? " · open in a space" : ""}`,
      });
    }
  }
  return rows;
}

// For the collapsed face and the icon rail's red dot.
export function gitSummary(state) {
  const repos = Array.isArray(state?.repos) ? state.repos : [];
  const failing = repos.reduce((n, r) => n + (r.worktrees ?? []).filter((w) => w.pipeline?.status === "failed").length, 0);
  return { repos: repos.length, failing, text: `${repos.length} repo${repos.length === 1 ? "" : "s"} · ${failing} failing` };
}

// The platform a path's id is folded with: this computer's for local paths (as the collector does).
const platformFor = (machine, path, platform) =>
  machine == null ? platform : /^[A-Za-z]:\//.test(slashPath(path)) ? "windows" : "linux";
const idOf = (machine, path, platform) => worktreeId(machine, path, platformFor(machine, path, platform));

// dock.git.repos with a local folder appended; null when it's already listed.
export function addRepoPath(list, path, platform) {
  const cur = Array.isArray(list) ? list : [];
  const id = idOf(null, path, platform);
  if (cur.some((e) => e && typeof e.path === "string" && idOf(e.machine ?? null, e.path, platform) === id)) return null;
  return [...cur, { path, machine: null }];
}

// dock.git.repos without the entries that produced this repo (its addedPaths, e.g. an added subfolder), name it
// (its id) or any of its worktrees.
export function removeRepoPaths(list, repo, platform) {
  const cur = Array.isArray(list) ? list : [];
  const machine = repo.machine ?? null;
  const ids = new Set([repo.id, ...(repo.worktrees ?? []).map((w) => idOf(machine, w.path, platform))]);
  for (const a of Array.isArray(repo.addedPaths) ? repo.addedPaths : []) {
    if (a && typeof a.path === "string" && (a.machine ?? null) === machine) ids.add(idOf(machine, a.path, platform));
  }
  return cur.filter((e) => !(e && typeof e.path === "string" && (e.machine ?? null) === machine
    && ids.has(idOf(machine, e.path, platform))));
}

// dock.git.skipped after removing this repo: when a terminal is still in it, it is skipped (hidden,
// not auto-added again) until its terminals leave; null when nothing changes.
export function skipAfterRemove(skipped, repo) {
  if (!(repo?.worktrees ?? []).some((w) => w.open)) return null;
  const list = Array.isArray(skipped) ? skipped : [];
  return list.includes(repo.id) ? list : [...list, repo.id];
}

// The right-click menu. A repo row: Remove repo (all its worktrees leave the list). A worktree row works on
// just that worktree: Hide from list, and Delete worktree… (not for the main checkout, which git can't
// remove as a worktree). Both: the repo's web page, and Copy path for the line clicked.
export function rowMenu(rows, row) {
  const repo = row.kind === "repo" ? row : rows.find((r) => r.kind === "repo" && r.id === row.repoId);
  if (!repo) return [];
  const items = row.kind === "repo"
    ? [{ key: "remove", label: `Remove repo ${repo.name}`, repoId: repo.id }]
    : [{ key: "hide", label: "Hide from list", worktree: row.id },
      ...(row.path === repo.mainPath ? [] : [{ key: "delete", label: "Delete worktree…", worktree: row.id }])];
  if (repo.webUrl) items.push({ key: "web", label: repo.webLabel, url: repo.webUrl });
  const path = row.kind === "repo" ? repo.mainPath : row.path;
  if (path) items.push({ key: "copy", label: "Copy path", path });
  return items;
}

// Hide from list on a worktree row: dock.git.hidden gains { id, held } (held: a terminal is in it now, so it
// stays hidden until they leave). The repo's last shown worktree removes the repo instead: { removeRepo }.
export function hideWorktree(hidden, rows, row) {
  const others = rows.filter((r) => r.kind === "worktree" && r.repoId === row.repoId && r.id !== row.id);
  if (!others.length) return { hidden: null, removeRepo: row.repoId };
  const list = (Array.isArray(hidden) ? hidden : []).filter((e) => e?.id !== row.id);
  return { hidden: [...list, { id: row.id, held: Boolean(row.open) }], removeRepo: null };
}
