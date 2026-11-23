import test from "node:test";
import assert from "node:assert/strict";
import {
  designFeedback, redact, INTENTS, PRIORITIES, NOTES_MAX, addPicks, pictureName, stalePicks,
} from "../src/shared/browser/feedback.js";
import {
  PICK_SCRIPT, START_SCRIPT, READ_PICKS, STOP_SCRIPT, RELEASE_SCRIPT, holdScript, markScript, probeScript, parsePicks, readResult,
  parseProbe, pointerGate,
} from "../src/shared/browser/pick-script.js";
import { changes, finishOf, panelMode, pickKind, shouldReinstall } from "../src/shared/browser/panel.js";
import { parseControl } from "../src/shared/browser/registry.js";

const save = { selector: "button#save", text: "Save", note: "make it green", picture: "/home/me/.config/herdr-app/herdr-dock/browser/picks/t1-abc-1.png" };

test("designFeedback: one element", () => {
  const md = designFeedback({ url: "http://localhost:3000/settings", items: [{ ...save, source: { file: "src/Settings.jsx", line: 42 } }] });
  assert.equal(md, [
    "## Design Feedback",
    "",
    "Page: http://localhost:3000/settings",
    "",
    "### 1. `button#save`",
    "Source: src/Settings.jsx:42",
    'Text: "Save"',
    "Note: make it green",
    `Picture: ${save.picture}`,
  ].join("\n"));
  assert.ok(md.startsWith("## Design Feedback\n"));
});

test("designFeedback: two elements, numbered; source only when known; intent and priority when given", () => {
  const md = designFeedback({
    url: "https://example.com/",
    items: [
      { ...save, intent: "fix", priority: "high" },
      { selector: "div.card > p", text: "", note: "", intent: "question", priority: "normal", source: null, picture: null },
    ],
  });
  const lines = md.split("\n");
  assert.equal(lines[0], "## Design Feedback");
  assert.ok(lines.includes("### 1. `button#save`"));
  assert.ok(lines.includes("### 2. `div.card > p`"));
  assert.ok(!md.includes("Source:"));
  assert.ok(md.includes("Intent: fix\nPriority: high"));
  assert.ok(md.includes("Intent: question\nPriority: normal"));
  assert.equal(lines.filter((l) => l.startsWith("Picture: ")).length, 1);
  assert.ok(md.includes("Note: (no note)"));
  // No Text line for an element without text.
  assert.equal(lines.filter((l) => l.startsWith("Text: ")).length, 1);
  // Sections are separated by a blank line.
  assert.ok(md.includes(`Picture: ${save.picture}\n\n### 2.`));
});

test("designFeedback: text and notes on one line, backticks in a selector fenced, secrets redacted", () => {
  const md = designFeedback({
    url: "https://app.example.com/cb?token=abc123secret&x=1",
    items: [{ selector: "a[title=`x`]", text: "Hello\n  world   eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_nature", note: "my password=hunter2 here", picture: null }],
  });
  assert.ok(md.includes("### 1. ``a[title=`x`]``"));
  assert.ok(md.includes('Text: "Hello world [redacted]"'));
  assert.ok(md.includes("Note: my password=[redacted] here"));
  assert.ok(md.includes("Page: https://app.example.com/cb?token=[redacted]&x=1"));
  assert.ok(!md.includes("hunter2") && !md.includes("abc123secret"));
});

test("redact: JWTs, bearer tokens, password/token pairs, long hex and base64 runs; ordinary text left alone", () => {
  assert.equal(redact("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dGhpc2lzYXNpZw end"), "jwt [redacted] end");
  assert.equal(redact("Authorization: Bearer abc.def-123_xyz"), "Authorization: Bearer [redacted]");
  assert.equal(redact("password=hunter2"), "password=[redacted]");
  assert.equal(redact("token=abc&next=1"), "token=[redacted]&next=1");
  assert.equal(redact("api_key: s3cr3tvalue"), "api_key: [redacted]");
  assert.equal(redact(`id ${"a1b2c3d4e5".repeat(4)} ok`), "id [redacted] ok");
  assert.equal(redact("k QWxhZGRpbjpvcGVuIHNlc2FtZQ7xK2pR9mZ4vB8 z"), "k [redacted] z");
  assert.equal(redact("the button is blue"), "the button is blue");
  assert.equal(redact("a-very-long-hyphenated-slug-made-only-of-words"), "a-very-long-hyphenated-slug-made-only-of-words");
  const path = "file:///tmp/c-1000/-home-me-Projects-herdr-dock/763eaa6c-7aff-457e-8fd3-6f14a179a44a/scratchpad/t9/page.html";
  assert.equal(redact(path), path);
  assert.equal(redact("Release-Notes-2024-for-Version-3-final"), "Release-Notes-2024-for-Version-3-final");
  assert.equal(redact("/reset/aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z"), "/reset/[redacted]");
  assert.equal(redact(""), "");
  assert.equal(redact(null), "");
});

test("redact: real secret shapes", () => {
  assert.equal(redact("key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY end"), "key [redacted] end");
  assert.equal(redact("aws_secret_access_key=abc"), "aws_secret_access_key=[redacted]");
  assert.equal(redact("secret_key=abc"), "secret_key=[redacted]");
  assert.equal(redact("X-Api-Key: abc123"), "X-Api-Key: [redacted]");
  assert.equal(redact("api-key=abc123"), "api-key=[redacted]");
  assert.equal(redact("private_key: xyz"), "private_key: [redacted]");
  assert.equal(redact("authorization: bearer abc.def-123_xyz"), "authorization: bearer [redacted]");
  assert.equal(redact("id AKIAIOSFODNN7EXAMPLE ok"), "id [redacted] ok");
  assert.equal(redact("id ASIAY34FZKBOKMUTVV7A ok"), "id [redacted] ok");
});

test("redact: ordinary words stay", () => {
  for (const s of ["Choose the Basic plan", "Token expired banner", "pass: the test", "handleSubmitButtonClickEvent2024Handler",
    "author: Jane", "the button is blue", "handleSubmitButtonClickEvent2024HandlerFactoryProvider"]) {
    assert.equal(redact(s), s);
  }
  assert.equal(redact("Basic dXNlcjpQYXNzd29yZDEyMzQ1Ng=="), "Basic [redacted]");
});

test("parsePicks: agent-browser's eval output, valid or not", () => {
  const pick = { n: 1, selector: "button#save", text: "Save", tag: "button", box: { x: 1, y: 2, w: 30, h: 20 }, source: { file: "src/A.jsx", line: 3 } };
  // eval prints the returned JSON string JSON-quoted.
  assert.deepEqual(parsePicks(JSON.stringify(JSON.stringify([pick]))), [pick]);
  assert.deepEqual(parsePicks(JSON.stringify([pick])), [pick]);
  // The --json envelope.
  assert.deepEqual(parsePicks(JSON.stringify({ success: true, data: { result: JSON.stringify([pick]) } })), [pick]);
  assert.deepEqual(parsePicks("not json"), []);
  assert.deepEqual(parsePicks(""), []);
  assert.deepEqual(parsePicks("null"), []);
  assert.deepEqual(parsePicks('"[]"'), []);
  // Bad entries are dropped; a bad source or box becomes null; text is capped.
  const out = parsePicks(JSON.stringify([
    { n: 2, selector: "p", text: "x".repeat(500), tag: "p", box: "no", source: { file: 3 } },
    { n: 3, text: "no selector" },
    "junk",
  ]));
  assert.equal(out.length, 1);
  assert.equal(out[0].text.length, 200);
  assert.equal(out[0].box, null);
  assert.equal(out[0].source, null);
});

test("the page scripts parse", () => {
  for (const s of [PICK_SCRIPT, START_SCRIPT, READ_PICKS, STOP_SCRIPT, RELEASE_SCRIPT, holdScript(3), markScript([{ n: 1, label: 1 }]), probeScript(10, 20)]) {
    assert.doesNotThrow(() => new Function(s));
  }
  assert.ok(PICK_SCRIPT.includes("__dockPick"));
  assert.ok(PICK_SCRIPT.includes("preventDefault") && PICK_SCRIPT.includes("stopPropagation"));
  assert.ok(PICK_SCRIPT.includes("_debugSource") && PICK_SCRIPT.includes("__reactFiber$"));
  // A number only: nothing else reaches the page through holdScript.
  assert.ok(!holdScript("1);alert(1").includes("alert"));
});

test("addPicks: Pick keeps the latest; Notes adds up to 20", () => {
  const p = (n) => ({ n, selector: `#e${n}`, text: "", tag: "div", box: null, source: null });
  assert.deepEqual(addPicks([], [p(1), p(2)], "pick", 20).added.map((x) => x.n), [2]);
  let items = [];
  const r1 = addPicks(items, [p(1), p(2)], "notes", NOTES_MAX);
  assert.deepEqual(r1.added.map((x) => x.n), [1, 2]);
  assert.equal(r1.dropped, 0);
  items = Array.from({ length: 19 }, (_, i) => p(i));
  const r2 = addPicks(items, [p(100), p(101)], "notes", NOTES_MAX);
  assert.deepEqual(r2.added.map((x) => x.n), [100]);
  assert.equal(r2.dropped, 1);
  assert.equal(NOTES_MAX, 20);
  assert.deepEqual(INTENTS, ["fix", "change", "question", "approve"]);
  assert.deepEqual(PRIORITIES, ["low", "normal", "high"]);
});

test("pictures: named by terminal and time; ones older than a day are stale", () => {
  const now = 1_800_000_000_000;
  const name = pictureName("t1", now, 3);
  assert.match(name, /^t1-[0-9a-z]+-3\.png$/);
  const old = pictureName("t2", now - 2 * 86_400_000, 1);
  assert.deepEqual(stalePicks([name, old, "other.txt", "x-zz-1.png"], now), [old]);
});

test("Pick and Notes take over with their reason; hand back stops the page script", () => {
  const free = parseControl(null);
  const c = changes.pick("notes", 5)(free);
  assert.deepEqual(c.takeover, { reason: "notes", since: 5 });
  // From the person's own take-over, Pick replaces the reason.
  assert.equal(changes.pick("pick", 6)({ ...free, takeover: { reason: "person", since: 1 } }).takeover.reason, "pick");
  const session = { handoff: null };
  assert.equal(pickKind(panelMode(session, c, 10, 15)), "notes");
  assert.equal(pickKind(panelMode(session, free, 10, 15)), null);
  assert.equal(pickKind(panelMode(session, { ...free, takeover: { reason: "person", since: 1 } }, 10, 15)), null);
  assert.equal(finishOf(c).stopPick, true);
  assert.equal(finishOf(free).stopPick, false);
  assert.equal(changes.handBack()(c).takeover, null);
});

// Runs a page script against a bare window (no document): enough for what happens before the script touches the page.
function inWindow(win, script) {
  return new Function("window", "script", "return eval(script)")(win, script); // eval: the last expression's value, as agent-browser gives
}

test("STOP_SCRIPT marks the page off; only START_SCRIPT's install clears it", () => {
  const win = {};
  assert.equal(inWindow(win, STOP_SCRIPT), false); // nothing was installed
  assert.equal(win.__dockPickOff, true);
  assert.equal(inWindow(win, PICK_SCRIPT), "off"); // a reinstall respects it
  assert.equal(win.__dockPick, undefined);
  win.__dockPick = { read: () => "[]" }; // installed: START gets past the marker to the idempotent check
  assert.equal(inWindow(win, START_SCRIPT), "ok");
  assert.equal(win.__dockPickOff, undefined);
  assert.equal(inWindow({}, READ_PICKS), "absent");
});

test("readResult: the picks, and whether the script is in the page", () => {
  assert.deepEqual(readResult(JSON.stringify("absent")), { present: false, picks: [] });
  assert.deepEqual(readResult(JSON.stringify("[]")), { present: true, picks: [] });
  assert.equal(readResult(JSON.stringify(JSON.stringify([{ n: 1, selector: "#a" }]))).picks.length, 1);
  assert.deepEqual(readResult("garbage"), { present: false, picks: [] });
});

test("pointerGate: a press reaches the page only when the script is there and the pointer isn't on a frame", () => {
  assert.equal(pointerGate(parseProbe(JSON.stringify(JSON.stringify({ present: true, frame: false })))), "send");
  assert.equal(pointerGate(parseProbe(JSON.stringify(JSON.stringify({ present: true, frame: true })))), "frame");
  assert.equal(pointerGate(parseProbe(JSON.stringify(JSON.stringify({ present: false, off: false })))), "absent");
  assert.equal(pointerGate(parseProbe("not json")), "absent");
  assert.equal(pointerGate(null), "absent");
  assert.deepEqual(parseProbe(JSON.stringify(JSON.stringify({ present: false, off: true }))), { present: false, off: true, frame: false });
});

test("shouldReinstall: only when the script is gone and the record still says this pick", () => {
  const free = parseControl(null);
  const notes = changes.pick("notes", 5)(free);
  assert.equal(shouldReinstall(false, notes, "notes"), true);
  assert.equal(shouldReinstall(true, notes, "notes"), false);
  assert.equal(shouldReinstall(false, notes, "pick"), false);
  assert.equal(shouldReinstall(false, changes.handBack()(notes), "notes"), false);
  assert.equal(shouldReinstall(false, { ...free, takeover: { reason: "person", since: 1 } }, "notes"), false);
  assert.equal(shouldReinstall(false, null, "notes"), false);
});

test("redact: linear on hostile input, and capped at 4000 characters", () => {
  for (const unit of ["token", "api_key_"]) {
    const s = unit.repeat(Math.ceil(20_000 / unit.length)).slice(0, 20_000);
    const t0 = performance.now();
    redact(s);
    assert.ok(performance.now() - t0 < 200, `${unit}: ${performance.now() - t0} ms`);
  }
  const long = "a ".repeat(3000);
  const out = redact(long);
  assert.equal(out, long.slice(0, 4000) + "…");
  assert.equal(redact("x".repeat(4000)), "x".repeat(4000));
});
