// Where a ticket's work starts (src/shared/jira/start-in.js, pure): the folder, the space already working there,
// the picker's rows, the remembered map and the Herdr command to run.
import test from "node:test";
import assert from "node:assert/strict";
import { inside, normPath, openCommand, parseProjects, pickerRows, remember, resolveFolder, spaceFor, suggestFolder } from "../src/shared/jira/start-in.js";

const home = "/home/u";
const spaces = [
  { id: "s1", name: "app", folder: "/home/u", machine: null, tabs: [{ id: "t1" }] },
  { id: "s2", name: "tools", folder: "/home/u/code", machine: null, tabs: [{ id: "t2" }, { id: "t3" }] },
  { id: "s3", name: "app", folder: "/home/u/code/app", machine: null, tabs: [{ id: "t4" }] },
  { id: "s4", name: "far", folder: "/home/u/code/app", machine: "box", tabs: [{ id: "t5" }] },
];
const panes = [
  { tab: "t1", cwd: "/home/u/code/app/src" }, { tab: "t2", cwd: "/home/u/code/tools" }, { tab: "t3", cwd: null },
  { tab: "t4", cwd: "/home/u/code/app" }, { tab: "t5", cwd: "/home/u/code/app" },
];
test("normPath / inside", () => {
  assert.equal(normPath("~/code/app/", home), "/home/u/code/app");
  assert.equal(normPath("C:\\x\\y", home), "C:/x/y");
  assert.equal(inside("/a/b/c", "/a/b"), true);
  assert.equal(inside("/a/bc", "/a/b"), false);
});
test("resolveFolder: remembered beats mapped; unknown project is null", () => {
  const o = { remembered: { "ABC-1": "/home/u/code/other" }, projects: { ABC: "~/code/app" }, home };
  assert.deepEqual(resolveFolder({ key: "ABC-1", project: "ABC" }, o), { folder: "/home/u/code/other", source: "remembered" });
  assert.deepEqual(resolveFolder({ key: "ABC-2", project: "ABC" }, o), { folder: "/home/u/code/app", source: "mapped" });
  assert.equal(resolveFolder({ key: "XYZ-1", project: "XYZ" }, o), null);
});
test("suggestFolder: own, then the parent's remembered, then mapped", () => {
  const o = { remembered: { "ABC-1": "/p" }, projects: { ABC: "/m" }, home };
  assert.equal(suggestFolder({ key: "ABC-2", project: "ABC", parent: { key: "ABC-1" } }, o), "/p");
  assert.equal(suggestFolder({ key: "ABC-3", project: "ABC", parent: null }, o), "/m");
});
test("spaceFor: a live terminal in the repo counts; the shown space wins; other machines never", () => {
  assert.equal(spaceFor("/home/u/code/app", { spaces, panes, shownSpace: null, home }).id, "s1");
  assert.equal(spaceFor("/home/u/code/app", { spaces, panes, shownSpace: "s3", home }).id, "s3");
  assert.equal(spaceFor("/home/u/code/none", { spaces, panes, shownSpace: null, home }), null);
});
test("pickerRows: distinct folders, home left out, mapped first", () => {
  const rows = pickerRows({ spaces, panes, home, mapped: "/home/u/code/zed" });
  // Mapped first (added though no space is in it); the rest by label: app, code, src, tools. s4 is another machine.
  assert.deepEqual(rows.map((r) => r.folder), ["/home/u/code/zed", "/home/u/code/app", "/home/u/code", "/home/u/code/app/src", "/home/u/code/tools"]);
  assert.deepEqual(rows[0].spaces, []);
  assert.ok(!rows.some((r) => r.folder === "/home/u"));
  assert.ok(rows.find((r) => r.folder === "/home/u/code/app").spaces.includes("app"));
  assert.equal(rows.find((r) => r.folder === "/home/u/code/tools").path, "~/code/tools");
});
test("remember: newest last, capped", () => {
  const m = remember(remember({ a: "/1", b: "/2" }, "a", "/3"), "c", "/4", 2);
  assert.deepEqual(m, { a: "/3", c: "/4" });
});
test("openCommand: a tab in the space with the folder given, else a new space", () => {
  assert.deepEqual(openCommand({ folder: "/home/u/code/app", space: { id: "s1" }, name: "ABC-1", task: "go" }),
    { command: "tab.new", args: { space: "s1", folder: "/home/u/code/app", name: "ABC-1", argv: ["claude"], task: "go" } });
  assert.deepEqual(openCommand({ folder: "/home/u/code/app", space: null, name: "ABC-1", task: "go" }),
    { command: "space.new", args: { name: "app", folder: "/home/u/code/app", tab: "ABC-1", argv: ["claude"], task: "go" } });
});
test("parseProjects", () => {
  assert.deepEqual(parseProjects({ ABC: " ~/code/app ", BAD: 3 }), { projects: { ABC: "~/code/app" }, warnings: ["projects.BAD: must be a folder path"] });
  assert.deepEqual(parseProjects("x").warnings, ["projects: not a map of project key to folder"]);
  assert.deepEqual(parseProjects(undefined), { projects: {}, warnings: [] });
});
