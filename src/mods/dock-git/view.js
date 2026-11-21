// Pure view model for the Git projects feature (no host imports: node --test runs it).
import { worktreeId } from "../../shared/git.js";
import { slashPath } from "../../shared/path.js";

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

// The badge's tooltip: the status, and why it's unknown or stale.
function pipelineTip(p) {
  if (!p) return "No pipeline";
  if (p.error) return `Pipeline: ${p.error}${p.hint ? ` · run ${p.hint}` : ""}`;
  const s = p.status === "none" ? "no pipeline yet" : p.status;
  // number is the display number (GitHub: run_number); id is a 40-char sha on GitHub, so never shown.
  return `Pipeline ${p.number != null ? `#${p.number} ` : ""}${s}${p.stale ? " · older commit than local HEAD" : ""} · click for details`;
}

export function repoWebUrl(repo) {
  return repo?.host && repo?.path ? `https://${repo.host}/${repo.path}` : null;
}

// dock.git.state + dock.git.selected -> rows: each repo, then its worktrees; one "empty" row with no repos.
export function gitRows(state, selected) {
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
        badge: badgeOf(w.pipeline), badgeTip: pipelineTip(w.pipeline),
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
