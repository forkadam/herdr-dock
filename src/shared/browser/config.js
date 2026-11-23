// The `browser` config section: validation, defaults and the dock-browser feature rule (pure).

export const DEFAULT_BROWSER = { enabled: false, chrome: "", production: [], handoffMinutes: 15 };

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
// [*.]label(.label)* of letters, digits and "-": no scheme, path or port.
const HOST_PATTERN = /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

// Error text, or null when the value is a valid browser section. `where` prefixes the message.
export function checkBrowser(value, where = "browser") {
  if (!isObj(value)) return `${where}: must be an object`;
  for (const [k, v] of Object.entries(value)) {
    const at = `${where}.${k}`;
    if (k === "enabled") {
      if (typeof v !== "boolean") return `${at}: must be true or false`;
    } else if (k === "chrome") {
      if (typeof v !== "string") return `${at}: must be a string`;
    } else if (k === "handoffMinutes") {
      if (!(Number.isInteger(v) && v > 0)) return `${at}: must be a positive integer`;
    } else if (k === "production") {
      if (!Array.isArray(v)) return `${at}: must be an array`;
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] !== "string" || !HOST_PATTERN.test(v[i])) return `${at}[${i}]: must be a host pattern like example.com or *.example.com`;
      }
    } else return `${at}: unknown setting`;
  }
  return null;
}

// The merged config's browser settings, defaults filled.
export function browserOf(merged) {
  return { ...DEFAULT_BROWSER, ...(isObj(merged?.browser) ? merged.browser : {}) };
}

// New regions: enabled puts dock-browser at the end of right's features unless a region already
// lists it; disabled removes it everywhere.
export function withBrowserFeature(regions, enabled) {
  const out = {};
  for (const [name, r] of Object.entries(regions)) {
    out[name] = { ...r, features: enabled ? [...r.features] : r.features.filter((f) => f.mod !== "dock-browser") };
  }
  if (enabled && !Object.values(out).some((r) => r.features.some((f) => f.mod === "dock-browser"))) {
    out.right.features.push({ mod: "dock-browser" });
  }
  return out;
}
