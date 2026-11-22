// The git.* commands that mods send to dock-core, and how dock-core reads them back (pure; no Node built-ins).
// Herdr delivers "<mod>.<command>" to nextCommand() as the bare string after "<mod>." and drops run()'s args
// (spike, Task 5), so arguments ride in the command name: a worktree id as base64url, a job index as digits.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function utf8(str) {
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

// Unpadded base64url of the string's UTF-8 bytes.
export function b64urlEncode(str) {
  const b = utf8(String(str));
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < b.length) s += ALPHABET[(n >> 6) & 63];
    if (i + 2 < b.length) s += ALPHABET[n & 63];
  }
  return s;
}

// The string back, or null when s isn't valid base64url of UTF-8.
export function b64urlDecode(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const bytes = [];
  for (let i = 0; i < s.length; i += 4) {
    const q = s.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) n = (n << 6) | (j < q.length ? ALPHABET.indexOf(q[j]) : 0);
    bytes.push((n >> 16) & 255);
    if (q.length > 2) bytes.push((n >> 8) & 255);
    if (q.length > 3) bytes.push(n & 255);
  }
  // Strict UTF-8: no overlong forms, surrogates or code points past U+10FFFF. Total: never throws.
  const MIN = [0, 0, 0x80, 0x800, 0x10000];
  let out = "";
  try {
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      const len = b < 0x80 ? 1 : (b & 0xe0) === 0xc0 ? 2 : (b & 0xf0) === 0xe0 ? 3 : (b & 0xf8) === 0xf0 ? 4 : 0;
      if (!len || i + len > bytes.length) return null;
      let c = len === 1 ? b : b & (0xff >> (len + 1));
      for (let j = 1; j < len; j++) {
        if ((bytes[i + j] & 0xc0) !== 0x80) return null;
        c = (c << 6) | (bytes[i + j] & 63);
      }
      if ((len > 1 && c < MIN[len]) || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) return null;
      out += String.fromCodePoint(c);
      i += len;
    }
  } catch {
    return null;
  }
  return out;
}

// The dock-core command for a git.* request (without the "dock-core." prefix). Throws on a bad request, so a
// caller's mistake shows at once rather than as a command that silently does nothing.
export function gitCommandName(name, args = {}) {
  switch (name) {
    case "git.refresh": case "git.retry": case "git.open":
      return name;
    case "git.open.job":
      if (!Number.isInteger(args?.index) || args.index < 0) throw new Error("git.open.job needs { index }");
      return `${name}.${args.index}`;
    case "git.select": case "git.delete":
      if (typeof args?.worktree !== "string") throw new Error(`${name} needs { worktree }`);
      return `${name}.${b64urlEncode(args.worktree)}`;
    case "git.show":
      return typeof args?.worktree === "string" ? `${name}.${b64urlEncode(args.worktree)}` : name;
    default:
      throw new Error(`unknown git command: ${name}`);
  }
}

// What dock-core's nextCommand() string asks for: { cmd, worktree?, index? }, or null when it isn't a valid
// git.* command. A bare git.show has worktree null (show the current selection).
export function parseGitCommand(c) {
  if (typeof c !== "string" || !c.startsWith("git.")) return null;
  const rest = c.slice(4);
  if (rest === "refresh" || rest === "retry" || rest === "open") return { cmd: rest };
  if (rest === "show") return { cmd: "show", worktree: null };
  let m = /^open\.job\.(\d+)$/.exec(rest);
  if (m) return { cmd: "open.job", index: Number(m[1]) };
  m = /^(select|show|delete)\.([A-Za-z0-9_-]+)$/.exec(rest);
  if (m) {
    const worktree = b64urlDecode(m[2]);
    return worktree == null ? null : { cmd: m[1], worktree };
  }
  return null;
}

const DIALOG = { mod: "dock-pipelines", kind: "dialog", width: 640, height: 0.7 };

// How dock-core reveals a mod: in the right panel when this PC's merged config places it there
// ({ set: shared keys }), else as a dialog ({ overlay: a copy of the openOverlay spec }).
export function revealPlan(merged, mod, dialog) {
  const placed = (merged?.regions?.right?.features ?? []).some((f) => f?.mod === mod);
  if (placed) return { set: { "dock.right.active": mod, "dock.right.shown": true } };
  return { overlay: { ...dialog } };
}

// How git.show reveals dock-pipelines.
export const showPlan = (merged) => revealPlan(merged, "dock-pipelines", DIALOG);
