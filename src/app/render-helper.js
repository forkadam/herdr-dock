// The Render panel's helper: an agent's session log (or a Markdown file) in, the conversation, reply blocks with their
// copies and rendered Mermaid diagrams out, for dock-render. Bundled with beautiful-mermaid and marked (MIT) into
// mods/dock-render/herdr-render.mjs, so nothing needs installing. Run with one JSON argument; prints one JSON line.
//
//   { mode: "claude", transcript, open?, cacheDir, relBase, theme }   Claude Code's session transcript
//   { mode: "codex", cwd, codexHome?, now?, open?, cacheDir, relBase, theme } the newest Codex rollout started in cwd
//       -> { exchanges: rows (newest first), open: { [id]: { reply: blocks, buttons } }, diagrams, canHtml }
//          open: the exchanges whose blocks to send (default: the newest three); ids not there are ignored
//   { mode: "file", path, cacheDir, relBase, theme }                a Markdown file -> { blocks, buttons, canHtml }
//   { mode: "list", cwd }                                           the Markdown files under cwd
//   { mode: "clear", cacheDir }                                     delete every rendered diagram
//   { mode: "clip", html, text }                                    HTML and its plain text onto the macOS clipboard
// After each read the cache is tidied: diagrams not shown for 14 days go, and past the 300 most recently used.
//
// Each picture (a Mermaid diagram, painted after rendering, or a ```figure) is drawn once:
// <cacheDir>/<its id>-<hash of theme and look version>.svg, shown by the mod as image("<relBase>/<that file>"). One that
// doesn't draw gives { error, source } instead (a figure's error is why, as prismantis words it).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { renderMermaidSVG } from "beautiful-mermaid";
import { flattenSvg } from "../shared/render/flatten.js";
import { toBlocks, replyButtons } from "../shared/render/blocks.js";
import { OPEN_NEWEST } from "../shared/render/view.js";
import { copyHtml } from "./clipboard.js";
import { cacheToPrune, themeKey } from "../shared/render/cache.js";
import { mermaidColors, paintDiagram } from "../shared/render/paint.js";
import { decideFigure, figureSvg } from "../shared/render/figure.js";
import { codexCwd, exchangeRow, readClaude, readCodex, replyText } from "../shared/render/transcript.js";
import { slashPath } from "../shared/path.js";

const MAX_LOG = 64 * 1024 * 1024; // a session log bigger than this is read from its last 64 MB
const MAX_FILE = 2 * 1024 * 1024;
const MAX_SOURCE = 32 * 1024;
const MAX_DIAGRAMS = 40;

function readText(path, max) {
  const size = statSync(path).size;
  if (size <= max) return readFileSync(path, "utf8");
  const buf = readFileSync(path);
  return buf.subarray(buf.length - max).toString("utf8");
}

// One picture's SVG: a Mermaid diagram rendered, flattened and painted; a figure checked and drawn.
function draw(seg, theme) {
  if (seg.kind === "figure") {
    const d = decideFigure(seg.source);
    if (d.note) throw new Error(d.note);
    return figureSvg(d.lines, theme).svg;
  }
  return paintDiagram(flattenSvg(renderMermaidSVG(seg.source, mermaidColors(theme)), theme.background), seg.source, theme);
}

// One picture ({ kind, source, id }) -> { svg: "<relBase>/<file>", w, h } or { error }.
function render(seg, req, themeId) {
  const { source } = seg;
  try {
    if (source.length > MAX_SOURCE) throw new Error(`${seg.kind === "figure" ? "figure" : "diagram"} too large (${Math.round(source.length / 1024)} KiB)`);
    const name = `${seg.id}-${themeId}.svg`;
    const file = join(req.cacheDir, name);
    if (existsSync(file)) {
      // Shown again: its date says "last used", so the cleanup keeps it.
      try { const now = new Date(); utimesSync(file, now, now); } catch {}
    } else {
      const svg = draw(seg, req.theme);
      mkdirSync(req.cacheDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, svg);
      renameSync(tmp, file);
    }
    // Its own size (the root's width/height), so the panel can scale it to its width.
    const head = readFileSync(file, "utf8").slice(0, 600);
    const w = Number(/\bwidth="([\d.]+)"/.exec(head)?.[1]), h = Number(/\bheight="([\d.]+)"/.exec(head)?.[1]);
    return { svg: `${req.relBase}/${name}`, ...(w > 0 && h > 0 ? { w, h } : {}) };
  } catch (e) {
    return { error: String(e?.message ?? e).split("\n")[0].slice(0, 300) };
  }
}

// Formatted copies work through macOS's pasteboard only; elsewhere the panel hides the html buttons.
const CAN_HTML = process.platform === "darwin";

// Text -> blocks, pictures rendered.
function blocks(text, req, themeId) {
  return toBlocks(text).map((b) => (b.kind === "mermaid" || b.kind === "figure" ? { ...b, ...render(b, req, themeId) } : b));
}

// An exchange's reply: runs of text as blocks, with what arrived while Claude worked as markers between them.
function replyBlocks(ex, req, themeId) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length) out.push(...blocks(run.join("\n\n"), req, themeId)); run = []; };
  for (const p of ex.parts) {
    if (p.type === "text") { run.push(p.text); continue; }
    flush();
    out.push({ kind: "marker", by: p.by, event: p.event, text: p.text });
  }
  flush();
  return out;
}

function fromLog(read, lines, req, extra) {
  const themeId = themeKey(req.theme);
  const r = read(lines);
  const wanted = new Set(Array.isArray(req.open) ? req.open : r.exchanges.slice(0, OPEN_NEWEST).map((e) => e.id));
  const open = {};
  for (const ex of r.exchanges) {
    if (wanted.has(ex.id)) open[ex.id] = { reply: replyBlocks(ex, req, themeId), buttons: replyButtons(replyText(ex)) };
  }
  return {
    ok: true, ...extra, canHtml: CAN_HTML,
    exchanges: r.exchanges.map(exchangeRow), open,
    diagrams: r.diagrams.slice(0, MAX_DIAGRAMS).map((d) => ({ ...d, ...render(d, req, themeId) })),
  };
}

// Codex's rollouts of the last two weeks, newest file first.
function codexRollouts(codexHome, now) {
  const out = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now - i * 86400e3);
    const dir = join(codexHome, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) if (/^rollout-.*\.jsonl$/.test(n)) out.push(join(dir, n));
  }
  return out.map((p) => ({ p, m: statSync(p).mtimeMs })).sort((a, b) => b.m - a.m).map((x) => x.p);
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", "target", ".venv", "vendor"]);
function listMarkdown(cwd, depth = 3, out = [], dir = cwd) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) { if (depth > 0 && !SKIP.has(e.name) && !e.name.startsWith(".")) listMarkdown(cwd, depth - 1, out, join(dir, e.name)); }
    else if (/\.(md|markdown)$/i.test(e.name)) {
      const path = join(dir, e.name);
      out.push({ path: slashPath(path), name: e.name, rel: slashPath(relative(cwd, path)), mtimeMs: statSync(path).mtimeMs });
    }
  }
  return out;
}

// The cache's diagrams to delete (cache.js), deleted; how many went.
function prune(cacheDir, options) {
  let names;
  try { names = readdirSync(cacheDir); } catch { return 0; }
  const files = names.map((name) => { try { return { name, mtimeMs: statSync(join(cacheDir, name)).mtimeMs }; } catch { return null; } }).filter(Boolean);
  let n = 0;
  for (const name of cacheToPrune(files, Date.now(), options)) {
    try { rmSync(join(cacheDir, name), { force: true }); n++; } catch {}
  }
  return n;
}

function main(req) {
  const out = run(req);
  // After each read, the cache is tidied (unused for 14 days, past the newest 300): cheap, a folder listing.
  if (req?.cacheDir && ["claude", "codex", "file"].includes(req.mode)) prune(req.cacheDir);
  return out;
}

function run(req) {
  switch (req?.mode) {
    case "clear":
      return { ok: true, removed: req.cacheDir ? prune(req.cacheDir, { maxAgeMs: 0 }) : 0 };
    case "claude":
      return fromLog(readClaude, readText(req.transcript, MAX_LOG).split("\n"), req, { source: "claude", file: req.transcript });
    case "codex": {
      const home = req.codexHome || join(homedir(), ".codex");
      for (const file of codexRollouts(home, req.now ?? Date.now())) {
        const lines = readText(file, MAX_LOG).split("\n");
        if (codexCwd(lines) === req.cwd) return fromLog(readCodex, lines, req, { source: "codex", file });
      }
      return { ok: false, error: "no Codex session started in this folder in the last two weeks" };
    }
    case "file": {
      const text = readText(req.path, MAX_FILE);
      return { ok: true, path: req.path, canHtml: CAN_HTML, blocks: blocks(text, req, themeKey(req.theme)), buttons: replyButtons(text) };
    }
    case "clip":
      if (typeof req.html !== "string" || typeof req.text !== "string") return { ok: false, error: "clip needs html and text" };
      return copyHtml(req);
    case "list":
      return { ok: true, files: listMarkdown(req.cwd).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 80) };
    default:
      return { ok: false, error: `unknown mode ${JSON.stringify(req?.mode)}` };
  }
}

let out;
try { out = main(JSON.parse(process.argv[2] ?? "")); } catch (e) { out = { ok: false, error: String(e?.message ?? e) }; }
process.stdout.write(JSON.stringify(out) + "\n");
