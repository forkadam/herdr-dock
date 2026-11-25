// The Render panel's formatted copy (src/app/clipboard.js): osascript's pasteboard script, never the real clipboard here.
import test from "node:test";
import assert from "node:assert/strict";
import { copyHtml, MAC_HTML_COPY } from "../src/app/clipboard.js";

test("copyHtml: runs osascript's JavaScript with the payload on stdin", () => {
  let call;
  const r = copyHtml({ html: "<b>x</b>", text: "x" }, { platform: "darwin", run: (cmd, args, input) => { call = { cmd, args, input }; return { status: 0, stdout: "", stderr: "" }; } });
  assert.deepEqual(r, { ok: true });
  assert.equal(call.cmd, "/usr/bin/osascript");
  assert.deepEqual(call.args, ["-l", "JavaScript", "-e", MAC_HTML_COPY]);
  assert.deepEqual(JSON.parse(call.input), { html: "<b>x</b>", text: "x" });
  assert.match(MAC_HTML_COPY, /NSPasteboardTypeHTML/);
});

test("copyHtml: a failed or timed-out run says why; off macOS it is refused", () => {
  assert.equal(copyHtml({ html: "h", text: "t" }, { platform: "darwin", run: () => ({ status: 1, stderr: "Cannot write clipboard" }) }).error, "Cannot write clipboard");
  assert.match(copyHtml({ html: "h", text: "t" }, { platform: "darwin", run: () => ({ status: null, error: new Error("spawnSync ETIMEDOUT") }) }).error, /ETIMEDOUT/);
  assert.equal(copyHtml({ html: "h", text: "t" }, { platform: "linux", run: () => assert.fail("must not run") }).error, "formatted copy works on macOS only");
});
