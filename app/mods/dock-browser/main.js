// src/mods/dock-browser/main.js
import { View, div as div3, image } from "gpui-kit";
import { h_flex as h_flex3, v_flex as v_flex3 } from "gpui-base";
import { agents, appHome as appHome4, checking, closeOverlay, exec as exec2, focused, hc as hc2, nextCommand, props, readTextFile as readTextFile2, shared as shared2, theme, watchFolder, window } from "herdr";
import * as fs4 from "fs/promises";

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
function installOf(src, home4) {
  const mode = modeOf(src);
  if (mode === "app") {
    return { mode, configPath: `${home4}/mods/dock-core/config.json`, repo: null, versionPath: `${home4}/mods/dock-core/VERSION.json` };
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
var realSessionName = (session) => `${session}-real`;
var BROWSER_REL = "herdr-dock/browser";
var sessionsRel = () => `${BROWSER_REL}/sessions`;
var sessionFileRel = (t) => `${sessionsRel()}/${t}.json`;
var controlFileRel = (t) => `${sessionsRel()}/${t}.control.json`;
var framesRel = (t) => `${BROWSER_REL}/frames/${t}`;
var bigFramesRel = (t) => `${framesRel(t)}-big`;
var picksRel = () => `${BROWSER_REL}/picks`;
var binRel = (platform) => `${BROWSER_REL}/bin/agent-browser${platform === "win32" ? ".exe" : ""}`;

// src/shared/browser/registry.js
var DEFAULT_CONTROL = { v: 1, takeover: null, answer: null, window: null, sizes: null };
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
  const t = o.takeover, a = o.answer, w = o.window;
  return {
    v: 1,
    takeover: isObj3(t) && REASONS.includes(t.reason) && Number.isFinite(t.since) ? { reason: t.reason, since: t.since } : null,
    answer: isObj3(a) && isStr(a.id) && VALUES.includes(a.value) ? { id: a.id, value: a.value } : null,
    window: isObj3(w) && Number.isFinite(w.since) ? { since: w.since } : null,
    sizes: sizesOf(o.sizes),
    ...created(o)
  };
}
var isPos = (n) => Number.isFinite(n) && n > 0;
function sizesOf(x) {
  if (!isObj3(x) || !Array.isArray(x.tabs)) return null;
  const v = x.viewport;
  return {
    tabs: x.tabs.filter(isStr),
    agentTab: isStr(x.agentTab) ? x.agentTab : null,
    viewport: isObj3(v) && isPos(v.w) && isPos(v.h) ? { w: v.w, h: v.h } : null
  };
}
var limit = (m) => Number.isFinite(m) && m > 0 ? m : 15;
var expired = (h, now, minutes) => now - h.since > limit(minutes) * 6e4;
var isStale = (record, createdMs) => !record || !Number.isFinite(record.terminalCreated) || record.terminalCreated !== createdMs;
var answerOf = (session, control) => session.handoff && control.answer && control.answer.id === session.handoff.id ? control.answer.value : null;
function personHas(session, control, now, handoffMinutes) {
  if (control.takeover) return true;
  const h = session.handoff;
  return !!h && !answerOf(session, control) && !expired(h, now, handoffMinutes);
}
var answer = (control, id, value) => ({ ...control, answer: { id, value } });
var takeOver = (control, reason, now, terminalCreated) => ({
  ...control,
  takeover: { reason, since: now },
  ...Number.isFinite(terminalCreated) ? { terminalCreated } : {}
});
var handBack = (control) => ({ ...control, takeover: null });
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
var NAMED = {
  enter: ["Enter", 13],
  backspace: ["Backspace", 8],
  delete: ["Delete", 46],
  tab: ["Tab", 9],
  escape: ["Escape", 27],
  left: ["ArrowLeft", 37],
  right: ["ArrowRight", 39],
  up: ["ArrowUp", 38],
  down: ["ArrowDown", 40],
  home: ["Home", 36],
  end: ["End", 35],
  pageup: ["PageUp", 33],
  pagedown: ["PageDown", 34]
};
var mask = (m = {}) => (m.alt ? 1 : 0) | (m.control ? 2 : 0) | (m.platform ? 4 : 0) | (m.shift ? 8 : 0);
function keyEvents(e) {
  const modifiers = mask(e.modifiers);
  let key, text, named = null;
  const name = String(e.key ?? "").toLowerCase();
  if (NAMED[name]) {
    named = NAMED[name];
    key = named[0];
    if (name === "enter") text = "\r";
  } else if (name === "space") {
    key = " ";
    text = " ";
    named = ["Space", 32];
  } else if (e.key_char) {
    key = e.key_char;
    text = e.key_char;
  } else if (modifiers & 6 && /^[a-z]$/.test(name)) key = name;
  else return [];
  if (modifiers & 6) text = void 0;
  const letter = !named && modifiers & 6 && /^[a-z]$/i.test(key) ? key.toUpperCase() : null;
  const codes = named ? { code: named[0], windowsVirtualKeyCode: named[1] } : letter ? { code: `Key${letter}`, windowsVirtualKeyCode: letter.charCodeAt(0) } : {};
  const down = { type: "input_keyboard", eventType: "keyDown", key, ...codes };
  if (text !== void 0) down.text = text;
  down.modifiers = modifiers;
  return [down, { type: "input_keyboard", eventType: "keyUp", key, ...codes, modifiers }];
}
function isPaste(e, os) {
  const m = e?.modifiers ?? {};
  if (String(e?.key ?? "").toLowerCase() !== "v" || m.alt) return false;
  return os === "macos" ? !!m.platform && !m.control : !!m.control && !m.platform;
}
function textEvents(text) {
  const out = [];
  for (const ch of String(text ?? "").replace(/\r\n?/g, "\n")) {
    if (ch === "\n") {
      out.push(...keyEvents({ key: "enter", modifiers: {} }));
      continue;
    }
    out.push(
      { type: "input_keyboard", eventType: "keyDown", key: ch, text: ch, modifiers: 0 },
      { type: "input_keyboard", eventType: "keyUp", key: ch, modifiers: 0 }
    );
  }
  return out;
}
var PASTE_LIMIT = 2e3;
function pasteEvents(text, limit2 = PASTE_LIMIT) {
  const t = String(text ?? "").replace(/(\r\n|\n|\r)$/, "");
  const n = [...t].length;
  return n > limit2 ? { tooLong: n } : { events: textEvents(t) };
}
function wheelEvent(e, frameW, drawnW) {
  const { x, y } = toPage(e.local_position, frameW, drawnW);
  return { type: "input_mouse", eventType: "mouseWheel", x, y, deltaX: -e.delta.x, deltaY: -e.delta.y };
}
function mouseEvents(kind, e, frameW, drawnW, pressed = false) {
  const { x, y } = toPage(e.local_position, frameW, drawnW);
  const ev = (eventType, button2 = "left") => ({ type: "input_mouse", eventType, x, y, button: button2, clickCount: e.click_count ?? 1 });
  if (kind === "down") return [ev("mouseMoved", "none"), ev("mousePressed")];
  if (kind === "up") return [ev("mouseReleased")];
  return [ev("mouseMoved", pressed ? "left" : "none")];
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

// src/shared/gitcmd.js
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function utf8(str2) {
  const out = [];
  for (const ch of str2) {
    const c = ch.codePointAt(0);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return out;
}
function b64urlEncode(str2) {
  const b = utf8(String(str2));
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = b[i] << 16 | (b[i + 1] ?? 0) << 8 | (b[i + 2] ?? 0);
    s += ALPHABET[n >> 18 & 63] + ALPHABET[n >> 12 & 63];
    if (i + 1 < b.length) s += ALPHABET[n >> 6 & 63];
    if (i + 2 < b.length) s += ALPHABET[n & 63];
  }
  return s;
}

// src/shared/browser/panel.js
function panelMode(session, control, now, handoffMinutes) {
  const c = control ?? parseControl(null);
  const h = session?.handoff;
  if (h && personHas(session, { ...c, takeover: null }, now, handoffMinutes)) return { kind: "handoff", handoff: h };
  return c.takeover ? { kind: "takeover", reason: c.takeover.reason } : { kind: "view" };
}
var pickKind = (mode) => mode?.kind === "takeover" && (mode.reason === "pick" || mode.reason === "notes") ? mode.reason : null;
var shouldReinstall = (present, control, kind) => !present && !!kind && control?.takeover?.reason === kind;
var inControl = (mode) => mode?.kind === "handoff" || mode?.kind === "takeover";
function controlOf(text, created2) {
  const c = parseControl(text);
  return text != null && Number.isFinite(created2) && isStale(c, created2) ? parseControl(null) : c;
}
function controlText(text, created2, change) {
  const next = change(controlOf(text, created2));
  return JSON.stringify(Number.isFinite(created2) ? { ...next, terminalCreated: created2 } : next, null, 2) + "\n";
}
var release = (c) => ({ ...handBack(c), window: null, sizes: null });
var changes = {
  takeOver: (now) => (c) => c.takeover ? c : takeOver(c, "person", now),
  pick: (kind, now) => (c) => takeOver(c, kind, now),
  // Pick or Notes: the person points at the page
  window: (now) => (c) => takeOver(c, "window", now),
  // before window-open runs: the agent waits
  windowOpened: (now) => (c) => ({ ...c, window: { since: now } }),
  // window-open succeeded: Done runs window-done
  // A size tab opened: remembered with the agent's tab and viewport (the first size's, kept for later ones).
  sizeTab: (id, agentTab, viewport) => (c) => {
    const s = c.sizes ?? { tabs: [], agentTab: agentTab ?? null, viewport: viewport ?? null };
    return { ...c, sizes: { ...s, tabs: [...s.tabs.filter((x) => x !== id), id] } };
  },
  handBack: () => release,
  answer: (id, value) => (c) => release(answer(c, id, value))
};
var finishOf = (control) => ({
  restore: restoreCommands(control?.sizes),
  window: !!control?.window,
  stopPick: control?.takeover?.reason === "pick" || control?.takeover?.reason === "notes"
});
function handoffNotices(entries, notified, now, handoffMinutes) {
  const seen = new Set(Array.isArray(notified) ? notified : []);
  const out = [];
  for (const { session, control } of entries ?? []) {
    const h = session?.handoff;
    if (!h || seen.has(h.id)) continue;
    if (panelMode(session, control, now, handoffMinutes).kind !== "handoff") continue;
    out.push({ terminal: session.terminal, id: h.id, message: h.message });
  }
  return out;
}
function rememberNotified(list, ids, cap = 50) {
  const prev = Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  return [...prev.filter((x) => !ids.includes(x)), ...ids].slice(-cap);
}
var SIZES = {
  phone: { label: "Phone", set: ["set", "device", "iPhone 16"] },
  tablet: { label: "Tablet", set: ["set", "device", "iPad"] },
  desktop: { label: "Desktop", set: ["set", "viewport", "1440", "900"] }
};
function sizeCommands(size, url) {
  const s = SIZES[size];
  if (!s || !url) return null;
  return [["tab", "new", "--json", url], s.set];
}
function newTabId(stdout) {
  try {
    const id = JSON.parse(String(stdout ?? "")).data?.tabId;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}
function restoreCommands(sizes) {
  if (!sizes?.tabs?.length) return [];
  const out = sizes.tabs.map((id) => ["tab", "close", id]);
  if (sizes.agentTab) out.push(["tab", sizes.agentTab]);
  const v = sizes.viewport;
  if (v && v.w > 0 && v.h > 0) out.push(["set", "viewport", String(v.w), String(v.h)]);
  return out;
}
function fitWidth(frame, availW, availH) {
  const w = Math.floor(availW);
  if (!frame?.w || !frame?.h || !(availH > 0)) return w;
  return Math.max(0, Math.min(w, Math.floor(availH * frame.w / frame.h)));
}
var bigWindow = (terminal) => ({
  mod: "dock-browser",
  kind: "window",
  key: "dock-browser-big",
  width: 0.8,
  height: 0.85,
  props: { big: true, ...terminal ? { terminal } : {} }
});
var browserShowName = (terminal) => `browser.show.${b64urlEncode(String(terminal))}`;

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
var clearing = /* @__PURE__ */ new Map();
function clearFolder(rel) {
  const p = (clearing.get(rel) ?? Promise.resolve()).then(() => removeFolder(rel));
  clearing.set(rel, p);
  p.finally(() => {
    if (clearing.get(rel) === p) clearing.delete(rel);
  });
  return p;
}
async function removeFolder(rel) {
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
    const home4 = slashPath(appHome());
    cx.spawn(async () => {
      let ws = null;
      try {
        await (clearing.get(this.framesRel) ?? Promise.resolve()).catch(() => {
        });
        await fs.mkdir(`${home4}/${this.framesRel}`, { recursive: true });
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
            await this.write(m, home4);
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
  async write(m, home4) {
    if (typeof m.data !== "string") return;
    const bytes = bytesOf(m.data);
    const size = jpegSize(bytes);
    if (!size) return;
    const { rel, drop } = this.ring.next(`${this.epoch}-${++this.count}`);
    const file = `${home4}/${rel}`;
    try {
      await fs.writeFile(file, bytes);
    } catch {
      try {
        await fs.mkdir(`${home4}/${this.framesRel}`, { recursive: true });
        await fs.writeFile(file, bytes);
      } catch {
        this.ring.list = this.ring.list.filter((r) => r !== rel);
        return;
      }
    }
    for (const d of drop) fs.unlink(`${home4}/${d}`).catch(() => {
    });
    if (this.stopped) {
      fs.unlink(`${home4}/${rel}`).catch(() => {
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
  // Closes the socket and deletes the frames folder (the returned promise settles when it's gone).
  stop() {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    this.gen++;
    const ws = this.ws;
    this.ws = null;
    ws?.close().catch(() => {
    });
    this.ring.clear();
    return clearFolder(this.framesRel);
  }
  // A message to the page (input). Typed input goes here only: never logged.
  send(msg) {
    this.ws?.write(JSON.stringify(msg)).catch(() => {
    });
  }
};

// src/mods/dock-browser/controls.js
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
function button(t, id, label2, onClick, { busy = false, primary = false, tip = null } = {}) {
  return div().id(id).flex_none().px(8).h(22).flex().items_center().rounded(4).text_size(11.5).when(primary, (el) => el.bg(t.accent).text_color(t.background)).when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.foreground)).when(!!tip, (el) => el.tooltip(tip)).when(busy, (el) => el.opacity(0.5)).when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => {
    cx.stop_propagation();
    onClick(cx);
  })).child(label2);
}
function controlBar(t, state, on) {
  const busy = !!state.busy;
  const row = h_flex().flex_none().flex_wrap().gap(4).px(12).py(6).items_center().border_b(1).border_color(t.border);
  const pointing = state.reason === "pick" || state.reason === "notes";
  if (state.control === "view") {
    row.child(button(t, "browser-takeover", "Take over", on.takeOver, { busy, tip: "Use the page yourself; the agent waits until you hand back" }));
  } else if (state.control === "takeover" && !pointing) {
    row.child(button(t, "browser-handback", "Hand back", on.handBack, { busy, primary: true, tip: "Give the page back to the agent" }));
  }
  if (state.control !== "handoff" && !pointing) {
    row.child(button(t, "browser-pick", "Pick", (cx) => on.pick("pick", cx), { busy, tip: "Click one element and tell the agent what to change" }));
    row.child(button(t, "browser-notes", "Notes", (cx) => on.pick("notes", cx), { busy, tip: "Notes on several elements, sent together" }));
  }
  row.child(div().flex_none().w(6));
  for (const [kind, s] of Object.entries(SIZES)) {
    row.child(button(t, `browser-size-${kind}`, s.label, (cx) => on.size(kind, cx), { busy, tip: `This page in a new tab at ${kind} size` }));
  }
  row.child(div().flex_1());
  row.child(state.big ? button(t, "browser-close", "Close", on.close, { tip: "Close this window" }) : button(t, "browser-enlarge", "Enlarge", on.enlarge, { tip: "The page in a big window" }));
  if (state.busy) row.child(div().flex_none().text_size(11).text_color(t.dim).child(state.busy));
  return row;
}
function handoffBar(t, state, on) {
  const busy = !!state.busy;
  return v_flex().flex_none().gap(6).px(12).py(8).bg(t.raised ?? t.background).border_b(1).border_color(t.working).child(div().text_size(11).font_semibold().text_color(t.working).child("The agent needs you")).child(div().text_size(12.5).text_color(t.foreground).child(state.message || "The agent asked for your help in this page.")).when(!!state.windowOpen, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Finish in the window, then press Done"))).child(h_flex().flex_wrap().gap(4).items_center().child(button(t, "browser-done", "Done", on.done, { busy, primary: true, tip: "Tell the agent you're done" })).child(button(t, "browser-cancel", "Cancel", on.cancel, { busy, tip: "Tell the agent you won't do it" })).when(!state.windowOpen, (el) => el.child(button(
    t,
    "browser-window",
    "Open in a real window",
    on.openWindow,
    { busy, tip: "For captchas and passkeys: a real browser window on this page" }
  ))));
}
var errorLine = (t, text) => div().flex_none().px(12).py(4).text_size(11.5).text_color(t.blocked).child(text);

// src/mods/dock-browser/actions.js
import { appHome as appHome2, exec, notify, readTextFile, setShared, shared, writeTextFile } from "herdr";
import * as fs2 from "fs/promises";
var NOTIFIED_KEY = "dock.browser.notified";
var home = () => slashPath(appHome2());
async function readControl(t, created2) {
  return controlOf(await readTextFile(`${home()}/${controlFileRel(t)}`).catch(() => null), created2);
}
async function writeControl(t, created2, change) {
  const path = `${home()}/${controlFileRel(t)}`;
  await fs2.mkdir(`${home()}/${sessionsRel()}`, { recursive: true }).catch(() => {
  });
  for (let i = 0; i < 3; i++) {
    const text = await readTextFile(path).catch(() => null);
    const next = controlText(text, created2, change);
    try {
      await writeTextFile(path, next, text);
      return parseControl(next);
    } catch {
    }
  }
  return null;
}
var firstLine = (r) => String(r?.stderr || r?.stdout || "").trim().split("\n").find((l) => l.trim()) ?? "";
async function run(cmd, args, timeout = 6e4) {
  const r = await exec(cmd, args, { timeout });
  if (r.code !== 0) throw new Error(firstLine(r) || `${cmd} exited ${r.code}`);
  return r;
}
var browse = (args) => run("node", [`${home()}/mods/dock-browser/browse.mjs`, ...args], 12e4);
async function allRecords() {
  const dir = `${home()}/${sessionsRel()}`;
  let names = [];
  try {
    names = await fs2.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json") || n.endsWith(".control.json")) continue;
    const session = parseSession(await readTextFile(`${dir}/${n}`).catch(() => null));
    if (!session) continue;
    const control = parseControl(await readTextFile(`${home()}/${controlFileRel(session.terminal)}`).catch(() => null));
    out.push({ session, control });
  }
  return out;
}
async function announceHandoffs(handoffMinutes) {
  const entries = await allRecords();
  const notices = handoffNotices(entries, shared(NOTIFIED_KEY), Date.now(), handoffMinutes);
  if (!notices.length) return;
  setShared(NOTIFIED_KEY, rememberNotified(shared(NOTIFIED_KEY), notices.map((n) => n.id)));
  for (const n of notices) {
    notify({
      title: "The agent needs you",
      body: n.message,
      level: "warning",
      action: { name: `dock-core.${browserShowName(n.terminal)}` }
    });
  }
}

// src/mods/dock-browser/person.js
import { openOverlay } from "herdr";

// src/shared/browser/feedback.js
var INTENTS = ["fix", "change", "question", "approve"];
var PRIORITIES = ["low", "normal", "high"];
var NOTES_MAX = 20;
var TEXT_MAX = 200;
var PICTURE_DAYS = 1;
var R = "[redacted]";
var PAIR = /([\w-]{0,40}(?:secret|token|password|passwd|pwd|api[-_]?key|private[-_]?key|access[-_]?key|auth(?!or))[\w-]{0,40})(\s{0,8}[=:]\s{0,8})(?!(?:bearer|basic|token)\s)("[^"]*"|'[^']*'|[^\s&"',;]+)/gi;
var JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
var BEARER = /\b(bearer|basic|token)(\s+)([A-Za-z0-9._~+/=-]+)/gi;
var AWS_ID = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
var HEX = /\b[0-9a-fA-F]{32,}\b/g;
var RUN40 = /[A-Za-z0-9/+=]{40,}/g;
var B642 = /[A-Za-z0-9+_-]{32,}={0,2}/g;
var classes = (m) => [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(m)).length;
var mixed = (m) => /[a-z]/.test(m) && /[A-Z]/.test(m) && /[0-9]/.test(m);
function switches(m) {
  const kind = (c) => /[a-z]/.test(c) ? 0 : /[A-Z]/.test(c) ? 1 : /[0-9]/.test(c) ? 2 : 3;
  let n = 0;
  for (let i = 1; i < m.length; i++) if (kind(m[i]) !== kind(m[i - 1])) n++;
  return n / Math.max(1, m.length - 1);
}
var looksRandom = (m, min) => mixed(m) && switches(m) >= min && m.split(/[-_]/).some((p) => p.length >= 16);
var authValue = (k, v) => /^bearer$/i.test(k) ? v.length >= 8 && classes(v) >= 2 : v.length >= 16 && classes(v) >= 2;
var REDACT_MAX = 4e3;
function redact(s) {
  let out = String(s ?? "");
  if (!out) return "";
  if (out.length > REDACT_MAX) out = `${out.slice(0, REDACT_MAX)}\u2026`;
  out = out.replace(BEARER, (m, k, sp, v) => authValue(k, v) ? `${k}${sp}${R}` : m);
  out = out.replace(PAIR, (m, k, sep, v) => v === R ? m : `${k}${sep}${R}`);
  out = out.replace(JWT, R);
  out = out.replace(AWS_ID, R);
  out = out.replace(HEX, R);
  out = out.replace(B642, (m) => looksRandom(m, 0.45) ? R : m);
  out = out.replace(RUN40, (m) => mixed(m) && switches(m) >= 0.35 ? R : m);
  return out;
}
var oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
function code(s) {
  const runs = String(s).match(/`+/g) ?? [];
  const n = Math.max(0, ...runs.map((r) => r.length)) + 1;
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return "`".repeat(n) + pad + s + pad + "`".repeat(n);
}
function designFeedback({ url, items }) {
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
function addPicks(items, picks, kind, max = NOTES_MAX) {
  const list = Array.isArray(picks) ? picks : [];
  if (kind === "pick") return { added: list.slice(-1), dropped: 0 };
  const room = Math.max(0, max - (items?.length ?? 0));
  return { added: list.slice(0, room), dropped: Math.max(0, list.length - room) };
}
var pictureName = (t, now, n) => `${t}-${Math.floor(now).toString(36)}-${n}.png`;
function stalePicks(names, now) {
  const out = [];
  for (const name of names ?? []) {
    const m = /-([0-9a-z]+)-\d+\.png$/.exec(String(name));
    if (!m) continue;
    const at = parseInt(m[1], 36);
    if (Number.isFinite(at) && at > 1e12 && now - at > PICTURE_DAYS * 864e5) out.push(name);
  }
  return out;
}

// src/shared/browser/pick-script.js
var SECRET_WORDS = [
  "access_token",
  "auth_token",
  "api_key",
  "apikey",
  "client_secret",
  "oauth_state",
  "x-amz-",
  "session_id",
  "sessionid",
  "csrf",
  "secret",
  "password",
  "token"
];
var PICK_SCRIPT = `(function () {
  if (window.__dockPickOff) return 'off';
  if (window.__dockPick) return 'ok';
  var SECRET = ${JSON.stringify(SECRET_WORDS)};
  var TEXT_MAX = ${TEXT_MAX};
  var root = document.documentElement;
  var picks = [], els = {}, badges = [], count = 0, held = null;

  function layer(border, bg) {
    var d = document.createElement('div');
    d.setAttribute('data-dock-pick', '');
    d.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;display:none;' +
      'border-radius:2px;border:' + border + ';background:' + bg;
    root.appendChild(d);
    return d;
  }
  var hover = layer('2px solid #3b82f6', 'rgba(59,130,246,0.12)');
  var hold = layer('3px solid #f59e0b', 'rgba(245,158,11,0.15)');

  function place(d, el) {
    var r = el.getBoundingClientRect();
    d.style.left = r.left + 'px'; d.style.top = r.top + 'px';
    d.style.width = r.width + 'px'; d.style.height = r.height + 'px';
    d.style.display = 'block';
  }

  function containsSecret(v) {
    var s = String(v || '').toLowerCase();
    for (var i = 0; i < SECRET.length; i++) if (s.indexOf(SECRET[i]) !== -1) return true;
    return false;
  }
  function cssEscape(v) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(v);
    return String(v).replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\\\' + c; });
  }
  function looksHashy(v) { return /^[A-Za-z0-9_-]{12,}$/.test(v) && /\\d/.test(v) && /[A-Z]/.test(v); }
  function stableClasses(el, max) {
    var out = [];
    if (!el.classList) return out;
    for (var i = 0; i < el.classList.length && out.length < max; i++) {
      var c = el.classList[i];
      if (!c || c.length > 60 || containsSecret(c) || /^css-[a-z0-9]+$/i.test(c) || looksHashy(c)) continue;
      out.push(c);
    }
    return out;
  }
  function part(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id && !containsSecret(el.id)) return tag + '#' + cssEscape(el.id);
    var cls = stableClasses(el, 2);
    return cls.length ? tag + cls.map(function (c) { return '.' + cssEscape(c); }).join('') : tag;
  }
  function unique(sel) { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } }
  function nth(el) {
    var i = 1, s = el.previousElementSibling;
    while (s) { if (s.tagName === el.tagName) i++; s = s.previousElementSibling; }
    if (i > 1) return ':nth-of-type(' + i + ')';
    s = el.nextElementSibling;
    while (s) { if (s.tagName === el.tagName) return ':nth-of-type(1)'; s = s.nextElementSibling; }
    return '';
  }
  function selectorOf(el) {
    var parts = [], cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== root && parts.length < 10) {
      var p = part(cur);
      if (cur.parentElement && !unique([p].concat(parts).join(' > '))) p += nth(cur);
      parts.unshift(p);
      var sel = parts.join(' > ');
      if (unique(sel)) return sel.slice(0, 400);
      cur = cur.parentElement;
    }
    return (parts.join(' > ') || el.tagName.toLowerCase()).slice(0, 400);
  }

  function cleanPath(p) {
    return String(p || '').replace(/[?#].*$/, '')
      .replace(/^turbopack:\\/\\/\\/\\[project\\]\\//, '').replace(/^webpack-internal:\\/\\/\\/(\\.\\/)?/, '')
      .replace(/^webpack:\\/\\/\\/(\\.\\/)?/, '').replace(/^turbopack:\\/\\/\\//, '')
      .replace(/^https?:\\/\\/[^/]+\\//, '').replace(/^file:\\/\\/\\//, '/')
      .replace(/^\\([^)]+\\)\\/\\.\\//, '').replace(/^\\.\\//, '');
  }
  // A React dev build: the element's fiber (__reactFiber$...) and the first _debugSource up its owners.
  function sourceOf(el) {
    try {
      var keys = Object.keys(el), fiber = null;
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) { fiber = el[keys[i]]; break; }
      }
      for (var d = 0; fiber && d < 35; d++, fiber = fiber.return) {
        var s = fiber._debugSource || (fiber._debugOwner && fiber._debugOwner._debugSource);
        if (s && s.fileName && s.lineNumber) {
          var file = cleanPath(s.fileName);
          return containsSecret(file) ? null : { file: file.slice(0, 300), line: s.lineNumber };
        }
      }
    } catch (e) {}
    return null;
  }

  function textOf(el) {
    var t = '';
    try { t = el.innerText || el.textContent || ''; } catch (e) {}
    t = String(t).replace(/\\s+/g, ' ').trim();
    if (!t) t = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
    return String(t).replace(/\\s+/g, ' ').trim().slice(0, TEXT_MAX);
  }

  function target(e) {
    var el = e.target;
    while (el && el.nodeType !== 1) el = el.parentNode;
    return el && el !== root ? el : null;
  }
  function stop(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  function onMove(e) {
    var el = target(e);
    if (el && !held) place(hover, el);
  }
  function onClick(e) {
    stop(e);
    var el = target(e);
    if (el) record(el);
  }
  function record(el) {
    var r = el.getBoundingClientRect();
    var n = ++count;
    els[n] = el;
    picks.push({ n: n, selector: selectorOf(el), text: textOf(el), tag: el.tagName.toLowerCase(),
      box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, source: sourceOf(el) });
    hover.style.display = 'none';
    held = el;
    place(hold, el);
  }
  var swallow = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick', 'contextmenu'];
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('click', onClick, true);
  for (var i = 0; i < swallow.length; i++) window.addEventListener(swallow[i], stop, true);

  function badge(n, label) {
    var el = els[n];
    if (!el || !el.isConnected) return;
    var r = el.getBoundingClientRect();
    var b = document.createElement('div');
    b.setAttribute('data-dock-pick', '');
    b.textContent = String(label);
    b.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483647;min-width:18px;height:18px;padding:0 4px;' +
      'box-sizing:border-box;border-radius:9px;background:#f59e0b;color:#111;font:bold 11px/18px sans-serif;text-align:center;' +
      'left:' + Math.max(0, r.left + window.scrollX - 9) + 'px;top:' + Math.max(0, r.top + window.scrollY - 9) + 'px';
    root.appendChild(b);
    badges.push(b);
  }

  window.__dockPick = {
    read: function () { return JSON.stringify(picks.splice(0)); },
    // The element at a viewport point when it is a frame: picked whole (clicks inside a frame never reach this
    // window's listeners, so the panel keeps them from the page and asks here). True when it was one.
    at: function (x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el || (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME')) return false;
      record(el);
      return true;
    },
    hold: function (n) { var el = els[n]; if (!el || !el.isConnected) return false; hover.style.display = 'none'; held = el; place(hold, el); return true; },
    release: function () { held = null; hold.style.display = 'none'; return true; },
    mark: function (list) {
      for (var i = 0; i < badges.length; i++) badges[i].remove();
      badges = [];
      for (var j = 0; j < list.length; j++) badge(list[j].n, list[j].label);
      return true;
    },
    stop: function () {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      for (var i = 0; i < swallow.length; i++) window.removeEventListener(swallow[i], stop, true);
      var all = document.querySelectorAll('[data-dock-pick]');
      for (var j = 0; j < all.length; j++) all[j].remove();
      delete window.__dockPick;
      return true;
    }
  };
  return 'ok';
})()`;
var START_SCRIPT = `(function () { delete window.__dockPickOff; })();
${PICK_SCRIPT}`;
var READ_PICKS = "(function () { return window.__dockPick ? window.__dockPick.read() : 'absent'; })()";
var RELEASE_SCRIPT = "(function () { return !!(window.__dockPick && window.__dockPick.release()); })()";
var STOP_SCRIPT = "(function () { window.__dockPickOff = true; return !!(window.__dockPick && window.__dockPick.stop()); })()";
var probeScript = (x, y) => {
  const n = (v) => Math.round(Number(v)) || 0;
  return `(function () { var d = window.__dockPick; return JSON.stringify(d ? { present: true, frame: d.at(${n(x)}, ${n(y)}) } : { present: false, off: !!window.__dockPickOff }); })()`;
};
var holdScript = (n) => `(function () { return !!(window.__dockPick && window.__dockPick.hold(${Math.floor(Number(n)) || 0})); })()`;
function markScript(list) {
  const safe = (list ?? []).map((x) => ({ n: Math.floor(Number(x.n)) || 0, label: Math.floor(Number(x.label)) || 0 }));
  return `(function () { return !!(window.__dockPick && window.__dockPick.mark(${JSON.stringify(safe)})); })()`;
}
var str = (v, max) => typeof v === "string" ? v.slice(0, max) : "";
function pickOf(o) {
  if (!o || typeof o !== "object" || typeof o.selector !== "string" || !o.selector) return null;
  const b = o.box;
  const box = b && typeof b === "object" && ["x", "y", "w", "h"].every((k) => Number.isFinite(b[k])) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  const s = o.source;
  const source = s && typeof s === "object" && typeof s.file === "string" && s.file && Number.isFinite(s.line) ? { file: s.file, line: s.line } : null;
  return { n: Number.isFinite(o.n) ? o.n : 0, selector: str(o.selector, 400), text: str(o.text, TEXT_MAX), tag: str(o.tag, 40), box, source };
}
function evalValue(text) {
  let v;
  try {
    v = JSON.parse(String(text ?? ""));
  } catch {
    return void 0;
  }
  if (v && typeof v === "object" && !Array.isArray(v) && v.data && "result" in v.data) v = v.data.result;
  return v;
}
function readResult(text) {
  const v = evalValue(text);
  if (v === "absent" || v === void 0) return { present: false, picks: [] };
  return { present: true, picks: parsePicks(text) };
}
function parseProbe(text) {
  let v = evalValue(text);
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  return { present: v.present === true, off: v.off === true, frame: v.frame === true };
}
function pointerGate(probe) {
  if (!probe?.present) return "absent";
  return probe.frame ? "frame" : "send";
}
function parsePicks(text) {
  let v;
  try {
    v = JSON.parse(String(text ?? ""));
  } catch {
    return [];
  }
  if (v && typeof v === "object" && !Array.isArray(v) && v.data && "result" in v.data) v = v.data.result;
  for (let i = 0; i < 2 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.map(pickOf).filter(Boolean);
}

// src/mods/dock-browser/person.js
var personControls = {
  mode() {
    return this.record ? panelMode(this.record, this.control, Date.now(), this.browser.handoffMinutes) : { kind: "view" };
  },
  // Runs one button's work, one at a time, with its label shown; a failure is shown under the buttons.
  act(label2, cx, work) {
    if (this.busy || !this.terminal || !this.record) return;
    const t = this.terminal, rec = this.record;
    this.busy = label2;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx2) => {
      try {
        await work(t, rec, cx2);
      } catch (e) {
        if (this.terminal === t) this.error = String(e?.message ?? e);
      }
      this.busy = null;
      cx2.notify();
    });
  },
  async setControl(t, change) {
    const c = await writeControl(t, this.created, change);
    if (!c) throw new Error("The control record couldn't be written");
    if (this.terminal === t) {
      this.control = c;
      this.controlChanged();
    }
  },
  ab(rec, args) {
    const chrome = this.browser.chrome ? ["--executable-path", this.browser.chrome] : [];
    return run(this.bin(), ["--session", rec.session, ...chrome, ...args]);
  },
  takeOver(cx) {
    this.act("Taking over\u2026", cx, (t) => this.setControl(t, changes.takeOver(Date.now())));
  },
  // The real window finished, size tabs closed and the agent's tab and viewport back, Pick or Notes' script taken out,
  // then the page is the agent's again. What to finish comes from the control record, so it doesn't matter which copy
  // opened it.
  handBack(cx) {
    this.act("Handing back\u2026", cx, async (t, rec) => {
      await this.finish(t, rec, true);
      await this.setControl(t, changes.handBack());
    });
  },
  // keep: the real window's state is kept (window-done); otherwise the window is just closed.
  async finish(t, rec, keep) {
    const f = finishOf(await readControl(t, this.created));
    if (f.window) {
      if (keep) await browse(["window-done", "--terminal", t]);
      else await run(this.bin(), ["--session", realSessionName(rec.session), "close"]).catch(() => null);
    }
    for (const args of f.restore) await this.ab(rec, args).catch(() => null);
    if (f.stopPick) await this.ab(rec, ["eval", STOP_SCRIPT]).catch(() => null);
  },
  answer(value, cx) {
    const h = this.mode().handoff;
    if (!h) return;
    this.act(value === "done" ? "Done\u2026" : "Cancelling\u2026", cx, async (t, rec) => {
      await this.finish(t, rec, value === "done");
      await this.setControl(t, changes.answer(h.id, value));
    });
  },
  openWindow(cx) {
    if (!this.mode().handoff) return;
    this.act("Opening a window\u2026", cx, async (t) => {
      await this.setControl(t, changes.window(Date.now()));
      await browse(["window-open", "--terminal", t]);
      await this.setControl(t, changes.windowOpened(Date.now()));
    });
  },
  // Another tab: the person takes the page first, so the agent never drives it at the same time.
  switchTab(tabId, cx) {
    this.act("Switching tab\u2026", cx, async (t, rec) => {
      if (!inControl(this.mode())) await this.setControl(t, changes.takeOver(Date.now()));
      if (pickKind(this.mode())) await this.ab(rec, ["eval", STOP_SCRIPT]).catch(() => null);
      await this.ab(rec, ["tab", tabId]);
    });
  },
  // The page at a size, in a new tab. agent-browser's viewport is the whole session's and the new tab becomes the
  // active one, so the person takes the page (the agent waits) and Hand back puts the agent's tab and size back.
  size(kind, cx) {
    const st = this.stream?.state ?? {};
    const { url } = pageHeading(this.record, st);
    const cmds = sizeCommands(kind, url);
    if (!cmds) return;
    const agentTab = activeTab(st.tabs)?.tabId ?? null, viewport = this.stream?.size ?? null;
    this.act("Opening the size\u2026", cx, async (t, rec) => {
      if (!inControl(this.mode())) await this.setControl(t, changes.takeOver(Date.now()));
      const opened = await this.ab(rec, cmds[0]);
      const id = newTabId(opened.stdout);
      if (id) await this.setControl(t, changes.sizeTab(id, agentTab, viewport ? { w: viewport.w, h: viewport.h } : null));
      await this.ab(rec, cmds[1]);
    });
  },
  enlarge() {
    try {
      openOverlay(bigWindow(this.terminal));
    } catch (e) {
      this.error = String(e?.message ?? e);
    }
  }
};

// src/mods/dock-browser/pick.js
import { appHome as appHome3, hc } from "herdr";
import { InputState } from "gpui-base";
import * as fs3 from "fs/promises";
var home2 = () => slashPath(appHome3());
var READ_TRIES = 6;
var BACKSTOP_MS = 2e3;
var OFF_TAB = "Pick was ended in this tab. Cancel, then start it again to pick here.";
var pickControls = {
  // The note fields, made once (InputState needs a live host call, not render): one per element Notes can hold.
  makeNoteInputs() {
    this.noteInputs = Array.from({ length: NOTES_MAX }, () => InputState.new({ placeholder: "What should change here?" }));
    for (const input of this.noteInputs) input.on("submit", (_e, cx) => {
      if (this.picking?.kind === "pick") this.sendFeedback(cx);
    });
    this.freeSlots = this.noteInputs.map((_x, i) => i);
    this.pickWanted = false;
    this.pickReading = false;
    this.pickPending = null;
    this.picking = null;
  },
  startPick(kind, cx) {
    this.act(kind === "pick" ? "Starting Pick\u2026" : "Starting Notes\u2026", cx, async (t, rec, cx2) => {
      this.dropPicks();
      await this.setControl(t, changes.pick(kind, Date.now()));
      const r = await this.ab(rec, ["eval", START_SCRIPT]).catch((e) => ({ stdout: "", err: e }));
      if (String(r.stdout).trim() !== '"ok"') {
        await this.setControl(t, changes.handBack());
        throw new Error(`Pick couldn't start in this page${r.err ? `: ${r.err.message ?? r.err}` : ""}`);
      }
      this.picking = { kind, t, items: [], url: this.stream?.state?.url ?? null };
      this.flash = null;
      this.pickBackstop(this.picking, cx2);
    });
  },
  // Besides the read after each click here: one every few seconds while it runs (a click that reached the page
  // another way, one whose read gave up early, or a page that lost the script: ensurePick).
  pickBackstop(p, cx) {
    if (!p) return;
    cx.spawn(async (cx2) => {
      for (; ; ) {
        await cx2.sleep(BACKSTOP_MS);
        if (this.picking !== p) return;
        if (this.terminal === p.t && !this.pickReading) this.pickClicked(cx2, 1);
      }
    });
  },
  // A press on the picture while this copy picks: held back until a probe says the script is in the page and the
  // pointer isn't on a frame; then the press (and its release, when it came meanwhile) goes to the page.
  pickPress(down, at, cx) {
    const p = this.myPick(), rec = this.record;
    if (!p || !rec || this.pickPending) return;
    const press = this.pickPending = { up: null, ready: false };
    cx.spawn(async (cx2) => {
      const r = await this.ab(rec, ["eval", probeScript(at.x, at.y)]).catch(() => null);
      if (this.pickPending !== press) return;
      const gate = pointerGate(parseProbe(r?.stdout));
      if (gate === "send" && this.myPick() === p) {
        this.sendToPage(down);
        if (press.up) {
          this.sendToPage(press.up);
          this.pickPending = null;
          this.pickClicked(cx2);
        } else press.ready = true;
        return;
      }
      this.pickPending = null;
      if (gate === "frame") this.pickClicked(cx2);
      else await this.ensurePick(rec);
      cx2.notify();
    });
  },
  pickRelease(up, cx) {
    const press = this.pickPending;
    if (!press) return;
    if (!press.ready) {
      press.up = up;
      return;
    }
    this.sendToPage(up);
    this.pickPending = null;
    this.pickClicked(cx);
  },
  sendToPage(msgs) {
    const s = this.stream;
    if (s) for (const m of msgs) s.send(m);
  },
  // The script is gone from the page (a reload, another page, another tab): back in, only while the control record,
  // read fresh, still says this copy's Pick or Notes. A tab that left Pick (STOP_SCRIPT's mark) stays off.
  async ensurePick(rec) {
    const p = this.myPick();
    if (!p || !rec) return false;
    if (!shouldReinstall(false, await readControl(p.t, this.created), p.kind) || this.myPick() !== p) return false;
    const r = await this.ab(rec, ["eval", PICK_SCRIPT]).catch(() => null);
    const v = String(r?.stdout ?? "").trim();
    if (v === '"off"') this.error = OFF_TAB;
    return v === '"ok"';
  },
  // The stream's URL changed while this copy picks: the script goes back in now, not at the next backstop read.
  pickUrlCheck(cx) {
    const p = this.myPick(), url = this.stream?.state?.url;
    if (!p || !url || url === p.url) return;
    p.url = url;
    const rec = this.record;
    cx.spawn(async (cx2) => {
      await this.ensurePick(rec);
      if (p.kind === "notes") await this.markNotes(rec);
      cx2.notify();
    });
  },
  // A click went to the page while picking: read what the script recorded (one read loop at a time; a click during
  // it runs the loop once more).
  pickClicked(cx, tries = READ_TRIES) {
    if (!this.myPick()) return;
    this.pickWanted = true;
    if (this.pickReading) return;
    this.pickReading = true;
    cx.spawn(async (cx2) => {
      try {
        while (this.pickWanted) {
          this.pickWanted = false;
          await this.readPicks(cx2, tries);
        }
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.pickReading = false;
      cx2.notify();
    });
  },
  async readPicks(cx, tries) {
    const p = this.picking, rec = this.record;
    for (let i = 0; i < tries && this.picking === p && rec; i++) {
      await cx.sleep(i ? 150 : 80);
      const r = await this.ab(rec, ["eval", READ_PICKS]).catch(() => null);
      if (!r) continue;
      const { present, picks } = readResult(r.stdout);
      if (!present) {
        await this.ensurePick(rec);
        continue;
      }
      if (!picks.length) continue;
      await this.addPicked(p, rec, picks);
      cx.notify();
      return;
    }
  },
  async addPicked(p, rec, picks) {
    const { added, dropped } = addPicks(p.items, picks, p.kind);
    this.error = dropped ? `Notes holds ${NOTES_MAX} elements: send or remove some first` : null;
    if (p.kind === "pick" && added.length) this.dropItems(p.items.splice(0));
    for (const pick of added) {
      const picture = await this.takePicture(rec, p.t, pick);
      if (this.picking !== p) {
        if (picture) await fs3.unlink(picture).catch(() => {
        });
        return;
      }
      const slot = this.freeSlots.shift();
      if (slot === void 0) break;
      this.noteInputs[slot].set_value("");
      const notes = p.kind === "notes";
      p.items.push({ ...pick, picture, slot, intent: notes ? "fix" : null, priority: notes ? "normal" : null });
      this.noteInputs[slot].focus();
    }
    this.flash = null;
    if (p.kind === "notes") await this.markNotes(rec);
  },
  // The whole page with the element outlined (agent-browser takes no element shot), under picks/; null on failure.
  async takePicture(rec, t, pick) {
    const dir = `${home2()}/${picksRel()}`;
    await fs3.mkdir(dir, { recursive: true }).catch(() => {
    });
    const path = `${dir}/${pictureName(t, Date.now(), pick.n)}`;
    try {
      await this.ab(rec, ["eval", holdScript(pick.n)]);
      await this.ab(rec, ["screenshot", path]);
      return path;
    } catch (e) {
      console.log(`dock-browser: no picture: ${e?.message ?? e}`);
      return null;
    } finally {
      await this.ab(rec, ["eval", RELEASE_SCRIPT]).catch(() => null);
    }
  },
  // Notes' numbered badges in the page, numbered as the list is.
  async markNotes(rec) {
    const p = this.picking;
    if (!p || p.kind !== "notes") return;
    await this.ab(rec, ["eval", markScript(p.items.map((it, i) => ({ n: it.n, label: i + 1 })))]).catch(() => null);
  },
  removeNote(i, cx) {
    const p = this.picking;
    if (!p?.items[i]) return;
    this.dropItems(p.items.splice(i, 1));
    const rec = this.record;
    if (rec) cx.spawn(async () => this.markNotes(rec));
    cx.notify();
  },
  setNoteField(i, field, value, cx) {
    const it = this.picking?.items[i];
    if (!it) return;
    it[field] = value;
    cx.notify();
  },
  // The prompt for what is listed, with the notes as typed.
  feedbackText() {
    const p = this.picking;
    const { url } = pageHeading(this.record, this.stream?.state ?? {});
    return designFeedback({ url, items: p.items.map((it) => ({ ...it, note: this.noteInputs[it.slot].value() })) });
  },
  copyNotes(cx) {
    if (!this.picking?.items.length) return;
    cx.write_to_clipboard(this.feedbackText());
    this.flash = "Copied";
    cx.notify();
  },
  // Typed into the agent's terminal as its next prompt; then the script leaves the page and the page is handed back
  // (finish: size tabs closed, the agent's tab and size back). The pictures stay for the agent to open.
  sendFeedback(cx) {
    const p = this.picking;
    if (!p?.items.length || this.busy) return;
    const text = this.feedbackText();
    this.act("Sending\u2026", cx, async (t, rec) => {
      const r = await hc(["send", t, text]);
      if (r.code !== 0) throw new Error(String(r.stderr || r.stdout || "").trim().split("\n")[0] || "The agent's terminal didn't take it");
      this.releaseSlots(p.items);
      if (this.picking === p) this.picking = null;
      await this.finish(t, rec, true);
      await this.setControl(t, changes.handBack());
    });
  },
  // Leaving Pick or Notes without sending: the same as Hand back (its finish takes the script out of the page).
  leavePick(cx) {
    this.handBack(cx);
  },
  // This copy's Pick or Notes ended (sent, or the record no longer says so): what wasn't sent goes, pictures included.
  dropPicks() {
    const p = this.picking;
    this.picking = null;
    this.pickPending = null;
    if (this.error === OFF_TAB) this.error = null;
    if (p) this.dropItems(p.items);
  },
  dropItems(items) {
    this.releaseSlots(items);
    for (const it of items) if (it.picture) fs3.unlink(it.picture).catch(() => {
    });
  },
  releaseSlots(items) {
    for (const it of items) {
      if (!Number.isInteger(it.slot) || this.freeSlots.includes(it.slot)) continue;
      this.noteInputs[it.slot].set_value("");
      this.freeSlots.push(it.slot);
    }
    this.freeSlots.sort((a, b) => a - b);
  },
  // Pictures older than a day (sent long ago): deleted with the sweep.
  async sweepPictures() {
    const dir = `${home2()}/${picksRel()}`;
    let names = [];
    try {
      names = await fs3.readdir(dir);
    } catch {
      return;
    }
    for (const n of stalePicks(names, Date.now())) await fs3.unlink(`${dir}/${n}`).catch(() => {
    });
  }
};

// src/mods/dock-browser/pick-view.js
import { div as div2 } from "gpui-kit";
import { h_flex as h_flex2, v_flex as v_flex2, Input } from "gpui-base";
function choice(t, id, values, current, onPick) {
  return h_flex2().flex_none().gap(2).children(values.map((v) => div2().id(`${id}-${v}`).px(6).h(18).flex().items_center().rounded(4).text_size(10.5).cursor_pointer().when(v === current, (e) => e.bg(t.accent).text_color(t.background)).when(v !== current, (e) => e.border_1().border_color(t.border).text_color(t.muted).hover((s) => s.bg(t.hover))).on_click((_e, cx) => {
    cx.stop_propagation();
    onPick(v, cx);
  }).child(v)));
}
function noteField(t, input) {
  return div2().flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).bg(t.background).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(input).w_full().h(20).text_size(12).text_color(t.foreground));
}
var label = (it) => `${it.tag || "element"}${it.text ? ` "${it.text.slice(0, 40)}"` : ""}`;
function pickBar(t, state, on) {
  const busy = !!state.busy;
  const bar = v_flex2().flex_none().gap(6).px(12).py(8).border_b(1).border_color(t.accent);
  const p = state.picking;
  if (!p) {
    const what = state.elsewhere === "notes" ? "Notes" : "Pick";
    return bar.child(div2().text_size(11.5).text_color(t.dim).child(`${what} is running in another copy of this panel.`)).child(h_flex2().child(button(t, "browser-pick-leave", "Cancel", on.leave, { busy, tip: "End it and hand the page back; nothing is sent" })));
  }
  const items = p.items;
  if (p.kind === "pick") {
    const it = items[0];
    bar.child(div2().text_size(11.5).text_color(t.dim).child(it ? `Picked ${label(it)}. Say what should change, then Send (Enter). Click another element to pick it instead.` : "Point at an element in the page and click it. The page doesn't get the click."));
    if (it) bar.child(div2().truncate().text_size(11).text_color(t.muted).child(it.selector));
    if (it) bar.child(h_flex2().gap(4).items_center().child(noteField(t, state.inputs[it.slot])));
  } else {
    bar.child(div2().text_size(11.5).text_color(t.dim).child(items.length ? `${items.length} of ${NOTES_MAX}. Click more elements, write a note on each, then Send them together.` : `Click elements in the page (up to ${NOTES_MAX}); each gets a numbered badge and a note here.`));
    if (items.length) {
      bar.child(v_flex2().id("browser-notes").max_h(320).overflow_y_scrollbar().gap(8).children(items.map((it, i) => v_flex2().gap(3).child(h_flex2().gap(6).items_center().child(div2().flex_none().min_w(18).h(18).px(4).rounded(9).bg(t.working).text_color(t.background).text_size(10.5).font_semibold().flex().items_center().justify_center().child(String(i + 1))).child(div2().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.foreground).child(label(it))).child(div2().id(`browser-note-remove-${i}`).flex_none().px(5).h(18).flex().items_center().rounded(4).text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove this element").on_click((_e, cx) => {
        cx.stop_propagation();
        on.remove(i, cx);
      }).child("\u2715"))).child(div2().truncate().text_size(10.5).text_color(t.dim).child(it.selector)).child(noteField(t, state.inputs[it.slot])).child(h_flex2().flex_wrap().gap(6).items_center().child(choice(t, `browser-note-intent-${i}`, INTENTS, it.intent, (v, cx) => on.field(i, "intent", v, cx))).child(choice(t, `browser-note-priority-${i}`, PRIORITIES, it.priority, (v, cx) => on.field(i, "priority", v, cx)))))));
    }
  }
  const row = h_flex2().flex_wrap().gap(4).items_center().child(button(t, "browser-pick-send", "Send", on.send, { busy: busy || !items.length, primary: true, tip: "Send to the agent as its next prompt, then hand the page back" }));
  if (p.kind === "notes") row.child(button(t, "browser-pick-copy", "Copy", on.copy, { busy: busy || !items.length, tip: "Copy the Design Feedback as Markdown" }));
  row.child(button(t, "browser-pick-leave", "Cancel", on.leave, { busy, tip: "Stop pointing and hand the page back; nothing is sent" }));
  if (state.flash) row.child(div2().text_size(11).text_color(t.dim).child(state.flash));
  return bar.child(row);
}

// src/mods/dock-browser/main.js
var MOD = "dock-browser";
var PAD = 12;
var SWEEP_MS = 3e4;
var LOSS_GRACE_MS = 1e3;
var CLOSED_MS = 3e3;
var EMPTY = "No page yet. The agent opens one with browse open.";
var MOVE_MS = 30;
var home3 = () => slashPath(appHome4());
var nodePlatform = (p) => p === "windows" ? "win32" : p === "macos" ? "darwin" : "linux";
var Browser = class extends View {
  init(_props, cx) {
    this.big = !!props()?.big;
    this.h = cx.focus_handle();
    this.width = 0;
    this.bodyH = 0;
    this.busy = null;
    this.error = null;
    this.pressed = false;
    this.lastMove = 0;
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
    this.flash = null;
    this.makeNoteInputs();
    if (checking()) return;
    cx.timer.every(SWEEP_MS, (cx2) => {
      if (this.big) {
        cx2.notify();
        return;
      }
      if (this.shown()) cx2.spawn(async () => {
        await this.sweep();
        await this.sweepPictures();
      });
      cx2.notify();
    });
    if (!this.big) this.watchHandoffs(cx);
    cx.spawn(async (cx2) => {
      for (; ; ) {
        const c = await nextCommand();
        if (c === "focus" && this.record && inControl(this.mode())) this.h.focus();
        if (c === "enlarge" && !this.big && this.terminal) this.enlarge();
        if ((c === "pick" || c === "notes") && !this.big && this.record && this.shown() && !pickKind(this.mode())) this.startPick(c, cx2);
        cx2.notify();
      }
    });
  }
  shown() {
    if (this.big || props()?.dockRegion !== "right") return true;
    const applied = shared2("dock.config.applied");
    return rightShownOf(shared2("dock.right.shown"), applied) && rightActiveOf(shared2("dock.right.active"), applied?.right?.features ?? []) === MOD;
  }
  bin() {
    return `${home3()}/${binRel(nodePlatform(window()?.platform))}`;
  }
  framesOf(t) {
    return this.big ? bigFramesRel(t) : framesRel(t);
  }
  // Called from render: notices the panel showing or hiding and the agent in front changing.
  follow(cx) {
    if (checking()) return;
    const shown = this.shown();
    let agent = null;
    const fixed = this.big ? props()?.terminal : null;
    if (fixed) agent = { address: String(fixed) };
    else if (shown) {
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
    Object.assign(this, { terminal: t, created: null, record: null, control: parseControl(null), closed: null, showErrors: false, error: null, pressed: false });
    if (!shown) {
      this.watch?.cancel?.();
      this.watch = null;
      return;
    }
    if (!wasShown) {
      this.watchSessions(cx);
      cx.spawn(async (cx2) => {
        await this.loadConfig();
        if (!this.big) await this.sweep();
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
      const h = home3();
      const src = JSON.parse(await readTextFile2(`${h}/mods/dock-core/source.json`) ?? "null");
      const install = installOf(src, h);
      if (!install) return;
      const parsed = parseConfig(await readTextFile2(install.configPath) ?? "");
      if (!parsed.ok) return;
      const local = parseLocal(await readTextFile2(`${h}/herdr-dock/local.json`).catch(() => null));
      const host = shared2("dock.host");
      this.browser = browserOf(mergeWithLocal(parsed.config, typeof host === "string" ? host : null, local.ok ? local.local : null));
    } catch (e) {
      console.log(`${MOD}: config not read: ${e?.message ?? e}`);
    }
  }
  async createdOf(t) {
    try {
      const r = await hc2(["get", t]);
      const c = r.code === 0 ? JSON.parse(r.stdout).created_ms : null;
      return Number.isFinite(c) ? c : null;
    } catch {
      return null;
    }
  }
  // This terminal's session record, or null (none, unreadable, or left by an older terminal with the same id).
  async sessionOf(t) {
    const rec = parseSession(await readTextFile2(`${home3()}/${sessionFileRel(t)}`).catch(() => null));
    return rec && this.created != null && isStale(rec, this.created) ? null : rec;
  }
  async readRecords(cx) {
    const t = this.terminal;
    if (!t) return;
    const rec = await this.sessionOf(t);
    const text = await readTextFile2(`${home3()}/${controlFileRel(t)}`).catch(() => null);
    if (this.terminal !== t) return;
    const control = parseControl(text);
    this.control = text != null && this.created != null && isStale(control, this.created) ? parseControl(null) : control;
    this.controlChanged();
    if (!rec && this.stream && !this.closed) this.closed = this.closedNow(cx, this.record?.opened ?? null);
    this.record = rec;
    if (this.closed && rec && rec.opened !== this.closed.opened) this.closed = null;
    this.syncStream(cx);
    cx.notify();
  }
  // Re-reads the records when the sessions folder changes, while the panel shows.
  watchSessions(cx) {
    const dir = `${home3()}/${sessionsRel()}`;
    const gen = this.watchGen = (this.watchGen ?? 0) + 1;
    const done = () => this.key === "hidden" || this.watchGen !== gen;
    cx.spawn(async (cx2) => {
      await fs4.mkdir(dir, { recursive: true }).catch(() => {
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
      framesRel: this.framesOf(t),
      onChange: () => {
        if (this.stream === s) {
          this.pickUrlCheck(cx);
          cx.notify();
        }
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
        const r = await exec2(this.bin(), ["--session", s.session, "stream", "status", "--json"]).catch(() => null);
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
    const r = await exec2("herdr-app", ["ls"]).catch(() => null);
    const live = r?.code === 0 ? liveTerminals(r.stdout) : null;
    if (!live) return;
    const dir = `${home3()}/${sessionsRel()}`;
    let names = [];
    try {
      names = await fs4.readdir(dir);
    } catch {
      return;
    }
    const sessions = [];
    for (const n of names) {
      if (!n.endsWith(".json") || n.endsWith(".control.json")) continue;
      const rec = parseSession(await readTextFile2(`${dir}/${n}`).catch(() => null));
      if (rec) sessions.push(rec);
    }
    for (const g of goneSessions(sessions, live)) {
      const chrome = this.browser.chrome ? ["--executable-path", this.browser.chrome] : [];
      await exec2(this.bin(), ["--session", g.session, ...chrome, "close"]).catch(() => null);
      await fs4.unlink(`${home3()}/${sessionFileRel(g.terminal)}`).catch(() => {
      });
      await fs4.unlink(`${home3()}/${controlFileRel(g.terminal)}`).catch(() => {
      });
      await clearFolder(framesRel(g.terminal));
      await clearFolder(bigFramesRel(g.terminal));
    }
  }
  // New handoffs, announced whether or not the panel shows (the notification is how the person finds out).
  watchHandoffs(cx) {
    const dir = `${home3()}/${sessionsRel()}`;
    cx.spawn(async (cx2) => {
      await this.loadConfig();
      await fs4.mkdir(dir, { recursive: true }).catch(() => {
      });
      for (; ; ) {
        await announceHandoffs(this.browser.handoffMinutes).catch((e) => console.log(`${MOD}: handoffs not read: ${e?.message ?? e}`));
        let w;
        try {
          w = watchFolder(dir);
        } catch {
          await cx2.sleep(3e3);
          continue;
        }
        const changed = await w.catch(() => null);
        if (!changed?.length) await cx2.sleep(1e3);
      }
    });
  }
  // The control record changed (read, or written by this copy): a drag in progress ends when the person no longer
  // has the page, and this copy's Pick or Notes ends when the record no longer says so (handed back here or in
  // another copy).
  controlChanged() {
    const mode = this.mode();
    if (!this.record || !inControl(mode)) this.pressed = false;
    if (this.picking && this.picking.t === this.terminal && pickKind(mode) !== this.picking.kind) this.dropPicks();
  }
  // This copy's Pick or Notes, on the terminal shown.
  myPick() {
    return this.picking && this.picking.t === this.terminal ? this.picking : null;
  }
  // ---- drawing ----
  note(t, text) {
    return div3().p(PAD + 2).text_size(12.5).text_color(t.dim).child(text);
  }
  chip(t, text, color) {
    return div3().flex_none().px(6).h(18).flex().items_center().rounded(4).border_1().border_color(color ?? t.border).text_size(10.5).text_color(color ?? t.muted).child(text);
  }
  header(t, cx) {
    const rec = this.record, st = this.stream?.state ?? {};
    const { title, url } = pageHeading(rec, st);
    const prod = isProduction(url, this.browser.production);
    const errors = st.errors ?? 0;
    const tabs = Array.isArray(st.tabs) ? st.tabs : [];
    return v_flex3().flex_none().px(PAD).pt(10).pb(8).gap(4).border_b(1).border_color(t.border).child(h_flex3().gap(6).items_center().child(div3().flex_1().min_w(0).truncate().text_size(13).font_semibold().child(title || "Browser")).when(!!prod, (el) => el.child(this.chip(t, "Production", t.blocked))).child(this.chip(t, rec.profile === "signed-in" ? "signed-in" : "clean")).when(errors > 0, (el) => el.child(div3().id("browser-errors").flex_none().px(6).h(18).flex().items_center().rounded(4).cursor_pointer().bg(t.blocked).text_size(10.5).text_color(t.background).tooltip(this.showErrors ? "Hide the errors" : "The page's last console errors").on_click((_e, cx2) => {
      this.showErrors = !this.showErrors;
      cx2.notify();
    }).child(`${errors} error${errors === 1 ? "" : "s"}`)))).child(div3().truncate().text_size(11.5).text_color(t.dim).child(url)).when(tabs.length > 1, (el) => el.child(h_flex3().gap(4).pt(2).overflow_hidden().children(tabs.map((tab, i) => div3().id(`browser-tab-${i}`).flex_shrink_1().min_w(0).max_w(160).truncate().px(7).h(20).rounded(4).text_size(11).when(!!tab.active, (e) => e.bg(t.selected ?? t.hover).text_color(t.foreground)).when(!tab.active && !!tab.tabId, (e) => e.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Switch to this tab (you take the page)").on_click((_e, cx2) => this.switchTab(String(tab.tabId), cx2))).child(String(tab.title || tab.url || "Tab")))))).when(this.showErrors && errors > 0, (el) => el.child(v_flex3().id("browser-error-list").mt(4).max_h(140).overflow_y_scrollbar().gap(2).p(6).rounded(6).border_1().border_color(t.border).children((st.errorTexts ?? []).slice().reverse().map((e, i) => div3().id(`browser-error-${i}`).text_size(11).text_color(t.blocked).child(String(e).slice(0, 400))))));
  }
  picture(t, mode) {
    const s = this.stream;
    const room = this.big ? this.bodyH - PAD * 2 : 0;
    const drawnW = fitWidth(s?.size, this.width - PAD * 2, room);
    if (!s?.frame || !s.size || drawnW <= 0) return this.note(t, s?.state.phase === "connecting" && s.loss.lastReconnect ? "Reconnecting\u2026" : "Connecting\u2026");
    const h = Math.round(drawnHeight(s.size, drawnW));
    const layer = (rel) => div3().absolute().top(0).left(0).child(image(rel).w(drawnW).h(h));
    const live = inControl(mode);
    const edge = mode.kind === "handoff" ? t.working : t.accent;
    const pointing = !!pickKind(mode), mine = !!this.myPick();
    const clicks = !pointing || mine;
    const send = (msgs) => {
      for (const m of msgs) s.send(m);
    };
    return div3().id("browser-page").relative().w(drawnW).h(h).overflow_hidden().rounded(4).when(live, (el) => el.border_2().border_color(edge)).when(!live, (el) => el.border_1().border_color(t.border)).on_scroll_wheel((e, cx) => {
      if (!s.size || !e.local_position) return;
      s.send(wheelEvent(e, s.size.w, drawnW));
      cx.stop_propagation();
    }).when(live, (el) => el.track_focus(this.h).on_mouse_down("left", (e, cx) => {
      if (!pointing) this.h.focus();
      if (!s.size || !e.local_position || !clicks) return;
      cx.stop_propagation();
      if (pointing) {
        this.pickPress(mouseEvents("down", e, s.size.w, drawnW), toPage(e.local_position, s.size.w, drawnW), cx);
        return;
      }
      this.pressed = true;
      send(mouseEvents("down", e, s.size.w, drawnW));
    }).on_mouse_up("left", (e, cx) => {
      this.pressed = false;
      if (!s.size || !e.local_position || !clicks) return;
      cx.stop_propagation();
      if (pointing) {
        this.pickRelease(mouseEvents("up", e, s.size.w, drawnW), cx);
        return;
      }
      send(mouseEvents("up", e, s.size.w, drawnW));
    }).on_mouse_move((e) => {
      const now = Date.now();
      if (!s.size || !e.local_position || now - this.lastMove < MOVE_MS) return;
      this.lastMove = now;
      send(mouseEvents("move", e, s.size.w, drawnW, this.pressed));
    }).on_key_down((e, cx) => {
      if (pointing) return;
      if (isPaste(e, window()?.platform)) {
        const p = pasteEvents(cx.read_from_clipboard() ?? "");
        if (p.tooLong) {
          this.error = `Clipboard too long to paste (${p.tooLong} characters; the limit is ${PASTE_LIMIT})`;
          cx.notify();
        } else send(p.events);
        cx.stop_propagation();
        return;
      }
      const msgs = keyEvents(e);
      if (!msgs.length) return;
      send(msgs);
      cx.stop_propagation();
    })).when(!!s.prev, (el) => el.child(layer(s.prev))).child(layer(s.frame));
  }
  render(cx) {
    const t = theme();
    this.follow(cx);
    const root = v_flex3().id("dock-browser").size_full().min_h(0).bg(t.background).text_color(t.foreground).on_size_change((size, cx2) => {
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
    const mode = this.mode();
    const handoff = mode.kind === "handoff";
    const windowOpen = handoff && !!this.control.window;
    return root.child(this.header(t, cx)).when(handoff, (el) => el.child(handoffBar(t, { message: mode.handoff.message, windowOpen, busy: this.busy }, {
      done: (cx2) => this.answer("done", cx2),
      cancel: (cx2) => this.answer("cancel", cx2),
      openWindow: (cx2) => this.openWindow(cx2)
    }))).child(controlBar(t, { control: mode.kind, reason: mode.reason ?? null, big: this.big, busy: this.busy }, {
      takeOver: (cx2) => this.takeOver(cx2),
      handBack: (cx2) => this.handBack(cx2),
      size: (kind, cx2) => this.size(kind, cx2),
      pick: (kind, cx2) => this.startPick(kind, cx2),
      enlarge: () => this.enlarge(),
      close: () => closeOverlay(props()?.overlay)
    })).when(!!pickKind(mode), (el) => el.child(pickBar(
      t,
      { picking: this.myPick(), inputs: this.noteInputs, busy: this.busy, flash: this.flash, elsewhere: pickKind(mode) },
      {
        send: (cx2) => this.sendFeedback(cx2),
        copy: (cx2) => this.copyNotes(cx2),
        leave: (cx2) => this.leavePick(cx2),
        remove: (i, cx2) => this.removeNote(i, cx2),
        field: (i, name, value, cx2) => this.setNoteField(i, name, value, cx2)
      }
    ))).when(!!this.error, (el) => el.child(errorLine(t, this.error))).child(v_flex3().id("browser-body").flex_1().min_h(0).overflow_y_scrollbar().p(PAD).on_size_change((size, cx2) => {
      if (Math.abs((size?.height ?? 0) - this.bodyH) > 2) {
        this.bodyH = size.height;
        cx2.notify();
      }
    }).child(this.picture(t, mode)));
  }
  // Closing (the big window, or Herdr): the frames folder goes before the copy does.
  async close() {
    const s = this.stream;
    this.stream = null;
    await s?.stop();
  }
};
Object.assign(Browser.prototype, personControls, pickControls);
export {
  Browser as default
};
