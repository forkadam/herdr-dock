// Pure parsers for git output (no Node built-ins: bundled into Herdr mods).
import { slashPath } from "./path.js";

const lines = (s) => String(s ?? "").split(/\r?\n/);

// `git worktree list --porcelain` -> one entry per worktree.
export function parseWorktrees(porcelain) {
  const out = [];
  let cur = null;
  for (const line of lines(porcelain)) {
    if (line.startsWith("worktree ")) {
      cur = { path: slashPath(line.slice(9)), head: "", branch: null, detached: false, bare: false };
      out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5).trim();
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    else if (line === "detached") cur.detached = true;
    else if (line === "bare") cur.bare = true;
  }
  return out;
}

// `git status --porcelain=v2 --branch`.
export function parseStatus(porcelainV2) {
  const r = { branch: null, oid: null, upstream: null, ahead: null, behind: null, dirty: false };
  for (const line of lines(porcelainV2)) {
    if (line.startsWith("# branch.oid ")) {
      const v = line.slice(13).trim();
      r.oid = v === "(initial)" ? null : v;
    } else if (line.startsWith("# branch.head ")) {
      const v = line.slice(14).trim();
      r.branch = v === "(detached)" ? null : v;
    } else if (line.startsWith("# branch.upstream ")) r.upstream = line.slice(18).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) { r.ahead = Number(m[1]); r.behind = Number(m[2]); }
    } else if (line && !line.startsWith("#")) r.dirty = true;
  }
  return r;
}

const isAbs = (p) => /^([A-Za-z]:)?\//.test(p);

// `git rev-parse --show-toplevel --git-common-dir`: two lines. A relative common dir is
// resolved against top.
export function parseRevParse(stdout) {
  const [a = "", b = ""] = lines(stdout).map((l) => l.trim()).filter(Boolean);
  const top = slashPath(a);
  let commonDir = b.replace(/[\\]/g, "/");
  if (!isAbs(commonDir)) {
    const parts = [];
    for (const seg of `${top}/${commonDir}`.split("/")) {
      if (seg === "." || (seg === "" && parts.length)) continue;
      if (seg === ".." && parts.length > 1) parts.pop();
      else parts.push(seg);
    }
    commonDir = parts.join("/");
  }
  return { top, commonDir: slashPath(commonDir) };
}

// A remote URL -> { host, path }. SSH hosts drop the port; HTTPS keeps it.
export function parseRemote(url) {
  const s = String(url ?? "").trim();
  let m = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(s);
  let host, path;
  if (m && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) [, host, path] = m;
  else if ((m = /^ssh:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+)$/i.exec(s))) [, host, path] = m;
  else if ((m = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(s))) [, host, path] = m;
  else return null;
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  return host && path ? { host, path } : null;
}

// Stable id of a worktree: "<machine or ''>|<path>". Windows paths are case-insensitive.
export function worktreeId(machine, path, platform) {
  let p = slashPath(path);
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  if (platform === "windows") p = p.toLowerCase();
  return `${machine ?? ""}|${p}`;
}
