import { test } from "node:test";
import assert from "node:assert/strict";
import { hostnameCommand } from "../src/shared/platform.js";

test("hostnameCommand: uname -n on Linux, hostname elsewhere", () => {
  assert.deepEqual(hostnameCommand("linux"), { command: "uname", args: ["-n"] });
  assert.deepEqual(hostnameCommand("windows"), { command: "hostname", args: [] });
  assert.deepEqual(hostnameCommand("macos"), { command: "hostname", args: [] });
  assert.deepEqual(hostnameCommand(undefined), { command: "hostname", args: [] });
});
