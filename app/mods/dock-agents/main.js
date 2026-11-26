// src/mods/dock-agents/main.js
import { View, div as div3, svg as svg3 } from "gpui-kit";
import { v_flex as v_flex2, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared as shared2, setShared as setShared3, setAgentOrder, openOverlay, closeOverlay, props, layout, checking, hc, home, readTextFile } from "herdr";

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
function iconRail(t, iconPath, title2, onClick) {
  return v_flex().size_full().w(RAIL_PX).min_h(0).bg(t.chrome).items_center().pt(8).child(div().id("dock-feature-icon").size(32).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(title2).on_click((_e, cx) => {
    cx.stop_propagation();
    onClick();
  }).child(svg(iconPath).size(16)));
}
function requestFocus(myId) {
  setShared("dock.left.focus", myId);
  setShared("dock.left.mode", "expanded");
}

// src/shared/claude.js
var STALE_MS = 12e4;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var KINDS = /* @__PURE__ */ new Set(["five_hour", "weekly"]);
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
function parseStatusline(text, nowMs) {
  const d = parseJson(text);
  if (!isObj(d) || d.provider !== "claude" || d.source !== "claude-statusline") return null;
  if (!isNum(d.fetched_at_unix)) return null;
  const fetchedMs = d.fetched_at_unix * 1e3;
  const sessions = /* @__PURE__ */ new Map();
  if (isObj(d.session_contexts)) {
    for (const [id, s] of Object.entries(d.session_contexts)) {
      if (!isObj(s) || !isNum(s.used_percent)) continue;
      const act = isObj(s.cache) ? s.cache.last_activity_unix : void 0;
      const seenMs = isNum(act) ? act * 1e3 : 0;
      sessions.set(id.toLowerCase(), { usedPercent: s.used_percent, seenMs, stale: nowMs - seenMs > STALE_MS });
    }
  }
  const windows = [];
  if (Array.isArray(d.windows)) {
    for (const w of d.windows) {
      if (!isObj(w) || !KINDS.has(w.kind) || !isNum(w.used_percent)) continue;
      windows.push({
        kind: w.kind,
        usedPercent: w.used_percent,
        resetsMs: isNum(w.resets_at) ? w.resets_at * 1e3 : null
      });
    }
  }
  return { fetchedMs, stale: nowMs - fetchedMs > STALE_MS, sessions, windows };
}
function formatPercent(p) {
  return `${Math.round(p)}% used`;
}
function formatAge(ms) {
  if (ms < 6e4) return "just now";
  const m = Math.floor(ms / 6e4);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function identityOf(info) {
  const pid = isObj(info) && isObj(info.foreground) ? info.foreground.pid : void 0;
  if (!isNum(pid) || !isNum(info.created_ms)) return null;
  return { pid, createdMs: info.created_ms };
}
function keepEntry(prev, info) {
  const id = identityOf(info);
  return Boolean(prev && id && prev.pid === id.pid && prev.createdMs === id.createdMs);
}
function contextEntry(info, recordText, cache, nowMs) {
  const id = identityOf(info);
  if (!id || !cache) return null;
  const sessionId = matchSession(recordText, { pid: id.pid }, id.createdMs, nowMs);
  const s = sessionId ? cache.sessions.get(sessionId) : void 0;
  if (!s) return null;
  return { ...id, sessionId, usedPercent: s.usedPercent, seenMs: s.seenMs, stale: s.stale };
}
function contextTooltip(ctx, nowMs) {
  const age = ctx.seenMs ? formatAge(nowMs - ctx.seenMs) : "reported at an unknown time";
  return `Context window: ${formatPercent(ctx.usedPercent)} \xB7 Claude status line \xB7 ${age}${ctx.stale ? " \xB7 Claude is idle" : ""}`;
}
var isLocalClaude = (a) => !a.address.includes("/") && (a.app === "claude-code" || a.program?.key === "claude");
var sigOf = (a) => `${a.app ?? ""}|${a.program?.key ?? ""}|${a.pane}`;
var claudeKey = (list) => list.filter(isLocalClaude).map((a) => `${a.address}=${sigOf(a)}`).join(",");

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
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

// src/shared/agent-rows.js
var cleanTitle = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// src/mods/dock-agents/main.js
var CONTEXT_MS = 15e3;
var LIST_CHECK_MS = 1e3;
var sameEntry = (x, y) => x.sig === y.sig && x.pid === y.pid && x.createdMs === y.createdMs && x.sessionId === y.sessionId && x.usedPercent === y.usedPercent && x.stale === y.stale && x.seenMs === y.seenMs;
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
var narrow = () => (find(layout(), "dock-left")?.size?.px ?? Infinity) < 160;
function leadPanes(all) {
  const leads = /* @__PURE__ */ new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    if (!current || !current.program?.agent && (p.program?.agent || !current.focused && p.focused)) leads.set(p.tab, p);
  }
  return leads;
}
function title(tab, l) {
  const prog = l?.program?.name;
  const live = cleanTitle(l?.title);
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
var RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
var kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
var SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" }
];
var sortOf = () => SORTS.find((s) => s.id === shared2("agents.sort")) ?? SORTS[0];
var SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
var SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
function duration(ms) {
  const m = Math.floor(ms / 6e4);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
var Agents = class extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = /* @__PURE__ */ new Set();
    try {
      this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    } catch {
      this.changed = {};
    }
    if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    try {
      this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    } catch {
      this.pendingPins = [];
    }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = /* @__PURE__ */ new Set();
    cx.timer.every(3e4, (cx2) => cx2.notify());
    this.context = /* @__PURE__ */ new Map();
    this.contextKey = null;
    if (checking()) return;
    cx.timer.every(CONTEXT_MS, (cx2) => this.refreshContext(cx2));
    cx.timer.every(LIST_CHECK_MS, (cx2) => {
      if (claudeKey(agents()) !== this.contextKey) this.refreshContext(cx2);
    });
  }
  // The row's context entry, only while it is still the same local Claude agent it was read for.
  contextFor(a) {
    const e = this.context?.get(a.address);
    return e && isLocalClaude(a) && e.sig === sigOf(a) ? e : null;
  }
  // One pass: address -> { sig, pid, createdMs, sessionId, usedPercent, seenMs, stale }.
  // An entry whose terminal now reports another pid or created_ms is dropped at once.
  async readContext(cx) {
    const list = agents().filter(isLocalClaude);
    const root = slashPath(home());
    const now = Date.now();
    const cache = list.length ? parseStatusline(await readTextFile(root + "/.claude/statusline-cache/claude-statusline.json").catch(() => null), now) : null;
    const next = /* @__PURE__ */ new Map();
    for (const a of list) {
      const r = await hc(["get", a.address, "--json"]).catch(() => null);
      let info = null;
      try {
        info = r && r.code === 0 ? JSON.parse(r.stdout) : null;
      } catch {
        info = null;
      }
      const prev = this.context.get(a.address);
      if (prev && !keepEntry(prev, info)) {
        this.context.delete(a.address);
        cx.notify();
      }
      const pid = info?.foreground?.pid;
      const record = typeof pid === "number" ? await readTextFile(root + "/.claude/sessions/" + pid + ".json").catch(() => null) : null;
      const e = contextEntry(info, record, cache, now);
      if (e) next.set(a.address, { ...e, sig: sigOf(a) });
    }
    return next;
  }
  // One read at a time; a request meanwhile runs once more after it. Entries for agents that
  // left the list or changed program are dropped before the read; any failure clears them all.
  refreshContext(cx) {
    const key = claudeKey(agents());
    if (key !== this.contextKey) {
      const now = new Map(agents().filter(isLocalClaude).map((a) => [a.address, sigOf(a)]));
      for (const [addr, e] of this.context) if (now.get(addr) !== e.sig) this.context.delete(addr);
      cx.notify();
    }
    this.contextKey = key;
    if (this.fetching) {
      this.again = true;
      return;
    }
    this.fetching = true;
    cx.spawn(async (cx2) => {
      try {
        do {
          this.again = false;
          const next = await this.readContext(cx2);
          const same = next.size === this.context.size && [...next].every(([k, v]) => this.context.has(k) && sameEntry(this.context.get(k), v));
          this.context = next;
          if (!same) cx2.notify();
        } while (this.again);
      } catch (e) {
        console.log(`dock-agents: context read failed: ${e}`);
        this.context = /* @__PURE__ */ new Map();
        cx2.notify();
      } finally {
        this.fetching = false;
      }
    });
  }
  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 864e5) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }
  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }
  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }
  rank(a) {
    return RANK[a.status] ?? 0;
  }
  sortMenu(t) {
    const on = sortOf().id;
    return v_flex2().w_full().p(5).bg(t.popover).text_size(12.8).child(div3().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents")).children(SORTS.map((s) => h_flex().id(`sort-${s.id}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).hover((el) => el.bg(t.hover)).on_click(() => {
      setShared3("agents.sort", s.id);
      closeOverlay(props().overlay);
    }).child(svg3(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted)).child(div3().flex_1().child(s.label)).when(s.id === on, (el) => el.child(svg3("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }
  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }
  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "\u2514" : "\u251C"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "\u2502"])
      ];
    });
  }
  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = agentIcon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex().id(`sub-${k.address}`).pl(39).pr(8).rounded(8).h(26).flex_none().gap(0).items_center().text_size(12.5).when(on, (el) => el.bg(t.raised)).hover((s2) => s2.bg(t.hover)).on_click(() => this.listed.has(k.address) ? (showTerminal(), run("pane.focus", { terminal: k.address })) : this.peek(k.address)).children(s.lines.map((l) => div3().self_start().mt(-4).w(9).h(17).mr(4).flex_none().when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input)).when(l === "\u2514" || l === "\u251C", (el) => el.border_b(1.5).rounded_bl(6)))).when(Boolean(pic), (el) => el.child(div3().mr(8).child(pic))).child(div3().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address)).child(this.status(t, { status: st }, compact));
  }
  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    return agentStatus(t, a, compact);
  }
  // The "Agents" header with the sort button (the sort menu opens on this mod). `onTitle`
  // (collapsed): the title takes focus, and the row is 31 px instead of 41 so it fits the
  // 32 px collapsed block.
  header(t, sort, onTitle) {
    const title2 = div3().text_size(11.5).font_medium().text_color(t.dim).child("Agents");
    return h_flex().px(16).h(onTitle ? 31 : 41).pt(onTitle ? 0 : 14).pb(onTitle ? 0 : 5).flex_none().items_center().justify_between().child(onTitle ? title2.id("dock-agents-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Agents").on_click(() => onTitle()) : title2).child(
      div3().id("ag-sort").text_size(11).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(() => openOverlay({ mod: "dock-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } })).tooltip(`Sort agents: ${sort.label}`).child(svg3(`mods/workspace-chrome/${sort.icon}.svg`).size(14))
    );
  }
  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = /* @__PURE__ */ new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));
    const myId = props()?.dockFeature ?? "dock-agents";
    const face = featureMode(shared2("dock.left.mode"), shared2("dock.left.focus"), myId, props()?.dockRegion);
    if (face === "icon") return iconRail(t, "mods/dock-agents/icon.svg", "Agents", () => requestFocus(myId));
    if (face === "collapsed") {
      return v_flex2().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).child(this.header(t, sort, () => requestFocus(myId)));
    }
    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => (RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m, null);
      const open = !this.folded.has(a.address);
      return div3().id(`fold-${a.address}`).h(18).px(3).gap(3).flex().items_center().rounded(4).text_size(11).text_color(open ? t.dim : t[top] ?? t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx2) => {
        cx2.stop_propagation();
        open ? this.folded.add(a.address) : this.folded.delete(a.address);
        cx2.notify();
      }).child(svg3(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none()).when(!open, (el) => el.child(String(subs.length)));
    };
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const labels = new Map(list.map((a) => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : a.title || a.program?.name || ""];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map((a) => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) {
      const k = `${a.space_name}\0${detail.get(a.address) ?? ""}`;
      seen[k] = (seen[k] ?? 0) + 1;
    }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\0`] > 1) detail.set(a.address, label(a));
    }
    const row = (a, i, subs = []) => {
      const pic = agentIcon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      const ctx = this.contextFor(a);
      if (collapsed) {
        return h_flex().id(`ag-${a.address}`).h(26).px(8).flex_none().items_center().gap(4).hover((s) => s.bg(t.hover)).on_click(() => {
          showTerminal();
          run("pane.focus", { pane: a.pane });
        }).child(div3().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1))).child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div3().id(`pin-${a.address}`).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(isPinned ? "Unpin" : "Pin to the top").on_click((_e, cx2) => {
        cx2.stop_propagation();
        run("terminal.pin", { terminal: a.address, pinned: !isPinned });
        this.hovered = null;
        cx2.notify();
      }).child(svg3(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex().id(`ag-${a.address}`).px(8).h(30).flex_none().rounded(8).items_center().gap(9).when(a.focused, (el) => el.bg(t.selected)).cursor_pointer().hover((s) => s.bg(t.hover)).on_hover((on, cx2) => {
        if (on) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx2.notify();
      }).on_click(() => {
        showTerminal();
        run("pane.focus", { pane: a.pane });
      }).when(Boolean(pic), (el) => el.child(div3().id(`agent-fold-${a.address}`).when(subs.length > 0, (el2) => el2.on_click((_e, cx2) => {
        cx2.stop_propagation();
        this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
        cx2.notify();
      })).child(pic))).child(h_flex().flex_1().min_w(0).gap(5).items_center().child(div3().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name)).when(full && Boolean(more), (el) => el.child(div3().flex_1().min_w(0).truncate().text_color(t.dim).child(`\xB7 ${more}`))).when(Boolean(ctx), (el) => el.child(div3().id(`ctx-${a.address}`).flex_none().text_size(11).text_color(t.dim).tooltip(contextTooltip(ctx, now)).when(ctx.stale, (el2) => el2.opacity(0.55)).child(formatPercent(ctx.usedPercent))))).when(Boolean(machine), (el) => el.child(div3().text_size(10).text_color(t.dim).child(machine))).when(subs.length > 0, (el) => el.child(fold(a, subs))).when(this.hovered === a.address, (el) => el.child(pin)).when(this.hovered !== a.address && Boolean(when), (el) => el.child(div3().flex_none().text_size(11).text_color(t.dim).child(duration(now - when)))).child(this.status(t, a, byPriority && !isPinned));
    };
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => (RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m, null);
      return h_flex().id(g.id).px(8).pt(8).h(30).flex_none().gap(6).items_center().text_size(11).font_medium().cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx2) => {
        open ? this.folded.add(g.id) : this.folded.delete(g.id);
        cx2.notify();
      }).child(div3().truncate().text_color(t[g.status] ?? t.dim).child(g.label)).when(byPriority || !open, (el) => el.child(div3().text_color(t.dim).child(String(g.members.length)))).child(div3().flex_1()).when(!open, (el) => el.when(!byPriority && top && top !== "idle", (el2) => el2.child(this.status(t, { status: top }, true))).child(svg3("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed ? list.flatMap(withKids) : groups.flatMap((g) => [header(g), ...this.folded.has(g.id) ? [] : g.members.flatMap(withKids)]);
    return v_flex2().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).when(!collapsed, (el) => el.child(this.header(t, sort, null))).when(
      list.length === 0 && !collapsed,
      (el) => el.child(div3().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not."))
    ).child(v_flex2().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows));
  }
};
export {
  Agents as default
};
