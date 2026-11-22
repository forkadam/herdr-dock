// The content version of the app/ folder (Node scripts only: it imports node:crypto, so never import it from a
// mod; dock-core only compares the version strings).
import { createHash } from "node:crypto";

// dock-core's copy of VERSION.json holds the version itself (and the per-commit source), so it can't count either.
const EXCLUDED = new Set(["VERSION.json", "RECIPE.md", "preview.png", "mods/dock-core/VERSION.json"]);

// The paths (forward slashes, relative to app/) that count toward the version: not the three root files, nor
// dock-core's copy of VERSION.json.
export function appVersionFiles(paths) {
  return paths.filter((p) => !EXCLUDED.has(p));
}

// 12 hex digits over [{ path, bytes }]: sorted by path, each path and its bytes length-framed.
export function contentVersion(files) {
  const h = createHash("sha256");
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { path, bytes } of sorted) {
    const buf = Buffer.from(bytes);
    h.update(`${path}\0${buf.length}\0`);
    h.update(buf);
  }
  return h.digest("hex").slice(0, 12);
}
