// src/mods/dock-render/main.js
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import {
  agents,
  appHome,
  checking,
  closeOverlay,
  exec,
  focused,
  hc,
  home,
  nextCommand,
  openOverlay,
  panes,
  props,
  readTextFile,
  setShared,
  shared,
  theme,
  watchFolder,
  window
} from "herdr";

// src/shared/platform.js
function listDirCommand(platform, dir) {
  if (platform === "windows") return { command: "cmd", args: ["/c", "dir", "/b", "/ad", dir.replaceAll("/", "\\")] };
  return { command: "ls", args: ["-1", "-p", dir] };
}

// src/shared/render/figure-limits.js
var FIGURE_MAX_COLUMNS = 100;
var FIGURE_MAX_LINES = 80;

// src/shared/statusline.js
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function readSettings(text) {
  if (text == null || !String(text).trim()) return { ok: true, settings: {}, command: null };
  let settings;
  try {
    settings = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: `not valid JSON (${e.message})` };
  }
  if (!isObj(settings)) return { ok: false, error: "the root is not an object" };
  const sl = settings.statusLine;
  const command = isObj(sl) && typeof sl.command === "string" && sl.command.trim() ? sl.command : null;
  return { ok: true, settings, command };
}

// src/shared/render/hint-phrase.js
var HINT_RUNS = "herdr-dock/hint-runs";

// src/shared/render/hints.js
var HINT_MARK = "herdr-hint";
var GLYPHS = "\u2500\u2502\u250C\u2510\u2514\u2518\u251C\u2524\u252C\u2534\u253C\u2550\u2551\u2192\u2190\u25BA\u25C4\u25B2\u25BC\u2713\u2717\u25CF\u25CB\u2588\u258F\u25A0\u25A1\xB7";
var HINT = [
  [
    "Replies in this session are also drawn in the Render panel beside this terminal (herdr-dock, in the Herdr app); it is not a command or tool to call.",
    "Markdown tables, GitHub alerts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]), fenced code with a language tag, and ```mermaid blocks are drawn there:",
    "flowchart, sequenceDiagram, stateDiagram-v2, classDiagram and erDiagram diagrams, and xychart-beta bar or line charts.",
    "When a reply carries a numeric series or a flow that is easier to see than read, add a small diagram or chart with short labels, not a second picture of what a figure already shows.",
    "Skip diagrams and pictures for short or simple answers.",
    "Put any command or snippet the user may run or copy in a fenced block with a language tag, never inline code: fenced blocks get a copy button, inline code does not."
  ].join(" "),
  [
    "A fenced block whose opening line is exactly ```figure is drawn as a text picture, as written.",
    "Prefer one over mermaid when position carries meaning: durations racing on a time axis, a screen layout, phases, before/after; mermaid stays for plain flows and charts; none for short answers, code changes or reports. The prose never retells the picture.",
    "When the user asks you to explain, compare or plan something and pictures would make it easier to grasp, build the reply around them, with the core on the first screen as a picture or a sentence.",
    "Color with {role:text}, not nested: accent for lines, warn for risk, ok for healthy, note for time, dim for asides, strong for emphasis.",
    `At most ${FIGURE_MAX_COLUMNS} columns and ${FIGURE_MAX_LINES} lines, glyphs one column wide such as ${GLYPHS}, no emoji or tabs; markup takes no columns, so align on the drawn text. Draw a time axis with edge ticks like \u258F\u2500\u2500\u2500\u258F\u2500\u2500\u2500\u258F, not \u251C\u253C\u2524: \u2588 fills its cell, \u251C\u253C\u2524 sit mid-cell.`
  ].join(" ")
].join("\n");
var isObj2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var EVENTS = { session: "SessionStart", prompt: "UserPromptSubmit" };
var hintCommand = (script, event) => `node "${String(script).replace(/\\/g, "/")}" ${event}`;
function hintsPlan(settingsText, script) {
  const r = readSettings(settingsText);
  if (!r.ok) return { state: "invalid", error: r.error };
  const settings = r.settings;
  if (settings.hooks !== void 0 && !isObj2(settings.hooks)) return { state: "invalid", error: "hooks is not an object" };
  const hooks = settings.hooks ?? (settings.hooks = {});
  let added = false, moved = false;
  for (const [event, name] of Object.entries(EVENTS)) {
    if (hooks[name] !== void 0 && !Array.isArray(hooks[name])) return { state: "invalid", error: `hooks.${name} is not a list` };
    const groups = hooks[name] ?? (hooks[name] = []);
    const want = hintCommand(script, event);
    const ours = groups.flatMap((g) => Array.isArray(g?.hooks) ? g.hooks : []).find((h) => typeof h?.command === "string" && h.command.includes(HINT_MARK));
    if (!ours) {
      groups.push({ hooks: [{ type: "command", command: want }] });
      added = true;
    } else if (ours.command !== want) {
      ours.command = want;
      moved = true;
    }
  }
  if (!added && !moved) return { state: "present" };
  const nl = settingsText && String(settingsText).includes("\r\n") ? "\r\n" : "\n";
  return { state: added ? "missing" : "moved", text: JSON.stringify(settings, null, 2).replace(/\n/g, nl) + nl };
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/shared/layout.js
function rightActiveOf(active, features) {
  if (!features.length) return null;
  return features.some((f) => f.mod === active) ? active : features[0].mod;
}

// src/shared/panel.js
function rightShownOf(sharedShown, applied) {
  if (typeof sharedShown === "boolean") return sharedShown;
  return applied?.right?.hidden === false;
}

// src/shared/claude.js
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseJson(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
var isObj3 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
function matchSession(recordText, fg, terminalCreatedMs, nowMs) {
  const r = parseJson(recordText);
  if (!isObj3(r) || !fg) return null;
  if (r.pid !== fg.pid || r.kind !== "interactive") return null;
  if (typeof r.sessionId !== "string" || !UUID_RE.test(r.sessionId)) return null;
  if (!isNum(r.startedAt)) return null;
  if (r.startedAt < terminalCreatedMs - 5e3 || r.startedAt > nowMs + 6e4) return null;
  return r.sessionId.toLowerCase();
}

// src/shared/render/transcript.js
var claudeSlug = (cwd) => String(cwd ?? "").replace(/[^A-Za-z0-9]/g, "-");

// src/shared/render/agent.js
function pickAgent(focus, agents2) {
  if (!focus || !Array.isArray(agents2)) return null;
  return agents2.find((a) => focus.pane && a.pane === focus.pane || focus.terminal && a.address === focus.terminal) ?? agents2.find((a) => a.tab === focus.tab) ?? null;
}
function agentKind(a) {
  if (!a || String(a.address).includes("/")) return null;
  const key = a.program?.key, app = String(a.app ?? "");
  if (key === "claude" || /^claude/.test(app)) return "claude";
  if (key === "codex" || /^codex/.test(app)) return "codex";
  return null;
}
function transcriptPath(home2, info, recordText, nowMs) {
  const pid = info?.foreground?.pid;
  if (typeof pid !== "number" || typeof info?.created_ms !== "number") return null;
  const sessionId = matchSession(recordText, { pid }, info.created_ms, nowMs);
  let cwd = null;
  try {
    cwd = JSON.parse(recordText)?.cwd ?? null;
  } catch {
    cwd = null;
  }
  if (!sessionId || typeof cwd !== "string" || !cwd) return null;
  return `${String(home2).replace(/[\\/]+$/, "")}/.claude/projects/${claudeSlug(cwd)}/${sessionId}.jsonl`;
}

// src/shared/render/size.js
var MIN_SCALE = 0.7;
var MIN_WIDTH = 40;
function shownSize(size, room) {
  const n = Number(size?.w), nh = Number(size?.h);
  if (!(n > 0 && nh > 0)) return { w: room, h: Math.round(room * 0.6), scroll: false };
  const w = Math.max(MIN_WIDTH, Math.round(n <= room ? n : Math.max(room, MIN_SCALE * n)));
  return { w, h: Math.round(w * nh / n), scroll: w > room };
}

// src/shared/jira/model.js
var CATEGORIES = [
  { category: "new", title: "To do" },
  { category: "indeterminate", title: "In progress" },
  { category: "done", title: "Done" }
];
var RANK = Object.fromEntries(CATEGORIES.map((c, i) => [c.category, i]));
function ago(ms, now) {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, now - ms) / 1e3;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (30 * 86400))}mo`;
}

// src/shared/render/budget.js
var BUDGET = 64 * 1024;

// src/shared/render/columns.js
function columnWidths(natural, available, gap, words = []) {
  const room = Math.max(natural.length, available - gap * (natural.length - 1));
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= room) return natural;
  const minimum = natural.map((w, c) => Math.min(w, Math.max(1, words[c] ?? 1)));
  const widths = natural.map(() => 0);
  let open = natural.map((_, c) => c);
  let left = room;
  for (let fixed = [-1]; fixed.length; ) {
    const share = Math.floor(left / open.length);
    const claim = (c) => natural[c] <= share ? natural[c] : minimum[c];
    const minimumsFit = open.reduce((a, c) => a + minimum[c], 0) <= left;
    const needed = open.reduce((a, c) => a + claim(c), 0);
    fixed = open.filter((c) => natural[c] <= share);
    if (minimumsFit && (!fixed.length || needed > left)) fixed = open.filter((c) => minimum[c] > share);
    fixed.forEach((c) => {
      widths[c] = claim(c);
      left -= widths[c];
    });
    open = open.filter((c) => !fixed.includes(c));
  }
  open.forEach((c, i) => {
    widths[c] = Math.max(1, Math.floor(left / open.length) + (i < left % open.length ? 1 : 0));
  });
  while (widths.reduce((a, b) => a + b, 0) > room) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 1) break;
    widths[widest]--;
  }
  return widths;
}

// src/shared/render/view.js
var OPEN_NEWEST = 3;
var HTML_LIMIT = 512 * 1024;
var ROLE_COLOR = { you: "ansi4", claude: "ansi5", event: "ansi3" };
var ALERTS = {
  note: { title: "Note", color: "ansi4" },
  tip: { title: "Tip", color: "ansi2" },
  important: { title: "Important", color: "ansi5" },
  warning: { title: "Warning", color: "ansi3" },
  caution: { title: "Caution", color: "ansi1" }
};
var EVENTS2 = { "task-notification": "BACKGROUND TASK", compaction: "CONTEXT COMPACTED" };
function speakerLabel(role, event = null) {
  if (role === "you") return "YOU";
  if (role === "claude") return "CLAUDE";
  if (!event) return "EVENT";
  return EVENTS2[event] ?? String(event).replace(/[-_]+/g, " ").trim().toUpperCase();
}
var shownButtons = (buttons, canHtml) => (buttons ?? []).filter((b) => canHtml || b.html === void 0);
function copyPlan(button, canHtml) {
  if (button.html === void 0) return { how: "plain" };
  if (!canHtml) return { how: "plain", note: "formatted copy works on macOS only" };
  if (button.html.length + button.text.length > HTML_LIMIT) return { how: "plain", note: "too large for a formatted copy" };
  return { how: "html" };
}
var replyNote = (row) => row.state === "working" ? "working\u2026" : row.state === "none" ? "no reply text" : null;
function viewOf(stored) {
  return stored === "diagrams" || stored === "files" ? stored : "conversation";
}
function reachVerdict(hints, run) {
  if (hints?.state !== "silent" || hints.settled !== true || typeof hints.promptId !== "string") return null;
  return run?.decision === "spoke" || run?.decision === "not-herdr" ? run.decision : null;
}
var REACH_TEXT = {
  spoke: "Diagram hints aren't reaching Claude in this session",
  "not-herdr": "The diagram-hint hook doesn't see Herdr in this session"
};
function hintsNotice(state, { dismissed, error, reach, reachDismissed }) {
  if (state === "present" && REACH_TEXT[reach] && !reachDismissed) return { text: REACH_TEXT[reach], action: "why" };
  if (dismissed) return null;
  if (error) return { text: `Set up failed: ${error}`, action: "setup" };
  if (state === "missing") return { text: "Diagram hints for Claude aren't set up", action: "setup" };
  if (state === "moved") return { text: "Diagram hints point at another install", action: "setup" };
  if (state === "invalid") return { text: "~/.claude/settings.json can't be read: diagram hints aren't set up", action: null };
  return null;
}
var WHY = {
  spoke: "The hint hook ran on your last prompts and sent the hint, but it isn't in this session's log, so Claude didn't get it. Copy the details and report it.",
  "not-herdr": "The hint hook ran on your last prompts but saw none of Herdr's terminal variables (HC_TERMINAL_ID, HC_SCOPE), so it stayed quiet. That happens when Claude was started outside Herdr and attached here, or runs through WSL, tmux or ssh in this pane. If this is a plain Herdr terminal, copy the details and report it."
};
var hintsWhy = (verdict) => WHY[verdict] ?? "";
function hintsDetails({ platform, commands, transcript, checked, run }) {
  const when = Number.isFinite(run?.at) && Math.abs(run.at) <= 864e13 ? new Date(run.at).toISOString() : "time unknown";
  const last = run ? `${when}, decided "${run.decision}"` : "none recorded";
  return [
    "herdr-dock Render: diagram hints aren't reaching Claude",
    `platform: ${platform ?? "unknown"}`,
    `hook commands in ~/.claude/settings.json:${commands?.length ? "" : " none found"}`,
    ...(commands ?? []).map((c) => `  ${c}`),
    `session log: ${transcript ?? "unknown"}`,
    `typed prompts checked: ${checked ?? 0} (the newest 2 got no hint)`,
    `the hook's run for the newest prompt: ${last}`
  ].join("\n");
}
var COLOURS = {
  heading: "ansi6",
  strong: "foreground",
  em: "ansi5",
  del: "dim",
  code: "ansi6",
  link: "ansi4",
  number: "ansi5",
  path: "ansi6",
  bullet: "ansi6",
  quote: "ansi4",
  tableHeader: "ansi3",
  rule: "border",
  codeText: "foreground",
  codeBg: "surface",
  inlineCodeBg: "raised",
  note: "dim",
  comment: "dim",
  string: "ansi2",
  keyword: "ansi4",
  function: "ansi6",
  property: "ansi4",
  attr: "ansi5",
  regex: "ansi6"
};
function pieces(runs) {
  const out = [];
  for (const r of runs ?? []) {
    if (r.text === "\n" || r.role === "code") {
      out.push(r);
      continue;
    }
    for (const w of r.text.match(/\S+\s*|\s+/g) ?? []) out.push({ ...r, text: w });
  }
  return out;
}
function openWithin(rows, toggled, budget = BUDGET) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hand = [...toggled].filter(([id, on]) => on && byId.has(id)).map(([id]) => id).reverse();
  const defaults = rows.slice(0, OPEN_NEWEST).map((r) => r.id).filter((id) => !toggled.has(id));
  const keep = /* @__PURE__ */ new Set();
  let total = 0;
  for (const id of [...hand, ...defaults]) {
    if (keep.has(id)) continue;
    const size = byId.get(id).size ?? 0;
    if (!keep.size || total + size <= budget) {
      keep.add(id);
      total += size;
    }
  }
  return rows.filter((r) => keep.has(r.id)).map((r) => r.id);
}
var CHAR_PX = 7.2;
var CELL_PAD = 16;
var NUMBER_FROM = 10;
var FOLD_OVER = 30;
var FOLD_TO = 20;
function codeFold(lineCount, open) {
  const folded = lineCount > FOLD_OVER && !open;
  return { shown: folded ? FOLD_TO : lineCount, more: folded ? lineCount - FOLD_TO : 0, numbered: lineCount >= NUMBER_FROM };
}
function sideBySide(widths, panelPx, gap = 12) {
  return widths.length >= 2 && widths.reduce((a, w) => a + w, 0) + gap * (widths.length - 1) <= panelPx;
}
function tableWidths(natural, words, panelPx, stretch = true) {
  const chars = Math.max(natural.length, Math.floor((panelPx - CELL_PAD * natural.length) / CHAR_PX + 1e-9));
  const fitted = columnWidths(natural, chars, 0, words).map((w, c) => Math.max(w, words[c] ?? 1) * CHAR_PX + CELL_PAD);
  const used = fitted.reduce((a, w) => a + w, 0);
  if (!stretch || used >= panelPx) return fitted;
  const weight = natural.reduce((a, n) => a + Math.max(1, n), 0);
  const out = fitted.map((w, c) => Math.floor(w + (panelPx - used) * Math.max(1, natural[c]) / weight));
  out[out.length - 1] += panelPx - out.reduce((a, w) => a + w, 0);
  return out;
}

// src/mods/dock-render/main.js
var MOD = "dock-render";
var VIEW_KEY = "dock.render.view";
var VIEWS = [["conversation", "Conversation"], ["diagrams", "Diagrams"], ["files", "Files"]];
var COPIED_MS = 1500;
var HINTS_KEY = "dock.render.hintsDismissed";
var SETTLE_MS = 600;
var CODEX_POLL_MS = 4e3;
var PAD = 14;
var isDark = (hex) => {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex ?? ""));
  if (!m) return true;
  const n = parseInt(m[1], 16);
  return 0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255) < 128;
};
var Render = class extends View {
  init(_props, cx) {
    this.zoom = props()?.zoom ?? null;
    this.width = 360;
    this.agentKey = null;
    this.target = null;
    this.data = null;
    this.toggled = /* @__PURE__ */ new Map();
    this.full = /* @__PURE__ */ new Set();
    this.pages = /* @__PURE__ */ new Map();
    this.unfolded = /* @__PURE__ */ new Set();
    this.opening = /* @__PURE__ */ new Set();
    this.copied = null;
    this.hints = { state: null, busy: false, error: null, checked: false, commands: [] };
    this.reachWhy = null;
    this.reachDismissed = /* @__PURE__ */ new Set();
    this.files = null;
    this.file = null;
    this.problem = null;
    this.loading = false;
    this.watch = null;
    this.again = false;
    this.cursor = 0;
    if (checking() || this.zoom) return;
    cx.spawn(async (cx2) => {
      for (; ; ) {
        const c = await nextCommand();
        try {
          this.command(c, cx2);
        } catch (e) {
          console.log(`dock-render: command ${c} failed: ${e?.message ?? e}`);
        }
        cx2.notify();
      }
    });
    cx.timer.every(CODEX_POLL_MS, (cx2) => {
      if (this.shown() && this.target?.kind === "codex") this.load(cx2);
    });
  }
  // Commands (keys.json can bind them: "dock-render.diagrams"): conversation (or answer), diagrams, files, refresh, clear (empty the
  // diagram cache; what's on screen is drawn again); in Files: next, prev, open, back.
  command(c, cx) {
    if (c === "clear") {
      cx.spawn(async (cx2) => {
        const out = await this.helper({ mode: "clear" });
        console.log(`dock-render: cache cleared (${out.removed ?? 0} diagrams)`);
        await this.load(cx2);
        if (this.file) await this.openFile(this.file.path, this.file.page);
        cx2.notify();
      });
      return;
    }
    if (c === "answer" || c === "conversation" || c === "diagrams" || c === "files") this.setView(viewOf(c), cx);
    else if (c === "refresh") cx.spawn(async (cx2) => this.load(cx2));
    else if (c === "back") this.file = null;
    else if ((c === "next" || c === "prev") && this.files?.length) this.cursor = Math.max(0, Math.min(this.files.length - 1, this.cursor + (c === "next" ? 1 : -1)));
    else if (c === "open" && this.files?.[this.cursor]) {
      const f = this.files[this.cursor];
      cx.spawn(async (cx2) => {
        await this.openFile(f.path);
        cx2.notify();
      });
    }
  }
  // While it is the right panel's shown mod (or placed anywhere else).
  shown() {
    if (props()?.dockRegion !== "right") return true;
    const applied = shared("dock.config.applied");
    return rightShownOf(shared("dock.right.shown"), applied) && rightActiveOf(shared("dock.right.active"), applied?.right?.features ?? []) === MOD;
  }
  view() {
    return viewOf(shared(VIEW_KEY));
  }
  request(extra) {
    const t = theme();
    const base = slashPath(appHome());
    return JSON.stringify({
      cacheDir: `${base}/herdr-dock/render`,
      relBase: "herdr-dock/render",
      // The terminal's colours too: nodes take ansi4/6/2/5/3, figures' warn / ok / note take ansi1/2/3.
      theme: {
        background: t.background,
        foreground: t.foreground,
        muted: t.muted,
        border: t.border,
        accent: t.accent,
        dim: t.dim,
        ansi1: t.ansi1,
        ansi2: t.ansi2,
        ansi3: t.ansi3,
        ansi4: t.ansi4,
        ansi5: t.ansi5,
        ansi6: t.ansi6,
        dark: isDark(t.background)
      },
      ...extra
    });
  }
  async helper(extra) {
    const script = slashPath(appHome()) + "/mods/dock-render/herdr-render.mjs";
    const r = await exec("node", [script, this.request(extra)], { timeout: 6e4 });
    try {
      return JSON.parse(r.stdout.trim().split("\n").pop());
    } catch {
      return { ok: false, error: (r.stderr || r.stdout || `exit ${r.code}`).trim().slice(0, 300) };
    }
  }
  // Called from render: notices the focused agent changing; reads it (once) and watches its log.
  follow(cx) {
    if (checking() || this.zoom || !this.shown()) return;
    let list = [];
    try {
      list = agents();
    } catch {
      list = [];
    }
    const agent = pickAgent(focused(), list);
    const key = agent ? `${agent.address}|${agentKind(agent)}` : "none";
    if (key === this.agentKey) return;
    this.agentKey = key;
    this.watch?.cancel?.();
    this.watch = null;
    Object.assign(this, { target: null, data: null, files: null, file: null, problem: null, copied: null });
    this.toggled = /* @__PURE__ */ new Map();
    this.full = /* @__PURE__ */ new Set();
    this.pages = /* @__PURE__ */ new Map();
    this.unfolded = /* @__PURE__ */ new Set();
    this.opening = /* @__PURE__ */ new Set();
    if (!agent) return;
    const kind = agentKind(agent);
    if (!kind) {
      this.problem = `${agent.program?.name ?? "This agent"} isn't Claude Code or Codex (or runs on another machine).`;
      return;
    }
    cx.spawn(async (cx2) => this.locate(agent, kind, cx2));
  }
  async locate(agent, kind, cx) {
    const cwd = panes().find((p) => p.pane === agent.pane)?.cwd ?? null;
    if (kind === "codex") {
      this.target = { kind, agent, cwd };
    } else {
      const r = await hc(["get", agent.address, "--json"]).catch(() => null);
      let info = null;
      try {
        info = r && r.code === 0 ? JSON.parse(r.stdout) : null;
      } catch {
        info = null;
      }
      const pid = info?.foreground?.pid;
      const record = typeof pid === "number" ? await readTextFile(`${slashPath(home())}/.claude/sessions/${pid}.json`).catch(() => null) : null;
      const transcript = transcriptPath(slashPath(home()), info, record, Date.now());
      let recCwd = null;
      try {
        recCwd = JSON.parse(record ?? "null")?.cwd ?? null;
      } catch {
        recCwd = null;
      }
      if (!transcript) {
        this.problem = "Couldn't find this Claude session's transcript yet (it appears after the first reply).";
        cx.notify();
        return;
      }
      this.target = { kind, agent, transcript, cwd: recCwd ?? cwd };
      this.watchLog(cx);
    }
    await this.load(cx);
  }
  // Re-reads after the transcript's folder changes, once the burst settles.
  watchLog(cx) {
    const dir = this.target.transcript.replace(/\/[^/]+$/, "");
    const key = this.agentKey;
    cx.spawn(async (cx2) => {
      for (; ; ) {
        if (this.agentKey !== key) return;
        let changed;
        try {
          this.watch = watchFolder(dir);
          changed = await this.watch;
        } catch {
          await cx2.sleep(3e3);
          continue;
        }
        if (this.agentKey !== key) return;
        if (!changed?.length) {
          await cx2.sleep(1e3);
          continue;
        }
        await cx2.sleep(SETTLE_MS);
        if (this.shown()) this.load(cx2);
      }
    });
  }
  // One read at a time; one more after it if asked meanwhile.
  async load(cx) {
    if (!this.target) return;
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    cx.notify();
    try {
      do {
        this.again = false;
        const t = this.target;
        const open = [...this.toggled].filter(([, on]) => on).map(([id]) => id);
        const more = { open, full: [...this.full], pages: Object.fromEntries(this.pages) };
        const out = t.kind === "claude" ? await this.helper({ mode: "claude", transcript: t.transcript, runsDir: `${slashPath(appHome())}/${HINT_RUNS}`, ...more }) : await this.helper({ mode: "codex", cwd: t.cwd, ...more });
        if (this.target !== t) return;
        if (out.ok) {
          this.data = out;
          this.problem = null;
        } else this.problem = out.error ?? "Couldn't read the session.";
        if (this.view() === "files") await this.loadFiles();
      } while (this.again);
    } catch (e) {
      this.problem = `Couldn't run the helper: ${e?.message ?? e}`;
    } finally {
      this.loading = false;
      this.opening.clear();
      cx.notify();
    }
  }
  async loadFiles() {
    const cwd = this.target?.cwd;
    if (!cwd) {
      this.files = [];
      return;
    }
    const out = await this.helper({ mode: "list", cwd });
    this.files = out.ok ? out.files : [];
    if (this.file) await this.openFile(this.file.path, this.file.page);
  }
  async openFile(path, page = 0) {
    const out = await this.helper({ mode: "file", path, page });
    this.file = out.ok ? { path, blocks: out.blocks, buttons: out.buttons, canHtml: out.canHtml, page: out.page ?? 0, pageCount: out.pageCount ?? 1 } : { path, blocks: [{ kind: "text", md: "", parts: [{ type: "para", runs: [{ text: `Couldn't read it: ${out.error}` }] }], buttons: [] }], buttons: [], canHtml: false, page: 0, pageCount: 1 };
  }
  setView(v, cx) {
    setShared(VIEW_KEY, v);
    if (v === "files" && this.files === null && this.target) cx.spawn(async (cx2) => {
      await this.loadFiles();
      cx2.notify();
    });
  }
  // ---- drawing ----
  diagram(t, s, id, maxW) {
    if (s.kind === "figure" && (s.error || !s.svg)) {
      return v_flex().id(id).gap(6).child(div().text_size(11.5).text_color(t.dim).child(s.error ?? "figure didn't draw")).child(TextView.markdown(`${id}-src`, "```figure\n" + (s.source ?? "") + "\n```").selectable(true));
    }
    if (s.error || !s.svg) {
      return v_flex().id(id).gap(6).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.border).child(div().text_size(11.5).text_color(t.blocked).child(`Diagram didn't render: ${s.error ?? "unknown error"}`)).child(TextView.markdown(`${id}-src`, "```mermaid\n" + (s.source ?? "") + "\n```").selectable(true));
    }
    const { w, h, scroll } = shownSize(s, maxW);
    const card = div().id(id).flex_none().rounded(8).overflow_hidden().border_1().border_color(t.border).cursor_pointer().hover((st) => st.border_color(t.accent)).tooltip("Open large").on_click(() => openOverlay({ mod: MOD, kind: "dialog", width: 0.92, height: 0.9, props: { zoom: { svg: s.svg, w: s.w, h: s.h, title: this.target?.agent?.tab_name || "Diagram" } } })).child(image(s.svg).w(w).h(h));
    return scroll ? div().id(`${id}-scroll`).flex().flex_row().w(maxW).overflow_x_scrollbar().child(card) : card;
  }
  // ---- the diagram-hint hooks ----
  hintScript() {
    return `${slashPath(appHome())}/mods/dock-render/herdr-hint.mjs`;
  }
  // Whether Claude Code's settings hold the hooks (as Quotas checks its status line): present, missing, moved,
  // invalid, or no-claude when there's no ~/.claude at all.
  async checkHints() {
    const dir = `${slashPath(home())}/.claude`;
    try {
      const text = await readTextFile(`${dir}/settings.json`).catch(() => null);
      if (text == null) {
        const probe = listDirCommand(window()?.platform, dir);
        const r = await exec(probe.command, probe.args).catch(() => null);
        this.hints.state = r && r.code === 0 ? "missing" : "no-claude";
      } else {
        this.hints.state = hintsPlan(text, this.hintScript()).state;
        const r = readSettings(text);
        this.hints.commands = r.ok ? Object.values(r.settings?.hooks ?? {}).flat().flatMap((g) => g?.hooks ?? []).map((h) => h?.command).filter((c) => typeof c === "string" && c.includes(HINT_MARK)) : [];
      }
    } catch (e) {
      this.hints.state = null;
      console.log(`dock-render: diagram hints check failed: ${e?.message ?? e}`);
    }
  }
  // Set up: runs the setup command shipped with this mod (it backs settings.json up, then writes it), then checks again.
  runHintsSetup(cx) {
    if (this.hints.busy) return;
    Object.assign(this.hints, { busy: true, error: null });
    cx.notify();
    cx.spawn(async (cx2) => {
      try {
        const r = await exec("node", [`${slashPath(appHome())}/mods/dock-render/herdr-hints-setup.mjs`], { timeout: 3e4 });
        if (r.code !== 0) this.hints.error = (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n")[0];
        else console.log(`dock-render: ${r.stdout.trim()}`);
      } catch (e) {
        this.hints.error = `couldn't run node: ${e?.message ?? e}`;
      } finally {
        this.hints.busy = false;
        await this.checkHints();
        cx2.notify();
      }
    });
  }
  // One line under the header while the hooks are missing (Set up, and × to never ask again), or while they're set up
  // but the Claude session shown got no hint on its last prompts (Why, and × for that session).
  hintsRow(t) {
    const transcript = this.target?.kind === "claude" ? this.target.transcript : null;
    const verdict = transcript && this.data?.file === transcript ? reachVerdict(this.data.hints, this.data.hints?.run) : null;
    const n = hintsNotice(this.hints.state, {
      dismissed: shared(HINTS_KEY) === true,
      error: this.hints.error,
      reach: verdict,
      reachDismissed: this.reachDismissed.has(transcript)
    });
    if (!n) return null;
    if (n.action === "why") return this.reachRow(t, n, transcript, verdict);
    return h_flex().id("render-hints").px(PAD).py(4).gap(8).flex_none().items_center().border_b(1).border_color(t.border).child(div().flex_1().min_w(0).truncate().text_size(12).text_color(this.hints.error ? t.blocked ?? t.ansi1 : t.muted).child(n.text)).when(n.action === "setup", (el) => el.child(h_flex().id("render-hints-setup").h(22).px(8).flex_none().items_center().rounded(6).border_1().border_color(t.border).text_size(11.5).text_color(t.foreground).when(!this.hints.busy, (b) => b.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.runHintsSetup(cx))).child(this.hints.busy ? "Setting up\u2026" : "Set up"))).child(div().id("render-hints-dismiss").size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover)).tooltip("Don't ask again").on_click((_e, cx) => {
      setShared(HINTS_KEY, true);
      cx.notify();
    }).child(svg("mods/workspace-chrome/x.svg").size(12)));
  }
  // The hints are set up but don't reach Claude: the row, Why (what it means, what to do, details to copy), ×.
  reachRow(t, n, transcript, verdict) {
    const details = hintsDetails({ platform: window()?.platform ?? null, commands: this.hints.commands, transcript, checked: this.data?.hints?.checked, run: this.data?.hints?.run ?? null });
    const open = this.reachWhy === transcript;
    return v_flex().id("render-hints").px(PAD).py(4).gap(6).flex_none().border_b(1).border_color(t.border).child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.blocked ?? t.ansi3).child(n.text)).child(h_flex().id("render-hints-why").h(22).px(8).flex_none().items_center().rounded(6).border_1().border_color(t.border).text_size(11.5).text_color(t.foreground).cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => {
      this.reachWhy = open ? null : transcript;
      cx.notify();
    }).child(open ? "Hide" : "Why")).child(div().id("render-hints-dismiss").size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover)).tooltip("Hide for this session").on_click((_e, cx) => {
      this.reachDismissed.add(transcript);
      this.reachWhy = null;
      cx.notify();
    }).child(svg("mods/workspace-chrome/x.svg").size(12)))).when(open, (el) => el.child(div().text_size(12).text_color(t.muted).child(hintsWhy(verdict))).child(this.buttons(t, [{ label: "copy details", text: details }], "render-hints-details", false, false)));
  }
  // ---- copying ----
  // A row of copy buttons; `key` names the row, so the one pressed can say "copied".
  buttons(t, list, key, canHtml, end = true) {
    const shown = shownButtons(list, canHtml);
    if (!shown.length) return null;
    return h_flex().gap(5).flex_wrap().when(end, (el) => el.justify_end()).children(shown.map((b, i) => {
      const k = `${key}-${i}`;
      const on = this.copied?.key === k;
      return div().id(k).h(18).px(6).flex().items_center().rounded(5).border_1().border_color(t.border).text_size(10.5).text_color(on ? t.ansi2 : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => this.copy(b, k, canHtml, cx)).child(on ? "copied" : b.label);
    }));
  }
  // Why a copy went as plain text, under the row whose button was pressed.
  copyNote(t, key) {
    return this.copied?.note && this.copied.key.startsWith(`${key}-`) ? div().text_size(11).text_color(t.dim).child(this.copied.note) : null;
  }
  copy(b, key, canHtml, cx) {
    const done = (note, cx2) => {
      this.copied = { key, note };
      cx2.notify();
      cx2.spawn(async (cx3) => {
        await cx3.sleep(COPIED_MS);
        if (this.copied?.key === key) {
          this.copied = null;
          cx3.notify();
        }
      });
    };
    const plan = copyPlan(b, canHtml);
    if (plan.how !== "html") {
      cx.write_to_clipboard(b.text);
      done(plan.note ?? null, cx);
      return;
    }
    cx.spawn(async (cx2) => {
      const out = await this.helper({ mode: "clip", html: b.html, text: b.text }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
      if (!out.ok) cx2.write_to_clipboard(b.text);
      done(out.ok ? null : `copied as plain text: ${out.error}`, cx2);
    });
  }
  // ---- blocks, drawn in colour ----
  // One piece of prose (a word with its spaces) in its run's colour and style.
  piece(t, p, id) {
    if (p.text === "\n") return div().w_full().h(0);
    let el = div().min_w(0).text_color(t[COLOURS[p.role] ?? "foreground"] ?? t.foreground);
    if (p.bold) el = el.font_bold();
    if (p.italic) el = el.italic();
    if (p.strike) el = el.line_through();
    if (p.role === "code") el = el.font_family("Menlo").text_size(12).px(4).rounded(4).bg(t[COLOURS.inlineCodeBg]);
    if (p.role === "link" && p.href) el = el.id(id).underline().cursor_pointer().on_click((_e, cx) => cx.open_url(p.href));
    return el.child(p.text);
  }
  // Prose: runs as word pieces, wrapping between words.
  prose(t, runs, id, style = {}) {
    const { size = 13, justify = null, over = null } = style;
    const list = pieces(over ? runs.map(over) : runs);
    return h_flex().id(id).w_full().flex_wrap().text_size(size).when(justify === "right", (el) => el.justify_end()).when(justify === "center", (el) => el.justify_center()).children(list.map((p, i) => this.piece(t, p, `${id}-${i}`)));
  }
  // A pager: "Part 2 of 5" with Prev and Next.
  pager(t, id, label, page, count, go) {
    const btn = (k, text, to) => div().id(`${id}-${k}`).h(20).px(8).flex().items_center().rounded(5).border_1().border_color(t.border).text_size(11).when(to >= 0 && to < count, (el) => el.cursor_pointer().text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click((_e, cx) => go(to, cx))).when(!(to >= 0 && to < count), (el) => el.text_color(t.dim)).child(text);
    return h_flex().id(id).gap(6).items_center().child(div().flex_1().text_size(11).text_color(t.dim).child(`${label} ${page + 1} of ${count}`)).child(btn("prev", "Prev", page - 1)).child(btn("next", "Next", page + 1));
  }
  // A block in colour. `inner`: inside a list item, quote or alert, where the outer block's copy covers its text.
  // A list of blocks: consecutive tables, diagrams and figures share a row when they all fit (tables fitted to their
  // content, pictures at their own size); otherwise each is drawn on its own as usual.
  blockList(t, list, prefix, maxW, canHtml) {
    const SIDE = /* @__PURE__ */ new Set(["table", "mermaid", "figure"]);
    const widthOf = (b) => b.kind === "table" ? tableWidths(b.natural ?? [], b.words ?? [], maxW - 2, false).reduce((a, w) => a + w, 0) + 2 : b.svg && !b.error ? shownSize(b, maxW).w : maxW;
    const out = [];
    for (let i = 0; i < list.length; ) {
      let j = i;
      while (j < list.length && SIDE.has(list[j].kind)) j++;
      if (j - i >= 2) {
        const group = list.slice(i, j), widths = group.map(widthOf);
        if (sideBySide(widths, maxW)) {
          out.push(h_flex().id(`${prefix}-row${i}`).gap(12).items_start().children(group.map((b, k) => this.block(t, b, `${prefix}-${i + k}`, widths[k], canHtml, false, true))));
          i = j;
          continue;
        }
      }
      const end = Math.max(j, i + 1);
      for (let k = i; k < end; k++) out.push(this.block(t, list[k], `${prefix}-${k}`, maxW, canHtml));
      i = end;
    }
    return out;
  }
  block(t, b, id, maxW, canHtml, inner = false, fitted = false) {
    const note = this.copyNote(t, id);
    const sub = (list, w) => list.map((x, j) => this.block(t, x, `${id}-b${j}`, w, canHtml, true));
    switch (b.kind) {
      case "mermaid":
      case "figure":
        return v_flex().id(id).gap(4).children([this.diagram(t, b, `${id}-pic`, maxW), this.buttons(t, b.buttons, id, canHtml, false), note].filter(Boolean));
      case "code": {
        const lines = b.lines ?? [];
        const f = codeFold(lines.length, this.unfolded.has(id));
        const digits = String(lines.length).length;
        const row = (line, n) => h_flex().whitespace_nowrap().children([
          f.numbered ? div().w(digits * CHAR_PX + 10).flex_none().text_color(t.dim).child(String(n).padStart(digits)) : null,
          ...line.length ? line.map((r) => div().text_color(t[COLOURS[r.role] ?? COLOURS.codeText]).child(r.text)) : [div().child(" ")]
        ].filter(Boolean));
        const fold = f.more ? `+${f.more} more lines` : lines.length > FOLD_OVER ? "show less" : null;
        return v_flex().id(id).w_full().gap(2).children([
          h_flex().gap(8).items_center().child(div().flex_1().text_size(11).text_color(t.dim).child(b.lang || "code")).child(this.buttons(t, b.buttons, id, canHtml)),
          div().id(`${id}-scroll`).w(maxW).overflow_x_scrollbar().rounded(5).bg(t[COLOURS.codeBg]).p(8).child(v_flex().flex_none().font_family("Menlo").text_size(12).children(lines.slice(0, f.shown).map((line, n) => row(line, n + 1)))),
          fold ? div().id(`${id}-fold`).text_size(11.5).text_color(t.accent).cursor_pointer().on_click((_e, cx) => {
            if (this.unfolded.has(id)) this.unfolded.delete(id);
            else this.unfolded.add(id);
            cx.notify();
          }).child(fold) : null,
          note
        ].filter(Boolean));
      }
      case "footnotes":
        return v_flex().id(id).w_full().gap(3).children([
          div().text_size(12).text_color(t[COLOURS.note]).child("\u2500".repeat(12)),
          ...(b.notes ?? []).map((n, i) => this.prose(t, [{ text: `${n.mark} ` }, ...n.runs], `${id}-n${i}`, {
            size: 12,
            over: (r) => r.role === "code" || r.role === "link" ? r : { ...r, role: "note" }
          }))
        ]);
      case "table": {
        const widths = tableWidths(b.natural ?? [], b.words ?? [], maxW - 2, !fitted);
        const total = widths.reduce((a, w) => a + w, 0) + 2;
        const cell = (runs, c, r) => div().w(widths[c]).flex_none().px(8).py(4).when(c > 0, (el) => el.border_l(1).border_color(t.border)).child(this.prose(t, runs, `${id}-c${r}-${c}`, {
          justify: b.align?.[c],
          over: r < 0 ? (x) => ({ ...x, bold: true, role: x.role ?? "tableHeader" }) : null
        }));
        const grid = v_flex().w(total).flex_none().border_1().border_color(t.border).rounded(6).overflow_hidden().child(h_flex().bg(t[COLOURS.tableHeader] + "12").children(b.header.map((h, c) => cell(h, c, -1)))).children(b.rows.map((row, r) => h_flex().border_t(1).border_color(t.border).children(row.map((cl, c) => cell(cl, c, r)))));
        return v_flex().id(id).when(fitted, (el) => el.w(maxW).flex_none()).when(!fitted, (el) => el.w_full()).gap(4).children([
          this.buttons(t, b.buttons, id, canHtml),
          total > maxW ? div().id(`${id}-scroll`).w(maxW).overflow_x_scrollbar().child(grid) : grid,
          note
        ].filter(Boolean));
      }
      case "list":
        return v_flex().id(id).w_full().gap(4).children([
          inner ? null : this.buttons(t, b.buttons, id, canHtml),
          ...(b.items ?? []).map((it, i) => h_flex().w_full().items_start().child(div().w(22).flex_none().text_size(13).text_color(t[COLOURS.bullet]).child(it.marker)).child(v_flex().flex_1().min_w(0).gap(4).children(it.blocks.map((x, j) => this.block(t, x, `${id}-i${i}-${j}`, maxW - 22, canHtml, true))))),
          note
        ].filter(Boolean));
      case "quote":
        return v_flex().id(id).w_full().gap(4).children([
          inner ? null : this.buttons(t, b.buttons, id, canHtml),
          v_flex().w_full().gap(4).pl(10).border_l(3).border_color(t[COLOURS.quote]).children(sub(b.blocks ?? [], maxW - 13)),
          note
        ].filter(Boolean));
      case "alert": {
        const a = ALERTS[b.alert] ?? ALERTS.note;
        const c = t[a.color];
        return v_flex().id(id).w_full().gap(4).p(8).border_l(3).border_color(c).bg(c + "14").rounded(4).children([
          h_flex().gap(8).items_center().child(div().flex_1().text_size(11.5).font_semibold().text_color(c).child(a.title)).child(this.buttons(t, b.buttons, id, canHtml)),
          ...sub(b.blocks ?? [], maxW - 19),
          note
        ].filter(Boolean));
      }
      case "marker": {
        const role = b.by === "you" ? "you" : "event";
        const c = t[ROLE_COLOR[role]];
        return div().id(id).w_full().pl(8).py(2).border_l(3).border_color(c).bg(c + "14").text_size(12).text_color(c).child(role === "you" ? `YOU, while Claude worked: ${b.text}` : `${speakerLabel("event", b.event)} \xB7 ${b.text}`);
      }
      default: {
        const SIZE = { 1: 17, 2: 15 };
        const parts = (b.parts ?? []).map((part, i) => {
          const pid = `${id}-p${i}`;
          if (part.type === "heading") return this.prose(t, part.runs, pid, { size: SIZE[part.level] ?? 13.5, over: (r) => ({ ...r, bold: true, role: r.role ?? "heading" }) });
          if (part.type === "rule") return div().w_full().h(1).bg(t[COLOURS.rule]);
          if (part.type === "html") return div().w_full().text_size(12.5).text_color(t.muted).child(part.text);
          return this.prose(t, part.runs, pid);
        });
        return v_flex().id(id).w_full().gap(6).children([inner ? null : this.buttons(t, b.buttons, id, canHtml), ...parts, note].filter(Boolean));
      }
    }
  }
  // ---- the conversation ----
  toggle(id, open, cx) {
    this.toggled.delete(id);
    this.toggled.set(id, open);
    if (open && !this.data?.open?.[id]) {
      this.opening.add(id);
      cx.spawn(async (cx2) => this.load(cx2));
    }
    cx.notify();
  }
  // An open exchange: the turn that started it on its speaker's rail, then Claude's reply on Claude's.
  exchange(t, row, data, maxW) {
    const role = row.by === "you" ? "you" : "event";
    const c = t[ROLE_COLOR[role]], claude = t[ROLE_COLOR.claude];
    const x = `render-x-${row.id}`;
    const when = row.at ? ` \xB7 ${ago(row.at, Date.now())} ago` : "";
    const canHtml = Boolean(this.data?.canHtml);
    const turn = v_flex().id(`${x}-turn`).w_full().gap(4).pl(10).py(4).border_l(3).border_color(c).bg(c + "14").children([
      div().id(`${x}-head`).text_size(11).font_semibold().text_color(c).cursor_pointer().tooltip("Fold").on_click((_e, cx) => this.toggle(row.id, false, cx)).child(`${speakerLabel(role, row.event)}${when}`),
      ...(data.turn ?? []).map((b, i) => this.block(t, b, `${x}-t${i}`, maxW - 13, canHtml, true)),
      data.turnMore ? div().id(`${x}-all`).text_size(11.5).text_color(t.accent).cursor_pointer().on_click((_e, cx) => {
        this.full.add(row.id);
        cx.spawn(async (cx2) => this.load(cx2));
        cx.notify();
      }).child("show all") : null
    ].filter(Boolean));
    const note = replyNote(row);
    const go = (page, cx) => {
      this.pages.set(row.id, page);
      cx.spawn(async (cx2) => this.load(cx2));
      cx.notify();
    };
    const pager = (k) => (data.pageCount ?? 1) > 1 ? this.pager(t, `${x}-pg${k}`, "Part", data.page ?? 0, data.pageCount, go) : null;
    const reply = v_flex().id(`${x}-reply`).w_full().gap(8).pl(10).py(4).border_l(3).border_color(claude).children([
      div().text_size(11).font_semibold().text_color(claude).child("CLAUDE"),
      ...note ? [div().text_size(12.5).text_color(t.dim).child(note)] : [
        pager("a"),
        ...this.blockList(t, data.reply, x, maxW - 13, canHtml),
        pager("b"),
        this.buttons(t, data.buttons, `${x}-copy`, canHtml),
        this.copyNote(t, `${x}-copy`)
      ]
    ].filter(Boolean));
    return v_flex().id(x).w_full().gap(6).child(turn).child(reply);
  }
  // A folded exchange: one row; clicking it opens it.
  folded(t, row) {
    const role = row.by === "you" ? "you" : "event";
    const c = t[ROLE_COLOR[role]];
    const text = this.opening.has(row.id) ? "opening\u2026" : [row.text.replace(/\s+/g, " ").trim(), row.preview].filter(Boolean).join(" \xB7 ");
    return h_flex().id(`render-x-${row.id}`).w_full().h(24).gap(8).items_center().pl(10).border_l(3).border_color(c).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.toggle(row.id, true, cx)).child(div().flex_none().text_size(11).font_semibold().text_color(c).child(speakerLabel(role, row.event))).child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(text || "\u2014"));
  }
  conversationView(t) {
    const rows = this.data?.exchanges;
    if (!rows) return [this.note(t, "Reading\u2026")];
    if (!rows.length) return [this.note(t, "No conversation yet in this session.")];
    const open = new Set(openWithin(rows, this.toggled));
    const maxW = Math.max(120, this.width - PAD * 2 - 13);
    return rows.flatMap((row, i) => [
      ...i ? [div().id(`render-sep-${i}`).w_full().h(0).border_b(1).border_dashed().border_color(t.border)] : [],
      open.has(row.id) && this.data.open?.[row.id] ? this.exchange(t, row, this.data.open[row.id], maxW) : this.folded(t, row)
    ]);
  }
  header(t) {
    const a = this.target?.agent;
    const who = a ? `${a.program?.name ?? "Agent"} \xB7 ${a.space_name ?? ""}${a.tab_name ? ` \xB7 ${a.tab_name}` : ""}` : "No agent in focus";
    const view = this.view();
    const tab = ([k, label]) => h_flex().id(`render-view-${k}`).h(24).px(9).items_center().rounded(5).text_size(12).cursor_pointer().on_click((_e, cx) => this.setView(k, cx)).when(view === k, (el) => el.bg(t.raised ?? t.selected).text_color(t.foreground)).when(view !== k, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover))).child(label);
    return v_flex().flex_none().px(PAD).pt(10).pb(8).gap(8).border_b(1).border_color(t.border).child(h_flex().gap(8).items_center().child(div().text_size(13).font_semibold().child("Render")).child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(who)).when(this.loading, (el) => el.child(div().text_size(11).text_color(t.dim).child("reading\u2026"))).child(div().id("render-refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Read again").on_click((_e, cx) => cx.spawn(async (cx2) => this.load(cx2))).child(svg("mods/dock-jira/refresh.svg").size(13)))).child(h_flex().p(2).gap(2).rounded(7).border_1().border_color(t.border).children(VIEWS.map(tab)));
  }
  note(t, text) {
    return div().p(PAD).text_size(12.5).text_color(t.dim).child(text);
  }
  diagramsView(t) {
    const list = this.data?.diagrams ?? [];
    if (!list.length) return [this.note(t, "No diagrams or figures in this session yet.")];
    const maxW = Math.max(120, this.width - PAD * 2);
    return list.flatMap((d, i) => [
      div().text_size(11).text_color(t.dim).child(d.at ? `${ago(d.at, Date.now())} ago` : ""),
      this.diagram(t, d, `render-diagram-${i}`, maxW)
    ]);
  }
  filesView(t) {
    if (this.file) {
      const f = this.file;
      const maxW = Math.max(120, this.width - PAD * 2);
      return [
        h_flex().gap(8).items_center().child(h_flex().id("render-file-back").flex_1().min_w(0).gap(6).items_center().cursor_pointer().text_size(12).text_color(t.muted).hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => {
          this.file = null;
          cx.notify();
        }).child(svg("mods/workspace-chrome/chevron-left.svg").size(12)).child(f.path.split("/").pop())).children([this.buttons(t, f.buttons, "render-file-copy", f.canHtml)].filter(Boolean)),
        ...[this.copyNote(t, "render-file-copy")].filter(Boolean),
        ...f.pageCount > 1 ? [this.pager(t, "render-file-pga", "Page", f.page, f.pageCount, (page, cx) => cx.spawn(async (cx2) => {
          await this.openFile(f.path, page);
          cx2.notify();
        }))] : [],
        ...this.blockList(t, f.blocks, "render-file", maxW, f.canHtml),
        ...f.pageCount > 1 ? [this.pager(t, "render-file-pgb", "Page", f.page, f.pageCount, (page, cx) => cx.spawn(async (cx2) => {
          await this.openFile(f.path, page);
          cx2.notify();
        }))] : []
      ];
    }
    if (this.files === null) return [this.note(t, "Reading\u2026")];
    if (!this.files.length) return [this.note(t, "No Markdown files in this folder.")];
    return this.files.map((f, i) => h_flex().id(`render-file-${i}`).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer().when(i === this.cursor, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => cx.spawn(async (cx2) => {
      await this.openFile(f.path);
      cx2.notify();
    })).child(div().flex_1().min_w(0).truncate().text_size(12.5).child(f.rel)).child(div().flex_none().text_size(11).text_color(t.dim).child(ago(f.mtimeMs, Date.now()))));
  }
  zoomView(t) {
    const z = this.zoom;
    return v_flex().id("render-zoom").size_full().bg(t.popover).text_color(t.foreground).on_size_change((size, cx) => {
      this.zoomSize = size;
      cx.notify();
    }).child(h_flex().h(40).px(14).gap(8).items_center().flex_none().border_b(1).border_color(t.border).child(div().flex_1().text_size(13).font_semibold().child(z.title ?? "Diagram")).child(div().id("render-zoom-close").size(26).flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover)).on_click(() => closeOverlay(props().overlay)).child(svg("mods/workspace-chrome/x.svg").size(13)))).child(div().id("render-zoom-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).flex().justify_center().items_start().child((() => {
      const W = Math.max(200, (this.zoomSize?.width ?? 1200) - 32), H = Math.max(200, (this.zoomSize?.height ?? 800) - 72);
      const scale = z.w && z.h ? Math.min(W / z.w, H / z.h, 4) : 1;
      return image(z.svg).w(Math.round((z.w ?? W) * scale)).h(Math.round((z.h ?? H) * scale));
    })()));
  }
  render(cx) {
    const t = theme();
    if (this.zoom) return this.zoomView(t);
    this.follow(cx);
    if (!this.hints.checked && !checking() && this.shown()) {
      this.hints.checked = true;
      cx.spawn(async (cx2) => {
        await this.checkHints();
        cx2.notify();
      });
    }
    const view = this.view();
    const body = this.problem && !this.data ? [this.note(t, this.problem)] : !this.target && !this.problem ? [this.note(t, "Focus a Claude Code or Codex agent: its conversation shows here, drawn.")] : view === "diagrams" ? this.diagramsView(t) : view === "files" ? this.filesView(t) : this.conversationView(t);
    return v_flex().id("dock-render").size_full().min_h(0).bg(t.background).text_color(t.foreground).on_size_change((size, cx2) => {
      if (Math.abs((size?.width ?? 0) - this.width) > 2) {
        this.width = size.width;
        cx2.notify();
      }
    }).child(this.header(t)).children([this.hintsRow(t)].filter(Boolean)).child(v_flex().id("render-body").flex_1().min_h(0).overflow_y_scrollbar().px(PAD).py(12).gap(10).children(body));
  }
};
export {
  Render as default
};
