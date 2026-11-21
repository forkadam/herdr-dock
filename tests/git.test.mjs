import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorktrees, parseStatus, parseRevParse, parseRemote, worktreeId } from "../src/shared/git.js";

test("parseWorktrees: main, detached and bare entries", () => {
  const out = [
    "worktree D:/w/api",
    "HEAD 5a57a150d90f2aeb2b0b047540fccb9ac3e927ea",
    "branch refs/heads/main",
    "",
    "worktree D:/w/api-hotfix",
    "HEAD 1111111111111111111111111111111111111111",
    "detached",
    "",
    "worktree D:/w/bare.git",
    "bare",
    "",
  ].join("\n");
  assert.deepEqual(parseWorktrees(out), [
    { path: "D:/w/api", head: "5a57a150d90f2aeb2b0b047540fccb9ac3e927ea", branch: "main", detached: false, bare: false },
    { path: "D:/w/api-hotfix", head: "1111111111111111111111111111111111111111", branch: null, detached: true, bare: false },
    { path: "D:/w/bare.git", head: "", branch: null, detached: false, bare: true },
  ]);
});

test("parseWorktrees: CRLF and backslash paths", () => {
  const r = parseWorktrees("worktree D:\\w\\api\r\nHEAD abc\r\nbranch refs/heads/feature/x\r\n\r\n");
  assert.equal(r[0].path, "D:/w/api");
  assert.equal(r[0].branch, "feature/x");
  assert.deepEqual(parseWorktrees(""), []);
});

test("parseStatus: upstream, ahead/behind, dirty", () => {
  const out = [
    "# branch.oid abc",
    "# branch.head feature/login",
    "# branch.upstream origin/feature/login",
    "# branch.ab +1 -2",
    "1 .M N... 100644 100644 100644 b9e1 b9e1 config/dock.json",
  ].join("\n");
  assert.deepEqual(parseStatus(out), {
    branch: "feature/login", oid: "abc", upstream: "origin/feature/login", ahead: 1, behind: 2, dirty: true,
  });
});

test("parseStatus: clean tree, detached, no upstream", () => {
  assert.equal(parseStatus("# branch.oid abc\n# branch.head main\n").dirty, false);
  const d = parseStatus("# branch.oid abc\n# branch.head (detached)\n");
  assert.equal(d.branch, null);
  assert.equal(d.upstream, null);
  assert.equal(d.ahead, null);
  assert.equal(d.behind, null);
  assert.equal(parseStatus("# branch.oid (initial)\n# branch.head main\n").oid, null);
  assert.equal(parseStatus("# branch.oid abc\n# branch.head main\n? new.txt\n").dirty, true);
});

test("parseRevParse: a relative common dir resolves against the -C folder when given (git prints it relative to that)", () => {
  // Real git 2.51: `git -C D:/w/herdr-dock/src/shared rev-parse --show-toplevel --git-common-dir`.
  assert.deepEqual(parseRevParse("D:/w/herdr-dock\n../../.git\n", "D:/w/herdr-dock/src/shared"),
    { top: "D:/w/herdr-dock", commonDir: "D:/w/herdr-dock/.git" });
  assert.equal(parseRevParse("D:/work/api\n../.git\n", "d:\\work\\api\\src").commonDir, "D:/work/api/.git");
  assert.equal(parseRevParse("/home/a/p\n.git\n", "/home/a/p").commonDir, "/home/a/p/.git");
  assert.equal(parseRevParse("/w/wt\n/w/main/.git\n", "/w/wt/src").commonDir, "/w/main/.git");
});

test("parseRevParse: relative common dir resolves against top", () => {
  assert.deepEqual(parseRevParse("D:/workspace/herdr-dock\n.git\n"), { top: "D:/workspace/herdr-dock", commonDir: "D:/workspace/herdr-dock/.git" });
  assert.equal(parseRevParse("/home/a/p\n./.git\n").commonDir, "/home/a/p/.git");
});

test("parseRevParse: absolute common dir stays", () => {
  assert.deepEqual(parseRevParse("D:/w/api-hotfix\r\nD:/w/api/.git\r\n"), { top: "D:/w/api-hotfix", commonDir: "D:/w/api/.git" });
  assert.equal(parseRevParse("/w/wt\n/w/main/.git\n").commonDir, "/w/main/.git");
  assert.equal(parseRevParse("D:\\w\\wt\nD:\\w\\main\\.git\n").commonDir, "D:/w/main/.git");
});

test("parseRemote: the four URL shapes", () => {
  assert.deepEqual(parseRemote("git@gitlab.corp:a/b/c.git"), { host: "gitlab.corp", path: "a/b/c" });
  assert.deepEqual(parseRemote("ssh://git@host:2222/group/proj.git"), { host: "host", path: "group/proj" });
  assert.deepEqual(parseRemote("https://host/group/proj.git"), { host: "host", path: "group/proj" });
  assert.deepEqual(parseRemote("https://user@host:8443/g/p"), { host: "host:8443", path: "g/p" });
});

test("parseRemote: garbage gives null", () => {
  assert.equal(parseRemote("garbage"), null);
  assert.equal(parseRemote(""), null);
  assert.equal(parseRemote(undefined), null);
});

test("worktreeId: Windows lower-cases, linux keeps case", () => {
  assert.equal(worktreeId(null, "D:\\Work\\Api\\", "windows"), worktreeId(null, "d:/work/api", "windows"));
  assert.equal(worktreeId(null, "D:\\Work\\Api\\", "windows"), "|d:/work/api");
  assert.equal(worktreeId("pc1", "/Home/A/", "linux"), "pc1|/Home/A");
  assert.notEqual(worktreeId(null, "/a/B", "linux"), worktreeId(null, "/a/b", "linux"));
});
