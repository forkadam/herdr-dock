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

// A badge with its tone: shared dock.page.badge.<mod> is a number or short string (tone "info"), or
// { count | text, tone: "bad" | "warn" | "info" }. -> { text, tone } or null.
export function badgeOf(v) {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const text = badgeText(v.count ?? v.text);
    if (text === null) return null;
    return { text, tone: ["bad", "warn", "info"].includes(v.tone) ? v.tone : "info" };
  }
  const text = badgeText(v);
  return text === null ? null : { text, tone: "info" };
}
