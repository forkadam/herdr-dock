// Host extraction and production-host matching (pure). Patterns: "host" or "*.host".

// Lower-case host without port or credentials; null for URLs with no host (about:, file:///).
export function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(String(url ?? "").trim());
  if (!m) return null;
  let h = m[1].slice(m[1].lastIndexOf("@") + 1);
  h = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.replace(/:\d*$/, "");
  h = h.replace(/\.$/, "");
  return h ? h.toLowerCase() : null;
}

// The host when it matches a pattern ("*.x.com" matches any depth below x.com, not x.com), else null.
export function isProduction(url, patterns) {
  const host = hostOf(url);
  if (!host) return null;
  for (const raw of patterns ?? []) {
    const p = String(raw).toLowerCase();
    if (p.startsWith("*.") ? host.endsWith(p.slice(1)) && host.length > p.length - 1 : host === p) return host;
  }
  return null;
}
