// The Render panel's helper (src/app/render-helper.js; bundled with beautiful-mermaid into
// mods/dock-render/herdr-render.mjs): transcripts and files in, Markdown segments and rendered SVGs out.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HELPER = join(import.meta.dirname, "..", "src", "app", "render-helper.js");
const FIX = join(import.meta.dirname, "fixtures", "render");
const THEME = { background: "#1e1f22", foreground: "#d4d4d8", muted: "#8b8d94", border: "#3f4147", accent: "#7aa2f7", dark: true };
const run = (req) => {
  const r = spawnSync(process.execPath, [HELPER, JSON.stringify(req)], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const home = () => {
  const h = mkdtempSync(join(tmpdir(), "render-"));
  const cacheDir = join(h, "herdr-dock", "render");
  return { h, cacheDir, base: { cacheDir, relBase: "herdr-dock/render", theme: THEME }, done: () => rmSync(h, { recursive: true, force: true }) };
};

test("claude: the latest answer as segments with its diagrams drawn, and the session's diagrams", () => {
  const x = home();
  try {
    const out = run({ ...x.base, mode: "claude", transcript: join(FIX, "claude.jsonl") });
    assert.equal(out.ok, true);
    assert.equal(out.prompt, "Now the sequence, and check the code");
    assert.deepEqual(out.answer.segments.map((s) => s.kind), ["md", "mermaid", "md"]);
    const d = out.answer.segments[1];
    assert.match(d.svg, /^herdr-dock\/render\/[0-9a-f]{8}-[0-9a-f]{8}\.svg$/);
    assert.ok(d.w > 0 && d.h > 0, "the diagram's own size, to scale it to the panel");
    const svg = readFileSync(join(x.h, d.svg), "utf8");
    assert.match(svg, /^<svg/);
    assert.ok(!/var\(|color-mix|@import/.test(svg));
    assert.equal(out.diagrams.length, 2);
    assert.ok(out.diagrams.every((g) => g.svg && g.source && Number.isFinite(g.at)));
    // Rendered once: a second run finds them in the cache.
    const files = readdirSync(x.cacheDir).length;
    run({ ...x.base, mode: "claude", transcript: join(FIX, "claude.jsonl") });
    assert.equal(readdirSync(x.cacheDir).length, files);
  } finally { x.done(); }
});

test("a diagram that doesn't parse gives its error, and the rest still renders", () => {
  const x = home();
  try {
    const f = join(x.h, "bad.md");
    writeFileSync(f, "# Doc\n\n```mermaid\nthis is not mermaid at all ((\n```\n\n```mermaid\npie\n  \"a\": 1\n```\n");
    const out = run({ ...x.base, mode: "file", path: f });
    assert.equal(out.ok, true);
    const ds = out.segments.filter((s) => s.kind === "mermaid");
    assert.equal(ds.length, 2);
    assert.ok(ds[0].error && !ds[0].svg);
    assert.equal(ds[0].source, "this is not mermaid at all ((");
  } finally { x.done(); }
});

test("codex: the newest rollout started in this folder", () => {
  const x = home();
  try {
    const day = join(x.h, "codex", "sessions", "2026", "11", "22");
    mkdirSync(day, { recursive: true });
    const mine = join(day, "rollout-2026-11-22T11-00-00-abc.jsonl");
    writeFileSync(mine, readFileSync(join(FIX, "codex.jsonl")));
    const other = join(day, "rollout-2026-11-22T12-00-00-def.jsonl");
    writeFileSync(other, readFileSync(join(FIX, "codex.jsonl"), "utf8").replace("/home/u/proj", "/elsewhere"));
    utimesSync(other, new Date(), new Date(Date.now() + 1000)); // newer, but another folder
    const out = run({ ...x.base, mode: "codex", cwd: "/home/u/proj", codexHome: join(x.h, "codex"), now: Date.parse("2026-11-22T12:00:00Z") });
    assert.equal(out.ok, true);
    assert.equal(out.file, mine);
    assert.equal(out.prompt, "diagram please");
    assert.equal(out.diagrams.length, 1);
    const none = run({ ...x.base, mode: "codex", cwd: "/nowhere", codexHome: join(x.h, "codex"), now: Date.parse("2026-11-22T12:00:00Z") });
    assert.equal(none.ok, false);
  } finally { x.done(); }
});

test("list: Markdown files under a folder, newest first, skipping node_modules and .git", () => {
  const x = home();
  try {
    const p = join(x.h, "proj");
    for (const d of ["docs/specs", "node_modules/pkg", ".git"]) mkdirSync(join(p, d), { recursive: true });
    writeFileSync(join(p, "README.md"), "# r");
    writeFileSync(join(p, "docs/specs/plan.md"), "# p");
    writeFileSync(join(p, "node_modules/pkg/README.md"), "# no");
    writeFileSync(join(p, ".git/notes.md"), "# no");
    writeFileSync(join(p, "notes.txt"), "no");
    utimesSync(join(p, "docs/specs/plan.md"), new Date(), new Date(Date.now() + 5000));
    const out = run({ mode: "list", cwd: p });
    assert.deepEqual(out.files.map((f) => f.rel), ["docs/specs/plan.md", "README.md"]);
  } finally { x.done(); }
});

test("bad requests and missing files answer ok:false, never crash", () => {
  assert.equal(run({ mode: "claude", transcript: "/nonexistent.jsonl", cacheDir: "/tmp/x", relBase: "x", theme: THEME }).ok, false);
  assert.equal(run({ mode: "file", path: "/nonexistent.md", cacheDir: "/tmp/x", relBase: "x", theme: THEME }).ok, false);
  assert.equal(run({ mode: "nope" }).ok, false);
  const r = spawnSync(process.execPath, [HELPER, "not json"], { encoding: "utf8" });
  assert.equal(JSON.parse(r.stdout).ok, false);
});
