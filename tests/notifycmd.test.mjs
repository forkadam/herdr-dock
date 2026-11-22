import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyCommandName, parseNotifyCommand, applyNotifyCommand, NOTIFY_DIALOG } from "../src/shared/notifycmd.js";

test("notify commands round-trip, including unicode in the toast", () => {
  const n = { title: "Pipeline failed ✕", body: "api · main", level: "error", action: { name: "dock-core.git.show.abc" } };
  assert.deepEqual(parseNotifyCommand(notifyCommandName("notify.add", { n })), { cmd: "add", n });
  assert.deepEqual(parseNotifyCommand(notifyCommandName("notify.clear", { id: "k1" })), { cmd: "clear", id: "k1" });
  for (const c of ["clearall", "read", "show"]) {
    assert.equal(notifyCommandName(`notify.${c}`), `notify.${c}`);
    assert.deepEqual(parseNotifyCommand(`notify.${c}`), { cmd: c });
  }
  assert.equal(parseNotifyCommand("notify.add.!!"), null); assert.equal(parseNotifyCommand("git.refresh"), null);
  assert.throws(() => notifyCommandName("notify.clear", {}));
});

test("notifyCommandName rejects bad args and unknown names; parse rejects malformed payloads", () => {
  assert.throws(() => notifyCommandName("notify.add", {}), /n/);
  assert.throws(() => notifyCommandName("notify.add", { n: null }));
  assert.throws(() => notifyCommandName("notify.nope"), /unknown/);
  assert.match(notifyCommandName("notify.add", { n: { title: "x" } }), /^notify\.add\.[A-Za-z0-9_-]+$/);
  assert.equal(parseNotifyCommand("notify.add"), null);
  assert.equal(parseNotifyCommand("notify.clear"), null);
  assert.equal(parseNotifyCommand(`notify.add.${Buffer.from("not json").toString("base64url")}`), null);
  assert.equal(parseNotifyCommand(`notify.add.${Buffer.from("[1]").toString("base64url")}`), null);
  assert.equal(parseNotifyCommand("notify.read.x"), null);
  assert.equal(parseNotifyCommand(null), null);
});

test("applyNotifyCommand: two adds in a row keep both", () => {
  let list = applyNotifyCommand([], { cmd: "add", n: { title: "a" } }, 1, "a");
  list = applyNotifyCommand(list, { cmd: "add", n: { title: "b" } }, 2, "b");
  assert.deepEqual(list.map((x) => [x.id, x.title, x.at]), [["b", "b", 2], ["a", "a", 1]]);
});

test("applyNotifyCommand: clear then add keeps the new item", () => {
  let list = applyNotifyCommand([], { cmd: "add", n: { title: "a" } }, 1, "a");
  list = applyNotifyCommand(list, { cmd: "clear", id: "a" }, 2, "x");
  list = applyNotifyCommand(list, { cmd: "add", n: { title: "b" } }, 3, "b");
  assert.deepEqual(list.map((x) => x.id), ["b"]);
});

test("applyNotifyCommand: clearall empties, read marks all read, show leaves the list", () => {
  let list = applyNotifyCommand([], { cmd: "add", n: { title: "a" } }, 1, "a");
  list = applyNotifyCommand(list, { cmd: "add", n: { title: "b" } }, 2, "b");
  assert.equal(applyNotifyCommand(list, { cmd: "show" }, 3, "c"), list);
  assert.ok(applyNotifyCommand(list, { cmd: "read" }, 3, "c").every((x) => x.read));
  assert.deepEqual(applyNotifyCommand(list, { cmd: "clearall" }, 3, "c"), []);
});

test("the notifications dialog spec", () => {
  assert.deepEqual(NOTIFY_DIALOG, { mod: "dock-notifications", kind: "dialog", width: 520, height: 0.7 });
});
