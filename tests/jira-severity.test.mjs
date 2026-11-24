// The Jira page's severity block (src/shared/jira/severity.js, pure): a view's Jira field and its levels, checked
// and defaulted from the settings file.
import test from "node:test";
import assert from "node:assert/strict";
import {
  COLOR_NAMES, attentionJql, attentionLine, attentionNotLoaded, chipOf, chipWidth, colorOf, inkOn, levelOf, parseSeverity, severityFields, severityRow, severitySections,
  severityValue, tint,
} from "../src/shared/jira/severity.js";
import { ROW_FIELDS } from "../src/shared/jira/jql.js";
import { issueRow } from "../src/shared/jira/model.js";

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
  assert.equal(at([{ value: "A1" }, { value: "A2" }]), "A1");
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

test("levelOf: a value matches whatever its case and the spaces around it, as Jira's `in` does; the first match still wins", () => {
  assert.equal(levelOf("high", sev).label, "S1");
  assert.equal(levelOf("  HIGH ", sev).label, "S1");
  assert.equal(levelOf("medium", sev).label, "S2");
  assert.equal(levelOf("", sev), null);
  assert.equal(levelOf("   ", sev), null);
  const spaced = parseSeverity({ field: "f", levels: [{ values: ["Major"], label: "A", color: "red" }] }, "v").severity;
  assert.equal(levelOf("major", { ...spaced, levels: [{ ...spaced.levels[0], values: [" Major "] }] }).label, "A");
  const dup = parseSeverity({ field: "f", levels: [{ values: ["X"], label: "first", color: "red" }, { values: ["x"], label: "second", color: "gray" }] }, "v").severity;
  assert.equal(levelOf("x", dup).label, "first");
  // The box and the sections agree with the count: a value in another case is rated, not unrated.
  const { attention, sections } = severitySections([row("A-1", "high"), row("A-2", "LOW")], sev);
  assert.deepEqual(attention.map(keys), [["S1 · Highest/High", ["A-1"]]]);
  assert.deepEqual(sections.map(keys), [["S3 · Low", ["A-2"]]]);
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

// ---- what the page draws with it ----

test("severityFields: the rows' fields and the severity field, once; no severity: the search's own (undefined)", () => {
  assert.equal(severityFields(null), undefined);
  assert.deepEqual(severityFields(sev), [...ROW_FIELDS, "customfield_10001"]);
  const byPriority = parseSeverity({ ...block, field: "priority" }, "v").severity;
  assert.deepEqual(severityFields(byPriority), ROW_FIELDS);
});

test("severityRow: issueRow's row with the field's raw value; without severity, issueRow's as it is", () => {
  const base = "https://jira.example.com";
  const issue = { key: "A-1", fields: { summary: "s", status: { name: "Open", statusCategory: { key: "new" } }, customfield_10001: { value: "High" } } };
  assert.deepEqual(severityRow(issue, base, sev), { ...issueRow(issue, base), severity: "High" });
  assert.equal(severityRow({ key: "A-2", fields: {} }, base, sev).severity, null);
  const plain = severityRow(issue, base, null);
  assert.deepEqual(plain, issueRow(issue, base));
  assert.equal("severity" in plain, false);
});

const theme = { blocked: "#e5534b", done: "#57ab5a", dim: "#768390", accent: "#539bf5", foreground: "#adbac7", background: "#22272e" };

test("chipOf: a rated row's label in its level's colour, with the ink that reads on it; none when unrated", () => {
  assert.deepEqual(chipOf("High", sev, theme), { label: "S1", bg: "#e5534b", ink: inkOn("#e5534b") });
  assert.equal(chipOf("Medium", sev, theme).bg, "#abcdef");
  assert.equal(chipOf("Low", sev, theme).bg, "#768390");
  assert.equal(chipOf(null, sev, theme), null);
  assert.equal(chipOf("Unknown", sev, theme), null);
  assert.equal(chipOf("High", null, theme), null);
  // A theme without that colour: its accent.
  assert.equal(chipOf("High", sev, { ...theme, blocked: undefined }).bg, "#539bf5");
  // A named colour that is not the theme's: its fixed hex.
  const orange = parseSeverity({ field: "f", levels: [{ values: ["v"], label: "a", color: "orange" }] }, "v").severity;
  assert.equal(chipOf("v", orange, theme).bg, "#f97316");
  // No colour to read (a theme with neither): the theme's foreground for the text.
  assert.equal(chipOf("High", sev, { foreground: "#adbac7" }).ink, "#adbac7");
});

test("inkOn: dark ink on a light colour, light ink on a dark one; null for what is not a hex colour", () => {
  assert.equal(inkOn("#eab308"), "#111111");
  assert.equal(inkOn("#ffffff"), "#111111");
  assert.equal(inkOn("#fff"), "#111111");
  assert.equal(inkOn("#1f2328"), "#ffffff");
  assert.equal(inkOn("#7c3aed"), "#ffffff");
  assert.equal(inkOn("#000000cc"), "#ffffff");
  assert.equal(inkOn("red"), null);
  assert.equal(inkOn(undefined), null);
});

test("tint: a colour with an alpha (#rrggbbaa); #rgb spelled out; an alpha already there scaled; anything else as it is", () => {
  assert.equal(tint("#e5534b", 0.5), "#e5534b80");
  assert.equal(tint("#ABC", 1), "#aabbccff");
  assert.equal(tint("#e5534b80", 0.5), "#e5534b40");
  assert.equal(tint("#e5534b", 0), "#e5534b00");
  assert.equal(tint("red", 0.5), "red");
  assert.equal(tint(undefined, 0.5), undefined);
});

test("chipWidth: one width for a tab's chips, from its longest label, within bounds", () => {
  assert.equal(chipWidth(sev), 25); // "S1"
  const long = parseSeverity({ field: "f", levels: [{ values: ["v"], label: "Critical", color: "red" }, { values: ["w"], label: "S2", color: "red" }] }, "v").severity;
  assert.equal(chipWidth(long), 64);
  const one = parseSeverity({ field: "f", levels: [{ values: ["v"], label: "A", color: "red" }] }, "v").severity;
  assert.equal(chipWidth(one), 24);
  const huge = parseSeverity({ field: "f", levels: [{ values: ["v"], label: "x".repeat(80), color: "red" }] }, "v").severity;
  assert.equal(chipWidth(huge), 96);
});

test("attentionNotLoaded: the attention count less the attention rows loaded, while rows are left to load and nothing is searched", () => {
  const { attention } = severitySections([row("A-1", "High"), row("A-2", "Highest", "indeterminate"), row("A-3", "High", "done"), row("A-4", "Low")], sev);
  assert.equal(attentionNotLoaded(attention, 5, { left: 10, query: "" }), 3);
  assert.equal(attentionNotLoaded(attention, 5, { left: 10 }), 3);
  assert.equal(attentionNotLoaded([], 4, { left: 10 }), 4);
  // Every one counted is loaded; or fewer counted than loaded (one moved since): never below 0.
  assert.equal(attentionNotLoaded(attention, 2, { left: 10 }), 0);
  assert.equal(attentionNotLoaded(attention, 1, { left: 10 }), 0);
  // Every row loaded: nothing is left to load, so nothing is "not loaded".
  assert.equal(attentionNotLoaded(attention, 5, { left: 0 }), 0);
  assert.equal(attentionNotLoaded(attention, 5), 0);
  // A search typed: the count is the whole queue's, not the search's.
  assert.equal(attentionNotLoaded(attention, 5, { left: 10, query: "login" }), 0);
  // Not counted yet.
  assert.equal(attentionNotLoaded(attention, undefined, { left: 10 }), 0);
});

test("attentionJql: only the values whose level (the first that holds them, whatever the case) asks for attention", () => {
  const clash = parseSeverity({ field: "customfield_10001", levels: [
    { values: ["Medium"], label: "S2", color: "orange" },
    { values: ["High", "medium", "Critical"], label: "S1", color: "red", attention: true },
    { values: ["Low", "critical"], label: "S3", color: "gray", attention: true } ] }, "v").severity;
  // "medium" is S2's (first level wins, case aside): not asked for; "critical" is S1's "Critical" already: asked once.
  assert.equal(attentionJql("project = X", clash), '(project = X) AND cf[10001] in ("High", "Critical", "Low") AND statusCategory != Done');
  // Every attention value claimed by a calmer level before it: nothing to ask.
  const none = parseSeverity({ field: "f", levels: [{ values: ["A"], label: "a", color: "gray" }, { values: ["a"], label: "b", color: "red", attention: true }] }, "v").severity;
  assert.equal(attentionJql("project = X", none), null);
});

test("attentionLine: Jira rejected the attention search: said, with or without rows in the box", () => {
  const { attention } = severitySections([row("A-1", "High")], sev);
  const text = "Couldn't check what needs attention: Jira refused the request. The option 'Critcal' does not exist.";
  assert.deepEqual(attentionLine([], { rejected: "Jira refused the request. The option 'Critcal' does not exist.", counted: 3, left: 10 }), { kind: "rejected", text });
  assert.deepEqual(attentionLine(attention, { rejected: "Jira refused the request. The option 'Critcal' does not exist.", counted: 5, left: 10 }), { kind: "rejected", text });
});

test("attentionLine: some past the loaded rows: '<n> more not loaded' (with Load more), in a box with rows or without", () => {
  const { attention } = severitySections([row("A-1", "High"), row("A-2", "Highest", "indeterminate")], sev);
  assert.deepEqual(attentionLine(attention, { counted: 5, left: 10 }), { kind: "more", text: "3 more not loaded" });
  assert.deepEqual(attentionLine([], { counted: 4, left: 10 }), { kind: "more", text: "4 more not loaded" });
  // Rows in the box and nothing missing, or a search typed: nothing more to say.
  assert.equal(attentionLine(attention, { counted: 2, left: 10 }), null);
  assert.equal(attentionLine(attention, { counted: 5, left: 10, query: "login" }), null);
});

test("attentionLine: 'Nothing needs attention now' only where it holds: no search text, and every row loaded or the count at 0", () => {
  const quiet = { kind: "quiet", text: "Nothing needs attention now" };
  assert.deepEqual(attentionLine([], { left: 0 }), quiet);
  assert.deepEqual(attentionLine([], { counted: 0, left: 0 }), quiet);
  assert.deepEqual(attentionLine([], { counted: 0, left: 10 }), quiet);
  // Rows left to load and the count unknown (not answered yet, or failed): nothing is claimed.
  assert.equal(attentionLine([], { left: 10 }), null);
  assert.equal(attentionLine([], { counted: undefined, left: 10 }), null);
});

test("attentionLine: a search typed: '<n> need attention now (not in this search)' when the count says so, else nothing", () => {
  assert.deepEqual(attentionLine([], { counted: 2, left: 0, query: "login" }), { kind: "search", text: "2 need attention now (not in this search)" });
  assert.deepEqual(attentionLine([], { counted: 1, left: 10, query: "login" }), { kind: "search", text: "1 needs attention now (not in this search)" });
  assert.equal(attentionLine([], { counted: 0, left: 0, query: "login" }), null);
  assert.equal(attentionLine([], { left: 10, query: "login" }), null);
});
