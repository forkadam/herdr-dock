// src/mods/dock-browser/main.js
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome as appHome2, checking, exec, focused, hc, props, readTextFile, shared, theme, watchFolder, window } from "herdr";
import * as fs2 from "fs/promises";

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/shared/layout.js
function rightActiveOf(active, features) {
  if (!features.length) return null;
  return features.some((f) => f.mod === active) ? active : features[0].mod;
}

// src/shared/panel.js
function rightShownOf(sharedShown, applied) {
  if (typeof sharedShown === "boolean") return sharedShown;
  return applied?.right?.hidden === false;
}

// src/shared/render/agent.js
function pickAgent(focus, agents2) {
  if (!focus || !Array.isArray(agents2)) return null;
  return agents2.find((a) => focus.pane && a.pane === focus.pane || focus.terminal && a.address === focus.terminal) ?? agents2.find((a) => a.tab === focus.tab) ?? null;
}

// src/shared/install.js
var isText = (v) => typeof v === "string" && v.trim() !== "";
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function modeOf(src) {
  if (!isObject(src)) return null;
  if (isText(src.repo) || isText(src.config)) return "clone";
  if (src.mode === "app") return "app";
  return null;
}
function installOf(src, home2) {
  const mode = modeOf(src);
  if (mode === "app") {
    return { mode, configPath: `${home2}/mods/dock-core/config.json`, repo: null, versionPath: `${home2}/mods/dock-core/VERSION.json` };
  }
  if (mode !== "clone" || !isText(src.config)) return null;
  const configPath = slashPath(src.config);
  const repo = isText(src.repo) ? slashPath(src.repo) : configPath.split("/").slice(0, -2).join("/");
  return { mode, configPath, repo, versionPath: null };
}

// src/shared/browser/config.js
var DEFAULT_BROWSER = { enabled: false, chrome: "", production: [], handoffMinutes: 15 };
var isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var HOST_PATTERN = /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
function checkBrowser(value, where = "browser") {
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
function browserOf(merged) {
  return { ...DEFAULT_BROWSER, ...isObj(merged?.browser) ? merged.browser : {} };
}
function withBrowserFeature(regions, enabled) {
  const out = {};
  for (const [name, r] of Object.entries(regions)) {
    out[name] = { ...r, features: enabled ? [...r.features] : r.features.filter((f) => f.mod !== "dock-browser") };
  }
  if (enabled && !Object.values(out).some((r) => r.features.some((f) => f.mod === "dock-browser"))) {
    out.right.features.push({ mod: "dock-browser" });
  }
  return out;
}

// src/shared/config.js
var REGION_NAMES = ["top", "left", "right", "bottom", "pages"];
var LEFT_MODES = ["expanded", "icons", "hidden"];
var LEFT_ONLY = ["dock-header", "dock-footer", "dock-spaces", "dock-agents", "dock-git", "dock-quotas", "dock-pages"];
var PAGE_ONLY = ["dock-overview", "dock-jira"];
var NEEDS_CORE = "dock-core draws the left-panel toggle, runs Ctrl+Alt+B and shows config errors, so it must stay in a shown top bar";
var isObj2 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function checkRegions(regions, where) {
  if (!isObj2(regions)) return `${where}: must be an object`;
  for (const [name, r] of Object.entries(regions)) {
    const at = `${where}.${name}`;
    if (!REGION_NAMES.includes(name)) return `${at}: unknown region`;
    if (!isObj2(r)) return `${at}: must be an object`;
    if (name === "pages" && "size" in r) return `${at}.size: a page fills the work area, it has no size`;
    if (name === "pages" && r.hidden === true) return `${at}.hidden: pages can't be hidden; remove them instead`;
    if ("size" in r && !(Number.isInteger(r.size) && r.size > 0)) return `${at}.size: must be a positive integer`;
    if ("hidden" in r && typeof r.hidden !== "boolean") return `${at}.hidden: must be a boolean`;
    if ("mode" in r) {
      if (name !== "left") return `${at}.mode: only the left region has a mode`;
      if (!LEFT_MODES.includes(r.mode)) return `${at}.mode: must be one of ${LEFT_MODES.join(", ")}`;
    }
    if (name === "top" && r.hidden === true) return `${at}.hidden: the top bar can't be hidden: ${NEEDS_CORE}`;
    if ("features" in r) {
      if (!Array.isArray(r.features)) return `${at}.features: must be an array`;
      for (let i = 0; i < r.features.length; i++) {
        const f = r.features[i];
        const fa = `${at}.features[${i}]`;
        if (!isObj2(f)) return `${fa}: must be an object`;
        if (typeof f.mod !== "string" || f.mod === "") return `${fa}.mod: must be a non-empty string`;
        if ("size" in f && !(Number.isInteger(f.size) && f.size > 0)) return `${fa}.size: must be a positive integer`;
        if (name === "pages" && "size" in f) return `${fa}.size: a page fills the work area, it has no size`;
        if ("props" in f && !isObj2(f.props)) return `${fa}.props: must be an object`;
        if ("drag" in f && typeof f.drag !== "boolean") return `${fa}.drag: must be true or false`;
        if (name !== "left" && LEFT_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.left`;
        if (name !== "pages" && PAGE_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.pages`;
      }
      if (name === "top" && !r.features.some((f) => f.mod === "dock-core")) return `${at}.features: must include dock-core: ${NEEDS_CORE}`;
    }
  }
  return null;
}
function parseConfig(text) {
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }
  if (!isObj2(c)) return { ok: false, error: "config: must be an object" };
  if (c.v !== 1) return { ok: false, error: `v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const err = checkRegions(c.regions ?? {}, "regions");
  if (err) return { ok: false, error: err };
  if (!Array.isArray(c.regions?.top?.features)) return { ok: false, error: `regions.top.features: must include dock-core: ${NEEDS_CORE}` };
  if ("browser" in c) {
    const be = checkBrowser(c.browser, "browser");
    if (be) return { ok: false, error: be };
  }
  if ("machines" in c) {
    if (!isObj2(c.machines)) return { ok: false, error: "machines: must be an object" };
    for (const [host, m] of Object.entries(c.machines)) {
      if (!isObj2(m)) return { ok: false, error: `machines.${host}: must be an object` };
      const e = checkRegions(m.regions ?? {}, `machines.${host}.regions`);
      if (e) return { ok: false, error: e };
      if ("browser" in m) {
        const be = checkBrowser(m.browser, `machines.${host}.browser`);
        if (be) return { ok: false, error: be };
      }
    }
  }
  return { ok: true, config: c };
}
function deepMerge(base, over) {
  if (!isObj2(base) || !isObj2(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}
function hostKey(machines, hostname) {
  const host = String(hostname).toLowerCase();
  return Object.keys(machines).find((k) => k.toLowerCase() === host);
}
function mergeForHost(config, hostname, local = null) {
  const { machines = {}, ...base } = config;
  const key = hostKey(machines, hostname);
  let merged = key ? deepMerge(base, machines[key]) : base;
  if (local) merged = deepMerge(merged, { regions: local.regions ?? {}, ..."browser" in local ? { browser: local.browser } : {} });
  const regions = {};
  for (const name of REGION_NAMES) {
    const r = merged.regions?.[name] ?? {};
    regions[name] = { ...r, features: r.features ?? [], hidden: r.hidden ?? false };
    if (name === "left") regions[name].mode = r.hidden === true ? "hidden" : r.mode ?? "expanded";
  }
  return { ...merged, regions: withBrowserFeature(regions, browserOf(merged).enabled) };
}
var LOCAL_REL = "herdr-dock/local.json";
function parseLocal(text) {
  if (text == null) return { ok: true, local: null };
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${LOCAL_REL}: Invalid JSON: ${e.message}` };
  }
  if (!isObj2(c)) return { ok: false, error: `${LOCAL_REL}: must be an object` };
  if (c.v !== 1) return { ok: false, error: `${LOCAL_REL}: v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const regions = c.regions ?? {};
  const err = checkRegions(regions, "regions");
  if (err) return { ok: false, error: `${LOCAL_REL}: ${err}` };
  if ("browser" in c) {
    const be = checkBrowser(c.browser, "browser");
    if (be) return { ok: false, error: `${LOCAL_REL}: ${be}` };
  }
  return { ok: true, local: { ...c, regions } };
}
function mergeWithLocal(config, hostname, local) {
  const ok = isObj2(local) && local.v === 1 && !checkRegions(local.regions ?? {}, "regions") && !("browser" in local && checkBrowser(local.browser, "browser"));
  return mergeForHost(config, hostname, ok ? local : null);
}

// src/shared/browser/hosts.js
function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(String(url ?? "").trim());
  if (!m) return null;
  let h = m[1].slice(m[1].lastIndexOf("@") + 1);
  h = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.replace(/:\d*$/, "");
  h = h.replace(/\.$/, "");
  return h ? h.toLowerCase() : null;
}
function isProduction(url, patterns) {
  const host = hostOf(url);
  if (!host) return null;
  for (const raw of patterns ?? []) {
    const p = String(raw).toLowerCase();
    if (p.startsWith("*.") ? host.endsWith(p.slice(1)) && host.length > p.length - 1 : host === p) return host;
  }
  return null;
}

// src/shared/browser/session.js
var BROWSER_REL = "herdr-dock/browser";
var sessionsRel = () => `${BROWSER_REL}/sessions`;
var sessionFileRel = (t) => `${sessionsRel()}/${t}.json`;
var controlFileRel = (t) => `${sessionsRel()}/${t}.control.json`;
var framesRel = (t) => `${BROWSER_REL}/frames/${t}`;
var binRel = (platform) => `${BROWSER_REL}/bin/agent-browser${platform === "win32" ? ".exe" : ""}`;

// src/shared/browser/registry.js
var DEFAULT_CONTROL = { v: 1, takeover: null, answer: null };
var REASONS = ["person", "pick", "notes", "window"];
var VALUES = ["done", "cancel"];
var isObj3 = (x) => x && typeof x === "object" && !Array.isArray(x);
var isStr = (x) => typeof x === "string" && x !== "";
var created = (o) => Number.isFinite(o.terminalCreated) ? { terminalCreated: o.terminalCreated } : {};
function json(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
}
function parseSession(text) {
  const o = json(text);
  if (!isObj3(o) || !isStr(o.session) || !isStr(o.terminal)) return null;
  const h = o.handoff;
  const handoff = isObj3(h) && isStr(h.id) && Number.isFinite(h.since) ? { id: h.id, message: String(h.message ?? ""), since: h.since } : null;
  return {
    v: 1,
    session: o.session,
    terminal: o.terminal,
    profile: String(o.profile ?? ""),
    port: Number.isFinite(o.port) ? o.port : 0,
    url: String(o.url ?? ""),
    title: String(o.title ?? ""),
    opened: Number.isFinite(o.opened) ? o.opened : 0,
    handoff,
    ...created(o)
  };
}
function parseControl(text) {
  const o = json(text);
  if (!isObj3(o)) return { ...DEFAULT_CONTROL };
  const t = o.takeover, a = o.answer;
  return {
    v: 1,
    takeover: isObj3(t) && REASONS.includes(t.reason) && Number.isFinite(t.since) ? { reason: t.reason, since: t.since } : null,
    answer: isObj3(a) && isStr(a.id) && VALUES.includes(a.value) ? { id: a.id, value: a.value } : null,
    ...created(o)
  };
}
var isStale = (record, createdMs) => !record || !Number.isFinite(record.terminalCreated) || record.terminalCreated !== createdMs;
var goneSessions = (sessions, liveTerminals2) => sessions.filter((s) => !liveTerminals2.has(s.terminal));
function liveTerminals(stdout) {
  let o;
  try {
    o = JSON.parse(String(stdout ?? ""));
  } catch {
    return null;
  }
  if (!Array.isArray(o?.spaces)) return null;
  const live = /* @__PURE__ */ new Set();
  for (const s of o.spaces) for (const tab of s?.tabs ?? []) for (const x of tab?.terminals ?? []) if (x?.terminal) live.add(x.terminal);
  return live;
}

// src/shared/browser/frame.js
function jpegSize(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 255) {
      i++;
      continue;
    }
    const m = bytes[i + 1];
    if (m === 255) {
      i++;
      continue;
    }
    if (m === 1 || m >= 208 && m <= 217) {
      i += 2;
      continue;
    }
    const len = bytes[i + 2] << 8 | bytes[i + 3];
    if (m >= 192 && m <= 207 && m !== 196 && m !== 200 && m !== 204) {
      if (i + 8 >= bytes.length) return null;
      const h = bytes[i + 5] << 8 | bytes[i + 6];
      const w = bytes[i + 7] << 8 | bytes[i + 8];
      return w && h ? { w, h } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}
var toPage = (local, frameW, drawnW) => {
  const k = frameW / drawnW;
  return { x: Math.round(local.x * k), y: Math.round(local.y * k) };
};
var drawnHeight = (frame, drawnW) => frame.h * drawnW / frame.w;
function wheelEvent(e, frameW, drawnW) {
  const { x, y } = toPage(e.local_position, frameW, drawnW);
  return { type: "input_mouse", eventType: "mouseWheel", x, y, deltaX: -e.delta.x, deltaY: -e.delta.y };
}
var FrameRing = class {
  constructor(dirRel, keep = 6) {
    this.dir = dirRel;
    this.keep = keep;
    this.list = [];
  }
  next(seq) {
    const rel = `${this.dir}/f${seq}.jpg`;
    this.list.push(rel);
    const drop = this.list.length > this.keep ? this.list.splice(0, this.list.length - this.keep) : [];
    return { rel, drop };
  }
  get current() {
    return this.list.at(-1) ?? null;
  }
  get prev() {
    return this.list.length > 1 ? this.list.at(-2) : null;
  }
  clear() {
    const all = this.list;
    this.list = [];
    return all;
  }
};
var MAX_ERRORS = 20;
function consoleText(m) {
  if (typeof m.text === "string") return m.text;
  if (Array.isArray(m.args)) {
    return m.args.map((a) => a && typeof a === "object" ? String(a.value ?? a.description ?? "") : String(a)).join(" ");
  }
  return "";
}
function streamStep(state, msg) {
  if (msg && msg.error !== void 0 && !msg.type) return { ...state, phase: "lost" };
  switch (msg?.type) {
    case "url":
      return { ...state, url: msg.url };
    case "tabs":
      return { ...state, tabs: msg.tabs };
    case "status":
      return { ...state, status: msg };
    case "console":
      if ((msg.level ?? msg.type) === "error" || msg.level === "error") {
        const key = `${msg.timestamp ?? ""}|${consoleText(msg)}`;
        if (msg.timestamp !== void 0 && state.lastError === key) return state;
        const errorTexts = [...state.errorTexts ?? [], consoleText(msg)].slice(-MAX_ERRORS);
        return { ...state, errors: (state.errors ?? 0) + 1, errorTexts, lastError: key };
      }
      return state;
    default:
      return state;
  }
}
function afterLoss(state, sessionExists, now) {
  if (!sessionExists) return "closed";
  if (state.lastReconnect !== void 0 && now - state.lastReconnect < 2e3) return "wait";
  state.lastReconnect = now;
  return "reconnect";
}
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var LUT = new Uint8Array(128);
for (let i = 0; i < 64; i++) LUT[B64.charCodeAt(i)] = i;
function decodeBase64(s) {
  s = String(s ?? "");
  let n = s.length;
  while (n && s[n - 1] === "=") n--;
  const out = new Uint8Array(n * 3 >> 2);
  let o = 0;
  const at = (i) => i < n ? LUT[s.charCodeAt(i) & 127] : 0;
  for (let i = 0; i < n; i += 4) {
    const v = at(i) << 18 | at(i + 1) << 12 | at(i + 2) << 6 | at(i + 3);
    if (o < out.length) out[o++] = v >> 16;
    if (o < out.length) out[o++] = v >> 8 & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}
function streamPort(stdout) {
  let o;
  try {
    o = JSON.parse(String(stdout ?? ""));
  } catch {
    return 0;
  }
  const d = o?.data;
  return o?.success && d?.connected && Number.isInteger(d.port) && d.port > 0 ? d.port : 0;
}
var activeTab = (tabs) => Array.isArray(tabs) ? tabs.find((t) => t?.active) ?? null : null;
function pageHeading(record, state) {
  const tab = activeTab(state?.tabs);
  const url = String(tab?.url || state?.url || record?.url || "");
  const tabTitle = String(tab?.title ?? "");
  const fromRecord = record?.title && record.url === url ? record.title : "";
  const bare = !tabTitle || url.replace(/^[a-z]+:\/\//i, "").startsWith(tabTitle);
  return { title: (bare ? fromRecord || tabTitle : tabTitle) || url, url };
}

// src/mods/dock-browser/stream.js
import { WebSocket } from "websocket";
import { Buffer } from "buffer";
import * as fs from "fs/promises";
import { appHome } from "herdr";
var MAX_FPS = 15;
var nativeBase64 = true;
function bytesOf(data) {
  if (nativeBase64) {
    try {
      const b = Buffer.from(data, "base64");
      if (b && b.length > 2 && b[0] === 255 && b[1] === 216) return b;
    } catch {
    }
    nativeBase64 = false;
  }
  return decodeBase64(data);
}
var textOf = (raw) => typeof raw === "string" ? raw : new TextDecoder().decode(raw);
async function clearFolder(rel) {
  const dir = `${slashPath(appHome())}/${rel}`;
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(names.map((n) => fs.unlink(`${dir}/${n}`).catch(() => {
  })));
  await fs.rmdir(dir).catch(() => {
  });
}
var Stream = class {
  constructor({ port, framesRel: framesRel2, onChange, onLost }) {
    this.port = port;
    this.framesRel = framesRel2;
    this.onChange = onChange ?? (() => {
    });
    this.onLost = onLost ?? (() => {
    });
    this.ring = new FrameRing(framesRel2);
    this.state = { phase: "connecting", url: "", tabs: [], status: null, errors: 0, errorTexts: [] };
    this.size = null;
    this.loss = {};
    this.ws = null;
    this.stopped = false;
    this.gen = 0;
    this.epoch = Date.now().toString(36);
    this.count = 0;
  }
  get frame() {
    return this.ring.current;
  }
  get prev() {
    return this.ring.prev;
  }
  start(cx) {
    if (this.stopped) return;
    const gen = ++this.gen;
    const home2 = slashPath(appHome());
    cx.spawn(async () => {
      let ws = null;
      try {
        await fs.mkdir(`${home2}/${this.framesRel}`, { recursive: true });
        ws = await WebSocket.connect(`ws://127.0.0.1:${this.port}/?maxFps=${MAX_FPS}`);
        if (this.stopped || gen !== this.gen) {
          ws.close().catch(() => {
          });
          return;
        }
        this.ws = ws;
        this.set({ ...this.state, phase: "live" });
        for (; ; ) {
          const raw = await ws.read();
          if (this.stopped || gen !== this.gen) return;
          let m;
          try {
            m = JSON.parse(textOf(raw));
          } catch {
            continue;
          }
          if (m?.type === "frame") {
            await this.write(m, home2);
            continue;
          }
          const next = streamStep(this.state, m);
          if (next !== this.state) this.set(next);
          if (next.phase === "lost") break;
        }
      } catch {
      }
      if (this.stopped || gen !== this.gen) return;
      if (this.ws === ws) this.ws = null;
      ws?.close().catch(() => {
      });
      this.set({ ...this.state, phase: "lost" });
      this.onLost(this);
    });
  }
  // The same stream on a new port (agent-browser restarted its daemon): the frames drawn stay until new ones come.
  reconnect(port, cx) {
    this.port = port;
    this.set({ ...this.state, phase: "connecting" });
    this.start(cx);
  }
  async write(m, home2) {
    if (typeof m.data !== "string") return;
    const bytes = bytesOf(m.data);
    const size = jpegSize(bytes);
    if (!size) return;
    const { rel, drop } = this.ring.next(`${this.epoch}-${++this.count}`);
    try {
      await fs.writeFile(`${home2}/${rel}`, bytes);
    } catch {
      this.ring.list = this.ring.list.filter((r) => r !== rel);
      return;
    }
    for (const d of drop) fs.unlink(`${home2}/${d}`).catch(() => {
    });
    if (this.stopped) {
      fs.unlink(`${home2}/${rel}`).catch(() => {
      });
      return;
    }
    this.size = size;
    this.onChange(this);
  }
  set(state) {
    this.state = state;
    this.onChange(this);
  }
  // Closes the socket and deletes the frames folder.
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.gen++;
    const ws = this.ws;
    this.ws = null;
    ws?.close().catch(() => {
    });
    this.ring.clear();
    clearFolder(this.framesRel);
  }
  // A message to the page (input). Typed input goes here only: never logged.
  send(msg) {
    this.ws?.write(JSON.stringify(msg)).catch(() => {
    });
  }
};

// src/mods/dock-browser/main.js
var MOD = "dock-browser";
var PAD = 12;
var SWEEP_MS = 3e4;
var LOSS_GRACE_MS = 1e3;
var CLOSED_MS = 3e3;
var EMPTY = "No page yet. The agent opens one with browse open.";
var home = () => slashPath(appHome2());
var nodePlatform = (p) => p === "windows" ? "win32" : p === "macos" ? "darwin" : "linux";
var Browser = class extends View {
  init(_props, cx) {
    this.width = 0;
    this.key = null;
    this.terminal = null;
    this.created = null;
    this.record = null;
    this.control = parseControl(null);
    this.stream = null;
    this.closed = null;
    this.showErrors = false;
    this.browser = browserOf(null);
    this.watch = null;
    if (checking()) return;
    cx.timer.every(SWEEP_MS, (cx2) => {
      if (this.shown()) cx2.spawn(async () => this.sweep());
    });
  }
  shown() {
    if (props()?.dockRegion !== "right") return true;
    const applied = shared("dock.config.applied");
    return rightShownOf(shared("dock.right.shown"), applied) && rightActiveOf(shared("dock.right.active"), applied?.right?.features ?? []) === MOD;
  }
  bin() {
    return `${home()}/${binRel(nodePlatform(window()?.platform))}`;
  }
  // Called from render: notices the panel showing or hiding and the agent in front changing.
  follow(cx) {
    if (checking()) return;
    const shown = this.shown();
    let agent = null;
    if (shown) {
      try {
        agent = pickAgent(focused(), agents());
      } catch {
        agent = null;
      }
    }
    const t = agent && !String(agent.address).includes("/") ? agent.address : null;
    const key = shown ? `shown|${t ?? "none"}` : "hidden";
    if (key === this.key) return;
    const wasShown = this.key !== null && this.key !== "hidden";
    this.key = key;
    this.stopStream();
    Object.assign(this, { terminal: t, created: null, record: null, control: parseControl(null), closed: null, showErrors: false });
    if (!shown) {
      this.watch?.cancel?.();
      this.watch = null;
      return;
    }
    if (!wasShown) {
      this.watchSessions(cx);
      cx.spawn(async (cx2) => {
        await this.loadConfig();
        await this.sweep();
        cx2.notify();
      });
    }
    if (t) {
      cx.spawn(async (cx2) => {
        const created2 = await this.createdOf(t);
        if (this.terminal !== t) return;
        this.created = created2;
        await this.readRecords(cx2);
      });
    }
  }
  // The merged config's browser section, read the way dock-core does (source.json → config + local.json).
  async loadConfig() {
    try {
      const h = home();
      const src = JSON.parse(await readTextFile(`${h}/mods/dock-core/source.json`) ?? "null");
      const install = installOf(src, h);
      if (!install) return;
      const parsed = parseConfig(await readTextFile(install.configPath) ?? "");
      if (!parsed.ok) return;
      const local = parseLocal(await readTextFile(`${h}/herdr-dock/local.json`).catch(() => null));
      const host = shared("dock.host");
      this.browser = browserOf(mergeWithLocal(parsed.config, typeof host === "string" ? host : null, local.ok ? local.local : null));
    } catch (e) {
      console.log(`${MOD}: config not read: ${e?.message ?? e}`);
    }
  }
  async createdOf(t) {
    try {
      const r = await hc(["get", t]);
      const c = r.code === 0 ? JSON.parse(r.stdout).created_ms : null;
      return Number.isFinite(c) ? c : null;
    } catch {
      return null;
    }
  }
  // This terminal's session record, or null (none, unreadable, or left by an older terminal with the same id).
  async sessionOf(t) {
    const rec = parseSession(await readTextFile(`${home()}/${sessionFileRel(t)}`).catch(() => null));
    return rec && this.created != null && isStale(rec, this.created) ? null : rec;
  }
  async readRecords(cx) {
    const t = this.terminal;
    if (!t) return;
    const rec = await this.sessionOf(t);
    const text = await readTextFile(`${home()}/${controlFileRel(t)}`).catch(() => null);
    if (this.terminal !== t) return;
    const control = parseControl(text);
    this.control = text != null && this.created != null && isStale(control, this.created) ? parseControl(null) : control;
    if (!rec && this.stream && !this.closed) this.closed = this.closedNow(cx, this.record?.opened ?? null);
    this.record = rec;
    if (this.closed && rec && rec.opened !== this.closed.opened) this.closed = null;
    this.syncStream(cx);
    cx.notify();
  }
  // Re-reads the records when the sessions folder changes, while the panel shows.
  watchSessions(cx) {
    const dir = `${home()}/${sessionsRel()}`;
    const gen = this.watchGen = (this.watchGen ?? 0) + 1;
    const done = () => this.key === "hidden" || this.watchGen !== gen;
    cx.spawn(async (cx2) => {
      await fs2.mkdir(dir, { recursive: true }).catch(() => {
      });
      for (; ; ) {
        if (done()) return;
        let changed;
        try {
          this.watch = watchFolder(dir);
          changed = await this.watch;
        } catch {
          await cx2.sleep(3e3);
          continue;
        }
        if (done()) return;
        if (!changed?.length) {
          await cx2.sleep(1e3);
          continue;
        }
        await this.readRecords(cx2);
      }
    });
  }
  // A stream while there is a live record to show; none otherwise.
  syncStream(cx) {
    const rec = this.record;
    const want = this.key !== "hidden" && rec && !this.closed;
    if (this.stream && (!want || this.stream.session !== rec.session)) this.stopStream();
    if (!want || this.stream) return;
    const t = this.terminal;
    const s = new Stream({
      port: rec.port,
      framesRel: framesRel(t),
      onChange: () => {
        if (this.stream === s) cx.notify();
      },
      onLost: () => {
        if (this.stream === s) cx.spawn(async (cx2) => this.lost(s, cx2));
      }
    });
    s.session = rec.session;
    this.stream = s;
    s.start(cx);
  }
  stopStream() {
    this.stream?.stop();
    this.stream = null;
  }
  // The socket went away: reconnect on the daemon's current port, or the browser closed. It first gives `browse
  // close` a moment to delete the record, since asking a closing session for its port starts an empty daemon.
  async lost(s, cx) {
    await cx.sleep(LOSS_GRACE_MS);
    for (; ; ) {
      if (this.stream !== s) return;
      const rec = await this.sessionOf(this.terminal);
      const what = afterLoss(s.loss, !!rec && rec.session === s.session, Date.now());
      if (what === "wait") {
        await cx.sleep(500);
        continue;
      }
      let port = 0;
      if (what === "reconnect") {
        const r = await exec(this.bin(), ["--session", s.session, "stream", "status", "--json"]).catch(() => null);
        port = r?.code === 0 ? streamPort(r.stdout) : 0;
      }
      if (this.stream !== s) return;
      if (port) {
        s.reconnect(port, cx);
        return;
      }
      this.stopStream();
      this.closed = this.closedNow(cx, rec?.opened ?? null);
      cx.notify();
      return;
    }
  }
  // "The browser closed.", drawn again once its minimum time is up (then the empty state, unless the record stays).
  closedNow(cx, opened) {
    cx.spawn(async (cx2) => {
      await cx2.sleep(CLOSED_MS + 100);
      cx2.notify();
    });
    return { at: Date.now(), opened };
  }
  // Sessions whose terminal is gone: their browser closed, their records and frames deleted.
  async sweep() {
    if (checking()) return;
    const r = await exec("herdr-app", ["ls"]).catch(() => null);
    const live = r?.code === 0 ? liveTerminals(r.stdout) : null;
    if (!live) return;
    const dir = `${home()}/${sessionsRel()}`;
    let names = [];
    try {
      names = await fs2.readdir(dir);
    } catch {
      return;
    }
    const sessions = [];
    for (const n of names) {
      if (!n.endsWith(".json") || n.endsWith(".control.json")) continue;
      const rec = parseSession(await readTextFile(`${dir}/${n}`).catch(() => null));
      if (rec) sessions.push(rec);
    }
    for (const g of goneSessions(sessions, live)) {
      const chrome = this.browser.chrome ? ["--executable-path", this.browser.chrome] : [];
      await exec(this.bin(), ["--session", g.session, ...chrome, "close"]).catch(() => null);
      await fs2.unlink(`${home()}/${sessionFileRel(g.terminal)}`).catch(() => {
      });
      await fs2.unlink(`${home()}/${controlFileRel(g.terminal)}`).catch(() => {
      });
      await clearFolder(framesRel(g.terminal));
    }
  }
  // ---- drawing ----
  note(t, text) {
    return div().p(PAD + 2).text_size(12.5).text_color(t.dim).child(text);
  }
  chip(t, text, color) {
    return div().flex_none().px(6).h(18).flex().items_center().rounded(4).border_1().border_color(color ?? t.border).text_size(10.5).text_color(color ?? t.muted).child(text);
  }
  header(t) {
    const rec = this.record, st = this.stream?.state ?? {};
    const { title, url } = pageHeading(rec, st);
    const prod = isProduction(url, this.browser.production);
    const errors = st.errors ?? 0;
    const tabs = Array.isArray(st.tabs) ? st.tabs : [];
    return v_flex().flex_none().px(PAD).pt(10).pb(8).gap(4).border_b(1).border_color(t.border).child(h_flex().gap(6).items_center().child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().child(title || "Browser")).when(!!prod, (el) => el.child(this.chip(t, "Production", t.blocked))).child(this.chip(t, rec.profile === "signed-in" ? "signed-in" : "clean")).when(errors > 0, (el) => el.child(div().id("browser-errors").flex_none().px(6).h(18).flex().items_center().rounded(4).cursor_pointer().bg(t.blocked).text_size(10.5).text_color(t.background).tooltip(this.showErrors ? "Hide the errors" : "The page's last console errors").on_click((_e, cx) => {
      this.showErrors = !this.showErrors;
      cx.notify();
    }).child(`${errors} error${errors === 1 ? "" : "s"}`)))).child(div().truncate().text_size(11.5).text_color(t.dim).child(url)).when(tabs.length > 1, (el) => el.child(h_flex().gap(4).pt(2).overflow_hidden().children(tabs.map((tab, i) => div().id(`browser-tab-${i}`).flex_shrink_1().min_w(0).max_w(160).truncate().px(7).h(20).rounded(4).text_size(11).when(!!tab.active, (e) => e.bg(t.selected ?? t.hover).text_color(t.foreground)).when(!tab.active, (e) => e.text_color(t.muted)).child(String(tab.title || tab.url || "Tab")))))).when(this.showErrors && errors > 0, (el) => el.child(v_flex().id("browser-error-list").mt(4).max_h(140).overflow_y_scrollbar().gap(2).p(6).rounded(6).border_1().border_color(t.border).children((st.errorTexts ?? []).slice().reverse().map((e, i) => div().id(`browser-error-${i}`).text_size(11).text_color(t.blocked).child(String(e).slice(0, 400))))));
  }
  picture(t) {
    const s = this.stream;
    const drawnW = Math.floor(this.width - PAD * 2);
    if (!s?.frame || !s.size || drawnW <= 0) return this.note(t, s?.state.phase === "connecting" && s.loss.lastReconnect ? "Reconnecting\u2026" : "Connecting\u2026");
    const h = Math.round(drawnHeight(s.size, drawnW));
    const layer = (rel) => div().absolute().top(0).left(0).child(image(rel).w(drawnW).h(h));
    return div().id("browser-page").relative().w(drawnW).h(h).overflow_hidden().rounded(4).border_1().border_color(t.border).on_scroll_wheel((e, cx) => {
      if (!s.size || !e.local_position) return;
      s.send(wheelEvent(e, s.size.w, drawnW));
      cx.stop_propagation();
    }).when(!!s.prev, (el) => el.child(layer(s.prev))).child(layer(s.frame));
  }
  render(cx) {
    const t = theme();
    this.follow(cx);
    const root = v_flex().id("dock-browser").size_full().min_h(0).bg(t.background).text_color(t.foreground).on_size_change((size, cx2) => {
      if (Math.abs((size?.width ?? 0) - this.width) > 2) {
        this.width = size.width;
        cx2.notify();
      }
    });
    const c = this.closed;
    if (c && (Date.now() - c.at < CLOSED_MS || this.record && this.record.opened === c.opened)) {
      return root.child(this.note(t, "The browser closed."));
    }
    if (!this.record) return root.child(this.note(t, EMPTY));
    return root.child(this.header(t)).child(v_flex().id("browser-body").flex_1().min_h(0).overflow_y_scrollbar().p(PAD).child(this.picture(t)));
  }
  async close() {
    this.stopStream();
  }
};
export {
  Browser as default
};
