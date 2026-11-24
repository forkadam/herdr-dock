// Where a ticket's work starts (pure; no host imports): the folder (remembered for the ticket, else mapped from its Jira
// project), the space already working in it, the picker's rows, the remembered map and the Herdr command to run; and,
// once the page's one node run (folderProbe) has said what home is and which folders exist, where a plain Start opens
// (startPlace) or what the picker offers (pickerChoices, pickerKey).
// Everything here is a folder; a space is only where a tab goes. Herdr's shapes (SpaceInfo, PaneInfo) are handed in.
import { isAbsolutePath, slashPath } from "../path.js";

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

// A folder as the picker shows it: home as `~`, a folder below it as `~/…`, any other as it is (home unknown: as is).
export function tildePath(folder, home) {
  const h = normPath(home);
  const base = h.replace(/\/$/, ""); // home without a trailing "/", for the "~/…" form
  if (h && folder === h) return "~";
  return h && folder.startsWith(`${base}/`) ? `~${folder.slice(base.length)}` : folder;
}

// The folders this computer's spaces are working in, one row each: { folder, label (its last part), path (home shown
// as ~), spaces (the names of the spaces in it) }. Home itself and empty folders are left out. The `mapped` folder
// (the ticket's project's, if any) comes first, added when no space is in it; the rest by label.
export function pickerRows({ spaces, panes, home, mapped } = {}) {
  const h = normPath(home);
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
  const rows = [...names].map(([folder, inSpaces]) => ({ folder, label: leaf(folder), path: tildePath(folder, home), spaces: inSpaces }));
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

// ---- On this computer: the probe, the plain Start's place, the picker ----

// One node run (one exec per Start, Finish or picker) that prints the home folder (HOME, else USERPROFILE; null when
// neither is set) and which of the paths given after "--" are folders here, each with a leading `~` expanded by that
// home first: { home, exists: [boolean] }. A relative path, `~user`, or `~` with no home is never a folder, so
// nothing is guessed. Node is herdr-dock's anyway; Herdr's own file reads are for text.
const PROBE = "const fs=require('fs'),path=require('path');"
  + "const home=process.env.HOME||process.env.USERPROFILE||null;"
  + "const full=(p)=>{if(p==='~'||p.startsWith('~/')){if(!home)return null;p=home+p.slice(1);}return path.isAbsolute(p)?p:null;};"
  + "const dir=(p)=>{try{return p!==null&&fs.statSync(p).isDirectory();}catch{return false;}};"
  + "console.log(JSON.stringify({home,exists:process.argv.slice(1).map((p)=>dir(full(p)))}));";

export const folderProbe = (paths) => ({ command: "node", args: ["-e", PROBE, "--", ...paths] });

// folderProbe's stdout -> { home (null when unknown), exists(path) -> boolean }, or null when it isn't the probe's
// answer for `paths`. The page treats null (and a probe that failed to run) as "no folder exists": the picker asks.
export function parseFolderProbe(stdout, paths) {
  let r;
  try { r = JSON.parse(stdout); } catch { return null; }
  if (!isObj(r) || !Array.isArray(r.exists) || r.exists.length !== paths.length) return null;
  const there = new Set(paths.filter((_p, i) => r.exists[i] === true));
  return { home: nonEmpty(r.home) ? r.home : null, exists: (p) => there.has(p) };
}

// A folder setting or remembered folder as the probe gets it: slashes cleaned, `~` left for the probe to expand.
const asWritten = (folder) => (folder ? normPath(folder) : null);

// Whether a folder (as written) is one to open in: the probe found it, and with home known it is absolute (an
// unexpanded `~/x` never reaches Herdr).
const usable = (folder, probe) => Boolean(folder && probe && probe.exists(folder) && isAbsolutePath(normPath(folder, probe.home)));

// The folders a Start, Finish or picker asks the probe about: the ticket's remembered folder, its parent's and its
// project's mapped one, as written, without repeats.
export function probePaths(issue, { remembered, projects } = {}) {
  const found = [own(remembered, issue?.key), own(remembered, issue?.parent?.key), own(projects, issue?.project)].map(asWritten);
  return [...new Set(found.filter(Boolean))];
}

// Where a plain Start or Finish opens without asking, once the probe answered: the folder remembered for the ticket,
// else its project's mapped one (resolveFolder), when the probe found it here, with the space already working in it
// (spaceFor; null: openCommand makes one). Null: the picker asks (nothing resolves, the folder is missing, the probe
// failed, or home is unknown). A remembered folder that is missing asks even when the project is mapped.
export function startPlace(issue, { remembered, projects, probe, spaces, panes, shownSpace } = {}) {
  const raw = resolveFolder(issue, { remembered, projects });
  if (!raw || !usable(raw.folder, probe)) return null;
  const folder = normPath(raw.folder, probe.home);
  return { folder, source: raw.source, space: spaceFor(folder, { spaces, panes, shownSpace, home: probe.home }) };
}

// The picker's choices, once the probe answered: `rows` (pickerRows, with the project's mapped folder first when the
// probe found it), `selected` (the entry to preselect: suggestFolder's among the folders found here, so a missing one
// gives way to the next; a suggested folder no space is in gets a row of its own, after the mapped one; nothing to
// suggest: Here, so a quick Enter starts where Start always did, never in some other repo) and `here` (the focused
// terminal's folder, `{ folder, path }`, or null when Herdr names none). In a space on another machine (`shownSpace`'s
// `machine`), Here has no folder on this PC (`folder` null: the tab starts as before, in that space) and its path
// says which machine. The picker's entries are the rows, then Here, then Other folder….
export function pickerChoices(issue, { remembered, projects, probe, spaces, panes, here, shownSpace } = {}) {
  const home = probe?.home ?? null;
  const found = (map, key) => (usable(asWritten(own(map, key)), probe) ? { [key]: own(map, key) } : {});
  const rem = { ...found(remembered, issue?.parent?.key), ...found(remembered, issue?.key) };
  const proj = found(projects, issue?.project);
  const mapped = own(proj, issue?.project);
  const rows = pickerRows({ spaces, panes, home, mapped });
  const suggested = suggestFolder(issue, { remembered: rem, projects: proj, home });
  if (suggested && !rows.some((r) => r.folder === suggested)) {
    rows.splice(mapped ? 1 : 0, 0, pickerRows({ home, mapped: suggested })[0]);
  }
  const at = suggested ? rows.findIndex((r) => r.folder === suggested) : -1;
  const machine = (Array.isArray(spaces) ? spaces : []).find((s) => s.id === shownSpace)?.machine ?? null;
  const cwd = nonEmpty(here) ? normPath(here, home) : null;
  const hereEntry = machine != null ? { folder: null, path: cwd ? `${here} (on ${machine})` : `on ${machine}` }
    : cwd ? { folder: cwd, path: tildePath(cwd, home) } : null;
  return { rows, selected: at < 0 ? rows.length : at, here: hereEntry };
}

// Why a plain Start or Finish opened the picker, for one dim line under its title: it had a folder (remembered for the
// ticket, else its project's) it couldn't use. "<folder> (KEY's remembered folder) isn't on this PC", "<folder>
// (PROJECT's folder) isn't on this PC", or "Couldn't check folders" when the probe failed or home is unknown for a `~`
// folder. Null: Start in… (`ask`), a ticket with no folder (it simply asks), or a folder that is here.
export function pickerReason(issue, { remembered, projects, probe, ask = false } = {}) {
  if (ask) return null;
  const raw = resolveFolder(issue, { remembered, projects });
  if (!raw) return null;
  const home = probe?.home ?? null;
  const full = normPath(raw.folder, home);
  if (!probe || !isAbsolutePath(full)) return "Couldn't check folders";
  if (usable(raw.folder, probe)) return null;
  const whose = raw.source === "remembered" ? `${issue.key}'s remembered folder` : `${issue.project}'s folder`;
  return `${tildePath(full, home)} (${whose}) isn't on this PC`;
}

// A key pressed in the picker (`count` entries, `selected` the highlighted one): { selected } for the arrows (held
// within the list), { pick } for Enter, { close } for Escape; null for a key that isn't the picker's.
export function pickerKey(key, selected, count) {
  if (key === "up") return { selected: Math.max(0, selected - 1) };
  if (key === "down") return { selected: Math.min(count - 1, selected + 1) };
  if (key === "enter") return { pick: selected };
  if (key === "escape") return { close: true };
  return null;
}
