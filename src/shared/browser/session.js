// Session names, app-home-relative paths and URL normalisation for dock-browser (pure).

export function sessionName(scope, terminal) {
  if (!terminal) throw new Error("sessionName: a terminal id is required");
  const tail = String(scope ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(-8);
  return `dock-${tail}-${terminal}`;
}

export const BROWSER_REL = "herdr-dock/browser";
export const sessionsRel = () => `${BROWSER_REL}/sessions`;
export const sessionFileRel = (t) => `${sessionsRel()}/${t}.json`;
export const controlFileRel = (t) => `${sessionsRel()}/${t}.control.json`;
export const framesRel = (t) => `${BROWSER_REL}/frames/${t}`;
export const picksRel = () => `${BROWSER_REL}/picks`;
export const signedInRel = () => `${BROWSER_REL}/profiles/signed-in.json`;
export const binRel = (platform) => `${BROWSER_REL}/bin/agent-browser${platform === "win32" ? ".exe" : ""}`;

// What a person typed as a URL, turned into something a browser opens.
export function normalizeUrl(input) {
  const s = String(input ?? "").trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data|blob|javascript|mailto):/i.test(s)) return s;
  if (/^[A-Za-z]:[\\/]/.test(s)) return `file:///${s.replace(/\\/g, "/")}`;
  if (s.startsWith("/")) return `file://${s}`;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-fA-F:]+\])(:\d+)?([/?#]|$)/i.test(s)) return `http://${s}`;
  return `https://${s}`;
}
