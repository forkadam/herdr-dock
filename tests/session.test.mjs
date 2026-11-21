import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSession, saveSession, resetSession, isDirty } from "../src/mods/dock-config/session.js";
import { applyEdit, draftFromConfig } from "../src/shared/edit.js";

const HOST = "forkadam-pc";
const CFG = "C:/repo/config/dock.json";
const HOME = "C:/home/app";
const text = readFileSync(new URL("./fixtures/dock.json", import.meta.url), "utf8");

function fakeIo({ file = text, shared = { "dock.config.path": CFG, "dock.host": HOST }, extra = {}, listing } = {}) {
  const files = new Map([[CFG, file], ...Object.entries(extra)]);
  const writes = [];
  const io = {
    appHome: HOME,
    platform: "windows",
    shared: (k) => shared[k],
    readTextFile: async (p) => files.get(p) ?? null,
    writeTextFile: async (p, t, expected) => {
      if ((files.get(p) ?? null) !== expected) throw new Error("changed");
      files.set(p, t);
      writes.push(t);
    },
    exec: listing ?? (async () => ({ code: 0, stdout: "files\nagents\n" })),
  };
  return { io, files, writes };
}
const sized = (s, v) => ({ ...s, draft: applyEdit(s.draft, { type: "size", region: "left", value: v }).draft });

test("load, save a size edit, file updated and clean", async () => {
  const { io, files } = fakeIo();
  let s = await loadSession(io);
  assert.equal(s.readOnly, false);
  assert.equal(isDirty(s), false);
  s = await saveSession(sized(s, 300), io);
  assert.equal(s.error, null);
  assert.equal(JSON.parse(files.get(CFG)).machines[HOST].regions.left.size, 300);
  assert.equal(s.opened, files.get(CFG));
  assert.equal(isDirty(s), false);
});

test("hand edit: refused write keeps the hand-edited file, then a second save succeeds", async () => {
  const { io, files } = fakeIo();
  const s = sized(await loadSession(io), 300);
  const hand = JSON.stringify({ ...JSON.parse(text), machines: { other: {} } }, null, 2);
  files.set(CFG, hand);
  const r = await saveSession(s, io);
  assert.equal(files.get(CFG), hand);
  assert.match(r.notice, /changed on disk/);
  assert.equal(r.draft.regions.left.size, 300);
  assert.equal(r.opened, hand);
  const r2 = await saveSession(r, io);
  const saved = JSON.parse(files.get(CFG));
  assert.equal(saved.machines[HOST].regions.left.size, 300);
  assert.ok(saved.machines.other);
  assert.equal(r2.error, null);
});

test("invalid file is read-only with a hand-fix message", async () => {
  const { io } = fakeIo({ file: "{ nope" });
  const s = await loadSession(io);
  assert.equal(s.readOnly, true);
  assert.match(s.error, /fix config\/dock\.json by hand/);
});

test("invalid file shows the applied regions when shared", async () => {
  const applied = JSON.parse(text).regions;
  applied.left.hidden = false;
  const { io } = fakeIo({ file: "{ nope", shared: { "dock.config.path": CFG, "dock.host": HOST, "dock.config.applied": applied } });
  const s = await loadSession(io);
  assert.deepEqual(s.draft, { regions: applied });
});

test("missing shared keys fall back to source.json", async () => {
  const src = JSON.stringify({ config: ["C:", "repo", "config", "dock.json"].join(String.fromCharCode(92)), hostname: "ForkAdam-PC" });
  const { io } = fakeIo({ shared: {}, extra: { [`${HOME}/mods/dock-core/source.json`]: src } });
  const s = await loadSession(io);
  assert.equal(s.path, CFG);
  assert.equal(s.host, HOST);
  assert.equal(s.readOnly, false);
});

test("no host is read-only", async () => {
  const { io } = fakeIo({ shared: { "dock.config.path": CFG } });
  const s = await loadSession(io);
  assert.equal(s.readOnly, true);
  assert.match(s.error, /hostname is unknown/);
});

test("listing failures fall back to installed.json with a notice", async () => {
  const installed = JSON.stringify({ tabs: {}, "layout:main": {}, files: {} });
  for (const listing of [
    async () => { throw new Error("boom"); },
    async () => ({ code: 1, stdout: "files\n" }),
    async () => ({ code: 0, stdout: "" }),
  ]) {
    const { io } = fakeIo({ listing, extra: { [`${HOME}/installed.json`]: installed } });
    const s = await loadSession(io);
    assert.equal(s.notice, "mod list may be incomplete");
    const ids = s.inventory.map((i) => i.id);
    assert.ok(ids.includes("tabs") && ids.includes("files"));
    assert.ok(!ids.includes("layout:main"));
  }
});

test("reset removes the machine section", async () => {
  const { io, files } = fakeIo();
  let s = await saveSession(sized(await loadSession(io), 300), io);
  s = await resetSession(s, io);
  assert.equal(JSON.parse(files.get(CFG)).machines?.[HOST], undefined);
  assert.equal(isDirty(s), false);
});

test("reset with no machine section and a dirty draft discards the edits", async () => {
  const base = JSON.parse(text);
  delete base.machines;
  const { io } = fakeIo({ file: JSON.stringify(base, null, 2) });
  let s = sized(await loadSession(io), 300);
  assert.equal(isDirty(s), true);
  s = await resetSession(s, io);
  assert.deepEqual(s.draft, draftFromConfig(base, HOST));
  assert.equal(isDirty(s), false);
});
