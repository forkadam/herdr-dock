// The browse command (src/app/browse.js): a fake agent-browser stands in for the real one.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../src/app/browse.js";
import { sessionName } from "../src/shared/browser/session.js";

const FAKE = join(import.meta.dirname, "fixtures", "fake-agent-browser.mjs");
const REPO_CONFIG = JSON.parse(readFileSync(join(import.meta.dirname, "..", "config", "dock.json"), "utf8"));

// A shim that runs `node <script> "$@"`, executable on every OS.
function shim(dir, name, script) {
  const file = join(dir, process.platform === "win32" ? `${name}.cmd` : name);
  writeFileSync(file, process.platform === "win32"
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  if (process.platform !== "win32") chmodSync(file, 0o755);
  return file;
}

function setup({ production = [], created = 100 } = {}) {
  const home = mkdtempSync(join(tmpdir(), "browse-"));
  const log = join(home, "ab.log");
  const hcScript = join(home, "fake-hc.mjs");
  writeFileSync(hcScript, `console.log(JSON.stringify({ id: process.argv[3], created_ms: Number(process.env.FAKE_HC_CREATED ?? ${created}) }));`);
  mkdirSync(join(home, "mods/dock-core"), { recursive: true });
  const cfg = join(home, "config.json");
  writeFileSync(cfg, JSON.stringify({ ...REPO_CONFIG, browser: { production } }));
  writeFileSync(join(home, "mods/dock-core/source.json"), JSON.stringify({ config: cfg, repo: home }));
  const env = {
    ...process.env, HC_TERMINAL_ID: "t3", HC_SCOPE: "scope-abcd1234efgh", DOCK_APP_HOME: home, DOCK_SKIP_SWEEP: "1",
    DOCK_AGENT_BROWSER: shim(home, "agent-browser", FAKE), DOCK_HC: shim(home, "hc", hcScript),
    DOCK_BROWSE_POLL_MS: "20", DOCK_BROWSE_WAIT_MS: "300", FAKE_AB_LOG: log,
  };
  delete env.FAKE_AB_URL; delete env.FAKE_AB_EXIT;
  const out = [], err = [];
  const io = { out: (l) => out.push(l), err: (l) => err.push(l), readLine: async () => "" };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const rec = (f) => JSON.parse(readFileSync(join(home, "herdr-dock/browser/sessions", f), "utf8"));
  const write = (f, o) => { mkdirSync(join(home, "herdr-dock/browser/sessions"), { recursive: true }); writeFileSync(join(home, "herdr-dock/browser/sessions", f), JSON.stringify(o)); };
  const run = (argv, extra = {}) => main(argv, { ...env, ...extra }, io);
  return { home, env, out, err, calls, rec, write, run, done: () => rmSync(home, { recursive: true, force: true }) };
}

test("refuses without HC_TERMINAL_ID", async () => {
  const x = setup();
  try {
    const code = await x.run(["open", "localhost:3000"], { HC_TERMINAL_ID: "" });
    assert.equal(code, 2);
    assert.match(x.err.join("\n"), /HC_TERMINAL_ID is not set/);
    assert.equal(x.calls().length, 0);
  } finally { x.done(); }
});

test("missing agent-browser is reported", async () => {
  const x = setup();
  try {
    const code = await x.run(["open", "localhost:3000"], { DOCK_AGENT_BROWSER: join(x.home, "nope") });
    assert.equal(code, 2);
    assert.match(x.err.join("\n"), /agent-browser is not installed/);
  } finally { x.done(); }
});

test("open writes the session record", async () => {
  const x = setup();
  try {
    assert.equal(await x.run(["open", "localhost:3000"]), 0);
    const r = x.rec("t3.json");
    assert.equal(r.session, sessionName("scope-abcd1234efgh", "t3"));
    assert.equal(r.port, 4567);
    assert.equal(r.profile, "clean");
    assert.equal(r.url, "http://localhost:3000/");
    assert.equal(r.title, "Title");
    assert.equal(r.terminalCreated, 100);
    assert.ok(x.calls().some((c) => c.includes("open") && c.includes("http://localhost:3000")));
    assert.ok(x.calls().every((c) => c[0] === "--session" && c[1] === r.session));
  } finally { x.done(); }
});

test("session record holds only the listed keys", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    assert.deepEqual(Object.keys(x.rec("t3.json")).sort(), ["handoff", "opened", "port", "profile", "session", "terminal", "terminalCreated", "title", "url", "v"]);
  } finally { x.done(); }
});

test("open on signed-in passes --state only when the file exists", async () => {
  const x = setup();
  try {
    await x.run(["open", "--profile", "signed-in", "localhost:3000"]);
    assert.ok(!x.calls().some((c) => c.includes("--state")));
    await x.run(["close"]);
    mkdirSync(join(x.home, "herdr-dock/browser/profiles"), { recursive: true });
    const file = join(x.home, "herdr-dock/browser/profiles/signed-in.json");
    writeFileSync(file, "{}");
    await x.run(["open", "--profile", "signed-in", "localhost:3000"]);
    const c = x.calls().find((c) => c.includes("--state"));
    assert.ok(c);
    assert.equal(c[c.indexOf("--state") + 1].replace(/\\/g, "/"), file.replace(/\\/g, "/"));
  } finally { x.done(); }
});

test("a profile change restarts the session", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    const before = x.calls().length;
    await x.run(["open", "--profile", "signed-in", "localhost:3000"]);
    const after = x.calls().slice(before);
    const iClose = after.findIndex((c) => c.includes("close"));
    const iOpen = after.findIndex((c) => c.includes("open"));
    assert.ok(iClose >= 0 && iClose < iOpen);
    assert.match(x.out.join("\n"), /restarted the browser on the signed-in profile/);
    assert.equal(x.rec("t3.json").profile, "signed-in");
  } finally { x.done(); }
});

test("chrome from the config is passed as --executable-path", async () => {
  const x = setup();
  try {
    const cfg = JSON.parse(readFileSync(join(x.home, "config.json"), "utf8"));
    cfg.browser.chrome = "/opt/chrome";
    writeFileSync(join(x.home, "config.json"), JSON.stringify(cfg));
    await x.run(["open", "localhost:3000"]);
    assert.ok(x.calls().every((c) => c.includes("--executable-path") && c[c.indexOf("--executable-path") + 1] === "/opt/chrome"));
  } finally { x.done(); }
});

test("action is refused for close, and passes through otherwise", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    const n = x.calls().length;
    assert.equal(await x.run(["action", "--", "close"]), 2);
    assert.match(x.err.join("\n"), /close is not allowed/);
    assert.equal(x.calls().length, n);
    assert.equal(await x.run(["action", "--", "snapshot"], { FAKE_AB_OUT: "tree" }), 0);
    assert.ok(x.calls().some((c) => c.includes("snapshot")));
  } finally { x.done(); }
});

test("action while the person has control exits 3 without calling", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    x.write("t3.control.json", { v: 1, takeover: { reason: "person", since: Date.now() }, answer: null, terminalCreated: 100 });
    const n = x.calls().length;
    assert.equal(await x.run(["action", "--", "snapshot"]), 3);
    assert.match(x.err.join("\n"), /the person has control; run browse wait/);
    assert.equal(x.calls().length, n);
  } finally { x.done(); }
});

test("action updates the record's url", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    await x.run(["action", "--", "click", "@e1"], { FAKE_AB_URL: "http://localhost:3000/next" });
    assert.equal(x.rec("t3.json").url, "http://localhost:3000/next");
  } finally { x.done(); }
});

test("action on a production page prints the banner", async () => {
  const x = setup({ production: ["*.corp.com"] });
  try {
    await x.run(["open", "https://a.corp.com"], { FAKE_AB_URL: "https://a.corp.com/" });
    x.out.length = 0;
    assert.equal(await x.run(["action", "--", "snapshot"], { FAKE_AB_URL: "https://a.corp.com/" }), 0);
    assert.ok(x.out.includes("PRODUCTION (a.corp.com): no probing, nothing that writes without the person."));
  } finally { x.done(); }
});

test("handoff then wait: unanswered is 4, done is 0 and clears, cancel is 1", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    assert.equal(await x.run(["handoff", "log", "in"]), 0);
    assert.match(x.out.join("\n"), /waiting for the person: run browse wait/);
    const h = x.rec("t3.json").handoff;
    assert.equal(h.message, "log in");
    assert.equal(await x.run(["wait"]), 4);
    assert.match(x.out.join("\n"), /still waiting; run browse wait again/);
    x.write("t3.control.json", { v: 1, takeover: null, answer: { id: h.id, value: "done" }, terminalCreated: 100 });
    assert.equal(await x.run(["wait"]), 0);
    assert.equal(x.rec("t3.json").handoff, null);

    await x.run(["handoff", "again"]);
    const h2 = x.rec("t3.json").handoff;
    x.write("t3.control.json", { v: 1, takeover: null, answer: { id: h2.id, value: "cancel" }, terminalCreated: 100 });
    assert.equal(await x.run(["wait"]), 1);
    assert.match(x.out.join("\n"), /the person cancelled/);
    assert.equal(x.rec("t3.json").handoff, null);
  } finally { x.done(); }
});

test("wait with nothing pending is free", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    assert.equal(await x.run(["wait"]), 0);
  } finally { x.done(); }
});

test("status prints one line each", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    x.out.length = 0;
    assert.equal(await x.run(["status"]), 0);
    assert.equal(x.out.length, 4);
    assert.match(x.out[1], /clean/);
    assert.match(x.out[2], /localhost:3000/);
    assert.equal(x.out[3], "person has control: no");
  } finally { x.done(); }
});

test("close removes the records and frames", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    x.write("t3.control.json", { v: 1, takeover: null, answer: null });
    mkdirSync(join(x.home, "herdr-dock/browser/frames/t3"), { recursive: true });
    writeFileSync(join(x.home, "herdr-dock/browser/frames/t3/a.jpg"), "x");
    assert.equal(await x.run(["close"]), 0);
    assert.ok(x.calls().some((c) => c.includes("close")));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/sessions/t3.json")));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/sessions/t3.control.json")));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/frames/t3")));
  } finally { x.done(); }
});

test("a reused terminal id starts clean: stale records go, the old session is closed", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    const old = x.rec("t3.json").session;
    x.write("t3.control.json", { v: 1, takeover: { reason: "person", since: Date.now() }, answer: null, terminalCreated: 100 });
    mkdirSync(join(x.home, "herdr-dock/browser/frames/t3"), { recursive: true });
    const n = x.calls().length;
    // The terminal is a new one now (created_ms 200): the old browser is gone, not the new agent's to pause or use.
    assert.equal(await x.run(["action", "--", "snapshot"], { FAKE_HC_CREATED: "200" }), 2);
    assert.match(x.err.join("\n"), /no browser is open/);
    assert.ok(!x.calls().slice(n).some((c) => c.includes("snapshot")));
    assert.ok(x.calls().slice(n).some((c) => c.includes("close")));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/sessions/t3.control.json")));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/frames/t3")));
    assert.ok(x.calls().slice(n).some((c) => c[1] === old));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/sessions/t3.json")));
  } finally { x.done(); }
});

test("a stale control record alone counts as the default control", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    x.write("t3.control.json", { v: 1, takeover: { reason: "person", since: Date.now() }, answer: null, terminalCreated: 50 });
    assert.equal(await x.run(["action", "--", "snapshot"]), 0);
  } finally { x.done(); }
});

test("login opens a headed login session, saves state after Enter and closes", async () => {
  const x = setup();
  try {
    assert.equal(await x.run(["login", "https://example.com"]), 0);
    assert.match(x.out.join("\n"), /Sign in in the window, then press Enter here\./);
    const c = x.calls();
    assert.ok(c.every((a) => a.includes("--headed") || a.includes("state") || a.includes("close") || a.includes("--session")));
    assert.ok(c.some((a) => a.includes("--headed") && a.includes("open")));
    assert.ok(c.some((a) => a.includes("state") && a.includes("save")));
    assert.ok(c[c.length - 1].includes("close"));
    assert.match(c[0][1], /^dock-login-/);
  } finally { x.done(); }
});

test("window-open and window-done move the state between the sessions", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    assert.equal(await x.run(["window-open", "--terminal", "t3"]), 0);
    let c = x.calls();
    const real = c.find((a) => a.includes("--headed"));
    assert.ok(real && real[1].endsWith("-real"));
    assert.equal(await x.run(["window-done", "--terminal", "t3"]), 0);
    c = x.calls();
    assert.ok(c.some((a) => a.includes("state") && a.includes("load")));
    assert.ok(c.some((a) => a.includes("reload")));
  } finally { x.done(); }
});
