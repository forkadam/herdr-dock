// The Changes branch view against real git repos, for the cases a fake git can't vouch for.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchChanges } from "../src/shared/changes.js";

// No machine config: an empty HOME, no system config.
const home = mkdtempSync(join(tmpdir(), "changes-home-"));
test.after(() => rmSync(home, { recursive: true, force: true }));
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: "1" };

// The panel's reads, as Herdr's exec runs them.
const exec = (cmd, args, { cwd }) => new Promise((resolve) => execFile(cmd, args, { cwd, env, maxBuffer: 1 << 24 },
  (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })));

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), "changes-git-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  git("symbolic-ref", "HEAD", "refs/heads/main");
  const write = (path, text) => writeFileSync(join(dir, path), text);
  const commit = (path, text, message = path) => { write(path, text); git("add", "-A"); git("commit", "-qm", message); };
  return { dir, git, write, commit };
}

const branchView = (dir) => fetchChanges({ exec, cwd: dir, on: null, mode: "branch" });
const listed = (res) => res.files.map((f) => `${f.status}${f.fresh ? "*" : ""} ${f.path}`).sort();

test("branch view, real git: detached HEAD one commit past main lists that commit's file", async (t) => {
  const r = repo(t);
  r.commit("a.js", "a\n");
  r.git("checkout", "-q", "--detach");
  r.commit("b.js", "b\n");
  const res = await branchView(r.dir);
  assert.equal(res.branch, null);
  assert.equal(res.base, "main");
  assert.deepEqual(listed(res), ["A b.js"]);
});

test("branch view, real git: a repo with no commits yet has nothing to compare and doesn't throw", async (t) => {
  const r = repo(t);
  r.write("x.js", "x\n");
  const res = await branchView(r.dir);
  assert.equal(res.base, null);
  assert.deepEqual(res.files, []);
});

test("branch view, real git: a branch with no commits of its own lists just the uncommitted work", async (t) => {
  const r = repo(t);
  r.commit("a.js", "a\n");
  r.git("checkout", "-q", "-b", "wip");
  r.write("a.js", "a\nmore\n");
  r.write("u.js", "u\n");
  const res = await branchView(r.dir);
  assert.equal(res.mergeBase, r.git("rev-parse", "HEAD"));
  assert.deepEqual(listed(res), ["A* u.js", "M a.js"]);
});

test("branch view, real git: a file in conflict shows U", async (t) => {
  const r = repo(t);
  r.commit("a.js", "base\n");
  r.git("checkout", "-q", "-b", "feat");
  r.commit("a.js", "feat\n", "feat");
  r.git("checkout", "-q", "main");
  r.commit("a.js", "main\n", "main");
  r.git("checkout", "-q", "feat");
  assert.throws(() => r.git("merge", "-q", "main"));
  const res = await branchView(r.dir);
  assert.equal(res.files.find((f) => f.path === "a.js")?.status, "U");
});
