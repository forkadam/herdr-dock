import { build } from "esbuild";
import { readdirSync, readFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Builds every src/mods/dock-* into <distDir>/mods (dist/ by default; build:app passes a temp folder).
export async function buildAll(distDir = join(ROOT, "dist")) {
  const modsSrc = join(ROOT, "src/mods");
  const out = join(distDir, "mods");
  rmSync(distDir, { recursive: true, force: true });
  const names = readdirSync(modsSrc, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("dock-")).map((d) => d.name);
  for (const name of names) {
    const src = join(modsSrc, name), dest = join(out, name);
    const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
    for (const k of ["id", "name", "icon", "regions"]) {
      if (manifest[k] === undefined) throw new Error(`${name}/manifest.json: missing "${k}"`);
    }
    const mod = JSON.parse(readFileSync(join(src, "mod.json"), "utf8"));
    if (mod.place !== "none") throw new Error(`${name}/mod.json: place must be "none"`);
    mkdirSync(dest, { recursive: true });
    await build({
      entryPoints: [join(src, "main.js")], outfile: join(dest, "main.js"),
      bundle: true, format: "esm", external: ["gpui-kit", "gpui-base", "herdr"], logLevel: "warning",
      absWorkingDir: ROOT, // the bundle's path comments are relative to the repo, whatever the cwd
    });
    for (const f of readdirSync(src)) {
      if (f === "mod.json" || f === "manifest.json" || f.endsWith(".svg")) copyFileSync(join(src, f), join(dest, f));
    }
    if (!existsSync(join(dest, manifest.icon))) throw new Error(`${name}: icon ${manifest.icon} not found`);
  }
  return names;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildAll().then((n) => console.log("built:", n.join(", "))).catch((e) => { console.error(e.message); process.exit(1); });
}
