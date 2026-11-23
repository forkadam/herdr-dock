// The Jira page's settings and token (src/shared/jira/settings.js pure, src/shared/jira/store.js with Herdr's file
// calls handed in). The store is tested on real files with a stand-in for Herdr's readTextFile / writeTextFile.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_BRIEF_BUGS, DEFAULT_CHECK_TASK, DEFAULT_HIGH_PRIORITIES, DEFAULT_SETTINGS, formatSettings, jiraOptions, jiraPaths, normalizeBaseUrl, parseSettings, siteName, validateToken } from "../src/shared/jira/settings.js";
import { clearToken, loadJira, saveSettings, saveToken, syncCurlConfig } from "../src/shared/jira/store.js";
import { curlConfig } from "../src/shared/jira/transport.js";

const POSIX = process.platform !== "win32";

test("siteName and jiraPaths", () => {
  assert.equal(siteName(undefined), "work");
  assert.equal(siteName("Work"), "work");
  assert.equal(siteName("../etc"), "work");
  assert.equal(siteName("acme-2"), "acme-2");
  assert.deepEqual(jiraPaths("C:\\Users\\a\\.config\\herdr-app\\", "work"), {
    dir: "C:/Users/a/.config/herdr-app/herdr-dock",
    settingsPath: "C:/Users/a/.config/herdr-app/herdr-dock/jira-work.json",
    secretsDir: "C:/Users/a/.config/herdr-app/herdr-dock/secrets",
    tokenPath: "C:/Users/a/.config/herdr-app/herdr-dock/secrets/jira-work.token",
    curlConfigPath: "C:/Users/a/.config/herdr-app/herdr-dock/secrets/jira-work.curlrc",
    bodyPath: "C:/Users/a/.config/herdr-app/herdr-dock/secrets/jira-work.body",
  });
  assert.equal(jiraPaths("/home/u/.config/herdr-app", "../x").settingsPath, "/home/u/.config/herdr-app/herdr-dock/jira-work.json");
});

test("normalizeBaseUrl: Jira's base from what people paste", () => {
  const ok = (text, url) => assert.deepEqual(normalizeBaseUrl(text), { ok: true, url }, text);
  ok("https://jira.corp.com", "https://jira.corp.com");
  ok("  https://jira.corp.com/  ", "https://jira.corp.com");
  ok("jira.corp.com", "https://jira.corp.com");
  ok("https://corp.com/jira/browse/WEB-12?focused=1#x", "https://corp.com/jira");
  ok("https://jira.corp.com/secure/Dashboard.jspa", "https://jira.corp.com");
  ok("https://jira.corp.com/projects/WEB/issues", "https://jira.corp.com");
  ok("https://jira.corp.com/issues/?jql=project%3DWEB", "https://jira.corp.com");
  ok("https://jira.corp.com/rest/api/2/myself", "https://jira.corp.com");
  ok("http://127.0.0.1:8089", "http://127.0.0.1:8089");
  for (const bad of ["", "   ", "ftp://jira.corp.com", "https://", "not a url at all"]) assert.equal(normalizeBaseUrl(bad).ok, false, bad);
});

test("validateToken", () => {
  assert.deepEqual(validateToken("  NDk0Mj+abc/=  "), { ok: true, token: "NDk0Mj+abc/=" });
  assert.equal(validateToken("").ok, false);
  assert.equal(validateToken("two words").ok, false);
  assert.match(validateToken("Bearer abc").error, /without "Bearer"/);
});

test("parseSettings: defaults for junk, types checked, unknown keys kept", () => {
  assert.deepEqual(parseSettings(null), { ok: true, settings: DEFAULT_SETTINGS });
  const junk = parseSettings("{ nope");
  assert.equal(junk.ok, false);
  assert.deepEqual(junk.settings, DEFAULT_SETTINGS);
  const s = parseSettings(JSON.stringify({
    v: 1, baseUrl: "https://j", transport: "curl", caFile: "/ca.pem", startTask: "/init-ticket {key}",
    filters: [{ name: "Mine", jql: "assignee = currentUser()" }, { name: "", jql: "x" }, "junk", { name: "No JQL" }],
    note: "kept",
  }));
  assert.equal(s.ok, true);
  assert.equal(s.settings.transport, "curl");
  assert.equal(s.settings.startTask, "/init-ticket {key}");
  assert.deepEqual(s.settings.filters, [{ name: "Mine", jql: "assignee = currentUser()" }]);
  assert.equal(s.settings.note, "kept");
  assert.equal(parseSettings(JSON.stringify({ transport: "carrier pigeon", baseUrl: 3 })).settings.transport, "fetch");
  assert.equal(parseSettings(JSON.stringify({ transport: "carrier pigeon", baseUrl: 3 })).settings.baseUrl, "");
  // Round trip; never a token in it.
  const text = formatSettings({ ...s.settings, token: "secret" });
  assert.ok(!text.includes("secret"));
  assert.deepEqual(parseSettings(text).settings, s.settings);
});

test("jiraOptions: defaults when nothing is set", () => {
  const o = jiraOptions(parseSettings("").settings);
  assert.deepEqual(o, { board: null, highPriorities: ["Highest", "High"], briefBugs: DEFAULT_BRIEF_BUGS, views: [], actions: [], checkTask: DEFAULT_CHECK_TASK, warnings: [] });
});

test("jiraOptions: views, actions, board and priorities, bad entries skipped with a warning each", () => {
  const o = jiraOptions({ board: "12", highPriorities: ["P0", "P1"], views: [
    { id: "sec", name: "Security", jql: "project = SEC", group: "type" },
    { id: "today", name: "Mine", jql: "x" },
    { id: "bugs", name: "Bugs" },
    { id: "sec", name: "Again", jql: "y" },
  ], actions: [{ project: "SEC", start: "/triage {key}" }, { subtask: true, parentType: "Story", finish: "/close {key}" }, { project: "X" }] });
  assert.equal(o.board, 12);
  assert.deepEqual(o.highPriorities, ["P0", "P1"]);
  assert.deepEqual(o.views, [{ id: "sec", name: "Security", jql: "project = SEC", group: "type" }]);
  assert.deepEqual(o.actions[1], { subtask: true, parentType: ["Story"], finish: "/close {key}" });
  assert.equal(o.actions.length, 2);
  assert.deepEqual(o.warnings, [
    'views[1]: "today" is the Today tab\'s id',
    "views[2]: needs a name and a jql",
    'views[3]: the id "sec" is already used',
    "actions[2]: needs a start or a finish",
  ]);
});

test("formatSettings never writes option defaults", () => {
  const text = formatSettings(parseSettings('{"baseUrl":"https://j"}').settings);
  for (const k of ["views", "actions", "board", "highPriorities", "briefBugs", "checkTask"]) assert.ok(!text.includes(`"${k}"`), k);
});

test("jiraOptions: board is a positive whole number or its digits, anything else is null with a warning", () => {
  for (const [given, want] of [[12, 12], ["12", 12], [" 9 ", 9], ["007", 7]]) {
    const o = jiraOptions({ board: given });
    assert.equal(o.board, want, JSON.stringify(given));
    assert.deepEqual(o.warnings, [], JSON.stringify(given));
  }
  for (const bad of [0, -3, 7.5, "0", "-3", "1.5", "abc", "", true, {}, [], 1e300]) {
    const o = jiraOptions({ board: bad });
    assert.equal(o.board, null, JSON.stringify(bad));
    assert.deepEqual(o.warnings, ["board: not a board id"], JSON.stringify(bad));
  }
  assert.deepEqual(jiraOptions({ board: null }).warnings, []);
});

test("jiraOptions: highPriorities falls back to the default for anything but a list of names, and is a copy", () => {
  assert.deepEqual(jiraOptions({ highPriorities: [" P0 ", "P1"] }).highPriorities, ["P0", "P1"]);
  for (const bad of ["High", [], ["P0", ""], ["P0", 3], ["  "], {}, 5, null]) {
    const o = jiraOptions({ highPriorities: bad });
    assert.deepEqual(o.highPriorities, ["Highest", "High"], JSON.stringify(bad));
    assert.deepEqual(o.warnings, [], JSON.stringify(bad));
  }
  jiraOptions({}).highPriorities.push("Low");
  assert.deepEqual(jiraOptions({}).highPriorities, ["Highest", "High"]);
  assert.deepEqual(DEFAULT_HIGH_PRIORITIES, ["Highest", "High"]);
});

test("jiraOptions: briefBugs and checkTask are passed through, blank or non-text gives the defaults", () => {
  const o = jiraOptions({ briefBugs: "  project = X AND type = Bug ", checkTask: "Check {key} against {mine}." });
  assert.equal(o.briefBugs, "project = X AND type = Bug");
  assert.equal(o.checkTask, "Check {key} against {mine}.");
  assert.deepEqual(o.warnings, []);
  for (const bad of ["", "   ", 5, null, ["x"]]) {
    const b = jiraOptions({ briefBugs: bad, checkTask: bad });
    assert.equal(b.briefBugs, DEFAULT_BRIEF_BUGS, JSON.stringify(bad));
    assert.equal(b.checkTask, DEFAULT_CHECK_TASK, JSON.stringify(bad));
    assert.deepEqual(b.warnings, [], JSON.stringify(bad));
  }
});

test("jiraOptions: a view group other than \"type\" becomes null with a warning and the view is kept", () => {
  const o = jiraOptions({ views: [
    { id: "a", name: "A", jql: "j1", group: "status" },
    { id: "b", name: "B", jql: "j2", group: null },
    { id: "c", name: "C", jql: "j3" },
    { id: "d", name: "D", jql: "j4", group: "type" },
  ] });
  assert.deepEqual(o.views, [
    { id: "a", name: "A", jql: "j1", group: null },
    { id: "b", name: "B", jql: "j2", group: null },
    { id: "c", name: "C", jql: "j3", group: null },
    { id: "d", name: "D", jql: "j4", group: "type" },
  ]);
  assert.deepEqual(o.warnings, ['views[0]: group "status" is not "type"']);
});

test("jiraOptions: view ids are lower-case letters, digits and dashes (24 at most); names and jql are trimmed", () => {
  const bad = (i) => `views[${i}]: the id must be lower-case letters, digits and dashes, starting with a letter (24 at most)`;
  const longest = "a" + "b".repeat(23);
  const o = jiraOptions({ views: [
    { id: longest, name: "  Name ", jql: " project = X  " },
    { id: "a-1", name: "N", jql: "j" },
    { id: "Sec", name: "N", jql: "j" },
    { id: "1st", name: "N", jql: "j" },
    { id: "a_b", name: "N", jql: "j" },
    { id: "-x", name: "N", jql: "j" },
    { id: "a" + "b".repeat(24), name: "N", jql: "j" },
    { name: "N", jql: "j" },
    { id: 7, name: "N", jql: "j" },
  ] });
  assert.deepEqual(o.views, [
    { id: longest, name: "Name", jql: "project = X", group: null },
    { id: "a-1", name: "N", jql: "j", group: null },
  ]);
  assert.deepEqual(o.warnings, [bad(2), bad(3), bad(4), bad(5), bad(6), bad(7), bad(8)]);
});

test("jiraOptions: view entries that are not objects, or lack a name or a jql, are skipped with a warning", () => {
  const o = jiraOptions({ views: [
    null, "x", [], 5,
    { id: "a", name: "  ", jql: "j" },
    { id: "b", name: 5, jql: "j" },
    { id: "c", name: "C", jql: "" },
    { id: "d", name: "D" },
  ] });
  assert.deepEqual(o.views, []);
  assert.deepEqual(o.warnings, [
    "views[0]: not an object", "views[1]: not an object", "views[2]: not an object", "views[3]: not an object",
    "views[4]: needs a name and a jql", "views[5]: needs a name and a jql", "views[6]: needs a name and a jql", "views[7]: needs a name and a jql",
  ]);
});

test("jiraOptions: only an accepted view takes its id, so a rejected one never makes a later one a duplicate", () => {
  const o = jiraOptions({ views: [
    { id: "today", name: "A", jql: "j" },
    { id: "today", name: "B", jql: "j" },
    { id: "a", name: "", jql: "j" },
    { id: "a", name: "A", jql: "j" },
    { id: "a", name: "Again", jql: "j" },
  ] });
  assert.deepEqual(o.views, [{ id: "a", name: "A", jql: "j", group: null }]);
  assert.deepEqual(o.warnings, [
    'views[0]: "today" is the Today tab\'s id',
    'views[1]: "today" is the Today tab\'s id',
    "views[2]: needs a name and a jql",
    'views[4]: the id "a" is already used',
  ]);
});

test("jiraOptions: views or actions that are not a list give a warning and nothing else; warnings come board, views, actions", () => {
  for (const bad of ["x", 1, {}, true]) {
    const o = jiraOptions({ views: bad, actions: bad });
    assert.deepEqual(o.views, [], JSON.stringify(bad));
    assert.deepEqual(o.actions, [], JSON.stringify(bad));
    assert.deepEqual(o.warnings, ["views: not a list", "actions: not a list"], JSON.stringify(bad));
  }
  assert.deepEqual(jiraOptions({ views: null, actions: null }).warnings, []);
  assert.deepEqual(jiraOptions({ board: "x", views: 1, actions: 2 }).warnings, ["board: not a board id", "views: not a list", "actions: not a list"]);
  assert.deepEqual(jiraOptions(null), jiraOptions({}));
  assert.deepEqual(jiraOptions("junk"), jiraOptions({}));
});

test("jiraOptions: an action rule keeps only what it declares, trimmed; a null key counts as not declared", () => {
  const o = jiraOptions({ actions: [
    { project: " SEC ", type: " Bug ", subtask: false, parentType: [" Story ", "Epic"], start: "/s {key}", finish: "/f {key}", note: "dropped" },
    { start: "/only-start" },
    { finish: "/only-finish", project: null, type: null, subtask: null, parentType: null },
    { project: "SEC", start: "s", finish: 5 },
    { parentType: " Story ", finish: "f" },
  ] });
  assert.deepEqual(o.actions, [
    { project: "SEC", type: "Bug", subtask: false, parentType: ["Story", "Epic"], start: "/s {key}", finish: "/f {key}" },
    { start: "/only-start" },
    { finish: "/only-finish" },
    { project: "SEC", start: "s" },
    { parentType: ["Story"], finish: "f" },
  ]);
  assert.deepEqual(o.warnings, []);
});

test("jiraOptions: an action rule with a bad match key, or neither start nor finish, is skipped with a warning", () => {
  const notName = "parentType is not a type name or a list of them";
  const o = jiraOptions({ actions: [
    null, "x", [],
    { project: "", start: "s" },
    { project: 5, start: "s" },
    { type: "  ", start: "s" },
    { subtask: "yes", start: "s" },
    { parentType: [], start: "s" },
    { parentType: ["Story", ""], start: "s" },
    { parentType: 5, start: "s" },
    { parentType: "", start: "s" },
    { project: "SEC" },
    { start: 5, finish: "  " },
    { start: "ok" },
  ] });
  assert.deepEqual(o.actions, [{ start: "ok" }]);
  assert.deepEqual(o.warnings, [
    "actions[0]: not an object", "actions[1]: not an object", "actions[2]: not an object",
    "actions[3]: project is not a name",
    "actions[4]: project is not a name",
    "actions[5]: type is not a name",
    "actions[6]: subtask is not true or false",
    `actions[7]: ${notName}`, `actions[8]: ${notName}`, `actions[9]: ${notName}`, `actions[10]: ${notName}`,
    "actions[11]: needs a start or a finish",
    "actions[12]: needs a start or a finish",
  ]);
});

// ---- the store, on real files ----

function fakeHerdr() {
  const home = mkdtempSync(join(tmpdir(), "jira-store-"));
  const io = {
    appHome: home,
    platform: POSIX ? "linux" : "windows",
    readTextFile: async (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    // Like Herdr's: only if the file still holds `expected` (null: must not exist), atomic, no parent folders made.
    writeTextFile: async (p, text, expected) => {
      const now = existsSync(p) ? readFileSync(p, "utf8") : null;
      if (now !== expected) throw new Error("stale snapshot");
      if (!existsSync(dirname(p))) throw new Error("No such file or directory");
      const tmp = `${p}.tmp-${process.pid}`;
      writeFileSync(tmp, text);
      renameSync(tmp, p);
      return null;
    },
    exec: (command, args) => new Promise((ok, fail) => execFile(command, args, { encoding: "utf8" }, (e, stdout, stderr) => {
      if (e && typeof e.code !== "number") return fail(e);
      ok({ code: e ? e.code : 0, stdout, stderr });
    })),
  };
  return { home, io, done: () => rmSync(home, { recursive: true, force: true }) };
}

test("loadJira on a fresh PC: defaults, no token", async () => {
  const h = fakeHerdr();
  try {
    const j = await loadJira(h.io, "work");
    assert.deepEqual(j.settings, DEFAULT_SETTINGS);
    assert.equal(j.token, null);
    assert.equal(j.problem, null);
    assert.equal(j.paths.settingsPath, `${h.home}/herdr-dock/jira-work.json`);
  } finally { h.done(); }
});

test("saveToken: folder made private, token and curl config written private, loadJira reads it back", async () => {
  const h = fakeHerdr();
  try {
    const r = await saveToken(h.io, "work", "  abc+/=  ");
    assert.deepEqual(r, { ok: true });
    const p = jiraPaths(h.home, "work");
    assert.equal(readFileSync(p.tokenPath, "utf8"), "abc+/=\n");
    assert.equal(readFileSync(p.curlConfigPath, "utf8"), curlConfig("abc+/="));
    if (POSIX) {
      assert.equal(statSync(p.secretsDir).mode & 0o777, 0o700);
      assert.equal(statSync(p.tokenPath).mode & 0o777, 0o600);
      assert.equal(statSync(p.curlConfigPath).mode & 0o777, 0o600);
    }
    assert.equal((await loadJira(h.io, "work")).token, "abc+/=");
    // A new token replaces the old one (and stays private).
    assert.deepEqual(await saveToken(h.io, "work", "second"), { ok: true });
    assert.equal((await loadJira(h.io, "work")).token, "second");
    if (POSIX) assert.equal(statSync(p.tokenPath).mode & 0o777, 0o600);
    // Disconnect empties both files.
    assert.deepEqual(await clearToken(h.io, "work"), { ok: true });
    assert.equal((await loadJira(h.io, "work")).token, null);
    assert.equal(readFileSync(p.curlConfigPath, "utf8"), "");
  } finally { h.done(); }
});

test("saveToken refuses a bad token and writes nothing", async () => {
  const h = fakeHerdr();
  try {
    const r = await saveToken(h.io, "work", "Bearer x");
    assert.equal(r.ok, false);
    assert.equal(existsSync(jiraPaths(h.home, "work").tokenPath), false);
  } finally { h.done(); }
});

test("saveToken writes nothing when the folder can't be made private", async () => {
  const h = fakeHerdr();
  try {
    const io = { ...h.io, exec: async () => ({ code: 1, stdout: "", stderr: "EACCES" }) };
    const r = await saveToken(io, "work", "abc");
    assert.equal(r.ok, false);
    assert.match(r.error, /secrets folder/);
    assert.equal(existsSync(jiraPaths(h.home, "work").tokenPath), false);
  } finally { h.done(); }
});

test("saveSettings: creates the folder, writes the file, keeps unknown keys, refuses a stale write", async () => {
  const h = fakeHerdr();
  try {
    const first = await saveSettings(h.io, "work", { ...DEFAULT_SETTINGS, baseUrl: "https://j", note: "mine" });
    assert.equal(first.ok, true);
    const j = await loadJira(h.io, "work");
    assert.equal(j.settings.baseUrl, "https://j");
    assert.equal(j.settings.note, "mine");
    assert.equal(j.settingsText, readFileSync(j.paths.settingsPath, "utf8"));
    // Saved again from the text it was loaded from: fine. From an older text: refused, the file is unchanged.
    assert.equal((await saveSettings(h.io, "work", { ...j.settings, startTask: "/t {key}" }, j.settingsText)).ok, true);
    const stale = await saveSettings(h.io, "work", { ...j.settings, startTask: "old" }, j.settingsText);
    assert.equal(stale.ok, false);
    assert.match(stale.error, /changed/);
    assert.equal((await loadJira(h.io, "work")).settings.startTask, "/t {key}");
  } finally { h.done(); }
});

test("loadJira reports a broken settings file and still gives defaults", async () => {
  const h = fakeHerdr();
  try {
    await saveSettings(h.io, "work", DEFAULT_SETTINGS);
    writeFileSync(jiraPaths(h.home, "work").settingsPath, "{ broken");
    const j = await loadJira(h.io, "work");
    assert.deepEqual(j.settings, DEFAULT_SETTINGS);
    assert.match(j.problem, /jira-work\.json/);
  } finally { h.done(); }
});

test("syncCurlConfig: a curl config that drifted from the token file is rewritten to match (and kept private)", async () => {
  const h = fakeHerdr();
  try {
    await saveToken(h.io, "work", "right");
    const p = jiraPaths(h.home, "work");
    writeFileSync(p.curlConfigPath, curlConfig("stale")); // a hand edit, or a save that failed halfway
    assert.deepEqual(await syncCurlConfig(h.io, "work", "right"), { ok: true, changed: true });
    assert.equal(readFileSync(p.curlConfigPath, "utf8"), curlConfig("right"));
    if (POSIX) assert.equal(statSync(p.curlConfigPath).mode & 0o777, 0o600);
    assert.deepEqual(await syncCurlConfig(h.io, "work", "right"), { ok: true, changed: false });
  } finally { h.done(); }
});

// ---- The settings file edited by hand while the page runs ----
import { settingsReload } from "../src/shared/jira/settings.js";

test("settingsReload: text that doesn't parse keeps the settings in use, and says why", () => {
  const current = { ...DEFAULT_SETTINGS, baseUrl: "https://jira.example.com" };
  const bad = settingsReload(current, '{ "baseUrl": ', "jira-work.json");
  assert.equal(bad.kind, "keep");
  assert.match(bad.problem, /^herdr-dock\/jira-work\.json not valid JSON \(.+\); the page keeps the settings it had until the file is fixed$/);
  assert.deepEqual(settingsReload(current, "[1]", "jira-work.json"),
    { kind: "keep", problem: "herdr-dock/jira-work.json not a JSON object; the page keeps the settings it had until the file is fixed" });
});

test("settingsReload: good text loads; another address is a new site", () => {
  const current = { ...DEFAULT_SETTINGS, baseUrl: "https://jira.example.com" };
  const text = (baseUrl) => JSON.stringify({ baseUrl, views: [{ id: "sec", name: "Security", jql: "project = SEC" }] });
  assert.deepEqual(settingsReload(current, text("https://jira.example.com"), "jira-work.json"), { kind: "load", newSite: false });
  assert.deepEqual(settingsReload(current, text("https://other.example.com"), "jira-work.json"), { kind: "load", newSite: true });
  // The file removed: the defaults, which have no address.
  assert.deepEqual(settingsReload(current, null, "jira-work.json"), { kind: "load", newSite: true });
  assert.deepEqual(settingsReload({ ...DEFAULT_SETTINGS }, null, "jira-work.json"), { kind: "load", newSite: false });
});
