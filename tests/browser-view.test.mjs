import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserRun, browserSection, chosenChrome, chromeCandidates, chromeChoices, chromeName, clickedResult, parseHosts, parseProbe,
  probeCommand, sectionCopy, turnOnChrome, withBrowserSetting,
} from "../src/mods/dock-config/browser-view.js";
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

test("clickedResult: a click whose start wasn't recorded runs until the file shows a newer run", () => {
  const clicked = { at: t0, action: "on" };
  assert.equal(clickedResult(null, null), null);
  const ok = endResult("on", "ok", "", t0 - 5);
  assert.equal(clickedResult(ok, null), ok);
  // An older result (or none): the click counts as a run started then.
  assert.deepEqual(clickedResult(null, clicked), startResult("on", t0));
  assert.deepEqual(clickedResult(ok, clicked), startResult("on", t0));
  assert.deepEqual(clickedResult(startResult("on", t0 - 1), { at: t0, action: "off" }), startResult("off", t0));
  // A run that started, or ended, at or after the click is the file's own.
  const started = startResult("on", t0 + 2);
  assert.equal(clickedResult(started, clicked), started);
  const ended = endResult("on", "failed", "x", t0 + 9);
  assert.equal(clickedResult(ended, clicked), ended);
  // An outcome with no time can't be placed after the click.
  assert.deepEqual(clickedResult({ state: "ok", action: "on" }, clicked), startResult("on", t0));
});

test("clickedResult: the click is abandoned like any run, 15 minutes on", () => {
  const r = clickedResult(null, { at: t0, action: "on" });
  assert.equal(s({ result: r, now: t0 + ABANDON_MS - 1 }).state, "running");
  assert.deepEqual(s({ result: r, now: t0 + ABANDON_MS }), { state: "failed", action: "setup", busy: false, message: "the setup tab was closed or stopped" });
});

test("chromeName: a readable name for a Chrome path", () => {
  assert.equal(chromeName("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "Google Chrome");
  assert.equal(chromeName("/Applications/Chromium.app/Contents/MacOS/Chromium"), "Chromium");
  assert.equal(chromeName("/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"), "Google Chrome Canary");
  assert.equal(chromeName("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"), "Google Chrome");
  assert.equal(chromeName("/usr/bin/google-chrome-stable"), "Google Chrome");
  assert.equal(chromeName("/usr/bin/chromium-browser"), "Chromium");
  assert.equal(chromeName("/snap/bin/chromium"), "Chromium");
  assert.equal(chromeName("/opt/brave/brave"), "brave");
  assert.equal(chromeName(""), "");
});

test("chromeChoices: the settings' Chrome when it exists, else the one found, and always the download", () => {
  const download = { value: null, label: "Download Chrome for Testing" };
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  assert.deepEqual(chromeChoices({ chrome: "", chromeExists: false, found: mac }), [{ value: mac, label: "Google Chrome (found on this PC)" }, download]);
  assert.deepEqual(chromeChoices({ chrome: "/opt/c/chromium", chromeExists: true, found: mac }), [{ value: "/opt/c/chromium", label: "Chromium (from your settings)" }, download]);
  assert.deepEqual(chromeChoices({ chrome: "/gone/chromium", chromeExists: false, found: mac }), [{ value: mac, label: "Google Chrome (found on this PC)" }, download]);
  assert.deepEqual(chromeChoices({ chrome: "", chromeExists: false, found: null }), [download]);
});

test("chosenChrome: the person's pick while it is still offered, else the first choice", () => {
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const choices = chromeChoices({ chrome: "", chromeExists: false, found: mac });
  assert.equal(chosenChrome(choices, undefined), mac);
  assert.equal(chosenChrome(choices, null), null);
  assert.equal(chosenChrome(choices, mac), mac);
  assert.equal(chosenChrome(choices, "/gone"), mac);
  assert.equal(chosenChrome(chromeChoices({ chrome: "", chromeExists: false, found: null }), mac), null);
});

const copy = (section, status = {}) => sectionCopy(section, { chrome: "", modInstalled: false, binInstalled: false, result: null, ...status });

test("sectionCopy: the sketch's words in each state", () => {
  assert.deepEqual(copy({ state: "off", action: "on", message: "" }), {
    head: "○ Off", tone: "dim", intro: "Let agents open and drive a real browser beside the terminal.",
    note: "Turning it on downloads agent-browser (~20 MB) and, without a Chrome, Chrome for Testing (~150 MB).",
    button: { label: "Turn on", action: "on", primary: true }, secondary: null, chrome: true, hosts: false,
  });
  const on = copy({ state: "on", action: "off", message: "" }, { chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  assert.equal(on.head, "● On · Google Chrome");
  assert.equal(on.tone, "ok");
  assert.deepEqual(on.button, { label: "Turn off", action: "off", primary: false });
  assert.equal(on.hosts, true);
  assert.equal(on.chrome, false);
  assert.equal(copy({ state: "on", action: "off", message: "" }).head, "● On · Chrome for Testing");
  const notSetUp = copy({ state: "notSetUp", action: "setup", message: "" }, { modInstalled: true });
  assert.equal(notSetUp.head, "● On · not set up (agent-browser missing)");
  assert.deepEqual(notSetUp.button, { label: "Set up", action: "setup", primary: true });
  assert.equal(copy({ state: "notSetUp", action: "setup", message: "" }, { binInstalled: true }).head, "● On · not set up (dock-browser missing)");
  assert.equal(copy({ state: "notSetUp", action: "setup", message: "" }).head, "● On · not set up (dock-browser and agent-browser missing)");
});

test("sectionCopy: running says which way and where to look, with no button", () => {
  const up = copy({ state: "running", action: null, message: "" }, { result: startResult("on", t0) });
  assert.equal(up.head, 'Setting up… see the "Set up the browser" tab');
  assert.equal(up.button, null);
  assert.equal(up.hosts, false);
  assert.equal(copy({ state: "running", action: null, message: "" }, { result: startResult("off", t0) }).head, 'Turning off… see the "Set up the browser" tab');
});

test("sectionCopy: failed shows its message, or where to look when it has none; unsupported says so", () => {
  const failed = copy({ state: "failed", action: "setup", message: "Chrome couldn't be set up" });
  assert.equal(failed.head, "Setup failed: Chrome couldn't be set up");
  assert.equal(failed.tone, "bad");
  assert.deepEqual(failed.button, { label: "Set up again", action: "setup", primary: true });
  assert.equal(copy({ state: "failed", action: "setup", message: "" }).head, 'Setup failed — see the "Set up the browser" tab');
  assert.deepEqual(copy({ state: "failed", action: "off", message: "x" }).button, { label: "Turn off", action: "off", primary: false });
  const unsupported = copy({ state: "unsupported", action: "off", message: "no agent-browser build for this computer" });
  assert.equal(unsupported.head, "Not available on this computer");
  assert.equal(unsupported.note, "no agent-browser build for this computer");
  assert.deepEqual(unsupported.button, { label: "Turn off", action: "off", primary: false });
});

test("sectionCopy: a failed set-up can also be turned off; every other state has one button", () => {
  const failed = copy({ state: "failed", action: "setup", message: "Chrome couldn't be set up" });
  assert.deepEqual(failed.button, { label: "Set up again", action: "setup", primary: true });
  assert.deepEqual(failed.secondary, { label: "Turn off", action: "off", primary: false });
  assert.deepEqual(copy({ state: "failed", action: "setup", message: "" }).secondary, { label: "Turn off", action: "off", primary: false });
  // A failed turn-off already offers Turn off; Not set up offers only Set up.
  assert.equal(copy({ state: "failed", action: "off", message: "x" }).secondary, null);
  assert.equal(copy({ state: "notSetUp", action: "setup", message: "" }).secondary, null);
  for (const state of ["off", "running", "on", "unsupported"]) assert.equal(copy({ state, action: null, message: "" }).secondary, null, state);
});

test("turnOnChrome: the pick wins — a path, or the download, which overrides a Chrome the shared config sets", () => {
  assert.equal(turnOnChrome("/Applications/Chromium.app/Contents/MacOS/Chromium", ""), "/Applications/Chromium.app/Contents/MacOS/Chromium");
  assert.equal(turnOnChrome("/a", "/shared"), "/a");
  // Download: an empty chrome when the shared config (without this PC's file) sets one, else no chrome key.
  assert.equal(turnOnChrome(null, "/shared/chrome"), "");
  assert.equal(turnOnChrome(null, ""), null);
  assert.equal(turnOnChrome(null, null), null);
  assert.equal(turnOnChrome(null, undefined), null);
});

test("probeCommand runs in node and says which paths exist and what the named variables hold", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  try {
    mkdirSync(join(dir, "mod"));
    writeFileSync(join(dir, "bin"), "x");
    const paths = [join(dir, "mod"), join(dir, "bin"), join(dir, "no such"), join(dir, "-x")];
    const { command, args } = probeCommand(["PROBE_SET", "PROBE_UNSET"], paths);
    assert.equal(command, "node");
    const stdout = execFileSync(process.execPath, args, { env: { ...process.env, PROBE_SET: "C:\\PF" }, encoding: "utf8" });
    const p = parseProbe(stdout, paths);
    assert.deepEqual(p.env, { PROBE_SET: "C:\\PF", PROBE_UNSET: null });
    assert.deepEqual(paths.map((x) => p.exists(x)), [true, true, false, false]);
    const none = probeCommand([], []);
    assert.deepEqual(parseProbe(execFileSync(process.execPath, none.args, { encoding: "utf8" }), []).env, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseProbe: junk is null", () => {
  assert.equal(parseProbe("", []), null);
  assert.equal(parseProbe("{nope", []), null);
  assert.equal(parseProbe('{"env":{}}', ["/a"]), null);
  assert.equal(parseProbe('{"env":{},"exists":[true]}', ["/a", "/b"]), null);
});
