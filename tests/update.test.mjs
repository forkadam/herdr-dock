import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFIED_KEY, RESULT_REL, TIMEOUT_MS, UPDATE_KEY, availableNote, parseUpdateCommand, resultNote, resultToState,
  shouldNotify, startState, timedOut, updateState,
} from "../src/shared/update.js";

const NOW = 1_700_000_000_000;
const base = {
  fetchOk: true, fetchError: null, branch: "main", ahead: 0, behind: 0, latest: "abc1234", subject: "Fix the bar",
  current: "abc1234", dirty: false,
};

test("keys and paths", () => {
  assert.equal(UPDATE_KEY, "dock.update.state");
  assert.equal(NOTIFIED_KEY, "dock.update.notified");
  assert.equal(RESULT_REL, "herdr-dock/update-result.json");
  assert.equal(TIMEOUT_MS, 10 * 60 * 1000);
});

test("updateState: available (on main, ahead 0, behind 3)", () => {
  const s = updateState({ ...base, behind: 3, latest: "def5678", current: "abc1234" }, NOW);
  assert.deepEqual(s, {
    status: "available", current: "abc1234", deployed: null, latest: "def5678", behind: 3, subject: "Fix the bar", checkedAt: NOW,
    reason: null, startedAt: null,
  });
});

test("updateState: up to date", () => {
  const s = updateState(base, NOW);
  assert.equal(s.status, "idle");
  assert.equal(s.behind, 0);
  assert.equal(s.current, "abc1234");
  assert.equal(s.checkedAt, NOW);
  assert.equal(s.reason, null);
});

test("updateState: blocked when dirty / off main / ahead", () => {
  const dirty = updateState({ ...base, behind: 3, latest: "def5678", dirty: true }, NOW);
  assert.equal(dirty.status, "blocked");
  assert.equal(dirty.reason, "local changes in the repo");
  assert.equal(dirty.behind, 3);
  const branch = updateState({ ...base, branch: "feat/install-update" }, NOW);
  assert.equal(branch.status, "blocked");
  assert.equal(branch.reason, "on branch feat/install-update");
  assert.equal(updateState({ ...base, branch: "HEAD", behind: 2 }, NOW).reason, "detached HEAD");
  const ahead = updateState({ ...base, ahead: 2, behind: 1 }, NOW);
  assert.equal(ahead.status, "blocked");
  assert.equal(ahead.reason, "2 local commits");
  assert.equal(updateState({ ...base, ahead: 1 }, NOW).reason, "1 local commit");
  // Off main wins over the other reasons (it's what the person has to change first).
  assert.equal(updateState({ ...base, branch: "dev", ahead: 4, dirty: true, behind: 2 }, NOW).reason, "on branch dev");
  // Local changes with nothing to update: still up to date.
  assert.equal(updateState({ ...base, dirty: true }, NOW).status, "idle");
});

test("updateState: fetch failed → failed with \"Can't check: <first line>\"", () => {
  const s = updateState({ fetchOk: false, fetchError: "\nfatal: unable to access 'https://github.com/x/y/'\nmore\n", current: "abc1234" }, NOW);
  assert.equal(s.status, "failed");
  assert.equal(s.reason, "Can't check: fatal: unable to access 'https://github.com/x/y/'");
  assert.equal(s.checkedAt, NOW);
  assert.equal(s.current, "abc1234");
  assert.equal(updateState({ fetchOk: false, fetchError: "" }, NOW).reason, "Can't check: git fetch failed");
});

test("updateState: a check after an update keeps \"updated\" while HEAD is still that commit", () => {
  const prev = { status: "updated", current: "def5678", latest: "def5678", behind: 0, commits: 3, checkedAt: 1, reason: null, startedAt: null };
  const s = updateState({ ...base, current: "def5678", latest: "def5678" }, NOW, prev);
  assert.equal(s.status, "updated");
  assert.equal(s.commits, 3);
  assert.equal(s.checkedAt, NOW);
  assert.equal(updateState({ ...base, current: "fff0000", latest: "fff0000" }, NOW, prev).status, "idle");
  assert.equal(updateState({ ...base, current: "def5678", latest: "aaa", behind: 1 }, NOW, prev).status, "available");
});

test("shouldNotify: new sha yes, same sha no, not available no", () => {
  const avail = updateState({ ...base, behind: 3, latest: "def5678" }, NOW);
  assert.equal(shouldNotify(avail, null), true);
  assert.equal(shouldNotify(avail, "old0000"), true);
  assert.equal(shouldNotify(avail, "def5678"), false);
  assert.equal(shouldNotify(updateState(base, NOW), null), false);
  assert.equal(shouldNotify(updateState({ ...base, behind: 3, branch: "dev" }, NOW), null), false);
  assert.equal(shouldNotify(null, null), false);
});

test("availableNote: the toast for an available update opens the Dock layout dialog", () => {
  const avail = updateState({ ...base, behind: 3, latest: "def5678" }, NOW);
  assert.deepEqual(availableNote(avail), {
    title: "herdr-dock update available", body: "3 new commits", level: "info",
    action: { name: "mod.open", args: { name: "dock-config" } },
  });
  assert.equal(availableNote({ ...avail, behind: 1 }).body, "1 new commit");
});

test("resultToState: success and failure shapes", () => {
  const prev = { status: "updating", current: "abc1234", latest: "def5678", behind: 3, subject: "Fix", checkedAt: 5, reason: null, startedAt: NOW - 1000 };
  const ok = resultToState({ ok: true, from: "abc1234", to: "def5678", commits: 3, reason: null, at: NOW - 10 }, prev, NOW);
  assert.deepEqual(ok, {
    status: "updated", current: "def5678", deployed: "def5678", latest: "def5678", behind: 0, subject: "Fix", checkedAt: 5, reason: null,
    startedAt: null, commits: 3,
  });
  const bad = resultToState({ ok: false, from: "abc1234", to: null, commits: 0, reason: "cannot fast-forward", at: NOW }, prev, NOW);
  assert.equal(bad.status, "failed");
  assert.equal(bad.reason, "cannot fast-forward");
  assert.equal(bad.current, "abc1234");
  assert.equal(bad.startedAt, null);
  assert.equal(resultToState({ ok: false }, null, NOW).reason, "unknown error");
  assert.equal(resultToState(null, prev, NOW), null);
  assert.equal(resultToState("nope", prev, NOW), null);
});

test("resultNote: success and failure toasts", () => {
  const action = { name: "mod.open", args: { name: "dock-config" } };
  assert.deepEqual(resultNote({ ok: true, to: "def5678", commits: 3 }), {
    title: "herdr-dock updated to def5678", body: "3 commits", level: "success", action,
  });
  assert.deepEqual(resultNote({ ok: false, reason: "cannot fast-forward" }), {
    title: "herdr-dock update failed", body: "cannot fast-forward", level: "error", action,
  });
});

test("timedOut at 10 min and not before", () => {
  const s = startState({ status: "available", current: "abc1234", latest: "def5678", behind: 3, reason: "x" }, NOW);
  assert.equal(s.status, "updating");
  assert.equal(s.startedAt, NOW);
  assert.equal(s.reason, null);
  assert.equal(s.latest, "def5678");
  assert.equal(timedOut(s, NOW + TIMEOUT_MS - 1), null);
  const t = timedOut(s, NOW + TIMEOUT_MS);
  assert.equal(t.status, "failed");
  assert.equal(t.reason, "no result (was the update tab closed?)");
  assert.equal(t.startedAt, null);
  assert.equal(timedOut({ status: "idle" }, NOW + TIMEOUT_MS * 2), null);
  assert.equal(timedOut(null, NOW), null);
  assert.equal(startState(null, NOW).status, "updating");
});

test("parseUpdateCommand: update.check and update.start", () => {
  assert.deepEqual(parseUpdateCommand("update.check"), { cmd: "check" });
  assert.deepEqual(parseUpdateCommand("update.start"), { cmd: "start" });
  assert.equal(parseUpdateCommand("update.nope"), null);
  assert.equal(parseUpdateCommand("update.check.x"), null);
  assert.equal(parseUpdateCommand("git.refresh"), null);
  assert.equal(parseUpdateCommand(undefined), null);
});

test("updateState: publishes deployed; a deployed commit behind HEAD with nothing to pull is a redeploy", () => {
  const s = updateState({ ...base, deployed: "0ld0000" }, NOW);
  assert.equal(s.status, "available");
  assert.equal(s.redeploy, true);
  assert.equal(s.behind, 0);
  assert.equal(s.deployed, "0ld0000");
  assert.equal(s.current, "abc1234");
  // Deployed matches HEAD, or unknown: up to date, no redeploy flag.
  const same = updateState({ ...base, deployed: "abc1234" }, NOW);
  assert.equal(same.status, "idle");
  assert.equal(same.deployed, "abc1234");
  assert.equal(same.redeploy, undefined);
  assert.equal(updateState(base, NOW).status, "idle");
  assert.equal(updateState(base, NOW).deployed, null);
  // Commits to pull win (a normal update also deploys).
  const behind = updateState({ ...base, behind: 2, latest: "def5678", deployed: "0ld0000" }, NOW);
  assert.equal(behind.status, "available");
  assert.equal(behind.redeploy, undefined);
  // Blocks still apply (the update script refuses them); local changes block a redeploy too.
  const off = updateState({ ...base, branch: "feat/x", deployed: "0ld0000" }, NOW);
  assert.equal(off.status, "blocked");
  assert.equal(off.deployed, "0ld0000");
  assert.equal(updateState({ ...base, dirty: true, deployed: "0ld0000" }, NOW).reason, "local changes in the repo");
  // A failed fetch keeps the last known deployed commit.
  assert.equal(updateState({ fetchOk: false, fetchError: "x" }, NOW, s).deployed, "0ld0000");
});

test("shouldNotify: no toast for a redeploy", () => {
  const s = updateState({ ...base, latest: "abc1234", deployed: "0ld0000" }, NOW);
  assert.equal(shouldNotify(s, null), false);
});

test("resultToState: a successful update records the deployed commit; a failed one keeps it", () => {
  const prev = { status: "updating", current: "b2", deployed: "a1", latest: "b2", behind: 0, startedAt: NOW };
  assert.equal(resultToState({ ok: true, from: "a1", to: "b2", commits: 0 }, prev, NOW).deployed, "b2");
  assert.equal(resultToState({ ok: false, reason: "deploy failed" }, prev, NOW).deployed, "a1");
});
