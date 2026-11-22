import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationRows } from "../src/mods/dock-notifications/view.js";

const NOW = 10_000_000_000;
const item = (o) => ({ id: "x", at: NOW, title: "T", body: null, level: "info", icon: null, action: null,
  read: false, needs: null, resolved: false, ...o });

test("empty list -> []", () => {
  assert.deepEqual(notificationRows([], NOW), []);
  assert.deepEqual(notificationRows(undefined, NOW), []);
});

test("order kept, when text for 30 s / 5 min / 2 h / 3 d", () => {
  const rows = notificationRows([
    item({ id: "a", at: NOW - 30_000 }),
    item({ id: "b", at: NOW - 5 * 60_000 }),
    item({ id: "c", at: NOW - 2 * 3_600_000 }),
    item({ id: "d", at: NOW - 3 * 86_400_000 }),
  ], NOW);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c", "d"]);
  assert.deepEqual(rows.map((r) => r.when), ["just now", "5m", "2h", "3d"]);
});

test("a row carries title, body, level, read, needs/resolved flags and hasAction", () => {
  const [needs, resolved, plain] = notificationRows([
    item({ id: "n", title: "claude needs you", body: "s / t", level: "error", needs: { kind: "agent", terminal: "t1" },
      action: { name: "agent.focus", args: { terminal: "t1" } } }),
    item({ id: "r", level: "error", needs: { kind: "pipeline", worktree: "w" }, resolved: true, read: true }),
    item({ id: "p", level: null }),
  ], NOW);
  assert.deepEqual(needs, { id: "n", title: "claude needs you", body: "s / t", level: "error", when: "just now",
    needs: true, resolved: false, read: false, hasAction: true });
  assert.equal(resolved.needs, true); assert.equal(resolved.resolved, true); assert.equal(resolved.read, true);
  assert.equal(resolved.hasAction, false);
  assert.equal(plain.needs, false); assert.equal(plain.resolved, false); assert.equal(plain.level, "info");
  assert.equal(plain.body, "");
});

test("a future timestamp reads just now", () => {
  assert.equal(notificationRows([item({ at: NOW + 5000 })], NOW)[0].when, "just now");
});
