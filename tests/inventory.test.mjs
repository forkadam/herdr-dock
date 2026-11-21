import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildInventory, installedFallbackIds, placeability } from "../src/shared/inventory.js";
import { draftFromConfig } from "../src/shared/edit.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/dock.json", import.meta.url), "utf8"));

test("placeability: reasons in order, null when placeable", () => {
  assert.equal(placeability("picker", { place: "none", overlay: {} }), "overlay");
  assert.equal(placeability("picker", { overlay: {} }), "overlay");
  assert.equal(placeability("mission-control-github", { place: "right", overlay: {} }), null);
  assert.equal(placeability("confirm", { place: "none" }), "helper");
  assert.equal(placeability("dock-config", { place: "right" }), "self");
  assert.equal(placeability("_x", {}), "hidden-name");
  assert.equal(placeability(".git", {}), "hidden-name");
  assert.equal(placeability("weird", null), "broken");
  assert.equal(placeability("tabs", { place: "none", title: "Tabs" }), null);
});

test("installedFallbackIds: drops layout: keys, [] on bad input", () => {
  assert.deepEqual(installedFallbackIds('{"tabs":{},"layout:main":{}}'), ["tabs"]);
  assert.deepEqual(installedFallbackIds("not json"), []);
  assert.deepEqual(installedFallbackIds(null), []);
  assert.deepEqual(installedFallbackIds("[1]"), []);
});

test("buildInventory: regions, reasons, uninstalled config mods, sort order", () => {
  const draft = draftFromConfig(fixture, "");
  const items = buildInventory(
    [
      { id: "confirm", modJson: { place: "none" } },
      { id: "broken", modJson: null },
      { id: "tabs", modJson: { title: "Tabs" } },
      { id: "files", modJson: { title: "Files" } },
    ],
    draft,
  );
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(by.files.region, null);
  assert.equal(by.files.reason, null);
  assert.equal(by.tabs.region, "top");
  assert.equal(by.confirm.reason, "helper");
  assert.equal(by.broken.reason, "broken");
  assert.equal(by["workspace-status"].installed, false);
  assert.equal(by["workspace-status"].region, "bottom");
  assert.equal(by["workspace-status"].reason, null);
  assert.equal(by.tabs.installed, true);
  const firstBlocked = items.findIndex((i) => i.reason !== null);
  assert.ok(items.slice(firstBlocked).every((i) => i.reason !== null));
  const placeable = items.slice(0, firstBlocked).map((i) => i.title.toLowerCase());
  assert.deepEqual(placeable, [...placeable].sort());
});

test("buildInventory: a config mod that is also installed is listed once", () => {
  const draft = draftFromConfig(fixture, "");
  const items = buildInventory([{ id: "tabs", modJson: {} }], draft);
  assert.equal(items.filter((i) => i.id === "tabs").length, 1);
  assert.equal(items.find((i) => i.id === "tabs").title, "tabs");
});

test("modRows: placed mods are always normal rows; unplaced unplaceable ones go to the others", async () => {
  const { modRows } = await import("../src/shared/inventory.js");
  const inv = [
    { id: "files", reason: null, region: null },
    { id: "toast", reason: "helper", region: "right" },
    { id: "menu", reason: "helper", region: null },
  ];
  const { normal, others } = modRows(inv);
  assert.deepEqual(normal.map((i) => i.id), ["files", "toast"]);
  assert.deepEqual(others.map((i) => i.id), ["menu"]);
});
