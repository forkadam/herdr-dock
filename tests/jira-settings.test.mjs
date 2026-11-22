// The Jira page's settings and token (src/shared/jira/settings.js pure, src/shared/jira/store.js with Herdr's file
// calls handed in). The store is tested on real files with a stand-in for Herdr's readTextFile / writeTextFile.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_SETTINGS, formatSettings, jiraPaths, normalizeBaseUrl, parseSettings, siteName, validateToken } from "../src/shared/jira/settings.js";
import { clearToken, loadJira, saveSettings, saveToken } from "../src/shared/jira/store.js";
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
