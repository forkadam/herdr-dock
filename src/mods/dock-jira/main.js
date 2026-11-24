// The Jira page: the company's self-hosted Jira (Server / Data Center) as a dock page. Your issues and filters as a
// list or a board; on Today the brief (brief-view.js) above the team's sprint board (sprint-view.js); an issue's
// detail beside them. Connects with a personal access token kept in a private file (src/shared/jira/store.js);
// requests go through Herdr's fetch or curl (src/shared/jira/client.js). Everything that decides something is pure and
// tested under src/shared/jira/; this file draws and keeps state.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, Popover, ScrollHandle } from "gpui-base";
import { appHome, checking, exec, nextCommand, props, readTextFile, run, setShared, shared, theme, window, writeTextFile } from "herdr";
import { pageShown, showTerminal } from "../_page.js";
import { createClient } from "../../shared/jira/client.js";
import {
  briefBadge, bugsSearch, changeDiff, changedItem, changedSearches, checkWork, historyPlan, isUnread, keySearches, newInSprintItem, pruneBugs,
  readAll, readOnOpen, recentEdits, sinceMinutes, subtasksByParent, withRead,
} from "../../shared/jira/brief.js";
import { ROW_FIELDS, withSearch } from "../../shared/jira/jql.js";
import { ago, boardColumns, issueDetail, issueRow, latestOnly } from "../../shared/jira/model.js";
import {
  CLEARED_VIEW, PAGE_SIZE, actionOutcome, afterProblem, canAssignToMe, commentReady, countFailure, countText, filterList, finishWork, keyColumnWidth, needsDetail,
  boardProjects, dragColumns, keepMoved, stepFields, stepNeeds, dragStarted, dropPlan, dropTargets, pageState, refusedDropText, workflowStatuses, pickFilter, pollDue, previewTask, REFRESH_CAP, refreshSize, startTemplate, startWork, tabButtonWork, todayFailure, withComment,
} from "../../shared/jira/page.js";
import { DEFAULT_HIGH_PRIORITIES, jiraOptions, normalizeBaseUrl, prioritiesText, settingsReload, siteName, withFormOptions } from "../../shared/jira/settings.js";
import { attentionNotLoaded, chipOf, chipWidth, severityFields, severityRow, tint } from "../../shared/jira/severity.js";
import { closedNeeded, columnDrop, laneCells, pickSprint, shownSprint, sprintCacheDue, sprintColumns, sprintJql, sprintMineJql, sprintRows } from "../../shared/jira/sprint.js";
import { clearToken, loadJira, saveSettings, saveToken, syncCurlConfig } from "../../shared/jira/store.js";
import {
  countsDue, keepAttention, listSections, pickTab, stepTab, tabAttentionJql, tabFilters, tabLayout, tabList, todayCount, withAttention,
} from "../../shared/jira/views.js";
import { openUrlCommand } from "../../shared/platform.js";
import { slashPath } from "../../shared/path.js";
import { briefView, changeView } from "./brief-view.js";
import { sprintBoard } from "./sprint-view.js";
import { tabBar } from "./tabs.js";

const MOD = "dock-jira";
const BADGE_KEY = `dock.page.badge.${MOD}`;
const VIEW_KEY = "dock.jira.view"; // the List / Board choice before tabs: a tab without its own choice starts from it
const TAB_KEY = "dock.jira.tab";
const LAYOUT_KEY = (id) => `dock.jira.layout.${id}`;
// The All tab's filter (its menu). A key of its own, not the one from before tabs (dock.jira.filter, picked when the
// page was one list): All starts on All my issues.
const FILTER_KEY = "dock.jira.filter.all";
const READ_KEY = "dock.jira.read"; // the brief's read marks (brief.js): { [key]: { changed?, sprint?, bug? } }
// Your unresolved issues, for the parents of your sub-tasks (the brief's Changed, and {mine} in Check against my work).
const SUBTASKS_JQL = "assignee = currentUser() AND resolution = Unresolved";
const TICK_MS = 30000;
const DETAIL_W = 420;
// Scroll handles made when the page starts: ScrollHandle.new() can't run while the page draws, and a tab's list can
// first be drawn before its settings are read. Enough for a few tabs' lists, boards and board columns.
const SCROLL_POOL = 64;
const WARN = "#d29922";
// Problems that mean "can't talk to Jira at all" (the whole page says so), versus ones about one request. Today's own
// requests go by todayFailure instead.
const PAGE_PROBLEMS = ["auth", "forbidden", "offline", "tls", "timeout", "server", "nocurl", "unknown"];
const TYPE_COLOR = (t, type) => ({ Bug: t.blocked, Story: t.done, Epic: "#8b5cf6" })[type] ?? t.accent;
// Today's sprint board with nothing read yet, for `board` (the settings' board id; null: none). `board` becomes
// { id, name } with the name once its configuration is read; `mine`: active sprint id -> how many of yours it holds;
// `picked`: the sprint picked in the menu (null: the current one); `cachedAt`: when the board's columns, statuses and
// sprints were read (refreshToday); `at`: when the shown sprint's issues were. `all` is the active and future sprints;
// `closed` the closed ones, null until read (readClosed: with the menu, or with no active sprint), with `closedAt`,
// `closedLoading` while they're read, and `closedProblem` when they couldn't be (the menu says it).
const blankSprint = (board) => ({
  board: board == null ? null : { id: board, name: null }, columns: [], active: [], all: [], mine: new Map(), current: null,
  shown: null, picked: null, rows: [], total: undefined, problem: null, at: null, cachedAt: null,
  closed: null, closedAt: null, closedLoading: false, closedProblem: null,
});
// Today's brief with nothing read yet: its Changed, New in sprint and High-priority bugs items (brief.js), when it was
// last built (`at`), the time it looks back to (`sinceMs`) and its failed search (`problem`, with the `part`: "changed"
// or "bugs").
const blankBrief = () => ({ changed: [], sprint: [], bugs: [], at: null, sinceMs: null, problem: null });
// Your sub-tasks by parent key (subtasksByParent), read with the board's cache (hourly, or on ⟳).
const blankSubtasks = () => ({ byParent: new Map(), cachedAt: null });

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
    // Tabs: jiraOptions(settings) (views, warnings…, refreshed on every load()), the shown tab's id (remembered in
    // TAB_KEY), each tab's list (state(id)), and the count on each tab.
    this.options = jiraOptions({});
    this.tabId = null;
    this.states = new Map();
    // tab id -> { total?, problem?, loading?, attention? }; `attention`: how many of a severity tab's tickets need
    // attention now (countAttention), kept across its other counts until its own search answers again.
    this.counts = new Map();
    // Today's sprint board (refreshToday; the tab's selection, loading and fetchedAt are in state("today")), its
    // sprint menu, the lanes folded by hand (parent key; "" is Other issues; while Herdr runs), and the column a card
    // was last dropped on there (its choice box or note shows in that column, in the card's lane).
    this.sprint = blankSprint(null);
    this.sprintOpen = false;
    // The board's closed sprints (readClosed): its newest read wins, and the read running (a promise, the menu's or a
    // refresh's; a refresh of Today starting waits for it).
    this.closedSeq = latestOnly();
    this.closedRead = null;
    this.collapsed = new Set();
    this.dropColumn = null;
    // Today's brief (refreshToday), when Today last refreshed (shown or not: another tab shown, it refreshes every
    // HIDDEN_EVERY_MS for the badge), and your sub-tasks by parent.
    this.brief = blankBrief();
    this.briefTried = undefined;
    this.subtasks = blankSubtasks();
    // The brief's Changed issues with their history, by key: { updated (Jira's, as the history was read), issue }. A
    // refresh reads again only the history of those new to its window or updated since (readBrief); ⟳ keeps it.
    this.histories = new Map();
    // The open issue's What changed (openChange: its unread Changed item and diff, kept while it stays open, so a poll
    // never changes what's being read; `full`: no folding) and Recent changes (toggleRecent: asked each time it opens).
    this.change = null; // { key, item, ops, full }
    this.recent = null; // { key, sinceMs, edits: "loading" | [{ at, author, from, to, ops }] | { problem }, full: Set }
    this.countsAt = undefined; // when the hidden tabs were last counted
    this.lastPollAt = undefined;
    this.pollFailed = false;
    this.paused = false; // after a rejected token: no polling until the user acts (afterProblem)
    this.detail = null;
    this.detailLoading = false;
    this.detailProblem = null;
    this.filterOpen = false;
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

    // Each tab's scroll positions (its list, its board, each board column), so switching back finds them where they
    // were: handles from the pool, given out by key as scrollers are first drawn ("<tab>/list", "<tab>/board",
    // "<tab>/col/<status>"). Past the pool's size a scroller keeps its own position, as it did before tabs.
    this.scrollPool = Array.from({ length: SCROLL_POOL }, () => ScrollHandle.new());
    this.scrolls = new Map();
    this.searchInput = InputState.new({ placeholder: "Search this filter…" });
    this.searchInput.on("submit", (_e, cx) => { const s = this.shown(); s.query = this.searchInput.value().trim(); s.moved = new Map(); this.refresh(cx); });
    this.urlInput = InputState.new({ placeholder: "https://jira.example.com" });
    this.tokenInput = InputState.new({ placeholder: "Personal access token" });
    this.tokenInput.set_masked(true);
    this.taskInput = InputState.new({ placeholder: "Work on Jira issue {key}: {summary}\\n{url}" });
    this.caInput = InputState.new({ placeholder: "Optional: path to the company CA file (curl)" });
    // Settings' Scrum board: the board picked ({ id, name }, null: none) and the scrum boards whose name holds what's
    // typed (null, "loading", [{ id, name }] or { problem }); the newest search wins. Enter picks the first.
    this.boardChoice = null;
    this.boardHits = null;
    this.boardSeq = latestOnly();
    this.boardInput = InputState.new({ placeholder: "Type part of the board's name" });
    this.boardInput.on("change", (_e, cx) => this.searchBoards(cx));
    this.boardInput.on("submit", (_e, cx) => { if (Array.isArray(this.boardHits) && this.boardHits.length) this.pickBoard(this.boardHits[0], cx); });
    this.prioInput = InputState.new({ placeholder: DEFAULT_HIGH_PRIORITIES.join(", ") });
    // A one-line box, as Herdr's own prompt uses: TextareaState.value() came back empty in Herdr (typed text never
    // reached Send). Enter sends.
    this.commentInput = InputState.new({ placeholder: "Add a comment… (Enter sends)" });
    this.commentInput.on("submit", (_e, cx) => this.sendComment(cx));
    for (const input of [this.urlInput, this.tokenInput, this.taskInput, this.caInput, this.prioInput]) input.on("submit", (_e, cx) => this.saveForm(cx));
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

  // Commands (keys.json can bind them: "dock-jira.next"): list, board, refresh, settings, next, prev, close, the tabs
  // (tab-next, tab-prev, tab-<id>), and on the open issue: status (its status menu), assign (to me), comment (the
  // cursor into the comment box), start (Start work), finish (Finish, when an action rule gives one).
  command(c, cx) {
    if (c === "status") { if (this.detail) this.openTransitions(!this.transOpen, cx); return; }
    if (c === "assign") { if (canAssignToMe(this.detail, this.me)) this.assignMe(cx); return; }
    if (c === "comment") { if (this.detail) this.commentInput.focus(); return; }
    if (c === "start") { if (this.detail) this.startWork(this.detail, cx); return; }
    if (c === "finish") { if (this.detail) this.finishWork(this.detail, cx); return; }
    if (c === "tab-next" || c === "tab-prev") { this.showTab(stepTab(this.tabs(), this.tab().id, c === "tab-next" ? 1 : -1), cx); return; }
    if (c.startsWith("tab-")) { const id = c.slice(4); if (this.tabs().some((x) => x.id === id)) this.showTab(id, cx); return; }
    if (c === "list" || c === "board") setShared(LAYOUT_KEY(this.tab().id), c);
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

  // Issue keys in the order they're drawn (by section and group in the list, the attention box's first, by column on
  // the board; on Today by lane, then column, leaving out folded lanes).
  visibleOrder() {
    if (this.tab().kind === "today") {
      const cols = this.sprint.columns;
      return sprintRows(this.sprint.rows).filter((l) => !this.collapsed.has(l.parent?.key ?? "")).flatMap((l) => laneCells(l, cols).flat()).map((r) => r.key);
    }
    const rows = this.shownRows();
    const list = () => { const { attention, sections } = listSections(rows, this.tab()); return [...(attention ?? []), ...sections].flatMap((s) => s.parts); };
    const parts = this.layout() === "board" ? boardColumns(rows, this.statusOrder, this.boardStatuses()) : list();
    return parts.flatMap((p) => p.rows.map((r) => r.key));
  }

  // ---- tabs ----

  // The tabs, left to right: Today (the brief, and the sprint board when the settings name a board), the user's views
  // (settings), Mine, All.
  tabs() { return tabList(this.options.views, { today: true }); }
  // The shown tab: the one picked, else the remembered one, else the first (a view may have left the settings).
  tab() { return pickTab(this.tabs(), this.tabId ?? shared(TAB_KEY)); }

  // A tab's list, kept while Herdr runs so switching back finds it as it was. `seq`: its newest search wins.
  // `moved`: key -> the row as moved, kept on the board in its new status until the tab's search changes.
  state(id) {
    if (!this.states.has(id)) {
      this.states.set(id, { rows: [], total: undefined, query: "", selected: null, fetchedAt: null, listProblem: null, loading: false, seq: latestOnly(), moved: new Map() });
    }
    return this.states.get(id);
  }
  shown() { return this.state(this.tab().id); }

  // The open issue is the shown tab's selection.
  get selected() { return this.shown().selected; }
  set selected(key) { this.shown().selected = key; }

  layout() { const id = this.tab().id; return tabLayout(shared(LAYOUT_KEY(id)), shared(VIEW_KEY)); }

  // A tab's scroller: its kept position (null once the pool is used up). No host call, so it is safe while drawing.
  scroll(key) {
    if (!this.scrolls.has(key)) this.scrolls.set(key, this.scrollPool.pop() ?? null);
    return this.scrolls.get(key);
  }
  // A tab whose list starts over (its search changed, another site): its scrollers go back to the top.
  scrollTop(id) {
    for (const [key, h] of this.scrolls) if (h && key.startsWith(`${id}/`)) h.scroll_to_item(0);
  }

  // What a tab searches (before its search text): All's is the filter picked in its menu.
  source(tab) { return tab.filters ? this.filter() : tab; }
  // What a tab searches for its tickets that need attention now (tabAttentionJql over its source, never its search
  // text); null: nothing (no severity, or no level asks for attention).
  attentionSearch(tab) { return tabAttentionJql(tab, this.source(tab).jql); }

  // Shows a tab as it was left: its search, rows, selection and open issue. Asks Jira again when it was never loaded
  // or its rows are older than a poll of the shown page.
  showTab(id, cx) {
    const before = this.selected;
    const tab = pickTab(this.tabs(), id);
    if (tab.id === this.tab().id) return;
    this.tabId = tab.id;
    setShared(TAB_KEY, tab.id);
    this.filterOpen = false;
    this.sprintOpen = false;
    this.press = null;
    this.drag = null;
    this.dropChoice = null;
    this.dropNote = null;
    const s = this.state(tab.id);
    this.searchInput.set_value(s.query);
    if (s.selected !== before) this.followSelection(cx);
    if (!s.loading && pollDue({ shown: true, lastAt: s.fetchedAt, failed: false, now: Date.now() })) cx.spawn(async (cx) => this.refresh(cx));
    else cx.spawn(async (cx) => this.loadProjectStatuses(cx));
    cx.notify();
  }

  // The issue pane after the tab changed: the new tab's own selection, its actions starting clean.
  followSelection(cx) {
    this.actionMsg = null;
    this.pendingStep = null;
    this.transitions = null;
    this.transOpen = false;
    this.commentInput.set_value("");
    this.detail = null;
    this.detailProblem = null;
    this.openChange(this.selected);
    const key = this.selected;
    if (key) this.updateMarks((marks) => readOnOpen(marks, this.brief, key));
    if (key) cx.spawn(async (cx) => this.loadDetail(cx, key));
  }

  // ---- data ----

  io() {
    return { appHome: slashPath(appHome()), platform: window()?.platform, readTextFile, writeTextFile, exec };
  }

  async load() {
    this.jira = await loadJira(this.io(), this.site);
    this.options = jiraOptions(this.jira.settings);
    // Another board in the settings (or none): Today's board, selection and scroll start over.
    if ((this.sprint.board?.id ?? null) !== this.options.board) {
      this.sprint = blankSprint(this.options.board);
      this.states.delete("today");
      this.scrollTop("today");
      // The brief's New in sprint was the old board's sprint; the brief is due again (its window moved with it), its
      // Changed issues' history read anew.
      this.brief = { ...this.brief, sprint: [] };
      this.briefTried = undefined;
      this.histories = new Map();
    }
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

  // The All tab's filter menu: All my issues, then the built-ins, Jira favourites and the settings' own filters.
  filters() { return tabFilters(this.tabs().find((x) => x.filters), filterList(this.favourites, this.jira?.settings.filters)); }
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
    await this.refreshCounts(cx);
    await this.refreshBriefHidden(cx);
  }

  // Refresh by hand: connect again when not connected (or after a problem), else the list (on Today, the board's
  // columns and sprints too) and the open issue.
  async reload(cx) {
    if (!this.jira?.settings.baseUrl || !this.jira.token) return;
    if (!this.connected || this.problem) { await this.connect(cx); return; }
    await this.refresh(cx, { fresh: true });
    if (this.selected) await this.loadDetail(cx, this.selected);
  }

  // The shown tab's list (its search, and its search text) and its count. The tab's newest search wins; the answer
  // goes to the tab it was asked for, even if another is shown by then. A tab with severity asks for its field too
  // (each row's `severity`), and once its rows are drawn, how many of its tickets need attention now (countAttention).
  // Today is its brief and sprint board (refreshToday; `fresh`: its board's columns and sprints, and your sub-tasks'
  // parents, read again too).
  async refresh(cx, { more = false, fresh = false } = {}) {
    if (!this.connected || !this.jira) return;
    const tab = this.tab();
    if (tab.kind === "today") { await this.refreshToday(cx, { fresh }); return; }
    const s = this.state(tab.id);
    const seq = s.seq.next();
    const f = this.source(tab);
    const jql = withSearch(f.jql, s.query);
    const attends = this.attentionSearch(tab) != null;
    s.loading = true;
    this.counts.set(tab.id, { ...this.counts.get(tab.id), loading: true });
    cx.notify();
    // A plain refresh asks for as many as are listed, so Load more's rows survive a poll or an action.
    const r = await this.client(cx).search(jql, {
      startAt: more ? s.rows.length : 0, maxResults: more ? PAGE_SIZE : refreshSize(s.rows.length), fields: severityFields(tab.severity),
    });
    if (!s.seq.accept(seq)) return;
    s.loading = false;
    this.lastPollAt = Date.now();
    this.pollFailed = !r.ok;
    if (!r.ok) {
      if (this.pageProblem(r.problem)) this.counts.set(tab.id, { ...this.counts.get(tab.id), loading: false });
      else { s.listProblem = r.problem; this.counts.set(tab.id, keepAttention(this.counts.get(tab.id), { problem: r.problem }, attends)); }
      cx.notify();
      return;
    }
    const base = this.jira.settings.baseUrl;
    const rows = (r.data?.issues ?? []).map((i) => severityRow(i, base, tab.severity));
    s.rows = more ? [...s.rows, ...rows] : rows;
    s.total = r.data?.total;
    s.fetchedAt = Date.now();
    s.listProblem = null;
    this.counts.set(tab.id, keepAttention(this.counts.get(tab.id), { total: s.total }, attends));
    this.problem = null;
    cx.notify();
    if (await this.countAttention(cx, tab)) return;
    await this.loadProjectStatuses(cx);
  }

  // How many of a tab's tickets need attention now (its count's `attention`, which reddens its count): one count-only
  // search (attentionSearch), after the tab's own (refresh, refreshCounts), whatever is typed in its search box. Its
  // answer is kept only while the tab still asks the same. A failed one leaves `attention` as it was, with no "!" for
  // it alone, except a rejected or forbidden token, which takes the page (countFailure): true then.
  async countAttention(cx, tab) {
    const jql = this.attentionSearch(tab);
    if (!jql || !this.connected || this.problem) return false;
    const r = await this.client(cx).search(jql, { maxResults: 0 });
    if (!r.ok) {
      if (countFailure(r.problem.kind) !== "page") return false;
      this.pageProblem(r.problem);
      cx.notify();
      return true;
    }
    const now = this.tabs().find((x) => x.id === tab.id);
    if (!now || this.attentionSearch(now) !== jql) return false;
    const count = withAttention(this.counts.get(tab.id), r.data?.total);
    if (count) this.counts.set(tab.id, count);
    cx.notify();
    return false;
  }

  // A failed search that means Jira can't be reached at all takes the whole page (true); any other (a view's bad
  // JQL) is the tab's own (false).
  pageProblem(problem) {
    if (!PAGE_PROBLEMS.includes(problem.kind)) return false;
    const effect = afterProblem(problem.kind);
    this.problem = problem;
    this.connected = effect.connected;
    this.paused = effect.pause;
    if (effect.clearBadge) setShared(BADGE_KEY, null);
    return true;
  }

  // ---- Today: the brief and the sprint board ----

  // Today: the sprint board (when the settings name one) and the brief. The board's columns, statuses and sprints (and
  // how many of yours each active sprint holds, which picks the current sprint) are read when due (hourly) or `fresh`;
  // then, every time, the shown sprint's issues assigned to you in the board's order, with their history (New in
  // sprint), and the brief's own searches (readBrief). Today shown, this is the page's poll (refresh() sends it here);
  // another tab shown, the badge's refresh every HIDDEN_EVERY_MS (refreshBriefHidden), which leaves the poll's timing
  // alone. Its newest call wins; an answer for a board or a site the page has left since is dropped. A failure that
  // means Jira can't be reached with this token takes the page (todayFailure, then pageProblem); any other (a slow or
  // failing search, anything from the agile API) is Today's own: said where it belongs, on the board or in the brief,
  // and as "!" on Today's tab (updateBadge), and the rest carries on.
  async refreshToday(cx, { fresh = false } = {}) {
    if (!this.connected || !this.jira) return;
    const board = this.options.board;
    const s = this.state("today");
    const seq = s.seq.next();
    const live = () => s.seq.accept(seq) && this.states.get("today") === s && this.options.board === board;
    const polled = this.tab().kind === "today";
    let failed = false;
    // A failed request: true when it took the page (stop there), else `here` keeps it and Today carries on. `agile`:
    // the request was one of Jira Software's (readSprints says which).
    const fail = (problem, here, agile = false) => {
      failed = true;
      if (todayFailure(problem.kind, { shown: polled, agile }) === "page" && this.pageProblem(problem)) return true;
      here(problem);
      return false;
    };
    const done = () => {
      s.loading = false;
      this.briefTried = Date.now();
      if (polled) { this.lastPollAt = Date.now(); this.pollFailed = failed; }
      cx.notify();
    };
    s.loading = true;
    cx.notify();
    // A read of the closed sprints still running (the menu's, or an older refresh's) ends first: requests go one at a
    // time. Only here, before this refresh starts one of its own (closedInTurn awaits that one where it starts it).
    if (this.closedRead) { await this.closedRead; if (!live()) return; }
    const c = this.client(cx);
    const onBoard = (problem) => { this.sprint = { ...this.sprint, problem }; };
    // The board's closed sprints, in this refresh's turn, once at most: when closedNeeded says so (no active sprint, or
    // the menu opened while this refresh ran: openSprintMenu leaves them to it) and none are being read.
    let closedTried = false;
    const closedInTurn = async () => {
      const sp = this.sprint;
      if (closedTried || sp.closedLoading || !closedNeeded({ active: sp.active, menuOpen: this.sprintOpen, closedAt: sp.closedAt })) return;
      closedTried = true;
      await this.readClosed(c, cx);
    };
    let current = null; // the current sprint's issues with their history (New in sprint); null: not read this time
    if (board != null) {
      let cached = true;
      if (fresh || sprintCacheDue(this.sprint.cachedAt, Date.now())) {
        const got = await this.readSprints(c, board, live);
        if (!got || !live()) return;
        if (got.ok) this.sprint = { ...this.sprint, ...got.data };
        else if (fail(got.problem, onBoard, got.agile)) { done(); return; } else cached = false;
      }
      if (cached) {
        const sp = this.sprint;
        // The sprint picked in the menu while it's still on the board, else the current one (none: no active sprint).
        const shown = shownSprint({ picked: sp.picked, shown: sp.shown, all: sp.all, closed: sp.closed, current: sp.current });
        let found = { ok: true, data: { issues: [], total: 0 } };
        if (shown) {
          // As many as a refresh ever asks for, from the first load: Today has no Load more, so the board is never partial.
          found = await c.search(sprintJql(shown.id), { maxResults: REFRESH_CAP, fields: [...ROW_FIELDS, "created"], expand: "changelog" });
          if (!live()) return;
        }
        if (found.ok) {
          const issues = found.data?.issues ?? [];
          const base = this.jira.settings.baseUrl;
          this.sprint = {
            ...this.sprint, shown: shown ?? null, picked: shown && shown.id !== sp.current?.id ? shown.id : null,
            rows: issues.map((i) => issueRow(i, base)), total: found.data?.total, problem: null, at: Date.now(),
          };
          // Drawn now, not after the brief's searches: a card dropped on another column would otherwise sit in its
          // old one until they end.
          cx.notify();
          // A sprint picked in the menu isn't the current one: New in sprint keeps what it had.
          if (!sp.current || shown?.id === sp.current.id) current = sp.current ? issues : [];
        } else if (fail(found.problem, onBoard)) { done(); return; }
        // Right after the board: with no active sprint (its menu takes the series of the one that ended last:
        // menuSprint), or with the menu open.
        await closedInTurn();
        if (!live()) return;
      }
    }
    // The brief, only once Jira has said who you are (your own edits would otherwise read as someone else's).
    if (this.me?.key || this.me?.name) {
      const stop = await this.readBrief(c, { fresh, live, fail, current });
      if (stop === "gone") return;
      if (stop === "page") { done(); return; }
    }
    // The menu opened while the brief was read (or while the board's sprints failed to be read again: it shows what
    // was read before).
    if (board != null && this.sprint.cachedAt) { await closedInTurn(); if (!live()) return; }
    s.fetchedAt = Date.now();
    if (polled) this.problem = null;
    done();
  }

  // The brief's searches (refreshToday's): your sub-tasks' parents when due (with the board's cache: hourly, or
  // `fresh`); your unresolved issues and those parents updated since the current sprint started (14 days without
  // one), with their history (Changed; read again only for those that changed: this.histories); the high-priority
  // bugs. Then the lists (New in sprint from `current`, the current sprint's issues, when they were read), the marks
  // without the bugs that left the list, and the badge. The first failure ends the searches and is the brief's
  // `problem`; what was read before it is used, and a list not read keeps what it had. "gone": the answer is for a
  // Today the page has left; "page": a failure took the page.
  async readBrief(c, { fresh, live, fail, current }) {
    const me = this.me; // { key, name, … } (/myself): Jira Server's history names you by key
    const now = Date.now();
    const since = sinceMinutes(this.sprint.current, now);
    const sinceMs = now - since * 60e3;
    let problem = null;
    const said = (part) => (p) => { problem = { ...p, part }; };
    if (fresh || sprintCacheDue(this.subtasks.cachedAt, now)) {
      const r = await c.search(SUBTASKS_JQL, { maxResults: REFRESH_CAP, fields: ["parent"] });
      if (!live()) return "gone";
      if (r.ok) this.subtasks = { byParent: subtasksByParent(r.data?.issues), cachedAt: Date.now() };
      else if (fail(r.problem, said("changed"))) return "page";
    }
    let changed = null;
    if (!problem) {
      // Which issues are in the window, and Jira's `updated` of each (a fraction of what their history weighs).
      const found = [];
      for (const jql of changedSearches({ since, parentKeys: [...this.subtasks.byParent.keys()] })) {
        const r = await c.search(jql, { maxResults: REFRESH_CAP, fields: ["updated"] });
        if (!live()) return "gone";
        if (!r.ok) { if (fail(r.problem, said("changed"))) return "page"; break; }
        for (const issue of r.data?.issues ?? []) if (issue?.key) found.push({ key: issue.key, updated: issue.fields?.updated });
      }
      // Every one of them found (a failed search leaves the histories, and Changed, as they were): the history of only
      // those new to the window or updated since theirs was read (historyPlan), kept with the `updated` it came with.
      // A failed history search leaves its issues' old history (or none: not shown), read again next time. Those that
      // left the window are forgotten, and Changed is built from the histories of the issues found, each once (a
      // parent of yours can also be yours).
      if (!problem) {
        for (const jql of keySearches(historyPlan(found, this.histories).stale)) {
          const r = await c.search(jql, { maxResults: REFRESH_CAP, fields: ROW_FIELDS, expand: "changelog" });
          if (!live()) return "gone";
          if (!r.ok) { if (fail(r.problem, said("changed"))) return "page"; break; }
          for (const issue of r.data?.issues ?? []) if (issue?.key) this.histories.set(issue.key, { updated: issue.fields?.updated, issue });
        }
        const keys = new Set(found.map((f) => f.key));
        for (const key of [...this.histories.keys()]) if (!keys.has(key)) this.histories.delete(key);
        const marks = this.marks();
        changed = [...keys].map((key) => this.histories.get(key)?.issue).filter(Boolean).map((i) => changedItem(i, { me, sinceMs, marks })).filter(Boolean);
      }
    }
    let bugs = null;
    if (!problem) {
      const r = await c.search(bugsSearch(this.options), { maxResults: REFRESH_CAP });
      if (!live()) return "gone";
      const base = this.jira.settings.baseUrl;
      if (r.ok) bugs = (r.data?.issues ?? []).map((i) => issueRow(i, base)).map((x) => ({ key: x.key, summary: x.summary, priority: x.priority, status: x.status, at: x.updatedMs }));
      else if (fail(r.problem, said("bugs"))) return "page";
    }
    const sprint = this.sprint.current;
    this.brief = {
      changed: changed ?? this.brief.changed,
      sprint: current ? current.map((i) => newInSprintItem(i, { sprint, me })).filter(Boolean) : this.brief.sprint.filter((x) => x.sprintId === sprint?.id),
      bugs: bugs ?? this.brief.bugs, at: Date.now(), sinceMs, problem,
    };
    // Only after the bugs were read: a failed search must not forget which bugs you have seen.
    if (bugs) this.updateMarks((marks) => { const pruned = pruneBugs(marks, bugs.map((b) => b.key)); return JSON.stringify(pruned) === JSON.stringify(marks) ? marks : pruned; });
    this.updateBadge();
    return null;
  }

  // Today's brief while another tab is shown: refreshed every HIDDEN_EVERY_MS (as a hidden page polls), so the Pages
  // badge and Today's count keep up. With Today shown, it is the page's own poll.
  async refreshBriefHidden(cx) {
    if (!this.connected || this.problem || !this.jira || this.tab().kind === "today" || this.state("today").loading) return;
    if (!pollDue({ shown: false, lastAt: this.briefTried, failed: false, now: Date.now() })) return;
    await this.refreshToday(cx);
  }

  // The brief's read marks, per PC: { [key]: { changed?, sprint?, bug? } } (brief.js).
  marks() {
    const m = shared(READ_KEY);
    return m && typeof m === "object" && !Array.isArray(m) ? m : {};
  }

  // The marks after `change` (marks -> marks; the same object for no change): saved, with the badge, when they changed.
  updateMarks(change) {
    const before = this.marks();
    const after = change(before);
    if (after === before) return;
    setShared(READ_KEY, after);
    this.updateBadge();
  }

  // The Pages badge and Today's count (todayCount): the brief's unread items (briefBadge; none: no badge and no number),
  // and "!" while Today's board or brief has a problem of its own. No number and no badge until the brief was first
  // built. The badge is published only while connected and not paused: once a rejected token cleared it, neither a
  // key that opens an issue (its read marks) nor a brief that ends late puts it back.
  updateBadge() {
    const badge = this.brief.at ? briefBadge(this.brief, this.marks()) : null;
    this.counts.set("today", todayCount(badge, [this.sprint.problem, this.brief.problem]));
    if (this.brief.at && this.connected && !this.paused) setShared(BADGE_KEY, badge);
  }

  markAllRead(cx) {
    this.updateMarks((marks) => readAll(marks, this.brief));
    cx.notify();
  }

  // What changed's Mark read: the edits it shows are read (a later one is unread again).
  markRead(cx) {
    const item = this.change?.item;
    if (!item) return;
    this.updateMarks((marks) => (isUnread("changed", item, marks) ? withRead(marks, "changed", item) : marks));
    cx.notify();
  }

  // The issue opening in the detail: What changed is its unread Changed item, taken now and kept while the issue stays
  // open; Recent changes starts closed.
  openChange(key) {
    const marks = this.marks();
    const item = key ? this.brief.changed.find((x) => x.key === key && isUnread("changed", x, marks)) : null;
    this.change = item ? { key, item, ops: changeDiff(item.before, item.after), full: false } : null;
    this.recent = null;
  }

  // Recent changes on the open issue: opened, its description edits by others within the brief's window, as diffs,
  // asked each time it opens (GET the issue's history); closed, forgotten.
  toggleRecent(key, cx) {
    if (this.recent?.key === key) { this.recent = null; cx.notify(); return; }
    const now = Date.now();
    const sinceMs = this.brief.sinceMs ?? now - sinceMinutes(this.sprint.current, now) * 60e3;
    const asked = { key, sinceMs, edits: "loading", full: new Set() };
    this.recent = asked;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await this.client(cx).issueHistory(key);
      if (this.recent !== asked) return;
      this.recent = { ...asked, edits: r.ok ? recentEdits(r.data.histories, { me: this.me, sinceMs }).map((e) => ({ ...e, ops: changeDiff(e.from, e.to) })) : { problem: r.problem } };
      cx.notify();
    });
  }

  // Check against my work: a Claude tab with checkTask's message (checkWork: the issue, when it changed and your work
  // under it, never its text), then the terminal, as Start work does.
  checkMyWork(item, cx) {
    const c = checkWork(item, { template: this.options.checkTask, subtasks: this.subtasks.byParent });
    if (!c) return;
    try { run(c.command, c.args); } catch (e) { this.actionMsg = { ok: false, message: `Couldn't open the tab: ${e?.message ?? e}` }; cx.notify(); return; }
    showTerminal();
  }

  // What changes rarely on Today's board, for `board`: { ok, data: { board: { id, name }, columns, active, all,
  // mine, current, cachedAt, closed, closedAt, closedProblem } }, or the first failure (with `agile: true` when it
  // came from Jira Software's agile API: the board's configuration, its sprints). Only the active and future sprints
  // (`all`; one page, where every sprint the board ever had is several): the closed ones are dropped, read again when
  // needed (readClosed). One request at a time; one count per active sprint. Once `live()` is false (a newer refresh
  // of Today started, or the page left this board) it stops before the next request, with null.
  async readSprints(c, board, live) {
    const conf = await c.boardConfiguration(board);
    if (!live()) return null;
    if (!conf.ok) return { ...conf, agile: true };
    const statuses = await c.statuses();
    if (!live()) return null;
    if (!statuses.ok) return statuses;
    const sprints = await c.sprints(board, ["active", "future"]);
    if (!live()) return null;
    if (!sprints.ok) return { ...sprints, agile: true };
    const active = sprints.data.filter((x) => x.state === "active");
    const mine = new Map();
    for (const a of active) {
      const n = await c.search(sprintMineJql(a.id), { maxResults: 0 });
      if (!live()) return null;
      if (!n.ok) return n;
      mine.set(a.id, Number.isFinite(n.data?.total) ? n.data.total : 0);
    }
    return { ok: true, data: {
      board: { id: board, name: conf.data.name ?? null }, columns: sprintColumns(conf.data.columns, statuses.data),
      active, all: sprints.data, mine, current: pickSprint(active, mine), cachedAt: Date.now(),
      closed: null, closedAt: null, closedProblem: null,
    } };
  }

  // The board's closed sprints (the sprint menu's older ones; the series it offers with no active sprint), when
  // closedNeeded says so: this.sprint's `closed` and `closedAt`, or `closedProblem`, said in the menu (never the page's
  // problem, nor the board's). `closedLoading` while it runs (one read at a time); its newest read wins, and an answer
  // for a board or a site the page has left since is dropped. Drawn when it ends (the menu fills in while open). The
  // read is this.closedRead while it runs, whoever started it, so a refresh of Today starting meanwhile waits for it.
  readClosed(c, cx) {
    const board = this.options.board;
    const s = this.state("today");
    const seq = this.closedSeq.next();
    const live = () => this.closedSeq.accept(seq) && this.states.get("today") === s && this.options.board === board;
    this.sprint = { ...this.sprint, closedLoading: true, closedProblem: null };
    cx.notify();
    const read = (async () => {
      const r = await c.sprints(board, ["closed"]);
      if (this.closedRead === read) this.closedRead = null;
      if (!live()) return;
      this.sprint = r.ok
        ? { ...this.sprint, closed: r.data, closedAt: Date.now(), closedLoading: false }
        : { ...this.sprint, closedLoading: false, closedProblem: r.problem };
      cx.notify();
    })();
    this.closedRead = read;
    return read;
  }

  // The sprint menu opened or closed. Opened, its older sprints are read when closedNeeded says so: now, or, while
  // Today refreshes, by that refresh once it's done with the board (refreshToday), so requests go one at a time. The
  // read starts later, in a task of its own: asked again there, so that a refresh queued in the same turn, or the menu
  // closed and opened again, never starts a second read beside the one running.
  openSprintMenu(open, cx) {
    this.sprintOpen = open;
    cx.notify();
    if (!open) return;
    const due = () => {
      const sp = this.sprint;
      return Boolean(sp.cachedAt) && !sp.closedLoading && !this.state("today").loading
        && closedNeeded({ active: sp.active, menuOpen: this.sprintOpen, closedAt: sp.closedAt });
    };
    if (!due()) return;
    cx.spawn(async (cx) => { if (due()) await this.readClosed(this.client(cx), cx); });
  }

  // The sprint menu: shows another sprint of the board, from the top, with nothing open (not remembered: Today opens
  // on the current sprint when Herdr starts).
  showSprint(id, cx) {
    this.sprintOpen = false;
    const sp = this.sprint;
    const pick = [...sp.all, ...(sp.closed ?? [])].find((x) => x.id === id);
    if (!pick || pick.id === sp.shown?.id) { cx.notify(); return; }
    this.sprint = { ...sp, shown: pick, picked: pick.id === sp.current?.id ? null : pick.id, rows: [], total: undefined, problem: null, at: null };
    this.state("today").fetchedAt = null;
    this.selected = null;
    this.detail = null;
    this.dropChoice = null;
    this.dropNote = null;
    this.scroll("today/board")?.scroll_to_item(0);
    cx.notify();
    cx.spawn(async (cx) => this.refresh(cx));
  }

  // A lane's header folds it, or unfolds it.
  toggleLane(key, cx) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    cx.notify();
  }

  // The counts on the tabs not shown: one count-only search each, every HIDDEN_EVERY_MS (countsDue), one at a time,
  // and after one that worked, for a tab with severity, its tickets that need attention now (countAttention). A failed
  // one marks only its own tab ("!"), except a rejected or forbidden token, which takes the page (countFailure).
  // Whether Jira can be reached at all is the shown tab's search to say.
  async refreshCounts(cx) {
    if (!this.connected || this.problem || !this.jira) return;
    const due = countsDue(this.tabs(), this.tab().id, this.countsAt, Date.now());
    if (!due.length) return;
    this.countsAt = Date.now();
    for (const tab of due) {
      if (!this.connected || this.problem) return;
      const r = await this.client(cx).search(withSearch(this.source(tab).jql, this.state(tab.id).query), { maxResults: 0 });
      if (tab.id === this.tab().id) continue; // shown meanwhile: its own search counts it
      const attends = this.attentionSearch(tab) != null;
      if (r.ok) this.counts.set(tab.id, keepAttention(this.counts.get(tab.id), { total: r.data?.total }, attends));
      else if (countFailure(r.problem.kind) === "page") { this.pageProblem(r.problem); cx.notify(); return; }
      else this.counts.set(tab.id, keepAttention(this.counts.get(tab.id), { problem: r.problem }, attends));
      cx.notify();
      if (r.ok && (await this.countAttention(cx, tab))) return;
    }
  }

  // The workflow statuses of the board's project, asked once per project, only when the board is one project (its
  // columns show them all, empty ones too; a mixed board has none to ask for). A failure leaves the project out: its
  // columns then come from its issues, as before. The board is the shown tab's.
  async loadProjectStatuses(cx) {
    const projects = boardProjects(this.shown().rows);
    if (projects.length !== 1) return;
    const key = projects[0];
    if (this.projectStatuses.has(key)) return;
    this.projectStatuses.set(key, "loading");
    const r = await this.client(cx).projectStatuses(key);
    this.projectStatuses.set(key, r.ok ? r.data : []);
    cx.notify();
  }

  boardStatuses() {
    return workflowStatuses(this.shown().rows, this.projectStatuses);
  }

  tick(cx) {
    if (!this.jira || this.editing) return;
    // The settings file edited by hand (its views, say) shows within a tick; then the hidden tabs' counts and, with
    // another tab shown, Today's brief (for the badge), when due.
    cx.spawn(async (cx) => {
      await this.reloadSettings(cx);
      if (!this.editing && !this.checkingNow && !this.paused) { await this.refreshCounts(cx); await this.refreshBriefHidden(cx); }
    });
    if (this.checkingNow || this.paused) return;
    const shown = pageShown(MOD);
    // Not while the shown tab is still loading (Today's first load is many requests): a poll would start it over.
    // ⟳ still does, on purpose.
    if (!pollDue({ shown, lastAt: this.lastPollAt, failed: this.pollFailed, now: Date.now(), loading: this.shown().loading })) return;
    cx.spawn(async (cx) => {
      if (!this.connected && this.jira.settings.baseUrl && this.jira.token) await this.connect(cx);
      else await this.refresh(cx);
      if (this.selected && shown) await this.loadDetail(cx, this.selected);
    });
  }

  // Reads the settings file again (cheap) and, when its text changed, acts on it (settingsReload). Text that doesn't
  // parse keeps the settings and tabs in use, with the problem in the form. Another address starts over, as Save does
  // for one. Otherwise it loads and rebuilds the tabs: a tab whose search changed starts over, every tab is counted
  // again, and the shown one (maybe another now: its view may have gone) is loaded if it never was.
  async reloadSettings(cx) {
    const path = this.jira?.paths.settingsPath;
    if (!path) return;
    const text = await readTextFile(path).catch(() => null);
    if (text === this.jira.settingsText || this.editing) return;
    const plan = settingsReload(this.jira.settings, text, path.split("/").pop());
    if (plan.kind === "keep") {
      // The text is remembered so the next tick doesn't ask again; Save writes over it, as when the page starts with
      // a file that doesn't parse.
      const warnings = [...this.options.warnings.filter((w) => w !== this.jira.problem), plan.problem];
      this.jira = { ...this.jira, settingsText: text, problem: plan.problem };
      this.options = { ...this.options, warnings };
      cx.notify();
      return;
    }
    if (plan.newSite) {
      // Another Jira: forget the old one's issues, open issue and filters, as Save does, then connect to it.
      this.clearView();
      this.connected = false;
      setShared(BADGE_KEY, null);
      await this.load();
      cx.notify();
      if (this.jira.settings.baseUrl && this.jira.token) await this.connect(cx);
      return;
    }
    const searches = new Map(this.tabs().map((x) => [x.id, x.jql]));
    const before = this.selected;
    const query = this.shown().query;
    await this.load();
    for (const x of this.tabs()) if (searches.get(x.id) !== x.jql) { this.states.delete(x.id); this.counts.delete(x.id); this.scrollTop(x.id); }
    this.countsAt = undefined;
    if (this.selected !== before) this.followSelection(cx);
    if (this.shown().query !== query) this.searchInput.set_value(this.shown().query);
    cx.notify();
    const s = this.shown();
    if (!s.fetchedAt && !s.loading) await this.refresh(cx);
  }

  // Opens an issue in the detail (from the brief, the board, a list or a key). Opening it reads its New-in-sprint and
  // bug items (readOnOpen); a Changed item waits for Mark read.
  select(key, cx) {
    this.updateMarks((marks) => readOnOpen(marks, this.brief, key));
    if (key !== this.selected) {
      this.actionMsg = null;
      this.pendingStep = null;
      this.transitions = null;
      this.transOpen = false;
      this.commentInput.set_value("");
      this.openChange(key);
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
        if (row) this.shown().moved.set(key, { ...row, status: tr.to?.name ?? row.status, category: tr.to?.statusCategory?.key ?? row.category });
        await this.loadDetail(cx, key);
        await this.refresh(cx);
      });
  }

  shownRows() { const s = this.shown(); return keepMoved(s.rows, s.moved); }

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
    if (this.tab().kind === "today") { this.droppedOnColumn(drag, cx); return; }
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

  // Today: a drop on one of the board's columns (several statuses; `hover` is its name) runs the move into it, asks
  // which when several lead there, or says why not (columnDrop). A drop on the card's own column does nothing.
  droppedOnColumn(drag, cx) {
    const col = this.sprint.columns.find((c) => c.name === drag.hover);
    if (!col || !Array.isArray(drag.transitions)) return;
    this.dropColumn = col.name;
    const plan = columnDrop(drag.transitions, col, drag.row.status);
    if (plan.kind === "run") this.moveCard(drag.row, plan.transition, cx);
    else if (plan.kind === "choose") this.dropChoice = { row: drag.row, status: col.name, transitions: plan.transitions };
    else if (!col.statuses.includes(drag.row.status)) {
      this.dropNote = { status: col.name, key: drag.row.key, text: refusedDropText(drag.row.key, drag.row.status, col.name, drag.targets) };
    }
  }

  // A release anywhere on the page: a drag still going ends without a move (a release over the board's columns was
  // already handled there: its own handler runs first), and a press that never became a drag is forgotten, so
  // neither is left stuck (over the brief, the header, the tabs or the detail).
  dragEnded(cx) {
    this.press = null;
    if (!this.drag) return;
    this.drag = null;
    cx.notify();
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

  // Start work: a Claude tab named after the issue, with the message of its flow (the `start` of the first action rule
  // that matches it, else the settings' Start-work message); then the terminal comes to the front. From a list row, a
  // template that uses {description} first fetches the full issue (rows don't carry it).
  startWork(issue, cx) {
    const template = startTemplate(this.options.actions, issue, this.jira?.settings.startTask);
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

  // Finish: a Claude tab named "<key> finish" with the `finish` message of the issue's flow (the detail has the
  // description already); then the terminal. Nothing in Jira changes: the skill it names does that, step by step.
  finishWork(issue, cx) {
    const c = finishWork(issue, this.options.actions);
    if (!c) return;
    try { run(c.command, c.args); } catch (e) { this.actionMsg = { ok: false, message: `Couldn't open the tab: ${e?.message ?? e}` }; cx.notify(); return; }
    showTerminal();
  }

  // A tab's button (a view's `button` setting): a Claude tab named after its label, with its task as the first message,
  // then the terminal, as Start work does. No Jira request, so it needs no connection.
  tabButton(button, cx) {
    const c = tabButtonWork(button);
    if (!c) return;
    try { run(c.command, c.args); } catch (e) { this.actionMsg = { ok: false, message: `Couldn't open the tab: ${e?.message ?? e}` }; cx.notify(); return; }
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
      // The board's name is known once Today has read its configuration.
      this.boardChoice = this.options.board != null ? { id: this.options.board, name: this.sprint.board?.name ?? null } : null;
      this.boardHits = null;
      this.boardSeq.next();
      this.boardInput.set_value("");
      this.prioInput.set_value(prioritiesText(this.jira.settings));
    }
    cx.notify();
  }

  // The Scrum board field: Jira's scrum boards whose name holds what's typed, asked once typing pauses.
  searchBoards(cx) {
    const text = this.boardInput.value().trim();
    const seq = this.boardSeq.next();
    if (!text || !this.jira?.settings.baseUrl || !this.jira.token) { this.boardHits = null; cx.notify(); return; }
    this.boardHits = "loading";
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(250);
      if (!this.boardSeq.accept(seq)) return;
      const r = await this.client(cx).boards(text);
      if (!this.boardSeq.accept(seq)) return;
      this.boardHits = r.ok ? r.data : { problem: r.problem };
      cx.notify();
    });
  }

  pickBoard(b, cx) {
    this.boardChoice = { id: b.id, name: b.name ?? null };
    this.boardHits = null;
    this.boardSeq.next();
    this.boardInput.set_value("");
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
        if (url.url !== this.jira.settings.baseUrl) { this.clearView(); this.connected = false; setShared(BADGE_KEY, null); }
        const fields = { ...this.jira.settings, baseUrl: url.url, transport: this.transportChoice,
          startTask: this.taskInput.value(), caFile: this.caInput.value().trim() };
        // The Scrum board and High priorities are on the form opened by hand only (not on the first Connect).
        const settings = this.editing ? withFormOptions(fields, { board: this.boardChoice?.id ?? null, priorities: this.prioInput.value() }) : fields;
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
      this.clearView();
      Object.assign(this, { connected: false, problem: null, paused: false });
      setShared(BADGE_KEY, null);
      cx.notify();
    });
  }

  // A new Jira address, or Disconnect: the old site's issues (every tab's list and count, Today's board and brief),
  // open issue and filters are forgotten. CLEARED_VIEW's list fields live in the tabs' states now, so they go with those.
  clearView() {
    const { rows: _r, total: _t, fetchedAt: _f, listProblem: _p, ...view } = JSON.parse(JSON.stringify(CLEARED_VIEW));
    Object.assign(this, view, {
      states: new Map(), counts: new Map(), countsAt: undefined, projectStatuses: new Map(), sprint: blankSprint(this.options.board),
      brief: blankBrief(), briefTried: undefined, subtasks: blankSubtasks(), histories: new Map(), change: null, recent: null,
    });
    for (const h of this.scrolls.values()) h?.scroll_to_item(0);
    this.searchInput.set_value("");
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

  // `accent`: the theme's accent colour for the outline and text, for a button that should stand out a little without
  // being the page's primary action (a tab's own button).
  button(t, id, label, onClick, { primary = false, accent = false, enabled = true, tip } = {}) {
    return h_flex().id(id).h(28).px(12).flex_none().items_center().rounded(7).text_size(12.5)
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!primary && accent, (el) => el.border_1().border_color(t.accent).text_color(t.accent))
      .when(!primary && !accent, (el) => el.border_1().border_color(t.border).text_color(t.foreground))
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
        .when(!first, (el) => el.child(this.boardField(t))
          .child(this.field(t, "High priorities", this.prioInput, `Your Jira's names for urgent priorities, comma-separated (e.g. P0, P1), for the brief's High-priority bugs. Empty: ${DEFAULT_HIGH_PRIORITIES.join(", ")}.`)))
        .child(this.fileNote(t))
        .when(Boolean(this.formError), (el) => el.child(div().text_size(12.5).text_color(t.blocked).child(this.formError)))
        .child(h_flex().gap(8).pt(4)
          .child(this.button(t, "jira-save", this.formBusy ? "Connecting…" : first ? "Connect" : "Save", (cx) => this.saveForm(cx), { primary: true, enabled: !this.formBusy }))
          .when(!first, (el) => el.child(this.button(t, "jira-cancel", "Cancel", (cx) => { this.editing = false; this.formError = null; cx.notify(); })))
          .child(div().flex_1())
          .when(Boolean(this.jira?.token), (el) => el.child(this.button(t, "jira-disconnect", "Disconnect", (cx) => { this.editing = false; this.disconnect(cx); }, { tip: "Forget the token on this PC" }))))
        .when(Boolean(this.jira?.problem) && !this.options.warnings.includes(this.jira.problem), (el) => el.child(div().text_size(11.5).text_color(WARN).child(this.jira.problem))));
  }

  // The Scrum board: the one picked (its name), a search box over Jira's scrum boards and the ones found, to pick.
  boardField(t) {
    const c = this.boardChoice;
    const hits = this.boardHits;
    const note = (text, color = t.dim) => div().px(8).py(6).text_size(11.5).text_color(color).child(text);
    const hit = (b) => h_flex().id(`jira-board-hit-${b.id}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.pickBoard(b, cx))
      .child(div().flex_1().min_w(0).truncate().child(b.name ?? `Board ${b.id}`))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(`#${b.id}`));
    const found = hits === "loading" ? [note("Searching…")]
      : hits?.problem ? [note(`${hits.problem.message} ${hits.problem.hint ?? ""}`.trim(), t.blocked)]
        : Array.isArray(hits) ? (hits.length ? hits.map(hit) : [note("No scrum board has that in its name.")]) : [];
    return v_flex().gap(5)
      .child(this.field(t, c ? `Scrum board: ${c.name ?? `#${c.id}`}` : "Scrum board: none", this.boardInput, null))
      .when(found.length > 0, (el) => el.child(v_flex().id("jira-board-hits").max_h(200).overflow_y_scrollbar().p(4).gap(1).rounded(8)
        .border_1().border_color(t.border).bg(t.background).text_size(12.5).text_color(t.foreground).children(found)))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("With a board, the Today tab shows its current sprint in its own columns under the brief. Type part of its name, then pick it."))
        .when(Boolean(c), (el) => el.child(this.button(t, "jira-board-none", "No board", (cx) => { this.boardChoice = null; cx.notify(); }))));
  }

  // Where the tabs (views) and the other options are edited by hand, and each entry of that file the page skipped.
  fileNote(t) {
    const path = this.jira?.paths.settingsPath;
    return v_flex().gap(3)
      .when(Boolean(path), (el) => el.child(div().text_size(11).text_color(t.dim).child(`Tabs (views) and other options are edited in ${path}; the page reads it again when it changes.`)))
      // A file that didn't parse says so as it is; the rest are entries the page skipped.
      .children(this.options.warnings.map((w) => div().text_size(11.5).text_color(WARN).child(w === this.jira?.problem ? w : `Skipped ${w}`)));
  }

  // What Start work would send for the open issue (else the first one listed): its action rule's message, else as typed.
  preview(t) {
    const issue = this.detail ?? this.shown().rows[0];
    if (!issue) return div();
    const typed = this.taskInput.value();
    const template = startTemplate(this.options.actions, issue, typed);
    const text = previewTask(issue, template);
    return v_flex().gap(4).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(t.border)
      .child(div().text_size(11).text_color(t.dim).child(template === typed ? `Preview for ${issue.key}` : `Preview for ${issue.key}, from its action rule`))
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
    const tab = this.tab();
    // Today is its brief and sprint board: no search box, no List / Board.
    const today = tab.kind === "today";
    const list = this.state(tab.id);
    const [shownCount, total] = today ? [this.sprint.rows.length, this.sprint.total] : [list.rows.length, list.total];
    const f = this.filter();
    const filters = this.filters();
    const view = this.layout();
    const host = (() => { try { return new URL(this.jira.settings.baseUrl).host; } catch { return ""; } })();
    const item = (x) => h_flex().id(`jira-filter-${x.id}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .bg(x.id === f.id ? t.selected : t.popover).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.filterOpen = false; setShared(FILTER_KEY, x.id); list.moved = new Map(); this.selected = null; this.detail = null; cx.spawn(async (cx) => this.refresh(cx)); })
      .child(div().flex_1().min_w(0).truncate().child(x.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(x.source === "favourite" ? "Jira" : x.source === "own" ? "mine" : ""));
    // The filter menu, on the tab that has one (All).
    const picker = tab.filters && Popover.new("jira-filter").open(this.filterOpen)
      .on_open_change((open, cx) => { this.filterOpen = open; cx.notify(); })
      .trigger(h_flex().id("jira-filter-trigger").h(28).px(10).gap(6).items_center().rounded(7).border_1().border_color(t.border)
        .cursor_pointer().hover((s) => s.bg(t.hover)).text_size(12.5)
        .child(div().max_w(220).truncate().child(f.name)).child(svg("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim)))
      .content(v_flex().id("jira-filter-list").w(300).max_h(360).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover)
        .border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).children(filters.map(item)));
    const seg = (value, label) => h_flex().id(`jira-view-${value}`).h(24).px(9).items_center().rounded(5).text_size(12).cursor_pointer()
      .on_click(() => setShared(LAYOUT_KEY(tab.id), value))
      .when(view === value, (el) => el.bg(t.raised ?? t.selected).text_color(t.foreground))
      .when(view !== value, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
      .child(label);
    const icon = (id, path, tip, onClick) => div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7)
      .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => onClick(cx)).child(svg(path).size(14));
    return h_flex().flex_none().h(52).px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(16).font_semibold().child("Jira"))
      .child(div().text_size(12).text_color(t.dim).max_w(180).truncate().child(host))
      .when(Boolean(picker), (el) => el.child(picker))
      .when(!today, (el) => el.child(h_flex().id("jira-search").w(240).h(28).px(8).items_center().rounded(7).border_1().border_color(t.border).bg(t.background)
        .child(Input.new(this.searchInput).flex_1().h_full().text_size(12.5).text_color(t.foreground))))
      .when(!today && Boolean(tab.button), (el) => el.child(this.button(t, "jira-tab-button", tab.button.label, (cx) => this.tabButton(tab.button, cx), { accent: true, tip: tabButtonWork(tab.button).args.task })))
      .child(div().flex_1())
      .child(div().text_size(11.5).text_color(t.dim).child(list.loading ? "loading…" : list.fetchedAt ? [countText(shownCount, total), `updated ${ago(list.fetchedAt, Date.now())}`].filter(Boolean).join(" · ") : ""))
      .when(!today, (el) => el.child(h_flex().p(2).gap(2).rounded(7).border_1().border_color(t.border).child(seg("list", "List")).child(seg("board", "Board"))))
      .child(icon("jira-refresh", "mods/dock-jira/refresh.svg", "Refresh", (cx) => cx.spawn(async (cx) => this.reload(cx))))
      .child(icon("jira-gear", "mods/workspace-chrome/settings.svg", "Jira settings", (cx) => this.openSettings(cx)));
  }

  typeMark(t, r) {
    return div().flex_none().size(8).rounded(2).bg(TYPE_COLOR(t, r.type)).tooltip(r.type ?? "issue");
  }

  // A row's or a card's severity chip, in a tab with `severity`: its level's label on the level's colour (chipOf);
  // null for an unrated row.
  chip(t, r, severity) {
    const c = chipOf(r.severity, severity, t);
    return c && div().flex_none().h(16).px(5).flex().items_center().rounded(4).bg(c.bg).text_size(10.5).font_semibold().text_color(c.ink).child(c.label);
  }

  // `keyW`: the key column's width, one for the whole list (keyColumnWidth over the shown rows). `chips`: in a tab with
  // severity, { severity, width }: the row's chip before its key, in a column of that width for the whole list (empty
  // for an unrated row), so the keys line up.
  row(t, r, i, keyW, chips = null) {
    const on = this.selected === r.key;
    const hot = r.priority === "Highest" || r.priority === "High";
    const chip = chips && this.chip(t, r, chips.severity);
    return h_flex().id(`jira-row-${r.key}`).h(34).px(16).gap(10).flex_none().items_center().cursor_pointer()
      .bg(on ? t.selected : t.background).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.select(r.key, cx))
      .child(this.typeMark(t, r))
      .when(Boolean(chips), (el) => el.child(h_flex().w(chips.width).flex_none().overflow_hidden().items_center().children(chip ? [chip] : [])))
      .child(div().w(keyW).flex_none().truncate().text_size(12).text_color(t.dim).child(r.key))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(r.summary))
      .child(div().w(70).flex_none().truncate().text_size(11.5).text_color(hot ? WARN : t.dim).child(r.priority ?? ""))
      .child(div().w(110).flex_none().truncate().text_size(11.5).text_color(r.assignee ? t.muted : t.dim).child(r.assignee ?? "Unassigned"))
      .child(div().w(34).flex_none().text_size(11.5).text_color(t.dim).child(ago(r.updatedMs, Date.now())))
      .child(div().id(`jira-start-${r.key}`).size(24).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
        .hover((st) => st.bg(t.raised ?? t.hover).text_color(t.foreground)).tooltip(`Start work on ${r.key}: a Claude tab with\n${previewTask(r, startTemplate(this.options.actions, r, this.jira?.settings.startTask))}`)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.startWork(r, cx); })
        .child(svg("mods/dock-jira/play.svg").size(11)));
  }

  // `id`: the button's (the list's own, or the attention box's).
  more(t, id = "jira-more") {
    const s = this.shown();
    if (!Number.isFinite(s.total) || s.rows.length >= s.total) return null;
    return h_flex().px(16).py(10).child(this.button(t, id, `Load more (${s.total - s.rows.length} left)`,
      (cx) => cx.spawn(async (cx) => this.refresh(cx, { more: true })), { enabled: !s.loading }));
  }

  // The tab's rows by To do / In progress / Done; a view grouped by "type" first splits them by issue type, one grouped
  // by "severity" by level, under the box of those that need attention now (attentionBox). In a tab with severity
  // each row carries its level's chip.
  listView(t) {
    const tab = this.tab();
    const rows = this.shownRows();
    const { attention, sections } = listSections(rows, tab);
    const keyW = keyColumnWidth(rows.map((r) => r.key));
    const chips = tab.severity ? { severity: tab.severity, width: chipWidth(tab.severity) } : null;
    const more = this.more(t);
    const group = (g) => [
      h_flex().h(30).px(16).pt(8).gap(6).flex_none().items_center()
        .child(div().text_size(11.5).font_medium().text_color(t.muted).child(g.title))
        .child(div().text_size(11.5).text_color(t.dim).child(String(g.rows.length))),
      ...g.rows.map((r, i) => this.row(t, r, i, keyW, chips)),
    ];
    const section = (sec) => [
      ...(sec.title ? [h_flex().h(38).px(16).pt(14).gap(6).flex_none().items_center()
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(sec.title))
        .child(div().text_size(12).text_color(t.dim).child(String(sec.parts.reduce((n, g) => n + g.rows.length, 0))))] : []),
      ...sec.parts.flatMap(group),
    ];
    const scroll = this.scroll(`${tab.id}/list`);
    return v_flex().id(`jira-list-${tab.id}`).flex_1().min_w(0).min_h(0).overflow_y_scrollbar().pb(16)
      .when(Boolean(scroll), (el) => el.track_scroll(scroll))
      .when(Boolean(attention), (el) => el.child(this.attentionBox(t, tab, attention, group)))
      .children(sections.flatMap(section))
      .when(Boolean(more), (el) => el.child(more));
  }

  // Above a severity tab's sections: its open tickets at an attention level (`attention`, severitySections'), by level,
  // in a box with a red title and a red-tinted border, each level split To do / In progress (`group` draws a part, as
  // the list does). When the tab's attention count is more than the box holds and rows are left to load, the box ends
  // with how many aren't loaded and Load more (attentionNotLoaded). With nothing in it, one quiet line says so.
  attentionBox(t, tab, attention, group) {
    const s = this.state(tab.id);
    const missing = attentionNotLoaded(attention, this.counts.get(tab.id)?.attention, { left: s.total - s.rows.length, query: s.query });
    if (!attention.length && !missing) {
      return div().px(16).pt(12).pb(2).flex_none().text_size(12).text_color(t.dim).child("Nothing needs attention now");
    }
    const size = (sec) => sec.parts.reduce((n, g) => n + g.rows.length, 0);
    const level = (sec) => [
      h_flex().h(30).px(16).pt(8).gap(6).flex_none().items_center()
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(sec.title))
        .child(div().text_size(11.5).text_color(t.dim).child(String(size(sec)))),
      ...sec.parts.flatMap(group),
    ];
    const shown = attention.reduce((n, sec) => n + size(sec), 0);
    const more = missing ? this.more(t, "jira-more-attention") : null;
    return v_flex().id("jira-attention").flex_none().mx(10).mt(12).mb(2).pb(6).rounded(10).overflow_hidden()
      .border_1().border_color(tint(t.blocked, 0.55))
      .child(h_flex().h(36).px(16).pt(6).gap(6).flex_none().items_center()
        .child(div().text_size(13).font_semibold().text_color(t.blocked).child("Needs attention now"))
        .when(shown > 0, (el) => el.child(div().text_size(12).text_color(t.dim).child(String(shown)))))
      .children(attention.flatMap(level))
      .when(missing > 0, (el) => el.child(h_flex().flex_none().pl(16).items_center()
        .child(div().text_size(12).text_color(t.muted).child(`${missing} more not loaded`))
        .when(Boolean(more), (x) => x.child(more))));
  }

  // `severity`: the shown tab's, for the card's chip (null on Today's sprint board: no chips there).
  card(t, r, severity = null) {
    const on = this.selected === r.key;
    const dragged = this.drag?.row.key === r.key;
    const chip = severity && this.chip(t, r, severity);
    return v_flex().id(`jira-card-${r.key}`).p(10).gap(6).flex_none().rounded(8).cursor_pointer()
      .bg(on ? t.selected : (t.surface ?? t.chrome)).border_1().border_color(on ? t.accent : t.border).hover((s) => s.bg(t.hover))
      .when(dragged, (el) => el.opacity(0.35))
      .on_mouse_down("left", (e) => { this.press = { row: r, from: e.position }; })
      .on_click((_e, cx) => { if (!this.drag) this.select(r.key, cx); })
      .child(div().text_size(12.8).text_color(t.foreground).child(r.summary))
      .child(h_flex().gap(6).items_center()
        .child(this.typeMark(t, r))
        .when(Boolean(chip), (el) => el.child(chip))
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
    const tabId = this.tab().id;
    const severity = this.tab().severity;
    const board = this.scroll(`${tabId}/board`);
    const column = (c, i) => {
      const own = d && c.status === d.row.status;
      // A column's cards keep their place per tab and status; a drag's temporary column has nothing to keep.
      const cards = c.temporary ? null : this.scroll(`${tabId}/col/${c.status}`);
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
          .when(Boolean(cards), (el) => el.track_scroll(cards))
          .when(this.dropChoice?.status === c.status && !d, (el) => el.child(this.choiceBox(t)))
          .when(this.dropNote?.status === c.status && !d, (el) => el.child(this.noteBox(t)))
          .children(c.rows.map((r) => this.card(t, r, severity))));
    };
    return v_flex().id("jira-board-wrap").relative().flex_1().min_w(0).min_h(0)
      .on_mouse_move((e, cx) => this.pointerMoved(e, cx))
      .on_mouse_up("left", (_e, cx) => this.released(cx))
      .child(div().id(`jira-board-${tabId}`).flex().flex_row().flex_1().min_h(0).overflow_x_scrollbar().p(12).gap(12)
        .when(Boolean(board), (el) => el.track_scroll(board)).children(cols.map(column)))
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
    const finish = finishWork(d, this.options.actions);
    const lines = (text) => (text ? text.split("\n") : []).map((l) => (l.trim() ? div().child(l) : div().h(8)));
    const meta = (label, value) => h_flex().gap(8).child(div().w(70).flex_none().text_color(t.dim).child(label)).child(div().flex_1().min_w(0).truncate().child(value ?? "—"));
    return pane.child(top)
      .child(v_flex().id("jira-detail-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(14)
        .child(div().text_size(16).font_semibold().child(d.summary))
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(this.statusMenu(t, d))
          .when(canAssignToMe(d, this.me), (el) => el.child(this.button(t, "jira-assign", this.actionBusy === "assign" ? "Assigning…" : "Assign to me",
            (cx) => this.assignMe(cx), { enabled: !this.actionBusy })))
          .child(div().flex_1())
          .child(this.button(t, "jira-start", "Start work", (cx) => this.startWork(d, cx), { primary: true, tip: `Opens a Claude tab with:\n${startWork(d, startTemplate(this.options.actions, d, this.jira?.settings.startTask))?.args.task ?? ""}` }))
          .when(Boolean(finish), (el) => el.child(this.button(t, "jira-finish", "Finish", (cx) => this.finishWork(d, cx), { tip: `Opens a Claude tab named ${d.key} finish with:\n${finish.args.task}` })))
          .child(this.button(t, "jira-open", "Open in browser", () => this.openUrl(d.url))))
        .when(this.pendingStep?.key === d.key, (el) => el.child(this.stepBox(t)))
        .when(Boolean(this.actionMsg) || this.actionBusy === "transition", (el) => el.child(this.actionLine(t)))
        .child(v_flex().gap(4).text_size(12.5)
          .child(meta("Type", d.type)).child(meta("Priority", d.priority)).child(meta("Assignee", d.assignee ?? "Unassigned"))
          .child(meta("Reporter", d.reporter)).child(meta("Updated", d.updatedMs ? `${ago(d.updatedMs, Date.now())} ago` : null)))
        // What changed (an unread Changed item of the brief) and Recent changes, above the description.
        .child(changeView(this, t))
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
    const root = v_flex().id("dock-jira").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_mouse_up("left", (_e, cx) => this.dragEnded(cx));
    if (state === "setup" || state === "settings") return root.child(this.settingsForm(t, state === "setup"));
    if (state === "problem") return root.child(this.problemView(t));
    if (state === "checking") {
      return root.child(v_flex().size_full().items_center().justify_center().gap(6)
        .child(div().text_size(14).child("Connecting to Jira…"))
        .child(div().text_size(12).text_color(t.dim).child(this.jira.settings.baseUrl)));
    }
    const s = this.shown();
    const message = (text) => v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(text);
    // Today: the brief, above the sprint board when the settings name a board.
    const body = this.tab().kind === "today"
      ? v_flex().flex_1().min_w(0).min_h(0).child(briefView(this, t)).when(this.options.board != null, (el) => el.child(sprintBoard(this, t)))
      : s.listProblem
        ? v_flex().flex_1().p(24).gap(6).child(div().text_size(13).text_color(t.blocked).child(s.listProblem.message)).child(div().text_size(12).text_color(t.dim).child(s.listProblem.hint))
        : !s.fetchedAt ? message("Loading…") // a tab shown for the first time
          : !s.rows.length && !s.loading
            ? message(s.query ? `Nothing matches "${s.query}".` : "No issues in this filter.")
            : this.layout() === "board" ? this.boardView(t) : this.listView(t);
    return root.child(this.header(t))
      .child(tabBar(this, t))
      // A plain flex row (h_flex centers vertically): the list, board and detail fill the height.
      .child(div().flex().flex_row().flex_1().min_h(0).child(body).when(Boolean(this.selected), (el) => el.child(this.detailView(t))));
  }
}
