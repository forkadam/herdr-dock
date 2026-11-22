import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draftFromConfig, applyEdit, machineSection, formatConfig, planSave, planReset } from "../src/shared/edit.js";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/dock.json", import.meta.url), "utf8"));
const withFiles = () => {
  const c = fixture();
  c.regions.left.features.push({ mod: "files" });
  return c;
};
const edit = (d, ...ops) => ops.reduce((acc, op) => {
  const r = applyEdit(acc, op);
  assert.equal(r.error, null);
  return r.draft;
}, d);
const HOST = "forkadam-pc";

test("machineSection: null when the draft equals the base", () => {
  const c = fixture();
  assert.equal(machineSection(c, draftFromConfig(c, HOST)), null);
});

test("machineSection: size only", () => {
  const c = fixture();
  const d = edit(draftFromConfig(c, HOST), { type: "size", region: "left", value: 300 });
  assert.deepEqual(machineSection(c, d), { left: { size: 300 } });
});

test("machineSection: moving a feature writes whole feature arrays", () => {
  const c = withFiles();
  const d = edit(draftFromConfig(c, HOST), { type: "place", mod: "files", region: "right" });
  const s = machineSection(c, d);
  assert.deepEqual(s.right.features, [{ mod: "files" }]);
  assert.deepEqual(s.left.features, c.regions.left.features.filter((f) => f.mod !== "files"));
  assert.equal("size" in s.left || "size" in s.right, false);
});

test("machineSection: hidden false on a hidden base region", () => {
  const c = fixture();
  const d = edit(draftFromConfig(c, HOST), { type: "hidden", region: "right", value: false });
  assert.deepEqual(machineSection(c, d), { right: { hidden: false } });
});

test("machineSection: mode without hidden", () => {
  const c = fixture();
  const d = edit(draftFromConfig(c, HOST), { type: "mode", value: "icons" });
  assert.deepEqual(machineSection(c, d), { left: { mode: "icons" } });
});

test("machineSection: left hidden in the base needs hidden:false to show", () => {
  const c = fixture();
  c.regions.left.hidden = true;
  const d = edit(draftFromConfig(c, HOST), { type: "mode", value: "expanded" });
  assert.deepEqual(machineSection(c, d), { left: { mode: "expanded", hidden: false } });
});

// planSave writes the local file: { v: 1, regions } with the diff against base + machines.<host>.
const local = (regions, extra = {}) => JSON.stringify({ v: 1, regions, ...extra }, null, 2);

test("planSave: the local file holds only the diff against the base", () => {
  const c = fixture();
  const d = edit(draftFromConfig(c, HOST), { type: "size", region: "left", value: 300 });
  const r = planSave(JSON.stringify(c), null, HOST, d);
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(r.text), { v: 1, regions: { left: { size: 300 } } });
  assert.equal(r.text, formatConfig({ v: 1, regions: { left: { size: 300 } } }));
});

test("planSave: the diff is against base merged with machines.<host> (case-insensitive), other hosts ignored", () => {
  const c = fixture();
  c.machines = { "Forkadam-PC": { regions: { left: { size: 320 }, right: { hidden: false } } }, other: { regions: { top: { size: 99 } } } };
  // Draft opened over base + machines + local, then left set back to... 300.
  const opened = local({ bottom: { size: 40 } });
  const d0 = draftFromConfig(c, HOST, JSON.parse(opened));
  assert.equal(d0.regions.left.size, 320);
  assert.equal(d0.regions.right.hidden, false);
  assert.equal(d0.regions.bottom.size, 40);
  assert.equal(d0.regions.top.size, c.regions.top.size);
  const d = edit(d0, { type: "size", region: "left", value: 300 });
  const p = JSON.parse(planSave(JSON.stringify(c), opened, HOST, d).text);
  assert.deepEqual(p, { v: 1, regions: { left: { size: 300 }, bottom: { size: 40 } } });
});

test("planSave: matching the machines section leaves empty regions in the local file", () => {
  const c = fixture();
  c.machines = { [HOST]: { regions: { left: { size: 320 } } } };
  const r = planSave(JSON.stringify(c), local({ left: { size: 300 } }), HOST, draftFromConfig(c, HOST));
  assert.equal(r.ok, true);
  assert.equal(r.text, formatConfig({ v: 1, regions: {} }));
});

test("planSave: a save matching the base writes empty regions", () => {
  const c = fixture();
  const r = planSave(JSON.stringify(c), local({ left: { size: 300 } }), HOST, draftFromConfig(c, HOST));
  assert.deepEqual(JSON.parse(r.text), { v: 1, regions: {} });
});

test("planSave: other top-level keys of the local file are kept", () => {
  const c = fixture();
  const d = edit(draftFromConfig(c, HOST), { type: "mode", value: "icons" });
  const p = JSON.parse(planSave(JSON.stringify(c), local({}, { note: "mine" }), HOST, d).text);
  assert.deepEqual(p, { v: 1, regions: { left: { mode: "icons" } }, note: "mine" });
});

test("planSave: left hidden in machines.<host> needs hidden:false to show", () => {
  const c = fixture();
  c.machines = { [HOST]: { regions: { left: { hidden: true } } } };
  const d = edit(draftFromConfig(c, HOST), { type: "mode", value: "expanded" });
  assert.deepEqual(JSON.parse(planSave(JSON.stringify(c), null, HOST, d).text).regions, { left: { mode: "expanded", hidden: false } });
});

test("planSave: an invalid base gives the parseConfig error, an invalid local file its parseLocal error", () => {
  const r = planSave("{nope", null, HOST, draftFromConfig(fixture(), HOST));
  assert.equal(r.ok, false);
  assert.match(r.error, /Invalid JSON/);
  const r2 = planSave(JSON.stringify(fixture()), "{nope", HOST, draftFromConfig(fixture(), HOST));
  assert.equal(r2.ok, false);
  assert.match(r2.error, /local\.json: Invalid JSON/);
});

test("planReset deletes the local file", () => {
  assert.deepEqual(planReset(), { ok: true, delete: true });
});

test("formatConfig: round-trips, inlines features, keeps key order", () => {
  for (const url of ["./fixtures/dock.json", "../config/dock.json"]) {
    const x = JSON.parse(readFileSync(new URL(url, import.meta.url), "utf8"));
    const out = formatConfig(x);
    assert.deepEqual(JSON.parse(out), x);
    assert.ok(out.endsWith("}\n"));
    assert.equal(Object.keys(JSON.parse(out))[0], Object.keys(x)[0]);
    assert.equal(out.split("\n").some((l) => /^\s*"mod":/.test(l)), false);
  }
  const out = formatConfig(fixture());
  assert.ok(out.split("\n").includes('        { "mod": "dock-core", "size": 44 },'));
});
