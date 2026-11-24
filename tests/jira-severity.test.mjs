// The Jira page's severity block (src/shared/jira/severity.js, pure): a view's Jira field and its levels, checked
// and defaulted from the settings file.
import test from "node:test";
import assert from "node:assert/strict";
import { COLOR_NAMES, attentionJql, colorOf, levelOf, parseSeverity, severitySections, severityValue } from "../src/shared/jira/severity.js";

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

const sev = parseSeverity(block, "v").severity;
const row = (key, value, category = "new") => ({ key, severity: value, category, summary: key });
const keys = (s) => [s.title, s.parts.flatMap((p) => p.rows.map((r) => r.key))];

test("severitySections: attention box, the rest in level order, unrated last", () => {
  const { attention, sections } = severitySections([row("A-1", "Low"), row("A-2", "High"), row("A-3", "High", "done"), row("A-4", null), row("A-5", "Unknown"), row("A-6", "Medium", "indeterminate")], sev);
  assert.deepEqual(attention.map(keys), [["S1 · Highest/High", ["A-2"]]]);
  assert.deepEqual(sections.map(keys),
    [["S1 · Highest/High", ["A-3"]], ["S2 · Medium", ["A-6"]], ["S3 · Low", ["A-1"]], ["No severity", ["A-4", "A-5"]]]);
});

test("severitySections: each section carries its level; the rest carry none; empty ones are left out", () => {
  const { attention, sections } = severitySections([row("A-1", "Medium"), row("A-2", "High")], sev);
  assert.deepEqual(attention.map((s) => s.level.label), ["S1"]);
  assert.deepEqual(sections.map((s) => [s.title, s.level?.label ?? null]), [["S2 · Medium", "S2"]]);
  assert.deepEqual(severitySections([], sev), { attention: [], sections: [] });
  const unrated = severitySections([row("A-1", null)], sev);
  assert.deepEqual(unrated.attention, []);
  assert.deepEqual(unrated.sections.map((s) => [s.title, s.level]), [["No severity", null]]);
});

test("severitySections: an attention level's done rows stay out of the box, in its section", () => {
  const { attention, sections } = severitySections([row("A-1", "Highest", "done")], sev);
  assert.deepEqual(attention, []);
  assert.deepEqual(sections.map(keys), [["S1 · Highest/High", ["A-1"]]]);
});

test("severitySections: parts are grouped by category", () => {
  const { sections } = severitySections([row("A-1", "Low", "done"), row("A-2", "Low", "indeterminate"), row("A-3", "Low")], sev);
  assert.deepEqual(sections[0].parts.map((p) => [p.category, p.rows.map((r) => r.key)]), [["new", ["A-3"]], ["indeterminate", ["A-2"]], ["done", ["A-1"]]]);
});

test("severitySections: the unrated name follows the severity", () => {
  const named = parseSeverity({ ...block, unrated: "Not assessed" }, "v").severity;
  assert.deepEqual(severitySections([row("A-1", null)], named).sections.map((s) => s.title), ["Not assessed"]);
});

test("attentionJql: parenthesised, ORDER BY dropped, values quoted, open only", () => {
  assert.equal(attentionJql('project = X OR labels = y ORDER BY updated DESC', sev),
    '(project = X OR labels = y) AND cf[10001] in ("Highest", "High") AND statusCategory != Done');
  assert.equal(attentionJql("project = X", parseSeverity({ ...block, levels: block.levels.map((l) => ({ ...l, attention: false })) }, "v").severity), null);
});

test("attentionJql: the field is cf[N] for a custom field, else its name quoted when not a plain word; values with quotes are escaped", () => {
  const withField = (field, values = ["High"]) => parseSeverity({ field, levels: [{ values, label: "S1", color: "red", attention: true }] }, "v").severity;
  assert.equal(attentionJql("project = X", withField("customfield_42")), '(project = X) AND cf[42] in ("High") AND statusCategory != Done');
  assert.equal(attentionJql("project = X", withField("severity")), '(project = X) AND severity in ("High") AND statusCategory != Done');
  assert.equal(attentionJql("project = X", withField("Bug Severity")), '(project = X) AND "Bug Severity" in ("High") AND statusCategory != Done');
  assert.equal(attentionJql("project = X", withField("severity", ['Say "no"'])), '(project = X) AND severity in ("Say \\"no\\"") AND statusCategory != Done');
  assert.equal(attentionJql("project = X", withField("customfield_x")), '(project = X) AND customfield_x in ("High") AND statusCategory != Done');
});

test("attentionJql: only the attention levels' values, in order, across levels; no ORDER BY is fine; an empty jql adds no empty parentheses", () => {
  const two = parseSeverity({ field: "customfield_1", levels: [
    { values: ["A"], label: "x", color: "red", attention: true }, { values: ["B"], label: "y", color: "gray" }, { values: ["C", "D"], label: "z", color: "blue", attention: true } ] }, "v").severity;
  assert.equal(attentionJql("project = X", two), '(project = X) AND cf[1] in ("A", "C", "D") AND statusCategory != Done');
  assert.equal(attentionJql("  ORDER BY updated DESC", two), 'cf[1] in ("A", "C", "D") AND statusCategory != Done');
  assert.equal(attentionJql("", two), 'cf[1] in ("A", "C", "D") AND statusCategory != Done');
});

test("severityValue / levelOf / colorOf", () => {
  assert.equal(severityValue({ fields: { customfield_10001: { value: "High" } } }, "customfield_10001"), "High");
  assert.equal(severityValue({ fields: { customfield_10001: [{ name: "Low" }] } }, "customfield_10001"), "Low");
  assert.equal(severityValue({ fields: {} }, "customfield_10001"), null);
  assert.equal(levelOf("High", sev).label, "S1");
  assert.equal(levelOf("Unknown", sev), null);
  assert.deepEqual(colorOf("red"), { theme: "blocked" });
  assert.deepEqual(colorOf("#abcdef"), { hex: "#abcdef" });
});

test("severityValue: a string as is, value before name, the first of a list, anything else null", () => {
  const at = (v) => severityValue({ fields: { f: v } }, "f");
  assert.equal(at("High"), "High");
  assert.equal(at({ value: "V", name: "N" }), "V");
  assert.equal(at({ name: "N" }), "N");
  assert.equal(at([{ value: "V1" }, { value: "V2" }]), "V1");
  assert.equal(at(["S1", "S2"]), "S1");
  assert.equal(at([]), null);
  assert.equal(at(null), null);
  assert.equal(at(5), null);
  assert.equal(at({}), null);
  assert.equal(at({ value: 5 }), null);
  assert.equal(severityValue({}, "f"), null);
  assert.equal(severityValue(null, "f"), null);
});

test("levelOf: the first level holding the value; null for no value", () => {
  assert.equal(levelOf("Highest", sev).label, "S1");
  assert.equal(levelOf("Low", sev).label, "S3");
  assert.equal(levelOf(null, sev), null);
  const dup = parseSeverity({ field: "f", levels: [{ values: ["X"], label: "first", color: "red" }, { values: ["X"], label: "second", color: "gray" }] }, "v").severity;
  assert.equal(levelOf("X", dup).label, "first");
});

test("colorOf: names map to the theme or a fixed hex; a hex is kept as given", () => {
  assert.deepEqual(colorOf("green"), { theme: "done" });
  assert.deepEqual(colorOf("gray"), { theme: "dim" });
  assert.deepEqual(colorOf("orange"), { hex: "#f97316" });
  assert.deepEqual(colorOf("yellow"), { hex: "#eab308" });
  assert.deepEqual(colorOf("blue"), { hex: "#3b82f6" });
  assert.deepEqual(colorOf("purple"), { hex: "#8b5cf6" });
  for (const name of COLOR_NAMES) assert.ok(colorOf(name).theme || colorOf(name).hex, name);
});
