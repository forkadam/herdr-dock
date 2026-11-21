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

test("planSave: writes into the existing host key, case-insensitively, keeping other keys", () => {
  const c = fixture();
  c.machines = { "Forkadam-PC": { regions: { left: { size: 320 } }, note: "x" } };
  const d = edit(draftFromConfig(c, HOST), { type: "size", region: "left", value: 300 });
  const r = planSave(JSON.stringify(c), HOST, d);
  assert.equal(r.ok, true);
  const p = JSON.parse(r.text);
  assert.equal(p.machines["Forkadam-PC"].regions.left.size, 300);
  assert.equal(p.machines["Forkadam-PC"].note, "x");
  assert.equal("forkadam-pc" in p.machines, false);
});

test("planSave: nothing else changes", () => {
  const c = fixture();
  c.machines = { other: { regions: { right: { hidden: false } }, note: "y" } };
  const d = edit(draftFromConfig(c, HOST), { type: "size", region: "top", value: 50 });
  const p = JSON.parse(planSave(JSON.stringify(c), HOST, d).text);
  assert.deepEqual(p.regions, c.regions);
  assert.deepEqual(p.machines.other, c.machines.other);
  assert.equal(p.machines[HOST].regions.top.size, 50);
});

test("planSave: creates machines when absent and a section is needed; omits it when not", () => {
  const c = fixture();
  delete c.machines;
  const d = edit(draftFromConfig(c, HOST), { type: "mode", value: "icons" });
  const p = JSON.parse(planSave(JSON.stringify(c), HOST, d).text);
  assert.deepEqual(p.machines, { [HOST]: { regions: { left: { mode: "icons" } } } });
  assert.equal(Object.keys(p).at(-1), "machines");
  const q = JSON.parse(planSave(JSON.stringify(c), HOST, draftFromConfig(c, HOST)).text);
  assert.equal("machines" in q, false);
});

test("planSave: no empty leftovers", () => {
  const c = fixture();
  c.machines = { [HOST]: { regions: { left: { size: 320 } } } };
  const base = fixture();
  const p = JSON.parse(planSave(JSON.stringify(c), HOST, draftFromConfig(base, HOST)).text);
  assert.deepEqual(p.machines, {});
  c.machines[HOST].note = "n";
  const q = JSON.parse(planSave(JSON.stringify(c), HOST, draftFromConfig(base, HOST)).text);
  assert.deepEqual(q.machines, { [HOST]: { note: "n" } });
});

test("planSave: invalid text gives the parseConfig error", () => {
  const r = planSave("{nope", HOST, draftFromConfig(fixture(), HOST));
  assert.equal(r.ok, false);
  assert.match(r.error, /Invalid JSON/);
});

test("planReset removes the host section, case-insensitively, and nothing else", () => {
  const c = fixture();
  c.machines = { "Forkadam-PC": { regions: { left: { size: 1 } } }, other: { regions: {} } };
  const r = planReset(JSON.stringify(c), HOST);
  assert.equal(r.ok, true);
  const p = JSON.parse(r.text);
  assert.deepEqual(p.machines, { other: { regions: {} } });
  assert.deepEqual(p.regions, c.regions);
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
