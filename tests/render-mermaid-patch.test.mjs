// beautiful-mermaid's node ids, patched as it is bundled (src/shared/render/mermaid-patch.js), so an arrow written
// without spaces (A-->B) isn't swallowed into the id.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NODE_ID, NODE_ID_BEFORE_ARROW, patchMermaidIds } from "../src/shared/render/mermaid-patch.js";

const DIST = fileURLToPath(import.meta.resolve("beautiful-mermaid"));
const count = (s, sub) => s.split(sub).length - 1;

test("patchMermaidIds: the 13 node-id patterns get the arrow-aware id; nothing else changes", () => {
  const src = readFileSync(DIST, "utf8");
  const out = patchMermaidIds(src);
  assert.equal(count(out, NODE_ID_BEFORE_ARROW) - count(src, NODE_ID_BEFORE_ARROW), 13);
  assert.equal(count(src, NODE_ID) - count(out, NODE_ID), 13);
  assert.equal(out.length - src.length, 13 * (NODE_ID_BEFORE_ARROW.length - NODE_ID.length));
});

test("patchMermaidIds: fails loudly when beautiful-mermaid's node patterns move or change", () => {
  assert.throws(() => patchMermaidIds("var x = 1;"), /NODE_PATTERNS/);
  const twelve = "var NODE_PATTERNS = [" + "/^([\\w-]+)/,".repeat(12) + "];\nvar CLASS_SHORTHAND_REGEX = 1;";
  assert.throws(() => patchMermaidIds(twelve), /12 node-id patterns, expected 13/);
});

// ---- The built Render helper (app/, kept equal to a fresh build by tests/build-app.test.mjs) ----
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUILT = join(import.meta.dirname, "..", "app", "mods", "dock-render", "herdr-render.mjs");
const THEME = { background: "#1e1f22", foreground: "#d4d4d8", muted: "#8b8d94", border: "#3f4147", accent: "#7aa2f7", dark: true };

test("the built Render helper draws an arrow without spaces as two nodes and an edge", () => {
  const h = mkdtempSync(join(tmpdir(), "render-ids-"));
  try {
    const cases = ["A-->B", "A-->|x|B", "A---B", "A-.->B", "A-- text -->B", "my-node-->other-node", "A-B-->C", "A --> B", "A==>B"];
    const f = join(h, "ids.md");
    writeFileSync(f, cases.map((c) => "```mermaid\nflowchart LR\n  " + c + "\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    JSON.parse(r.stdout).segments.forEach((s, i) => {
      const svg = readFileSync(join(h, s.svg), "utf8");
      assert.equal((svg.match(/<g class="node"/g) ?? []).length, 2, cases[i]);
      assert.equal((svg.match(/class="edge"/g) ?? []).length, 1, cases[i]);
    });
    assert.match(readFileSync(join(h, JSON.parse(r.stdout).segments[5].svg), "utf8"), /data-id="my-node"/);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

// ---- The build hook fails the build when it never patched anything (deploy ships without running tests) ----
import { build } from "esbuild";
import { mermaidIdsPlugin } from "../scripts/build.mjs";

test("the build's beautiful-mermaid hook: a build it never applied to fails its check; one it did passes", async () => {
  const h = mkdtempSync(join(tmpdir(), "render-ids-build-"));
  const opts = { bundle: true, platform: "node", format: "esm", logLevel: "silent", nodePaths: [join(import.meta.dirname, "..", "node_modules")] };
  try {
    writeFileSync(join(h, "none.js"), "export const x = 1;\n");
    const missed = mermaidIdsPlugin();
    await build({ ...opts, entryPoints: [join(h, "none.js")], outfile: join(h, "none.out.mjs"), plugins: [missed.plugin] });
    assert.throws(() => missed.check(), /node-id patch didn't apply/);

    writeFileSync(join(h, "bm.js"), 'export { renderMermaidSVG } from "beautiful-mermaid";\n');
    const hit = mermaidIdsPlugin();
    await build({ ...opts, entryPoints: [join(h, "bm.js")], outfile: join(h, "bm.out.mjs"), plugins: [hit.plugin] });
    hit.check();
    assert.ok(readFileSync(join(h, "bm.out.mjs"), "utf8").includes(NODE_ID_BEFORE_ARROW));
  } finally { rmSync(h, { recursive: true, force: true }); }
});
