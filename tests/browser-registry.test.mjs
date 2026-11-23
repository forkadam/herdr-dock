import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSession, parseControl, startHandoff, clearHandoff, personHas, waitOutcome,
  answer, takeOver, handBack, goneSessions, newId, isStale,
} from "../src/shared/browser/registry.js";

const MIN = 60_000;
const base = { v: 1, session: "dock-x-t1", terminal: "t1", profile: "p", port: 1, url: "u", title: "T", opened: 0, handoff: null };
const free = { v: 1, takeover: null, answer: null };
const T0 = 1_000_000;

test("personHas: fresh handoff, answered, expired", () => {
  const s = startHandoff(base, "log in", T0, "h1");
  assert.equal(personHas(s, free, T0 + MIN, 15), true);
  assert.equal(personHas(s, answer(free, "h1", "done"), T0 + MIN, 15), false);
  assert.equal(personHas(s, free, T0 + 16 * MIN, 15), false);
  assert.equal(personHas(base, takeOver(free, "person", T0), T0, 15), true);
  assert.equal(personHas(base, free, T0, 15), false);
});

test("waitOutcome", () => {
  const s = startHandoff(base, "m", T0, "h1");
  assert.equal(waitOutcome(s, answer(free, "h1", "done"), T0 + MIN, 15), "done");
  assert.equal(waitOutcome(s, answer(free, "h1", "cancel"), T0 + MIN, 15), "cancel");
  assert.equal(waitOutcome(s, free, T0 + 16 * MIN, 15), "timeout");
  assert.equal(waitOutcome(s, free, T0 + MIN, 15), "waiting");
  assert.equal(waitOutcome(base, takeOver(free, "pick", T0), T0, 15), "waiting");
  assert.equal(waitOutcome(base, free, T0, 15), "free");
});

test("stale answer id is ignored", () => {
  const s = startHandoff(base, "m", T0, "new");
  assert.equal(waitOutcome(s, answer(free, "old", "done"), T0 + MIN, 15), "waiting");
  assert.equal(personHas(s, answer(free, "old", "done"), T0 + MIN, 15), true);
});

test("transitions do not mutate", () => {
  const s = startHandoff(base, "m", T0, "h1");
  assert.equal(base.handoff, null);
  assert.deepEqual(s.handoff, { id: "h1", message: "m", since: T0 });
  assert.equal(clearHandoff(s).handoff, null);
  assert.notEqual(s.handoff, null);
  const c = takeOver(free, "notes", T0);
  assert.deepEqual(c.takeover, { reason: "notes", since: T0 });
  assert.equal(free.takeover, null);
  assert.equal(handBack(c).takeover, null);
  assert.deepEqual(answer(free, "h1", "done").answer, { id: "h1", value: "done" });
});

test("goneSessions", () => {
  const a = { ...base, terminal: "t1" }, b = { ...base, terminal: "t2" };
  assert.deepEqual(goneSessions([a, b], new Set(["t2"])), [a]);
  assert.deepEqual(goneSessions([a, b], new Set(["t1", "t2"])), []);
});

test("parseControl defaults", () => {
  assert.deepEqual(parseControl("garbage"), free);
  assert.deepEqual(parseControl(""), free);
  assert.deepEqual(parseControl(undefined), free);
  assert.deepEqual(parseControl('{"v":1,"takeover":{"reason":"bogus","since":1},"answer":{"id":"a","value":"x"}}'), free);
  assert.equal(parseControl('{"v":1,"takeover":{"reason":"person","since":5}}').takeover.reason, "person");
});

test("parseSession", () => {
  assert.equal(parseSession("nope"), null);
  assert.equal(parseSession(JSON.stringify({ v: 1, terminal: "t1" })), null);
  assert.equal(parseSession(JSON.stringify({ v: 1, session: "s" })), null);
  const s = parseSession(JSON.stringify(base));
  assert.equal(s.session, "dock-x-t1");
  assert.equal(s.handoff, null);
});

test("newId", () => {
  assert.match(newId(), /^[a-z0-9]{6,16}$/);
  assert.notEqual(newId(), newId());
});

test("isStale", () => {
  assert.equal(isStale({ ...base, terminalCreated: 5 }, 5), false);
  assert.equal(isStale({ ...base, terminalCreated: 5 }, 6), true);
  assert.equal(isStale(base, 5), true);
  assert.equal(isStale(null, 5), true);
  assert.equal(isStale({ ...free, terminalCreated: 7 }, 7), false);
});

test("terminalCreated kept or omitted by parsers; takeOver sets it", () => {
  assert.equal(parseSession(JSON.stringify({ ...base, terminalCreated: 9 })).terminalCreated, 9);
  assert.equal("terminalCreated" in parseSession(JSON.stringify({ ...base, terminalCreated: "x" })), false);
  assert.equal(parseControl('{"v":1,"terminalCreated":9}').terminalCreated, 9);
  assert.equal("terminalCreated" in parseControl('{"v":1,"terminalCreated":null}'), false);
  assert.equal(takeOver(free, "person", T0, 42).terminalCreated, 42);
  assert.equal("terminalCreated" in takeOver(free, "person", T0), false);
  assert.equal(startHandoff({ ...base, terminalCreated: 3 }, "m", T0, "h").terminalCreated, 3);
});

test("bad handoffMinutes counts as 15", () => {
  const s = startHandoff(base, "m", T0, "h1");
  for (const m of [NaN, 0, -3, undefined]) {
    assert.equal(waitOutcome(s, free, T0 + 16 * MIN, m), "timeout");
    assert.equal(waitOutcome(s, free, T0 + MIN, m), "waiting");
    assert.equal(personHas(s, free, T0 + 16 * MIN, m), false);
  }
});
