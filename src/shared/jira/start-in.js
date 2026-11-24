// Where a ticket's work starts (pure; no host imports): the folder (remembered for the ticket, else mapped from its Jira
// project), the space already working in it, the picker's rows, the remembered map and the Herdr command to run.
// Everything here is a folder; a space is only where a tab goes. Herdr's shapes (SpaceInfo, PaneInfo) are handed in.
import { slashPath } from "../path.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const own = (map, key) => (isObj(map) && Object.hasOwn(map, key) && nonEmpty(map[key]) ? map[key] : null);
const leaf = (folder) => folder.split("/").filter(Boolean).pop() ?? folder;

// A path in one form to compare: `~` and `~/…` expanded with `home`, backslashes as `/`, no trailing `/` (but a root
// stays one). Empty stays empty.
export function normPath(path, home) {
  let s = String(path ?? "").replace(/\\/g, "/");
  if (s === "") return "";
  const h = nonEmpty(home) ? slashPath(home) : "";
  if (h && (s === "~" || s.startsWith("~/"))) {
    const rest = s.slice(1);
    s = rest ? h.replace(/\/$/, "") + rest : h;
  }
  return slashPath(s);
}

// `path` is `folder` or below it ("/a/bc" is not inside "/a/b"). Both are normalised; neither is expanded.
export function inside(path, folder) {
  const p = normPath(path);
  const f = normPath(folder);
  if (!p || !f) return false;
  return p === f || p.startsWith(f.endsWith("/") ? f : `${f}/`);
}

// The `projects` setting: a Jira project key -> a folder. A bad entry is a warning and the rest stays, as in
// jiraOptions. Folders are trimmed but not expanded (`~` is the home folder of whoever reads them).
export function parseProjects(value) {
  const projects = {};
  const warnings = [];
  if (value == null) return { projects, warnings };
  if (!isObj(value)) return { projects, warnings: ["projects: not a map of project key to folder"] };
  for (const [key, folder] of Object.entries(value)) {
    const k = key.trim();
    if (!k || !nonEmpty(folder)) { warnings.push(`projects.${key}: must be a folder path`); continue; }
    projects[k] = folder.trim();
  }
  return { projects, warnings };
}

// An issue ({ key, project }) -> where its work starts: the folder remembered for this ticket, else the one mapped
// from its project, else null (the page asks). Folders come back normalised.
export function resolveFolder(issue, { remembered, projects, home } = {}) {
  const mine = own(remembered, issue?.key);
  if (mine) return { folder: normPath(mine, home), source: "remembered" };
  const mapped = own(projects, issue?.project);
  if (mapped) return { folder: normPath(mapped, home), source: "mapped" };
  return null;
}

// The picker's preselection: the ticket's remembered folder, else its parent's, else the mapped one.
export function suggestFolder(issue, { remembered, projects, home } = {}) {
  const found = own(remembered, issue?.key) ?? own(remembered, issue?.parent?.key) ?? own(projects, issue?.project);
  return found ? normPath(found, home) : null;
}

// The space on this computer (machine == null) already working in `folder`: its own folder is it, or one of its
// terminals (a pane, joined to the space through its tabs) is in it or below. The shown space wins; else the first in
// order; none: null.
export function spaceFor(folder, { spaces, panes, shownSpace, home } = {}) {
  const target = normPath(folder, home);
  if (!target) return null;
  const matches = (Array.isArray(spaces) ? spaces : []).filter((space) => {
    if (space.machine != null) return false;
    if (normPath(space.folder, home) === target) return true;
    const tabs = new Set((space.tabs ?? []).map((t) => t.id));
    return (Array.isArray(panes) ? panes : []).some((p) => tabs.has(p.tab) && inside(normPath(p.cwd, home), target));
  });
  return matches.find((space) => space.id === shownSpace) ?? matches[0] ?? null;
}

// The folders this computer's spaces are working in, one row each: { folder, label (its last part), path (home shown
// as ~), spaces (the names of the spaces in it) }. Home itself and empty folders are left out. The `mapped` folder
// (the ticket's project's, if any) comes first, added when no space is in it; the rest by label.
export function pickerRows({ spaces, panes, home, mapped } = {}) {
  const h = normPath(home);
  const base = h.replace(/\/$/, ""); // home without a trailing "/", for the "~/…" form
  const names = new Map(); // folder -> the names of the spaces in it
  for (const space of Array.isArray(spaces) ? spaces : []) {
    if (space.machine != null) continue;
    const tabs = new Set((space.tabs ?? []).map((t) => t.id));
    const cwds = (Array.isArray(panes) ? panes : []).filter((p) => tabs.has(p.tab)).map((p) => p.cwd);
    for (const f of [space.folder, ...cwds]) {
      const folder = normPath(f, home);
      if (!folder || folder === h) continue;
      if (!names.has(folder)) names.set(folder, []);
      if (!names.get(folder).includes(space.name)) names.get(folder).push(space.name);
    }
  }
  const first = normPath(mapped, home);
  if (first && !names.has(first)) names.set(first, []);
  const shown = (folder) => (h && folder === h ? "~" : h && folder.startsWith(`${base}/`) ? `~${folder.slice(base.length)}` : folder);
  const rows = [...names].map(([folder, inSpaces]) => ({ folder, label: leaf(folder), path: shown(folder), spaces: inSpaces }));
  const rank = (row) => (row.folder === first ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label) || a.folder.localeCompare(b.folder));
}

// The remembered folders (ticket key -> folder) with `key` set and last, so an existing key moves to the end; when
// there are more than `cap`, the oldest keys are dropped. A new map; the one handed in is not changed.
export function remember(map, key, folder, cap = 300) {
  const entries = Object.entries(isObj(map) ? map : {}).filter(([k]) => k !== key);
  entries.push([key, folder]);
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - cap)));
}

// The Herdr command that opens Claude on `task`: a tab named `name` in `space`, always given the folder (a space's own
// folder is often not its repo); with no space, a new space on the folder (named after its last part) with the tab in it.
export function openCommand({ folder, space, name, task }) {
  const argv = ["claude"];
  if (space) return { command: "tab.new", args: { space: space.id, folder, name, argv, task } };
  return { command: "space.new", args: { name: leaf(folder), folder, tab: name, argv, task } };
}
