// src/mods/dock-spaces/main.js
import { View, div as div3, svg as svg3 } from "gpui-kit";
import { v_flex as v_flex2, h_flex, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, agents, run, openOverlay, exec, hc, theme, shared as shared2, setShared as setShared3, watchFolder, window, layout, props, readTextFile, home, checking } from "herdr";

// src/mods/_feature.js
import { div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { setShared } from "herdr";

// src/mods/_feature-mode.js
function featureMode(sharedMode, focus, myId, region) {
  if (region !== "left") return "full";
  if (sharedMode === "icons") return "icon";
  if (sharedMode === "expanded" && focus != null && focus !== myId) return "collapsed";
  return "full";
}

// src/mods/_feature.js
var RAIL_PX = 48;
function iconRail(t, iconPath, title, onClick) {
  return v_flex().size_full().w(RAIL_PX).min_h(0).bg(t.chrome).items_center().pt(8).child(div().id("dock-feature-icon").size(32).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(title).on_click((_e, cx) => {
    cx.stop_propagation();
    onClick();
  }).child(svg(iconPath).size(16)));
}
function requestFocus(myId) {
  setShared("dock.left.focus", myId);
  setShared("dock.left.mode", "expanded");
}

// src/mods/_page.js
import { setShared as setShared2, shared } from "herdr";

// src/shared/panel.js
var PAGE_KEY = "dock.page.active";

// src/mods/_page.js
function showTerminal() {
  if ((shared(PAGE_KEY) ?? null) !== null) setShared2(PAGE_KEY, null);
}

// src/mods/_agent.js
import { div as div2, image, svg as svg2 } from "gpui-kit";
function agentIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg2(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}
function agentStatus(t, a, compact = false) {
  const color = t[a.status] ?? t.dim;
  if (a.status === "working") return svg2("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (a.status === "blocked" && compact) return div2().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (a.status === "blocked") return div2().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
  if (a.status === "idle") return div2().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div2().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
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
function identityOf(info) {
  const pid = isObj(info) && isObj(info.foreground) ? info.foreground.pid : void 0;
  if (!isNum(pid) || !isNum(info.created_ms)) return null;
  return { pid, createdMs: info.created_ms };
}
var isLocalClaude = (a) => !a.address.includes("/") && (a.app === "claude-code" || a.program?.key === "claude");
var sigOf = (a) => `${a.app ?? ""}|${a.program?.key ?? ""}|${a.pane}`;
var claudeKey = (list) => list.filter(isLocalClaude).map((a) => `${a.address}=${sigOf(a)}`).join(",");
function sessionNameOf(info, recordText, nowMs) {
  const id = identityOf(info);
  if (!id || !matchSession(recordText, { pid: id.pid }, id.createdMs, nowMs)) return null;
  const name = parseJson(recordText).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
async function readPeerNames(list, io, nowMs) {
  const out = /* @__PURE__ */ new Map();
  for (const a of list) {
    if (!isLocalClaude(a)) continue;
    try {
      const info = await io.get(a.address);
      const id = identityOf(info);
      if (!id) continue;
      const name = sessionNameOf(info, await io.readRecord(id.pid), nowMs);
      if (name) out.set(a.address, { sig: sigOf(a), pid: id.pid, createdMs: id.createdMs, name });
    } catch {
    }
  }
  return out;
}

// src/shared/agent-rows.js
var cleanTitle = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();
function withAgents(rows, agents2) {
  const bySpace = /* @__PURE__ */ new Map();
  for (const a of agents2) {
    if (!bySpace.has(a.space)) bySpace.set(a.space, []);
    bySpace.get(a.space).push(a);
  }
  return rows.flatMap((r) => [r, ...(bySpace.get(r.w.id) ?? []).map((agent) => ({ w: r.w, agent, depth: r.tree ? 2 : 1 }))]);
}
function rowLabel(a, peerName) {
  const tab = a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : "";
  return peerName || a.pane_name || cleanTitle(a.title) || tab || a.program?.name || a.address;
}
function sharedNames(names) {
  const seen = /* @__PURE__ */ new Set(), twice = /* @__PURE__ */ new Set();
  for (const n of names) {
    if (n == null) continue;
    if (seen.has(n)) twice.add(n);
    seen.add(n);
  }
  return twice;
}
var URGENCY = { blocked: 4, done: 3, working: 2, idle: 1 };
function foldRows(rows, folded) {
  const childrenOf = (k) => {
    const r = rows[k], kids = [];
    for (let j = k + 1; j < rows.length; j++) {
      const x = rows[j];
      if (r.tree ? !(x.agent && x.w === r.w) : !x.agent && !x.tree) break;
      kids.push(x);
    }
    return kids;
  };
  const out = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    if (r.agent) {
      out.push(r);
      continue;
    }
    const kids = childrenOf(k);
    if (!kids.length || !folded.has(r.w.id)) {
      out.push({ ...r, children: kids.length, folded: false });
      continue;
    }
    const top = kids.filter((x) => x.agent).reduce((m, x) => (URGENCY[x.agent.status] ?? 0) > (URGENCY[m] ?? 0) ? x.agent.status : m, null);
    const holdsActive = kids.some((x) => !x.agent && x.w.active);
    out.push({ ...r, children: kids.length, folded: true, hidden: kids.length, top, holdsActive });
    k += kids.length;
  }
  return out;
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/mods/dock-spaces/main.js
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
var narrow = () => (find(layout(), "dock-left")?.size?.px ?? Infinity) < 160;
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
var rowHeight = ({ tree }) => tree ? 28 : 30;
var RAIL_CELL = 32;
var SIDE_MIN = 48;
var railCell = (el) => h_flex().flex_none().justify_center().child(el);
var where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
var base = (path) => path.replace(/\/+$/, "").split("/").pop();
var FALLBACK = 6e4;
var AT_ONCE = 6;
var NAMES_MS = 15e3;
var NAMES_CHECK_MS = 1e3;
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}
var MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
function glyph(status) {
  return status === "blocked" || status === "done" ? "\u25CF" : "\xB7";
}
function tone(t, status) {
  return t[status] ?? t.unknown;
}
var Spaces = class extends View {
  init(_props, cx) {
    this.git = {};
    this.checked = {};
    this.unsure = /* @__PURE__ */ new Set();
    this.pending = /* @__PURE__ */ new Set();
    this.busy = {};
    this.ready = {};
    this.at = {};
    this.watching = /* @__PURE__ */ new Map();
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.scroll = ScrollHandle.new();
    this.activeAt = -1;
    this.agentsAbove = 0;
    this.machines = [];
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch {
      this.reconnecting = {};
    }
    try {
      this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    } catch {
      this.folded = /* @__PURE__ */ new Set();
    }
    try {
      this.foldedSpaces = new Set(JSON.parse(localStorage.getItem("spaces.folded") ?? "[]"));
    } catch {
      this.foldedSpaces = /* @__PURE__ */ new Set();
    }
    this.refreshMachines(cx);
    cx.timer.every(15e3, (cx2) => this.refreshMachines(cx2));
    cx.timer.every(250, (cx2) => this.checkNew(cx2));
    this.names = /* @__PURE__ */ new Map();
    this.namesKey = null;
    this.drawsAgents = false;
    this.hoveredAgent = null;
    this.copiedAgent = null;
    if (checking()) return;
    cx.timer.every(NAMES_MS, (cx2) => this.refreshNames(cx2));
    cx.timer.every(NAMES_CHECK_MS, (cx2) => {
      if (this.drawsAgents && claudeKey(agents()) !== this.namesKey) this.refreshNames(cx2);
    });
  }
  // One pass at a time; a request meanwhile runs once more after it. A pass replaces the names, so
  // a session that ended or was restarted in its terminal never keeps its old name.
  refreshNames(cx) {
    if (!this.drawsAgents || checking()) return;
    this.namesKey = claudeKey(agents());
    if (this.fetchingNames) {
      this.namesAgain = true;
      return;
    }
    this.fetchingNames = true;
    cx.spawn(async (cx2) => {
      const root = slashPath(home());
      const io = {
        get: async (address) => {
          const r = await hc(["get", address, "--json"]);
          return r.code === 0 ? JSON.parse(r.stdout) : null;
        },
        readRecord: (pid) => readTextFile(`${root}/.claude/sessions/${pid}.json`)
      };
      try {
        do {
          this.namesAgain = false;
          const next = await readPeerNames(agents(), io, Date.now());
          const same = next.size === this.names.size && [...next].every(([k, v]) => this.names.get(k)?.name === v.name && this.names.get(k)?.sig === v.sig);
          this.names = next;
          if (!same) cx2.notify();
        } while (this.namesAgain);
      } finally {
        this.fetchingNames = false;
      }
    });
  }
  // The agent's peer name, only while the entry is still the same local Claude agent it was read for.
  nameFor(a) {
    const e = this.names.get(a.address);
    return e && isLocalClaude(a) && e.sig === sigOf(a) ? e.name : null;
  }
  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }
  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) {
        for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      }
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }
  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : []];
  }
  refreshMachines(cx) {
    cx.spawn(async (cx2) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
      } catch {
      }
      cx2.notify();
    });
  }
  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }
  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async (cx2) => {
      try {
        const ask = async (args2) => {
          const r = await hc([...args2, "--json"]);
          if (r.code !== 0) {
            let error;
            try {
              error = JSON.parse(r.stdout || r.stderr).error?.message;
            } catch {
            }
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx2);
      cx2.notify();
    });
  }
  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx2) => {
      while (this.pending.size) {
        const keys2 = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys2.length) }, async () => {
          while (next < keys2.length) await this.check(keys2[next++], cx2);
        }));
      }
      this.refreshing = false;
      cx2.notify();
    });
  }
  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on })
      );
      if (r.code !== 0 || common.code !== 0) {
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on })
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }
  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx2) => {
      let current = pending;
      try {
        for (; ; ) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx2);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {
      }
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }
  // A space being dragged is over `w` (its row, or one of its agent rows: they belong to its block).
  dragOver(w, cx) {
    const source = spaces().find((s) => s.id === this.pressed);
    const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
    if (this.pressed !== null && this.over !== over) {
      this.over = over;
      cx.notify();
    }
  }
  // Let go over `w`'s block: a drag lands there; a press on `w` itself selects it, unless its row is
  // a folded parent standing for the active worktree inside it: then you stay where you are.
  dragEnd(w, cx, holdsActive = false) {
    const from = this.pressed;
    const over = this.over;
    this.pressed = null;
    this.over = null;
    if (from !== null && over === w.id && from !== w.id) {
      const index = spaces().findIndex((s) => s.id === w.id);
      if (index !== -1) run("space.move", { id: from, index: index + 1 });
    } else if (from === w.id) {
      showTerminal();
      if (!holdsActive) run("space.select", { id: w.id });
    }
    cx.notify();
  }
  // Fold or unfold a space's children; ids of spaces that are gone are dropped as folds change. A
  // remote space ("<machine>/<id>") counts as gone only while its machine is ready: an offline or
  // connecting machine lists none of its spaces, and its folds wait for it.
  toggleFold(id, cx) {
    this.foldedSpaces.has(id) ? this.foldedSpaces.delete(id) : this.foldedSpaces.add(id);
    const ids = new Set(spaces().map((s) => s.id));
    const ready = new Set(machines().filter((m) => m.name && m.layout === "ready").map((m) => m.name));
    const judged = (k) => !k.includes("/") || ready.has(k.slice(0, k.indexOf("/")));
    for (const k of this.foldedSpaces) if (!ids.has(k) && judged(k)) this.foldedSpaces.delete(k);
    localStorage.setItem("spaces.folded", JSON.stringify([...this.foldedSpaces]));
    this.foldMoved = true;
    cx.notify();
  }
  menu(w) {
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }
  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1e3 && this.ordering.machines.every((name) => machines().some((m) => m.name === name && m.layout === "ready"));
  }
  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = /* @__PURE__ */ new Set();
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "\u2514\u2500" : "\u251C\u2500" }));
    }
    const order = sp.map((w) => w.id);
    const target = out.map((r) => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = /* @__PURE__ */ new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter((r) => this.shown.has(r.w.id));
  }
  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = collapsed ? this.ordered() : foldRows(withAgents(this.ordered(), agents()), this.foldedSpaces);
    const dupes = sharedNames(rows.filter((r) => r.agent).map((r) => this.nameFor(r.agent)));
    const draw = (r) => r.agent ? this.agentRow(r, t, dupes) : collapsed ? this.compact(r, t) : this.row(r, t);
    this.activeAt = -1;
    this.agentsAbove = 0;
    let before = 0;
    let agentsBefore = 0;
    const agentRows = (list) => list.filter((r) => r.agent).length;
    const remote = [.../* @__PURE__ */ new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...this.machines.map((m) => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = (m) => {
      const layout2 = machines().find((k) => k.name === m)?.layout;
      return layout2 === "loading" || !layout2 && this.machines.some((k) => k.name === m && k.state === "connected") || spaces().some((s) => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = (m) => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, (el) => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "\u2026" : "Loading\u2026");
    if (!remote.length) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      this.activeAt = rows.findIndex((r) => r.w.active || r.holdsActive);
      this.agentsAbove = agentRows(rows.slice(0, Math.max(this.activeAt, 0)));
      return rows.map(draw);
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find((k) => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg3(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div3().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim).when(collapsed, (el) => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} \xB7 ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer")).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
        if (collapsed && login) {
          run("app.settings", { section: "machines" });
          return;
        }
        folded ? this.folded.delete(m) : this.folded.add(m);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        cx.notify();
      }).when(machine?.keeps_running_after_logout === false, (el) => el.child(div3().id(`machine-logout-${m}`).flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.").on_click((_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "machine-add", kind: "dialog", width: 560 });
      }).child("\u26A0"))).when(!collapsed, (el) => el.child(icon)).when(collapsed, (el) => el.child(div3().relative().flex_none().child(icon).when(Boolean(m), (el2) => el2.child(badge)))).when(!collapsed, (el) => el.child(div3().flex_1().truncate().child(m ?? "This computer")).when(!connected && !rebuilt && !login, (el2) => el2.child(div3().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " ")))).when(rebuilt, (el2) => el2.child(h_flex().flex_none().gap(3).items_center().child(div3().max_w(140).truncate().child(repair?.error || "rebuilt \xB7")).child(div3().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted).hover((s) => s.text_color(t.foreground)).tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.").on_click((_e, cx) => {
        cx.stop_propagation();
        this.reconnect(machine, cx);
      }).child(repair?.busy ? "Connecting\u2026" : "Connect")))).when(connected, (el2) => el2.child(div3().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => {
        cx.stop_propagation();
        run("space.new", { machine: m ?? "" });
      }).child("+"))).child(div3().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim)).child(svg3(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7).text_size(12).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => run("space.new", { machine: m ?? "" })).when(collapsed, (el) => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`).child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center().child(svg3("mods/workspace-chrome/plus.svg").size(10)))).when(!collapsed, (el) => el.child(svg3("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) {
        before += 1;
        return [head];
      }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex2().px(8).pb(6).gap(3).flex_none().child(div3().text_size(11).text_color(t.blocked).child("needs a login: run")).child(h_flex().gap(5).items_center().child(div3().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login)).child(div3().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4).text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
        cx.stop_propagation();
        cx.write_to_clipboard(login);
        this.copiedLogin = login;
        cx.notify();
      }).child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const items = [cell(head), ...guidance, ...folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)]];
      const first = folded ? -1 : mine.findIndex((r) => r.w.active || r.holdsActive);
      if (first >= 0) {
        this.activeAt = before + 1 + guidance.length + first;
        this.agentsAbove = agentsBefore + agentRows(mine.slice(0, first));
      }
      before += items.length;
      if (!folded) agentsBefore += agentRows(mine);
      return items;
    });
  }
  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. When the row is full, it
  // and the name both start from their text's width and give way in proportion.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where2 = [repo, branch].filter(Boolean).join(" \xB7 ");
    return h_flex().flex_auto().min_w(where2 ? SIDE_MIN : 0).gap(5).justify_end().items_center().text_size(11.5).text_color(t.dim).when(Boolean(where2), (el) => el.child(div3().min_w(0).truncate().child(where2))).when(g.ahead > 0, (el) => el.child(div3().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`))).when(g.behind > 0, (el) => el.child(div3().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }
  row({ w, i, g, tree, children = 0, folded = false, hidden = 0, top = null, holdsActive = false }, t) {
    const on = w.active || holdsActive;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex((s) => s.id === this.pressed);
    const colors = shared2("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : MARK[color] ?? t[color];
    return v_flex2().relative().id(`space-${w.id}`).px(8).h(rowHeight({ tree })).flex_none().justify_center().rounded(8).when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover))).when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5)).when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
      div3().absolute().left(0).right(0).h(2).bg(t.accent).when(fromIndex < i, (line) => line.bottom(0)).when(fromIndex > i, (line) => line.top(0))
    )).on_mouse_down("left", () => {
      this.pressed = w.id;
      this.over = w.id;
    }).on_mouse_move((_e, cx) => this.dragOver(w, cx)).on_mouse_up("left", (_e, cx) => this.dragEnd(w, cx, holdsActive)).on_mouse_down("right", () => this.menu(w)).child(
      h_flex().gap(9).items_center().when(Boolean(tree), (el) => el.pl(22).child(svg3("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim))).when(!tree, (el) => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?"))).child(div3().flex_initial().min_w(SIDE_MIN).truncate().text_color(t.foreground).child(w.name)).child(g ? this.gitTail(g, tree, w.name, t) : div3().flex_1()).when(folded && hidden > 0, (el) => el.child(div3().flex_none().text_size(11).text_color(t.dim).child(String(hidden)))).when(folded && Boolean(top) && top !== "idle", (el) => el.child(agentStatus(t, { status: top }, true))).when(children > 0, (el) => el.child(div3().id(`space-fold-${w.id}`).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(folded ? "Show this space's agents and worktrees" : "Fold this space's agents and worktrees").on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.pressed = null;
        this.over = null;
        this.toggleFold(w.id, cx);
      }).child(svg3(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11))))
    );
  }
  // herdr-dock: an agent under its space: its icon, its name (the peer name when proven), a Copy
  // pill on hover when it has one, and its state. A click goes to the agent.
  agentRow({ w, agent: a, depth }, t, dupes) {
    const name = this.nameFor(a);
    const hovered = this.hoveredAgent === a.address;
    const copied = this.copiedAgent === a.address;
    const idle = a.status === "idle" && !a.focused;
    return h_flex().id(`space-agent-${a.address}`).h(26).px(8).flex_none().rounded(8).items_center().cursor_pointer().hover((s) => s.bg(t.hover)).on_hover((on, cx) => {
      if (on) this.hoveredAgent = a.address;
      else if (this.hoveredAgent === a.address) {
        this.hoveredAgent = null;
        if (this.copiedAgent === a.address) this.copiedAgent = null;
      }
      cx.notify();
    }).on_mouse_down("left", () => {
      this.pressed = null;
      this.over = null;
    }).on_mouse_move((_e, cx) => this.dragOver(w, cx)).on_mouse_up("left", (_e, cx) => this.dragEnd(w, cx)).on_click(() => {
      showTerminal();
      run("pane.focus", { pane: a.pane });
    }).child(h_flex().flex_1().min_w(0).gap(9).items_center().pl(depth === 1 ? 22 : 44).child(agentIcon(a.program, 13, t.muted) ?? div3().size(13).flex_none()).child(div3().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(rowLabel(a, name))).when(Boolean(name) && dupes.has(name), (el) => el.child(div3().id(`space-agent-same-${a.address}`).flex_none().text_size(11).text_color(t.dim).tooltip("Another session has this name too: a message by name may reach either").child("same name")))).when(Boolean(name) && hovered, (el) => el.child(div3().id(`space-agent-copy-${a.address}`).flex_none().ml(5).px(5).py(2).rounded(4).text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Copy the name other sessions message it by").on_click((_e, cx) => {
      cx.stop_propagation();
      cx.write_to_clipboard(name);
      this.copiedAgent = a.address;
      cx.notify();
    }).child(copied ? "Copied" : "Copy"))).child(h_flex().w(16).ml(5).flex_none().items_center().justify_center().child(agentStatus(t, a, true)));
  }
  compact({ w, i }, t) {
    return railCell(h_flex().id(`space-${w.id}`).relative().w(RAIL_CELL).h(26).rounded(6).justify_center().items_center().when(w.active, (el) => el.bg(t.selected)).when(!w.active, (el) => el.hover((s) => s.bg(t.hover))).on_click(() => {
      showTerminal();
      run("space.select", { id: w.id });
    }).child(div3().text_color(w.active ? t.foreground : t.muted).child(String(i + 1))).child(div3().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }
  // The header row (title and +). `onTitle`: what clicking the title does (collapsed: take focus).
  header(t, collapsed, onTitle) {
    return h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim).when(collapsed, (el) => el.pl(0).pr(0).justify_center()).when(!collapsed && !onTitle, (el) => el.child("Spaces")).when(!collapsed && Boolean(onTitle), (el) => el.child(div3().id("dock-spaces-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Spaces").on_click(() => onTitle()).child("Spaces"))).child(div3().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => run("space.new")).child(svg3("mods/workspace-chrome/plus.svg").size(14)));
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map((p) => p.id));
    const kept = Object.fromEntries(Object.entries(shared2("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared2("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = (c) => Object.values(kept).filter((v) => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared3("space.colors", kept);
    const myId = props()?.dockFeature ?? "dock-spaces";
    const face = featureMode(shared2("dock.left.mode"), shared2("dock.left.focus"), myId, props()?.dockRegion);
    if (face !== "full") {
      this.drawsAgents = false;
      this.namesKey = null;
      if (this.names.size) this.names = /* @__PURE__ */ new Map();
      this.ordered();
      if (face === "icon") return iconRail(t, "mods/dock-spaces/icon.svg", "Spaces", () => requestFocus(myId));
      return v_flex2().size_full().min_h(0).bg(t.chrome).text_size(13).child(this.header(t, false, () => requestFocus(myId)));
    }
    this.drawsAgents = !collapsed;
    if (!this.drawsAgents) {
      this.namesKey = null;
      if (this.names.size) this.names = /* @__PURE__ */ new Map();
    }
    const list = this.grouped(t, collapsed);
    const active = sp.find((p) => p.active)?.id;
    const place2 = this.activeAt < 0 ? -1 : this.activeAt - this.agentsAbove;
    if (this.foldMoved && active === this.revealed) {
      this.revealedAt = place2;
      this.revealedNarrow = collapsed;
    }
    this.foldMoved = false;
    if (active !== this.revealed || place2 !== this.revealedAt || collapsed !== this.revealedNarrow) {
      this.revealed = active;
      this.revealedAt = place2;
      this.revealedNarrow = collapsed;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    return v_flex2().size_full().min_h(0).bg(t.chrome).text_size(13).child(this.header(t, collapsed, null)).child(v_flex2().id("spaces-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always").track_scroll(this.scroll).on_size_change((size, cx) => {
      const height = size?.height ?? 0;
      if (Math.abs(height - (this.listHeight ?? -Infinity)) <= 2) return;
      this.listHeight = height;
      if (this.activeAt >= 0) {
        this.scroll.scroll_to_item(this.activeAt);
        cx.notify();
      }
    }).on_mouse_up("left", (_e, cx) => {
      this.pressed = null;
      cx.notify();
    }).children(list));
  }
};
export {
  Spaces as default,
  glyph,
  tone
};
