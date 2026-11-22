import { test } from "node:test";
import assert from "node:assert/strict";
import { gitRows, badgeOf, gitSummary, repoWebUrl, addRepoPath, removeRepoPaths, EMPTY_TEXT, rowMenu, hideWorktree } from "../src/mods/dock-git/view.js";

const P = (status, o = {}) => ({ status, id: 1, sha: "abc", webUrl: "https://x/p/1", createdAt: null, stale: false, error: null, via: "fetch", hint: null, ...o });
const W = (o = {}) => ({ id: "|d:/r/api", path: "D:/r/api", branch: "main", detached: false, sha: "a1b2c3d4e5", upstream: "origin/main",
  ahead: 0, behind: 0, dirty: false, open: false, space: null, pipeline: null, ...o });
const R = (o = {}) => ({ id: "|d:/r/api/.git", name: "api", machine: null, provider: "gitlab", host: "gitlab.corp", path: "grp/api",
  added: true, error: null, worktrees: [W()], ...o });

test("badgeOf gives a glyph and tone for each status", () => {
  assert.deepEqual(badgeOf(null), { glyph: "", tone: "dim" });
  assert.deepEqual(badgeOf(P("passed")), { glyph: "✓", tone: "ok" });
  assert.deepEqual(badgeOf(P("failed")), { glyph: "✕", tone: "bad" });
  assert.deepEqual(badgeOf(P("running")), { glyph: "⟳", tone: "busy" });
  assert.deepEqual(badgeOf(P("pending")), { glyph: "⟳", tone: "busy" });
  for (const s of ["canceled", "skipped", "none"]) assert.deepEqual(badgeOf(P(s)), { glyph: "–", tone: "dim" }, s);
  assert.deepEqual(badgeOf(P("unknown", { error: "timeout" })), { glyph: "⚠", tone: "warn" });
  assert.deepEqual(badgeOf(P("unknown")), { glyph: "⚠", tone: "warn" });
});

test("gitRows: the empty state", () => {
  assert.deepEqual(gitRows(null, null), [{ kind: "empty", text: EMPTY_TEXT }]);
  assert.deepEqual(gitRows({ repos: [] }, null), [{ kind: "empty", text: EMPTY_TEXT }]);
  assert.equal(EMPTY_TEXT, "No repos yet: + Add repo, or open a terminal in a repo.");
});

test("gitRows: each repo row is followed by its worktree rows", () => {
  const api = R({ worktrees: [W({ open: true, space: "s1", pipeline: P("passed"), behind: 2 }),
    W({ id: "|d:/r/api-login", path: "D:/r/api-login", branch: "feature/login", ahead: 1, dirty: true, pipeline: P("failed") })] });
  const dock = R({ id: "|d:/w/herdr-dock/.git", name: "herdr-dock", provider: "github", host: "github.com", path: "forkadam/herdr-dock",
    added: false, worktrees: [W({ id: "|d:/w/herdr-dock", path: "D:/w/herdr-dock", upstream: null })] });
  const rows = gitRows({ repos: [api, dock] }, "|d:/r/api-login");
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.kind === "repo" ? r.name : r.branch}`),
    ["repo:api", "worktree:main", "worktree:feature/login", "repo:herdr-dock", "worktree:main"]);
  const [repo, main, login, , dmain] = rows;
  assert.equal(repo.provider, "gitlab"); assert.equal(repo.added, true); assert.equal(repo.error, null);
  assert.equal(repo.webUrl, "https://gitlab.corp/grp/api"); assert.equal(repo.webLabel, "Open in GitLab");
  assert.equal(repo.mainPath, "D:/r/api");
  assert.equal(main.open, true); assert.equal(main.space, "s1"); assert.equal(main.selected, false);
  assert.deepEqual(main.badge, { glyph: "✓", tone: "ok" });
  assert.equal(main.ahead, null); assert.equal(main.behind, "↓2"); assert.equal(main.noUpstream, false);
  assert.equal(login.selected, true); assert.equal(login.ahead, "↑1"); assert.equal(login.behind, null);
  assert.equal(login.dirty, true); assert.deepEqual(login.badge, { glyph: "✕", tone: "bad" });
  assert.equal(login.repoId, api.id); assert.equal(login.id, "|d:/r/api-login");
  assert.match(login.tooltip, /feature\/login/);
  assert.equal(dmain.noUpstream, true); assert.equal(dmain.ahead, null);
  assert.equal(rows[3].webLabel, "Open in GitHub");
});

test("gitRows: a detached worktree shows its short sha", () => {
  const [, w] = gitRows({ repos: [R({ worktrees: [W({ branch: null, detached: true })] })] }, null);
  assert.equal(w.branch, "detached @a1b2c3d");
});

test("gitRows: an error repo row has the error and no worktrees", () => {
  const rows = gitRows({ repos: [R({ id: "|d:/gone", name: "gone", provider: null, host: null, path: null, error: "not a git repository", worktrees: [] })] }, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "repo"); assert.equal(rows[0].error, "not a git repository");
  assert.equal(rows[0].webUrl, null); assert.equal(rows[0].mainPath, null);
});

test("gitSummary counts repos and failing worktrees", () => {
  const s = gitSummary({ repos: [R({ worktrees: [W({ pipeline: P("failed") }), W({ pipeline: P("passed") })] }), R({ worktrees: [W({ pipeline: P("failed") })] })] });
  assert.deepEqual(s, { repos: 2, failing: 2, text: "2 repos · 2 failing" });
  assert.deepEqual(gitSummary(null), { repos: 0, failing: 0, text: "0 repos · 0 failing" });
  assert.equal(gitSummary({ repos: [R()] }).text, "1 repo · 0 failing");
});

test("repoWebUrl builds https://<host>/<path>", () => {
  assert.equal(repoWebUrl(R()), "https://gitlab.corp/grp/api");
  assert.equal(repoWebUrl(R({ host: null })), null);
});

test("addRepoPath appends once, case-insensitively on Windows", () => {
  assert.deepEqual(addRepoPath(undefined, "D:/r/api", "windows"), [{ path: "D:/r/api", machine: null }]);
  const list = [{ path: "D:/r/api", machine: null }];
  assert.equal(addRepoPath(list, "d:\\R\\api\\", "windows"), null);
  assert.deepEqual(addRepoPath(list, "D:/r/web", "windows"), [...list, { path: "D:/r/web", machine: null }]);
  assert.deepEqual(addRepoPath([{ path: "/r/a", machine: null }], "/r/A", "linux").length, 2);
});

test("removeRepoPaths drops entries naming the repo or any of its worktrees", () => {
  const repo = R({ worktrees: [W(), W({ id: "|d:/r/api-login", path: "D:/r/api-login" })] });
  const list = [{ path: "d:/R/API", machine: null }, { path: "D:/r/web", machine: null }, { path: "D:/r/api-login", machine: "devbox" }];
  assert.deepEqual(removeRepoPaths(list, repo, "windows"), [{ path: "D:/r/web", machine: null }, { path: "D:/r/api-login", machine: "devbox" }]);
  // An error repo (no worktrees) is matched by its id.
  const gone = R({ id: "|d:/gone", error: "x", worktrees: [] });
  assert.deepEqual(removeRepoPaths([{ path: "D:/gone", machine: null }], gone, "windows"), []);
});

// --- final-review fixes -------------------------------------------------------------------------

test("fix 7: a remote repo's machine shows once (in the name), the detail is just the provider", () => {
  const [r] = gitRows({ repos: [R({ name: "tool · devbox", machine: "devbox", provider: "github" })] }, null);
  assert.equal(r.name, "tool · devbox");
  assert.equal(r.detail, "github");
  assert.ok(!r.detail.includes("devbox"));
  const [local] = gitRows({ repos: [R({ provider: null })] }, null);
  assert.equal(local.detail, "");
});

test("fix 4: the badge tooltip shows the display number, not a GitHub sha", () => {
  const sha = "f".repeat(40);
  const [, w] = gitRows({ repos: [R({ worktrees: [W({ pipeline: P("passed", { id: sha, number: 58 }) })] })] }, null);
  assert.match(w.badgeTip, /^Pipeline #58 passed/);
  assert.ok(!w.badgeTip.includes(sha));
  const [, g] = gitRows({ repos: [R({ worktrees: [W({ pipeline: P("failed", { id: 7, number: 7 }) })] })] }, null);
  assert.match(g.badgeTip, /^Pipeline #7 failed/);
});

test("fix 8: removeRepoPaths drops the added paths that produced the repo (an added subfolder too)", () => {
  const repo = R({ addedPaths: [{ path: "D:/r/api/src", machine: null }] });
  const list = [{ path: "D:\\R\\api\\src", machine: null }, { path: "D:/r/web", machine: null }];
  assert.deepEqual(removeRepoPaths(list, repo, "windows"), [{ path: "D:/r/web", machine: null }]);
  // A remote added path is matched on its own machine only.
  const remote = R({ machine: "devbox", addedPaths: [{ path: "/srv/api/sub", machine: "devbox" }], worktrees: [] });
  assert.deepEqual(removeRepoPaths([{ path: "/srv/api/sub", machine: "devbox" }, { path: "/srv/api/sub", machine: null }], remote, "windows"),
    [{ path: "/srv/api/sub", machine: null }]);
});

test("skipAfterRemove: a repo removed while a terminal is in it is skipped; otherwise unchanged", async () => {
  const { skipAfterRemove } = await import("../src/mods/dock-git/view.js");
  const open = { id: "r1", worktrees: [{ id: "w1", open: false }, { id: "w2", open: true }] };
  const closed = { id: "r2", worktrees: [{ id: "w3", open: false }] };
  assert.deepEqual(skipAfterRemove(undefined, open), ["r1"]);
  assert.deepEqual(skipAfterRemove(["r9"], open), ["r9", "r1"]);
  assert.deepEqual(skipAfterRemove(["r1"], open), ["r1"]);
  assert.equal(skipAfterRemove(["r9"], closed), null);
});

test("rowMenu: a repo row removes the repo; a worktree row hides or deletes just that worktree (not the main checkout)", () => {
  const api = R({ worktrees: [W({}), W({ id: "|d:/r/api-login", path: "D:/r/api-login", branch: "feature/login" })] });
  const rows = gitRows({ repos: [api] }, null);
  const [repo, main, login] = rows;
  assert.deepEqual(rowMenu(rows, repo).map((m) => m.key), ["remove", "web", "copy"]);
  assert.equal(rowMenu(rows, repo)[0].label, "Remove repo api");
  assert.deepEqual(rowMenu(rows, login).map((m) => m.key), ["hide", "delete", "web", "copy"]);
  assert.deepEqual(rowMenu(rows, main).map((m) => m.key), ["hide", "web", "copy"]);
  const del = rowMenu(rows, login).find((m) => m.key === "delete");
  assert.equal(del.label, "Delete worktree…");
  assert.equal(del.worktree, "|d:/r/api-login");
  assert.equal(rowMenu(rows, repo).find((m) => m.key === "copy").path, "D:/r/api");
  assert.equal(rowMenu(rows, login).find((m) => m.key === "copy").path, "D:/r/api-login");
  assert.equal(rowMenu(rows, login).find((m) => m.key === "web").url, "https://gitlab.corp/grp/api");
});

test("hideWorktree: adds { id, held } while others stay; hiding the last one removes the repo instead", () => {
  const api = R({ worktrees: [W({}), W({ id: "|d:/r/api-login", path: "D:/r/api-login", branch: "feature/login", open: true })] });
  const rows = gitRows({ repos: [api] }, null);
  const [, main, login] = rows;
  assert.deepEqual(hideWorktree([], rows, login), { hidden: [{ id: "|d:/r/api-login", held: true }], removeRepo: null });
  assert.deepEqual(hideWorktree(undefined, rows, main), { hidden: [{ id: "|d:/r/api", held: false }], removeRepo: null });
  const solo = gitRows({ repos: [R({})] }, null);
  assert.deepEqual(hideWorktree([], solo, solo[1]), { hidden: null, removeRepo: api.id });
});
