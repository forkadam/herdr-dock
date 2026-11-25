// The Render panel's helper (src/app/render-helper.js; bundled with beautiful-mermaid into
// mods/dock-render/herdr-render.mjs): transcripts and files in, Markdown segments and rendered SVGs out.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HELPER = join(import.meta.dirname, "..", "src", "app", "render-helper.js");
const FIX = join(import.meta.dirname, "fixtures", "render");
const THEME = { background: "#1e1f22", foreground: "#d4d4d8", muted: "#8b8d94", border: "#3f4147", accent: "#7aa2f7", dark: true };
const run = (req, env = {}) => {
  const r = spawnSync(process.execPath, [HELPER, JSON.stringify(req)], { encoding: "utf8", timeout: 60000, env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const home = () => {
  const h = mkdtempSync(join(tmpdir(), "render-"));
  const cacheDir = join(h, "herdr-dock", "render");
  return { h, cacheDir, base: { cacheDir, relBase: "herdr-dock/render", theme: THEME }, done: () => rmSync(h, { recursive: true, force: true }) };
};

test("claude: the newest exchange's reply as blocks with its diagrams drawn, and the session's diagrams", () => {
  const x = home();
  try {
    const out = run({ ...x.base, mode: "claude", transcript: join(FIX, "claude.jsonl") });
    assert.equal(out.ok, true);
    assert.equal(out.exchanges[0].text, "Now the sequence, and check the code");
    const reply = out.open[out.exchanges[0].id].reply;
    assert.deepEqual(reply.map((s) => s.kind), ["text", "mermaid", "code"]);
    const d = reply[1];
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
    const ds = out.blocks.filter((s) => s.kind === "mermaid");
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
    assert.equal(out.exchanges[0].text, "diagram please");
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

test("cache: a reused diagram's date is refreshed, old ones are pruned after a read, clear empties it", () => {
  const x = home();
  try {
    const f = join(x.h, "doc.md");
    writeFileSync(f, "```mermaid\nflowchart LR\n A-->B\n```\n");
    const first = run({ ...x.base, mode: "file", path: f }).blocks[0].svg;
    const file = join(x.h, first);
    const old = new Date(Date.now() - 20 * 86400e3);
    utimesSync(file, old, old); // looks unused for 20 days...
    run({ ...x.base, mode: "file", path: f }); // ...but it's shown again: kept, date refreshed
    assert.ok(existsSync(file));
    assert.ok(Date.now() - statSync(file).mtimeMs < 60e3);
    // An unrelated diagram unused for 20 days goes on the next read; a non-diagram file stays.
    const stale = join(x.cacheDir, "0123abcd-3f077949.svg");
    writeFileSync(stale, "<svg/>");
    utimesSync(stale, old, old);
    writeFileSync(join(x.cacheDir, "keep.txt"), "mine");
    run({ ...x.base, mode: "file", path: f });
    assert.equal(existsSync(stale), false);
    assert.ok(existsSync(join(x.cacheDir, "keep.txt")));
    // clear: every diagram goes.
    const c = run({ ...x.base, mode: "clear" });
    assert.equal(c.ok, true);
    assert.equal(c.removed, 1);
    assert.deepEqual(readdirSync(x.cacheDir), ["keep.txt"]);
  } finally { x.done(); }
});

// ---- Figures and painted diagrams ----
import { themeKey } from "../src/shared/render/cache.js";

test("figures and painted diagrams: kinds, files named with the look version, a failed figure's reason", () => {
  const x = home();
  try {
    const f = join(x.h, "look.md");
    writeFileSync(f, "```figure\nA {ok:██} B\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```figure\nbad\tline\n```\n\n```mermaid\nA {ok:██} B\n```\n");
    const out = run({ ...x.base, mode: "file", path: f });
    const s = out.blocks;
    assert.deepEqual(s.map((g) => g.kind), ["figure", "mermaid", "figure", "mermaid"]);
    assert.ok(s[0].svg.endsWith(`-${themeKey(THEME)}.svg`) && s[0].w > 0 && s[0].h > 0);
    assert.match(readFileSync(join(x.h, s[0].svg), "utf8"), /^<svg/);
    // Inside node A's own group (arrowheads are accent already, so a match anywhere would prove nothing).
    const groupA = /<g class="node" data-id="A"[^>]*>([\s\S]*?)<\/g>/.exec(readFileSync(join(x.h, s[1].svg), "utf8"))[1];
    assert.match(groupA, new RegExp(`stroke="${THEME.accent}"`));
    assert.equal(s[2].error, "figure line 1: tab, use spaces");
    assert.ok(!s[2].svg);
    assert.notEqual(s[0].id, s[3].id);
  } finally { x.done(); }
});

test("claude: rows for every exchange, blocks for the newest three, canHtml", () => {
  const x = home();
  try {
    const out = run({ ...x.base, mode: "claude", transcript: join(FIX, "claude-conversation.jsonl") });
    assert.equal(out.ok, true);
    assert.equal(out.canHtml, process.platform === "darwin");
    assert.deepEqual(out.exchanges.map((r) => r.id), ["u7", "u6", "u5", "u4", "u3", "u2", "u1"]);
    assert.deepEqual(Object.keys(out.open).sort(), ["u5", "u6", "u7"]);
    assert.deepEqual(out.open.u6.reply.map((b) => b.kind), ["text", "marker", "marker", "text"]);
    assert.deepEqual(out.open.u6.buttons.map((b) => b.label), ["copy md", "copy html"]);
  } finally { x.done(); }
});

test("claude: the newest three always come with blocks, plus the ids opened by hand; ids that aren't there are ignored", () => {
  const x = home();
  try {
    const out = run({ ...x.base, mode: "claude", transcript: join(FIX, "claude-conversation.jsonl"), open: ["u1", "gone"] });
    assert.deepEqual(Object.keys(out.open), ["u7", "u6", "u5", "u1"]);
    const pic = out.open.u1.reply.find((b) => b.kind === "mermaid");
    assert.match(pic.svg, /^herdr-dock\/render\/.+\.svg$/);
  } finally { x.done(); }
});

test("file: blocks with their buttons and the whole file's copy md / copy html", () => {
  const x = home();
  try {
    const path = join(x.h, "plan.md");
    writeFileSync(path, "# Plan\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```sh\nnpm test\n```\n");
    const out = run({ ...x.base, mode: "file", path });
    assert.deepEqual(out.blocks.map((b) => b.kind), ["text", "table", "code"]);
    assert.deepEqual(out.buttons.map((b) => b.label), ["copy md", "copy html"]);
    assert.equal(out.canHtml, process.platform === "darwin");
  } finally { x.done(); }
});

test("clip: a request without html and text is refused without touching the clipboard", () => {
  assert.deepEqual(run({ mode: "clip" }), { ok: false, error: "clip needs html and text" });
});

test("file: a file over the budget comes a page at a time", () => {
  const x = home();
  try {
    const path = join(x.h, "big.md");
    writeFileSync(path, Array.from({ length: 30 }, (_, i) => `## Part ${i}\n\n${"text ".repeat(1000)}`).join("\n\n"));
    const first = run({ ...x.base, mode: "file", path });
    assert.ok(first.pageCount >= 3);
    assert.equal(first.page, 0);
    const second = run({ ...x.base, mode: "file", path, page: 1 });
    assert.equal(second.page, 1);
    assert.notDeepEqual(second.blocks[0], first.blocks[0]);
    assert.equal(second.buttons[0].text.length, first.buttons[0].text.length);
  } finally { x.done(); }
});

test("claude: rows carry their size; a long turn comes as its first 12 lines unless asked in full", () => {
  const x = home();
  try {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const t = join(x.h, "t.jsonl");
    writeFileSync(t, [JSON.stringify({ type: "user", uuid: "u", origin: { kind: "human" }, message: { content: long } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" } })].join("\n"));
    const out = run({ ...x.base, mode: "claude", transcript: t });
    assert.equal(out.exchanges[0].size, Buffer.byteLength(long) + 2);
    assert.equal(out.open.u.turnMore, true);
    assert.ok(!JSON.stringify(out.open.u.turn).includes("line 12"));
    const full = run({ ...x.base, mode: "claude", transcript: t, full: ["u"] });
    assert.equal(full.open.u.turnMore, false);
    assert.ok(JSON.stringify(full.open.u.turn).includes("line 19"));
    assert.deepEqual([full.open.u.page, full.open.u.pageCount], [0, 1]);
  } finally { x.done(); }
});

test("claude: footnotes across a mid-turn marker are numbered once and noted at the reply's end", () => {
  const x = home();
  try {
    const t = join(x.h, "fn.jsonl");
    writeFileSync(t, [
      JSON.stringify({ type: "user", uuid: "f", origin: { kind: "human" }, message: { content: "go" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Claim[^1]." }, { type: "tool_use", id: "t1", name: "X", input: {} }], stop_reason: "tool_use" } }),
      JSON.stringify({ type: "attachment", attachment: { type: "queued_command", prompt: "also", origin: { kind: "human" }, commandMode: "prompt" } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "More.\n\n[^1]: The source." }], stop_reason: "end_turn" } }),
    ].join("\n"));
    const reply = run({ ...x.base, mode: "claude", transcript: t }).open.f.reply;
    assert.ok(JSON.stringify(reply[0]).includes("Claim¹"));
    assert.deepEqual(reply.at(-1).kind, "footnotes");
    assert.equal(reply.at(-1).notes[0].mark, "¹");
    assert.ok(!JSON.stringify(reply).includes("[^1]"));
  } finally { x.done(); }
});

test("claude: whether the last prompts got Render's hint, with the hook's run for the newest prompt; codex answers don't", () => {
  const x = home();
  try {
    const runsDir = join(x.h, "herdr-dock", "hint-runs");
    const prompt = (text, promptId) => JSON.stringify({ type: "user", promptId, origin: { kind: "human" }, timestamp: "2026-11-25T14:29:25.000Z", message: { role: "user", content: text } });
    const answer = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
    const transcript = join(x.h, "s-1.jsonl");
    writeFileSync(transcript, [prompt("one", "p-1"), answer, prompt("two", "p-2"), answer].join("\n") + "\n");
    const req = { ...x.base, mode: "claude", transcript, runsDir };
    const plain = run(req);
    assert.deepEqual([plain.hints.state, plain.hints.checked, plain.hints.promptId, plain.hints.settled], ["silent", 2, "p-2", true]);
    assert.equal(plain.hints.run, undefined);
    // The run is the newest prompt's own: <runsDir>/<session id>/<prompt id>.json, the session id being the file name.
    mkdirSync(join(runsDir, "s-1"), { recursive: true });
    writeFileSync(join(runsDir, "s-1", "p-1.json"), JSON.stringify({ at: 1, decision: "prismantis" }));
    assert.equal(run(req).hints.run, undefined, "an older prompt's run isn't the newest's");
    const rec = { at: 1764080965100, decision: "spoke" };
    writeFileSync(join(runsDir, "s-1", "p-2.json"), JSON.stringify(rec));
    assert.deepEqual(run(req).hints.run, rec);
    writeFileSync(join(runsDir, "s-1", "p-2.json"), "{ nope");
    assert.equal(run(req).hints.run, undefined);
    // A transcript whose name isn't a session id reads no run.
    const odd = join(x.h, "not a session.jsonl");
    writeFileSync(odd, [prompt("one", "p-1"), answer, prompt("two", "p-2"), answer].join("\n") + "\n");
    mkdirSync(join(runsDir, "not a session"), { recursive: true });
    writeFileSync(join(runsDir, "not a session", "p-2.json"), JSON.stringify(rec));
    assert.equal(run({ ...req, transcript: odd }).hints.run, undefined);
    const p = (uuid, text) => JSON.stringify({ type: "user", uuid, message: { role: "user", content: text } });
    const hint = JSON.stringify({ type: "attachment", attachment: { type: "hook_additional_context", hookEvent: "UserPromptSubmit", content: ["The Render panel beside this terminal draws diagrams."] } });
    const file = join(x.h, "hinted.jsonl");
    writeFileSync(file, [p("u1", "first"), hint, p("u2", "second"), hint].join("\n") + "\n");
    assert.deepEqual(run({ ...x.base, mode: "claude", transcript: file }).hints, { state: "ok", checked: 2 });
    const codex = run({ ...x.base, mode: "codex", cwd: "/nowhere", codexHome: join(x.h, "no-codex"), runsDir });
    assert.equal(codex.hints, undefined);
  } finally { x.done(); }
});

test("claude: hook runs untouched for 14 days and temp files over an hour old are deleted after a read; empty session folders go", () => {
  const x = home();
  try {
    const runsDir = join(x.h, "herdr-dock", "hint-runs");
    const put = (rel, ageMs) => {
      const file = join(runsDir, ...rel.split("/"));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "{}");
      const t = new Date(Date.now() - ageMs);
      utimesSync(file, t, t);
    };
    const DAY = 86400e3;
    put("old-session/p-1.json", 15 * DAY);
    put("mixed/p-old.json", 15 * DAY);
    put("mixed/p-new.json", 0);
    put("mixed/p-new.json.123.tmp", 2 * 3600e3);
    put("mixed/p-fresh.json.456.tmp", 60e3);
    put("mixed/notes.txt", 15 * DAY);
    run({ ...x.base, mode: "claude", transcript: join(FIX, "claude-conversation.jsonl"), runsDir });
    assert.deepEqual(readdirSync(runsDir).sort(), ["mixed"]);
    assert.deepEqual(readdirSync(join(runsDir, "mixed")).sort(), ["notes.txt", "p-fresh.json.456.tmp", "p-new.json"]);
  } finally { x.done(); }
});
