import { test } from "node:test";
import assert from "node:assert/strict";
import { hostnameCommand, listDirCommand, parseDirListing, openUrlCommand } from "../src/shared/platform.js";

test("hostnameCommand: uname -n on Linux, hostname elsewhere", () => {
  assert.deepEqual(hostnameCommand("linux"), { command: "uname", args: ["-n"] });
  assert.deepEqual(hostnameCommand("windows"), { command: "hostname", args: [] });
  assert.deepEqual(hostnameCommand("macos"), { command: "hostname", args: [] });
  assert.deepEqual(hostnameCommand(undefined), { command: "hostname", args: [] });
});

test("listDirCommand: dir /b /ad with backslashes on Windows, ls elsewhere", () => {
  const w = listDirCommand("windows", "C:/Users/a/.config/herdr-app/mods");
  assert.equal(w.command, "cmd");
  const bs = String.fromCharCode(92);
  assert.equal(w.args[4], ["C:", "Users", "a", ".config", "herdr-app", "mods"].join(bs));
  assert.deepEqual(listDirCommand("macos", "/m"), { command: "ls", args: ["-1", "-p", "/m"] });
  assert.equal(listDirCommand("linux", "/m").command, "ls");
});

test("parseDirListing: Windows keeps lines; Unix keeps only folders", () => {
  assert.deepEqual(parseDirListing("windows", "tabs\r\nfiles\r\n\r\n"), ["tabs", "files"]);
  assert.deepEqual(parseDirListing("linux", "tabs/\nREADME.md\nfiles/\n"), ["tabs", "files"]);
  assert.deepEqual(parseDirListing("macos", "tabs/\n"), ["tabs"]);
});

test("openUrlCommand: per platform", () => {
  const u = "https://gitlab.corp/a/b/-/pipelines/1";
  assert.deepEqual(openUrlCommand("windows", u), { command: "rundll32", args: ["url.dll,FileProtocolHandler", u] });
  assert.deepEqual(openUrlCommand("macos", u), { command: "open", args: [u] });
  assert.deepEqual(openUrlCommand("linux", u), { command: "xdg-open", args: [u] });
});
