import test from "node:test";
import assert from "node:assert/strict";
import { jpegSize, toPage, drawnHeight, keyEvents, wheelEvent, mouseEvents, FrameRing, streamStep, afterLoss } from "../src/shared/browser/frame.js";

function jpeg(w, h) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc4, 0x00, 0x04, 0x00, 0x00, // DHT, must be skipped
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);
}

test("jpegSize", () => {
  assert.deepEqual(jpegSize(jpeg(1280, 633)), { w: 1280, h: 633 });
  assert.equal(jpegSize(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0])), null);
  assert.equal(jpegSize(null), null);
});
test("toPage and drawnHeight", () => {
  assert.deepEqual(toPage({ x: 440, y: 100 }, 1280, 880), { x: 640, y: 145 });
  assert.equal(drawnHeight({ w: 1280, h: 633 }, 640), 316.5);
});
test("keyEvents", () => {
  const m = { control: false, alt: false, shift: false, platform: false, function: false };
  assert.deepEqual(keyEvents({ key: "enter", modifiers: m }), [
    { type: "input_keyboard", eventType: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", modifiers: 0 },
    { type: "input_keyboard", eventType: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 0 },
  ]);
  assert.equal(keyEvents({ key: "a", key_char: "a", modifiers: m })[0].text, "a");
  const sh = keyEvents({ key: "a", key_char: "A", modifiers: { ...m, shift: true } })[0];
  assert.equal(sh.key, "A"); assert.equal(sh.text, "A"); assert.equal(sh.modifiers, 8);
  const ct = keyEvents({ key: "a", key_char: "a", modifiers: { ...m, control: true } })[0];
  assert.equal(ct.modifiers, 2); assert.equal("text" in ct, false);
  assert.equal(keyEvents({ key: "backspace", modifiers: m })[0].key, "Backspace");
  assert.equal(keyEvents({ key: "space", modifiers: m })[0].text, " ");
  assert.equal(keyEvents({ key: "pagedown", modifiers: m })[0].key, "PageDown");
  assert.equal(keyEvents({ key: "left", modifiers: m })[0].key, "ArrowLeft");
  assert.equal(keyEvents({ key: "platform", modifiers: m }).length, 0);
});
test("keyEvents: named keys carry the Windows key code Chrome edits with", () => {
  const m = { control: false, alt: false, shift: false, platform: false, function: false };
  const codes = { backspace: 8, tab: 9, enter: 13, escape: 27, space: 32, pageup: 33, pagedown: 34, end: 35, home: 36,
    left: 37, up: 38, right: 39, down: 40, delete: 46 };
  for (const [name, vk] of Object.entries(codes)) {
    const [down, up] = keyEvents({ key: name, modifiers: m });
    assert.equal(down.windowsVirtualKeyCode, vk, name);
    assert.equal(up.windowsVirtualKeyCode, vk, name);
    assert.equal(down.code, up.code);
  }
  assert.equal(keyEvents({ key: "space", modifiers: m })[0].code, "Space");
  assert.equal(keyEvents({ key: "left", modifiers: m })[0].code, "ArrowLeft");
  // A typed character carries its text only.
  const a = keyEvents({ key: "a", key_char: "a", modifiers: m })[0];
  assert.equal("windowsVirtualKeyCode" in a, false);
  assert.equal("code" in a, false);
});
test("wheel and mouse", () => {
  const w = wheelEvent({ delta: { x: 3, y: -10 }, local_position: { x: 440, y: 100 } }, 1280, 880);
  assert.equal(w.deltaX, -3); assert.equal(w.deltaY, 10); assert.equal(w.x, 640); assert.equal(w.y, 145);
  const e = { local_position: { x: 10, y: 10 }, click_count: 2 };
  assert.deepEqual(mouseEvents("down", e, 100, 100).map((x) => x.eventType), ["mouseMoved", "mousePressed"]);
  assert.equal(mouseEvents("down", e, 100, 100)[1].clickCount, 2);
  assert.equal(mouseEvents("down", { local_position: { x: 1, y: 1 } }, 100, 100)[1].clickCount, 1);
  assert.deepEqual(mouseEvents("up", e, 100, 100).map((x) => x.eventType), ["mouseReleased"]);
  assert.deepEqual(mouseEvents("move", e, 100, 100).map((x) => x.eventType), ["mouseMoved"]);
  assert.equal(mouseEvents("move", e, 100, 100)[0].button, "none");
  assert.equal(mouseEvents("move", e, 100, 100, true)[0].button, "left");
  assert.equal(mouseEvents("down", e, 100, 100)[0].button, "none");
  assert.equal(mouseEvents("down", e, 100, 100)[1].button, "left");
});
test("FrameRing keeps 6 and drops the oldest", () => {
  const r = new FrameRing("herdr-dock/browser/frames/t3");
  assert.equal(r.current, null);
  let last;
  for (let i = 1; i <= 6; i++) { last = r.next(i); assert.deepEqual(last.drop, []); }
  assert.equal(last.rel, "herdr-dock/browser/frames/t3/f6.jpg");
  const n = r.next(7);
  assert.deepEqual(n.drop, ["herdr-dock/browser/frames/t3/f1.jpg"]);
  assert.equal(r.current, "herdr-dock/browser/frames/t3/f7.jpg");
  assert.equal(r.prev, "herdr-dock/browser/frames/t3/f6.jpg");
  assert.equal(r.clear().length, 6);
  assert.equal(r.current, null);
});
test("streamStep", () => {
  let s = {};
  s = streamStep(s, { type: "url", url: "https://a.test" });
  assert.equal(s.url, "https://a.test");
  s = streamStep(s, { type: "tabs", tabs: [{ id: 1 }] });
  assert.equal(s.tabs.length, 1);
  s = streamStep(s, { type: "status", connected: true });
  assert.deepEqual(s.status, { type: "status", connected: true });
  for (let i = 0; i < 25; i++) s = streamStep(s, { type: "console", level: "error", text: `e${i}` });
  s = streamStep(s, { type: "console", level: "log", text: "x" });
  assert.equal(s.errors, 25);
  assert.equal(s.errorTexts.length, 20);
  assert.equal(s.errorTexts[19], "e24");
  assert.equal(streamStep(s, { type: "console", type2: 1, args: [{ value: "boom" }], level: "error" }).errorTexts.at(-1), "boom");
  assert.equal(streamStep(s, { error: "x" }).phase, "lost");
});
test("afterLoss: socket lost with no session → closed", () => {
  assert.equal(afterLoss({ phase: "lost" }, false, 0), "closed");
  const s = { phase: "lost" };
  assert.equal(afterLoss(s, true, 10000), "reconnect");
  assert.equal(s.lastReconnect, 10000);
  assert.equal(afterLoss(s, true, 11000), "wait");
  assert.equal(afterLoss(s, true, 12000), "reconnect");
});

test("decodeBase64 matches Buffer", async () => {
  const { decodeBase64 } = await import("../src/shared/browser/frame.js");
  for (const len of [0, 1, 2, 3, 4, 5, 100, 257]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
    const b64 = Buffer.from(bytes).toString("base64");
    assert.deepEqual([...decodeBase64(b64)], [...bytes], `length ${len}`);
  }
});

test("streamPort: only a connected daemon's port", async () => {
  const { streamPort } = await import("../src/shared/browser/frame.js");
  assert.equal(streamPort('{"success":true,"data":{"connected":true,"port":33781}}'), 33781);
  assert.equal(streamPort('{"success":true,"data":{"connected":false,"port":36095}}'), 0);
  assert.equal(streamPort('{"success":false,"data":null,"error":"x"}'), 0);
  assert.equal(streamPort(""), 0);
});

test("pageHeading: active tab, record title while the URL is the record's", async () => {
  const { pageHeading } = await import("../src/shared/browser/frame.js");
  const rec = { url: "https://en.wikipedia.org/wiki/Web_browser", title: "Web browser - Wikipedia" };
  const bare = { tabs: [{ active: true, title: "en.wikipedia.org/wiki/Web_browser", url: rec.url }] };
  assert.deepEqual(pageHeading(rec, bare), { title: "Web browser - Wikipedia", url: rec.url });
  const moved = { tabs: [{ active: false, title: "Old", url: rec.url }, { active: true, title: "Example Domain", url: "https://example.com/" }] };
  assert.deepEqual(pageHeading(rec, moved), { title: "Example Domain", url: "https://example.com/" });
  assert.deepEqual(pageHeading(rec, {}), { title: "Web browser - Wikipedia", url: rec.url });
  assert.deepEqual(pageHeading(rec, { tabs: [{ active: true, title: "example.com/", url: "https://example.com/" }] }), { title: "example.com/", url: "https://example.com/" });
});

test("streamStep: a console error sent twice counts once", () => {
  const m = { type: "console", level: "error", text: "boom", timestamp: 5 };
  let s = streamStep({}, m);
  s = streamStep(s, { ...m });
  assert.equal(s.errors, 1);
  s = streamStep(s, { ...m, timestamp: 6 });
  assert.equal(s.errors, 2);
  assert.deepEqual(s.errorTexts, ["boom", "boom"]);
});
