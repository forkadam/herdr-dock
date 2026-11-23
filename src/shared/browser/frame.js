// Frame size, click and key mapping, frame files and the stream reducer for the live panel (pure: no Node, no host imports).

// Width and height from the first SOFn marker (not DHT C4, JPG C8, DAC CC).
export function jpegSize(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 8 >= bytes.length) return null;
      const h = (bytes[i + 5] << 8) | bytes[i + 6];
      const w = (bytes[i + 7] << 8) | bytes[i + 8];
      return w && h ? { w, h } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

export const toPage = (local, frameW, drawnW) => {
  const k = frameW / drawnW;
  return { x: Math.round(local.x * k), y: Math.round(local.y * k) };
};
export const drawnHeight = (frame, drawnW) => (frame.h * drawnW) / frame.w;

// Named keys: the DOM key, and the Windows key code Chrome needs before it acts on one (Backspace, the arrows and
// Tab do nothing in a text field with the key name alone).
const NAMED = {
  enter: ["Enter", 13], backspace: ["Backspace", 8], delete: ["Delete", 46], tab: ["Tab", 9], escape: ["Escape", 27],
  left: ["ArrowLeft", 37], right: ["ArrowRight", 39], up: ["ArrowUp", 38], down: ["ArrowDown", 40],
  home: ["Home", 36], end: ["End", 35], pageup: ["PageUp", 33], pagedown: ["PageDown", 34],
};
const mask = (m = {}) => (m.alt ? 1 : 0) | (m.control ? 2 : 0) | (m.platform ? 4 : 0) | (m.shift ? 8 : 0);

export function keyEvents(e) {
  const modifiers = mask(e.modifiers);
  let key, text, named = null;
  const name = String(e.key ?? "").toLowerCase();
  if (NAMED[name]) { named = NAMED[name]; key = named[0]; if (name === "enter") text = "\r"; }
  else if (name === "space") { key = " "; text = " "; named = ["Space", 32]; }
  else if (e.key_char) { key = e.key_char; text = e.key_char; }
  else return [];
  if (modifiers & 6) text = undefined;
  const codes = named ? { code: named[0], windowsVirtualKeyCode: named[1] } : {};
  const down = { type: "input_keyboard", eventType: "keyDown", key, ...codes };
  if (text !== undefined) down.text = text;
  down.modifiers = modifiers;
  return [down, { type: "input_keyboard", eventType: "keyUp", key, ...codes, modifiers }];
}

export function wheelEvent(e, frameW, drawnW) {
  const { x, y } = toPage(e.local_position, frameW, drawnW);
  return { type: "input_mouse", eventType: "mouseWheel", x, y, deltaX: -e.delta.x, deltaY: -e.delta.y };
}

// A move carries the left button only while it is held (a drag); otherwise it is a hover.
export function mouseEvents(kind, e, frameW, drawnW, pressed = false) {
  const { x, y } = toPage(e.local_position, frameW, drawnW);
  const ev = (eventType, button = "left") => ({ type: "input_mouse", eventType, x, y, button, clickCount: e.click_count ?? 1 });
  if (kind === "down") return [ev("mouseMoved", "none"), ev("mousePressed")];
  if (kind === "up") return [ev("mouseReleased")];
  return [ev("mouseMoved", pressed ? "left" : "none")];
}

export class FrameRing {
  constructor(dirRel, keep = 6) { this.dir = dirRel; this.keep = keep; this.list = []; }
  next(seq) {
    const rel = `${this.dir}/f${seq}.jpg`;
    this.list.push(rel);
    const drop = this.list.length > this.keep ? this.list.splice(0, this.list.length - this.keep) : [];
    return { rel, drop };
  }
  get current() { return this.list.at(-1) ?? null; }
  get prev() { return this.list.length > 1 ? this.list.at(-2) : null; }
  clear() { const all = this.list; this.list = []; return all; }
}

const MAX_ERRORS = 20;
function consoleText(m) {
  if (typeof m.text === "string") return m.text;
  if (Array.isArray(m.args)) {
    return m.args.map((a) => (a && typeof a === "object" ? String(a.value ?? a.description ?? "") : String(a))).join(" ");
  }
  return "";
}

// The panel's reducer. A `frame` is handled by the caller (it writes the file); the rest lands in state.
export function streamStep(state, msg) {
  if (msg && msg.error !== undefined && !msg.type) return { ...state, phase: "lost" };
  switch (msg?.type) {
    case "url": return { ...state, url: msg.url };
    case "tabs": return { ...state, tabs: msg.tabs };
    case "status": return { ...state, status: msg };
    case "console":
      if ((msg.level ?? msg.type) === "error" || msg.level === "error") {
        // agent-browser sends each console message twice: the same one again (timestamp and text) counts once.
        const key = `${msg.timestamp ?? ""}|${consoleText(msg)}`;
        if (msg.timestamp !== undefined && state.lastError === key) return state;
        const errorTexts = [...(state.errorTexts ?? []), consoleText(msg)].slice(-MAX_ERRORS);
        return { ...state, errors: (state.errors ?? 0) + 1, errorTexts, lastError: key };
      }
      return state;
    default: return state;
  }
}

// After the socket is lost: the session record gone means closed; otherwise reconnect at most every 2 s.
export function afterLoss(state, sessionExists, now) {
  if (!sessionExists) return "closed";
  if (state.lastReconnect !== undefined && now - state.lastReconnect < 2000) return "wait";
  state.lastReconnect = now;
  return "reconnect";
}

// Base64 to bytes in plain JS (the runtime's Buffer may lack base64); invalid characters count as 0.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LUT = new Uint8Array(128);
for (let i = 0; i < 64; i++) LUT[B64.charCodeAt(i)] = i;
export function decodeBase64(s) {
  s = String(s ?? "");
  let n = s.length;
  while (n && s[n - 1] === "=") n--;
  const out = new Uint8Array((n * 3) >> 2);
  let o = 0;
  const at = (i) => (i < n ? LUT[s.charCodeAt(i) & 127] : 0);
  for (let i = 0; i < n; i += 4) {
    const v = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6) | at(i + 3);
    if (o < out.length) out[o++] = v >> 16;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}

// The stream port from `agent-browser --session S stream status --json`, or 0. A daemon without a browser
// (connected false: the command itself starts an empty daemon when the session is gone) has no page to stream.
export function streamPort(stdout) {
  let o;
  try { o = JSON.parse(String(stdout ?? "")); } catch { return 0; }
  const d = o?.data;
  return o?.success && d?.connected && Number.isInteger(d.port) && d.port > 0 ? d.port : 0;
}

export const activeTab = (tabs) => (Array.isArray(tabs) ? tabs.find((t) => t?.active) ?? null : null);

// The header's title and url: the stream's active tab first, else the session record. The stream's tab title is
// often the bare URL until the page sets one, so the record's title stands while the URL is the record's.
export function pageHeading(record, state) {
  const tab = activeTab(state?.tabs);
  const url = String(tab?.url || state?.url || record?.url || "");
  const tabTitle = String(tab?.title ?? "");
  const fromRecord = record?.title && record.url === url ? record.title : "";
  const bare = !tabTitle || url.replace(/^[a-z]+:\/\//i, "").startsWith(tabTitle);
  return { title: (bare ? fromRecord || tabTitle : tabTitle) || url, url };
}
