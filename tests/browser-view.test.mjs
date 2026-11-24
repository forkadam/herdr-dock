import test from "node:test";
import assert from "node:assert/strict";
import { browserRun, browserSection, chromeCandidates, parseHosts, withBrowserSetting } from "../src/mods/dock-config/browser-view.js";
import { ABANDON_MS, endResult, startResult } from "../src/shared/browser/setup-result.js";
import { parseLocal } from "../src/shared/config.js";

const t0 = 1_000_000;
const s = (o) => browserSection({ enabled: false, modInstalled: false, binInstalled: false, result: null, updateRunning: false, now: t0, ...o });
const ready = { enabled: true, modInstalled: true, binInstalled: true };

test("browserSection: the design's states", () => {
  assert.deepEqual(s({}), { state: "off", action: "on", busy: false, message: "" });
  assert.equal(s({ result: startResult("on", t0) }).state, "running");
  assert.equal(s({ result: startResult("on", t0) }).busy, true);
  assert.deepEqual(s({ result: startResult("on", t0 - ABANDON_MS) }), { state: "failed", action: "setup", busy: false, message: "the setup tab was closed or stopped" });
  assert.equal(s({ enabled: true, modInstalled: true, binInstalled: true, result: endResult("on", "ok", "", t0) }).state, "on");
  assert.deepEqual(s({ enabled: true, modInstalled: true, binInstalled: true, result: endResult("on", "failed", "Chrome couldn't be set up", t0) }),
    { state: "failed", action: "setup", busy: false, message: "Chrome couldn't be set up" });
  assert.equal(s({ enabled: true, result: endResult("on", "unsupported", "x", t0) }).action, "off");
  assert.equal(s({ enabled: true }).state, "notSetUp");
  assert.equal(s({ updateRunning: true }).busy, true);
});

test("browserSection: running is always shown, with no action, whatever the settings say", () => {
  assert.deepEqual(s({ result: startResult("on", t0) }), { state: "running", action: null, busy: true, message: "" });
  assert.deepEqual(s({ ...ready, result: startResult("off", t0) }), { state: "running", action: null, busy: true, message: "" });
});

test("browserSection: without a result the settings and files decide", () => {
  assert.deepEqual(s({ ...ready }), { state: "on", action: "off", busy: false, message: "" });
  assert.deepEqual(s({ enabled: true, modInstalled: true }), { state: "notSetUp", action: "setup", busy: false, message: "" });
  assert.deepEqual(s({ enabled: true, binInstalled: true }), { state: "notSetUp", action: "setup", busy: false, message: "" });
  assert.deepEqual(s({ enabled: false, modInstalled: true, binInstalled: true }), { state: "off", action: "on", busy: false, message: "" });
});

test("browserSection: a finished result that disagrees with enabled is stale and ignored", () => {
  // Turned on, then turned off by hand: the old failure and the old success say nothing about the section now.
  assert.deepEqual(s({ enabled: false, result: endResult("on", "failed", "Chrome couldn't be set up", t0) }), { state: "off", action: "on", busy: false, message: "" });
  assert.deepEqual(s({ enabled: false, result: endResult("on", "unsupported", "x", t0) }), { state: "off", action: "on", busy: false, message: "" });
  assert.deepEqual(s({ enabled: false, modInstalled: true, binInstalled: true, result: endResult("on", "ok", "", t0) }), { state: "off", action: "on", busy: false, message: "" });
  // Turned off, then turned on by hand.
  assert.deepEqual(s({ ...ready, result: endResult("off", "failed", "could not remove", t0) }), { state: "on", action: "off", busy: false, message: "" });
  assert.deepEqual(s({ enabled: true, result: endResult("off", "unsupported", "x", t0) }), { state: "notSetUp", action: "setup", busy: false, message: "" });
  assert.deepEqual(s({ enabled: true, result: endResult("off", "ok", "", t0) }), { state: "notSetUp", action: "setup", busy: false, message: "" });
});

test("browserSection: a stale result still honours updateRunning", () => {
  assert.deepEqual(s({ enabled: false, updateRunning: true, result: endResult("on", "failed", "x", t0) }), { state: "off", action: "on", busy: true, message: "" });
});

test("browserSection: an abandoned run is shown as failed, and keeps its action", () => {
  const old = t0 - ABANDON_MS;
  assert.deepEqual(s({ result: startResult("off", old) }), { state: "failed", action: "off", busy: false, message: "the setup tab was closed or stopped" });
  assert.deepEqual(s({ ...ready, result: startResult("off", old) }), { state: "failed", action: "off", busy: false, message: "the setup tab was closed or stopped" });
  // Abandoned regardless of enabled: it is not a finished result, so it is never stale.
  assert.deepEqual(s({ ...ready, result: startResult("on", old) }), { state: "failed", action: "setup", busy: false, message: "the setup tab was closed or stopped" });
  assert.equal(s({ updateRunning: true, result: startResult("on", old) }).busy, true);
});

test("browserSection: a failed turn-off offers off, a failed set-up offers setup", () => {
  assert.deepEqual(s({ enabled: false, result: endResult("off", "failed", "could not remove it", t0) }), { state: "failed", action: "off", busy: false, message: "could not remove it" });
  assert.deepEqual(s({ enabled: true, result: endResult("on", "failed", "Chrome couldn't be set up", t0) }), { state: "failed", action: "setup", busy: false, message: "Chrome couldn't be set up" });
});

test("browserSection: unsupported says why and offers off", () => {
  assert.deepEqual(s({ enabled: true, result: endResult("on", "unsupported", "this system has no Chrome build", t0) }),
    { state: "unsupported", action: "off", busy: false, message: "this system has no Chrome build" });
  assert.equal(s({ enabled: true, updateRunning: true, result: endResult("on", "unsupported", "x", t0) }).busy, true);
});

test("browserRun: deploy in a clone, the setup script in an app install", () => {
  assert.deepEqual(browserRun({ mode: "clone", repo: "/r", home: "/h" }).args, { name: "Set up the browser", folder: "/r", argv: ["npm", "run", "deploy"] });
  assert.deepEqual(browserRun({ mode: "app", repo: null, home: "/h" }).args.argv, ["node", "/h/mods/dock-browser/herdr-browser-setup.mjs"]);
});

test("browserRun: the tab command, and the app install runs from the app home", () => {
  assert.deepEqual(browserRun({ mode: "clone", repo: "/r", home: "/h" }).command, "tab.new");
  assert.deepEqual(browserRun({ mode: "app", repo: null, home: "/h" }), {
    command: "tab.new",
    args: { name: "Set up the browser", folder: "/h", argv: ["node", "/h/mods/dock-browser/herdr-browser-setup.mjs"] },
  });
});

test("withBrowserSetting keeps everything else", () => {
  const t = withBrowserSetting('{"v":1,"regions":{"left":{"size":200}},"browser":{"production":["a.com"]}}', { enabled: true, chrome: "/c" });
  assert.deepEqual(JSON.parse(t), { v: 1, regions: { left: { size: 200 } }, browser: { production: ["a.com"], enabled: true, chrome: "/c" } });
  assert.equal(JSON.parse(withBrowserSetting(t, { enabled: false, chrome: null })).browser.chrome, undefined);
  assert.deepEqual(JSON.parse(withBrowserSetting(null, { enabled: true, chrome: null })), { v: 1, regions: {}, browser: { enabled: true } });
});

test("withBrowserSetting: other top-level keys and browser keys stay, the text is the dialog's layout and parses as a local file", () => {
  const before = '{"v":1,"regions":{"right":{"features":[{"mod":"dock-browser"}]}},"note":"hi","browser":{"handoffMinutes":30,"chrome":"/old"}}';
  const text = withBrowserSetting(before, { enabled: true, chrome: "/new" });
  assert.deepEqual(JSON.parse(text), { v: 1, regions: { right: { features: [{ mod: "dock-browser" }] } }, note: "hi", browser: { handoffMinutes: 30, chrome: "/new", enabled: true } });
  assert.ok(text.endsWith("\n"));
  assert.ok(text.includes('{ "mod": "dock-browser" }'), "a feature object stays on one line");
  assert.equal(parseLocal(text).ok, true);
  assert.equal(parseLocal(withBrowserSetting(null, { enabled: false, chrome: null })).ok, true);
});

test("withBrowserSetting: a file with no browser section gets one; null removes only chrome", () => {
  assert.deepEqual(JSON.parse(withBrowserSetting('{"v":1,"regions":{}}', { enabled: true, chrome: null })).browser, { enabled: true });
  const t = withBrowserSetting('{"v":1,"regions":{},"browser":{"enabled":true,"chrome":"/c","production":["a.com"]}}', { enabled: false, chrome: null });
  assert.deepEqual(JSON.parse(t).browser, { enabled: false, production: ["a.com"] });
});

test("withBrowserSetting: enabled is always written as a boolean", () => {
  assert.deepEqual(JSON.parse(withBrowserSetting(null, { chrome: null })).browser, { enabled: false });
});

test("withBrowserSetting throws on text that is not a JSON object, so the user's file is never replaced", () => {
  const set = { enabled: true, chrome: null };
  assert.throws(() => withBrowserSetting("{nope", set), Error);
  assert.throws(() => withBrowserSetting("", set), Error);
  assert.throws(() => withBrowserSetting("[1,2]", set), Error);
  assert.throws(() => withBrowserSetting("42", set), Error);
  assert.throws(() => withBrowserSetting('"text"', set), Error);
  assert.throws(() => withBrowserSetting("null", set), Error);
  assert.throws(() => withBrowserSetting('{"v":1,"regions":{},"browser":"yes"}', set), Error);
});

test("parseHosts", () => {
  assert.deepEqual(parseHosts(" Example.com, *.example.com  shop.example.org "), { ok: true, hosts: ["example.com", "*.example.com", "shop.example.org"] });
  assert.equal(parseHosts("").ok, true);
  assert.equal(parseHosts("http://x.com/path").ok, false);
});

test("parseHosts: empty input is no hosts; one bad host fails the list and names itself", () => {
  assert.deepEqual(parseHosts(""), { ok: true, hosts: [] });
  assert.deepEqual(parseHosts(" , ,\n"), { ok: true, hosts: [] });
  const bad = parseHosts("ok.com, HTTP://x.com:8080/path");
  assert.equal(bad.ok, false);
  assert.equal(typeof bad.error, "string");
  assert.ok(bad.error.includes("http://x.com:8080/path"), bad.error);
  assert.equal(parseHosts("a.com b.com:80").ok, false);
});

test("chromeCandidates per platform", () => {
  assert.equal(chromeCandidates("darwin")[0], "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.deepEqual(chromeCandidates("win32", { ProgramFiles: "C:\\PF" }), ["C:\\PF\\Google\\Chrome\\Application\\chrome.exe"]);
  assert.ok(chromeCandidates("linux").includes("/usr/bin/chromium"));
});

test("chromeCandidates: every candidate, in order", () => {
  assert.deepEqual(chromeCandidates("darwin"), [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ]);
  assert.deepEqual(chromeCandidates("win32", { ProgramFiles: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", LOCALAPPDATA: "C:\\L" }), [
    "C:\\PF\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\PF86\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\L\\Google\\Chrome\\Application\\chrome.exe",
  ]);
  assert.deepEqual(chromeCandidates("win32", {}), []);
  assert.deepEqual(chromeCandidates("win32"), []);
  assert.deepEqual(chromeCandidates("linux"), ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"]);
  assert.deepEqual(chromeCandidates("freebsd"), []);
});
