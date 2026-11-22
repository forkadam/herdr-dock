import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeForHost, parseConfig, planApply } from "../src/shared/config.js";
import { buildLayout, pageActiveOf, pageChildOf, pageIds } from "../src/shared/layout.js";
import { focusLeavesPage, liveWork, nextPage, pageClick, planPage } from "../src/shared/panel.js";
import { applyEdit, draftFromConfig, planSave } from "../src/shared/edit.js";
import { badgeOf, badgeText, pageMeta } from "../src/mods/dock-pages/view.js";
import { overviewModel } from "../src/mods/dock-overview/view.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const withPages = (features) => { const c = clone(DEFAULT_CONFIG); c.regions.pages = { features }; return c; };
const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean) ?? null);
const PAGES = [{ mod: "dock-overview" }, { mod: "dock-jira", props: { site: "work" } }];

test("no pages: the work area is the terminal block, exactly as before", () => {
  const tree = buildLayout(mergeForHost(DEFAULT_CONFIG, ""), { page: "dock-overview" });
  assert.equal(find(tree, "dock-work-stack"), null);
  assert.deepEqual(find(tree, "dock-body").children[0].id, "dock-main");
});

test("pages: a stack of the terminal and one block per page, showing this PC's page", () => {
  const merged = mergeForHost(withPages(PAGES), "");
  const tree = buildLayout(merged, {});
  const stack = find(tree, "dock-work-stack");
  assert.equal(stack.type, "stack");
  assert.equal(stack.active, "dock-main");
  assert.deepEqual(stack.children.map((c) => c.id), ["dock-main", "dock-page-0-dock-overview", "dock-page-1-dock-jira"]);
  assert.deepEqual(stack.children[2].content, { mod: "dock-jira", props: { site: "work", dockFeature: "dock-page-1-dock-jira", dockRegion: "pages" } });
  assert.equal(find(buildLayout(merged, { page: "dock-jira" }), "dock-work-stack").active, "dock-page-1-dock-jira");
  assert.equal(find(buildLayout(merged, { page: "gone" }), "dock-work-stack").active, "dock-main");
  assert.deepEqual(pageIds(merged), ["dock-page-0-dock-overview", "dock-page-1-dock-jira"]);
});

test("pageActiveOf / pageChildOf", () => {
  assert.equal(pageActiveOf("dock-jira", PAGES), "dock-jira");
  assert.equal(pageActiveOf("nope", PAGES), null);
  assert.equal(pageActiveOf(null, PAGES), null);
  assert.equal(pageChildOf("dock-jira", PAGES), "dock-page-1-dock-jira");
  assert.equal(pageChildOf(null, PAGES), "dock-main");
});

test("planPage selects the right child once, and waits for a layout that has it", () => {
  const live = { active: "dock-main", children: ["dock-main", "dock-page-0-dock-overview", "dock-page-1-dock-jira"] };
  assert.deepEqual(planPage({ active: "dock-jira", features: PAGES, live }),
    [{ command: "layout.select", args: { stack: "dock-work-stack", child: "dock-page-1-dock-jira" } }]);
  assert.deepEqual(planPage({ active: null, features: PAGES, live }), []);
  assert.deepEqual(planPage({ active: "dock-jira", features: PAGES, live: { ...live, active: "dock-page-1-dock-jira" } }), []);
  assert.deepEqual(planPage({ active: "dock-jira", features: PAGES, live: { active: "dock-main", children: ["dock-main"] } }), []);
  assert.deepEqual(planPage({ active: "dock-jira", features: PAGES, live: null }), []);
  assert.deepEqual(liveWork({ id: "root", children: [{ id: "dock-work-stack", active: "dock-main", children: [{ id: "dock-main" }, { id: "x" }] }] }),
    { active: "dock-main", children: ["dock-main", "x"] });
  assert.equal(liveWork({ id: "root" }), null);
});

test("nextPage cycles terminal → pages → terminal; pageClick toggles; focus changes leave a page", () => {
  assert.equal(nextPage(null, PAGES), "dock-overview");
  assert.equal(nextPage("dock-overview", PAGES), "dock-jira");
  assert.equal(nextPage("dock-jira", PAGES), null);
  assert.equal(nextPage("gone", PAGES), "dock-overview");
  assert.equal(nextPage(null, []), null);
  assert.equal(pageClick("dock-jira", "dock-jira"), null);
  assert.equal(pageClick(null, "dock-jira"), "dock-jira");
  assert.equal(pageClick("dock-overview", "dock-jira"), "dock-jira");
  assert.equal(focusLeavesPage(null, "s1|t1"), false);
  assert.equal(focusLeavesPage("s1|t1", "s1|t1"), false);
  assert.equal(focusLeavesPage("s1|t1", "s1|t2"), true);
});

test("config: pages take features only; page-only mods stay in pages", () => {
  assert.equal(parseConfig(JSON.stringify(withPages(PAGES))).ok, true);
  const sized = withPages(PAGES); sized.regions.pages.size = 3;
  assert.match(parseConfig(JSON.stringify(sized)).error, /pages\.size/);
  const fsize = withPages([{ mod: "dock-overview", size: 3 }]);
  assert.match(parseConfig(JSON.stringify(fsize)).error, /features\[0\]\.size/);
  const hidden = withPages(PAGES); hidden.regions.pages.hidden = true;
  assert.match(parseConfig(JSON.stringify(hidden)).error, /pages\.hidden/);
  const misplaced = clone(DEFAULT_CONFIG); misplaced.regions.right.features.push({ mod: "dock-overview" });
  assert.match(parseConfig(JSON.stringify(misplaced)).error, /only be placed in regions\.pages/);
  const nav = withPages([{ mod: "dock-pages" }]);
  assert.match(parseConfig(JSON.stringify(nav)).error, /only be placed in regions\.left/);
  // A config written before pages existed still parses and merges to an empty pages region.
  const old = clone(DEFAULT_CONFIG); delete old.regions.pages;
  assert.deepEqual(mergeForHost(parseConfig(JSON.stringify(old)).config, "").regions.pages.features, []);
});

test("dialog: placing a page also adds the Pages list to the left panel, before the footer; saved per PC", () => {
  const draft = draftFromConfig(DEFAULT_CONFIG, "pc");
  const r = applyEdit(draft, { type: "place", mod: "dock-overview", region: "pages" });
  assert.equal(r.error, null);
  assert.deepEqual(r.draft.regions.pages.features, [{ mod: "dock-overview" }]);
  const left = r.draft.regions.left.features.map((f) => f.mod);
  assert.deepEqual(left.slice(-2), ["dock-pages", "dock-footer"]);
  assert.equal(r.draft.regions.left.features.find((f) => f.mod === "dock-pages").size, 52);
  assert.match(applyEdit(draft, { type: "place", mod: "dock-overview", region: "left" }).error, /regions\.pages/);
  assert.match(applyEdit(draft, { type: "size", region: "pages", value: 2 }).error, /no size/);
  const saved = planSave(JSON.stringify(DEFAULT_CONFIG), null, "pc", r.draft);
  assert.equal(saved.ok, true);
  const local = JSON.parse(saved.text);
  assert.deepEqual(local.regions.pages, { features: [{ mod: "dock-overview" }] });
  assert.ok(local.regions.left.features.some((f) => f.mod === "dock-pages"));
  // The saved local file builds a layout with the stack.
  const plan = planApply(JSON.stringify(DEFAULT_CONFIG), "pc", null, null, { page: "dock-overview" }, saved.text);
  assert.equal(find(JSON.parse(plan.write), "dock-work-stack").active, "dock-page-0-dock-overview");
});

test("Pages list helpers: title, icon and badge", () => {
  assert.deepEqual(pageMeta("dock-jira", { title: "Jira" }, { icon: "jira.svg" }, false), { title: "Jira", icon: "mods/dock-jira/jira.svg" });
  assert.deepEqual(pageMeta("x", null, { name: "X page" }, true), { title: "X page", icon: "mods/x/icon.svg" });
  assert.deepEqual(pageMeta("x", null, null, false), { title: "x", icon: null });
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(3), "3");
  assert.equal(badgeText(250), "99+");
  assert.equal(badgeText(" new "), "new");
  assert.equal(badgeText(null), null);
  assert.deepEqual(badgeOf({ count: 2, tone: "bad" }), { text: "2", tone: "bad" });
  assert.deepEqual(badgeOf({ count: 0, tone: "bad" }), null);
  assert.deepEqual(badgeOf({ text: "new", tone: "odd" }), { text: "new", tone: "info" });
  assert.deepEqual(badgeOf(7), { text: "7", tone: "info" });
});

test("Overview groups agents by status, needs-you first, newest first", () => {
  const m = overviewModel([
    { address: "a", pane: "p1", status: "idle", title: "shell", space_name: "web", tab_name: "", tab_index: 0, seq: 1 },
    { address: "b", pane: "p2", status: "blocked", title: "  ", program: { name: "Claude" }, space_name: "api", tab_name: "fix", seq: 5 },
    { address: "c", pane: "p3", status: "blocked", title: "codex", space_name: "api", tab_name: "x", seq: 9 },
    { address: "d", pane: "p4", status: "weird", title: "?", seq: 2 },
  ]);
  assert.deepEqual(m.counts, { blocked: 2, done: 0, working: 0, idle: 2 });
  assert.deepEqual(m.groups.map((g) => g.status), ["blocked", "idle"]);
  assert.deepEqual(m.groups[0].agents.map((a) => a.address), ["c", "b"]);
  assert.equal(m.groups[0].agents[1].title, "Claude");
  assert.equal(m.groups[0].agents[1].where, "api · fix");
  assert.equal(m.groups[1].agents.find((a) => a.address === "a").where, "web · tab 1");
});
