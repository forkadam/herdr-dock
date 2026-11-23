// The sprint model (src/shared/jira/sprint.js): board columns, the current sprint, the sprint menu, lanes by parent
// story, a drop on a column and the sprint's label. Dates are shown in local time, so pin it.
process.env.TZ = "UTC";

import test from "node:test";
import assert from "node:assert/strict";
import { columnDrop, pickSprint, seriesKey, sprintColumns, sprintLabel, sprintRows, sprintSeries } from "../src/shared/jira/sprint.js";

const S = (id, name, state, start, end) => ({ id, name, state, startMs: start, endMs: end });
const s41 = S(41, "Sprint 41", "closed", 1, 2), s42 = S(42, "Sprint 42", "active", 3, 9), s43 = S(43, "Sprint 43", "future", null, null), otter = S(7, "Otter Sprint 7", "active", 2, 8);
const ids = (list) => list.map((s) => s.id);

test("pickSprint: the active sprint holding most of yours", () => {
  assert.equal(pickSprint([otter, s42], new Map([[42, 17], [7, 0]])).id, 42);
  assert.equal(pickSprint([s42, otter], new Map()).id, 7); // all zero: earliest start
  assert.equal(pickSprint([], new Map()), null);
});

test("pickSprint: a tie goes to the earliest start; a sprint without a start comes last; then the lowest id", () => {
  assert.equal(pickSprint([s42, otter], new Map([[42, 3], [7, 3]])).id, 7);
  assert.equal(pickSprint([s43, s42], new Map()).id, 42);
  assert.equal(pickSprint([S(9, "A 9", "active", 4, 8), S(8, "A 8", "active", 4, 8)], new Map()).id, 8);
  assert.equal(pickSprint([s42], new Map()).id, 42);
  assert.equal(pickSprint(null, new Map()), null);
});

test("seriesKey: the name with its last number replaced by #", () => {
  assert.equal(seriesKey("Lapras Sprint 19"), "Lapras Sprint #");
  assert.equal(seriesKey("Planning"), null);
  assert.equal(seriesKey("Sprint 42 - Alpha 7"), "Sprint 42 - Alpha #", "only the last run of digits");
  assert.equal(seriesKey("Sprint 2024.15 "), "Sprint 2024.#", "trimmed");
  assert.equal(seriesKey("42"), "#");
  assert.equal(seriesKey(undefined), null);
});

test("sprintSeries: one series, newest first; no number falls back to sprints with yours", () => {
  assert.deepEqual(sprintSeries(s42, [s41, s42, s43, otter], new Map()).map((s) => s.id), [43, 42, 41]);
  const plan = S(5, "Planning", "active", 2, 9); // starts before Sprint 42, so 42 is newer
  assert.deepEqual(sprintSeries(plan, [plan, s42, otter], new Map([[5, 2], [42, 1]])).map((s) => s.id), [42, 5]);
  assert.equal(seriesKey("Lapras Sprint 19"), "Lapras Sprint #");
  assert.equal(seriesKey("Planning"), null);
});

test("sprintSeries: the last 5 closed (latest end), the active one, only the next future one", () => {
  const closed = [1, 2, 3, 4, 5, 6, 7].map((n) => S(100 + n, `Sprint ${n}`, "closed", n * 10, n * 10 + 9));
  const active = S(108, "Sprint 8", "active", 80, 89);
  const later = S(110, "Sprint 10", "future", 100, 109), next = S(109, "Sprint 9", "future", 90, 99);
  const out = sprintSeries(active, [...closed, later, active, next], new Map());
  assert.deepEqual(ids(out), [109, 108, 107, 106, 105, 104, 103], "Sprint 10 is not the next future one; Sprints 1 and 2 are not among the last 5");
});

test("sprintSeries: closed sprints are ranked by end, then start, then id", () => {
  const cur = S(50, "Sprint 50", "active", 500, 509);
  const byEnd = S(30, "Sprint 30", "closed", 0, 450); // the earliest start, but the latest end
  const noEnd = S(31, "Sprint 31", "closed", 400, null); // no end: ranks by its start
  const rest = [1, 2, 3, 4].map((n) => S(n, `Sprint ${n}`, "closed", n, n + 1));
  assert.deepEqual(ids(sprintSeries(cur, [...rest, noEnd, byEnd, cur], new Map())).sort((a, b) => a - b), [2, 3, 4, 30, 31, 50], "Sprint 1 ended first");
  const undated = [1, 2, 3, 4, 5, 6].map((n) => S(n, `Sprint ${n}`, "closed", null, null));
  assert.deepEqual(ids(sprintSeries(cur, [...undated, cur], new Map())).sort((a, b) => a - b), [2, 3, 4, 5, 6, 50], "no dates at all: the higher ids");
});

test("sprintSeries: the next future one is the earliest start; none dated comes after dated ones; a tie goes to the lowest id", () => {
  const cur = S(10, "Sprint 10", "active", 100, 109);
  const dated = S(13, "Sprint 13", "future", 120, 129), undated = S(12, "Sprint 12", "future", null, null);
  assert.deepEqual(ids(sprintSeries(cur, [cur, undated, dated], new Map())), [13, 10], "the dated one, not the one without a start");
  assert.deepEqual(ids(sprintSeries(cur, [cur, undated, S(11, "Sprint 11", "future", null, null)], new Map())), [11, 10], "undated: the lowest id");
  assert.deepEqual(ids(sprintSeries(cur, [cur, S(15, "Sprint 15", "future", 130, 139), S(14, "Sprint 14", "future", 130, 139)], new Map())), [14, 10]);
});

test("sprintSeries: newest first by start (a sprint without one is the newest), a tie by the higher id", () => {
  const cur = S(20, "Sprint 20", "active", 50, 59);
  const twin = S(19, "Sprint 19", "closed", 50, 49), older = S(18, "Sprint 18", "closed", 10, 19), future = S(21, "Sprint 21", "future", null, null);
  assert.deepEqual(ids(sprintSeries(cur, [older, twin, future, cur], new Map())), [21, 20, 19, 18]);
});

test("sprintSeries: the current sprint is listed even when closed, another series never is", () => {
  const closed = [1, 2, 3, 4, 5, 6].map((n) => S(n, `Sprint ${n}`, "closed", n, n + 1));
  const out = sprintSeries(closed[0], [...closed, otter, S(60, "Other Sprint 6", "active", 1, 2)], new Map());
  assert.ok(ids(out).includes(1), "the current one, though it is the oldest");
  assert.equal(out.length, 6, "the 5 latest closed plus the current one");
  assert.ok(!ids(out).includes(7) && !ids(out).includes(60));
});

test("sprintSeries: without a number in the name, every sprint with yours; the current one stays", () => {
  const plan = S(5, "Planning", "active", 2, 9);
  const mine = new Map([[41, 4], [43, 1], [42, 0]]);
  assert.deepEqual(ids(sprintSeries(plan, [plan, s41, s42, s43], mine)), [43, 5, 41], "Sprint 42 holds none of yours; Planning is the current one");
  assert.deepEqual(ids(sprintSeries(plan, [], new Map())), [5]);
});

test("sprintSeries: a bad list gives just the current sprint", () => {
  assert.deepEqual(ids(sprintSeries(s42, null, new Map())), [42]);
  assert.deepEqual(sprintSeries(null, [s42], new Map()), []);
});

test("sprintColumns: names from ids", () => {
  const cols = sprintColumns([{ name: "To Do", statusIds: ["1"] }, { name: "RD In Progress", statusIds: ["3", "4", "99"] }, { name: "Empty", statusIds: [] }],
    [{ id: "1", name: "To Do" }, { id: "3", name: "In Progress" }, { id: "4", name: "Handling" }]);
  assert.deepEqual(cols, [{ name: "To Do", statuses: ["To Do"] }, { name: "RD In Progress", statuses: ["In Progress", "Handling"] }, { name: "Empty", statuses: [] }]);
});

test("sprintColumns: bad input gives no columns, a column without ids is empty", () => {
  assert.deepEqual(sprintColumns(null, []), []);
  assert.deepEqual(sprintColumns([{ name: "A" }], null), [{ name: "A", statuses: [] }]);
});

test("sprintRows: lanes by parent; a parent in the sprint heads its lane; Other issues last", () => {
  const p = { key: "WEB-40", summary: "Story", status: "Spec design" };
  const lanes = sprintRows([{ key: "WEB-9", parent: null }, { key: "WEB-41", parent: p }, { key: "WEB-40", parent: null }, { key: "WEB-42", parent: p }]);
  assert.deepEqual(lanes.map((l) => [l.parent?.key ?? null, l.rows.map((r) => r.key)]), [["WEB-40", ["WEB-41", "WEB-42"]], [null, ["WEB-9"]]]);
});

test("sprintRows: lanes in first-appearance order; a parent outside the sprint heads its lane from the child's parent", () => {
  const a = { key: "WEB-1", summary: "First", status: "Open", type: "Story" }, b = { key: "WEB-2", summary: "Second", status: "Done", type: "Story" };
  const lanes = sprintRows([{ key: "W-10", parent: b }, { key: "W-11", parent: a }, { key: "W-12", parent: b }, { key: "W-13", parent: null }]);
  assert.deepEqual(lanes.map((l) => l.parent?.key ?? null), ["WEB-2", "WEB-1", null]);
  assert.deepEqual(lanes[0].parent, { key: "WEB-2", summary: "Second", status: "Done" }, "just key, summary and status");
  assert.deepEqual(lanes[0].rows.map((r) => r.key), ["W-10", "W-12"]);
});

test("sprintRows: the header of a parent that is a row is that row's own data, and it is no card anywhere", () => {
  const stale = { key: "WEB-40", summary: "Old title", status: "Spec design" };
  const lanes = sprintRows([
    { key: "WEB-40", summary: "New title", status: "In Progress", parent: null },
    { key: "WEB-41", parent: stale },
    { key: "WEB-5", parent: null },
  ]);
  assert.deepEqual(lanes[0].parent, { key: "WEB-40", summary: "New title", status: "In Progress" });
  assert.deepEqual(lanes.flatMap((l) => l.rows.map((r) => r.key)), ["WEB-41", "WEB-5"]);
});

test("sprintRows: no rows, no lanes; no loose rows, no Other issues lane", () => {
  assert.deepEqual(sprintRows([]), []);
  assert.deepEqual(sprintRows(null), []);
  const p = { key: "WEB-40", summary: "Story", status: "Open" };
  assert.deepEqual(sprintRows([{ key: "WEB-41", parent: p }]).map((l) => l.parent.key), ["WEB-40"]);
});

test("columnDrop: a column of several statuses", () => {
  const tr = (id, to) => ({ id, to: { name: to } });
  const col = { name: "RD In Progress", statuses: ["In Progress", "Handling"] };
  assert.deepEqual(columnDrop([tr("1", "In Progress"), tr("2", "Done")], col, "To Do"), { kind: "run", transition: tr("1", "In Progress") });
  assert.equal(columnDrop([tr("1", "In Progress"), tr("5", "Handling")], col, "To Do").kind, "choose");
  assert.equal(columnDrop([tr("2", "Done")], col, "To Do").kind, "none");
});

test("columnDrop: the choice lists the moves into the column; the card's own status is never a target; bad input is none", () => {
  const tr = (id, to) => ({ id, to: { name: to } });
  const col = { name: "RD In Progress", statuses: ["In Progress", "Handling"] };
  const plan = columnDrop([tr("1", "In Progress"), tr("5", "Handling"), tr("2", "Done")], col, "To Do");
  assert.deepEqual(plan.transitions.map((t) => t.id), ["1", "5"]);
  assert.deepEqual(columnDrop([tr("1", "In Progress"), tr("5", "Handling")], col, "Handling"), { kind: "run", transition: tr("1", "In Progress") });
  assert.equal(columnDrop([tr("1", "In Progress")], col, "In Progress").kind, "none");
  assert.equal(columnDrop(null, col, "To Do").kind, "none");
  assert.equal(columnDrop([tr("1", "In Progress")], null, "To Do").kind, "none");
  assert.equal(columnDrop([{ id: "9" }, null], col, "To Do").kind, "none");
});

const at = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

test("sprintLabel: the name, the dates and the days left", () => {
  const sprint = S(42, "Sprint 42", "active", at(2026, 11, 16, 9), at(2026, 11, 27, 18));
  assert.equal(sprintLabel(sprint, at(2026, 11, 22, 12)), "Sprint 42 · Nov 16 – Nov 27 · 5 days left");
  assert.equal(sprintLabel(sprint, at(2026, 11, 16, 9)), "Sprint 42 · Nov 16 – Nov 27 · 11 days left");
});

test("sprintLabel: the last day is 1 day left from the day before, whatever the hour", () => {
  const sprint = S(42, "Sprint 42", "active", at(2026, 11, 16, 9), at(2026, 11, 27, 18));
  assert.equal(sprintLabel(sprint, at(2026, 11, 26, 0, 1)), "Sprint 42 · Nov 16 – Nov 27 · 1 day left", "42 hours to go is still tomorrow");
  assert.equal(sprintLabel(sprint, at(2026, 11, 26, 23, 59)), "Sprint 42 · Nov 16 – Nov 27 · 1 day left");
});

test("sprintLabel: ends today while the end is still ahead on today's date", () => {
  const sprint = S(42, "Sprint 42", "active", at(2026, 11, 16, 9), at(2026, 11, 27, 18));
  assert.equal(sprintLabel(sprint, at(2026, 11, 27, 0, 0)), "Sprint 42 · Nov 16 – Nov 27 · ends today");
  assert.equal(sprintLabel(sprint, at(2026, 11, 27, 17, 59)), "Sprint 42 · Nov 16 – Nov 27 · ends today");
});

test("sprintLabel: ended from the end on", () => {
  const sprint = S(42, "Sprint 42", "active", at(2026, 11, 16, 9), at(2026, 11, 27, 18));
  assert.equal(sprintLabel(sprint, at(2026, 11, 27, 18)), "Sprint 42 · Nov 16 – Nov 27 · ended");
  assert.equal(sprintLabel(sprint, at(2026, 12, 3, 8)), "Sprint 42 · Nov 16 – Nov 27 · ended");
});

test("sprintLabel: a day left across a month and a year end; without dates, just the name", () => {
  const sprint = S(1, "Sprint 1", "active", at(2026, 12, 20, 9), at(2027, 1, 2, 18));
  assert.equal(sprintLabel(sprint, at(2026, 12, 30, 12)), "Sprint 1 · Dec 20 – Jan 2 · 3 days left");
  assert.equal(sprintLabel(s43, at(2026, 11, 22)), "Sprint 43");
  assert.equal(sprintLabel(S(2, "Sprint 2", "future", at(2026, 11, 30), null), at(2026, 11, 22)), "Sprint 2");
  assert.equal(sprintLabel(S(3, "Sprint 3", "active", null, at(2026, 11, 30)), at(2026, 11, 22)), "Sprint 3");
});
