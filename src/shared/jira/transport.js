// How the Jira page sends a request (pure; no host imports). Two ways:
// - Herdr's fetch: the token goes in the Authorization header of a request inside Herdr.
// - curl (through exec): for a company certificate Herdr's fetch won't trust, since curl uses this computer's
//   certificates (or a CA file). The token is only in a config file curl reads with -K, never in the arguments,
//   which other programs on the computer can see.

const DEFAULT_TIMEOUT_MS = 20000;
const clean = (token) => String(token ?? "").replace(/[\r\n]/g, "").trim();

export function fetchRequest({ method = "GET", url, token, body }) {
  const headers = { Accept: "application/json", Authorization: `Bearer ${clean(token)}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return { url, options: { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) } };
}

// The curl config file's text (curl's quoted-string escapes: \" and \\).
export function curlConfig(token) {
  const t = clean(token).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `header = "Authorization: Bearer ${t}"\n`;
}

// curl's arguments. -w adds the HTTP status as the last line of stdout; --globoff keeps [ ] in URLs literal.
export function curlArgs({ method = "GET", url, configPath, body, timeoutMs = DEFAULT_TIMEOUT_MS, caFile }) {
  const args = ["-sS", "--globoff", "-K", configPath, "-X", method, "-H", "Accept: application/json"];
  if (body !== undefined) args.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body));
  if (caFile) args.push("--cacert", caFile);
  args.push("--max-time", String(Math.max(1, Math.round(timeoutMs / 1000))), "-w", "\n%{http_code}", url);
  return args;
}

// exec's result -> { status, text } or { curlCode, stderr } (curlCode -1: curl printed no status).
export function parseCurl({ code, stdout, stderr }) {
  if (code !== 0) return { curlCode: code, stderr: String(stderr ?? "").trim() };
  const out = String(stdout ?? "");
  const cut = out.lastIndexOf("\n");
  const status = Number(out.slice(cut + 1).trim());
  if (cut < 0 || !Number.isInteger(status) || status < 100) return { curlCode: -1, stderr: "curl printed no status" };
  return { status, text: out.slice(0, cut) };
}

export function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
