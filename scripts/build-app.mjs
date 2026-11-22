// npm run build:app: regenerates the committed app/ folder (a Herdr-style install, laid out like the app home):
//   layouts/herdr-dock.json, keys.json, VERSION.json and mods/dock-*/ (the same bundles deploy installs), plus the
//   app-only files: mods/dock-core/{source.json, config.json, VERSION.json, update-app.mjs} and
//   mods/dock-quotas/herdr-statusline-cache.mjs.
// RECIPE.md and preview.png are written by hand and left alone. Text files are written with LF only, so the same
// source gives the same bytes on every OS (tests/build-app.test.mjs compares a fresh build with app/).
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildAll, ROOT } from "./build.mjs";
import { BINDINGS, SECTION } from "./keys.mjs";
import { mergeForHost, parseConfig } from "../src/shared/config.js";
import { buildLayout } from "../src/shared/layout.js";
import { appVersionFiles, contentVersion } from "../src/shared/appver.js";

export const REPO = "forkadam/herdr-dock";
export const BRANCH = "main";
// What build:app owns in app/ (removed and rewritten); anything else (RECIPE.md, preview.png) is kept.
const OWNED = ["layouts", "mods", "keys.json", "VERSION.json"];
const TEXT = /\.(js|mjs|json|svg|md)$/;

const lf = (p, bytes) => (TEXT.test(p) ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes);
const jsonText = (v) => JSON.stringify(v, null, 2) + "\n";

// Every file under dir as forward-slash paths relative to it.
function walk(dir, rel = "") {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...walk(join(dir, d.name), r));
    else out.push(r);
  }
  return out;
}

// Builds app/ into outDir; returns { version, source }.
export async function buildApp(outDir = join(ROOT, "app")) {
  outDir = resolve(outDir);
  const configText = readFileSync(join(ROOT, "config/dock.json"), "utf8");
  const parsed = parseConfig(configText);
  if (!parsed.ok) throw new Error(`config/dock.json invalid: ${parsed.error}`);

  // The files to write, as { relPath: bytes }.
  const files = new Map();
  const put = (p, bytes) => files.set(p, lf(p, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)));

  // The mods: the same build deploy runs, into a temp dist so dist/ (and a running deploy) is untouched.
  const dist = mkdtempSync(join(tmpdir(), "dock-build-app-"));
  let names;
  try {
    names = await buildAll(dist);
    for (const p of walk(join(dist, "mods"))) put(`mods/${p}`, readFileSync(join(dist, "mods", p)));
    // update-app.mjs: the app-mode updater, one file with everything inlined so it runs without the repo.
    const bundled = await build({
      entryPoints: [join(ROOT, "src/app/update-app.js")], bundle: true, platform: "node", format: "esm",
      write: false, outfile: "update-app.mjs", absWorkingDir: ROOT, logLevel: "warning",
    });
    put("mods/dock-core/update-app.mjs", Buffer.from(bundled.outputFiles[0].contents));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
  names.sort();

  put("mods/dock-core/source.json", jsonText({ mode: "app" }));
  put("mods/dock-core/config.json", configText);
  // The shared default only (no host, no local file); dock-core rebuilds it with this PC's local.json on start.
  put("layouts/herdr-dock.json", jsonText(buildLayout(mergeForHost(parsed.config, ""), {})));
  put("keys.json", jsonText({ [SECTION]: Object.fromEntries(BINDINGS) }));

  const version = contentVersion(appVersionFiles([...files.keys()]).map((path) => ({ path, bytes: files.get(path) })));
  const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const source = rev.status === 0 ? rev.stdout.trim() || null : null;
  const versionText = jsonText({ repo: REPO, branch: BRANCH, version, source, mods: names });
  put("VERSION.json", versionText);
  put("mods/dock-core/VERSION.json", versionText);

  for (const p of OWNED) rmSync(join(outDir, p), { recursive: true, force: true });
  for (const [p, bytes] of files) {
    const dest = join(outDir, ...p.split("/"));
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, bytes);
  }
  return { version, source };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  buildApp()
    .then(({ version, source }) => console.log(`built app/: version ${version} (source ${source ?? "unknown"})`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
