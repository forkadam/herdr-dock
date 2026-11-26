// Loads dock-notifications' real class against stubbed host modules: the filter chips and Clear all / Clear shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetHost, handlers, texts, clearTexts } from "./fixtures/host-stubs.mjs";
import { HISTORY_KEY } from "../src/shared/notify.js";

const herdr = await import("herdr");
const { default: Notifications } = await import("../src/mods/dock-notifications/main.js");
const cx = { notify() {}, stop_propagation() {}, timer: { every() {} } };

const item = (o) => ({ id: "x", at: Date.now(), title: "T", body: null, level: "info", icon: null, action: null,
  read: true, needs: null, resolved: false, ...o });
const HISTORY = [
  item({ id: "a1", title: "claude needs you", level: "error", action: { name: "agent.focus", args: { terminal: "t1" } },
    needs: { kind: "agent", terminal: "t1" } }),
  item({ id: "a2", title: "claude finished", action: { name: "agent.focus", args: { terminal: "t2" } } }),
  item({ id: "c1", title: "app · main", level: "error", action: { name: "dock-core.git.show.eHk" },
    needs: { kind: "pipeline", worktree: "w" }, resolved: true }),
  item({ id: "u1", title: "herdr-dock update available", action: { name: "mod.open", args: { name: "dock-config" } } }),
];

function panel() {
  resetHost();
  localStorage.clear();
  herdr.data.props = { overlay: "o1" };
  herdr.data.shared.set(HISTORY_KEY, HISTORY);
  const p = new Notifications();
  p.init({}, cx);
  clearTexts();
  p.render(cx);
  return p;
}
const redraw = (p) => { clearTexts(); p.render(cx); };
const rowTitles = () => texts().filter((s) => HISTORY.some((x) => x.title === s));

test("chips: All plus each non-empty filter with its count; empty ones are hidden", () => {
  panel();
  const t = texts();
  for (const chip of ["All 4", "Needs you 1", "Agents 2", "CI 1", "Updates 1"]) assert.ok(t.includes(chip), `${chip} in ${t}`);
  assert.ok(!t.some((s) => s.startsWith("Other")), "no Other chip with 0 items");
});

test("a chip filters the list; clicking it again shows everything", () => {
  const p = panel();
  handlers()["nt-filter-agents:on_click"]({}, cx);
  redraw(p);
  assert.deepEqual(rowTitles(), ["claude needs you", "claude finished"]);
  handlers()["nt-filter-agents:on_click"]({}, cx);
  redraw(p);
  assert.equal(rowTitles().length, 4);
});

test("no filter: Clear all sends notify.clearall; with a filter: Clear shown sends notify.clearfilter for it", () => {
  const p = panel();
  assert.ok(texts().includes("Clear all"));
  handlers()["nt-clearall:on_click"]({}, cx);
  assert.deepEqual(herdr.data.runs.at(-1), ["dock-core.notify.clearall", undefined]);
  handlers()["nt-filter-ci:on_click"]({}, cx);
  redraw(p);
  assert.ok(texts().includes("Clear shown"));
  handlers()["nt-clearall:on_click"]({}, cx);
  assert.deepEqual(herdr.data.runs.at(-1), ["dock-core.notify.clearfilter.ci", undefined]);
});

test("the chosen filter is remembered; a filter whose items are gone falls back to All", () => {
  let p = panel();
  handlers()["nt-filter-updates:on_click"]({}, cx);
  p = new Notifications();
  p.init({}, cx);
  redraw(p);
  assert.deepEqual(rowTitles(), ["herdr-dock update available"]);
  herdr.data.shared.set(HISTORY_KEY, HISTORY.filter((x) => x.id !== "u1"));
  redraw(p);
  assert.equal(rowTitles().length, 3, "no update items left: everything shows");
  assert.ok(texts().includes("Clear all"));
});
