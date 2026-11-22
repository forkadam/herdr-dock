import test from "node:test";
import assert from "node:assert/strict";
import { agentKind, pickAgent, transcriptPath } from "../src/shared/render/agent.js";

const A = (o) => ({ address: "t1", pane: "p1", tab: "tab1", space: "s1", status: "idle", program: { key: "claude", agent: true }, ...o });

test("pickAgent: the focused pane's agent, else the focused tab's first, else none", () => {
  const list = [A({ address: "t1", pane: "p1", tab: "tab1" }), A({ address: "t2", pane: "p2", tab: "tab1" }), A({ address: "t3", pane: "p3", tab: "tab2" })];
  assert.equal(pickAgent({ pane: "p2", tab: "tab1" }, list).address, "t2");
  assert.equal(pickAgent({ pane: "pX", tab: "tab1" }, list).address, "t1");
  assert.equal(pickAgent({ pane: null, terminal: "t3", tab: "tab2" }, list).address, "t3");
  assert.equal(pickAgent({ pane: "pX", tab: "tabZ" }, list), null);
  assert.equal(pickAgent(null, list), null);
});

test("agentKind: Claude Code or Codex (by program or reported app), else null; remote agents are left out", () => {
  assert.equal(agentKind(A({})), "claude");
  assert.equal(agentKind(A({ program: { key: "codex" } })), "codex");
  assert.equal(agentKind(A({ program: { key: "agent" }, app: "claude-code" })), "claude");
  assert.equal(agentKind(A({ program: { key: "pi" } })), null);
  assert.equal(agentKind(A({ address: "vps/t7" })), null);
});

test("transcriptPath: from hc's info and the session record, ~/.claude/projects/<slug>/<session>.jsonl", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const info = { foreground: { pid: 98650 }, created_ms: now - 3600e3 };
  const record = JSON.stringify({ pid: 98650, kind: "interactive", sessionId: "56984f5d-1dc2-41f6-b2c5-5355425bbb39", startedAt: now - 3000e3, cwd: "/home/u/Projects/herdr-dock" });
  assert.equal(transcriptPath("/home/u", info, record, now), "/home/u/.claude/projects/-home-u-Projects-herdr-dock/56984f5d-1dc2-41f6-b2c5-5355425bbb39.jsonl");
  assert.equal(transcriptPath("/home/u", info, JSON.stringify({ ...JSON.parse(record), pid: 1 }), now), null);
  assert.equal(transcriptPath("/home/u", info, JSON.stringify({ ...JSON.parse(record), cwd: undefined }), now), null);
  assert.equal(transcriptPath("/home/u", null, record, now), null);
});
