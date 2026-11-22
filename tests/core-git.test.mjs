import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, b64urlDecode, gitCommandName, parseGitCommand, showPlan, revealPlan } from "../src/shared/gitcmd.js";

test("base64url round-trips worktree ids (ASCII, |, /, :, spaces, non-ASCII)", () => {
  for (const s of ["", "a", "ab", "abc", "|d:/workspace/herdr-dock", "box|/home/u/my repo", "|c:/users/adam cheng/é漢字😀"]) {
    const e = b64urlEncode(s);
    assert.match(e, /^[A-Za-z0-9_-]*$/);
    assert.equal(b64urlDecode(e), s);
  }
  assert.equal(b64urlEncode("abc"), "YWJj");
  assert.equal(b64urlEncode("??>"), "Pz8-");
  assert.equal(b64urlEncode("???"), "Pz8_");
  assert.equal(b64urlDecode("not valid!"), null);
});

test("gitCommandName encodes args into the command name", () => {
  assert.equal(gitCommandName("git.refresh"), "git.refresh");
  assert.equal(gitCommandName("git.retry", {}), "git.retry");
  assert.equal(gitCommandName("git.open"), "git.open");
  assert.equal(gitCommandName("git.open.job", { index: 2 }), "git.open.job.2");
  assert.equal(gitCommandName("git.select", { worktree: "abc" }), "git.select.YWJj");
  assert.equal(gitCommandName("git.show", { worktree: "abc" }), "git.show.YWJj");
  assert.equal(gitCommandName("git.show"), "git.show");
  assert.throws(() => gitCommandName("git.open.job", {}), /index/);
  assert.throws(() => gitCommandName("git.select", {}), /worktree/);
  assert.throws(() => gitCommandName("git.nope"), /unknown/);
});

test("parseGitCommand decodes what gitCommandName builds", () => {
  assert.deepEqual(parseGitCommand("git.refresh"), { cmd: "refresh" });
  assert.deepEqual(parseGitCommand("git.retry"), { cmd: "retry" });
  assert.deepEqual(parseGitCommand("git.open"), { cmd: "open" });
  assert.deepEqual(parseGitCommand("git.open.job.3"), { cmd: "open.job", index: 3 });
  const id = "|c:/users/adam cheng/repo";
  assert.deepEqual(parseGitCommand(gitCommandName("git.select", { worktree: id })), { cmd: "select", worktree: id });
  assert.deepEqual(parseGitCommand(gitCommandName("git.show", { worktree: id })), { cmd: "show", worktree: id });
  assert.deepEqual(parseGitCommand("git.show"), { cmd: "show", worktree: null });
  assert.equal(parseGitCommand("git.select"), null);
  assert.equal(parseGitCommand("git.select.@@"), null);
  assert.equal(parseGitCommand("git.open.job.x"), null);
  assert.equal(parseGitCommand("git.open.job.-1"), null);
  assert.equal(parseGitCommand("git.bogus"), null);
  assert.equal(parseGitCommand("cycle"), null);
  assert.equal(parseGitCommand(undefined), null);
});

test("parseGitCommand never throws on undecodable worktree suffixes", () => {
  // U+110000 (past Unicode), 0xf5/0xf7 leads, a stray continuation, overlong, a surrogate, 0xff bytes.
  for (const s of ["9JCAgA", "9ZCAgA", "94CAgA", "gA", "wIA", "7aCA", "_w", "____", "A"]) {
    assert.doesNotThrow(() => parseGitCommand(`git.select.${s}`), s);
    assert.equal(parseGitCommand(`git.select.${s}`), null, s);
    assert.equal(parseGitCommand(`git.show.${s}`), null, s);
    assert.equal(b64urlDecode(s), null, s);
  }
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let i = 0; i < 2000; i++) {
    let s = "";
    const n = 1 + Math.floor(Math.random() * 12);
    for (let j = 0; j < n; j++) s += A[Math.floor(Math.random() * 64)];
    assert.doesNotThrow(() => parseGitCommand(`git.select.${s}`), s);
  }
});

test("showPlan: right-panel when dock-pipelines is placed there, else a dialog", () => {
  const placed = { regions: { right: { features: [{ mod: "dock-quotas" }, { mod: "dock-pipelines" }] } } };
  assert.deepEqual(showPlan(placed), { set: { "dock.right.active": "dock-pipelines", "dock.right.shown": true } });
  const dialog = { overlay: { mod: "dock-pipelines", kind: "dialog", width: 640, height: 0.7 } };
  assert.deepEqual(showPlan({ regions: { right: { features: [{ mod: "dock-quotas" }] } } }), dialog);
  assert.deepEqual(showPlan(null), dialog);
});

test("git.delete carries the worktree id and parses back; it needs one", () => {
  const name = gitCommandName("git.delete", { worktree: "|d:/work/api-login" });
  assert.match(name, /^git\.delete\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseGitCommand(name), { cmd: "delete", worktree: "|d:/work/api-login" });
  assert.throws(() => gitCommandName("git.delete", {}));
});

test("revealPlan: right panel when placed, else the dialog", () => {
  const D = { mod: "dock-notifications", kind: "dialog", width: 520, height: 0.7 };
  const merged = { regions: { right: { features: [{ mod: "dock-notifications" }] } } };
  assert.deepEqual(revealPlan(merged, "dock-notifications", D), { set: { "dock.right.active": "dock-notifications", "dock.right.shown": true } });
  assert.deepEqual(revealPlan({ regions: { right: { features: [] } } }, "dock-notifications", D), { overlay: D });
  assert.deepEqual(revealPlan(null, "dock-notifications", D), { overlay: D });
  assert.notEqual(revealPlan(null, "dock-notifications", D).overlay, D);
});
