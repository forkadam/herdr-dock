// The Changes branch view against real git repos, for the cases a fake git can't vouch for.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchChanges } from "../src/shared/changes.js";

// No machine config and nothing from a calling git (a hook exports GIT_DIR, GIT_INDEX_FILE…):
// an empty HOME, no system config, no GIT_* variables.
const home = mkdtempSync(join(tmpdir(), "changes-home-"));
test.after(() => rmSync(home, { recursive: true, force: true }));
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
  HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: "1",
};

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

// Run from a git hook, the tests inherit GIT_DIR, GIT_INDEX_FILE and the like: they must still touch
// only their own temp repos.
test("real-git tests ignore inherited GIT_* variables", { skip: process.env.CHANGES_GIT_CHILD === "1" }, (t) => {
  const decoy = repo(t);
  decoy.commit("d.js", "d\n");
  const refs = () => decoy.git("for-each-ref", "--format=%(refname) %(objectname)");
  const before = refs();
  const { NODE_TEST_CONTEXT: _ctx, ...parent } = process.env;
  const child = spawnSync(process.execPath, ["--test", fileURLToPath(import.meta.url)], {
    encoding: "utf8",
    env: { ...parent, CHANGES_GIT_CHILD: "1", GIT_DIR: join(decoy.dir, ".git"), GIT_INDEX_FILE: join(decoy.dir, ".git", "index") },
  });
  assert.equal(refs(), before);
  assert.equal(child.status, 0, child.stdout.slice(-2000));
});
