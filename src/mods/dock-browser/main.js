// Browser: the page an agent is driving with `browse`, live in the right panel. It follows the agent in front (like
// Render), reads that terminal's session record (herdr-dock/browser/sessions/<terminal>.json, written by browse) and,
// while the panel shows, holds the session's stream: frames drawn as two stacked image() layers (the previous one
// under the new one, so a frame still loading never shows as nothing). View-only here, except the wheel.
// Every 30 s while shown it closes the browsers of terminals that are gone.
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, checking, exec, focused, hc, props, readTextFile, shared, theme, watchFolder, window } from "herdr";
import * as fs from "fs/promises";
import { slashPath } from "../../shared/path.js";
import { rightActiveOf, rightShownOf } from "../../shared/panel.js";
import { pickAgent } from "../../shared/render/agent.js";
import { installOf } from "../../shared/install.js";
import { mergeWithLocal, parseConfig, parseLocal } from "../../shared/config.js";
import { browserOf } from "../../shared/browser/config.js";
import { isProduction } from "../../shared/browser/hosts.js";
import { binRel, controlFileRel, framesRel, sessionFileRel, sessionsRel } from "../../shared/browser/session.js";
import { goneSessions, isStale, liveTerminals, parseControl, parseSession } from "../../shared/browser/registry.js";
import { afterLoss, drawnHeight, pageHeading, streamPort, wheelEvent } from "../../shared/browser/frame.js";
import { Stream, clearFolder } from "./stream.js";

const MOD = "dock-browser";
const PAD = 12;
const SWEEP_MS = 30_000;
const LOSS_GRACE_MS = 1000;
const CLOSED_MS = 3000; // "The browser closed." stays at least this long before the empty state
const EMPTY = "No page yet. The agent opens one with browse open.";

const home = () => slashPath(appHome());
const nodePlatform = (p) => (p === "windows" ? "win32" : p === "macos" ? "darwin" : "linux");

export default class Browser extends View {
  init(_props, cx) {
    this.width = 0; // the panel's width, once laid out
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
    cx.timer.every(SWEEP_MS, (cx) => { if (this.shown()) cx.spawn(async () => this.sweep()); });
  }

  shown() {
    if (props()?.dockRegion !== "right") return true;
    const applied = shared("dock.config.applied");
    return rightShownOf(shared("dock.right.shown"), applied) && rightActiveOf(shared("dock.right.active"), applied?.right?.features ?? []) === MOD;
  }

  bin() { return `${home()}/${binRel(nodePlatform(window()?.platform))}`; }

  // Called from render: notices the panel showing or hiding and the agent in front changing.
  follow(cx) {
    if (checking()) return;
    const shown = this.shown();
    let agent = null;
    if (shown) { try { agent = pickAgent(focused(), agents()); } catch { agent = null; } }
    // Records are this machine's: an agent on another machine (its address has a "/") has none here.
    const t = agent && !String(agent.address).includes("/") ? agent.address : null;
    const key = shown ? `shown|${t ?? "none"}` : "hidden";
    if (key === this.key) return;
    const wasShown = this.key !== null && this.key !== "hidden";
    this.key = key;
    this.stopStream();
    Object.assign(this, { terminal: t, created: null, record: null, control: parseControl(null), closed: null, showErrors: false });
    if (!shown) { this.watch?.cancel?.(); this.watch = null; return; }
    if (!wasShown) {
      this.watchSessions(cx);
      cx.spawn(async (cx) => { await this.loadConfig(); await this.sweep(); cx.notify(); });
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
      port: rec.port, framesRel: framesRel(t),
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
    }
  }

  // ---- drawing ----

  note(t, text) {
    return div().p(PAD + 2).text_size(12.5).text_color(t.dim).child(text);
  }

  chip(t, text, color) {
    return div().flex_none().px(6).h(18).flex().items_center().rounded(4).border_1().border_color(color ?? t.border)
      .text_size(10.5).text_color(color ?? t.muted).child(text);
  }

  header(t) {
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
          .when(!tab.active, (e) => e.text_color(t.muted))
          .child(String(tab.title || tab.url || "Tab"))))))
      .when(this.showErrors && errors > 0, (el) => el.child(v_flex().id("browser-error-list").mt(4).max_h(140).overflow_y_scrollbar()
        .gap(2).p(6).rounded(6).border_1().border_color(t.border)
        .children((st.errorTexts ?? []).slice().reverse().map((e, i) =>
          div().id(`browser-error-${i}`).text_size(11).text_color(t.blocked).child(String(e).slice(0, 400))))));
  }

  picture(t) {
    const s = this.stream;
    const drawnW = Math.floor(this.width - PAD * 2);
    if (!s?.frame || !s.size || drawnW <= 0) return this.note(t, s?.state.phase === "connecting" && s.loss.lastReconnect ? "Reconnecting…" : "Connecting…");
    const h = Math.round(drawnHeight(s.size, drawnW));
    const layer = (rel) => div().absolute().top(0).left(0).child(image(rel).w(drawnW).h(h));
    return div().id("browser-page").relative().w(drawnW).h(h).overflow_hidden().rounded(4).border_1().border_color(t.border)
      .on_scroll_wheel((e, cx) => {
        if (!s.size || !e.local_position) return;
        s.send(wheelEvent(e, s.size.w, drawnW));
        cx.stop_propagation();
      })
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
    return root.child(this.header(t))
      .child(v_flex().id("browser-body").flex_1().min_h(0).overflow_y_scrollbar().p(PAD).child(this.picture(t)));
  }

  async close() { this.stopStream(); }
}
