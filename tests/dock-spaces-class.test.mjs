// Loads dock-spaces' real class against stubbed host modules: agent rows and peer-name passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetHost } from "./fixtures/host-stubs.mjs";

const herdr = await import("herdr");
const { default: Spaces } = await import("../src/mods/dock-spaces/main.js");
const cx = { spawn: (f) => { cx.last = f(cx); }, notify() {}, stop_propagation() {}, timer: { every() {} } };
const left = (px) => ({ id: "root", children: [{ id: "dock-left", size: { px } }] });

test("dock-spaces: agent rows count toward the active space's place; the narrow rail draws none", () => {
  resetHost();
  herdr.data.spaces = [{ id: "A", name: "api", tabs: [{ id: "ta" }], active: false }, { id: "B", name: "web", tabs: [{ id: "tb" }], active: true }];
  herdr.data.agents = [{ address: "t1", space: "A", pane: "p1", status: "idle", program: {}, title: "one" },
                       { address: "t2", space: "A", pane: "p2", status: "working", program: {}, title: "two" }];
  herdr.data.layout = left(300);
  const s = new Spaces(); s.init({}, cx);
  s.render(cx);
  assert.equal(s.activeAt, 3);
  herdr.data.layout = left(100);
  s.render(cx);
  assert.equal(s.activeAt, 1);
});

test("dock-spaces: a name pass replaces the names, never merges into old ones", async () => {
  resetHost();
  herdr.data.checking = false;
  herdr.data.layout = left(300);
  herdr.data.spaces = [{ id: "A", name: "api", tabs: [{ id: "ta" }], active: true }];
  herdr.data.agents = [{ address: "t1", space: "A", pane: "p1", app: "claude-code", program: { key: "claude" }, status: "idle", title: "" }];
  herdr.data.hc = () => ({ code: 0, stdout: JSON.stringify({ foreground: { pid: 42 }, created_ms: Date.now() - 60_000 }), stderr: "" });
  herdr.data.files.set("C:/home/.claude/sessions/42.json", JSON.stringify({ pid: 42, sessionId: "73636264-03cb-4b62-bb2d-36ccfbcbee15", kind: "interactive", startedAt: Date.now() - 1000, name: "api-7a" }));
  const s = new Spaces(); s.init({}, cx); s.render(cx);
  s.refreshNames(cx); await cx.last;
  assert.equal(s.names.get("t1")?.name, "api-7a");
  herdr.data.files.clear();
  s.refreshNames(cx); await cx.last;
  assert.equal(s.names.has("t1"), false);
});
