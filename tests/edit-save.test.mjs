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

// The browser block's production hosts: saved to the local file only when they differ from the shared config's.
const withProd = (c, production) => ({ ...c, browser: { production } });
const prodDraft = (c, hosts, localText = null) => applyEdit(draftFromConfig(c, HOST, localText && JSON.parse(localText)), { type: "production", hosts }).draft;

test("planSave: production hosts go to browser.production, keeping the local browser's other keys", () => {
  const c = fixture();
  const opened = local({}, { browser: { enabled: true } });
  const r = planSave(JSON.stringify(c), opened, HOST, prodDraft(c, ["b.com"], opened));
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(r.text).browser, { enabled: true, production: ["b.com"] });
  // No local file, no browser block yet.
  const fresh = planSave(JSON.stringify(c), null, HOST, prodDraft(c, ["b.com"]));
  assert.deepEqual(JSON.parse(fresh.text), { v: 1, regions: {}, browser: { production: ["b.com"] } });
  // A local chrome path stays too.
  const chrome = local({}, { browser: { chrome: "/c", production: ["old.com"] } });
  const p = JSON.parse(planSave(JSON.stringify(c), chrome, HOST, prodDraft(c, ["b.com"], chrome)).text);
  assert.deepEqual(p.browser, { chrome: "/c", production: ["b.com"] });
});

test("planSave: production equal to the shared config's drops the local key, then an empty browser block", () => {
  const c = withProd(fixture(), ["a.com"]);
  const opened = local({}, { browser: { enabled: false, production: ["b.com"] } });
  const d = prodDraft(c, ["a.com"], opened);
  assert.deepEqual(JSON.parse(planSave(JSON.stringify(c), opened, HOST, d).text), { v: 1, regions: {}, browser: { enabled: false } });
  const only = local({}, { browser: { production: ["b.com"] }, note: "mine" });
  assert.deepEqual(JSON.parse(planSave(JSON.stringify(c), only, HOST, prodDraft(c, ["a.com"], only)).text), { v: 1, regions: {}, note: "mine" });
  // Nothing to drop: a draft that equals the shared hosts writes no browser block.
  const none = planSave(JSON.stringify(c), null, HOST, draftFromConfig(c, HOST));
  assert.deepEqual(JSON.parse(none.text), { v: 1, regions: {} });
});

test("planSave: the shared config's hosts include machines.<host>, never the local file", () => {
  const c = fixture();
  c.browser = { production: ["a.com"] };
  c.machines = { [HOST]: { browser: { production: ["m.com"] } } };
  const opened = local({}, { browser: { production: ["l.com"] } });
  // Equal to the machines value: the local key goes.
  const same = JSON.parse(planSave(JSON.stringify(c), opened, HOST, prodDraft(c, ["m.com"], opened)).text);
  assert.equal("browser" in same, false);
  // Equal to the plain base but not the machines value: kept.
  const other = JSON.parse(planSave(JSON.stringify(c), opened, HOST, prodDraft(c, ["a.com"], opened)).text);
  assert.deepEqual(other.browser, { production: ["a.com"] });
  // Clearing every host is a difference too.
  const none = JSON.parse(planSave(JSON.stringify(c), null, HOST, prodDraft(c, [])).text);
  assert.deepEqual(none.browser, { production: [] });
});

test("planSave: a draft without production leaves the local browser block untouched", () => {
  const c = fixture();
  const opened = local({}, { browser: { enabled: true, production: ["l.com"] } });
  const d = draftFromConfig(c, HOST, JSON.parse(opened));
  delete d.production;
  assert.deepEqual(JSON.parse(planSave(JSON.stringify(c), opened, HOST, d).text).browser, { enabled: true, production: ["l.com"] });
});

// The browser puts dock-browser in the right region through the merge, so a Save with it on must not
// write that region into the local file (it would pin this PC's right panel to today's shared list).
test("planSave: with the browser on, only real layout edits are written", () => {
  const c = fixture();
  const opened = local({}, { browser: { enabled: true } });
  const untouched = draftFromConfig(c, HOST, JSON.parse(opened));
  assert.deepEqual(JSON.parse(planSave(JSON.stringify(c), opened, HOST, untouched).text), { v: 1, regions: {}, browser: { enabled: true } });
  assert.deepEqual(JSON.parse(planSave(JSON.stringify(c), opened, HOST, prodDraft(c, ["b.com"], opened)).text),
    { v: 1, regions: {}, browser: { enabled: true, production: ["b.com"] } });
  // Turned on in the shared config instead: the same.
  const on = { ...fixture(), browser: { enabled: true } };
  assert.deepEqual(JSON.parse(planSave(JSON.stringify(on), null, HOST, draftFromConfig(on, HOST)).text), { v: 1, regions: {} });
  // Turned off on this PC while the shared config has it on: nothing to pin either.
  const off = local({}, { browser: { enabled: false } });
  assert.deepEqual(JSON.parse(planSave(JSON.stringify(on), off, HOST, draftFromConfig(on, HOST, JSON.parse(off))).text),
    { v: 1, regions: {}, browser: { enabled: false } });
  // Moving dock-browser is a real edit: both regions are written.
  const moved = edit(untouched, { type: "place", mod: "dock-browser", region: "bottom" });
  const r = JSON.parse(planSave(JSON.stringify(c), opened, HOST, moved).text);
  assert.deepEqual(r.regions.bottom.features, [...c.regions.bottom.features, { mod: "dock-browser" }]);
  assert.deepEqual(r.regions.right.features, []);
});

test("planReset keeps the local browser block and drops the regions", () => {
  const r = planReset('{"v":1,"regions":{"left":{"size":9}},"browser":{"enabled":true}}');
  assert.equal(r.ok, true);
  assert.equal(r.delete, undefined);
  assert.deepEqual(JSON.parse(r.text), { v: 1, regions: {}, browser: { enabled: true } });
  assert.equal(r.text, formatConfig({ v: 1, regions: {}, browser: { enabled: true } }));
  const full = JSON.parse(planReset(local({ top: { size: 9 } }, { browser: { chrome: "/c", production: ["a.com"] }, note: "x" })).text);
  assert.deepEqual(full, { v: 1, regions: {}, browser: { chrome: "/c", production: ["a.com"] } });
});

test("planReset deletes the local file when there is no browser block or it can't be read", () => {
  for (const text of ['{"v":1,"regions":{}}', '{"v":1,"regions":{"left":{"size":9}}}', null, undefined, "{nope", '{"v":2,"browser":{"enabled":true}}', '{"v":1,"browser":{"enabled":"yes"}}']) {
    assert.deepEqual(planReset(text), { ok: true, delete: true }, String(text));
  }
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
