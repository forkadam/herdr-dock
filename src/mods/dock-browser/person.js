// The Browser panel's buttons: Take over / Hand back (which also ends Pick and Notes), a handoff's Done / Cancel /
// Open in a real window, tabs, sizes and Enlarge. Mixed into the panel's class (main.js): `this` is the panel. Each button's work runs through act(), one
// at a time; the control record is written through writeControl (actions.js), the only writer.
import { openOverlay } from "herdr";
import { activeTab, pageHeading } from "../../shared/browser/frame.js";
import { NO_TERMINAL, bigWindow, changes, finishOf, inControl, newTabId, panelMode, pickKind, sizeCommands, windowLeft } from "../../shared/browser/panel.js";
import { isStale } from "../../shared/browser/registry.js";
import { STOP_SCRIPT } from "../../shared/browser/pick-script.js";
import { allRecords, browse, closeWindow, readControl, run, writeControl } from "./actions.js";

export const personControls = {
  mode() { return this.record ? panelMode(this.record, this.control, Date.now(), this.browser.handoffMinutes) : { kind: "view" }; },

  // Runs one button's work, one at a time, with its label shown; a failure is shown under the buttons. Nothing runs
  // until the terminal is known (hc get): its control record can't be written without that.
  act(label, cx, work) {
    if (this.busy || !this.terminal || !this.record) return;
    const t = this.terminal, rec = this.record;
    this.busy = label;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (this.created == null && this.terminal === t) this.created = await this.createdOf(t);
        if (this.terminal !== t) throw new Error("The terminal changed");
        if (this.created == null) throw new Error(NO_TERMINAL);
        await work(t, rec, cx);
      } catch (e) { if (this.terminal === t) this.error = String(e?.message ?? e); }
      this.busy = null;
      cx.notify();
    });
  },

  async setControl(t, change, created = this.created) {
    const c = await writeControl(t, created, change);
    if (!c) throw new Error("The control record couldn't be written");
    if (this.terminal === t) { this.control = c; this.controlChanged(); }
  },

  ab(rec, args) {
    const chrome = this.browser.chrome ? ["--executable-path", this.browser.chrome] : [];
    return run(this.bin(), ["--session", rec.session, ...chrome, ...args]);
  },

  takeOver(cx) { this.act("Taking over…", cx, (t) => this.setControl(t, changes.takeOver(Date.now()))); },

  // The real window finished, size tabs closed and the agent's tab and viewport back, Pick or Notes' script taken out,
  // then the page is the agent's again. What to finish comes from the control record, so it doesn't matter which copy
  // opened it.
  handBack(cx) {
    this.act("Handing back…", cx, async (t, rec) => {
      await this.finish(t, rec, true);
      await this.setControl(t, changes.handBack());
    });
  },

  // keep: the real window's state is kept (window-done, which fails, and so stops Done, when nothing was saved);
  // otherwise the window is just closed and its state files deleted (also when it was asked for but never opened).
  async finish(t, rec, keep, created = this.created) {
    const c = await readControl(t, created);
    const f = finishOf(c);
    if (f.window && keep) await browse(["window-done", "--terminal", t]);
    else if (f.window || c.takeover?.reason === "window") await closeWindow(this.bin(), t, rec.session);
    for (const args of f.restore) await this.ab(rec, args).catch(() => null);
    // Pick or Notes' script out of the page, once the agent's tab is the active one again (size tabs just closed).
    if (f.stopPick) await this.ab(rec, ["eval", STOP_SCRIPT]).catch(() => null);
  },

  answer(value, cx) {
    const h = this.mode().handoff;
    if (!h) return;
    this.act(value === "done" ? "Done…" : "Cancelling…", cx, async (t, rec) => {
      await this.finish(t, rec, value === "done");
      await this.setControl(t, changes.answer(h.id, value));
    });
  },

  // A real window whose handoff ran out (windowLeft): closed and the page handed back, for every terminal (one not
  // shown in the panel too), so the agent isn't left waiting on it. Run from the panel's timer.
  async releaseLeftWindows() {
    if (this.busy) return;
    for (const { session, control } of await allRecords()) {
      if (!windowLeft(session, control, Date.now(), this.browser.handoffMinutes)) continue;
      const t = session.terminal;
      const created = await this.createdOf(t);
      if (created == null || isStale(session, created)) continue;
      if (!windowLeft(session, await readControl(t, created), Date.now(), this.browser.handoffMinutes)) continue;
      await this.finish(t, session, false, created);
      await this.setControl(t, changes.handBack(), created);
    }
  },

  openWindow(cx) {
    if (!this.mode().handoff) return;
    this.act("Opening a window…", cx, async (t) => {
      await this.setControl(t, changes.window(Date.now()));
      await browse(["window-open", "--terminal", t]);
      await this.setControl(t, changes.windowOpened(Date.now()));
    });
  },

  // Another tab: the person takes the page first, so the agent never drives it at the same time.
  switchTab(tabId, cx) {
    this.act("Switching tab…", cx, async (t, rec) => {
      if (!inControl(this.mode())) await this.setControl(t, changes.takeOver(Date.now()));
      // Pointing: the script leaves the tab being left (marked off there); the new tab gets it on its URL change.
      if (pickKind(this.mode())) await this.ab(rec, ["eval", STOP_SCRIPT]).catch(() => null);
      await this.ab(rec, ["tab", tabId]);
    });
  },

  // The page at a size, in a new tab. agent-browser's viewport is the whole session's and the new tab becomes the
  // active one, so the person takes the page (the agent waits) and Hand back puts the agent's tab and size back.
  size(kind, cx) {
    const st = this.stream?.state ?? {};
    const { url } = pageHeading(this.record, st);
    const cmds = sizeCommands(kind, url);
    if (!cmds) return;
    const agentTab = activeTab(st.tabs)?.tabId ?? null, viewport = this.stream?.size ?? null;
    this.act("Opening the size…", cx, async (t, rec) => {
      if (!inControl(this.mode())) await this.setControl(t, changes.takeOver(Date.now()));
      const opened = await this.ab(rec, cmds[0]);
      const id = newTabId(opened.stdout);
      if (id) await this.setControl(t, changes.sizeTab(id, agentTab, viewport ? { w: viewport.w, h: viewport.h } : null));
      await this.ab(rec, cmds[1]);
    });
  },

  enlarge() {
    try { openOverlay(bigWindow(this.terminal)); } catch (e) { this.error = String(e?.message ?? e); }
  },
};
