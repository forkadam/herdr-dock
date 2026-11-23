// The Browser panel's buttons: Take over / Hand back, a handoff's Done / Cancel / Open in a real window, tabs, sizes
// and Enlarge. Mixed into the panel's class (main.js): `this` is the panel. Each button's work runs through act(), one
// at a time; the control record is written through writeControl (actions.js), the only writer.
import { openOverlay } from "herdr";
import { realSessionName } from "../../shared/browser/session.js";
import { activeTab, pageHeading } from "../../shared/browser/frame.js";
import { bigWindow, changes, finishOf, inControl, newTabId, panelMode, sizeCommands } from "../../shared/browser/panel.js";
import { browse, readControl, run, writeControl } from "./actions.js";

export const personControls = {
  mode() { return this.record ? panelMode(this.record, this.control, Date.now(), this.browser.handoffMinutes) : { kind: "view" }; },

  // Runs one button's work, one at a time, with its label shown; a failure is shown under the buttons.
  act(label, cx, work) {
    if (this.busy || !this.terminal || !this.record) return;
    const t = this.terminal, rec = this.record;
    this.busy = label;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try { await work(t, rec); } catch (e) { if (this.terminal === t) this.error = String(e?.message ?? e); }
      this.busy = null;
      cx.notify();
    });
  },

  async setControl(t, change) {
    const c = await writeControl(t, this.created, change);
    if (!c) throw new Error("The control record couldn't be written");
    if (this.terminal === t) { this.control = c; this.controlChanged(); }
  },

  ab(rec, args) {
    const chrome = this.browser.chrome ? ["--executable-path", this.browser.chrome] : [];
    return run(this.bin(), ["--session", rec.session, ...chrome, ...args]);
  },

  takeOver(cx) { this.act("Taking over…", cx, (t) => this.setControl(t, changes.takeOver(Date.now()))); },

  // Size tabs closed and the agent's tab and viewport back, the real window finished, then the page is the agent's
  // again. What to finish comes from the control record, so it doesn't matter which copy opened it.
  handBack(cx) {
    this.act("Handing back…", cx, async (t, rec) => {
      await this.finish(t, rec, true);
      await this.setControl(t, changes.handBack());
    });
  },

  // keep: the real window's state is kept (window-done); otherwise the window is just closed.
  async finish(t, rec, keep) {
    const f = finishOf(await readControl(t, this.created));
    if (f.window) {
      if (keep) await browse(["window-done", "--terminal", t]);
      else await run(this.bin(), ["--session", realSessionName(rec.session), "close"]).catch(() => null);
    }
    for (const args of f.restore) await this.ab(rec, args).catch(() => null);
  },

  answer(value, cx) {
    const h = this.mode().handoff;
    if (!h) return;
    this.act(value === "done" ? "Done…" : "Cancelling…", cx, async (t, rec) => {
      await this.finish(t, rec, value === "done");
      await this.setControl(t, changes.answer(h.id, value));
    });
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
