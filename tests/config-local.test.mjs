import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfig, mergeForHost, mergeWithLocal, parseLocal, migrationPlan, migrateLocal, LOCAL_REL, DEFAULT_CONFIG } from "../src/shared/config.js";
import { HERDR_SHIPPED_MODS } from "./fixtures/herdr-shipped-mods.mjs";

const TOP = { features: [{ mod: "dock-core" }] };
const pretty = (x) => JSON.stringify(x, null, 2) + "\n";

test("LOCAL_REL is the local file's path under the app home", () => {
  assert.equal(LOCAL_REL, "herdr-dock/local.json");
});

test("parseLocal(null) is no local file; junk is an error", () => {
  assert.deepEqual(parseLocal(null), { ok: true, local: null });
  const junk = parseLocal("{ not json");
  assert.equal(junk.ok, false); assert.match(junk.error, /JSON/);
  assert.equal(parseLocal("[]").ok, false);
  assert.match(parseLocal('{"v":2,"regions":{}}').error, /version/);
});

test("parseLocal validates regions like a machines section", () => {
  const ok = parseLocal('{"v":1,"regions":{"right":{"hidden":false}}}');
  assert.deepEqual(ok, { ok: true, local: { v: 1, regions: { right: { hidden: false } } } });
  assert.deepEqual(parseLocal('{"v":1}'), { ok: true, local: { v: 1, regions: {} } });
  assert.match(parseLocal('{"v":1,"regions":{"middle":{}}}').error, /middle/);
  assert.match(parseLocal('{"v":1,"regions":{"right":{"features":[{"mod":"dock-header"}]}}}').error, /regions\.left/);
  assert.match(parseLocal('{"v":1,"regions":{"top":{"features":[{"mod":"dock-tabs"}]}}}').error, /dock-core/);
});

test("mergeWithLocal: local beats machines beats base", () => {
  const config = parseConfig(JSON.stringify({ v: 1,
    regions: { top: TOP, left: { size: 268 }, right: { size: 360, hidden: true }, bottom: { size: 28 } },
    machines: { "ForkAdam-PC": { regions: { left: { size: 300 }, right: { size: 400 } } } } })).config;
  const local = parseLocal(JSON.stringify({ v: 1, regions: { right: { size: 500, hidden: false } } })).local;
  const m = mergeWithLocal(config, "forkadam-pc", local);
  assert.equal(m.regions.left.size, 300); // machines over base
  assert.equal(m.regions.right.size, 500); // local over machines
  assert.equal(m.regions.right.hidden, false); // local over base
  assert.equal(m.regions.bottom.size, 28); // base
  assert.equal(m.machines, undefined);
  // No local file: the same as mergeForHost.
  assert.deepEqual(mergeWithLocal(config, "forkadam-pc", null), mergeForHost(config, "forkadam-pc"));
});

test("mergeWithLocal: an invalid local file is reported, not merged", () => {
  const config = parseConfig(JSON.stringify({ v: 1, regions: { top: TOP, left: { size: 268 } } })).config;
  const bad = parseLocal('{"v":1,"regions":{"left":{"size":-5}}}');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /regions\.left\.size/);
  // Callers merge with null after a failed parse: the base wins.
  assert.equal(mergeWithLocal(config, "pc", null).regions.left.size, 268);
  // And an invalid object handed in anyway is ignored rather than merged.
  assert.equal(mergeWithLocal(config, "pc", { v: 1, regions: { left: { size: -5 } } }).regions.left.size, 268);
});

const BASE = { v: 1, regions: { top: TOP, left: { size: 268 } } };
const MINE = { regions: { right: { hidden: false, features: [{ mod: "mission-control-github" }] } } };
const THEIRS = { regions: { left: { size: 300 } } };

test("migrationPlan moves this host's section (case-insensitive) and keeps other hosts", () => {
  const configText = pretty({ ...BASE, machines: { "ForkAdam-PC": MINE, "other-pc": THEIRS } });
  const plan = migrationPlan({ configText, host: "forkadam-pc", localText: null, headText: pretty(BASE) });
  assert.deepEqual(JSON.parse(plan.localText), { v: 1, ...MINE });
  assert.ok(plan.localText.endsWith("\n"));
  assert.ok(parseLocal(plan.localText).ok);
  assert.deepEqual(JSON.parse(plan.configText), { ...BASE, machines: { "other-pc": THEIRS } });
});

test("migrationPlan drops an emptied machines object", () => {
  const configText = pretty({ ...BASE, machines: { "forkadam-pc": MINE } });
  const plan = migrationPlan({ configText, host: "FORKADAM-PC", localText: null, headText: null });
  assert.deepEqual(JSON.parse(plan.configText), BASE);
  assert.equal(plan.configText, pretty(BASE));
});

test("migrationPlan restores headText exactly when the rest equals it", () => {
  // git's committed text, formatted differently from JSON.stringify.
  const headText = '{\n  "v": 1,\n  "regions": {\n    "left": { "size": 268 },\n    "top": { "features": [{ "mod": "dock-core" }] }\n  }\n}\n';
  const configText = pretty({ ...BASE, machines: { "forkadam-pc": MINE } });
  const plan = migrationPlan({ configText, host: "forkadam-pc", localText: null, headText });
  assert.equal(plan.configText, headText);
  // When the rest differs from git's version, the rest is written as pretty JSON.
  const changed = pretty({ ...BASE, regions: { ...BASE.regions, left: { size: 200 } }, machines: { "forkadam-pc": MINE } });
  const plan2 = migrationPlan({ configText: changed, host: "forkadam-pc", localText: null, headText });
  assert.equal(plan2.configText, pretty({ ...BASE, regions: { ...BASE.regions, left: { size: 200 } } }));
});

test("migrationPlan: git's text with an empty machines object counts as equal", () => {
  // The committed config/dock.json keeps "machines": {}.
  const headText = '{\n  "v": 1,\n  "regions": { "top": { "features": [{ "mod": "dock-core" }] }, "left": { "size": 268 } },\n  "machines": {}\n}\n';
  const configText = pretty({ ...BASE, machines: { "forkadam-pc": MINE } });
  assert.equal(migrationPlan({ configText, host: "forkadam-pc", localText: null, headText }).configText, headText);
});

test("migrationPlan: nothing to do once the local file exists", () => {
  const configText = pretty({ ...BASE, machines: { "forkadam-pc": MINE } });
  assert.equal(migrationPlan({ configText, host: "forkadam-pc", localText: '{"v":1,"regions":{}}', headText: pretty(BASE) }), null);
  // Even a corrupt local file is never overwritten.
  assert.equal(migrationPlan({ configText, host: "forkadam-pc", localText: "{ junk", headText: null }), null);
  // Run twice: the second run sees the local file and does nothing.
  const first = migrationPlan({ configText, host: "forkadam-pc", localText: null, headText: pretty(BASE) });
  assert.equal(migrationPlan({ configText: first.configText, host: "forkadam-pc", localText: first.localText, headText: pretty(BASE) }), null);
});

test("migrationPlan: nothing to do when there's no section for this host", () => {
  assert.equal(migrationPlan({ configText: pretty(BASE), host: "forkadam-pc", localText: null, headText: pretty(BASE) }), null);
  assert.equal(migrationPlan({ configText: pretty({ ...BASE, machines: { "other-pc": THEIRS } }), host: "forkadam-pc", localText: null, headText: null }), null);
  assert.equal(migrationPlan({ configText: "{ junk", host: "forkadam-pc", localText: null, headText: null }), null);
  assert.equal(migrationPlan({ configText: null, host: "forkadam-pc", localText: null, headText: null }), null);
});

test("allowed mods: the shared default places only dock-* and Herdr-shipped mods", () => {
  const { machines, ...base } = JSON.parse(readFileSync(new URL("../config/dock.json", import.meta.url), "utf8"));
  for (const [where, config] of [["DEFAULT_CONFIG", DEFAULT_CONFIG], ["config/dock.json", base]]) {
    for (const [name, r] of Object.entries(config.regions ?? {})) {
      for (const f of r.features ?? []) {
        assert.ok(f.mod.startsWith("dock-") || HERDR_SHIPPED_MODS.includes(f.mod),
          `${where} regions.${name} places ${f.mod}: third-party mods belong in a PC's local file`);
      }
    }
  }
});

// migrateLocal: the migration with injected file and git access (dock-core runs it through Herdr's API).
const fakeFs = (files) => ({
  files,
  writes: [],
  read: async (p) => (p in files ? files[p] : null),
  write: async function (p, text, expected) {
    if ((p in files ? files[p] : null) !== expected) throw new Error(`stale ${p}`);
    this.writes.push(p); files[p] = text;
  },
});

test("migrateLocal moves this host's section to the local file and restores git's text", async () => {
  const head = pretty({ v: 1, regions: { top: TOP } });
  const config = pretty({ v: 1, regions: { top: TOP }, machines: { PC1: { regions: { right: { hidden: false } } } } });
  const fs = fakeFs({ "/r/config/dock.json": config });
  const done = await migrateLocal({
    configPath: "/r/config/dock.json", localPath: "/a/herdr-dock/local.json", host: "pc1",
    read: fs.read, write: fs.write.bind(fs), headText: async () => head,
  });
  assert.equal(done, true);
  assert.deepEqual(fs.writes, ["/a/herdr-dock/local.json", "/r/config/dock.json"]);
  assert.deepEqual(JSON.parse(fs.files["/a/herdr-dock/local.json"]), { v: 1, regions: { right: { hidden: false } } });
  assert.equal(fs.files["/r/config/dock.json"], head);
});

test("migrateLocal does nothing when a local file exists, and survives a failing git", async () => {
  const config = pretty({ v: 1, regions: { top: TOP }, machines: { pc1: { regions: {} } } });
  const fs = fakeFs({ "/r/config/dock.json": config, "/a/l.json": "{ corrupt" });
  const args = { configPath: "/r/config/dock.json", localPath: "/a/l.json", host: "pc1", read: fs.read, write: fs.write.bind(fs) };
  assert.equal(await migrateLocal({ ...args, headText: async () => { throw new Error("no git"); } }), false);
  assert.deepEqual(fs.writes, []);
  delete fs.files["/a/l.json"];
  assert.equal(await migrateLocal({ ...args, headText: async () => { throw new Error("no git"); } }), true);
  assert.equal(JSON.parse(fs.files["/r/config/dock.json"]).machines, undefined);
});
