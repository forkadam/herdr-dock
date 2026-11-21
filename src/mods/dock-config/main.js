// The "Dock layout" dialog: places installed mods in the top, left, right or bottom region (or
// switches them off) and saves the edits to this PC's machines.<host> section of config/dock.json.
// Opened by mod.open {name:"dock-config"} (dock-core.config, Ctrl+Alt+,). A view over session.js.
// Icons: chevron-down.svg, x.svg, plus.svg and icon.svg (panel-left.svg) are copied from Herdr's
// shipped workspace-chrome mod; chevron-up.svg (chevron-down flipped) and lock.svg are lucide's.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Tabs, Tab } from "gpui-base";
import {
  appHome, checking, closeOverlay, exec, props, readTextFile, setShared, shared, theme, window, writeTextFile,
} from "herdr";
import { DEFAULT_CONFIG } from "../../shared/config.js";
import { applyEdit, draftFromConfig } from "../../shared/edit.js";
import { buildInventory } from "../../shared/inventory.js";
import { slashPath } from "../../shared/path.js";
import { isDirty, loadSession, resetSession, saveSession } from "./session.js";
import { byMod } from "./by-mod.js";
import { byRegion } from "./by-region.js";
import { button } from "./ui.js";

const REGIONS = ["top", "left", "right", "bottom"];
const VIEW_KEY = "dock.config.view";
const VIEWS = [["region", "By region"], ["mod", "By mod"]];

const makeIo = () => ({
  readTextFile, writeTextFile, exec, shared, appHome: slashPath(appHome()), platform: window()?.platform,
});

// What `herdr-app check` renders: the default config, read-only, with no files read.
function checkSession() {
  const draft = draftFromConfig(DEFAULT_CONFIG, "");
  return { path: null, host: null, opened: null, draft, inventory: buildInventory([], draft), entries: [], readOnly: true, notice: null, error: null };
}

export default class DockConfig extends View {
  init(_props, cx) {
    this.session = null;
    this.loadError = null;
    this.editError = null; // the last refused edit, or a failed save
    this.busy = false; // a save or reset is running
    this.confirmReset = false;
    this.showAll = false;
    this.addOpen = null; // the region whose "+ Add mod" list is open
    this.sizes = {};
    for (const region of REGIONS) {
      const state = InputState.new({ value: "" });
      state.set_step(1);
      state.set_min(1);
      state.on("change", (_e, cx) => this.typedSize(region, cx));
      state.on("blur", () => this.showSize(region));
      this.sizes[region] = state;
    }
    if (checking()) {
      this.session = checkSession();
      return;
    }
    cx.spawn(async (cx) => {
      try {
        this.session = await loadSession(makeIo());
        this.showSizes();
      } catch (e) {
        this.loadError = `could not load the dock config: ${e?.message ?? e}`;
      }
      cx.notify();
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
    this.session = { ...s, draft, inventory: buildInventory(s.entries, draft) };
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

  step(region, delta, cx) {
    if (!this.session) return;
    this.act(cx, { type: "size", region, value: this.session.draft.regions[region].size + delta });
    this.showSize(region);
  }

  // Save or reset; edits wait (editable() is false) until it's done.
  write(cx, fn) {
    if (!this.session || this.session.readOnly || this.busy) return;
    this.busy = true;
    this.confirmReset = false;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.session = await fn(this.session, makeIo());
        this.editError = null;
        this.showSizes();
      } catch (e) {
        this.editError = `${e?.message ?? e}`;
      } finally {
        this.busy = false;
        cx.notify();
      }
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
          .child(button(t, "dc-reset-yes", "Yes", { enabled: canWrite }, (_e, cx) => this.write(cx, resetSession)))
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
      .child(button(t, "dc-save", this.busy ? "Saving…" : "Save", { primary: true, enabled: canWrite && dirty },
        (_e, cx) => this.write(cx, saveSession)))
      .when(dirty, (el) => el.child(div().flex_none().text_size(12).text_color(t.accent).child("● unsaved")));
  }

  render() {
    const t = theme();
    const view = shared(VIEW_KEY) === "mod" ? "mod" : "region";
    const body = this.session
      ? (view === "mod" ? byMod(this, t) : byRegion(this, t))
      : [div().py(24).text_color(t.dim).child(this.loadError ? "Couldn't load the dock config." : "Loading…")];
    return v_flex().id("dock-config").size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .child(v_flex().flex_none().px(16).pt(14).pb(10).gap(10).child(this.header(t)).child(this.banner(t)).child(this.tabs(t, view)))
      .child(v_flex().id("dc-body").flex_1().min_h(0).overflow_y_scrollbar().px(16).pb(8).children(body))
      .child(this.footer(t));
  }
}
