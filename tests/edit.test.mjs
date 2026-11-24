import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfig } from "../src/shared/config.js";
import { allowedRegions, canTurnOff, draftFromConfig, regionOf, applyEdit, sameDraft, rebaseDraft } from "../src/shared/edit.js";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/dock.json", import.meta.url), "utf8"));
const REGIONS = ["top", "left", "right", "bottom", "pages"];
const names = (d, r) => d.regions[r].features.map((f) => f.mod);
const base = () => draftFromConfig(fixture(), "any");

test("allowedRegions and canTurnOff", () => {
  assert.deepEqual(allowedRegions("dock-core"), ["top"]);
  assert.deepEqual(allowedRegions("dock-spaces"), ["left"]);
  assert.deepEqual(allowedRegions("files"), REGIONS);
  assert.equal(canTurnOff("dock-core"), false);
  assert.equal(canTurnOff("tabs"), true);
});

test("allowedRegions agrees with parseConfig", () => {
  const mods = ["dock-core", "dock-header", "dock-footer", "dock-spaces", "dock-agents", "dock-git", "dock-quotas", "dock-pages", "dock-overview", "files", "tabs"];
  for (const mod of mods) {
    for (const region of REGIONS) {
      const c = fixture();
      // dock-core is moved (parseConfig tolerates a duplicate, the UI never makes one).
      if (mod === "dock-core") c.regions.top.features.shift();
      (c.regions[region] ??= { features: [] }).features.push({ mod });
      assert.equal(parseConfig(JSON.stringify(c)).ok, allowedRegions(mod).includes(region), `${mod} in ${region}`);
    }
  }
});

test("place moves a mod and appends it last", () => {
  const c = fixture();
  c.regions.left.features.push({ mod: "files" });
  const d = draftFromConfig(c, "h");
  const { draft, error } = applyEdit(d, { type: "place", mod: "files", region: "right" });
  assert.equal(error, null);
  assert.equal(regionOf(draft, "files"), "right");
  assert.ok(!names(draft, "left").includes("files"));
  assert.equal(names(draft, "right").at(-1), "files");
});

test("place keeps dock-footer last", () => {
  const c = fixture();
  c.regions.left.features.push({ mod: "dock-footer" });
  const d = draftFromConfig(c, "h");
  const out = applyEdit(d, { type: "place", mod: "workspace-status", region: "left" }).draft;
  const f = names(out, "left");
  assert.equal(f.indexOf("workspace-status"), f.length - 2);
  const out2 = applyEdit(base(), { type: "place", mod: "workspace-status", region: "left" }).draft;
  assert.equal(names(out2, "left").at(-1), "workspace-status");
});

test("place keeps feature settings", () => {
  const c = fixture();
  c.regions.bottom.features[0] = { mod: "workspace-status", size: 150, props: { a: 1 } };
  const out = applyEdit(draftFromConfig(c, "h"), { type: "place", mod: "workspace-status", region: "right" }).draft;
  assert.deepEqual(out.regions.right.features[0], { mod: "workspace-status", size: 150, props: { a: 1 } });
});

test("place into the same region or off a mod not placed is a no-op", () => {
  const d = base();
  const a = applyEdit(d, { type: "place", mod: "tabs", region: "top" });
  assert.equal(a.error, null);
  assert.ok(sameDraft(a.draft, d));
  const b = applyEdit(d, { type: "place", mod: "files", region: "off" });
  assert.equal(b.error, null);
  assert.ok(sameDraft(b.draft, d));
});

test("place errors leave the draft unchanged", () => {
  const d = base();
  const a = applyEdit(d, { type: "place", mod: "dock-spaces", region: "right" });
  assert.match(a.error, /regions\.left/);
  assert.ok(sameDraft(a.draft, d));
  assert.ok(applyEdit(d, { type: "place", mod: "dock-core", region: "off" }).error);
  assert.ok(applyEdit(d, { type: "place", mod: "dock-core", region: "left" }).error);
});

test("place off removes the mod", () => {
  const out = applyEdit(base(), { type: "place", mod: "tabs", region: "off" });
  assert.equal(out.error, null);
  assert.equal(regionOf(out.draft, "tabs"), null);
});

test("move", () => {
  const d = base();
  const a = applyEdit(d, { type: "move", region: "top", index: 1, delta: -1 });
  assert.ok(a.error);
  assert.equal(names(a.draft, "top")[0], "dock-core");
  const b = applyEdit(d, { type: "move", region: "left", index: 0, delta: -1 });
  assert.equal(b.error, null);
  assert.ok(sameDraft(b.draft, d));
  const c = applyEdit(d, { type: "move", region: "left", index: 2, delta: 1 });
  assert.equal(c.error, null);
  assert.ok(sameDraft(c.draft, d));
  const e = applyEdit(d, { type: "move", region: "left", index: 0, delta: 1 });
  assert.deepEqual(names(e.draft, "left").slice(0, 2), ["dock-agents", "dock-spaces"]);
});

test("size", () => {
  const d = base();
  assert.equal(applyEdit(d, { type: "size", region: "left", value: 300 }).draft.regions.left.size, 300);
  for (const value of [0, 2.5, "x"]) {
    const r = applyEdit(d, { type: "size", region: "left", value });
    assert.ok(r.error);
    assert.ok(sameDraft(r.draft, d));
  }
});

test("hidden", () => {
  const d = base();
  assert.ok(applyEdit(d, { type: "hidden", region: "top", value: true }).error);
  const r = applyEdit(d, { type: "hidden", region: "right", value: false });
  assert.equal(r.error, null);
  assert.equal(r.draft.regions.right.hidden, false);
});

test("mode", () => {
  const d = base();
  assert.equal(applyEdit(d, { type: "mode", value: "icons" }).draft.regions.left.mode, "icons");
  assert.ok(applyEdit(d, { type: "mode", value: "bogus" }).error);
});

test("draftFromConfig: left hidden, host merge, deep copy", () => {
  const c = fixture();
  c.regions.left.hidden = true;
  const d = draftFromConfig(c, "h");
  assert.equal(d.regions.left.mode, "hidden");
  assert.equal(d.regions.left.hidden, false);
  const c2 = fixture();
  c2.machines = { Box: { regions: { right: { size: 500 } } } };
  assert.equal(draftFromConfig(c2, "box").regions.right.size, 500);
  const d3 = base();
  d3.regions.top.features[0].size = 1;
  assert.equal(fixture().regions.top.features[0].size, 44);
});

test("stepSize: starts at 1 with no size and never goes below 1", async () => {
  const { stepSize } = await import("../src/shared/edit.js");
  assert.equal(stepSize(undefined, 1), 1);
  assert.equal(stepSize(undefined, -1), 1);
  assert.equal(stepSize(1, -1), 1);
  assert.equal(stepSize(10, -1), 9);
  assert.equal(stepSize(10, 1), 11);
});

test("sameDraft ignores key order and compares features by content", async () => {
  const { sameDraft } = await import("../src/shared/edit.js");
  const a = { regions: { top: { size: 1, features: [{ mod: "x", size: 2 }], hidden: false }, left: { mode: "icons", features: [], hidden: false }, right: { features: [], hidden: true }, bottom: { features: [], hidden: false } } };
  const b = { regions: { top: { hidden: false, features: [{ size: 2, mod: "x" }], size: 1 }, left: { hidden: false, features: [], mode: "icons" }, right: { hidden: true, features: [] }, bottom: { hidden: false, features: [] } } };
  assert.equal(sameDraft(a, b), true);
  b.regions.left.mode = "hidden";
  assert.equal(sameDraft(a, b), false);
});

test("draftFromConfig: production hosts come from the merged browser section, default none", () => {
  assert.deepEqual(base().production, []);
  const c = fixture();
  c.browser = { production: ["a.com"] };
  const d = draftFromConfig(c, "h");
  assert.deepEqual(d.production, ["a.com"]);
  // The local file's browser block wins over the shared one; the draft holds a copy.
  const l = draftFromConfig(c, "h", { v: 1, regions: {}, browser: { production: ["l.com", "*.l.com"] } });
  assert.deepEqual(l.production, ["l.com", "*.l.com"]);
  d.production.push("x.com");
  assert.deepEqual(c.browser.production, ["a.com"]);
});

test("applyEdit production sets the hosts and sameDraft sees the difference", () => {
  const c = fixture();
  c.browser = { production: ["a.com"] };
  const d = draftFromConfig(c, "h");
  const r = applyEdit(d, { type: "production", hosts: ["b.com"] });
  assert.equal(r.error, null);
  assert.deepEqual(r.draft.production, ["b.com"]);
  assert.deepEqual(d.production, ["a.com"]);
  assert.equal(sameDraft(r.draft, d), false);
  assert.equal(sameDraft(applyEdit(d, { type: "production", hosts: ["a.com"] }).draft, d), true);
  assert.deepEqual(applyEdit(d, { type: "production", hosts: [] }).draft.production, []);
});

test("applyEdit production rejects bad hosts and leaves the draft unchanged", () => {
  const d = applyEdit(base(), { type: "production", hosts: ["a.com"] }).draft;
  for (const hosts of ["a.com", null, undefined, [1], ["https://a.com"], ["a.com/x"], ["a.com:80"], [""], ["a.com", "*"]]) {
    const r = applyEdit(d, { type: "production", hosts });
    assert.equal(typeof r.error, "string", JSON.stringify(hosts));
    assert.equal(r.draft, d);
  }
});

test("rebaseDraft carries the user's changed production hosts over the fresh draft", () => {
  const withProd = (production) => ({ ...base(), production });
  const baseDraft = withProd(["a.com"]);
  // The user edited the hosts; the file moved on with other changes.
  const fresh = applyEdit(withProd(["a.com"]), { type: "size", region: "left", value: 310 }).draft;
  const mine = withProd(["b.com"]);
  const out = rebaseDraft(baseDraft, mine, fresh);
  assert.deepEqual(out.production, ["b.com"]);
  assert.equal(out.regions.left.size, 310);
  // Not changed by the user: the fresh draft's hosts stand.
  const kept = rebaseDraft(baseDraft, applyEdit(baseDraft, { type: "size", region: "left", value: 300 }).draft, withProd(["f.com"]));
  assert.deepEqual(kept.production, ["f.com"]);
  assert.equal(kept.regions.left.size, 300);
  // The user clearing every host is a change too.
  assert.deepEqual(rebaseDraft(baseDraft, withProd([]), withProd(["f.com"])).production, []);
  // The result is a copy.
  mine.production.push("z.com");
  assert.deepEqual(out.production, ["b.com"]);
});
