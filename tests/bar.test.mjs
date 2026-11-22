import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionText } from "../src/mods/dock-attention/view.js";

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
