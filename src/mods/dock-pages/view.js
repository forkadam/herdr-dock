// Pure helpers for the Pages list (no host imports: node --test runs them).

// A page's title and icon: mod.json's title, else the manifest name, else its id; the manifest icon, else
// icon.svg when it exists, else none (a letter is drawn).
export function pageMeta(id, modJson, manifest, hasIconSvg) {
  const title = (typeof modJson?.title === "string" && modJson.title) || (typeof manifest?.name === "string" && manifest.name) || id;
  const icon = typeof manifest?.icon === "string" && manifest.icon ? `mods/${id}/${manifest.icon}` : hasIconSvg ? `mods/${id}/icon.svg` : null;
  return { title, icon };
}

// A page's badge (shared dock.page.badge.<mod>): a positive number (99+ past 99) or a short string; else null.
export function badgeText(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v > 0 ? (v > 99 ? "99+" : String(Math.round(v))) : null;
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 6);
  return null;
}
