import test from "node:test";
import assert from "node:assert/strict";
import {
  panelMode, inControl, controlText, changes, handoffNotices, rememberNotified, sizeCommands, newTabId,
  restoreCommands, fitWidth, bigWindow, browserShowName, parseBrowserShow, finishOf, windowLeft, NO_TERMINAL,
} from "../src/shared/browser/panel.js";
import { parseControl, waitOutcome, personHas } from "../src/shared/browser/registry.js";

const MIN = 60_000;
const T0 = 1_000_000;
const session = (handoff = null) => ({ v: 1, session: "dock-x-t1", terminal: "t1", profile: "clean", port: 1, url: "u", title: "T", opened: 0, handoff, terminalCreated: 5 });
const free = parseControl(null);
const ho = { id: "h1", message: "Sign in, then press Done", since: T0 };

test("panelMode: view, take-over, an open handoff, an answered or timed out one", () => {
  assert.equal(panelMode(session(), free, T0, 15).kind, "view");
  assert.equal(panelMode(session(), { ...free, takeover: { reason: "person", since: T0 } }, T0, 15).kind, "takeover");
  const m = panelMode(session(ho), free, T0 + MIN, 15);
  assert.equal(m.kind, "handoff");
  assert.equal(m.handoff.message, "Sign in, then press Done");
  // A take-over during a handoff still shows the handoff (its Done and Cancel).
  assert.equal(panelMode(session(ho), { ...free, takeover: { reason: "window", since: T0 } }, T0, 15).kind, "handoff");
  assert.equal(panelMode(session(ho), { ...free, answer: { id: "h1", value: "done" } }, T0, 15).kind, "view");
  assert.equal(panelMode(session(ho), { ...free, answer: { id: "old", value: "done" } }, T0, 15).kind, "handoff");
  assert.equal(panelMode(session(ho), free, T0 + 16 * MIN, 15).kind, "view");
  assert.equal(panelMode(session(ho), null, T0, 15).kind, "handoff");
  assert.ok(inControl({ kind: "handoff" }) && inControl({ kind: "takeover" }) && !inControl({ kind: "view" }));
});

test("controlText: stamped with the terminal's creation time, so browse reads the answer", () => {
  const text = controlText(null, 5, changes.answer("h1", "done"));
  const c = parseControl(text);
  assert.deepEqual(c.answer, { id: "h1", value: "done" });
  assert.equal(c.terminalCreated, 5);
  assert.equal(c.takeover, null);
  // What browse's wait then decides.
  assert.equal(waitOutcome(session(ho), c, T0, 15), "done");
  assert.equal(waitOutcome(session(ho), parseControl(controlText(null, 5, changes.answer("h1", "cancel"))), T0, 15), "cancel");
});

test("controlText: take over, hand back, a stale record starts over, no creation time known", () => {
  const taken = controlText(null, 5, changes.takeOver(T0));
  assert.deepEqual(parseControl(taken).takeover, { reason: "person", since: T0 });
  assert.equal(personHas(session(), parseControl(taken), T0, 15), true);
  // Taking over again keeps the first time.
  assert.equal(parseControl(controlText(taken, 5, changes.takeOver(T0 + 9))).takeover.since, T0);
  assert.equal(parseControl(controlText(taken, 5, changes.handBack())).takeover, null);
  assert.equal(parseControl(controlText(taken, 5, changes.window(T0 + 1))).takeover.reason, "window");
  // An older terminal's record (another creation time): its answer doesn't carry over.
  const old = JSON.stringify({ v: 1, takeover: null, answer: { id: "h1", value: "done" }, terminalCreated: 4 });
  const fresh = parseControl(controlText(old, 5, changes.takeOver(T0)));
  assert.equal(fresh.answer, null);
  assert.equal(fresh.terminalCreated, 5);
  // Answering clears a take-over (Done hands back).
  assert.equal(parseControl(controlText(taken, 5, changes.answer("h1", "done"))).takeover, null);
  // No creation time known (hc get failed): nothing to write, ever.
  assert.equal(controlText(null, null, changes.takeOver(T0)), null);
  assert.equal(controlText(taken, undefined, changes.handBack()), null);
  assert.equal(controlText(taken, NaN, changes.handBack()), null);
  assert.equal(NO_TERMINAL, "Can't identify this terminal (hc get failed)");
});

test("windowLeft: a real window's take-over that outlived its handoff", () => {
  const win = parseControl(controlText(controlText(null, 5, changes.window(T0)), 5, changes.windowOpened(T0 + 1)));
  // The handoff still open: the person is on it.
  assert.equal(windowLeft(session(ho), win, T0 + MIN, 15), false);
  // Timed out (the agent's wait may not have cleared it yet), or cleared by the agent's wait: left behind.
  assert.equal(windowLeft(session(ho), win, T0 + 16 * MIN, 15), true);
  assert.equal(windowLeft(session(), win, T0, 15), true);
  // Asked for but window-open never finished: the take-over is still left behind.
  assert.equal(windowLeft(session(), parseControl(controlText(null, 5, changes.window(T0))), T0, 15), true);
  // Any other take-over, or none, isn't a window's.
  assert.equal(windowLeft(session(), parseControl(controlText(null, 5, changes.takeOver(T0))), T0, 15), false);
  assert.equal(windowLeft(session(), parseControl(controlText(null, 5, changes.pick("pick", T0))), T0, 15), false);
  assert.equal(windowLeft(session(ho), free, T0 + 16 * MIN, 15), false);
  assert.equal(windowLeft(session(), null, T0, 15), false);
  // What the panel then writes frees the agent.
  const back = parseControl(controlText(JSON.stringify(win), 5, changes.handBack()));
  assert.equal(personHas(session(), back, T0, 15), false);
  assert.equal(back.window, null);
});

test("handoffNotices: open handoffs not yet announced", () => {
  const s2 = { ...session({ id: "h2", message: "two", since: T0 }), terminal: "t2" };
  const entries = [
    { session: session(ho), control: free },
    { session: s2, control: free },
    { session: { ...session(), terminal: "t3" }, control: free },
    { session: { ...session({ id: "h4", message: "x", since: T0 }), terminal: "t4" }, control: { ...free, answer: { id: "h4", value: "done" } } },
    { session: { ...session({ id: "h5", message: "x", since: T0 - 20 * MIN }), terminal: "t5" }, control: free },
  ];
  assert.deepEqual(handoffNotices(entries, ["h2"], T0, 15), [{ terminal: "t1", id: "h1", message: "Sign in, then press Done" }]);
  assert.deepEqual(handoffNotices(entries, null, T0, 15).map((n) => n.id), ["h1", "h2"]);
  assert.deepEqual(handoffNotices(null, [], T0, 15), []);
});

test("rememberNotified keeps the newest, once each", () => {
  assert.deepEqual(rememberNotified(["a", "b"], ["c"]), ["a", "b", "c"]);
  assert.deepEqual(rememberNotified(["a", "b"], ["a"]), ["b", "a"]);
  assert.deepEqual(rememberNotified(null, ["a"]), ["a"]);
  assert.deepEqual(rememberNotified(["a", "b", "c"], ["d"], 2), ["c", "d"]);
});

test("sizes: a new tab, then the size; back to the agent's tab and viewport", () => {
  assert.deepEqual(sizeCommands("phone", "https://x"), [["tab", "new", "--json", "https://x"], ["set", "device", "iPhone 16"]]);
  assert.deepEqual(sizeCommands("tablet", "https://x")[1], ["set", "device", "iPad"]);
  assert.deepEqual(sizeCommands("desktop", "https://x")[1], ["set", "viewport", "1440", "900"]);
  assert.equal(sizeCommands("watch", "https://x"), null);
  assert.equal(sizeCommands("phone", ""), null);
  assert.equal(newTabId('{"success":true,"data":{"tabId":"t4","url":"https://x"}}'), "t4");
  assert.equal(newTabId("oops"), null);
  assert.equal(newTabId('{"data":{}}'), null);
  assert.deepEqual(restoreCommands({ tabs: ["t4", "t5"], agentTab: "t1", viewport: { w: 1280, h: 633 } }), [
    ["tab", "close", "t4"], ["tab", "close", "t5"], ["tab", "t1"], ["set", "viewport", "1280", "633"],
  ]);
  assert.deepEqual(restoreCommands({ tabs: ["t4"], agentTab: null, viewport: null }), [["tab", "close", "t4"]]);
  assert.deepEqual(restoreCommands(null), []);
  assert.deepEqual(restoreCommands({ tabs: [] }), []);
});

test("fitWidth: the panel's width, no taller than the room in the big window", () => {
  assert.equal(fitWidth({ w: 1280, h: 640 }, 600, 0), 600);
  assert.equal(fitWidth({ w: 1280, h: 640 }, 1000, 400), 800);
  assert.equal(fitWidth({ w: 1280, h: 640 }, 600, 2000), 600);
  assert.equal(fitWidth(null, 600.7, 400), 600);
});

test("bigWindow and browser.show", () => {
  const w = bigWindow("t3");
  assert.equal(w.kind, "window");
  assert.equal(w.width, 0.8);
  assert.equal(w.height, 0.85);
  assert.deepEqual(w.props, { big: true, terminal: "t3" });
  assert.deepEqual(bigWindow(null).props, { big: true });
  const name = browserShowName("t12");
  assert.match(name, /^browser\.show\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseBrowserShow(name), { terminal: "t12" });
  assert.equal(parseBrowserShow("browser.show"), null);
  assert.equal(parseBrowserShow("notify.show"), null);
  assert.equal(parseBrowserShow(null), null);
});

test("the record keeps the size tabs and the real window; any copy finishes them from it", () => {
  let text = controlText(null, 5, changes.takeOver(T0));
  text = controlText(text, 5, changes.sizeTab("t4", "t1", { w: 1280, h: 633 }));
  text = controlText(text, 5, changes.sizeTab("t5", "t4", { w: 393, h: 852 })); // a later size keeps the agent's
  const c = parseControl(text);
  assert.deepEqual(c.sizes, { tabs: ["t4", "t5"], agentTab: "t1", viewport: { w: 1280, h: 633 } });
  assert.deepEqual(finishOf(c), {
    restore: [["tab", "close", "t4"], ["tab", "close", "t5"], ["tab", "t1"], ["set", "viewport", "1280", "633"]],
    window: false, stopPick: false,
  });
  // Hand back clears them, so a second Hand back (another copy) undoes nothing twice.
  const back = parseControl(controlText(text, 5, changes.handBack()));
  assert.equal(back.sizes, null);
  assert.deepEqual(finishOf(back), { restore: [], window: false, stopPick: false });
  // The real window: open only once window-open succeeded; Done or Cancel (answer) ends it.
  let w = controlText(null, 5, changes.window(T0));
  assert.equal(finishOf(parseControl(w)).window, false);
  w = controlText(w, 5, changes.windowOpened(T0 + 1));
  assert.equal(finishOf(parseControl(w)).window, true);
  assert.equal(parseControl(w).takeover.reason, "window");
  const done = parseControl(controlText(w, 5, changes.answer("h1", "done")));
  assert.equal(done.window, null);
  assert.equal(done.takeover, null);
  assert.deepEqual(done.answer, { id: "h1", value: "done" });
  assert.deepEqual(finishOf(null), { restore: [], window: false, stopPick: false });
});
