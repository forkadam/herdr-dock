import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSession, saveSession, resetSession, isDirty, readBrowserStatus, setBrowser } from "../src/mods/dock-config/session.js";
import { applyEdit, draftFromConfig, formatConfig } from "../src/shared/edit.js";
import { turnOnChrome } from "../src/mods/dock-config/browser-view.js";

const HOST = "forkadam-pc";
const CFG = "C:/repo/config/dock.json";
const HOME = "C:/home/app";
const LOCAL = `${HOME}/herdr-dock/local.json`;
const text = readFileSync(new URL("./fixtures/dock.json", import.meta.url), "utf8");
const EMPTY = formatConfig({ v: 1, regions: {} });
const localText = (regions, extra = {}) => JSON.stringify({ v: 1, regions, ...extra }, null, 2);
const SHARED = { "dock.config.path": CFG, "dock.config.localPath": LOCAL, "dock.host": HOST };

// The dialog must never write config/dock.json: a write there fails the test.
function fakeIo({ file = text, local = null, shared = SHARED, extra = {}, listing } = {}) {
  const files = new Map([[CFG, file], ...(local === null ? [] : [[LOCAL, local]]), ...Object.entries(extra)]);
  const writes = [];
  const io = {
    appHome: HOME,
    platform: "windows",
    shared: (k) => shared[k],
    readTextFile: async (p) => files.get(p) ?? null,
    writeTextFile: async (p, t, expected) => {
      assert.notEqual(p, CFG, "the dialog wrote config/dock.json");
      if ((files.get(p) ?? null) !== expected) throw new Error("changed");
      files.set(p, t);
      writes.push(p);
    },
    exec: listing ?? (async () => ({ code: 0, stdout: "files\nagents\n" })),
  };
  return { io, files, writes };
}
const sized = (s, v) => ({ ...s, draft: applyEdit(s.draft, { type: "size", region: "left", value: v }).draft });
const withHost = (regions) => {
  const c = JSON.parse(text);
  c.machines = { [HOST]: { regions } };
  return JSON.stringify(c, null, 2);
};

test("load, save a size edit: only the local file is written, and the session is clean", async () => {
  const { io, files, writes } = fakeIo();
  let s = await loadSession(io);
  assert.equal(s.readOnly, false);
  assert.equal(s.opened, null);
  assert.equal(s.baseText, text);
  assert.equal(isDirty(s), false);
  s = await saveSession(sized(s, 300), io);
  assert.equal(s.error, null);
  assert.deepEqual(writes, [LOCAL]);
  assert.equal(files.get(CFG), text);
  assert.deepEqual(JSON.parse(files.get(LOCAL)), { v: 1, regions: { left: { size: 300 } } });
  assert.equal(s.opened, files.get(LOCAL));
  assert.equal(isDirty(s), false);
});

test("the draft is base + machines.<host> + local; the save diffs against base + machines.<host>", async () => {
  const c = JSON.parse(text);
  c.machines = { [HOST]: { regions: { top: { size: 50 } } }, other: { regions: { top: { size: 99 } } } };
  const cfg = JSON.stringify(c, null, 2);
  const { io, files } = fakeIo({ file: cfg, local: localText({ right: { size: 410 } }) });
  let s = await loadSession(io);
  assert.equal(s.draft.regions.top.size, 50);
  assert.equal(s.draft.regions.right.size, 410);
  s = await saveSession(sized(s, 300), io);
  assert.equal(s.error, null);
  assert.equal(files.get(CFG), cfg);
  assert.deepEqual(JSON.parse(files.get(LOCAL)).regions, { left: { size: 300 }, right: { size: 410 } });
  assert.equal(isDirty(s), false);
});

test("a save matching the base writes empty regions to the local file", async () => {
  const { io, files } = fakeIo({ local: localText({ left: { size: 300 } }) });
  let s = await loadSession(io);
  s = await saveSession(sized(s, JSON.parse(text).regions.left.size), io);
  assert.equal(s.error, null);
  assert.equal(files.get(LOCAL), EMPTY);
  assert.equal(isDirty(s), false);
});

test("hand edit to the local file: the refused write keeps it, then a second save succeeds", async () => {
  const { io, files } = fakeIo({ local: localText({}) });
  const s = sized(await loadSession(io), 300);
  const hand = localText({ right: { size: 400 } });
  files.set(LOCAL, hand);
  const r = await saveSession(s, io);
  assert.equal(files.get(LOCAL), hand);
  assert.match(r.notice, /changed on disk/);
  assert.equal(r.draft.regions.left.size, 300);
  assert.equal(r.draft.regions.right.size, 400);
  assert.equal(r.opened, hand);
  const r2 = await saveSession(r, io);
  assert.equal(r2.error, null);
  assert.deepEqual(JSON.parse(files.get(LOCAL)).regions, { left: { size: 300 }, right: { size: 400 } });
  assert.equal(files.get(CFG), text);
});

test("a local file created under the dialog is a conflict, not overwritten", async () => {
  const { io, files } = fakeIo();
  const s = sized(await loadSession(io), 300);
  const hand = localText({ top: { size: 60 } });
  files.set(LOCAL, hand);
  const r = await saveSession(s, io);
  assert.equal(files.get(LOCAL), hand);
  assert.match(r.notice, /changed on disk/);
  assert.equal(r.draft.regions.top.size, 60);
  assert.equal(r.draft.regions.left.size, 300);
});

test("the shared config changed under the dialog: rebased, nothing written, a second save diffs against it", async () => {
  const { io, files, writes } = fakeIo();
  const s = sized(await loadSession(io), 300);
  const hand = JSON.parse(text);
  hand.regions.bottom.features.push({ mod: "files" });
  files.set(CFG, JSON.stringify(hand, null, 2));
  const r = await saveSession(s, io);
  assert.deepEqual(writes, []);
  assert.match(r.notice, /changed on disk/);
  assert.equal(r.baseText, files.get(CFG));
  assert.deepEqual(r.draft.regions.bottom.features.map((f) => f.mod), ["workspace-status", "files"]);
  const r2 = await saveSession(r, io);
  assert.equal(r2.error, null);
  assert.deepEqual(JSON.parse(files.get(LOCAL)).regions, { left: { size: 300 } });
});

test("invalid shared config is read-only with a hand-fix message", async () => {
  const { io } = fakeIo({ file: "{ nope" });
  const s = await loadSession(io);
  assert.equal(s.readOnly, true);
  assert.match(s.error, /fix config\/dock\.json by hand/);
});

test("invalid local file is read-only with its error", async () => {
  const { io } = fakeIo({ local: "{ nope" });
  const s = await loadSession(io);
  assert.equal(s.readOnly, true);
  assert.match(s.error, /local\.json: Invalid JSON/);
  assert.ok(s.error.includes(LOCAL));
  const { io: io2 } = fakeIo({ local: localText({ top: { hidden: true } }) });
  const s2 = await loadSession(io2);
  assert.equal(s2.readOnly, true);
  assert.match(s2.error, /local\.json: regions\.top\.hidden/);
});

test("invalid file shows the applied regions when shared", async () => {
  const applied = JSON.parse(text).regions;
  applied.left.hidden = false;
  for (const bad of [{ file: "{ nope" }, { local: "{ nope" }]) {
    const { io } = fakeIo({ ...bad, shared: { ...SHARED, "dock.config.applied": applied } });
    const s = await loadSession(io);
    assert.deepEqual(s.draft, { regions: { pages: { features: [], hidden: false }, ...applied } });
  }
});

test("missing shared keys fall back to source.json and the app home's local file", async () => {
  const src = JSON.stringify({ config: ["C:", "repo", "config", "dock.json"].join(String.fromCharCode(92)), hostname: "ForkAdam-PC" });
  const { io } = fakeIo({ shared: {}, local: localText({ left: { size: 333 } }), extra: { [`${HOME}/mods/dock-core/source.json`]: src } });
  const s = await loadSession(io);
  assert.equal(s.path, CFG);
  assert.equal(s.localPath, LOCAL);
  assert.equal(s.host, HOST);
  assert.equal(s.readOnly, false);
  assert.equal(s.draft.regions.left.size, 333);
});

test("no host is read-only", async () => {
  const { io } = fakeIo({ shared: { "dock.config.path": CFG, "dock.config.localPath": LOCAL } });
  const s = await loadSession(io);
  assert.equal(s.readOnly, true);
  assert.match(s.error, /hostname is unknown/);
});

test("listing failures fall back to installed.json with a notice", async () => {
  const installed = JSON.stringify({ tabs: {}, "layout:main": {}, files: {} });
  for (const listing of [
    async () => { throw new Error("boom"); },
    async () => ({ code: 1, stdout: "files\n" }),
    async () => ({ code: 0, stdout: "" }),
  ]) {
    const { io } = fakeIo({ listing, extra: { [`${HOME}/installed.json`]: installed } });
    const s = await loadSession(io);
    assert.equal(s.notice, "mod list may be incomplete");
    const ids = s.inventory.map((i) => i.id);
    assert.ok(ids.includes("tabs") && ids.includes("files"));
    assert.ok(!ids.includes("layout:main"));
  }
});

test("reset empties the local file (no delete API) and keeps machines.<host>", async () => {
  const cfg = withHost({ top: { size: 50 } });
  const { io, files } = fakeIo({ file: cfg });
  let s = await saveSession(sized(await loadSession(io), 300), io);
  s = await resetSession(s, io);
  assert.equal(s.error, null);
  assert.equal(files.get(LOCAL), EMPTY);
  assert.equal(files.get(CFG), cfg);
  assert.equal(s.draft.regions.left.size, JSON.parse(text).regions.left.size);
  assert.equal(s.draft.regions.top.size, 50);
  assert.equal(isDirty(s), false);
});

test("reset keeps the local browser block, production hosts included, and drops the layout edits", async () => {
  const browser = { enabled: true, chrome: "/c", production: ["b.com"] };
  const { io, files } = fakeIo({ local: localText({ left: { size: 300 } }, { browser }) });
  let s = await loadSession(io);
  assert.deepEqual(s.draft.production, ["b.com"]);
  s = await resetSession(s, io);
  assert.equal(s.error, null);
  assert.equal(files.get(LOCAL), formatConfig({ v: 1, regions: {}, browser }));
  assert.equal(s.draft.regions.left.size, JSON.parse(text).regions.left.size);
  assert.deepEqual(s.draft.production, ["b.com"]);
  assert.equal(isDirty(s), false);
});

test("reset with no local file and a dirty draft discards the edits", async () => {
  const base = JSON.parse(text);
  delete base.machines;
  const { io, files } = fakeIo({ file: JSON.stringify(base, null, 2) });
  let s = sized(await loadSession(io), 300);
  assert.equal(isDirty(s), true);
  s = await resetSession(s, io);
  assert.equal(s.error, null);
  assert.deepEqual(s.draft, draftFromConfig(base, HOST));
  assert.equal(isDirty(s), false);
  assert.equal(files.get(LOCAL), EMPTY);
});

test("reset onto a local file changed on disk is a conflict", async () => {
  const { io, files } = fakeIo({ local: localText({ left: { size: 300 } }) });
  const s = await loadSession(io);
  const hand = localText({ left: { size: 310 } });
  files.set(LOCAL, hand);
  const r = await resetSession(s, io);
  assert.equal(files.get(LOCAL), hand);
  assert.match(r.notice, /changed on disk/);
  assert.equal(r.draft.regions.left.size, 310);
});

test("conflict: a hand edit to this PC's local file survives; the user's edit is re-applied", async () => {
  const { io, files } = fakeIo({ local: localText({ top: { size: 50 } }) });
  const s = sized(await loadSession(io), 300);
  files.set(LOCAL, localText({ top: { size: 60 } }));
  const r = await saveSession(s, io);
  assert.match(r.notice, /changed on disk/);
  assert.equal(r.draft.regions.top.size, 60);
  assert.equal(r.draft.regions.left.size, 300);
  const r2 = await saveSession(r, io);
  assert.equal(r2.error, null);
  assert.deepEqual(JSON.parse(files.get(LOCAL)).regions, { top: { size: 60 }, left: { size: 300 } });
  assert.equal(isDirty(r2), false);
});

test("conflict: a changed feature list is re-applied whole", async () => {
  const { io, files } = fakeIo({ local: localText({}) });
  let s = await loadSession(io);
  s = { ...s, draft: applyEdit(s.draft, { type: "place", mod: "files", region: "right" }).draft };
  files.set(LOCAL, localText({ right: { size: 400 } }));
  const r = await saveSession(s, io);
  assert.deepEqual(r.draft.regions.right.features, [{ mod: "files" }]);
  assert.equal(r.draft.regions.right.size, 400);
});

test("isDirty is false after saving a left mode the base doesn't set", async () => {
  const base = JSON.parse(text);
  delete base.regions.left.mode;
  const { io } = fakeIo({ file: JSON.stringify(base, null, 2) });
  let s = await loadSession(io);
  s = { ...s, draft: applyEdit(s.draft, { type: "mode", value: "icons" }).draft };
  assert.equal(isDirty(s), true);
  s = await saveSession(s, io);
  assert.equal(s.error, null);
  assert.equal(isDirty(s), false);
});

test("isDirty is false after saving a size on a region without one", async () => {
  const base = JSON.parse(text);
  delete base.regions.right.size;
  const { io } = fakeIo({ file: JSON.stringify(base, null, 2) });
  let s = await loadSession(io);
  s = { ...s, draft: applyEdit(s.draft, { type: "size", region: "right", value: 200 }).draft };
  s = await saveSession(s, io);
  assert.equal(s.error, null);
  assert.equal(isDirty(s), false);
});

test("an unknown key in the local file's region is kept on save and isDirty is right", async () => {
  const { io, files } = fakeIo({ local: localText({ top: { size: 50, note: "mine" } }) });
  let s = sized(await loadSession(io), 300);
  s = await saveSession(s, io);
  assert.equal(s.error, null);
  assert.equal(JSON.parse(files.get(LOCAL)).regions.top.note, "mine");
  assert.equal(isDirty(s), false);
});

test("conflict onto an invalid local file keeps the edits dirty, shows the parse error, and a later save rebases", async () => {
  const { io, files } = fakeIo({ local: localText({}) });
  const s = sized(await loadSession(io), 300);
  files.set(LOCAL, "{ nope");
  const r = await saveSession(s, io);
  assert.equal(r.draft.regions.left.size, 300);
  assert.match(r.error, /local\.json: Invalid JSON/);
  assert.equal(isDirty(r), true);
  const hand = localText({ top: { size: 44 } });
  files.set(LOCAL, hand);
  const r2 = await saveSession(r, io);
  assert.equal(files.get(LOCAL), hand); // nothing written yet
  assert.match(r2.notice, /changed on disk/);
  assert.equal(r2.error, null);
  assert.equal(r2.draft.regions.left.size, 300);
  assert.equal(r2.draft.regions.top.size, 44);
  const r3 = await saveSession(r2, io);
  assert.equal(r3.error, null);
  assert.deepEqual(JSON.parse(files.get(LOCAL)).regions, { top: { size: 44 }, left: { size: 300 } });
});

test("the shared config going missing under the dialog keeps the edits dirty with an error", async () => {
  const { io, files, writes } = fakeIo();
  const s = sized(await loadSession(io), 300);
  files.delete(CFG);
  const r = await saveSession(s, io);
  assert.deepEqual(writes, []);
  assert.equal(r.baseText, null);
  assert.match(r.error, /could not be read/);
  assert.equal(isDirty(r), true);
});

test("a write error with the local file unchanged is reported as itself, not as a conflict", async () => {
  const { io, files } = fakeIo({ local: localText({}) });
  io.writeTextFile = async () => { throw new Error("EPERM: operation not permitted"); };
  const s = sized(await loadSession(io), 300);
  const r = await saveSession(s, io);
  assert.match(r.error, /EPERM/);
  assert.equal(r.notice, null);
  assert.equal(r.opened, localText({}));
  assert.equal(files.get(LOCAL), localText({}));
  assert.equal(isDirty(r), true);
});

test("app install: a missing config path falls back to the shipped mods/dock-core/config.json", async () => {
  const shipped = `${HOME}/mods/dock-core/config.json`;
  const { io } = fakeIo({
    shared: { "dock.host": HOST }, local: localText({ left: { size: 333 } }),
    extra: { [`${HOME}/mods/dock-core/source.json`]: JSON.stringify({ mode: "app" }), [shipped]: text },
  });
  const s = await loadSession(io);
  assert.equal(s.path, shipped);
  assert.equal(s.readOnly, false);
  assert.equal(s.draft.regions.left.size, 333);
});

test("no host in app mode doesn't say npm run deploy", async () => {
  const app = `${HOME}/mods/dock-core/config.json`;
  const { io } = fakeIo({
    shared: { "dock.config.path": app, "dock.config.localPath": LOCAL },
    extra: { [app]: text, [`${HOME}/mods/dock-core/source.json`]: JSON.stringify({ mode: "app" }) },
  });
  const s = await loadSession(io);
  assert.equal(s.readOnly, true);
  assert.match(s.error, /hostname/);
  assert.doesNotMatch(s.error, /npm run deploy/);
});

// The Browser section: its status and Turn on / Turn off / Set up.
const RESULT = `${HOME}/herdr-dock/browser/setup-result.json`;
const MOD = `${HOME}/mods/dock-browser`;
const BIN_WIN = `${HOME}/herdr-dock/browser/bin/agent-browser.exe`;
const REPO = "C:/repo";
// exec: the mods listing, and the node probe of which paths exist (and, on Windows, Program Files' variables).
function browserIo({ present = [], env = {}, mods = "files\nagents\n", probe = "ok", ...rest } = {}) {
  const f = fakeIo({ ...rest, listing: async (command, args) => {
    if (command !== "node") return { code: 0, stdout: mods };
    if (probe === "throw") throw new Error("node: not found");
    if (probe === "fail") return { code: 1, stdout: "", stderr: "boom" };
    const [, , , names, ...paths] = args;
    const vars = Object.fromEntries(names.split(",").filter(Boolean).map((n) => [n, env[n] ?? null]));
    return { code: 0, stdout: JSON.stringify({ env: vars, exists: paths.map((p) => present.includes(p)) }) };
  } });
  f.runs = [];
  f.io.run = (command, args) => f.runs.push([command, args]);
  return f;
}
const set = (o) => ({ chrome: null, mode: "clone", repo: REPO, now: 5, ...o });

test("readBrowserStatus: the merged setting, the files that are there, the result, and the Chrome found", async () => {
  const chrome = "C:/Tools/chrome.exe";
  const found = "C:\\L\\Google\\Chrome\\Application\\chrome.exe";
  const { io, files } = browserIo({
    local: localText({}, { browser: { enabled: true, chrome } }),
    present: [MOD, BIN_WIN, chrome, found],
    env: { ProgramFiles: "C:\\PF", LOCALAPPDATA: "C:\\L" },
  });
  files.set(RESULT, JSON.stringify({ state: "ok", at: 3, action: "on", message: "" }));
  const s = await loadSession(io);
  assert.deepEqual(await readBrowserStatus(s, io), {
    enabled: true, chrome, localChrome: chrome, sharedChrome: "", modInstalled: true, binInstalled: true, chromeExists: true, found,
    result: { state: "ok", at: 3, action: "on", message: "" }, problem: null,
  });
});

test("readBrowserStatus: off by default; macOS paths; no result", async () => {
  const chromium = "/Applications/Chromium.app/Contents/MacOS/Chromium";
  const { io } = browserIo({ present: [chromium] });
  io.platform = "macos";
  const s = await loadSession(io);
  assert.deepEqual(await readBrowserStatus(s, io), {
    enabled: false, chrome: "", localChrome: null, sharedChrome: "", modInstalled: false, binInstalled: false, chromeExists: false,
    found: chromium, result: null, problem: null,
  });
});

test("readBrowserStatus: a Chrome set in config/dock.json is the setting, but not this PC's local one", async () => {
  const c = JSON.parse(text);
  c.browser = { enabled: true, chrome: "/shared/chrome" };
  const { io } = browserIo({ file: JSON.stringify(c, null, 2), present: ["/shared/chrome"] });
  io.platform = "linux";
  const st = await readBrowserStatus(await loadSession(io), io);
  assert.equal(st.enabled, true);
  assert.equal(st.chrome, "/shared/chrome");
  assert.equal(st.localChrome, null);
  assert.equal(st.sharedChrome, "/shared/chrome");
  assert.equal(st.chromeExists, true);
  assert.equal(st.found, null);
});

test("readBrowserStatus: sharedChrome is the shared config's with machines.<host>, without this PC's file", async () => {
  const c = JSON.parse(text);
  c.machines = { [HOST]: { regions: {}, browser: { chrome: "/host/chrome" } } };
  const { io } = browserIo({ file: JSON.stringify(c, null, 2), local: localText({}, { browser: { chrome: "" } }) });
  const st = await readBrowserStatus(await loadSession(io), io);
  assert.equal(st.sharedChrome, "/host/chrome");
  assert.equal(st.chrome, "");
  assert.equal(st.localChrome, "");
});

test("setBrowser on with the download over a shared Chrome writes an empty chrome, which wins in the merge", async () => {
  const c = JSON.parse(text);
  c.browser = { chrome: "/shared/chrome" };
  const { io, files } = browserIo({ file: JSON.stringify(c, null, 2) });
  const s = await loadSession(io);
  const st = await readBrowserStatus(s, io);
  const r = await setBrowser(s, io, set({ action: "on", chrome: turnOnChrome(null, st.sharedChrome) }));
  assert.equal(r.ran, true);
  assert.deepEqual(JSON.parse(files.get(LOCAL)).browser, { enabled: true, chrome: "" });
  const after = await readBrowserStatus(r.session, io);
  assert.equal(after.chrome, "");
  assert.equal(after.localChrome, "");
});

test("readBrowserStatus: a probe that can't run says so and finds nothing", async () => {
  for (const probe of ["throw", "fail"]) {
    const { io } = browserIo({ probe, local: localText({}, { browser: { enabled: true } }) });
    const st = await readBrowserStatus(await loadSession(io), io);
    assert.equal(st.enabled, true);
    assert.equal(st.modInstalled, false);
    assert.equal(st.binInstalled, false);
    assert.equal(st.found, null);
    assert.match(st.problem, /couldn't check/);
  }
});

test("readBrowserStatus: a read-only session goes by the applied regions", async () => {
  const applied = JSON.parse(text).regions;
  applied.left.hidden = false;
  applied.right.features = [{ mod: "dock-browser" }];
  const { io } = browserIo({ file: "{ nope", shared: { ...SHARED, "dock.config.applied": applied } });
  const s = await loadSession(io);
  assert.equal(s.readOnly, true);
  assert.equal((await readBrowserStatus(s, io)).enabled, true);
});

test("loadSession: the install mode, and dock-browser listed only while the browser is on", async () => {
  const off = browserIo({ mods: "files\ndock-browser\n" });
  const s = await loadSession(off.io);
  assert.equal(s.browserEnabled, false);
  assert.ok(!s.inventory.some((i) => i.id === "dock-browser"));
  const on = browserIo({ mods: "files\ndock-browser\n", local: localText({}, { browser: { enabled: true } }) });
  const s2 = await loadSession(on.io);
  assert.equal(s2.browserEnabled, true);
  assert.equal(s2.inventory.find((i) => i.id === "dock-browser").installed, true);
  const app = `${HOME}/mods/dock-core/config.json`;
  const { io } = browserIo({ shared: { "dock.host": HOST }, extra: { [app]: text, [`${HOME}/mods/dock-core/source.json`]: JSON.stringify({ mode: "app" }) } });
  assert.equal((await loadSession(io)).mode, "app");
});

test("setBrowser on: only the browser keys are written, unsaved edits stay unsaved, dock-browser joins the draft, the start is recorded and the tab opens", async () => {
  const { io, files, writes, runs } = browserIo({ mods: "files\ndock-browser\n", local: localText({ top: { size: 50 } }, { note: "mine" }) });
  let s = sized(await loadSession(io), 300);
  s = { ...s, draft: applyEdit(s.draft, { type: "production", hosts: ["x.com"] }).draft };
  const r = await setBrowser(s, io, set({ action: "on", chrome: "/c" }));
  assert.equal(r.ran, true);
  assert.equal(r.recorded, true);
  assert.deepEqual(writes, [LOCAL, RESULT]);
  assert.deepEqual(JSON.parse(files.get(LOCAL)), { v: 1, regions: { top: { size: 50 } }, note: "mine", browser: { enabled: true, chrome: "/c" } });
  assert.equal(files.get(CFG), text);
  assert.equal(r.session.opened, files.get(LOCAL));
  assert.equal(r.session.notice, null);
  assert.equal(r.session.error, null);
  // The edits are still in the draft, unsaved; the browser is in the base and the draft.
  assert.equal(r.session.draft.regions.left.size, 300);
  assert.deepEqual(r.session.draft.production, ["x.com"]);
  assert.equal(isDirty(r.session), true);
  assert.deepEqual(r.session.draft.regions.right.features, [{ mod: "dock-browser" }]);
  assert.deepEqual(r.session.baseDraft.regions.right.features, [{ mod: "dock-browser" }]);
  assert.equal(r.session.baseDraft.regions.left.size, JSON.parse(text).regions.left.size);
  assert.equal(r.session.browserEnabled, true);
  assert.ok(r.session.inventory.some((i) => i.id === "dock-browser" && i.installed));
  assert.deepEqual(JSON.parse(files.get(RESULT)), { state: "running", startedAt: 5, action: "on" });
  assert.deepEqual(runs, [["tab.new", { name: "Set up the browser", folder: REPO, argv: ["npm", "run", "deploy"] }]]);
  // A later Save writes the edits and keeps the browser block.
  const saved = await saveSession(r.session, io);
  assert.equal(saved.error, null);
  const after = JSON.parse(files.get(LOCAL));
  assert.equal(after.regions.left.size, 300);
  assert.deepEqual(after.browser, { enabled: true, chrome: "/c", production: ["x.com"] });
  assert.equal(isDirty(saved), false);
});

test("setBrowser: a local file changed on disk is refused like Save — rebased, the changed-on-disk notice, nothing run", async () => {
  const { io, files, writes, runs } = browserIo({ local: localText({}) });
  const s = sized(await loadSession(io), 300);
  const hand = localText({ top: { size: 60 } });
  files.set(LOCAL, hand);
  const r = await setBrowser(s, io, set({ action: "on" }));
  assert.equal(r.ran, false);
  assert.equal(files.get(LOCAL), hand);
  assert.match(r.session.notice, /changed on disk/);
  assert.equal(r.session.opened, hand);
  assert.equal(r.session.draft.regions.left.size, 300);
  assert.equal(r.session.draft.regions.top.size, 60);
  assert.deepEqual(writes, []);
  assert.deepEqual(runs, []);
  assert.equal(files.has(RESULT), false);
});

test("setBrowser: a start result that can't be written still opens the tab, and says it wasn't recorded", async () => {
  const { io, files, runs } = browserIo();
  const write = io.writeTextFile;
  io.writeTextFile = async (p, t, expected) => {
    if (p === RESULT) throw new Error("No such file or directory");
    return write(p, t, expected);
  };
  const r = await setBrowser(await loadSession(io), io, set({ action: "on" }));
  assert.equal(r.ran, true);
  assert.equal(r.recorded, false);
  assert.equal(r.session.error, null);
  assert.deepEqual(JSON.parse(files.get(LOCAL)), { v: 1, regions: {}, browser: { enabled: true } });
  assert.equal(runs.length, 1);
});

test("setBrowser off: the Chrome passed through stays, dock-browser leaves the draft even from an edited right region", async () => {
  const browser = { enabled: true, chrome: "/c", production: ["a.com"] };
  const { io, files, runs } = browserIo({ mods: "files\ndock-browser\n", local: localText({}, { browser }) });
  let s = await loadSession(io);
  assert.deepEqual(s.draft.regions.right.features, [{ mod: "dock-browser" }]);
  s = { ...s, draft: applyEdit(s.draft, { type: "place", mod: "files", region: "right" }).draft };
  const r = await setBrowser(s, io, set({ action: "off", chrome: "/c" }));
  assert.equal(r.ran, true);
  assert.deepEqual(JSON.parse(files.get(LOCAL)).browser, { enabled: false, chrome: "/c", production: ["a.com"] });
  assert.deepEqual(r.session.draft.regions.right.features, [{ mod: "files" }]);
  assert.equal(r.session.browserEnabled, false);
  assert.ok(!r.session.inventory.some((i) => i.id === "dock-browser"));
  assert.equal(isDirty(r.session), true);
  assert.deepEqual(JSON.parse(files.get(RESULT)), { state: "running", startedAt: 5, action: "off" });
  assert.equal(runs.length, 1);
});

test("setBrowser setup: enabled stays on and the start is an on run", async () => {
  const { io, files } = browserIo({ local: localText({}, { browser: { enabled: true } }) });
  const r = await setBrowser(await loadSession(io), io, set({ action: "setup" }));
  assert.equal(r.ran, true);
  assert.deepEqual(JSON.parse(files.get(LOCAL)).browser, { enabled: true });
  assert.equal(JSON.parse(files.get(RESULT)).action, "on");
  assert.equal(isDirty(r.session), false);
});

test("setBrowser in an app install runs the shipped setup script from the app home", async () => {
  const { io, runs } = browserIo();
  const r = await setBrowser(await loadSession(io), io, set({ action: "on", mode: "app", repo: null }));
  assert.equal(r.ran, true);
  assert.deepEqual(runs, [["tab.new", { name: "Set up the browser", folder: HOME, argv: ["node", `${HOME}/mods/dock-browser/herdr-browser-setup.mjs`] }]]);
});

test("setBrowser writes and runs nothing when read-only, or a clone's folder is unknown", async () => {
  const ro = browserIo({ file: "{ nope" });
  const s = await loadSession(ro.io);
  const r = await setBrowser(s, ro.io, set({ action: "on" }));
  assert.equal(r.ran, false);
  assert.equal(r.session, s);
  assert.deepEqual(ro.writes, []);
  const { io, writes, runs } = browserIo();
  const r2 = await setBrowser(await loadSession(io), io, set({ action: "on", mode: null, repo: null }));
  assert.equal(r2.ran, false);
  assert.match(r2.session.error, /npm run deploy/);
  assert.deepEqual(writes, []);
  assert.deepEqual(runs, []);
});
