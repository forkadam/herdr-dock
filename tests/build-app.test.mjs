import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../scripts/build-app.mjs";
import { BINDINGS, SECTION } from "../scripts/keys.mjs";
import { appVersionFiles, contentVersion } from "../src/shared/appver.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "app");
// Written by hand (Task 5), never by the build.
const HAND = new Set(["RECIPE.md", "preview.png"]);
// Editor files `herdr-app check` writes into a mod folder it checks (git-ignored under app/), never built.
const CHECK_FILES = /^mods\/[^/]+\/(gpui-kit\.d\.ts|jsconfig\.json)$/;
// VERSION.json copies whose display-only `source` is left out of the comparison.
const SOURCE_FIELD = new Set(["VERSION.json", "mods/dock-core/VERSION.json"]);

// Every file under dir, as forward-slash paths relative to it, sorted.
const walk = (dir, rel = "") => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...walk(join(dir, d.name), r));
    else out.push(r);
  }
  return out.sort();
};
const read = (dir, p) => readFileSync(join(dir, p));
const json = (dir, p) => JSON.parse(read(dir, p).toString("utf8"));
const comparable = (dir, p) => {
  if (!SOURCE_FIELD.has(p)) return read(dir, p);
  const { source, ...rest } = json(dir, p);
  return Buffer.from(JSON.stringify(rest));
};
// The paths that differ between two app trees (missing on one side or different bytes), hand files and
// herdr-app check's editor files left out.
const differences = (a, b) => {
  const keep = (p) => !HAND.has(p) && !CHECK_FILES.test(p);
  const pa = walk(a).filter(keep), pb = walk(b).filter(keep);
  const all = [...new Set([...pa, ...pb])].sort();
  const diff = [];
  for (const p of all) {
    if (!pa.includes(p)) diff.push(`${p} (only in ${b})`);
    else if (!pb.includes(p)) diff.push(`${p} (only in ${a})`);
    else if (!comparable(a, p).equals(comparable(b, p))) diff.push(`${p} (differs)`);
  }
  return diff;
};

let one, two, result;
before(async () => {
  one = mkdtempSync(join(tmpdir(), "dock-build-app-"));
  two = mkdtempSync(join(tmpdir(), "dock-build-app-"));
  result = await buildApp(one);
  await buildApp(two);
});
after(() => { for (const d of [one, two]) if (d) rmSync(d, { recursive: true, force: true }); });

test("buildApp: writes every app/ file of the Global Constraints", () => {
  for (const p of [
    "layouts/herdr-dock.json", "keys.json", "VERSION.json",
    "mods/dock-core/source.json", "mods/dock-core/config.json", "mods/dock-core/VERSION.json",
    "mods/dock-core/update-app.mjs", "mods/dock-quotas/herdr-statusline-cache.mjs",
  ]) assert.ok(existsSync(join(one, p)), `missing ${p}`);
  for (const p of HAND) assert.ok(!existsSync(join(one, p)), `${p} is hand-written, not built`);

  assert.deepEqual(json(one, "keys.json"), { [SECTION]: Object.fromEntries(BINDINGS) });
  assert.equal(Object.keys(json(one, "keys.json")[SECTION]).length, 4);
  assert.deepEqual(json(one, "mods/dock-core/source.json"), { mode: "app" });
  assert.equal(read(one, "mods/dock-core/config.json").toString("utf8"),
    read(ROOT, "config/dock.json").toString("utf8").replace(/\r\n/g, "\n"));
  assert.ok(read(one, "mods/dock-core/VERSION.json").equals(read(one, "VERSION.json")));
  assert.equal(read(one, "mods/dock-quotas/herdr-statusline-cache.mjs").toString("utf8"),
    read(ROOT, "scripts/herdr-statusline-cache.mjs").toString("utf8").replace(/\r\n/g, "\n"));
  const layout = json(one, "layouts/herdr-dock.json");
  assert.ok(layout && typeof layout === "object");

  const v = json(one, "VERSION.json");
  assert.deepEqual(Object.keys(v), ["repo", "branch", "version", "source", "mods"]);
  assert.equal(v.repo, "forkadam/herdr-dock");
  assert.equal(v.branch, "main");
  assert.match(v.version, /^[0-9a-f]{12}$/);
  assert.equal(result.version, v.version);
  assert.equal(result.source, v.source);
});

test("buildApp: each mod is a built dock-* mod; the bundled update-app imports only node builtins", () => {
  for (const name of readdirSync(join(one, "mods"))) {
    assert.match(name, /^dock-/);
    for (const f of ["main.js", "mod.json", "manifest.json"]) assert.ok(existsSync(join(one, "mods", name, f)), `${name}/${f}`);
  }
  const src = read(one, "mods/dock-core/update-app.mjs").toString("utf8");
  const specs = [...src.matchAll(/^import\s.*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) assert.match(s, /^node:/, `non-builtin import ${s}`);
});

test("buildApp: VERSION.json mods matches the mod folders", () => {
  const folders = readdirSync(join(one, "mods")).filter((n) => statSync(join(one, "mods", n)).isDirectory()).sort();
  assert.deepEqual(json(one, "VERSION.json").mods, folders);
  assert.deepEqual(folders, readdirSync(join(ROOT, "src/mods"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("dock-")).map((d) => d.name).sort());
});

test("buildApp: version is contentVersion over appVersionFiles", () => {
  const files = appVersionFiles(walk(one)).map((path) => ({ path, bytes: read(one, path) }));
  assert.equal(json(one, "VERSION.json").version, contentVersion(files));
});

test("buildApp: written text files use LF only", () => {
  for (const p of walk(one)) {
    if (/\.(js|mjs|json|svg|md)$/.test(p)) assert.ok(!read(one, p).includes("\r\n"), `${p} has CRLF`);
  }
});

test("buildApp: two builds give identical bytes", () => {
  assert.deepEqual(walk(one), walk(two));
  const diff = walk(one).filter((p) => !read(one, p).equals(read(two, p)));
  assert.deepEqual(diff, []);
});

test("drift: the committed app/ matches a fresh build (run npm run build:app)", () => {
  assert.ok(existsSync(APP), "no app/ folder: run npm run build:app");
  const diff = differences(one, APP);
  assert.deepEqual(diff, [], `app/ is out of date with the source (run npm run build:app):\n  ${diff.join("\n  ")}`);
});
