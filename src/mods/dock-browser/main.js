// Browser: the page an agent is driving with `browse`, live in the right panel. It follows the agent in front (like
// Render), reads that terminal's session record (herdr-dock/browser/sessions/<terminal>.json, written by browse) and,
// while the panel shows, holds the session's stream: frames drawn as two stacked image() layers (the previous one
// under the new one, so a frame still loading never shows as nothing). Only the wheel reaches the page until the
// person has it (Take over, or a handoff the agent asked for): then clicks and keys go to it too, over the stream
// and nowhere else. It announces new handoffs, and every 30 s while shown closes the browsers of terminals that are
// gone. Enlarge opens a copy of it as a big window (props { big, terminal }) on the same terminal.
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, checking, closeOverlay, exec, focused, hc, nextCommand, props, readTextFile, shared, theme, watchFolder, window } from "herdr";
import * as fs from "fs/promises";
import { slashPath } from "../../shared/path.js";
import { rightActiveOf, rightShownOf } from "../../shared/panel.js";
import { pickAgent } from "../../shared/render/agent.js";
import { installOf } from "../../shared/install.js";
import { mergeWithLocal, parseConfig, parseLocal } from "../../shared/config.js";
import { browserOf } from "../../shared/browser/config.js";
import { isProduction } from "../../shared/browser/hosts.js";
import { bigFramesRel, binRel, controlFileRel, framesRel, sessionFileRel, sessionsRel } from "../../shared/browser/session.js";
import { goneSessions, isStale, liveTerminals, parseControl, parseSession } from "../../shared/browser/registry.js";
import { afterLoss, drawnHeight, keyEvents, mouseEvents, pageHeading, streamPort, wheelEvent } from "../../shared/browser/frame.js";
import { fitWidth, inControl } from "../../shared/browser/panel.js";
import { Stream, clearFolder } from "./stream.js";
import { controlBar, errorLine, handoffBar } from "./controls.js";
import { announceHandoffs } from "./actions.js";
import { personControls } from "./person.js";

const MOD = "dock-browser";
const PAD = 12;
const SWEEP_MS = 30_000;
const LOSS_GRACE_MS = 1000;
const CLOSED_MS = 3000; // "The browser closed." stays at least this long before the empty state
const EMPTY = "No page yet. The agent opens one with browse open.";
const MOVE_MS = 30; // at most one pointer move per this to the page

const home = () => slashPath(appHome());
const nodePlatform = (p) => (p === "windows" ? "win32" : p === "macos" ? "darwin" : "linux");

export default class Browser extends View {
  init(_props, cx) {
    this.big = !!props()?.big; // the Enlarge window
    this.h = cx.focus_handle(); // the picture's, while the person has the page
    this.width = 0; // the panel's width, once laid out
    this.bodyH = 0; // the room under the header (the big window fits the picture in it)
    this.busy = null; // what a button started and is still running, shown beside the buttons
    this.error = null; // the last button's failure
    this.windowOpen = null; // { terminal, id }: "Open in a real window" is open for this handoff
    this.sizes = null; // { terminal, tabs, agentTab, viewport }: size tabs the panel opened, undone on Hand back
    this.pressed = false; // the left button is down on the picture (moves are a drag)
    this.lastMove = 0;
    this.key = null; // "hidden" | "shown|<terminal or none>": what follow() last acted on
    this.terminal = null;
    this.created = null; // the terminal's created_ms (hc), null when hc couldn't say
    this.record = null; // its session record (parseSession), null for none or stale
    this.control = parseControl(null);
    this.stream = null;
    this.closed = null; // { at, opened } after the browser went away under the panel
    this.showErrors = false;
    this.browser = browserOf(null);
    this.watch = null;
    if (checking()) return;
    cx.timer.every(SWEEP_MS, (cx) => {
      if (this.big) { cx.notify(); return; } // a handoff timing out redraws
      if (this.shown()) cx.spawn(async () => this.sweep());
      cx.notify();
    });
    if (!this.big) this.watchHandoffs(cx);
    // Commands: "focus" (pane.go onto this copy, or a popup over it closed): the keyboard goes to the page while the
    // person has it. "enlarge" (keys.json can bind "dock-browser.enlarge"): the big window.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus" && this.record && inControl(this.mode())) this.h.focus();
        if (c === "enlarge" && !this.big && this.terminal) this.enlarge();
        cx.notify();
      }
    });
  }

  shown() {
    if (this.big || props()?.dockRegion !== "right") return true;
    const applied = shared("dock.config.applied");
    return rightShownOf(shared("dock.right.shown"), applied) && rightActiveOf(shared("dock.right.active"), applied?.right?.features ?? []) === MOD;
  }

  bin() { return `${home()}/${binRel(nodePlatform(window()?.platform))}`; }

  framesOf(t) { return this.big ? bigFramesRel(t) : framesRel(t); }

  // Called from render: notices the panel showing or hiding and the agent in front changing.
  follow(cx) {
    if (checking()) return;
    const shown = this.shown();
    let agent = null;
    const fixed = this.big ? props()?.terminal : null; // the big window stays on the terminal it was opened for
    if (fixed) agent = { address: String(fixed) };
    else if (shown) { try { agent = pickAgent(focused(), agents()); } catch { agent = null; } }
    // Records are this machine's: an agent on another machine (its address has a "/") has none here.
    const t = agent && !String(agent.address).includes("/") ? agent.address : null;
    const key = shown ? `shown|${t ?? "none"}` : "hidden";
    if (key === this.key) return;
    const wasShown = this.key !== null && this.key !== "hidden";
    this.key = key;
    this.stopStream();
    Object.assign(this, { terminal: t, created: null, record: null, control: parseControl(null), closed: null, showErrors: false, error: null });
    if (!shown) { this.watch?.cancel?.(); this.watch = null; return; }
    if (!wasShown) {
      this.watchSessions(cx);
      cx.spawn(async (cx) => { await this.loadConfig(); if (!this.big) await this.sweep(); cx.notify(); });
    }
    if (t) {
      cx.spawn(async (cx) => {
        const created = await this.createdOf(t);
        if (this.terminal !== t) return;
        this.created = created;
        await this.readRecords(cx);
      });
    }
  }

  // The merged config's browser section, read the way dock-core does (source.json → config + local.json).
  async loadConfig() {
    try {
      const h = home();
      const src = JSON.parse((await readTextFile(`${h}/mods/dock-core/source.json`)) ?? "null");
      const install = installOf(src, h);
      if (!install) return;
      const parsed = parseConfig((await readTextFile(install.configPath)) ?? "");
      if (!parsed.ok) return;
      const local = parseLocal(await readTextFile(`${h}/herdr-dock/local.json`).catch(() => null));
      const host = shared("dock.host");
      this.browser = browserOf(mergeWithLocal(parsed.config, typeof host === "string" ? host : null, local.ok ? local.local : null));
    } catch (e) {
      console.log(`${MOD}: config not read: ${e?.message ?? e}`);
    }
  }

  async createdOf(t) {
    try {
      const r = await hc(["get", t]);
      const c = r.code === 0 ? JSON.parse(r.stdout).created_ms : null;
      return Number.isFinite(c) ? c : null;
    } catch { return null; }
  }

  // This terminal's session record, or null (none, unreadable, or left by an older terminal with the same id).
  async sessionOf(t) {
    const rec = parseSession(await readTextFile(`${home()}/${sessionFileRel(t)}`).catch(() => null));
    return rec && this.created != null && isStale(rec, this.created) ? null : rec;
  }

  async readRecords(cx) {
    const t = this.terminal;
    if (!t) return;
    const rec = await this.sessionOf(t);
    const text = await readTextFile(`${home()}/${controlFileRel(t)}`).catch(() => null);
    if (this.terminal !== t) return;
    const control = parseControl(text);
    this.control = text != null && this.created != null && isStale(control, this.created) ? parseControl(null) : control;
    // `browse close` deletes the record: the page shown goes away with a word, not silently.
    if (!rec && this.stream && !this.closed) this.closed = this.closedNow(cx, this.record?.opened ?? null);
    this.record = rec;
    // A browser opened again (a new record) ends "The browser closed."
    if (this.closed && rec && rec.opened !== this.closed.opened) this.closed = null;
    this.syncStream(cx);
    cx.notify();
  }

  // Re-reads the records when the sessions folder changes, while the panel shows.
  watchSessions(cx) {
    const dir = `${home()}/${sessionsRel()}`;
    const gen = this.watchGen = (this.watchGen ?? 0) + 1; // one loop at a time: an older one ends
    const done = () => this.key === "hidden" || this.watchGen !== gen;
    cx.spawn(async (cx) => {
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
      for (;;) {
        if (done()) return;
        let changed;
        try { this.watch = watchFolder(dir); changed = await this.watch; } catch { await cx.sleep(3000); continue; }
        if (done()) return;
        if (!changed?.length) { await cx.sleep(1000); continue; }
        await this.readRecords(cx);
      }
    });
  }

  // A stream while there is a live record to show; none otherwise.
  syncStream(cx) {
    const rec = this.record;
    // A record without a port (browse couldn't read it) fails to connect and finds the port through lost().
    const want = this.key !== "hidden" && rec && !this.closed;
    if (this.stream && (!want || this.stream.session !== rec.session)) this.stopStream();
    if (!want || this.stream) return;
    const t = this.terminal;
    const s = new Stream({
      port: rec.port, framesRel: this.framesOf(t),
      onChange: () => { if (this.stream === s) cx.notify(); },
      onLost: () => { if (this.stream === s) cx.spawn(async (cx) => this.lost(s, cx)); },
    });
    s.session = rec.session;
    this.stream = s;
    s.start(cx);
  }

  stopStream() {
    this.stream?.stop();
    this.stream = null;
  }

  // The socket went away: reconnect on the daemon's current port, or the browser closed. It first gives `browse
  // close` a moment to delete the record, since asking a closing session for its port starts an empty daemon.
  async lost(s, cx) {
    await cx.sleep(LOSS_GRACE_MS);
    for (;;) {
      if (this.stream !== s) return;
      const rec = await this.sessionOf(this.terminal);
      const what = afterLoss(s.loss, !!rec && rec.session === s.session, Date.now());
      if (what === "wait") { await cx.sleep(500); continue; }
      let port = 0;
      if (what === "reconnect") {
        const r = await exec(this.bin(), ["--session", s.session, "stream", "status", "--json"]).catch(() => null);
        port = r?.code === 0 ? streamPort(r.stdout) : 0;
      }
      if (this.stream !== s) return;
      if (port) { s.reconnect(port, cx); return; }
      this.stopStream();
      this.closed = this.closedNow(cx, rec?.opened ?? null);
      cx.notify();
      return;
    }
  }

  // "The browser closed.", drawn again once its minimum time is up (then the empty state, unless the record stays).
  closedNow(cx, opened) {
    cx.spawn(async (cx) => { await cx.sleep(CLOSED_MS + 100); cx.notify(); });
    return { at: Date.now(), opened };
  }

  // Sessions whose terminal is gone: their browser closed, their records and frames deleted.
  async sweep() {
    if (checking()) return;
    const r = await exec("herdr-app", ["ls"]).catch(() => null);
    const live = r?.code === 0 ? liveTerminals(r.stdout) : null;
    if (!live) return;
    const dir = `${home()}/${sessionsRel()}`;
    let names = [];
    try { names = await fs.readdir(dir); } catch { return; }
    const sessions = [];
    for (const n of names) {
      if (!n.endsWith(".json") || n.endsWith(".control.json")) continue;
      const rec = parseSession(await readTextFile(`${dir}/${n}`).catch(() => null));
      if (rec) sessions.push(rec);
    }
    for (const g of goneSessions(sessions, live)) {
      const chrome = this.browser.chrome ? ["--executable-path", this.browser.chrome] : [];
      await exec(this.bin(), ["--session", g.session, ...chrome, "close"]).catch(() => null);
      await fs.unlink(`${home()}/${sessionFileRel(g.terminal)}`).catch(() => {});
      await fs.unlink(`${home()}/${controlFileRel(g.terminal)}`).catch(() => {});
      await clearFolder(framesRel(g.terminal));
      await clearFolder(bigFramesRel(g.terminal));
    }
  }

  // New handoffs, announced whether or not the panel shows (the notification is how the person finds out).
  watchHandoffs(cx) {
    const dir = `${home()}/${sessionsRel()}`;
    cx.spawn(async (cx) => {
      await this.loadConfig();
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
      for (;;) {
        await announceHandoffs(this.browser.handoffMinutes).catch((e) => console.log(`${MOD}: handoffs not read: ${e?.message ?? e}`));
        let w;
        try { w = watchFolder(dir); } catch { await cx.sleep(3000); continue; }
        const changed = await w.catch(() => null);
        if (!changed?.length) await cx.sleep(1000);
      }
    });
  }

  // ---- drawing ----

  note(t, text) {
    return div().p(PAD + 2).text_size(12.5).text_color(t.dim).child(text);
  }

  chip(t, text, color) {
    return div().flex_none().px(6).h(18).flex().items_center().rounded(4).border_1().border_color(color ?? t.border)
      .text_size(10.5).text_color(color ?? t.muted).child(text);
  }

  header(t, cx) {
    const rec = this.record, st = this.stream?.state ?? {};
    const { title, url } = pageHeading(rec, st);
    const prod = isProduction(url, this.browser.production);
    const errors = st.errors ?? 0;
    const tabs = Array.isArray(st.tabs) ? st.tabs : [];
    return v_flex().flex_none().px(PAD).pt(10).pb(8).gap(4).border_b(1).border_color(t.border)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().child(title || "Browser"))
        .when(!!prod, (el) => el.child(this.chip(t, "Production", t.blocked)))
        .child(this.chip(t, rec.profile === "signed-in" ? "signed-in" : "clean"))
        .when(errors > 0, (el) => el.child(div().id("browser-errors").flex_none().px(6).h(18).flex().items_center().rounded(4)
          .cursor_pointer().bg(t.blocked).text_size(10.5).text_color(t.background)
          .tooltip(this.showErrors ? "Hide the errors" : "The page's last console errors")
          .on_click((_e, cx) => { this.showErrors = !this.showErrors; cx.notify(); })
          .child(`${errors} error${errors === 1 ? "" : "s"}`))))
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(url))
      .when(tabs.length > 1, (el) => el.child(h_flex().gap(4).pt(2).overflow_hidden().children(tabs.map((tab, i) =>
        div().id(`browser-tab-${i}`).flex_shrink_1().min_w(0).max_w(160).truncate().px(7).h(20).rounded(4).text_size(11)
          .when(!!tab.active, (e) => e.bg(t.selected ?? t.hover).text_color(t.foreground))
          .when(!tab.active && !!tab.tabId, (e) => e.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
            .tooltip("Switch to this tab (you take the page)")
            .on_click((_e, cx) => this.switchTab(String(tab.tabId), cx)))
          .child(String(tab.title || tab.url || "Tab"))))))
      .when(this.showErrors && errors > 0, (el) => el.child(v_flex().id("browser-error-list").mt(4).max_h(140).overflow_y_scrollbar()
        .gap(2).p(6).rounded(6).border_1().border_color(t.border)
        .children((st.errorTexts ?? []).slice().reverse().map((e, i) =>
          div().id(`browser-error-${i}`).text_size(11).text_color(t.blocked).child(String(e).slice(0, 400))))));
  }

  picture(t, mode) {
    const s = this.stream;
    const room = this.big ? this.bodyH - PAD * 2 : 0;
    const drawnW = fitWidth(s?.size, this.width - PAD * 2, room);
    if (!s?.frame || !s.size || drawnW <= 0) return this.note(t, s?.state.phase === "connecting" && s.loss.lastReconnect ? "Reconnecting…" : "Connecting…");
    const h = Math.round(drawnHeight(s.size, drawnW));
    const layer = (rel) => div().absolute().top(0).left(0).child(image(rel).w(drawnW).h(h));
    const live = inControl(mode);
    const edge = mode.kind === "handoff" ? t.working : t.accent;
    // Input goes to the stream only (Stream.send): never logged, kept or sent anywhere else.
    const send = (msgs) => { for (const m of msgs) s.send(m); };
    return div().id("browser-page").relative().w(drawnW).h(h).overflow_hidden().rounded(4)
      .when(live, (el) => el.border_2().border_color(edge))
      .when(!live, (el) => el.border_1().border_color(t.border))
      .on_scroll_wheel((e, cx) => {
        if (!s.size || !e.local_position) return;
        s.send(wheelEvent(e, s.size.w, drawnW));
        cx.stop_propagation();
      })
      .when(live, (el) => el.track_focus(this.h)
        .on_mouse_down("left", (e, cx) => {
          this.h.focus();
          if (!s.size || !e.local_position) return;
          this.pressed = true;
          send(mouseEvents("down", e, s.size.w, drawnW));
          cx.stop_propagation();
        })
        .on_mouse_up("left", (e, cx) => {
          this.pressed = false;
          if (!s.size || !e.local_position) return;
          send(mouseEvents("up", e, s.size.w, drawnW));
          cx.stop_propagation();
        })
        .on_mouse_move((e) => {
          const now = Date.now();
          if (!s.size || !e.local_position || now - this.lastMove < MOVE_MS) return;
          this.lastMove = now;
          send(mouseEvents("move", e, s.size.w, drawnW, this.pressed));
        })
        .on_key_down((e, cx) => {
          const msgs = keyEvents(e);
          if (!msgs.length) return;
          send(msgs);
          cx.stop_propagation();
        }))
      .when(!!s.prev, (el) => el.child(layer(s.prev)))
      .child(layer(s.frame));
  }

  render(cx) {
    const t = theme();
    this.follow(cx);
    const root = v_flex().id("dock-browser").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { if (Math.abs((size?.width ?? 0) - this.width) > 2) { this.width = size.width; cx.notify(); } });
    const c = this.closed;
    if (c && (Date.now() - c.at < CLOSED_MS || (this.record && this.record.opened === c.opened))) {
      return root.child(this.note(t, "The browser closed."));
    }
    if (!this.record) return root.child(this.note(t, EMPTY));
    const mode = this.mode();
    if (mode.kind === "view") { this.windowOpen = null; this.pressed = false; }
    const handoff = mode.kind === "handoff";
    const windowOpen = handoff && this.windowOpen?.terminal === this.terminal && this.windowOpen.id === mode.handoff.id;
    return root.child(this.header(t, cx))
      .when(handoff, (el) => el.child(handoffBar(t, { message: mode.handoff.message, windowOpen, busy: this.busy }, {
        done: (cx) => this.answer("done", cx), cancel: (cx) => this.answer("cancel", cx), openWindow: (cx) => this.openWindow(cx),
      })))
      .child(controlBar(t, { control: mode.kind, big: this.big, busy: this.busy }, {
        takeOver: (cx) => this.takeOver(cx), handBack: (cx) => this.handBack(cx), size: (kind, cx) => this.size(kind, cx),
        enlarge: () => this.enlarge(), close: () => closeOverlay(props()?.overlay),
      }))
      .when(!!this.error, (el) => el.child(errorLine(t, this.error)))
      .child(v_flex().id("browser-body").flex_1().min_h(0).overflow_y_scrollbar().p(PAD)
        .on_size_change((size, cx) => { if (Math.abs((size?.height ?? 0) - this.bodyH) > 2) { this.bodyH = size.height; cx.notify(); } })
        .child(this.picture(t, mode)));
  }

  // Closing (the big window, or Herdr): the frames folder goes before the copy does.
  async close() {
    const s = this.stream;
    this.stream = null;
    await s?.stop();
  }
}

Object.assign(Browser.prototype, personControls);
