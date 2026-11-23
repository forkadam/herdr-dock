// The page side of Pick and Notes: scripts run with `agent-browser eval`, and the reader of what they return (pure).
// The selector and React-source logic is ported from cockpit's browser/main/grab (cockpit, MIT), itself ported from
// Orca (https://github.com/stablyai/orca, MIT, Copyright (c) 2026 Lovecast Inc.); cut down to what the panel sends.
//
// PICK_SCRIPT installs window.__dockPick once: a capturing pointer-move highlight (the moves arrive over the stream)
// and capturing press/click handlers that stop the page from seeing the click and record the element instead. The
// panel reads the records with READ_PICKS, outlines one with holdScript(n) while it takes the picture, drops that
// outline with RELEASE_SCRIPT, draws Notes' numbered badges with markScript, and removes everything with STOP_SCRIPT.

import { TEXT_MAX } from "./feedback.js";

const SECRET_WORDS = ["access_token", "auth_token", "api_key", "apikey", "client_secret", "oauth_state", "x-amz-",
  "session_id", "sessionid", "csrf", "secret", "password", "token"];

export const PICK_SCRIPT = `(function () {
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

// Pick or Notes starting: the page's "off" mark (left by STOP_SCRIPT) cleared, then the script installed.
export const START_SCRIPT = `(function () { delete window.__dockPickOff; })();\n${PICK_SCRIPT}`;
// The records as JSON, or "absent" when the script isn't in the page (a reload, another page).
export const READ_PICKS = "(function () { return window.__dockPick ? window.__dockPick.read() : 'absent'; })()";
export const RELEASE_SCRIPT = "(function () { return !!(window.__dockPick && window.__dockPick.release()); })()";
// Everything out, and the page marked off: a read or reinstall still in flight can't put the script back.
export const STOP_SCRIPT = "(function () { window.__dockPickOff = true; return !!(window.__dockPick && window.__dockPick.stop()); })()";

// Before a press reaches the page while pointing: is the script there, and is the point on a frame (then it is
// picked whole here and the press goes nowhere)?
export const probeScript = (x, y) => {
  const n = (v) => Math.round(Number(v)) || 0;
  return `(function () { var d = window.__dockPick; return JSON.stringify(d ? { present: true, frame: d.at(${n(x)}, ${n(y)}) } : { present: false, off: !!window.__dockPickOff }); })()`;
};

// Outlines pick n (its picture is taken while this outline shows).
export const holdScript = (n) => `(function () { return !!(window.__dockPick && window.__dockPick.hold(${Math.floor(Number(n)) || 0})); })()`;

// Notes' badges: list [{ n (the pick's number), label (its number in the list) }].
export function markScript(list) {
  const safe = (list ?? []).map((x) => ({ n: Math.floor(Number(x.n)) || 0, label: Math.floor(Number(x.label)) || 0 }));
  return `(function () { return !!(window.__dockPick && window.__dockPick.mark(${JSON.stringify(safe)})); })()`;
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

function pickOf(o) {
  if (!o || typeof o !== "object" || typeof o.selector !== "string" || !o.selector) return null;
  const b = o.box;
  const box = b && typeof b === "object" && ["x", "y", "w", "h"].every((k) => Number.isFinite(b[k])) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  const s = o.source;
  const source = s && typeof s === "object" && typeof s.file === "string" && s.file && Number.isFinite(s.line) ? { file: s.file, line: s.line } : null;
  return { n: Number.isFinite(o.n) ? o.n : 0, selector: str(o.selector, 400), text: str(o.text, TEXT_MAX), tag: str(o.tag, 40), box, source };
}

// eval's output as the value the script returned (plain output prints it JSON-quoted; --json wraps it).
function evalValue(text) {
  let v;
  try { v = JSON.parse(String(text ?? "")); } catch { return undefined; }
  if (v && typeof v === "object" && !Array.isArray(v) && v.data && "result" in v.data) v = v.data.result;
  return v;
}

// READ_PICKS' output: the picks, and whether the script was in the page.
export function readResult(text) {
  const v = evalValue(text);
  if (v === "absent" || v === undefined) return { present: false, picks: [] };
  return { present: true, picks: parsePicks(text) };
}

// probeScript's output, or null.
export function parseProbe(text) {
  let v = evalValue(text);
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object") return null;
  return { present: v.present === true, off: v.off === true, frame: v.frame === true };
}

// What a press does while pointing: "send" (to the page, where the script takes the click), "frame" (the frame was
// picked by the probe; nothing goes to the page), "absent" (the script isn't there: nothing goes to the page).
export function pointerGate(probe) {
  if (!probe?.present) return "absent";
  return probe.frame ? "frame" : "send";
}

// The picks READ_PICKS returned, from `agent-browser eval`'s output (plain: the JSON string printed JSON-quoted; or
// the --json envelope). Anything unreadable is no picks; bad entries are dropped.
export function parsePicks(text) {
  let v;
  try { v = JSON.parse(String(text ?? "")); } catch { return []; }
  if (v && typeof v === "object" && !Array.isArray(v) && v.data && "result" in v.data) v = v.data.result;
  for (let i = 0; i < 2 && typeof v === "string"; i++) { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return v.map(pickOf).filter(Boolean);
}
