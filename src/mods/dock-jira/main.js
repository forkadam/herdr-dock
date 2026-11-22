// The Jira page: the company's self-hosted Jira (Server / Data Center) as a dock page. Your issues and filters as a
// list or a board, an issue's detail beside them. Connects with a personal access token kept in a private file
// (src/shared/jira/store.js); requests go through Herdr's fetch or curl (src/shared/jira/client.js). Everything that
// decides something is pure and tested under src/shared/jira/; this file draws and keeps state.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, Popover } from "gpui-base";
import { appHome, checking, exec, nextCommand, props, readTextFile, run, setShared, shared, theme, window, writeTextFile } from "herdr";
import { pageShown, showTerminal } from "../_page.js";
import { createClient } from "../../shared/jira/client.js";
import { withSearch } from "../../shared/jira/jql.js";
import { ago, boardColumns, groupByCategory, issueDetail, issueRow, latestOnly } from "../../shared/jira/model.js";
import {
  CLEARED_VIEW, PAGE_SIZE, actionOutcome, afterProblem, badgeFor, canAssignToMe, commentReady, countText, filterList, needsDetail,
  boardProjects, dragColumns, keepMoved, stepFields, stepNeeds, dragStarted, dropPlan, dropTargets, pageState, refusedDropText, unionStatuses, pickFilter, pollDue, previewTask, refreshSize, startWork, withComment,
} from "../../shared/jira/page.js";
import { normalizeBaseUrl, siteName } from "../../shared/jira/settings.js";
import { clearToken, loadJira, saveSettings, saveToken, syncCurlConfig } from "../../shared/jira/store.js";
import { openUrlCommand } from "../../shared/platform.js";
import { slashPath } from "../../shared/path.js";

const MOD = "dock-jira";
const BADGE_KEY = `dock.page.badge.${MOD}`;
const VIEW_KEY = "dock.jira.view";
const FILTER_KEY = "dock.jira.filter";
const TICK_MS = 30000;
const DETAIL_W = 420;
const WARN = "#d29922";
// Problems that mean "can't talk to Jira at all" (the whole page says so), versus ones about one request.
const PAGE_PROBLEMS = ["auth", "forbidden", "offline", "tls", "timeout", "server", "nocurl", "unknown"];
const TYPE_COLOR = (t, type) => ({ Bug: t.blocked, Story: t.done, Epic: "#8b5cf6" })[type] ?? t.accent;

export default class Jira extends View {
  init(_props, cx) {
    this.site = siteName(props()?.site);
    this.jira = null; // loadJira(): { paths, settings, settingsText, token, problem }
    this.me = null;
    this.connected = false;
    this.checkingNow = false;
    this.problem = null; // page-level: can't talk to Jira
    this.editing = false; // the Settings form, opened by hand
    this.formError = null;
    this.formBusy = false;
    this.favourites = [];
    this.statusOrder = []; // Jira's statuses in its own order (board columns)
    this.projectStatuses = new Map(); // project key -> its workflow's statuses [{ name, category }], or "loading"
    this.query = "";
    this.rows = [];
    this.total = undefined;
    this.listLoading = false;
    this.listProblem = null; // about this filter only (bad JQL)
    this.fetchedAt = null;
    this.lastPollAt = undefined;
    this.pollFailed = false;
    this.paused = false; // after a rejected token: no polling until the user acts (afterProblem)
    this.selected = null;
    this.detail = null;
    this.detailLoading = false;
    this.detailProblem = null;
    this.filterOpen = false;
    this.seq = latestOnly();
    this.detailSeq = latestOnly();
    // Actions on the open issue.
    this.transOpen = false;
    this.transitions = null; // null (not asked), "loading", [transition], or { problem }
    this.actionBusy = null; // "transition" | "assign" | "comment" while one runs
    this.actionMsg = null; // actionOutcome(): { ok, message, link? }
    // Board drag and drop: a press on a card, the drag once it moved, and a choice when several moves lead there.
    this.press = null; // { row, from: Point }
    this.drag = null; // { row, transitions: "loading" | [..] | { problem }, targets: Set, over: status | null, at: Point | null }
    this.dropChoice = null; // { row, status, transitions }: shown in the column dropped on
    this.dropNote = null; // { status, text }: why a drop on a dimmed column did nothing, in that column
    this.pendingStep = null; // { key, tr, field, url }: a move waiting for a value (Resolution), in the detail pane
    this.moved = new Map(); // key -> the row as moved: kept on the board in its new status until the filter changes

    this.searchInput = InputState.new({ placeholder: "Search this filter…" });
    this.searchInput.on("submit", (_e, cx) => { this.query = this.searchInput.value().trim(); this.moved = new Map(); this.refresh(cx); });
    this.urlInput = InputState.new({ placeholder: "https://jira.example.com" });
    this.tokenInput = InputState.new({ placeholder: "Personal access token" });
    this.tokenInput.set_masked(true);
    this.taskInput = InputState.new({ placeholder: "Work on Jira issue {key}: {summary}\\n{url}" });
    this.caInput = InputState.new({ placeholder: "Optional: path to the company CA file (curl)" });
    // A one-line box, as Herdr's own prompt uses: TextareaState.value() came back empty in Herdr (typed text never
    // reached Send). Enter sends.
    this.commentInput = InputState.new({ placeholder: "Add a comment… (Enter sends)" });
    this.commentInput.on("submit", (_e, cx) => this.sendComment(cx));
    for (const input of [this.urlInput, this.tokenInput, this.taskInput, this.caInput]) input.on("submit", (_e, cx) => this.saveForm(cx));
    this.taskInput.on("change", (_e, cx) => cx.notify()); // the preview follows the typing
    this.transportChoice = "fetch";

    if (checking()) return;
    cx.spawn(async (cx) => {
      await this.load();
      cx.notify();
      if (this.jira.settings.baseUrl && this.jira.token) await this.connect(cx);
    });
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try { this.command(c, cx); } catch (e) { console.log(`dock-jira: command ${c} failed: ${e?.message ?? e}`); }
        cx.notify();
      }
    });
  }

  // Commands (keys.json can bind them: "dock-jira.next"): list, board, refresh, settings, next, prev, close, and on
  // the open issue: status (its status menu), assign (to me), comment (the cursor into the comment box), start (Start work).
  command(c, cx) {
    if (c === "status") { if (this.detail) this.openTransitions(!this.transOpen, cx); return; }
    if (c === "assign") { if (canAssignToMe(this.detail, this.me)) this.assignMe(cx); return; }
    if (c === "comment") { if (this.detail) this.commentInput.focus(); return; }
    if (c === "start") { if (this.detail) this.startWork(this.detail, cx); return; }
    if (c === "list" || c === "board") setShared(VIEW_KEY, c);
    else if (c === "refresh") cx.spawn(async (cx) => this.reload(cx));
    else if (c === "settings") this.openSettings(cx);
    else if (c === "close") { if (this.editing) { this.editing = false; this.formError = null; } else { this.selected = null; this.detail = null; } }
    else if (c === "next" || c === "prev") {
      const order = this.visibleOrder();
      if (!order.length) return;
      const i = order.indexOf(this.selected);
      const j = i < 0 ? (c === "next" ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, i + (c === "next" ? 1 : -1)));
      this.select(order[j], cx);
    }
  }

  // Issue keys in the order they're drawn (by group in the list, by column on the board).
  visibleOrder() {
    const rows = this.shownRows();
    const parts = shared(VIEW_KEY) === "board" ? boardColumns(rows, this.statusOrder, this.boardStatuses()) : groupByCategory(rows);
    return parts.flatMap((p) => p.rows.map((r) => r.key));
  }

  // ---- data ----

  io() {
    return { appHome: slashPath(appHome()), platform: window()?.platform, readTextFile, writeTextFile, exec };
  }

  async load() {
    this.jira = await loadJira(this.io(), this.site);
    const s = this.jira.settings;
    this.urlInput.set_value(s.baseUrl);
    this.taskInput.set_value(s.startTask);
    this.caInput.set_value(s.caFile);
    this.transportChoice = s.transport;
  }

  client(cx) {
    const { settings, token, paths } = this.jira;
    return createClient({
      base: settings.baseUrl, transport: settings.transport, token, curlConfigPath: paths.curlConfigPath, curlBodyPath: paths.bodyPath,
      caFile: settings.caFile || undefined,
      io: { fetch: (u, o) => fetch(u, o), exec, sleep: (ms) => cx.sleep(ms), readTextFile, writeTextFile },
    });
  }

  filters() { return filterList(this.favourites, this.jira?.settings.filters); }
  filter() { return pickFilter(this.filters(), shared(FILTER_KEY)); }

  // First contact: who am I, then the favourites and the list.
  async connect(cx) {
    this.checkingNow = true;
    this.problem = null;
    this.paused = false;
    cx.notify();
    // curl reads the token from its own file: make sure it's the token the page has.
    if (this.jira.settings.transport === "curl") {
      const sync = await syncCurlConfig(this.io(), this.site, this.jira.token);
      if (!sync.ok) console.log(`dock-jira: ${sync.error}`);
    }
    const me = await this.client(cx).myself();
    this.checkingNow = false;
    if (!me.ok) {
      this.problem = me.problem;
      this.connected = false;
      this.paused = afterProblem(me.problem.kind).pause;
      this.lastPollAt = Date.now();
      this.pollFailed = true;
      setShared(BADGE_KEY, null);
      cx.notify();
      return;
    }
    this.me = me.data;
    this.connected = true;
    const favs = await this.client(cx).favouriteFilters();
    this.favourites = favs.ok ? favs.data : [];
    const statuses = await this.client(cx).statuses();
    this.statusOrder = statuses.ok ? statuses.data.map((x) => x.name) : [];
    await this.refresh(cx);
  }

  // Refresh by hand: connect again when not connected (or after a problem), else the list and the open issue.
  async reload(cx) {
    if (!this.jira?.settings.baseUrl || !this.jira.token) return;
    if (!this.connected || this.problem) { await this.connect(cx); return; }
    await this.refresh(cx);
    if (this.selected) await this.loadDetail(cx, this.selected);
  }

  // The list for the chosen filter (and search), and the badge. The newest search wins.
  async refresh(cx, { more = false } = {}) {
    if (!this.connected || !this.jira) return;
    const seq = this.seq.next();
    const f = this.filter();
    const jql = withSearch(f.jql, this.query);
    this.listLoading = true;
    cx.notify();
    // A plain refresh asks for as many as are listed, so Load more's rows survive a poll or an action.
    const r = await this.client(cx).search(jql, { startAt: more ? this.rows.length : 0, maxResults: more ? PAGE_SIZE : refreshSize(this.rows.length) });
    if (!this.seq.accept(seq)) return;
    this.listLoading = false;
    this.lastPollAt = Date.now();
    this.pollFailed = !r.ok;
    if (!r.ok) {
      if (PAGE_PROBLEMS.includes(r.problem.kind)) {
        const effect = afterProblem(r.problem.kind);
        this.problem = r.problem;
        this.connected = effect.connected;
        this.paused = effect.pause;
        if (effect.clearBadge) setShared(BADGE_KEY, null);
      }
      else this.listProblem = r.problem;
      cx.notify();
      return;
    }
    const base = this.jira.settings.baseUrl;
    const rows = (r.data?.issues ?? []).map((i) => issueRow(i, base));
    this.rows = more ? [...this.rows, ...rows] : rows;
    this.total = r.data?.total;
    this.fetchedAt = Date.now();
    this.listProblem = null;
    this.problem = null;
    cx.notify();
    await this.loadProjectStatuses(cx);
    await this.updateBadge(cx, f);
  }

  // The workflow statuses of each project on the board, asked once per project (the board shows them all as columns,
  // empty ones too). A failure leaves that project out: its columns then come from its issues, as before.
  async loadProjectStatuses(cx) {
    for (const key of boardProjects(this.rows)) {
      if (this.projectStatuses.has(key)) continue;
      this.projectStatuses.set(key, "loading");
      const r = await this.client(cx).projectStatuses(key);
      this.projectStatuses.set(key, r.ok ? r.data : []);
      cx.notify();
    }
  }

  boardStatuses() {
    return unionStatuses(boardProjects(this.rows).map((k) => this.projectStatuses.get(k)));
  }

  // How many issues are assigned to me and unresolved: free when that's the filter shown, else one count query.
  async updateBadge(cx, f) {
    if (f.id === "mine" && !this.query) { setShared(BADGE_KEY, badgeFor(this.total)); return; }
    const r = await this.client(cx).search(pickFilter(this.filters(), "mine").jql, { maxResults: 0 });
    if (r.ok) setShared(BADGE_KEY, badgeFor(r.data?.total));
  }

  tick(cx) {
    if (!this.jira || this.editing || this.checkingNow || this.paused) return;
    const shown = pageShown(MOD);
    if (!pollDue({ shown, lastAt: this.lastPollAt, failed: this.pollFailed, now: Date.now() })) return;
    cx.spawn(async (cx) => {
      if (!this.connected && this.jira.settings.baseUrl && this.jira.token) await this.connect(cx);
      else await this.refresh(cx);
      if (this.selected && shown) await this.loadDetail(cx, this.selected);
    });
  }

  select(key, cx) {
    if (key !== this.selected) {
      this.actionMsg = null;
      this.pendingStep = null;
      this.transitions = null;
      this.transOpen = false;
      this.commentInput.set_value("");
    }
    this.selected = key;
    this.detail = null;
    this.detailProblem = null;
    cx.spawn(async (cx) => this.loadDetail(cx, key));
  }

  async loadDetail(cx, key) {
    const seq = this.detailSeq.next();
    this.detailLoading = true;
    cx.notify();
    const r = await this.client(cx).issue(key);
    if (!this.detailSeq.accept(seq) || this.selected !== key) return;
    this.detailLoading = false;
    if (r.ok) { this.detail = issueDetail(r.data, this.jira.settings.baseUrl); this.detailProblem = null; }
    else this.detailProblem = r.problem;
    cx.notify();
  }

  // ---- actions (each guarded: one at a time, and its answer applied only to the issue it was for) ----

  openTransitions(open, cx) {
    this.transOpen = open;
    if (!open || !this.selected) { cx.notify(); return; }
    const key = this.selected;
    this.transitions = "loading";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await this.client(cx).transitions(key);
      if (this.selected !== key) return;
      this.transitions = r.ok ? r.data : { problem: r.problem };
      cx.notify();
    });
  }

  run(kind, cx, call, extra, after) {
    if (this.actionBusy || !this.selected) return;
    const key = this.selected;
    this.actionBusy = kind;
    this.actionMsg = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let r;
      try { r = await call(this.client(cx), key); } finally { this.actionBusy = null; }
      if (this.selected !== key) return;
      this.actionMsg = actionOutcome(kind, r, extra);
      cx.notify();
      if (r.ok) await after(cx, key, r);
    });
  }

  // A move: run at once, or first ask for the one value its step requires (a Resolution, from Jira's allowed values),
  // or send the user to Jira for anything more. `fields`: the value picked, when asked.
  doTransition(tr, cx, url = this.detail?.url, fields) {
    this.transOpen = false;
    this.transitions = null;
    this.pendingStep = null;
    const needs = fields ? { kind: "none" } : stepNeeds(tr);
    if (needs.kind === "pick") {
      this.actionMsg = null;
      this.pendingStep = { key: this.selected, tr, field: needs.fields[0], url };
      cx.notify();
      return;
    }
    if (needs.kind === "browser") {
      this.actionMsg = { ok: false, message: `${tr.name} needs ${needs.names.join(", ")}: do this step in Jira.`, link: url };
      cx.notify();
      return;
    }
    this.run("transition", cx, (c, key) => c.transition(key, tr.id, fields), { to: tr.to?.name ?? tr.name, url },
      async (cx, key) => {
        // Keep the card where it went, even if the filter no longer lists it (a move to Done out of "unresolved").
        const row = this.shownRows().find((r) => r.key === key);
        if (row) this.moved.set(key, { ...row, status: tr.to?.name ?? row.status, category: tr.to?.statusCategory?.key ?? row.category });
        await this.loadDetail(cx, key);
        await this.refresh(cx);
      });
  }

  shownRows() { return keepMoved(this.rows, this.moved); }

  assignMe(cx) {
    if (!this.me?.name) return;
    this.run("assign", cx, (c, key) => c.assign(key, this.me.name), {},
      async (cx, key) => { await this.loadDetail(cx, key); await this.refresh(cx); });
  }

  sendComment(cx) {
    const text = this.commentInput.value();
    if (!commentReady(text) || this.actionBusy) return;
    this.run("comment", cx, (c, key) => c.comment(key, text.trim()), {}, async (cx, _key, r) => {
      if (this.detail && r.data) this.detail = withComment(this.detail, r.data);
      this.commentInput.set_value("");
      cx.notify();
      await this.refresh(cx); // its "updated" time moved
    });
  }

  // ---- board drag and drop ----
  // A press on a card becomes a drag once the pointer moves a few pixels (a click still opens the issue). The drag
  // asks Jira which moves this issue has (its workflow, for this user, now); those columns light up, others dim, and
  // a reachable status with no column yet gets an empty one. Releasing over a lit column runs its move (or asks
  // which, when several lead there); anywhere else does nothing.

  pointerMoved(e, cx) {
    if (this.drag) {
      this.drag.at = e.local_position;
      cx.notify();
      return;
    }
    if (!this.press || !dragStarted(this.press.from, e.position)) return;
    const row = this.press.row;
    this.press = null;
    this.dropChoice = null;
    this.dropNote = null;
    this.drag = { row, transitions: "loading", targets: new Set(), over: null, hover: null, at: e.local_position };
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await this.client(cx).transitions(row.key);
      if (this.drag?.row.key !== row.key) return;
      this.drag.transitions = r.ok ? r.data : { problem: r.problem };
      this.drag.targets = r.ok ? dropTargets(r.data, row.status) : new Set();
      cx.notify();
    });
  }

  released(cx) {
    this.press = null;
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    cx.notify();
    if (!drag.over) {
      // Released over a dimmed column: say why there, rather than nothing at all.
      if (drag.hover && drag.hover !== drag.row.status && Array.isArray(drag.transitions)) {
        this.dropNote = { status: drag.hover, text: refusedDropText(drag.row.key, drag.row.status, drag.hover, drag.targets) };
      }
      return;
    }
    const plan = dropPlan(drag.transitions, drag.over, drag.row.status);
    if (plan.kind === "run") this.moveCard(drag.row, plan.transition, cx);
    else if (plan.kind === "choose") this.dropChoice = { row: drag.row, status: drag.over, transitions: plan.transitions };
  }

  // The move runs like one picked in the status menu, with the issue opened beside the board to show the result.
  // A drop's move that needs a value (Resolution) asks for it right there in the column, before opening anything.
  moveCard(row, tr, cx, fields) {
    const needs = fields ? { kind: "none" } : stepNeeds(tr);
    if (needs.kind === "pick") {
      this.dropChoice = { row, status: tr.to?.name, transitions: [tr], step: { tr, field: needs.fields[0] } };
      cx.notify();
      return;
    }
    this.dropChoice = null;
    if (this.selected !== row.key) this.select(row.key, cx);
    this.doTransition(tr, cx, row.url, fields);
  }

  // Start work: a Claude tab named after the issue, with the user's message; then the terminal comes to the front.
  // From a list row, a template that uses {description} first fetches the full issue (rows don't carry it).
  startWork(issue, cx) {
    const template = this.jira?.settings.startTask;
    if (issue && !("description" in issue) && needsDetail(template)) {
      if (this.detail?.key === issue.key) { this.startWork(this.detail, cx); return; }
      cx.spawn(async (cx) => {
        const r = await this.client(cx).issue(issue.key);
        if (r.ok) this.startWork(issueDetail(r.data, this.jira.settings.baseUrl), cx);
        else { this.actionMsg = { ok: false, message: `Couldn't start ${issue.key}: ${r.problem.message}` }; cx.notify(); }
      });
      return;
    }
    const c = startWork(issue, template);
    if (!c) return;
    try { run(c.command, c.args); } catch (e) { this.actionMsg = { ok: false, message: `Couldn't open the tab: ${e?.message ?? e}` }; return; }
    showTerminal();
  }

  openUrl(url) {
    const c = openUrlCommand(window()?.platform, url);
    exec(c.command, c.args).catch((e) => console.log(`dock-jira: open failed: ${e}`));
  }

  // ---- settings ----

  openSettings(cx) {
    this.editing = true;
    this.formError = null;
    this.tokenInput.set_value("");
    if (this.jira) {
      this.urlInput.set_value(this.jira.settings.baseUrl);
      this.taskInput.set_value(this.jira.settings.startTask);
      this.caInput.set_value(this.jira.settings.caFile);
      this.transportChoice = this.jira.settings.transport;
    }
    cx.notify();
  }

  saveForm(cx) {
    if (this.formBusy || !this.jira) return;
    const url = normalizeBaseUrl(this.urlInput.value());
    if (!url.ok) { this.formError = url.error; cx.notify(); return; }
    const typed = this.tokenInput.value().trim();
    if (!typed && !this.jira.token) { this.formError = "Paste your personal access token."; cx.notify(); return; }
    this.formBusy = true;
    this.formError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const io = this.io();
        if (typed) {
          const t = await saveToken(io, this.site, typed);
          if (!t.ok) { this.formError = t.error; return; }
        }
        // Another Jira: forget the old one's issues, open issue and filters, so nothing asks the new site for them.
        if (url.url !== this.jira.settings.baseUrl) { Object.assign(this, JSON.parse(JSON.stringify(CLEARED_VIEW))); this.projectStatuses = new Map(); this.moved = new Map(); this.connected = false; setShared(BADGE_KEY, null); }
        const settings = { ...this.jira.settings, baseUrl: url.url, transport: this.transportChoice,
          startTask: this.taskInput.value(), caFile: this.caInput.value().trim() };
        const s = await saveSettings(io, this.site, settings, this.jira.settingsText ?? undefined);
        if (!s.ok) { this.formError = s.error; return; }
        await this.load();
        this.tokenInput.set_value("");
        this.editing = false;
        this.connected = false;
        await this.connect(cx);
      } finally {
        this.formBusy = false;
        cx.notify();
      }
    });
  }

  disconnect(cx) {
    cx.spawn(async (cx) => {
      const r = await clearToken(this.io(), this.site);
      if (!r.ok) this.formError = r.error;
      await this.load();
      Object.assign(this, JSON.parse(JSON.stringify(CLEARED_VIEW)), { connected: false, problem: null, paused: false, projectStatuses: new Map(), moved: new Map() });
      setShared(BADGE_KEY, null);
      cx.notify();
    });
  }

  useCurl(cx) {
    cx.spawn(async (cx) => {
      const s = await saveSettings(this.io(), this.site, { ...this.jira.settings, transport: "curl" }, this.jira.settingsText ?? undefined);
      if (!s.ok) { this.problem = { kind: "unknown", message: s.error, hint: "" }; cx.notify(); return; }
      await this.load();
      await this.connect(cx);
    });
  }

  // ---- drawing ----

  button(t, id, label, onClick, { primary = false, enabled = true, tip } = {}) {
    return h_flex().id(id).h(28).px(12).flex_none().items_center().rounded(7).text_size(12.5)
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.foreground))
      .when(enabled, (el) => el.cursor_pointer().on_click((_e, cx) => onClick(cx)).hover((s) => (primary ? s.opacity(0.9) : s.bg(t.hover))))
      .when(!enabled, (el) => el.opacity(0.45))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .child(label);
  }

  field(t, label, input, hint) {
    return v_flex().gap(5)
      .child(div().text_size(11.5).text_color(t.dim).child(label))
      .child(Input.new(input).h(34).px(10).rounded(8).border_1().border_color(t.input ?? t.border).bg(t.background).text_size(12.8).text_color(t.foreground))
      .when(Boolean(hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(hint)));
  }

  settingsForm(t, first) {
    const s = this.jira?.settings;
    const choice = (value, label) => h_flex().id(`jira-transport-${value}`).h(26).px(10).items_center().rounded(6).text_size(12)
      .cursor_pointer().on_click((_e, cx) => { this.transportChoice = value; cx.notify(); })
      .when(this.transportChoice === value, (el) => el.bg(t.raised ?? t.selected).border_1().border_color(t.border).text_color(t.foreground))
      .when(this.transportChoice !== value, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover)))
      .child(label);
    return v_flex().id("jira-settings").size_full().min_h(0).overflow_y_scrollbar().items_center().py(32).px(24)
      .child(v_flex().w_full().max_w(560).gap(16)
        .child(v_flex().gap(4)
          .child(div().text_size(18).font_semibold().child(first ? "Connect Jira" : "Jira settings"))
          .child(div().text_size(12.5).text_color(t.muted).child("Your company's Jira Server / Data Center, with a personal access token (Jira → Profile → Personal Access Tokens). Your Jira MCP's JIRA_URL and JIRA_PERSONAL_TOKEN work here.")))
        .child(this.field(t, "Jira address", this.urlInput, null))
        .child(this.field(t, this.jira?.token ? "Personal access token (saved; paste a new one to replace it)" : "Personal access token", this.tokenInput,
          `Kept only on this PC, in ${this.jira ? `herdr-dock/secrets/jira-${this.site}.token` : "a private file"}, readable by you alone.`))
        .child(v_flex().gap(5)
          .child(div().text_size(11.5).text_color(t.dim).child("Connection"))
          .child(h_flex().gap(4).p(2).rounded(8).bg(t.background).border_1().border_color(t.border).w_full().max_w(260)
            .child(choice("fetch", "Herdr (fetch)")).child(choice("curl", "curl")))
          .child(div().text_size(11).text_color(t.dim).child("Use curl if Jira's certificate isn't trusted by Herdr: curl uses this computer's certificates.")))
        .when(this.transportChoice === "curl", (el) => el.child(this.field(t, "Company CA file", this.caInput, "Only if curl doesn't trust Jira's certificate either.")))
        .child(this.field(t, "Start work message", this.taskInput, "What Claude gets first. {key} {summary} {url} {type} {status} {priority} {assignee} {description}; \\n for a new line. E.g. /init-ticket {key}"))
        .child(this.preview(t))
        .when(Boolean(this.formError), (el) => el.child(div().text_size(12.5).text_color(t.blocked).child(this.formError)))
        .child(h_flex().gap(8).pt(4)
          .child(this.button(t, "jira-save", this.formBusy ? "Connecting…" : first ? "Connect" : "Save", (cx) => this.saveForm(cx), { primary: true, enabled: !this.formBusy }))
          .when(!first, (el) => el.child(this.button(t, "jira-cancel", "Cancel", (cx) => { this.editing = false; this.formError = null; cx.notify(); })))
          .child(div().flex_1())
          .when(Boolean(this.jira?.token), (el) => el.child(this.button(t, "jira-disconnect", "Disconnect", (cx) => { this.editing = false; this.disconnect(cx); }, { tip: "Forget the token on this PC" }))))
        .when(Boolean(this.jira?.problem), (el) => el.child(div().text_size(11.5).text_color(WARN).child(this.jira.problem))));
  }

  // What Start work would send for the open issue (else the first one listed), as typed.
  preview(t) {
    const issue = this.detail ?? this.rows[0];
    if (!issue) return div();
    const text = previewTask(issue, this.taskInput.value());
    return v_flex().gap(4).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.border)
      .child(div().text_size(11).text_color(t.dim).child(`Preview for ${issue.key}`))
      .children(text.split("\n").map((l) => div().text_size(12).text_color(t.muted).child(l || " ")));
  }

  problemView(t) {
    const p = this.problem;
    return v_flex().size_full().items_center().justify_center().p(24)
      .child(v_flex().max_w(520).gap(10).items_center()
        .child(div().text_size(16).font_semibold().child(p.message.split(". ")[0].replace(/\.$/, "") + "."))
        .when(p.message.includes(". "), (el) => el.child(div().text_size(12.5).text_color(t.muted).child(p.message.slice(p.message.indexOf(". ") + 2))))
        .child(div().text_size(12.5).text_color(t.dim).child(p.hint ?? ""))
        .child(h_flex().gap(8).pt(8)
          .child(this.button(t, "jira-retry", "Try again", (cx) => cx.spawn(async (cx) => this.reload(cx)), { primary: true }))
          .when((p.kind === "tls" || p.kind === "offline") && this.jira?.settings.transport !== "curl", (el) => el.child(this.button(t, "jira-use-curl", "Switch to curl", (cx) => this.useCurl(cx))))
          .child(this.button(t, "jira-open-settings", p.kind === "auth" || p.kind === "forbidden" ? "Connect again" : "Settings", (cx) => this.openSettings(cx)))));
  }

  header(t) {
    const f = this.filter();
    const filters = this.filters();
    const view = shared(VIEW_KEY) === "board" ? "board" : "list";
    const host = (() => { try { return new URL(this.jira.settings.baseUrl).host; } catch { return ""; } })();
    const item = (x) => h_flex().id(`jira-filter-${x.id}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .bg(x.id === f.id ? t.selected : t.popover).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.filterOpen = false; setShared(FILTER_KEY, x.id); this.moved = new Map(); this.selected = null; this.detail = null; cx.spawn(async (cx) => this.refresh(cx)); })
      .child(div().flex_1().min_w(0).truncate().child(x.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(x.source === "favourite" ? "Jira" : x.source === "own" ? "mine" : ""));
    const picker = Popover.new("jira-filter").open(this.filterOpen)
      .on_open_change((open, cx) => { this.filterOpen = open; cx.notify(); })
      .trigger(h_flex().id("jira-filter-trigger").h(28).px(10).gap(6).items_center().rounded(7).border_1().border_color(t.border)
        .cursor_pointer().hover((s) => s.bg(t.hover)).text_size(12.5)
        .child(div().max_w(220).truncate().child(f.name)).child(svg("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim)))
      .content(v_flex().id("jira-filter-list").w(300).max_h(360).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover)
        .border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).children(filters.map(item)));
    const seg = (value, label) => h_flex().id(`jira-view-${value}`).h(24).px(9).items_center().rounded(5).text_size(12).cursor_pointer()
      .on_click(() => setShared(VIEW_KEY, value))
      .when(view === value, (el) => el.bg(t.raised ?? t.selected).text_color(t.foreground))
      .when(view !== value, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
      .child(label);
    const icon = (id, path, tip, onClick) => div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7)
      .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => onClick(cx)).child(svg(path).size(14));
    return h_flex().flex_none().h(52).px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(16).font_semibold().child("Jira"))
      .child(div().text_size(12).text_color(t.dim).max_w(180).truncate().child(host))
      .child(picker)
      .child(h_flex().id("jira-search").w(240).h(28).px(8).items_center().rounded(7).border_1().border_color(t.border).bg(t.background)
        .child(Input.new(this.searchInput).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
      .child(div().flex_1())
      .child(div().text_size(11.5).text_color(t.dim).child(this.listLoading ? "loading…" : this.fetchedAt ? `${countText(this.rows.length, this.total)} · updated ${ago(this.fetchedAt, Date.now())}` : ""))
      .child(h_flex().p(2).gap(2).rounded(7).border_1().border_color(t.border).child(seg("list", "List")).child(seg("board", "Board")))
      .child(icon("jira-refresh", "mods/dock-jira/refresh.svg", "Refresh", (cx) => cx.spawn(async (cx) => this.reload(cx))))
      .child(icon("jira-gear", "mods/workspace-chrome/settings.svg", "Jira settings", (cx) => this.openSettings(cx)));
  }

  typeMark(t, r) {
    return div().flex_none().size(8).rounded(2).bg(TYPE_COLOR(t, r.type)).tooltip(r.type ?? "issue");
  }

  row(t, r, i) {
    const on = this.selected === r.key;
    const hot = r.priority === "Highest" || r.priority === "High";
    return h_flex().id(`jira-row-${r.key}`).h(34).px(16).gap(10).flex_none().items_center().cursor_pointer()
      .bg(on ? t.selected : t.background).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.select(r.key, cx))
      .child(this.typeMark(t, r))
      .child(div().w(76).flex_none().text_size(12).text_color(t.dim).child(r.key))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(r.summary))
      .child(div().w(70).flex_none().truncate().text_size(11.5).text_color(hot ? WARN : t.dim).child(r.priority ?? ""))
      .child(div().w(110).flex_none().truncate().text_size(11.5).text_color(r.assignee ? t.muted : t.dim).child(r.assignee ?? "Unassigned"))
      .child(div().w(34).flex_none().text_size(11.5).text_color(t.dim).child(ago(r.updatedMs, Date.now())))
      .child(div().id(`jira-start-${r.key}`).size(24).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
        .hover((st) => st.bg(t.raised ?? t.hover).text_color(t.foreground)).tooltip(`Start work on ${r.key}: a Claude tab with\n${previewTask(r, this.jira?.settings.startTask)}`)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.startWork(r, cx); })
        .child(svg("mods/dock-jira/play.svg").size(11)));
  }

  more(t) {
    if (!Number.isFinite(this.total) || this.rows.length >= this.total) return null;
    return h_flex().px(16).py(10).child(this.button(t, "jira-more", `Load more (${this.total - this.rows.length} left)`,
      (cx) => cx.spawn(async (cx) => this.refresh(cx, { more: true })), { enabled: !this.listLoading }));
  }

  listView(t) {
    const groups = groupByCategory(this.shownRows());
    const more = this.more(t);
    return v_flex().id("jira-list").flex_1().min_w(0).min_h(0).overflow_y_scrollbar().pb(16)
      .children(groups.flatMap((g) => [
        h_flex().h(30).px(16).pt(8).gap(6).flex_none().items_center()
          .child(div().text_size(11.5).font_medium().text_color(t.muted).child(g.title))
          .child(div().text_size(11.5).text_color(t.dim).child(String(g.rows.length))),
        ...g.rows.map((r, i) => this.row(t, r, i)),
      ]))
      .when(Boolean(more), (el) => el.child(more));
  }

  card(t, r) {
    const on = this.selected === r.key;
    const dragged = this.drag?.row.key === r.key;
    return v_flex().id(`jira-card-${r.key}`).p(10).gap(6).flex_none().rounded(8).cursor_pointer()
      .bg(on ? t.selected : (t.surface ?? t.chrome)).border_1().border_color(on ? t.accent : t.border).hover((s) => s.bg(t.hover))
      .when(dragged, (el) => el.opacity(0.35))
      .on_mouse_down("left", (e) => { this.press = { row: r, from: e.position }; })
      .on_click((_e, cx) => { if (!this.drag) this.select(r.key, cx); })
      .child(div().text_size(12.8).text_color(t.foreground).child(r.summary))
      .child(h_flex().gap(6).items_center()
        .child(this.typeMark(t, r))
        .child(div().text_size(11.5).text_color(t.dim).child(r.key))
        .when(Boolean(r.priority), (el) => el.child(div().text_size(11).text_color(r.priority === "Highest" || r.priority === "High" ? WARN : t.dim).child(r.priority)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).max_w(110).truncate().child(r.assignee ?? "Unassigned")));
  }

  boardView(t) {
    const d = this.drag;
    const base = boardColumns(this.shownRows(), this.statusOrder, this.boardStatuses());
    const cols = d ? dragColumns(base, d.targets, Array.isArray(d.transitions) ? d.transitions : [], this.statusOrder) : base;
    const more = this.more(t);
    const column = (c, i) => {
      const own = d && c.status === d.row.status;
      const target = d && d.targets.has(c.status);
      const over = target && d.over === c.status;
      // Columns share the board's width (no gap on the right), down to 240px each; past that the board scrolls.
      return v_flex().id(`jira-col-${i}`).flex_1().min_w(240).min_h(0).rounded(10).border_1()
        .bg(over ? t.selected : t.chrome).border_color(target ? t.accent : t.border)
        .when(Boolean(d) && !own && !target, (el) => el.opacity(0.4))
        .on_mouse_move((_e, cx) => {
          if (!this.drag) return;
          this.drag.hover = c.status;
          if (this.drag.over !== (target ? c.status : null)) { this.drag.over = target ? c.status : null; cx.notify(); }
        })
        .child(h_flex().h(36).px(12).gap(6).flex_none().items_center()
          .child(div().text_size(12).font_medium().text_color(target ? t.foreground : t.muted).child(c.status))
          .child(div().text_size(11.5).text_color(t.dim).child(c.temporary ? "move here" : String(c.rows.length))))
        .child(v_flex().id(`jira-col-${i}-cards`).flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8).gap(6)
          .when(this.dropChoice?.status === c.status && !d, (el) => el.child(this.choiceBox(t)))
          .when(this.dropNote?.status === c.status && !d, (el) => el.child(this.noteBox(t)))
          .children(c.rows.map((r) => this.card(t, r))));
    };
    return v_flex().id("jira-board-wrap").relative().flex_1().min_w(0).min_h(0)
      .on_mouse_move((e, cx) => this.pointerMoved(e, cx))
      .on_mouse_up("left", (_e, cx) => this.released(cx))
      .child(div().id("jira-board").flex().flex_row().flex_1().min_h(0).overflow_x_scrollbar().p(12).gap(12).children(cols.map(column)))
      .when(Boolean(more), (el) => el.child(more))
      .when(Boolean(d), (el) => el.child(this.dragBar(t)))
      .when(Boolean(d?.at), (el) => el.child(div().absolute().left(d.at.x + 14).top(d.at.y + 14).w(240).p(10).rounded(8)
        .bg(t.surface ?? t.chrome).border_1().border_color(t.accent).opacity(0.92).text_size(12.5).text_color(t.foreground)
        .child(div().text_size(11).text_color(t.dim).child(d.row.key)).child(div().truncate().child(d.row.summary))));
  }

  // In the column dropped on, when several moves lead there: which one (Resolve or Close into Done, say).
  choiceBox(t) {
    const c = this.dropChoice;
    if (c.step) {
      const { tr, field } = c.step;
      return v_flex().id("jira-drop-choice").flex_none().p(10).gap(8).rounded(8).bg(t.selected).border_1().border_color(t.accent)
        .child(div().text_size(12.5).text_color(t.foreground).child(`${tr.name} ${c.row.key}: pick a ${field.name}`))
        .child(h_flex().gap(6).flex_wrap()
          .children(field.options.map((o) => this.button(t, `jira-drop-opt-${o.id ?? o.name}`, o.name, (cx) => this.moveCard(c.row, tr, cx, stepFields(field.key, o)), { primary: true })))
          .child(this.button(t, "jira-drop-cancel", "Cancel", (cx) => { this.dropChoice = null; cx.notify(); })));
    }
    return v_flex().id("jira-drop-choice").flex_none().p(10).gap(8).rounded(8).bg(t.selected).border_1().border_color(t.accent)
      .child(div().text_size(12.5).text_color(t.foreground).child(`Move ${c.row.key} here by:`))
      .child(h_flex().gap(6).flex_wrap()
        .children(c.transitions.map((tr) => this.button(t, `jira-drop-${tr.id}`, tr.name, (cx) => this.moveCard(c.row, tr, cx), { primary: true })))
        .child(this.button(t, "jira-drop-cancel", "Cancel", (cx) => { this.dropChoice = null; cx.notify(); })));
  }

  // In a dimmed column a card was dropped on: why nothing happened.
  noteBox(t) {
    return h_flex().id("jira-drop-note").flex_none().p(10).gap(8).items_start().rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(WARN)
      .child(div().flex_1().text_size(12).text_color(t.muted).child(this.dropNote.text))
      .child(div().id("jira-drop-note-x").size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
        .text_color(t.dim).hover((st) => st.bg(t.hover)).on_click((_e, cx) => { this.dropNote = null; cx.notify(); })
        .child(svg("mods/workspace-chrome/x.svg").size(11)));
  }

  // At the bottom of the board while dragging: what's happening.
  dragBar(t) {
    // Floats at the bottom of the board, so the columns don't move under the pointer when a drag starts.
    const bar = h_flex().absolute().bottom(12).left(12).h(38).px(14).gap(8).items_center().rounded(8)
      .bg(t.popover).border_1().border_color(t.border).text_size(12.5);
    const d = this.drag;
    const text = d.transitions === "loading" ? `Moving ${d.row.key}: asking Jira where it can go…`
      : d.transitions.problem ? `Can't move ${d.row.key}: ${d.transitions.problem.message}`
        : d.targets.size ? `Drop ${d.row.key} on a highlighted column (release elsewhere to cancel)` : `${d.row.key} has no moves from ${d.row.status}.`;
    return bar.child(div().text_color(d.transitions?.problem ? t.blocked : t.muted).child(text));
  }

  detailView(t) {
    const d = this.detail;
    const close = div().id("jira-detail-close").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close")
      .on_click((_e, cx) => { this.selected = null; this.detail = null; cx.notify(); })
      .child(svg("mods/workspace-chrome/x.svg").size(13));
    const pane = v_flex().id("jira-detail").w(DETAIL_W).flex_none().min_h(0).border_l(1).border_color(t.border).bg(t.background);
    const top = h_flex().h(44).px(16).gap(8).flex_none().items_center().border_b(1).border_color(t.border)
      .child(div().text_size(12.5).text_color(t.dim).child(this.selected)).child(div().flex_1()).child(close);
    if (!d) {
      return pane.child(top).child(div().p(16).text_size(12.5).text_color(this.detailProblem ? t.blocked : t.dim)
        .child(this.detailProblem ? `${this.detailProblem.message} ${this.detailProblem.hint}` : "Loading…"));
    }
    const lines = (text) => (text ? text.split("\n") : []).map((l) => (l.trim() ? div().child(l) : div().h(8)));
    const meta = (label, value) => h_flex().gap(8).child(div().w(70).flex_none().text_color(t.dim).child(label)).child(div().flex_1().min_w(0).truncate().child(value ?? "—"));
    return pane.child(top)
      .child(v_flex().id("jira-detail-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(14)
        .child(div().text_size(16).font_semibold().child(d.summary))
        .child(h_flex().gap(8).items_center()
          .child(this.statusMenu(t, d))
          .when(canAssignToMe(d, this.me), (el) => el.child(this.button(t, "jira-assign", this.actionBusy === "assign" ? "Assigning…" : "Assign to me",
            (cx) => this.assignMe(cx), { enabled: !this.actionBusy })))
          .child(div().flex_1())
          .child(this.button(t, "jira-start", "Start work", (cx) => this.startWork(d, cx), { primary: true, tip: `Opens a Claude tab with:\n${startWork(d, this.jira?.settings.startTask)?.args.task ?? ""}` }))
          .child(this.button(t, "jira-open", "Open in browser", () => this.openUrl(d.url))))
        .when(this.pendingStep?.key === d.key, (el) => el.child(this.stepBox(t)))
        .when(Boolean(this.actionMsg) || this.actionBusy === "transition", (el) => el.child(this.actionLine(t)))
        .child(v_flex().gap(4).text_size(12.5)
          .child(meta("Type", d.type)).child(meta("Priority", d.priority)).child(meta("Assignee", d.assignee ?? "Unassigned"))
          .child(meta("Reporter", d.reporter)).child(meta("Updated", d.updatedMs ? `${ago(d.updatedMs, Date.now())} ago` : null)))
        .child(v_flex().gap(4).text_size(12.8).text_color(t.foreground)
          .child(div().text_size(11.5).font_medium().text_color(t.muted).child("Description"))
          .children(d.description ? lines(d.description) : [div().text_color(t.dim).child("No description.")]))
        .when(d.links.length > 0, (el) => el.child(v_flex().gap(4).text_size(12.5)
          .child(div().text_size(11.5).font_medium().text_color(t.muted).child("Links"))
          .children(d.links.map((l, i) => h_flex().id(`jira-link-${i}`).gap(6).cursor_pointer().hover((s) => s.text_color(t.accent))
            .on_click(() => this.openUrl(l.url))
            .child(div().text_color(t.dim).child(l.label)).child(div().child(l.key))))))
        .child(v_flex().gap(10)
          .child(div().text_size(11.5).font_medium().text_color(t.muted)
            .child(d.commentTotal > d.comments.length ? `Comments · last ${d.comments.length} of ${d.commentTotal}` : `Comments · ${d.commentTotal}`))
          .children(d.comments.map((c) => v_flex().gap(3).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.border).text_size(12.5)
            .child(h_flex().gap(6).child(div().font_medium().child(c.author)).child(div().text_color(t.dim).child(c.createdMs ? ago(c.createdMs, Date.now()) : "")))
            .children(lines(c.bodyText))))
          .child(v_flex().gap(6)
            .child(div().rounded(8).border_1().border_color(t.border).bg(t.surface ?? t.chrome).px(10).py(8)
              .child(Input.new(this.commentInput).w_full().h(22).text_size(12.5).text_color(t.foreground)))
            .child(h_flex().gap(8).items_center()
              .child(div().flex_1().text_size(11).text_color(t.dim).child("Enter sends"))
              .child(this.button(t, "jira-comment-send", this.actionBusy === "comment" ? "Sending…" : "Send", (cx) => this.sendComment(cx),
                { primary: true, enabled: !this.actionBusy }))))));
  }

  // The status pill: a menu of the moves Jira allows from here (asked when it opens; workflows differ per issue).
  statusMenu(t, d) {
    const pill = h_flex().id("jira-status").h(24).px(8).gap(5).items_center().rounded(6).text_size(11.5).cursor_pointer()
      .bg(d.category === "done" ? t.done : d.category === "indeterminate" ? t.accent : t.border)
      .text_color(d.category === "new" ? t.foreground : t.accent_foreground ?? t.background)
      .hover((st) => st.opacity(0.85)).tooltip("Change status")
      .child(d.status ?? "").child(svg("mods/workspace-chrome/chevron-down.svg").size(11));
    const list = this.transitions;
    const rows = list === "loading" || list === null
      ? [div().p(8).text_color(t.dim).child("Asking Jira…")]
      : list.problem
        ? [div().p(8).text_color(t.blocked).child(`${list.problem.message} ${list.problem.hint}`)]
        : !list.length
          ? [div().p(8).text_color(t.dim).child("No moves from this status.")]
          : list.map((tr) => h_flex().id(`jira-tr-${tr.id}`).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer()
            .hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.doTransition(tr, cx))
            .child(div().flex_1().min_w(0).truncate().child(tr.name))
            .when(Boolean(tr.to?.name) && tr.to.name !== tr.name, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`→ ${tr.to.name}`))));
    return Popover.new("jira-status-menu").open(this.transOpen)
      .on_open_change((open, cx) => this.openTransitions(open, cx))
      .trigger(pill)
      .content(v_flex().id("jira-tr-list").w(260).max_h(320).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover)
        .border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).children(rows));
  }

  // A move from the status menu waiting for its one required value (a Resolution): Jira's choices as buttons.
  stepBox(t) {
    const { tr, field, url } = this.pendingStep;
    return v_flex().id("jira-step").p(10).gap(8).rounded(8).bg(t.selected).border_1().border_color(t.accent)
      .child(div().text_size(12.5).child(`${tr.name}: pick a ${field.name}`))
      .child(h_flex().gap(6).flex_wrap()
        .children(field.options.map((o) => this.button(t, `jira-step-opt-${o.id ?? o.name}`, o.name, (cx) => this.doTransition(tr, cx, url, stepFields(field.key, o)), { primary: true })))
        .child(this.button(t, "jira-step-cancel", "Cancel", (cx) => { this.pendingStep = null; cx.notify(); })));
  }

  // What the last action did, in place: green when it worked, red when not (with the browser link for a step
  // Jira wants more for).
  actionLine(t) {
    const m = this.actionMsg;
    if (!m) return div().text_size(12).text_color(t.dim).child("Moving…");
    return h_flex().gap(8).items_center().text_size(12)
      .child(div().flex_1().text_color(m.ok ? t.done : t.blocked).child(m.message))
      .when(Boolean(m.link), (el) => el.child(this.button(t, "jira-action-link", "Open in browser", () => this.openUrl(m.link))));
  }

  render() {
    const t = theme();
    const state = checking() || !this.jira ? "setup"
      : pageState({ settings: this.jira.settings, token: this.jira.token, editing: this.editing, connected: this.connected, problem: this.problem, checking: this.checkingNow });
    const root = v_flex().id("dock-jira").size_full().min_h(0).bg(t.background).text_color(t.foreground);
    if (state === "setup" || state === "settings") return root.child(this.settingsForm(t, state === "setup"));
    if (state === "problem") return root.child(this.problemView(t));
    if (state === "checking") {
      return root.child(v_flex().size_full().items_center().justify_center().gap(6)
        .child(div().text_size(14).child("Connecting to Jira…"))
        .child(div().text_size(12).text_color(t.dim).child(this.jira.settings.baseUrl)));
    }
    const view = shared(VIEW_KEY) === "board" ? "board" : "list";
    const body = this.listProblem
      ? v_flex().flex_1().p(24).gap(6).child(div().text_size(13).text_color(t.blocked).child(this.listProblem.message)).child(div().text_size(12).text_color(t.dim).child(this.listProblem.hint))
      : !this.rows.length && !this.listLoading
        ? v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(this.query ? `Nothing matches "${this.query}".` : "No issues in this filter.")
        : view === "board" ? this.boardView(t) : this.listView(t);
    return root.child(this.header(t))
      // A plain flex row (h_flex centers vertically): the list, board and detail fill the height.
      .child(div().flex().flex_row().flex_1().min_h(0).child(body).when(Boolean(this.selected), (el) => el.child(this.detailView(t))));
  }
}
