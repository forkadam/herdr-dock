import { test } from "node:test";
import assert from "node:assert/strict";
import { ghVersionArgs, installOf, modeOf, parseVersionJson, publishedUrl } from "../src/shared/install.js";

const HOME = "C:/Users/me/.config/herdr-app";

test("modeOf: repo is clone, mode app is app, junk is null", () => {
  assert.equal(modeOf({ repo: "D:/w/herdr-dock" }), "clone");
  assert.equal(modeOf({ config: "D:/w/herdr-dock/config/dock.json", hostname: "pc", repo: "D:/w/herdr-dock", commit: "abc" }), "clone");
  // Older deploys wrote only config: still a clone install.
  assert.equal(modeOf({ config: "D:/w/herdr-dock/config/dock.json" }), "clone");
  assert.equal(modeOf({ mode: "app" }), "app");
  // Deploy overwrites source.json with the clone form: a repo wins over a stray mode.
  assert.equal(modeOf({ mode: "app", repo: "D:/w/herdr-dock" }), "clone");
  for (const junk of [null, undefined, "app", 3, [], {}, { mode: "clone" }, { mode: "APP" }, { repo: 1 }, { repo: "" }]) {
    assert.equal(modeOf(junk), null, JSON.stringify(junk));
  }
});

test("installOf: app mode reads the shipped config, has no repo", () => {
  assert.deepEqual(installOf({ mode: "app" }, HOME), {
    mode: "app", configPath: `${HOME}/mods/dock-core/config.json`, repo: null, versionPath: `${HOME}/mods/dock-core/VERSION.json`,
  });
});

test("installOf: clone mode reads the repo config, repo from source.json or the config's parent", () => {
  assert.deepEqual(installOf({ config: "D:\\w\\herdr-dock\\config\\dock.json", repo: "D:\\w\\herdr-dock" }, HOME), {
    mode: "clone", configPath: "D:/w/herdr-dock/config/dock.json", repo: "D:/w/herdr-dock", versionPath: null,
  });
  assert.equal(installOf({ config: "D:/w/herdr-dock/config/dock.json" }, HOME).repo, "D:/w/herdr-dock");
});

test("installOf: no usable source.json is null", () => {
  assert.equal(installOf(null, HOME), null);
  assert.equal(installOf({ repo: "D:/w/herdr-dock" }, HOME), null); // clone without a config path
  assert.equal(installOf({ mode: "nope" }, HOME), null);
});

test("publishedUrl and ghVersionArgs name app/VERSION.json on the branch", () => {
  const v = { repo: "forkadam/herdr-dock", branch: "main" };
  assert.equal(publishedUrl(v), "https://raw.githubusercontent.com/forkadam/herdr-dock/main/app/VERSION.json");
  assert.deepEqual(ghVersionArgs(v),
    ["api", "repos/forkadam/herdr-dock/contents/app/VERSION.json?ref=main", "-H", "Accept: application/vnd.github.raw"]);
});

test("parseVersionJson: needs repo, branch and version", () => {
  const text = JSON.stringify({ repo: "forkadam/herdr-dock", branch: "main", version: "d4abcbaa43d1", source: "0c27c79", mods: ["dock-core"] });
  assert.deepEqual(parseVersionJson(text),
    { repo: "forkadam/herdr-dock", branch: "main", version: "d4abcbaa43d1", source: "0c27c79", mods: ["dock-core"] });
  assert.equal(parseVersionJson(JSON.stringify({ repo: "a/b", branch: "main", version: "x" })).source, null);
  for (const bad of [null, "", "nope", "[]", JSON.stringify({ repo: "a/b", branch: "main" }), JSON.stringify({ version: "x" })]) {
    assert.equal(parseVersionJson(bad), null, String(bad));
  }
});

import { fixHint } from "../src/shared/install.js";
test("fixHint: wording by install mode (app never says npm run deploy)", () => {
  assert.equal(fixHint("clone"), "run npm run deploy");
  assert.equal(fixHint("app"), "reinstall herdr-dock from its app/ folder");
  assert.match(fixHint(null), /npm run deploy/);
  assert.match(fixHint(null), /app\/ folder/);
  assert.doesNotMatch(fixHint("app"), /npm/);
});
