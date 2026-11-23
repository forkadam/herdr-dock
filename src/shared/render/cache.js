// The rendered-diagram cache (<app home>/herdr-dock/render/): what to delete (pure; no host imports). A diagram's
// file date is refreshed each time it is shown, so the date is "last used".
import { hashText } from "./markdown.js";

// The drawing's version: bumped whenever how a picture is drawn changes (painting, figures), so a file drawn before
// isn't shown again. It is part of the theme id, the cache name's second part.
export const LOOK_VERSION = 8;
export const themeKey = (theme) => hashText(`look${LOOK_VERSION}|${JSON.stringify(theme)}`);

export const CACHE_MAX_AGE_MS = 14 * 86400e3;
export const CACHE_MAX_COUNT = 300;
const TMP_MAX_AGE_MS = 3600e3;
const SVG = /^[0-9a-f]{8}-[0-9a-f]{8}\.svg$/;
const TMP = /^[0-9a-f]{8}-[0-9a-f]{8}\.svg\.\d+\.tmp$/;

// files: [{ name, mtimeMs }] -> the names to delete: diagrams unused for maxAgeMs, then the least recently used past
// maxCount, and temp files a crashed write left (after an hour). Other files are never touched.
export function cacheToPrune(files, nowMs, { maxAgeMs = CACHE_MAX_AGE_MS, maxCount = CACHE_MAX_COUNT } = {}) {
  const out = [];
  const keep = [];
  for (const f of files ?? []) {
    if (TMP.test(f.name)) { if (nowMs - f.mtimeMs > TMP_MAX_AGE_MS) out.push(f.name); continue; }
    if (!SVG.test(f.name)) continue;
    if (nowMs - f.mtimeMs >= maxAgeMs) out.push(f.name); else keep.push(f);
  }
  keep.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const f of keep.slice(maxCount)) out.push(f.name);
  return out.sort();
}
