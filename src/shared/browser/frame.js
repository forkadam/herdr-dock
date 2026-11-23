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

const NAMED = {
  enter: "Enter", backspace: "Backspace", delete: "Delete", tab: "Tab", escape: "Escape",
  left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
  home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
};
const mask = (m = {}) => (m.alt ? 1 : 0) | (m.control ? 2 : 0) | (m.platform ? 4 : 0) | (m.shift ? 8 : 0);

export function keyEvents(e) {
  const modifiers = mask(e.modifiers);
  let key, text;
  const name = String(e.key ?? "").toLowerCase();
  if (NAMED[name]) { key = NAMED[name]; if (name === "enter") text = "\r"; }
  else if (name === "space") { key = " "; text = " "; }
  else if (e.key_char) { key = e.key_char; text = e.key_char; }
  else return [];
  if (modifiers & 6) text = undefined;
  const down = { type: "input_keyboard", eventType: "keyDown", key };
  if (text !== undefined) down.text = text;
  down.modifiers = modifiers;
  return [down, { type: "input_keyboard", eventType: "keyUp", key, modifiers }];
}

export function wheelEvent(e, frameW, drawnW) {
  const { x, y } = toPage(e.local_position, frameW, drawnW);
  return { type: "input_mouse", eventType: "mouseWheel", x, y, deltaX: -e.delta.x, deltaY: -e.delta.y };
}

export function mouseEvents(kind, e, frameW, drawnW) {
  const { x, y } = toPage(e.local_position, frameW, drawnW);
  const ev = (eventType) => ({ type: "input_mouse", eventType, x, y, button: "left", clickCount: e.click_count ?? 1 });
  if (kind === "down") return [ev("mouseMoved"), ev("mousePressed")];
  if (kind === "up") return [ev("mouseReleased")];
  return [ev("mouseMoved")];
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
        const errorTexts = [...(state.errorTexts ?? []), consoleText(msg)].slice(-MAX_ERRORS);
        return { ...state, errors: (state.errors ?? 0) + 1, errorTexts };
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
