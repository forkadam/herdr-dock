// Design Feedback (pure): the prompt Pick and Notes send to the agent, secrets taken out of it, and the bookkeeping of
// picked elements and their pictures. The prompt's shape follows cockpit's annotation Markdown (cockpit, MIT, itself
// ported from Orca, MIT, Copyright (c) 2026 Lovecast Inc.), cut down to what the panel collects.

export const INTENTS = ["fix", "change", "question", "approve"];
export const PRIORITIES = ["low", "normal", "high"];
export const NOTES_MAX = 20; // elements in Notes at once (a page)
export const TEXT_MAX = 200;
const PICTURE_DAYS = 1; // a sent picture is kept this long for the agent to open

const R = "[redacted]";
// key=value or key: value where the key names a credential, with any prefix or suffix (aws_secret_access_key,
// X-Api-Key). "auth" doesn't count in "author"/"authority"; a value that is "Bearer …" is left to BEARER.
const PAIR = /([\w-]*(?:secret|token|password|passwd|pwd|api[-_]?key|private[-_]?key|access[-_]?key|auth(?!or))[\w-]*)(\s*[=:]\s*)(?!(?:bearer|basic|token)\s)("[^"]*"|'[^']*'|[^\s&"',;]+)/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(bearer|basic|token)(\s+)([A-Za-z0-9._~+/=-]+)/gi;
const AWS_ID = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const HEX = /\b[0-9a-fA-F]{32,}\b/g;
const RUN40 = /[A-Za-z0-9/+=]{40,}/g; // an AWS secret key has "/" in it
const B64 = /[A-Za-z0-9+_-]{32,}={0,2}/g; // "/" splits these runs: a path is not one long run

const classes = (m) => [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(m)).length;
const mixed = (m) => /[a-z]/.test(m) && /[A-Z]/.test(m) && /[0-9]/.test(m);
// How often the kind of character (lower, upper, digit, other) changes from one to the next: about 0.65 in random
// base64, about 0.3 in a camelCase name made of words.
function switches(m) {
  const kind = (c) => (/[a-z]/.test(c) ? 0 : /[A-Z]/.test(c) ? 1 : /[0-9]/.test(c) ? 2 : 3);
  let n = 0;
  for (let i = 1; i < m.length; i++) if (kind(m[i]) !== kind(m[i - 1])) n++;
  return n / Math.max(1, m.length - 1);
}
// A run that looks random: upper case, lower case and digits, switching often, and (between - and _) a piece of 16
// or more (a slug or a snake_case name is made of short words).
const looksRandom = (m, min) => mixed(m) && switches(m) >= min && m.split(/[-_]/).some((p) => p.length >= 16);
// What follows Bearer: 8 or more characters of two kinds; Basic and Token: 16 or more ("the Basic plan" stays).
const authValue = (k, v) => (/^bearer$/i.test(k) ? v.length >= 8 && classes(v) >= 2 : v.length >= 16 && classes(v) >= 2);

// Values that look like secrets replaced with [redacted]: key=value pairs whose key names a credential, JWTs,
// Bearer/Basic/Token values, AWS access key ids, runs of 32 or more hex characters, and long runs that look random
// (40 or more with "/" allowed, or 32 or more base64url).
export function redact(s) {
  let out = String(s ?? "");
  if (!out) return "";
  out = out.replace(BEARER, (m, k, sp, v) => (authValue(k, v) ? `${k}${sp}${R}` : m));
  out = out.replace(PAIR, (m, k, sep, v) => (v === R ? m : `${k}${sep}${R}`));
  out = out.replace(JWT, R);
  out = out.replace(AWS_ID, R);
  out = out.replace(HEX, R);
  out = out.replace(B64, (m) => (looksRandom(m, 0.45) ? R : m)); // first: "/reset/<token>" keeps "/reset/"
  out = out.replace(RUN40, (m) => (mixed(m) && switches(m) >= 0.35 ? R : m));
  return out;
}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// A code span whose backticks are longer than any run inside it.
function code(s) {
  const runs = String(s).match(/`+/g) ?? [];
  const n = Math.max(0, ...runs.map((r) => r.length)) + 1;
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return "`".repeat(n) + pad + s + pad + "`".repeat(n);
}

// The prompt: "## Design Feedback", the page, then one numbered section per element (selector, source file:line on
// a dev build, its text, the person's note, intent and priority when given, its picture). Text, note and URL are
// redacted and kept to one line each.
export function designFeedback({ url, items }) {
  const lines = ["## Design Feedback", "", `Page: ${oneLine(redact(url)) || "(unknown)"}`];
  (items ?? []).forEach((it, i) => {
    lines.push("", `### ${i + 1}. ${code(oneLine(it.selector) || "(element)")}`);
    const src = it.source;
    if (src?.file) lines.push(`Source: ${oneLine(src.file)}${Number.isFinite(src.line) ? `:${src.line}` : ""}`);
    const text = oneLine(redact(oneLine(it.text))).slice(0, TEXT_MAX);
    if (text) lines.push(`Text: "${text}"`);
    lines.push(`Note: ${oneLine(redact(it.note)) || "(no note)"}`);
    if (it.intent) lines.push(`Intent: ${it.intent}`);
    if (it.priority) lines.push(`Priority: ${it.priority}`);
    if (it.picture) lines.push(`Picture: ${it.picture}`);
  });
  return lines.join("\n");
}

// New picks added to the list: Pick holds one element (the latest click), Notes up to `max`.
// Returns { added, dropped } (dropped: picks past the limit).
export function addPicks(items, picks, kind, max = NOTES_MAX) {
  const list = Array.isArray(picks) ? picks : [];
  if (kind === "pick") return { added: list.slice(-1), dropped: 0 };
  const room = Math.max(0, max - (items?.length ?? 0));
  return { added: list.slice(0, room), dropped: Math.max(0, list.length - room) };
}

// A picture's file name under picksRel(): the terminal, the time (base 36) and the pick's number.
export const pictureName = (t, now, n) => `${t}-${Math.floor(now).toString(36)}-${n}.png`;

// Picture names older than PICTURE_DAYS (their time is in the name; the host has no stat).
export function stalePicks(names, now) {
  const out = [];
  for (const name of names ?? []) {
    const m = /-([0-9a-z]+)-\d+\.png$/.exec(String(name));
    if (!m) continue;
    const at = parseInt(m[1], 36);
    if (Number.isFinite(at) && at > 1e12 && now - at > PICTURE_DAYS * 86_400_000) out.push(name);
  }
  return out;
}
