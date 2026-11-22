// How herdr-dock was installed (pure; no host imports): from mods/dock-core/source.json, a clone install (deploy
// writes { config, hostname, repo, commit }) or a Herdr-style app install (app/ ships { "mode": "app" }), and
// where each reads its shared config and its version.
import { slashPath } from "./path.js";

const isText = (v) => typeof v === "string" && v.trim() !== "";
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// "clone" | "app" | null. Deploy overwrites source.json with the clone form, so a repo or config wins over a mode.
export function modeOf(src) {
  if (!isObject(src)) return null;
  if (isText(src.repo) || isText(src.config)) return "clone";
  if (src.mode === "app") return "app";
  return null;
}

// { mode, configPath, repo, versionPath } for the app home, or null when source.json can't be used. App mode reads
// the shipped mods/dock-core/config.json (never written) and has no repo; clone mode reads the repo's config, the
// repo being source.json's repo (older deploys didn't write it: the config's parent folder).
export function installOf(src, home) {
  const mode = modeOf(src);
  if (mode === "app") {
    return { mode, configPath: `${home}/mods/dock-core/config.json`, repo: null, versionPath: `${home}/mods/dock-core/VERSION.json` };
  }
  if (mode !== "clone" || !isText(src.config)) return null;
  const configPath = slashPath(src.config);
  const repo = isText(src.repo) ? slashPath(src.repo) : configPath.split("/").slice(0, -2).join("/");
  return { mode, configPath, repo, versionPath: null };
}

// The published app/VERSION.json: a plain download first, then gh (while the repo is private).
export function publishedUrl({ repo, branch }) {
  return `https://raw.githubusercontent.com/${repo}/${branch}/app/VERSION.json`;
}

export function ghVersionArgs({ repo, branch }) {
  return ["api", `repos/${repo}/contents/app/VERSION.json?ref=${encodeURIComponent(branch)}`, "-H", "Accept: application/vnd.github.raw"];
}

// A VERSION.json's text -> { repo, branch, version, source, mods }, or null without repo, branch and version.
export function parseVersionJson(text) {
  let v;
  try { v = JSON.parse(text ?? "null"); } catch { return null; }
  if (!isObject(v) || !isText(v.repo) || !isText(v.branch) || !isText(v.version)) return null;
  return {
    repo: v.repo.trim(), branch: v.branch.trim(), version: v.version.trim(), source: isText(v.source) ? v.source.trim() : null,
    mods: Array.isArray(v.mods) ? v.mods.filter(isText) : [],
  };
}

// How to repair an install, worded by mode: an app install never has a clone to deploy from.
export function fixHint(mode) {
  if (mode === "app") return "reinstall herdr-dock from its app/ folder";
  if (mode === "clone") return "run npm run deploy";
  return "run npm run deploy (a clone install) or reinstall herdr-dock from its app/ folder";
}
