import { test } from "node:test";
import assert from "node:assert/strict";
import { updateStrip } from "../src/mods/dock-config/update-view.js";

const NOW = 1_700_000_000_000;
const H = 60 * 60 * 1000;
const CHECK = { label: "Check now", kind: "check" };
const UPDATE = { label: "Update", kind: "update" };
const st = (o) => ({ current: "e0aa740", latest: "e0aa740", behind: 0, subject: null, checkedAt: NOW - 2 * H, reason: null, startedAt: null, ...o });

test("up to date: sha, checked age, Check now", () => {
  assert.deepEqual(updateStrip(st({ status: "idle" }), NOW),
    { text: "herdr-dock e0aa740 · up to date · checked 2h ago", tone: "dim", action: CHECK });
});

test("up to date with no checkedAt leaves the age out", () => {
  assert.equal(updateStrip(st({ status: "idle", checkedAt: null }), NOW).text, "herdr-dock e0aa740 · up to date");
});

test("available: count and latest subject, Update", () => {
  assert.deepEqual(updateStrip(st({ status: "available", latest: "7f3c2a1", behind: 3, subject: "Fix the bar" }), NOW),
    { text: 'Update available · 3 new commits (latest: "Fix the bar")', tone: "accent", action: UPDATE });
  assert.equal(updateStrip(st({ status: "available", behind: 1, subject: null }), NOW).text, "Update available · 1 new commit");
});

test("updating: no action", () => {
  assert.deepEqual(updateStrip(st({ status: "updating", startedAt: NOW }), NOW),
    { text: 'Updating… see the "Update herdr-dock" tab', tone: "dim", action: null });
});

test("updated: new sha and commits, then Check now", () => {
  assert.deepEqual(updateStrip(st({ status: "updated", current: "7f3c2a1", commits: 3 }), NOW),
    { text: "✓ Updated to 7f3c2a1 · 3 commits", tone: "ok", action: CHECK });
  assert.equal(updateStrip(st({ status: "updated", current: "7f3c2a1", commits: 1 }), NOW).text, "✓ Updated to 7f3c2a1 · 1 commit");
  assert.equal(updateStrip(st({ status: "updated", current: "7f3c2a1", commits: null }), NOW).text, "✓ Updated to 7f3c2a1");
});

test("blocked: Can't update, Check now", () => {
  assert.deepEqual(updateStrip(st({ status: "blocked", reason: "local changes in the repo" }), NOW),
    { text: "Can't update: local changes in the repo", tone: "bad", action: CHECK });
  assert.deepEqual(updateStrip(st({ status: "blocked", reason: "on branch feat/x" }), NOW),
    { text: "Can't update: on branch feat/x", tone: "bad", action: CHECK });
});

test("failed fetch shows its reason as is, Check now", () => {
  assert.deepEqual(updateStrip(st({ status: "failed", reason: "Can't check: could not resolve host" }), NOW),
    { text: "Can't check: could not resolve host", tone: "bad", action: CHECK });
});

test("failed update: Update failed, Check now", () => {
  assert.deepEqual(updateStrip(st({ status: "failed", reason: "no result (was the update tab closed?)" }), NOW),
    { text: "Update failed: no result (was the update tab closed?)", tone: "bad", action: CHECK });
});

test("checking: no action", () => {
  assert.deepEqual(updateStrip(st({ status: "checking" }), NOW), { text: "Checking…", tone: "dim", action: null });
});

test("no state yet: not checked, Check now", () => {
  assert.deepEqual(updateStrip(null, NOW), { text: "herdr-dock · not checked yet", tone: "dim", action: CHECK });
  assert.deepEqual(updateStrip({ status: "idle", current: null, checkedAt: null }, NOW).text, "herdr-dock · up to date");
});
