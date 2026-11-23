import test from "node:test";
import assert from "node:assert/strict";
import { sessionName, BROWSER_REL, sessionsRel, sessionFileRel, controlFileRel, framesRel, bigFramesRel, realSessionName, picksRel, signedInRel, binRel, normalizeUrl } from "../src/shared/browser/session.js";
import { hostOf, isProduction } from "../src/shared/browser/hosts.js";
import { parseBrowse, UsageError, refused } from "../src/shared/browser/args.js";

test("sessionName", () => {
  assert.equal(sessionName("5154-a375d9e35f2601246f10b2838c38c1e2", "t3"), "dock-8c38c1e2-t3");
  assert.equal(sessionName("AB-cd", "t1"), "dock-abcd-t1");
  assert.throws(() => sessionName("x", ""));
});
test("paths", () => {
  assert.equal(BROWSER_REL, "herdr-dock/browser");
  assert.equal(sessionsRel(), "herdr-dock/browser/sessions");
  assert.equal(sessionFileRel("t3"), "herdr-dock/browser/sessions/t3.json");
  assert.equal(controlFileRel("t3"), "herdr-dock/browser/sessions/t3.control.json");
  assert.equal(framesRel("t3"), "herdr-dock/browser/frames/t3");
  assert.equal(bigFramesRel("t3"), "herdr-dock/browser/frames/t3-big");
  assert.equal(realSessionName("dock-ab-t3"), "dock-ab-t3-real");
  assert.equal(picksRel(), "herdr-dock/browser/picks");
  assert.equal(signedInRel(), "herdr-dock/browser/profiles/signed-in.json");
  assert.equal(binRel("linux"), "herdr-dock/browser/bin/agent-browser");
  assert.equal(binRel("win32"), "herdr-dock/browser/bin/agent-browser.exe");
});
test("normalizeUrl", () => {
  const cases = [
    ["localhost:3000", "http://localhost:3000"], ["127.0.0.1:8080/x", "http://127.0.0.1:8080/x"],
    ["example.com", "https://example.com"], ["https://a.b/c?d", "https://a.b/c?d"], ["file:///tmp/a.html", "file:///tmp/a.html"],
    ["/home/me/a.html", "file:///home/me/a.html"], ["C:\\site\\a.html", "file:///C:/site/a.html"], ["about:blank", "about:blank"],
    ["  example.com  ", "https://example.com"], ["localhost", "http://localhost"],
  ];
  for (const [i, o] of cases) assert.equal(normalizeUrl(i), o, i);
});
test("hostOf", () => {
  assert.equal(hostOf("https://A.Corp.com:8443/x"), "a.corp.com");
  assert.equal(hostOf("http://u:p@h.com/"), "h.com");
  assert.equal(hostOf("http://[::1]:3000/"), "[::1]");
  assert.equal(hostOf("about:blank"), null);
  assert.equal(hostOf("file:///tmp/a"), null);
});
test("isProduction", () => {
  const p = ["*.corp.com", "app.example.com"];
  assert.equal(isProduction("https://A.Corp.com:8443/x", p), "a.corp.com");
  assert.equal(isProduction("https://a.b.corp.com", p), "a.b.corp.com");
  assert.equal(isProduction("https://corp.com", p), null);
  assert.equal(isProduction("https://app.example.com/", p), "app.example.com");
  assert.equal(isProduction("http://10.0.0.5", p), null);
  assert.equal(isProduction("http://localhost:3000", ["localhost"]), "localhost");
  assert.equal(isProduction("about:blank", p), null);
  assert.equal(isProduction("https://a.corp.com./x", p), "a.corp.com");
  assert.equal(isProduction("https://app.example.com", ["APP.Example.com"]), "app.example.com");
});
test("parseBrowse", () => {
  assert.deepEqual(parseBrowse(["open", "x.com"]), { cmd: "open", profile: "clean", url: "x.com" });
  assert.deepEqual(parseBrowse(["open", "--profile", "signed-in", "x.com"]), { cmd: "open", profile: "signed-in", url: "x.com" });
  assert.deepEqual(parseBrowse(["action", "--", "click", "@e3"]), { cmd: "action", args: ["click", "@e3"] });
  assert.deepEqual(parseBrowse(["handoff", "Sign in"]), { cmd: "handoff", message: "Sign in" });
  assert.deepEqual(parseBrowse(["login", "x.com"]), { cmd: "login", url: "x.com" });
  for (const c of ["wait", "status", "close", "help"]) assert.deepEqual(parseBrowse([c]), { cmd: c });
  assert.deepEqual(parseBrowse(["window-open", "--terminal", "t3"]), { cmd: "window-open", terminal: "t3" });
  assert.deepEqual(parseBrowse(["window-done", "--terminal", "t3"]), { cmd: "window-done", terminal: "t3" });
  assert.throws(() => parseBrowse(["open", "--profile", "work", "x"]), UsageError);
  assert.throws(() => parseBrowse(["handoff"]), UsageError);
  assert.throws(() => parseBrowse(["open"]), UsageError);
  assert.throws(() => parseBrowse(["action"]), UsageError);
  assert.throws(() => parseBrowse(["window-open"]), UsageError);
  assert.throws(() => parseBrowse(["bogus"]), UsageError);
});
test("refused", () => {
  assert.match(refused(["close"]), /close/);
  assert.match(refused(["connect", "9222"]), /connect/);
  assert.match(refused(["--cdp", "9222", "snapshot"]), /--cdp/);
  assert.match(refused(["snapshot", "--session", "x"]), /--session/);
  assert.match(refused(["open", "-p", "x"]), /-p/);
  assert.match(refused(["--json", "close"]), /close/);
  assert.match(refused(["--headed", "connect", "9222"]), /connect/);
  assert.equal(refused(["tab", "close"]), null);
  assert.equal(refused(["snapshot", "-i"]), null);
});
