// Pure path helpers (no Node built-ins: bundled into Herdr mods).

export function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

export function isAbsolutePath(p) {
  return /^([a-zA-Z]:)?[\\/]/.test(String(p));
}
