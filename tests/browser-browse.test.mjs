// The browse command (src/app/browse.js): a fake agent-browser stands in for the real one.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { main, appHomeOf } from "../src/app/browse.js";
import { sessionName } from "../src/shared/browser/session.js";

const SIGNED_IN = "herdr-dock/browser/profiles/signed-in.json";
const TMP = "herdr-dock/browser/tmp";
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
    mkdirSync(join(x.home, "herdr-dock/browser/frames/t3-big"), { recursive: true });
    assert.equal(await x.run(["close"]), 0);
    assert.ok(x.calls().some((c) => c.includes("close")));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/sessions/t3.json")));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/sessions/t3.control.json")));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/frames/t3")));
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/frames/t3-big")));
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
    assert.match(x.out.join("\n"), /Sign in in the window — keep it open — then press Enter here\./);
    const c = x.calls();
    assert.ok(c.every((a) => a.includes("--headed") || a.includes("state") || a.includes("close") || a.includes("--session")));
    assert.ok(c.some((a) => a.includes("--headed") && a.includes("open")));
    assert.ok(c.some((a) => a.includes("state") && a.includes("save")));
    assert.ok(c[c.length - 1].includes("close"));
    assert.match(c[0][1], /^dock-login-/);
    const saved = JSON.parse(readFileSync(join(x.home, SIGNED_IN), "utf8"));
    assert.equal(saved.cookies.length, 1);
    assert.deepEqual(readdirSync(join(x.home, "herdr-dock/browser/profiles")), ["signed-in.json"]); // no temp file left
  } finally { x.done(); }
});

// The window closed by hand: state save fails, or the session comes back empty. The saved login stays as it was.
const HOW = { fail: "failing", empty: "with no cookies", relaunched: "from a browser launched for it (window closed)" };
for (const state of ["fail", "empty", "relaunched"]) {
  test(`login: state save ${HOW[state]} leaves signed-in.json unchanged, exit 1`, async () => {
    const x = setup();
    try {
      const file = join(x.home, SIGNED_IN);
      mkdirSync(join(x.home, "herdr-dock/browser/profiles"), { recursive: true });
      writeFileSync(file, '{"cookies":[{"name":"old"}]}');
      assert.equal(await x.run(["login", "https://example.com"], { FAKE_AB_STATE: state }), 1);
      assert.match(x.err.join("\n"), /the window was closed before its state was saved .*nothing was changed/);
      assert.equal(readFileSync(file, "utf8"), '{"cookies":[{"name":"old"}]}');
      assert.deepEqual(readdirSync(join(x.home, "herdr-dock/browser/profiles")), ["signed-in.json"]);
      assert.ok(x.calls().at(-1).includes("close"));
    } finally { x.done(); }
  });
}

test("login: no saved login before and nothing saved now leaves no file", async () => {
  const x = setup();
  try {
    assert.equal(await x.run(["login", "https://example.com"], { FAKE_AB_STATE: "empty" }), 1);
    assert.ok(!existsSync(join(x.home, SIGNED_IN)));
  } finally { x.done(); }
});

test("login stops without waiting when the window doesn't open", async () => {
  const x = setup();
  try {
    let asked = false;
    const io = { out: (l) => x.out.push(l), err: (l) => x.err.push(l), readLine: async () => { asked = true; return ""; } };
    const code = await main(["login", "https://example.com"], { ...x.env, FAKE_AB_OPEN_EXIT: "5" }, io);
    assert.equal(code, 5);
    assert.equal(asked, false);
    assert.match(x.err.join("\n"), /the login window didn't open; nothing was changed/);
    assert.ok(!x.calls().some((a) => a.includes("save")));
    assert.ok(!existsSync(join(x.home, SIGNED_IN)));
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

test("the default app home is two folders above mods/dock-browser/browse.mjs", async () => {
  const x = setup();
  try {
    const script = join(x.home, "mods", "dock-browser", "browse.mjs");
    assert.equal(appHomeOf(pathToFileURL(script).href), x.home);
    // main without DOCK_APP_HOME and DOCK_AGENT_BROWSER looks for the binary under the default home, not elsewhere.
    const code = await x.run(["open", "localhost:3000"], { DOCK_APP_HOME: "", DOCK_AGENT_BROWSER: "" });
    assert.equal(code, 2);
    assert.match(x.err.join("\n"), /agent-browser is not installed/);
  } finally { x.done(); }
});

test("wait: a handoff older than handoffMinutes times out, exit 1, handoff cleared", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    await x.run(["handoff", "log in"]);
    const r = x.rec("t3.json");
    x.write("t3.json", { ...r, handoff: { ...r.handoff, since: Date.now() - 16 * 60_000 } });
    assert.equal(await x.run(["wait"]), 1);
    assert.match(x.out.join("\n"), /nobody answered in 15 minutes/);
    assert.equal(x.rec("t3.json").handoff, null);
  } finally { x.done(); }
});

test("window-done: a failed save or an empty state loads nothing, leaves the window, exits 1", async () => {
  for (const state of ["fail", "empty", "relaunched"]) {
    const x = setup();
    try {
      await x.run(["open", "localhost:3000"]);
      assert.equal(await x.run(["window-open", "--terminal", "t3"]), 0);
      assert.ok(existsSync(join(x.home, TMP, "t3.json")));
      const n = x.calls().length;
      assert.equal(await x.run(["window-done", "--terminal", "t3"], { FAKE_AB_STATE: state }), 1);
      assert.match(x.err.join("\n"), /the window was closed before its state was saved .*nothing was changed/);
      const after = x.calls().slice(n);
      assert.ok(!after.some((a) => a.includes("load") || a.includes("reload") || a.includes("close")));
      assert.deepEqual(readdirSync(join(x.home, TMP)), []); // no cookie files left
    } finally { x.done(); }
  }
});

test("window-done: a saved state is loaded into the agent's session, the window closed, temp files gone", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    const agent = x.rec("t3.json").session;
    await x.run(["window-open", "--terminal", "t3"]);
    const n = x.calls().length;
    assert.equal(await x.run(["window-done", "--terminal", "t3"]), 0);
    const after = x.calls().slice(n);
    assert.ok(after.some((a) => a[1] === `${agent}-real` && a.includes("close")));
    const load = after.find((a) => a.includes("load"));
    assert.ok(load && load[1] === agent);
    assert.deepEqual(readdirSync(join(x.home, TMP)), []);
  } finally { x.done(); }
});

test("open while the person has control exits 3 and changes nothing", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    x.write("t3.control.json", { v: 1, takeover: { reason: "person", since: Date.now() }, answer: null, terminalCreated: 100 });
    const before = x.rec("t3.json"), n = x.calls().length;
    assert.equal(await x.run(["open", "localhost:4000"]), 3);
    assert.match(x.err.join("\n"), /the person has control; run browse wait/);
    assert.equal(x.calls().length, n);
    assert.deepEqual(x.rec("t3.json"), before);
  } finally { x.done(); }
});

test("open during an open handoff exits 3; after it is answered, open keeps the handoff for wait", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    await x.run(["handoff", "log in"]);
    const h = x.rec("t3.json").handoff;
    assert.equal(await x.run(["open", "localhost:4000"]), 3);
    assert.deepEqual(x.rec("t3.json").handoff, h);
    // Answered but not yet waited for: open goes ahead and the answer still reaches wait.
    x.write("t3.control.json", { v: 1, takeover: null, answer: { id: h.id, value: "done" }, terminalCreated: 100 });
    assert.equal(await x.run(["open", "localhost:4000"]), 0);
    assert.deepEqual(x.rec("t3.json").handoff, h);
    assert.equal(await x.run(["wait"]), 0);
    assert.equal(x.rec("t3.json").handoff, null);
  } finally { x.done(); }
});

test("close also closes the real window's session and deletes its state files", async () => {
  const x = setup();
  try {
    await x.run(["open", "localhost:3000"]);
    const agent = x.rec("t3.json").session;
    mkdirSync(join(x.home, TMP), { recursive: true });
    writeFileSync(join(x.home, TMP, "t3.json"), "{}");
    writeFileSync(join(x.home, TMP, "t3.done.json"), "{}");
    writeFileSync(join(x.home, TMP, "t9.json"), "{}");
    assert.equal(await x.run(["close"]), 0);
    assert.ok(x.calls().some((a) => a[1] === `${agent}-real` && a.includes("close")));
    assert.deepEqual(readdirSync(join(x.home, TMP)), ["t9.json"]);
  } finally { x.done(); }
});

test("open's sweep closes a gone terminal's browser and real window and deletes its state files", { skip: process.platform === "win32" }, async () => {
  const x = setup();
  try {
    const bin = join(x.home, "bin");
    mkdirSync(bin);
    const ls = join(x.home, "fake-ls.mjs");
    writeFileSync(ls, `console.log(JSON.stringify({ spaces: [{ tabs: [{ terminals: [{ terminal: "t3" }] }] }] }));`);
    shim(bin, "herdr-app", ls);
    x.write("t7.json", { v: 1, session: "dock-x-t7", terminal: "t7", profile: "clean", handoff: null });
    mkdirSync(join(x.home, TMP), { recursive: true });
    writeFileSync(join(x.home, TMP, "t7.json"), "{}");
    writeFileSync(join(x.home, TMP, "t7.done.json"), "{}");
    assert.equal(await x.run(["open", "localhost:3000"], { DOCK_SKIP_SWEEP: "", PATH: `${bin}:${process.env.PATH}` }), 0);
    const c = x.calls();
    assert.ok(c.some((a) => a[1] === "dock-x-t7" && a.includes("close")));
    assert.ok(c.some((a) => a[1] === "dock-x-t7-real" && a.includes("close")));
    assert.deepEqual(readdirSync(join(x.home, TMP)), []);
    assert.ok(!existsSync(join(x.home, "herdr-dock/browser/sessions/t7.json")));
  } finally { x.done(); }
});

test("not installed: an app install is told the setup script, a clone npm run deploy", async () => {
  const x = setup();
  try {
    const missing = { DOCK_AGENT_BROWSER: join(x.home, "nope") };
    assert.equal(await x.run(["open", "localhost:3000"], missing), 2);
    assert.match(x.err.at(-1), /set browser\.enabled and run npm run deploy$/);
    writeFileSync(join(x.home, "mods/dock-core/source.json"), JSON.stringify({ mode: "app" }));
    assert.equal(await x.run(["open", "localhost:3000"], missing), 2);
    const setup = join(x.home, "mods/dock-browser/herdr-browser-setup.mjs");
    assert.equal(x.err.at(-1), `agent-browser is not installed: set browser.enabled and run node "${setup}"`);
  } finally { x.done(); }
});
