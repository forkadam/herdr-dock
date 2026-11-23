// The action rules (src/shared/jira/actions.js): which Start / Finish messages an issue gets, first matching rule wins.
import test from "node:test";
import assert from "node:assert/strict";
import { matchAction } from "../src/shared/jira/actions.js";

const NONE = { start: null, finish: null };

const rules = [
  { project: "SEC", type: "Bug", start: "/triage {key}", finish: "/resolve {key}" },
  { project: "SEC", start: "/triage {key}" },
  { subtask: true, parentType: ["Story", "Enhancement"], finish: "/report {key}" },
  { type: "Bug", finish: "/resolve {key}" },
];
test("matchAction: first match wins", () => {
  assert.deepEqual(matchAction(rules, { project: "SEC", type: "Bug" }), { start: "/triage {key}", finish: "/resolve {key}" });
  assert.deepEqual(matchAction(rules, { project: "SEC", type: "Task" }), { start: "/triage {key}", finish: null });
  assert.deepEqual(matchAction(rules, { project: "WEB", type: "Sub-task", subtask: true, parent: { type: "Story" } }), { start: null, finish: "/report {key}" });
  assert.deepEqual(matchAction(rules, { project: "WEB", type: "Sub-task", subtask: true, parent: { type: "Epic" } }), { start: null, finish: null });
  assert.deepEqual(matchAction([], { project: "WEB" }), { start: null, finish: null });
});

test("matchAction: the first matching rule supplies both messages, a later rule never fills in the one it lacks", () => {
  const list = [{ project: "SEC", start: "/triage {key}" }, { project: "SEC", finish: "/resolve {key}" }];
  assert.deepEqual(matchAction(list, { project: "SEC", type: "Bug" }), { start: "/triage {key}", finish: null });
});

test("matchAction: every key a rule gives has to match", () => {
  const list = [{ project: "SEC", type: "Bug", subtask: false, start: "go" }];
  assert.deepEqual(matchAction(list, { project: "SEC", type: "Bug", subtask: false }), { start: "go", finish: null });
  assert.deepEqual(matchAction(list, { project: "WEB", type: "Bug", subtask: false }), NONE);
  assert.deepEqual(matchAction(list, { project: "SEC", type: "Task", subtask: false }), NONE);
  assert.deepEqual(matchAction(list, { project: "SEC", type: "Bug", subtask: true }), NONE);
});

test("matchAction: a rule without match keys matches every issue, even a bare one", () => {
  const list = [{ project: "SEC", start: "a" }, { start: "any", finish: "done" }];
  assert.deepEqual(matchAction(list, { project: "WEB", type: "Task" }), { start: "any", finish: "done" });
  assert.deepEqual(matchAction(list, {}), { start: "any", finish: "done" });
});

test("matchAction: project and type are exact and case-sensitive", () => {
  const list = [{ project: "SEC", type: "Bug", start: "go" }];
  assert.deepEqual(matchAction(list, { project: "sec", type: "Bug" }), NONE);
  assert.deepEqual(matchAction(list, { project: "SEC", type: "bug" }), NONE);
  assert.deepEqual(matchAction(list, { project: "SEC2", type: "Bug" }), NONE);
  assert.deepEqual(matchAction(list, { project: "SEC", type: "Bug " }), NONE);
});

test("matchAction: an issue without a project field matches by its key's prefix (before the last dash)", () => {
  const list = [{ project: "SEC", start: "go" }, { project: "MY-APP", start: "dash" }];
  assert.deepEqual(matchAction(list, { key: "SEC-12", type: "Bug" }), { start: "go", finish: null });
  assert.deepEqual(matchAction(list, { key: "MY-APP-3" }), { start: "dash", finish: null });
  assert.deepEqual(matchAction(list, { key: "WEB-12" }), NONE);
  assert.deepEqual(matchAction(list, { key: "SEC12" }), NONE);
  assert.deepEqual(matchAction(list, { key: "-12" }), NONE);
  // a project field present is the one that counts, the key is no fallback for a different one
  assert.deepEqual(matchAction(list, { key: "SEC-12", project: "WEB" }), NONE);
});

test("matchAction: subtask false matches an issue whose subtask is false or missing, subtask true only a sub-task", () => {
  const plain = [{ subtask: false, start: "go" }];
  assert.deepEqual(matchAction(plain, { type: "Task", subtask: false }), { start: "go", finish: null });
  assert.deepEqual(matchAction(plain, { type: "Task" }), { start: "go", finish: null });
  assert.deepEqual(matchAction(plain, { type: "Task", subtask: null }), { start: "go", finish: null });
  assert.deepEqual(matchAction(plain, { type: "Sub-task", subtask: true }), NONE);
  const sub = [{ subtask: true, start: "go" }];
  assert.deepEqual(matchAction(sub, { type: "Sub-task", subtask: true }), { start: "go", finish: null });
  assert.deepEqual(matchAction(sub, { type: "Task", subtask: false }), NONE);
  assert.deepEqual(matchAction(sub, { type: "Task" }), NONE);
});

test("matchAction: parentType matches when the parent's type is one of its entries, never for an issue without a parent", () => {
  const list = [{ parentType: ["Story", "Epic"], start: "go" }];
  assert.deepEqual(matchAction(list, { parent: { key: "WEB-1", type: "Story" } }), { start: "go", finish: null });
  assert.deepEqual(matchAction(list, { parent: { key: "WEB-1", type: "Epic" } }), { start: "go", finish: null });
  assert.deepEqual(matchAction(list, { parent: { key: "WEB-1", type: "Bug" } }), NONE);
  assert.deepEqual(matchAction(list, { parent: { key: "WEB-1", type: "story" } }), NONE);
  assert.deepEqual(matchAction(list, { parent: { key: "WEB-1", type: null } }), NONE);
  assert.deepEqual(matchAction(list, { parent: null }), NONE);
  assert.deepEqual(matchAction(list, {}), NONE);
});

test("matchAction: a rules value that is not a list behaves as no rules", () => {
  for (const bad of [undefined, null, "SEC", 7, { project: "SEC", start: "go" }]) assert.deepEqual(matchAction(bad, { project: "SEC" }), NONE);
});

test("matchAction: an issue that is not there matches only a rule without match keys", () => {
  assert.deepEqual(matchAction([{ project: "SEC", start: "a" }], null), NONE);
  assert.deepEqual(matchAction([{ project: "SEC", start: "a" }, { finish: "b" }], undefined), { start: null, finish: "b" });
});
