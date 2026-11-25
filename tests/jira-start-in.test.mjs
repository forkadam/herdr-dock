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
  // s4 is on another machine: even shown, and with the folder as its own, it is never the answer.
  assert.equal(spaceFor("/home/u/code/app", { spaces, panes, shownSpace: "s4", home }).id, "s1");
  assert.equal(spaceFor("/home/u/code/none", { spaces, panes, shownSpace: null, home }), null);
});
test("pickerRows: distinct folders, home left out, mapped first", () => {
  const rows = pickerRows({ spaces, panes, home, mapped: "/home/u/code/zed" });
  // Mapped first (added though no space is in it); the rest by label: app, code, src, tools. s4 is another machine.
  assert.deepEqual(rows.map((r) => r.folder), ["/home/u/code/zed", "/home/u/code/app", "/home/u/code", "/home/u/code/app/src", "/home/u/code/tools"]);
  assert.deepEqual(rows[0].spaces, []);
  assert.ok(!rows.some((r) => r.folder === "/home/u"));
  assert.deepEqual(rows.find((r) => r.folder === "/home/u/code/app").spaces, ["app"], "not s4's name (it is another machine)");
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

// ---- Task 2: the probe, the plain Start's place, the picker's choices and keys ----
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderProbe, parseFolderProbe, pickerChoices, pickerKey, pickerReason, probePaths, startPlace, tildePath } from "../src/shared/jira/start-in.js";

const runProbe = (paths, env) => {
  const { command, args } = folderProbe(paths);
  return execFileSync(command === "node" ? process.execPath : command, args, { env, encoding: "utf8" });
};
test("folderProbe: one node run learns home (HOME, else USERPROFILE) and which paths are folders, ~ expanded", () => {
  const h = realpathSync(mkdtempSync(join(tmpdir(), "start-in-")));
  try {
    mkdirSync(join(h, "code", "app"), { recursive: true });
    writeFileSync(join(h, "file.txt"), "x");
    const paths = ["~/code/app", "~", "~/code/none", join(h, "code"), join(h, "file.txt"), "code/app", "~other/code"];
    const out = parseFolderProbe(runProbe(paths, { HOME: h }), paths);
    assert.equal(out.home, h);
    // A file is not a folder; a relative path or ~user is never one (nothing is guessed).
    assert.deepEqual(paths.map((p) => out.exists(p)), [true, true, false, true, false, false, false]);
    const win = parseFolderProbe(runProbe(["~/code/app"], { USERPROFILE: h }), ["~/code/app"]);
    assert.equal(win.home, h);
    assert.equal(win.exists("~/code/app"), true);
    // No home at all (an empty USERPROFILE: on Windows a child given neither gets the parent's, from libuv): a ~ path
    // is not a folder, an absolute one still is.
    const none = parseFolderProbe(runProbe(["~/code/app", join(h, "code")], { USERPROFILE: "" }), ["~/code/app", join(h, "code")]);
    assert.equal(none.home, null);
    assert.deepEqual([none.exists("~/code/app"), none.exists(join(h, "code"))], [false, true]);
    // Nothing to check still answers home.
    assert.equal(parseFolderProbe(runProbe([], { HOME: h }), []).home, h);
  } finally {
    rmSync(h, { recursive: true, force: true });
  }
});
test("parseFolderProbe: anything but the probe's answer for these paths is null (a failed probe: nothing exists)", () => {
  assert.equal(parseFolderProbe("", ["/a"]), null);
  assert.equal(parseFolderProbe("oops", ["/a"]), null);
  assert.equal(parseFolderProbe(JSON.stringify({ home: "/h", exists: [] }), ["/a"]), null);
  assert.equal(parseFolderProbe(JSON.stringify([true]), ["/a"]), null);
  const p = parseFolderProbe(JSON.stringify({ home: "", exists: [true, "yes"] }), ["/a", "/b"]);
  assert.equal(p.home, null);
  assert.deepEqual([p.exists("/a"), p.exists("/b"), p.exists("/c")], [true, false, false]);
});
test("tildePath: home as ~, below it ~/…, the rest as is", () => {
  assert.equal(tildePath("/home/u", "/home/u"), "~");
  assert.equal(tildePath("/home/u/code/app", "/home/u/"), "~/code/app");
  assert.equal(tildePath("/home/uu/x", "/home/u"), "/home/uu/x");
  assert.equal(tildePath("/x", null), "/x");
});
test("probePaths: the ticket's remembered folder, its parent's and its project's, as written, no repeats", () => {
  const o = { remembered: { "ABC-2": "/home/u/code/other", "ABC-1": "/home/u/code/app" }, projects: { ABC: "~/code/app/" } };
  assert.deepEqual(probePaths({ key: "ABC-2", project: "ABC", parent: { key: "ABC-1" } }, o), ["/home/u/code/other", "/home/u/code/app", "~/code/app"]);
  assert.deepEqual(probePaths({ key: "ABC-9", project: "ABC", parent: null }, { remembered: {}, projects: { ABC: "/home/u/code/app" } }), ["/home/u/code/app"]);
  assert.deepEqual(probePaths({ key: "XYZ-1", project: "XYZ" }, o), []);
});

const probeOf = (home, there) => ({ home, exists: (p) => there.includes(p) });
test("startPlace: the remembered or mapped folder when it is a folder here, with the space working in it; else null", () => {
  const remembered = { "ABC-1": "/home/u/code/tools" };
  const projects = { ABC: "~/code/app" };
  const o = { remembered, projects, spaces, panes, shownSpace: "s3" };
  const all = probeOf(home, ["/home/u/code/tools", "~/code/app"]);
  assert.deepEqual(startPlace({ key: "ABC-1", project: "ABC" }, { ...o, probe: all }),
    { folder: "/home/u/code/tools", source: "remembered", space: spaces[1] });
  assert.deepEqual(startPlace({ key: "ABC-2", project: "ABC" }, { ...o, probe: all }),
    { folder: "/home/u/code/app", source: "mapped", space: spaces[2] }, "the shown space wins");
  // A remembered folder gone from this PC asks, even with the project mapped: never guessed.
  assert.equal(startPlace({ key: "ABC-1", project: "ABC" }, { ...o, probe: probeOf(home, ["~/code/app"]) }), null);
  assert.equal(startPlace({ key: "XYZ-1", project: "XYZ" }, { ...o, probe: all }), null, "an unmapped project asks");
  assert.equal(startPlace({ key: "ABC-2", project: "ABC" }, { ...o, probe: null }), null, "a failed probe asks");
  // Home unknown: an unexpanded ~ never reaches Herdr, whatever the probe said.
  assert.equal(startPlace({ key: "ABC-2", project: "ABC" }, { ...o, probe: { home: null, exists: () => true } }), null);
  // No space works there: no space (openCommand makes one).
  const far = startPlace({ key: "ABC-3", project: "ABC" }, { ...o, projects: { ABC: "/srv/repo" }, probe: probeOf(home, ["/srv/repo"]) });
  assert.deepEqual(far, { folder: "/srv/repo", source: "mapped", space: null });
});
test("pickerChoices: the mapped folder first when it is here, the suggestion preselected, Here", () => {
  const o = { spaces, panes, here: "/home/u/code/tools/" };
  const mapped = pickerChoices({ key: "ABC-2", project: "ABC" }, { ...o, remembered: {}, projects: { ABC: "~/code/zed" }, probe: probeOf(home, ["~/code/zed"]) });
  assert.deepEqual(mapped.rows.map((r) => r.folder), ["/home/u/code/zed", "/home/u/code/app", "/home/u/code", "/home/u/code/app/src", "/home/u/code/tools"]);
  assert.equal(mapped.selected, 0);
  assert.deepEqual(mapped.here, { folder: "/home/u/code/tools", path: "~/code/tools" });
  // The mapped folder missing: no row for it, nothing suggested (Here, as Start was before).
  const gone = pickerChoices({ key: "ABC-2", project: "ABC" }, { ...o, remembered: {}, projects: { ABC: "~/code/zed" }, probe: probeOf(home, []) });
  assert.ok(!gone.rows.some((r) => r.folder === "/home/u/code/zed"));
  assert.equal(gone.selected, gone.rows.length);
  // A sub-task: its parent's remembered folder is preselected; with no space in it, it gets a row after the mapped one.
  const sub = pickerChoices({ key: "ABC-3", project: "ABC", parent: { key: "ABC-1" } },
    { ...o, remembered: { "ABC-1": "/home/u/code/lib" }, projects: { ABC: "~/code/zed" }, probe: probeOf(home, ["/home/u/code/lib", "~/code/zed"]) });
  assert.deepEqual(sub.rows.slice(0, 2).map((r) => r.folder), ["/home/u/code/zed", "/home/u/code/lib"]);
  assert.deepEqual(sub.rows[1], { folder: "/home/u/code/lib", label: "lib", path: "~/code/lib", spaces: [] });
  assert.equal(sub.selected, 1);
  // Its own remembered folder gone: the next suggestion (the parent's) that is here; one a space is in is not repeated.
  const own = pickerChoices({ key: "ABC-3", project: "ABC", parent: { key: "ABC-1" } },
    { ...o, remembered: { "ABC-3": "/home/u/gone", "ABC-1": "/home/u/code/tools" }, projects: {}, probe: probeOf(home, ["/home/u/code/tools"]) });
  assert.equal(own.rows.filter((r) => r.folder === "/home/u/code/tools").length, 1);
  assert.equal(own.rows[own.selected].folder, "/home/u/code/tools");
  // A failed probe: the spaces' folders only (home not known, so not left out), Here selected, as Herdr says it.
  const failed = pickerChoices({ key: "ABC-2", project: "ABC" }, { ...o, remembered: {}, projects: { ABC: "~/code/zed" }, probe: null });
  assert.ok(failed.rows.some((r) => r.folder === "/home/u"));
  assert.ok(!failed.rows.some((r) => r.folder.includes("zed")));
  assert.equal(failed.selected, failed.rows.length);
  assert.deepEqual(failed.here, { folder: "/home/u/code/tools", path: "/home/u/code/tools" });
  // No focused terminal folder: Here has none (the tab opens where Herdr opens it, as before).
  assert.equal(pickerChoices({ key: "ABC-2" }, { spaces: [], panes: [], probe: null, here: null }).here, null);
});
test("pickerKey: arrows move within the list, Enter picks, Escape closes; other keys are not the picker's", () => {
  assert.deepEqual(pickerKey("down", 0, 3), { selected: 1 });
  assert.deepEqual(pickerKey("down", 2, 3), { selected: 2 });
  assert.deepEqual(pickerKey("up", 0, 3), { selected: 0 });
  assert.deepEqual(pickerKey("up", 2, 3), { selected: 1 });
  assert.deepEqual(pickerKey("enter", 1, 3), { pick: 1 });
  assert.deepEqual(pickerKey("escape", 1, 3), { close: true });
  assert.equal(pickerKey("x", 1, 3), null);
});

test("pickerChoices: with nothing suggested, Here is preselected (Start as before), never the first folder", () => {
  // A ticket of a project spanning repos, nothing remembered: one Enter must not land in an unrelated repo.
  const c = pickerChoices({ key: "XYZ-1", project: "XYZ", parent: null }, { spaces, panes, remembered: {}, projects: {}, probe: probeOf(home, []), here: "/home/u/code/tools" });
  assert.ok(c.rows.length > 0);
  assert.equal(c.selected, c.rows.length, "the entry after the rows: Here");
  // With no folder rows at all, Here is still the one (index 0).
  assert.equal(pickerChoices({ key: "XYZ-1" }, { spaces: [], panes: [], probe: null, here: null }).selected, 0);
});
test("pickerChoices: Here on another machine's terminal has no folder here, so it starts as before (in that space)", () => {
  const o = { spaces, panes, remembered: {}, projects: {}, probe: probeOf(home, []), here: "/home/u/code/app" };
  assert.deepEqual(pickerChoices({ key: "XYZ-1" }, { ...o, shownSpace: "s4" }).here, { folder: null, path: "/home/u/code/app (on box)" });
  assert.deepEqual(pickerChoices({ key: "XYZ-1" }, { ...o, shownSpace: "s4", here: null }).here, { folder: null, path: "on box" });
  assert.deepEqual(pickerChoices({ key: "XYZ-1" }, { ...o, shownSpace: "s3" }).here, { folder: "/home/u/code/app", path: "~/code/app" });
});
test("pickerReason: why a plain Start or Finish asks, when it had an answer it couldn't use; else nothing", () => {
  const remembered = { "ABC-1": "/home/u/code/other" };
  const projects = { ABC: "~/code/app" };
  const o = { remembered, projects };
  assert.equal(pickerReason({ key: "ABC-1", project: "ABC" }, { ...o, probe: probeOf(home, ["~/code/app"]) }),
    "~/code/other (ABC-1's remembered folder) isn't on this PC");
  assert.equal(pickerReason({ key: "ABC-2", project: "ABC" }, { ...o, probe: probeOf(home, []) }), "~/code/app (ABC's folder) isn't on this PC");
  assert.equal(pickerReason({ key: "ABC-2", project: "ABC" }, { ...o, probe: null }), "Couldn't check folders");
  // Home unknown: a ~ folder couldn't be checked either.
  assert.equal(pickerReason({ key: "ABC-2", project: "ABC" }, { ...o, probe: probeOf(null, []) }), "Couldn't check folders");
  // No line: Start in… (asked for), a plain unmapped ticket (even with the probe failed), or a folder that is here.
  assert.equal(pickerReason({ key: "ABC-2", project: "ABC" }, { ...o, probe: probeOf(home, []), ask: true }), null);
  assert.equal(pickerReason({ key: "XYZ-1", project: "XYZ" }, { ...o, probe: null }), null);
  assert.equal(pickerReason({ key: "ABC-2", project: "ABC" }, { ...o, probe: probeOf(home, ["~/code/app"]) }), null);
});
