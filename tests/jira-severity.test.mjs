// The Jira page's severity block (src/shared/jira/severity.js, pure): a view's Jira field and its levels, checked
// and defaulted from the settings file.
import test from "node:test";
import assert from "node:assert/strict";
import { COLOR_NAMES, parseSeverity } from "../src/shared/jira/severity.js";

const block = { field: "customfield_10001", levels: [
  { values: ["Highest", "High"], label: "S1", color: "red", attention: true },
  { values: ["Medium"], label: "S2", color: "#ABCDEF" },
  { values: ["Low"], label: "S3", color: "gray" } ] };

test("COLOR_NAMES", () => {
  assert.deepEqual(COLOR_NAMES, ["red", "orange", "yellow", "green", "blue", "purple", "gray"]);
});

test("parseSeverity: a valid block, defaults filled", () => {
  const { severity, warning } = parseSeverity(block, "views[0]");
  assert.equal(warning, null);
  assert.equal(severity.unrated, "No severity");
  assert.deepEqual(severity.levels[1], { values: ["Medium"], label: "S2", color: "#abcdef", attention: false });
});

test("parseSeverity: each malformed shape is one warning and no severity", () => {
  for (const bad of [null, "x", {}, { field: "f" }, { field: "f", levels: [] }, { field: "f", levels: [{ values: [], label: "a", color: "red" }] },
    { field: "f", levels: [{ values: ["v"], color: "red" }] }, { field: "f", levels: [{ values: ["v"], label: "a", color: "pink" }] },
    { field: "f", levels: [{ values: ["v"], label: "a", color: "red", attention: "yes" }] }]) {
    const r = parseSeverity(bad, "views[0]");
    assert.equal(r.severity, null, JSON.stringify(bad));
    assert.match(r.warning, /^views\[0\]\.severity: /);
  }
});

test("parseSeverity: the whole block, trimmed, with the optional unrated name", () => {
  const { severity, warning } = parseSeverity({ field: " customfield_10001 ", unrated: " Not assessed ", levels: [
    { values: [" Highest ", "High"], label: " S1 ", color: " red ", attention: true },
    { values: ["Low"], label: "S3", color: "#00FF7f", attention: false },
  ] }, "views[2]");
  assert.equal(warning, null);
  assert.deepEqual(severity, { field: "customfield_10001", unrated: "Not assessed", levels: [
    { values: ["Highest", "High"], label: "S1", color: "red", attention: true },
    { values: ["Low"], label: "S3", color: "#00ff7f", attention: false },
  ] });
});

test("parseSeverity: every colour name is accepted; a hex colour needs exactly six digits", () => {
  for (const color of COLOR_NAMES) {
    const r = parseSeverity({ field: "f", levels: [{ values: ["v"], label: "a", color }] }, "views[0]");
    assert.equal(r.warning, null, color);
    assert.equal(r.severity.levels[0].color, color);
  }
  for (const color of ["#fff", "#abcdeg", "#abcdef0", "abcdef", "Red", "", 5, null]) {
    const r = parseSeverity({ field: "f", levels: [{ values: ["v"], label: "a", color }] }, "views[0]");
    assert.equal(r.severity, null, JSON.stringify(color));
    assert.match(r.warning, /^views\[0\]\.severity: /);
  }
});

test("parseSeverity: each fault names what is wrong", () => {
  const warning = (v) => parseSeverity(v, "views[1]").warning;
  assert.equal(warning(null), "views[1].severity: not an object");
  assert.equal(warning({ levels: [] }), "views[1].severity: needs a field");
  assert.equal(warning({ field: "f" }), "views[1].severity: needs a list of levels");
  assert.equal(warning({ field: "f", levels: [] }), "views[1].severity: needs a list of levels");
  assert.equal(warning({ field: "f", levels: ["x"] }), "views[1].severity: levels[0] is not an object");
  assert.equal(warning({ field: "f", levels: [{ values: [], label: "a", color: "red" }] }), "views[1].severity: levels[0] needs a list of values");
  assert.equal(warning({ field: "f", levels: [{ values: ["v", " "], label: "a", color: "red" }] }), "views[1].severity: levels[0] needs a list of values");
  assert.equal(warning({ field: "f", levels: [{ values: ["v"], color: "red" }] }), "views[1].severity: levels[0] needs a label");
  assert.equal(warning({ field: "f", levels: [{ values: ["v"], label: "a", color: "pink" }] }), `views[1].severity: levels[0] colour is not ${COLOR_NAMES.join(", ")} or #rrggbb`);
  assert.equal(warning({ field: "f", levels: [{ values: ["v"], label: "a", color: "red", attention: "yes" }] }), "views[1].severity: levels[0] attention is not true or false");
  assert.equal(warning({ field: "f", unrated: "  ", levels: [{ values: ["v"], label: "a", color: "red" }] }), "views[1].severity: unrated is not a name");
  assert.equal(warning({ field: "f", levels: [{ values: ["v"], label: "a", color: "red" }, null] }), "views[1].severity: levels[1] is not an object");
});
