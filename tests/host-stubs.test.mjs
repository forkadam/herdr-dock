// The host stubs themselves: element chains accept only methods Herdr's gpui-kit.d.ts declares.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./fixtures/host-stubs.mjs";

const { div, svg } = await import("gpui-kit");

test("host stubs: an element method Herdr doesn't declare throws; declared ones chain", () => {
  assert.doesNotThrow(() => div().id("x").px(8).text_color("red").truncate().when(true, (el) => el.bg("blue")));
  assert.doesNotThrow(() => svg("a.svg").size(12).spin(900));
  assert.throws(() => div().text_colr("red"), /text_colr is not an element method/);
});
