// The Render panel's helper: an agent's session log (or a Markdown file) in, the conversation, reply blocks with their
// copies and rendered Mermaid diagrams out, for dock-render. Bundled with beautiful-mermaid and marked (MIT) into
// mods/dock-render/herdr-render.mjs, so nothing needs installing. Run with one JSON argument; prints one JSON line.
//
//   { mode: "claude", transcript, open?, cacheDir, relBase, theme, runsDir? } Claude Code's session transcript
//   { mode: "codex", cwd, codexHome?, now?, open?, cacheDir, relBase, theme } the newest Codex rollout started in cwd
//       -> { exchanges: rows (newest first), open: { [id]: { reply: blocks, buttons } }, diagrams, canHtml }, and for
//          Claude hints: { state: "ok" | "silent" | "unknown", checked, at?, run? } (transcript.js, hintReach; run:
//          the hint hook's record of its last run in the session, from runsDir — sent by the panel)
//          open: exchanges opened by hand, whose blocks to send besides the newest three's; ids not there are ignored
//   { mode: "file", path, cacheDir, relBase, theme }                a Markdown file -> { blocks, buttons, canHtml }
//   { mode: "list", cwd }                                           the Markdown files under cwd
//   { mode: "clear", cacheDir }                                     delete every rendered diagram
//   { mode: "clip", html, text }                                    HTML and its plain text onto the macOS clipboard
// After each read the cache is tidied: diagrams not shown for 14 days go, and past the 300 most recently used.
//
// Each picture (a Mermaid diagram, painted after rendering, or a ```figure) is drawn once:
// <cacheDir>/<its id>-<hash of theme and look version>.svg, shown by the mod as image("<relBase>/<that file>"). One that
// doesn't draw gives { error, source } instead (a figure's error is why, as prismantis words it).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { renderMermaidSVG } from "beautiful-mermaid";
import { flattenSvg } from "../shared/render/flatten.js";
import { toBlocks, replyButtons } from "../shared/render/blocks.js";
import { paginate } from "../shared/render/pages.js";
import { collectFootnotes, footnotesBlock } from "../shared/render/footnotes.js";
import { OPEN_NEWEST } from "../shared/render/view.js";
import { copyHtml } from "./clipboard.js";
import { cacheToPrune, themeKey } from "../shared/render/cache.js";
import { mermaidColors, paintDiagram } from "../shared/render/paint.js";
import { decideFigure, figureSvg } from "../shared/render/figure.js";
import { codexCwd, exchangeRow, hintReach, readClaude, readCodex, replyText } from "../shared/render/transcript.js";
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

// A list of blocks with its pictures rendered.
const drawn = (list, req, themeId) => list.map((b) => (b.kind === "mermaid" || b.kind === "figure" ? { ...b, ...render(b, req, themeId) } : b));

// Text -> blocks, pictures rendered.
function blocks(text, req, themeId) {
  return drawn(toBlocks(text), req, themeId);
}

// An exchange's reply (not yet rendered): runs of text as blocks, with what arrived while Claude worked as markers
// between them.
function replyBlocks(ex) {
  const out = [];
  let run = [];
  // Footnotes over the whole reply, so a note at its end matches a reference before a mid-turn marker.
  const { marks, notes } = collectFootnotes(replyText(ex));
  const flush = () => { if (run.length) out.push(...toBlocks(run.join("\n\n"), { marks })); run = []; };
  for (const p of ex.parts) {
    if (p.type === "text") { run.push(p.text); continue; }
    flush();
    out.push({ kind: "marker", by: p.by, event: p.event, text: p.text, bytes: new TextEncoder().encode(p.text).length });
  }
  flush();
  if (notes.length) out.push(footnotesBlock(notes));
  return out;
}

// One page of a list of blocks: { page, pageCount, list } (the page asked for, kept in range).
function pageOf(list, asked) {
  const pages = paginate(list);
  const page = Math.max(0, Math.min(pages.length - 1, Number.isInteger(asked) ? asked : 0));
  return { page, pageCount: pages.length, list: pages[page] };
}

const TURN_LINES = 12;

function fromLog(read, lines, req, extra) {
  const themeId = themeKey(req.theme);
  const r = read(lines);
  // The newest always come with their blocks (the panel can't know the ids of exchanges that arrived since its last
  // read), plus the ones opened by hand.
  const wanted = new Set([...r.exchanges.slice(0, OPEN_NEWEST).map((e) => e.id), ...(Array.isArray(req.open) ? req.open : [])]);
  const open = {};
  for (const ex of r.exchanges) {
    if (!wanted.has(ex.id)) continue;
    const lines = String(ex.text ?? "").split("\n");
    const turnMore = lines.length > TURN_LINES && !(Array.isArray(req.full) && req.full.includes(ex.id));
    const { page, pageCount, list } = pageOf(replyBlocks(ex), req.pages?.[ex.id]);
    open[ex.id] = {
      turn: blocks(turnMore ? lines.slice(0, TURN_LINES).join("\n") : ex.text, req, themeId), turnMore,
      reply: drawn(list, req, themeId), page, pageCount, buttons: replyButtons(replyText(ex)),
    };
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

// hintReach, plus the hint hook's record of its run for the newest typed prompt (render-hint.js:
// <runsDir>/<session id>/<prompt id>.json, the session id being the transcript's file name), when one reads.
const ID = /^[A-Za-z0-9-]{1,128}$/;
function reach(lines, transcript, runsDir) {
  const r = hintReach(lines);
  const id = basename(String(transcript)).replace(/\.jsonl$/, "");
  if (!runsDir || !ID.test(id) || !ID.test(r.promptId ?? "")) return r;
  try {
    const run = JSON.parse(readFileSync(join(runsDir, id, `${r.promptId}.json`), "utf8"));
    if (run && typeof run === "object" && !Array.isArray(run)) return { ...r, run };
  } catch {}
  return r;
}

// The hook's records not written for RUNS_MAX_AGE_MS (their sessions are over) and temp files an interrupted write
// left (after an hour) deleted, in session folders and, from the earlier one-file-per-session layout, at the top; a
// session folder left empty goes too. Other files are left alone. At most once a PRUNE_EVERY_MS (a marker file's date
// says when), so a refresh doesn't list every record each time.
const RUNS_MAX_AGE_MS = 14 * 86400e3;
const PRUNE_EVERY_MS = 60e3;
const PRUNE_MARK = ".pruned";
const RECORD = /\.json(\.\d+\.tmp)?$/;
function pruneRuns(runsDir) {
  const mark = join(runsDir, PRUNE_MARK);
  const now = Date.now();
  try { if (now - statSync(mark).mtimeMs < PRUNE_EVERY_MS) return; } catch {}
  let entries;
  try { entries = readdirSync(runsDir); } catch { return; }
  try { writeFileSync(mark, ""); } catch {}
  const stale = (path, name) => {
    if (!RECORD.test(name)) return false;
    try {
      if (now - statSync(path).mtimeMs <= (name.endsWith(".tmp") ? 3600e3 : RUNS_MAX_AGE_MS)) return false;
      rmSync(path, { force: true });
      return true;
    } catch { return false; }
  };
  for (const s of entries) {
    if (s === PRUNE_MARK) continue;
    const dir = join(runsDir, s);
    let isDir;
    try { isDir = statSync(dir).isDirectory(); } catch { continue; }
    if (!isDir) { stale(dir, s); continue; }
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    let left = names.length;
    for (const name of names) if (stale(join(dir, name), name)) left--;
    if (left === 0) try { rmdirSync(dir); } catch {}
  }
}

function main(req) {
  const out = run(req);
  // After each read, the cache is tidied (unused for 14 days, past the newest 300): cheap, a folder listing.
  if (req?.cacheDir && ["claude", "codex", "file"].includes(req.mode)) prune(req.cacheDir);
  if (req?.runsDir && req.mode === "claude") pruneRuns(req.runsDir);
  return out;
}

function run(req) {
  switch (req?.mode) {
    case "clear":
      return { ok: true, removed: req.cacheDir ? prune(req.cacheDir, { maxAgeMs: 0 }) : 0 };
    case "claude": {
      const lines = readText(req.transcript, MAX_LOG).split("\n");
      return fromLog(readClaude, lines, req, { source: "claude", file: req.transcript, hints: reach(lines, req.transcript, req.runsDir) });
    }
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
      const { marks, notes } = collectFootnotes(text);
      const all = [...toBlocks(text, { marks }), ...(notes.length ? [footnotesBlock(notes)] : [])];
      const { page, pageCount, list } = pageOf(all, req.page);
      return { ok: true, path: req.path, canHtml: CAN_HTML, blocks: drawn(list, req, themeKey(req.theme)), page, pageCount, buttons: replyButtons(text) };
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
