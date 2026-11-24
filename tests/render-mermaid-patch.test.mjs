// beautiful-mermaid's node ids, patched as it is bundled (src/shared/render/mermaid-patch.js), so an arrow written
// without spaces (A-->B) isn't swallowed into the id.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLASS_SHORTHAND, CLASS_SHORTHAND_BEFORE_ARROW, LINE_REWRITES, NODE_ID, NODE_ID_BEFORE_ARROW, patchMermaidIds } from "../src/shared/render/mermaid-patch.js";

const DIST = fileURLToPath(import.meta.resolve("beautiful-mermaid"));
const count = (s, sub) => s.split(sub).length - 1;

test("patchMermaidIds: the 13 node-id patterns and each line rewrite, applied once; nothing else changes", () => {
  const src = readFileSync(DIST, "utf8");
  const out = patchMermaidIds(src);
  // The line rewrites may hold these texts themselves (a class name read as [\w-]+): count what they add.
  const added = (text) => LINE_REWRITES.reduce((n, { from, to }) => n + count(to, text) - count(from, text), 0);
  assert.equal(count(out, NODE_ID_BEFORE_ARROW) - count(src, NODE_ID_BEFORE_ARROW) - added(NODE_ID_BEFORE_ARROW), 13);
  assert.equal(count(src, NODE_ID) - count(out, NODE_ID) + added(NODE_ID), 13);
  let grow = 13 * (NODE_ID_BEFORE_ARROW.length - NODE_ID.length);
  assert.equal(LINE_REWRITES.length, 23);
  for (const { name, from, to } of LINE_REWRITES) {
    assert.equal(count(src, from), 1, name);
    assert.equal(count(out, to), 1, name);
    grow += to.length - from.length;
  }
  assert.equal(out.length - src.length, grow);
});

test("patchMermaidIds: fails loudly when beautiful-mermaid's node patterns move or change", () => {
  assert.throws(() => patchMermaidIds("var x = 1;"), /NODE_PATTERNS/);
  const twelve = "var NODE_PATTERNS = [" + "/^([\\w-]+)/,".repeat(12) + "];\nvar CLASS_SHORTHAND_REGEX = 1;";
  assert.throws(() => patchMermaidIds(twelve), /12 node-id patterns, expected 13/);
  const noClass = "var NODE_PATTERNS = [" + "/^([\\w-]+)/,".repeat(13) + "];\nvar CLASS_SHORTHAND_REGEX = 1;";
  assert.throws(() => patchMermaidIds(noClass), /class shorthand pattern changed/);
  const noArrow = "var NODE_PATTERNS = [" + "/^([\\w-]+)/,".repeat(13) + "];\n" + LINE_REWRITES[0].from;
  assert.throws(() => patchMermaidIds(noArrow), /beautiful-mermaid's arrow pattern changed$/);
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
    const cases = ["A-->B", "A-->|x|B", "A---B", "A-.->B", "A-- text -->B", "A-. text .->B", "my-node-->other-node", "A-B-->C", "A --> B", "A==>B"];
    const f = join(h, "ids.md");
    writeFileSync(f, cases.map((c) => "```mermaid\nflowchart LR\n  " + c + "\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).segments.length, cases.length);
    JSON.parse(r.stdout).segments.forEach((s, i) => {
      const svg = readFileSync(join(h, s.svg), "utf8");
      assert.equal((svg.match(/<g class="node"/g) ?? []).length, 2, cases[i]);
      assert.equal((svg.match(/class="edge"/g) ?? []).length, 1, cases[i]);
    });
    assert.match(readFileSync(join(h, JSON.parse(r.stdout).segments[6].svg), "utf8"), /data-id="my-node"/);
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

test("the built Render helper draws a :::class node followed by an unspaced arrow as two nodes, the class kept", () => {
  const h = mkdtempSync(join(tmpdir(), "render-cls-"));
  try {
    const cases = [["A:::hot-->B", "A"], ["A-->B:::hot", "B"], ["A:::hot-->B:::cold", "A"], ["A[x]:::hot-.->B", "A"], ["A:::hot---B", "A"], ["A:::hot --> B", "A"]];
    const f = join(h, "cls.md");
    writeFileSync(f, cases.map(([c]) => "```mermaid\nflowchart LR\n  " + c + "\n  classDef hot fill:#ff0000\n  classDef cold fill:#0000ff\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const segs = JSON.parse(r.stdout).segments;
    assert.equal(segs.length, cases.length);
    segs.forEach((s, i) => {
      const svg = readFileSync(join(h, s.svg), "utf8");
      assert.equal((svg.match(/<g class="node"/g) ?? []).length, 2, cases[i][0]);
      assert.equal((svg.match(/class="edge"/g) ?? []).length, 1, cases[i][0]);
      const hot = new RegExp(`<g class="node" data-id="${cases[i][1]}"[^>]*>\\s*<[a-z]+[^>]*fill="#ff0000"`);
      assert.match(svg, hot, `${cases[i][0]}: ${cases[i][1]} keeps hot's red`);
    });
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("the built Render helper keeps a classed node's colour after an unspaced open link", () => {
  const h = mkdtempSync(join(tmpdir(), "render-open-"));
  try {
    const cases = ["A:::hot---B:::cold", "A:::hot-.-B:::cold", "A---B:::cold", "A[x]---B:::cold"];
    const f = join(h, "open.md");
    writeFileSync(f, cases.map((c) => "```mermaid\nflowchart LR\n  " + c + "\n  classDef hot fill:#ff0000\n  classDef cold fill:#0000ff\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const segs = JSON.parse(r.stdout).segments;
    assert.equal(segs.length, cases.length);
    segs.forEach((s, i) => {
      const svg = readFileSync(join(h, s.svg), "utf8");
      assert.match(svg, /<g class="node" data-id="B"[^>]*>\s*<[a-z]+[^>]*fill="#0000ff"/, `${cases[i]}: B keeps cold's blue`);
    });
  } finally { rmSync(h, { recursive: true, force: true }); }
});

const edgeStyle = (svg) => {
  const e = /<polyline class="edge"[^>]*>/.exec(svg)[0];
  return /stroke-dasharray/.test(e) ? "dotted" : Number(/stroke-width="([\d.]+)"/.exec(e)[1]) > 1 ? "thick" : "solid";
};

test("the built Render helper draws long links as two nodes and one hop per layer, every hop in their style", () => {
  const h = mkdtempSync(join(tmpdir(), "render-long-"));
  try {
    // [link, style, hops]: a link of length n is drawn as n hops (Mermaid's length table).
    const cases = [["A---->B", "solid", 3], ["A-----B", "solid", 3], ["A-..->B", "dotted", 2], ["A-...-B", "dotted", 3], ["A====>B", "thick", 3],
      ["A=====B", "thick", 3], ["A<---->B", "solid", 3], ["A---->|x|B", "solid", 3], ["A-- text --->B", "solid", 2], ["A-. text ..->B", "dotted", 2],
      ["A== text ===>B", "thick", 2], ["A-->B", "solid", 1], ["A-.->B", "dotted", 1], ["A==>B", "thick", 1]];
    const f = join(h, "long.md");
    writeFileSync(f, cases.map(([c]) => "```mermaid\nflowchart LR\n  " + c + "\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const segs = JSON.parse(r.stdout).segments;
    assert.equal(segs.length, cases.length);
    segs.forEach((s, i) => {
      const svg = readFileSync(join(h, s.svg), "utf8");
      assert.equal((svg.match(/<g class="node"/g) ?? []).length, 2, cases[i][0]);
      const hops = [...svg.matchAll(/<polyline class="edge"[^>]*>/g)].map((m) => m[0]);
      assert.equal(hops.length, cases[i][2], cases[i][0]);
      for (const hop of hops) assert.equal(edgeStyle(hop), cases[i][1], cases[i][0]);
    });
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("the built Render helper: a bare classed node keeps its class; a hyphen inside a class name stays in it", () => {
  const h = mkdtempSync(join(tmpdir(), "render-pins-"));
  try {
    const f = join(h, "pins.md");
    writeFileSync(f, "```mermaid\nflowchart LR\n  A:::hot\n  classDef hot fill:#ff0000\n```\n\n```mermaid\nflowchart LR\n  A:::my-cls-->B\n```\n");
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const [bare, hyphen] = JSON.parse(r.stdout).segments.map((s) => readFileSync(join(h, s.svg), "utf8"));
    assert.equal((bare.match(/<g class="node"/g) ?? []).length, 1);
    assert.match(bare, /<g class="node" data-id="A"[^>]*>\s*<[a-z]+[^>]*fill="#ff0000"/);
    assert.equal((hyphen.match(/<g class="node"/g) ?? []).length, 2);
    assert.equal((hyphen.match(/class="edge"/g) ?? []).length, 1);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("the built Render helper: a long closing operator in a text arrow takes its style like the short one", () => {
  const h = mkdtempSync(join(tmpdir(), "render-textlong-"));
  try {
    const cases = [["A-- text ..->B", "dotted"], ["A-- text .->B", "dotted"], ["A-- text --->B", "solid"], ["A-- text ===>B", "thick"]];
    const f = join(h, "text.md");
    writeFileSync(f, cases.map(([c]) => "```mermaid\nflowchart LR\n  " + c + "\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const segs = JSON.parse(r.stdout).segments;
    assert.equal(segs.length, cases.length);
    segs.forEach((s, i) => assert.equal(edgeStyle(readFileSync(join(h, s.svg), "utf8")), cases[i][1], cases[i][0]));
  } finally { rmSync(h, { recursive: true, force: true }); }
});

// ---- beautiful-mermaid's limits: each source drawn by the built helper, its SVG back ----
const drawAll = (sources) => {
  const h = mkdtempSync(join(tmpdir(), "render-limits-"));
  try {
    const f = join(h, "all.md");
    writeFileSync(f, sources.map((s) => "```mermaid\n" + s + "\n```").join("\n\n"));
    const r = spawnSync(process.execPath, [BUILT, JSON.stringify({ mode: "file", path: f, cacheDir: join(h, "c"), relBase: "c", theme: THEME })], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const segs = JSON.parse(r.stdout).segments;
    assert.equal(segs.length, sources.length);
    return segs.map((s) => { assert.ok(s.svg, s.error); return readFileSync(join(h, s.svg), "utf8"); });
  } finally { rmSync(h, { recursive: true, force: true }); }
};
const edgeTags = (svg) => [...svg.matchAll(/<polyline class="edge"[^>]*>/g)].map((m) => m[0]);

test("the built Render helper: hyphenated class names apply; dotted text links -. text -.-> and -. text .- parse", () => {
  const [assigned, shorthand, dottedArrow, dottedLine] = drawAll([
    "flowchart LR\n  A-->B\n  classDef my-cls fill:#ff0000\n  class B my-cls",
    "flowchart LR\n  A:::my-cls-->B\n  classDef my-cls fill:#ff0000",
    "flowchart LR\n  A-. text -.->B",
    "flowchart LR\n  A-. text .-B"]);
  assert.match(assigned, /<g class="node" data-id="B"[^>]*>\s*<[a-z]+[^>]*fill="#ff0000"/);
  assert.ok(!/data-id="classDef"/.test(assigned), "no stray classDef node");
  assert.match(shorthand, /<g class="node" data-id="A"[^>]*>\s*<[a-z]+[^>]*fill="#ff0000"/);
  for (const [svg, end] of [[dottedArrow, "true"], [dottedLine, "false"]]) {
    assert.equal((svg.match(/<g class="node"/g) ?? []).length, 2);
    const e = edgeTags(svg);
    assert.equal(e.length, 1);
    assert.match(e[0], /data-style="dotted"/);
    assert.match(e[0], new RegExp(`data-arrow-end="${end}"`));
  }
});

const markerOf = (tag, end) => new RegExp(`marker-${end}="url\\(#([^)]*)\\)"`).exec(tag)?.[1] ?? "-";
const edgeSummary = (svg) => edgeTags(svg).map((e) => [/data-style="([^"]*)"/.exec(e)[1], markerOf(e, "start"), markerOf(e, "end")]);

test("the built Render helper draws circle and cross heads in the link's style; spaced and arrow forms keep their reading", () => {
  const cases = [["A --o B", [["solid", "-", "circlehead"]]], ["A --x B", [["solid", "-", "crosshead"]]],
    ["A o--o B", [["solid", "circlehead-start", "circlehead"]]], ["A x--x B", [["solid", "crosshead-start", "crosshead"]]],
    ["A ==o B", [["thick", "-", "circlehead"]]], ["A -.-o B", [["dotted", "-", "circlehead"]]],
    ["A-->o1", [["solid", "-", "arrowhead"]]], ["A --- other", [["solid", "-", "-"]]],
    ["A --> B --o C", [["solid", "-", "arrowhead"], ["solid", "-", "circlehead"]]]];
  const svgs = drawAll(cases.map(([c]) => "flowchart LR\n  " + c));
  svgs.forEach((svg, i) => assert.deepEqual(edgeSummary(svg), cases[i][1], cases[i][0]));
  assert.match(svgs[6], /data-id="o1"/);
  assert.match(svgs[7], /data-id="other"/);
  assert.match(svgs[0], /<marker id="circlehead"/);
  assert.match(svgs[0], /<marker id="crosshead"/);
});

test("the built Render helper lays out an invisible link (~~~) but draws neither its line nor its label", () => {
  const [spaced, unspaced, labelled] = drawAll(["flowchart LR\n  A ~~~ B", "flowchart LR\n  A~~~B", "flowchart LR\n  A ~~~|x| B"]);
  for (const svg of [spaced, unspaced, labelled]) {
    assert.equal((svg.match(/<g class="node"/g) ?? []).length, 2);
    assert.equal(edgeTags(svg).length, 0);
  }
  assert.ok(!/class="edge-label"/.test(labelled), "no label");
});

test("the built Render helper: .- and -.-> close only a dotted text link, so a label holding .- stays whole", () => {
  const [solid, spaced] = drawAll(["flowchart LR\n  A -- a .-b --> B", "flowchart LR\n  A -- x .- y --> B"]);
  for (const [svg, label] of [[solid, "a .-b"], [spaced, "x .- y"]]) {
    assert.deepEqual([...svg.matchAll(/<g class="node" data-id="([^"]*)"/g)].map((m) => m[1]).sort(), ["A", "B"], label);
    const e = edgeTags(svg);
    assert.equal(e.length, 1, label);
    assert.match(e[0], new RegExp(`data-label="${label}"`));
  }
});

test("the built Render helper: a linkStyle-coloured edge keeps its coloured arrowhead", () => {
  const [svg] = drawAll(["flowchart LR\n  A --> B\n  linkStyle 0 stroke:#ff0000"]);
  assert.match(edgeTags(svg)[0], /marker-end="url\(#arrowhead-23ff0000\)"/);
});

test("the built Render helper: an invisible link really lays its nodes out together (unlinked nodes stack)", () => {
  const rowOf = (svg, id) => Number(new RegExp(`<g class="node" data-id="${id}"[^>]*>\\s*<rect[^>]*\\by="([\\d.]+)"`).exec(svg)[1]);
  const [linked, unlinked] = drawAll(["flowchart LR\n  A ~~~ B", "flowchart LR\n  A\n  B"]);
  assert.equal(rowOf(linked, "B"), rowOf(linked, "A"), "B beside A");
  assert.notEqual(rowOf(unlinked, "B"), rowOf(unlinked, "A"), "without the link B stacks below A");
});

test("the built Render helper: a linkStyle-coloured edge's arrowheads, at either end, are markers defined in its colour", () => {
  const [oneWay, twoWay] = drawAll(["flowchart LR\n  A --> B\n  linkStyle 0 stroke:#ff0000", "flowchart LR\n  A <--> B\n  linkStyle 0 stroke:#ff0000"]);
  // The marker an edge names (read from the edge, not hard-coded), and the fill its definition draws.
  const ref = (svg, end) => new RegExp(`marker-${end}="url\\(#([^)]*)\\)"`).exec(edgeTags(svg)[0])?.[1];
  const markerFill = (svg, id) => new RegExp(`<marker id="${id}"[^>]*>\\s*<[a-z]+[^>]*fill="([^"]*)"`).exec(svg)?.[1];
  assert.equal(markerFill(oneWay, ref(oneWay, "end")), "#ff0000");
  assert.equal(ref(oneWay, "start"), undefined);
  assert.equal(markerFill(twoWay, ref(twoWay, "start")), "#ff0000");
  assert.equal(markerFill(twoWay, ref(twoWay, "end")), "#ff0000");
  assert.notEqual(ref(twoWay, "start"), ref(twoWay, "end"));
});

test("the built Render helper: a two-way arrow's start head points at its node, like the end head (plain and coloured)", () => {
  const [plain, coloured] = drawAll(["flowchart LR\n  A <--> B", "flowchart LR\n  A <--> B\n  linkStyle 0 stroke:#ff0000"]);
  for (const svg of [plain, coloured]) {
    for (const [end, orient] of [["end", "auto"], ["start", "auto-start-reverse"]]) {
      const id = new RegExp(`marker-${end}="url\\(#([^)]*)\\)"`).exec(edgeTags(svg)[0])[1];
      const marker = new RegExp(`<marker id="${id}"([^>]*)>\\s*<polygon points="([^"]*)"`).exec(svg);
      const a = (name) => new RegExp(`\\b${name}="([^"]*)"`).exec(marker[1])[1];
      const pts = marker[2].split(",").map((p) => p.trim().split(/\s+/).map(Number));
      const mid = Number(a("refY"));
      const apex = pts.find(([, y]) => y === mid);
      assert.equal(a("orient"), orient, id);
      assert.ok(pts.every(([x]) => x <= apex[0]), `${id}: the apex leads (it's the point furthest along the marker's axis)`);
      const past = apex[0] - Number(a("refX"));
      assert.ok(past >= 0 && past <= 2, `${id}: the apex sits at the line's end (${past} past refX)`);
    }
  }
});

// ---- Long links drawn at their length (through invisible waypoints) ----
const xOf = (svg, id) => Number(new RegExp(`<g class="node" data-id="${id}"[^>]*>\\s*<rect[^>]*\\bx="([\\d.]+)"`).exec(svg)[1]);
const gap = (svg) => xOf(svg, "B") - xOf(svg, "A");

test("the built Render helper draws a long link one layer longer per extra character, in every link kind", () => {
  const [one, two, three, dotted, thick, textShort, textLong] = drawAll(["A --> B", "A ---> B", "A ----> B", "A -..-> B", "A ===> B", "A -- t --> B", "A -- t ---> B"].map((l) => "flowchart LR\n  " + l));
  const [g1, g2, g3] = [one, two, three].map(gap);
  assert.ok(g2 > g1 && g3 > g2, `${g1} < ${g2} < ${g3}`);
  assert.ok(Math.abs((g3 - g2) - (g2 - g1)) <= 1, "equal steps");
  for (const svg of [dotted, thick]) assert.ok(Math.abs(gap(svg) - g2) <= 1, `${gap(svg)} ~ ${g2}`);
  assert.ok(gap(textLong) > gap(textShort) + 20, `text link ${gap(textShort)} -> ${gap(textLong)}`);
});

test("the built Render helper: short links take today's path, with no waypoints", () => {
  const [svg] = drawAll(["flowchart LR\n  A --> B --> C"]);
  const e = edgeTags(svg);
  assert.equal(e.length, 2);
  assert.ok(e.every((t) => !/data-(from|to)="__bm_link_/.test(t)));
});

test("the built Render helper: a long link's hops carry one end head, one start head, its label once, and no drawn waypoint", () => {
  const [plain, both, labelled] = drawAll(["A ----> B", "A <----> B", "A -- yes ----> B"].map((l) => "flowchart LR\n  " + l));
  const e = edgeTags(plain);
  assert.equal(e.length, 3);
  const ends = e.filter((t) => /marker-end=/.test(t));
  assert.equal(ends.length, 1);
  assert.match(ends[0], /data-to="B"/);
  assert.ok(!/data-id="__bm_link_/.test(plain), "no waypoint drawn");
  const starts = edgeTags(both).filter((t) => /marker-start=/.test(t));
  assert.equal(starts.length, 1);
  assert.match(starts[0], /data-from="A"/);
  assert.equal((labelled.match(/class="edge-label"/g) ?? []).length, 1);
  assert.match(labelled, /class="edge-label"[^>]*data-label="yes"/);
});

test("the built Render helper: linkStyle still names the right link after a long one", () => {
  const [second, first] = drawAll(["flowchart LR\n  A ----> B\n  B --> C\n  linkStyle 1 stroke:#ff0000", "flowchart LR\n  A ----> B\n  B --> C\n  linkStyle 0 stroke:#00ff00"]);
  const strokeOf = (t) => /\sstroke="([^"]*)"/.exec(t)[1];
  const e2 = edgeTags(second);
  assert.equal(strokeOf(e2.find((t) => /data-from="B"/.test(t))), "#ff0000");
  assert.ok(e2.filter((t) => !/data-from="B"/.test(t)).every((t) => strokeOf(t) !== "#ff0000"), "no hop of A→B is red");
  const hops = edgeTags(first).filter((t) => !/data-from="B"/.test(t));
  assert.equal(hops.length, 3);
  assert.ok(hops.every((t) => strokeOf(t) === "#00ff00"), "every hop of A→B is green");
});
