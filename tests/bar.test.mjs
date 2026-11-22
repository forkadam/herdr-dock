import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionText, attentionBell } from "../src/mods/dock-attention/view.js";
import { systemTips } from "../src/mods/dock-system/view.js";

test("attentionText shows need-you in red and unread dim", () => {
  assert.deepEqual(attentionText({ needYou: 2, unread: 3 }), [
    { text: "⚠ 2 need you", tone: "bad" },
    { text: "3 unread", tone: "dim" },
  ]);
});

test("attentionText leaves out a part at zero", () => {
  assert.deepEqual(attentionText({ needYou: 0, unread: 1 }), [{ text: "1 unread", tone: "dim" }]);
  assert.deepEqual(attentionText({ needYou: 1, unread: 0 }), [{ text: "⚠ 1 need you", tone: "bad" }]);
});

test("attentionText says No notifications when both are zero", () => {
  assert.deepEqual(attentionText({ needYou: 0, unread: 0 }), [{ text: "No notifications", tone: "dim" }]);
});

test("attentionBell: red when something needs you, accent for unread only, dim when nothing; tip says what", () => {
  assert.deepEqual(attentionBell({ needYou: 2, unread: 3 }), { tone: "bad", dot: true, tip: "⚠ 2 need you · 3 unread" });
  assert.deepEqual(attentionBell({ needYou: 0, unread: 1 }), { tone: "unread", dot: true, tip: "1 unread" });
  assert.deepEqual(attentionBell({ needYou: 0, unread: 0 }), { tone: "none", dot: false, tip: "No notifications" });
});

const NOW = 1_000_000;
const SAMPLE = { cpu: 34, mem: 61, diskFree: 50, cores: 8, at: NOW - 1000 };

test("systemTips adds Herdr's own CPU and memory from a fresh sample", () => {
  assert.deepEqual(systemTips(SAMPLE, { cpu: 2, mem: 210 * 2 ** 20, at: NOW - 5000 }, NOW),
    { cpu: "CPU 34% · Herdr 2%", mem: "Memory 61% · Herdr 210 MB" });
});

test("systemTips keeps Herdr's CPU decimal as given", () => {
  assert.equal(systemTips(SAMPLE, { cpu: 0.1, mem: 210 * 2 ** 20, at: NOW }, NOW).cpu, "CPU 34% · Herdr 0.1%");
  assert.equal(systemTips(SAMPLE, { cpu: 2.5, mem: 210 * 2 ** 20, at: NOW }, NOW).cpu, "CPU 34% · Herdr 2.5%");
});

test("systemTips shows Herdr's memory past 1 GiB in GB", () => {
  assert.equal(systemTips(SAMPLE, { cpu: 2, mem: 1.5 * 2 ** 30, at: NOW }, NOW).mem, "Memory 61% · Herdr 1.5 GB");
});

test("systemTips leaves Herdr out of the CPU tip when its cpu is null", () => {
  assert.deepEqual(systemTips(SAMPLE, { cpu: null, mem: 210 * 2 ** 20, at: NOW }, NOW),
    { cpu: "CPU 34%", mem: "Memory 61% · Herdr 210 MB" });
});

test("systemTips shows just the system figures without a fresh Herdr sample", () => {
  const plain = { cpu: "CPU 34%", mem: "Memory 61%" };
  assert.deepEqual(systemTips(SAMPLE, { cpu: 2, mem: 210 * 2 ** 20, at: NOW - 30001 }, NOW), plain);
  assert.deepEqual(systemTips(SAMPLE, null, NOW), plain);
  assert.deepEqual(systemTips(SAMPLE, undefined, NOW), plain);
});

test("systemTips shows 1023.6 MiB as 1.0 GB, not 1024 MB", () => {
  assert.equal(systemTips(SAMPLE, { cpu: 2, mem: 1023.6 * 2 ** 20, at: NOW }, NOW).mem, "Memory 61% · Herdr 1 GB");
});
