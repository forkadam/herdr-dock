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
  watchFolder
} from "herdr";

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
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
function matchSession(recordText, fg, terminalCreatedMs, nowMs) {
  const r = parseJson(recordText);
  if (!isObj(r) || !fg) return null;
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

// src/mods/dock-render/main.js
var MOD = "dock-render";
var VIEW_KEY = "dock.render.view";
var VIEWS = [["answer", "Answer"], ["diagrams", "Diagrams"], ["files", "Files"]];
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
  // Commands (keys.json can bind them: "dock-render.diagrams"): answer, diagrams, files, refresh, clear (empty the
  // diagram cache; what's on screen is drawn again); in Files: next, prev, open, back.
  command(c, cx) {
    if (c === "clear") {
      cx.spawn(async (cx2) => {
        const out = await this.helper({ mode: "clear" });
        console.log(`dock-render: cache cleared (${out.removed ?? 0} diagrams)`);
        await this.load(cx2);
        if (this.file) await this.openFile(this.file.path);
        cx2.notify();
      });
      return;
    }
    if (c === "answer" || c === "diagrams" || c === "files") this.setView(c, cx);
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
    const v = shared(VIEW_KEY);
    return VIEWS.some(([k]) => k === v) ? v : "answer";
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
    Object.assign(this, { target: null, data: null, files: null, file: null, problem: null });
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
        const out = t.kind === "claude" ? await this.helper({ mode: "claude", transcript: t.transcript }) : await this.helper({ mode: "codex", cwd: t.cwd });
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
    if (this.file) await this.openFile(this.file.path);
  }
  async openFile(path) {
    const out = await this.helper({ mode: "file", path });
    this.file = out.ok ? { path, segments: out.segments } : { path, segments: [{ kind: "md", text: `Couldn't read it: ${out.error}` }] };
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
  segments(t, list, prefix) {
    const maxW = Math.max(120, this.width - PAD * 2);
    return list.map((s, i) => s.kind !== "md" ? this.diagram(t, s, `${prefix}-${i}`, maxW) : div().id(`${prefix}-${i}`).w_full().text_size(13).child(TextView.markdown(`${prefix}-md-${i}`, s.text).selectable(true)));
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
  answerView(t) {
    const a = this.data?.answer;
    if (!a) return [this.note(t, this.data ? "No reply yet in this session." : "Reading\u2026")];
    return [
      ...this.data.prompt ? [div().text_size(11.5).text_color(t.dim).truncate().child(`You: ${this.data.prompt.replace(/\s+/g, " ")}`)] : [],
      ...this.segments(t, a.segments, "render-answer"),
      div().text_size(11).text_color(t.dim).child(a.at ? `${ago(a.at, Date.now())} ago` : "")
    ];
  }
  diagramsView(t) {
    const list = this.data?.diagrams ?? [];
    if (!list.length) return [this.note(t, "No Mermaid diagrams in this session yet.")];
    const maxW = Math.max(120, this.width - PAD * 2);
    return list.flatMap((d, i) => [
      div().text_size(11).text_color(t.dim).child(d.at ? `${ago(d.at, Date.now())} ago` : ""),
      this.diagram(t, d, `render-diagram-${i}`, maxW)
    ]);
  }
  filesView(t) {
    if (this.file) {
      return [
        h_flex().id("render-file-back").gap(6).items_center().cursor_pointer().text_size(12).text_color(t.muted).hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => {
          this.file = null;
          cx.notify();
        }).child(svg("mods/workspace-chrome/chevron-left.svg").size(12)).child(this.file.path.split("/").pop()),
        ...this.segments(t, this.file.segments, "render-file")
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
    const view = this.view();
    const body = this.problem && !this.data ? [this.note(t, this.problem)] : !this.target && !this.problem ? [this.note(t, "Focus a Claude Code or Codex agent: its latest reply shows here, drawn.")] : view === "diagrams" ? this.diagramsView(t) : view === "files" ? this.filesView(t) : this.answerView(t);
    return v_flex().id("dock-render").size_full().min_h(0).bg(t.background).text_color(t.foreground).on_size_change((size, cx2) => {
      if (Math.abs((size?.width ?? 0) - this.width) > 2) {
        this.width = size.width;
        cx2.notify();
      }
    }).child(this.header(t)).child(v_flex().id("render-body").flex_1().min_h(0).overflow_y_scrollbar().px(PAD).py(12).gap(10).children(body));
  }
};
export {
  Render as default
};
