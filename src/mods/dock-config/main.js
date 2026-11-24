// The "Dock layout" dialog: places installed mods in the top, left, right or bottom region (or
// switches them off) and saves the edits to this PC's local file (<app home>/herdr-dock/local.json,
// only what differs from config/dock.json merged with machines.<host>); it never writes config/dock.json.
// "Reset this PC to shared" empties the local file (Herdr has no delete API). The Browser section, below the
// Updates strip, turns the browser on or off at once (outside the draft) and edits its production hosts (in the draft).
// Opened by mod.open {name:"dock-config"} (dock-core.config, Ctrl+Alt+,). A view over session.js.
// Icons: chevron-down.svg, x.svg, plus.svg and icon.svg (panel-left.svg) are copied from Herdr's
// shipped workspace-chrome mod; chevron-up.svg (chevron-down flipped) and lock.svg are lucide's.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Tabs, Tab } from "gpui-base";
import {
  appHome, checking, closeOverlay, exec, props, readTextFile, run, setShared, shared, theme, window, writeTextFile,
} from "herdr";
import { DEFAULT_CONFIG } from "../../shared/config.js";
import { applyEdit, draftFromConfig, stepSize } from "../../shared/edit.js";
import { buildInventory } from "../../shared/inventory.js";
import { slashPath } from "../../shared/path.js";
import { UPDATE_KEY } from "../../shared/update.js";
import { isDirty, loadSession, readBrowserStatus, resetSession, saveSession, setBrowser } from "./session.js";
import { browserSectionView } from "./browser-section.js";
import {
  browserSection, chosenChrome, chromeChoices, clickedResult, parseHosts, pollDue, sectionCopy, setupWaits, turnOnChrome,
} from "./browser-view.js";
import { byMod } from "./by-mod.js";
import { byRegion } from "./by-region.js";
import { button } from "./ui.js";
import { updateRuns, updateStrip, updateWaits } from "./update-view.js";

const REGIONS = ["top", "left", "right", "bottom"];
const VIEW_KEY = "dock.config.view";
const VIEWS = [["region", "By region"], ["mod", "By mod"]];
const REPO_KEY = "dock.config.repo";
const BROWSER_POLL_MS = 3000;

const makeIo = () => ({
  readTextFile, writeTextFile, exec, run, shared, appHome: slashPath(appHome()), platform: window()?.platform,
});

// What `herdr-app check` renders: the default config, read-only, with no files read.
function checkSession() {
  const draft = draftFromConfig(DEFAULT_CONFIG, "");
  return {
    path: null, localPath: null, host: null, mode: null, baseText: null, opened: null, draft, baseDraft: draft, browserEnabled: false,
    inventory: buildInventory([], draft, { browserEnabled: false }), entries: [], readOnly: true, notice: null, error: null,
  };
}
// ...and the browser off, with nothing found.
const CHECK_BROWSER = { enabled: false, chrome: "", localChrome: null, sharedChrome: "", modInstalled: false, binInstalled: false, chromeExists: false, found: null, result: null, problem: null };

export default class DockConfig extends View {
  init(_props, cx) {
    this.session = null;
    this.loadError = null;
    this.editError = null; // the last refused edit, or a failed save
    this.busy = null; // "save", "reset" or "browser" while one is running
    this.confirmReset = false;
    this.showAll = false;
    this.addOpen = null; // the region whose "+ Add mod" list is open
    this.browser = null; // the Browser section's status (readBrowserStatus), null until read
    this.clicked = null; // { at, action }: the last click that ran a setup, until the result file shows it (clickedResult)
    this.reading = false; // a status read is under way
    this.browserDoing = null; // the browser action being written ("on" | "off" | "setup")
    this.readAgain = false; // ...and another was asked for meanwhile
    this.chromePick = undefined; // the Chrome Turn on uses (a path, or null to download); undefined: the first choice
    this.hostsError = null; // the production hosts field's text doesn't parse: Save waits
    this.hostsInput = InputState.new({ placeholder: "example.com, *.example.com" });
    this.hostsInput.on("change", (_e, cx) => this.typedHosts(cx));
    this.sizes = {};
    for (const region of REGIONS) {
      const state = InputState.new({ value: "" });
      state.set_step(1);
      state.set_min(1);
      state.on("change", (_e, cx) => this.typedSize(region, cx));
      // Leaving the field shows the draft's size again, so a refused size's error is stale.
      state.on("blur", (_e, cx) => {
        this.editError = null;
        this.showSize(region);
        cx.notify();
      });
      this.sizes[region] = state;
    }
    if (checking()) {
      this.session = checkSession();
      this.browser = CHECK_BROWSER;
      return;
    }
    // While a setup runs, the status is re-read every few seconds (the Running → On / Failed flip).
    cx.timer.every(BROWSER_POLL_MS, (cx) => {
      if (pollDue({ state: this.browserModel()?.section.state, reading: this.reading })) cx.spawn(async (cx) => this.readBrowser(cx));
    });
    cx.spawn(async (cx) => {
      try {
        this.session = await loadSession(makeIo());
        this.showSizes();
        this.showHosts();
      } catch (e) {
        this.loadError = `could not load the dock config: ${e?.message ?? e}`;
      }
      cx.notify();
      if (this.session) await this.readBrowser(cx);
    });
  }

  editable() {
    return Boolean(this.session) && !this.session.readOnly && !this.busy;
  }

  item(id) {
    return this.session.inventory.find((i) => i.id === id) ?? null;
  }

  // Every edit goes through applyEdit; a refused one leaves the draft and shows why.
  act(cx, op) {
    if (!this.editable()) return;
    const s = this.session;
    const ops = [op];
    // A mod placed into a hidden right or bottom region shows that region.
    if (op.type === "place" && (op.region === "right" || op.region === "bottom") && s.draft.regions[op.region].hidden) {
      ops.push({ type: "hidden", region: op.region, value: false });
    }
    let draft = s.draft;
    for (const o of ops) {
      const r = applyEdit(draft, o);
      if (r.error) {
        this.editError = r.error;
        cx.notify();
        return;
      }
      draft = r.draft;
    }
    this.editError = null;
    // A successful edit also clears the last save's error.
    this.session = { ...s, draft, inventory: buildInventory(s.entries, draft, { browserEnabled: s.browserEnabled }), error: null };
    cx.notify();
  }

  showSize(region) {
    const size = this.session?.draft.regions[region].size;
    this.sizes[region].set_value(size === undefined ? "" : String(size));
  }

  showSizes() {
    for (const region of REGIONS) this.showSize(region);
  }

  typedSize(region, cx) {
    const text = this.sizes[region].value().trim();
    if (!text || !this.session || Number(text) === this.session.draft.regions[region].size) return;
    this.act(cx, { type: "size", region, value: Number(text) });
  }

  // The production hosts field shows the draft's hosts again (after load, Save, Reset, a browser action).
  showHosts() {
    this.hostsError = null;
    this.hostsInput.set_value((this.session?.draft.production ?? []).join(", "));
  }

  // Valid hosts go into the draft; invalid ones show why under the field and hold Save back.
  typedHosts(cx) {
    if (!this.session) return;
    const r = parseHosts(this.hostsInput.value());
    this.hostsError = r.ok ? null : r.error;
    const now = this.session.draft.production ?? [];
    if (r.ok && r.hosts.join(",") !== now.join(",")) this.act(cx, { type: "production", hosts: r.hosts });
    else cx.notify();
  }

  step(region, delta, cx) {
    if (!this.session) return;
    const size = this.session.draft.regions[region].size;
    const value = stepSize(size, delta);
    if (value !== size) this.act(cx, { type: "size", region, value });
    this.showSize(region);
  }

  // Save or reset; edits wait (editable() is false) until it's done.
  write(cx, fn, kind) {
    if (!this.session || this.session.readOnly || this.busy) return;
    this.busy = kind;
    this.confirmReset = false;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.session = await fn(this.session, makeIo());
        this.editError = null;
        this.showSizes();
        this.showHosts();
      } catch (e) {
        this.editError = `${e?.message ?? e}`;
      } finally {
        this.busy = null;
        cx.notify();
      }
      // A file changed on disk may have turned the browser on or off.
      await this.readBrowser(cx);
    });
  }

  cancel() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  header(t) {
    const host = this.session?.host ?? shared("dock.host");
    return h_flex().gap(10).items_baseline()
      .child(div().text_size(15).font_semibold().child("Dock layout"))
      .child(div().text_size(12.5).text_color(t.dim).child(`this PC: ${host || "unknown"}`));
  }

  // The Updates strip: dock-core's update state, with Check now or Update.
  updates(t) {
    const state = checking() ? null : shared(UPDATE_KEY);
    const strip = updateStrip(state, Date.now());
    const color = { accent: t.accent, ok: t.done ?? t.accent, bad: t.blocked, dim: t.dim }[strip.tone] ?? t.dim;
    // Clone mode runs scripts/update.mjs in the repo; app mode runs the shipped update-app.mjs (no repo).
    const runs = updateRuns(state, { repo: shared(REPO_KEY), home: slashPath(appHome()) });
    const action = strip.action;
    // Update waits for a browser setup run (both deploy in a clone): two deploys never overlap. It also waits for
    // unsaved layout edits, which the reload an update causes would lose.
    const waits = this.updateWaits(action?.kind);
    const canUpdate = action?.kind !== "update" || (Boolean(runs) && !this.browserRunning() && !waits);
    return h_flex().id("dc-updates").gap(8).items_center().min_h(28)
      .child(div().flex_none().text_size(12.5).text_color(t.muted).child("Updates"))
      .child(div().flex_1().min_w(0).text_size(12.5).text_color(color).truncate()
        .child(strip.tone === "accent" ? `● ${strip.text}` : strip.text))
      .when(Boolean(action), (el) => el.child(button(t, `dc-update-${action.kind}`, action.label,
        { primary: action.kind === "update", enabled: canUpdate && !checking(), tip: waits }, () => this.updateAction(action.kind, runs))));
  }

  updateWaits(kind) {
    return updateWaits({ kind, dirty: Boolean(this.session) && isDirty(this.session) });
  }

  updateAction(kind, runs) {
    if (kind === "check") {
      run("dock-core.update.check");
      return;
    }
    if (!runs || this.browserRunning() || this.updateWaits(kind)) return;
    for (const r of runs) {
      if (r.args) run(r.command, r.args);
      else run(r.command);
    }
  }

  browserRunning() {
    return this.browserModel()?.section.state === "running";
  }

  // The Browser section's model: { section (browserSection), copy (sectionCopy), status, editable, enabled, tip (why the
  // buttons wait for unsaved edits, or null) }, or null until the status is read.
  browserModel() {
    const s = this.session;
    const st = this.browser;
    if (!s || !st) return null;
    const result = clickedResult(st.result, this.clicked);
    const updating = !checking() && shared(UPDATE_KEY)?.status === "updating";
    const section = browserSection({ ...st, result, updateRunning: updating, now: Date.now() });
    const editable = !s.readOnly;
    const how = this.browserRunsWith();
    const tip = editable && how ? setupWaits({ mode: how.mode, dirty: isDirty(s) }) : null;
    const enabled = editable && !this.busy && !section.busy && Boolean(how) && !tip;
    return { section, copy: sectionCopy(section, { ...st, result }), status: st, editable, enabled, tip };
  }

  // Where the setup runs, as the Updates strip's Update does: the clone's repo, or the app install's home. null: unknown.
  browserRunsWith() {
    const repo = shared(REPO_KEY) ?? null;
    const mode = this.session?.mode ?? shared(UPDATE_KEY)?.mode ?? (repo ? "clone" : null);
    return mode === "app" || repo ? { mode, repo } : null;
  }

  // Reads the status (again, when asked during a read). The init timer re-reads it while a setup runs.
  async readBrowser(cx) {
    if (!this.session) return;
    if (this.reading) {
      this.readAgain = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.readAgain = false;
        this.browser = await readBrowserStatus(this.session, makeIo());
        if (this.clicked && clickedResult(this.browser.result, this.clicked) === this.browser.result) this.clicked = null;
      } while (this.readAgain);
    } catch (e) {
      console.log(`dock-config: browser status not read: ${e?.message ?? e}`);
    } finally {
      this.reading = false;
    }
    cx.notify();
  }

  pickChrome(value, cx) {
    this.chromePick = value;
    cx.notify();
  }

  // Turn on (with the chosen Chrome; the download wins over a shared chrome), Turn off or Set up (this PC's chrome
  // passed through): written at once, then the "Set up the browser" tab. A local.json changed on disk is refused with
  // the changed-on-disk notice.
  browserAction(action, cx) {
    const how = this.browserRunsWith();
    if (!this.browserModel()?.enabled || !how) return;
    const chrome = action === "on"
      ? turnOnChrome(chosenChrome(chromeChoices(this.browser), this.chromePick), this.browser.sharedChrome)
      : this.browser.localChrome;
    const now = Date.now();
    this.busy = "browser";
    this.browserDoing = action;
    this.confirmReset = false;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await setBrowser(this.session, makeIo(), { action, chrome, ...how, now });
        this.session = r.session;
        this.editError = null;
        // Running from the click on, even before the status is re-read: a second click can't start a second run.
        if (r.ran) this.clicked = { at: now, action: action === "off" ? "off" : "on" };
        // As after a Save: a refused write rebased the draft onto the files.
        this.showSizes();
        this.showHosts();
      } catch (e) {
        this.editError = `${e?.message ?? e}`;
      } finally {
        this.busy = null;
        this.browserDoing = null;
        cx.notify();
      }
      await this.readBrowser(cx);
    });
  }

  banner(t) {
    const s = this.session;
    const errors = [...new Set([shared("dock.config.error"), s?.error, this.editError, this.loadError].filter(Boolean))];
    return v_flex().gap(6)
      .children(errors.map((e, i) => h_flex().id(`dc-error-${i}`).px(10).py(6).gap(8).rounded(8).text_size(12.5)
        .bg(t.blocked + "14").border_1().border_color(t.blocked + "40").text_color(t.foreground)
        .child(div().flex_none().text_color(t.blocked).child("⚠")).child(div().flex_1().min_w(0).child(String(e)))))
      .when(Boolean(s?.notice), (el) => el.child(div().px(2).text_size(12.5).text_color(t.muted).child(s.notice)));
  }

  tabs(t, view) {
    return h_flex().child(Tabs.new("dc-tabs").flex().flex_row().gap(2).p(2).rounded(8).bg(t.background)
      .border_1().border_color(t.border)
      .children(VIEWS.map(([value, text], i) => Tab.new(`dc-tab-${value}`).selected(view === value).set_position(i + 1, VIEWS.length)
        .flex().flex_row().items_center().h(24).px(12).rounded(6).text_size(12.5)
        .when(view === value, (el) => el.bg(t.selected).text_color(t.foreground))
        .when(view !== value, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click(() => setShared(VIEW_KEY, value))
        .child(text))));
  }

  footer(t) {
    const s = this.session;
    const canWrite = Boolean(s) && !s.readOnly && !this.busy;
    const dirty = Boolean(s) && isDirty(s);
    const reset = this.confirmReset
      ? h_flex().gap(6).items_center()
          .child(div().text_size(12.5).child("Reset this PC to shared?"))
          .child(button(t, "dc-reset-yes", "Yes", { enabled: canWrite }, (_e, cx) => this.write(cx, resetSession, "reset")))
          .child(button(t, "dc-reset-no", "No", {}, (_e, cx) => { this.confirmReset = false; cx.notify(); }))
      : h_flex().id("dc-reset").h(28).px(8).items_center().rounded(7).text_size(12.5).text_color(t.muted)
          .when(canWrite, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.confirmReset = true; cx.notify(); }))
          .when(!canWrite, (el) => el.opacity(0.4))
          .child("Reset this PC to shared");
    return h_flex().flex_none().h(52).px(16).gap(8).items_center().border_t(1).border_color(t.border)
      .child(reset)
      .child(div().flex_1())
      .child(button(t, "dc-cancel", "Cancel", {}, () => this.cancel()))
      .child(button(t, "dc-save", this.busy === "save" ? "Saving…" : "Save", { primary: true, enabled: canWrite && dirty && !this.hostsError },
        (_e, cx) => this.write(cx, saveSession, "save")))
      .when(dirty, (el) => el.child(div().flex_none().text_size(12).text_color(t.accent).child("● unsaved")));
  }

  render() {
    const t = theme();
    const view = shared(VIEW_KEY) === "mod" ? "mod" : "region";
    const body = this.session
      ? (view === "mod" ? byMod(this, t) : byRegion(this, t))
      : [div().py(24).text_color(t.dim).child(this.loadError ? "Couldn't load the dock config." : "Loading…")];
    return v_flex().id("dock-config").size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .child(v_flex().flex_none().px(16).pt(14).pb(10).gap(10).child(this.header(t)).child(this.updates(t))
        .child(browserSectionView(this, t)).child(this.banner(t)).child(this.tabs(t, view)))
      .child(v_flex().id("dc-body").flex_1().min_h(0).overflow_y_scrollbar().px(16).pb(8).children(body))
      .child(this.footer(t));
  }
}
