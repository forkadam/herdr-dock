import { build } from "esbuild";
import { readdirSync, readFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { patchMermaidIds } from "../src/shared/render/mermaid-patch.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// beautiful-mermaid's node ids, made arrow-aware as it is bundled, so `A-->B` is two nodes
// (src/shared/render/mermaid-patch.js). check() after the build fails it when the hook never ran: an upgrade that
// moved the code out of dist/index.js would otherwise ship the bug back unnoticed (deploy doesn't run the tests).
export function mermaidIdsPlugin() {
  let patched = 0;
  return {
    plugin: { name: "beautiful-mermaid-ids", setup(b) {
      b.onLoad({ filter: /beautiful-mermaid[\\/]dist[\\/]index\.js$/ }, (a) => {
        patched++;
        return { contents: patchMermaidIds(readFileSync(a.path, "utf8")), loader: "js" };
      });
    } },
    check() {
      if (!patched) throw new Error("beautiful-mermaid's dist/index.js wasn't bundled: its node-id patch didn't apply");
    },
  };
}

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
      bundle: true, format: "esm", external: ["gpui-kit", "gpui-base", "herdr", "websocket", "buffer", "fs/promises"], logLevel: "warning",
      absWorkingDir: ROOT, // the bundle's path comments are relative to the repo, whatever the cwd
    });
    for (const f of readdirSync(src)) {
      if (f === "mod.json" || f === "manifest.json" || f.endsWith(".svg")) copyFileSync(join(src, f), join(dest, f));
    }
    if (!existsSync(join(dest, manifest.icon))) throw new Error(`${name}: icon ${manifest.icon} not found`);
    if (name === "dock-render") {
      // The Render panel's helper, with beautiful-mermaid (and its elkjs) bundled in: nothing to install.
      const mermaidIds = mermaidIdsPlugin();
      await build({
        entryPoints: [join(ROOT, "src/app/render-helper.js")], outfile: join(dest, "herdr-render.mjs"),
        bundle: true, platform: "node", format: "esm", logLevel: "warning", absWorkingDir: ROOT,
        banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
        plugins: [mermaidIds.plugin],
      });
      mermaidIds.check();
      // The Claude Code hook that tells Claude what the panel draws (deploy adds it to ~/.claude/settings.json).
      await build({
        entryPoints: [join(ROOT, "src/app/render-hint.js")], outfile: join(dest, "herdr-hint.mjs"),
        bundle: true, platform: "node", format: "esm", logLevel: "warning", absWorkingDir: ROOT,
      });
      // ...and the command that puts it there without deploy (the Herdr-way install, the panel's Set up).
      await build({
        entryPoints: [join(ROOT, "src/app/hints-setup.js")], outfile: join(dest, "herdr-hints-setup.mjs"),
        bundle: true, platform: "node", format: "esm", logLevel: "warning", absWorkingDir: ROOT,
      });
    }
    if (name === "dock-browser") {
      // The browse command agents run (node browse.mjs ...): one file, nothing to install.
      await build({
        entryPoints: [join(ROOT, "src/app/browse.js")], outfile: join(dest, "browse.mjs"),
        bundle: true, platform: "node", format: "esm", logLevel: "warning", absWorkingDir: ROOT,
      });
      // The installer an app install runs with node (agent-browser, Chrome, the skill), and the skill it fills in.
      await build({
        entryPoints: [join(ROOT, "src/app/browser-install.js")], outfile: join(dest, "herdr-browser-setup.mjs"),
        bundle: true, platform: "node", format: "esm", logLevel: "warning", absWorkingDir: ROOT,
      });
      copyFileSync(join(ROOT, "src/app/browser-skill.md"), join(dest, "browser-skill.md"));
    }
    if (name === "dock-quotas") {
      // The status-line writer Claude Code runs, and the setup that puts it in ~/.claude/settings.json (one file,
      // run with node from the installed mod: the Quotas panel's Set up button, the app install, deploy).
      copyFileSync(join(ROOT, "scripts/herdr-statusline-cache.mjs"), join(dest, "herdr-statusline-cache.mjs"));
      copyFileSync(join(ROOT, "scripts/herdr-claude-usage.mjs"), join(dest, "herdr-claude-usage.mjs")); // Claude's limits from the CLI
      copyFileSync(join(ROOT, "scripts/herdr-agy-statusline.mjs"), join(dest, "herdr-agy-statusline.mjs")); // Antigravity's status line
      await build({
        entryPoints: [join(ROOT, "src/app/statusline-setup.js")], outfile: join(dest, "herdr-statusline-setup.mjs"),
        bundle: true, platform: "node", format: "esm", logLevel: "warning", absWorkingDir: ROOT,
      });
    }
  }
  return names;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildAll().then((n) => console.log("built:", n.join(", "))).catch((e) => { console.error(e.message); process.exit(1); });
}
