// The Pages list (left panel): one row per dock page, in config order. Clicking a page shows it in place of the
// terminal; clicking the page shown brings the terminal back. The state is this PC's (shared dock.page.active);
// dock-core applies it to the layout. A page can show a badge here through shared dock.page.badge.<mod>.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, checking, props, readTextFile, setShared, shared, theme } from "herdr";
import { featureMode, requestFocus } from "../_feature.js";
import { PAGE_KEY, pageActiveOf, pageClick } from "../../shared/panel.js";
import { slashPath } from "../../shared/path.js";
import { badgeText, pageMeta } from "./view.js";

const parse = (text) => { try { return JSON.parse(text ?? "null"); } catch { return null; } };

export default class DockPages extends View {
  init() {
    this.meta = {}; // mod id -> { title, icon }
    this.loading = new Set();
  }

  load(id, cx) {
    if (this.meta[id] || this.loading.has(id) || checking()) return;
    this.loading.add(id);
    cx.spawn(async (cx) => {
      const home = slashPath(appHome());
      const mod = parse(await readTextFile(`${home}/mods/${id}/mod.json`).catch(() => null));
      const manifest = parse(await readTextFile(`${home}/mods/${id}/manifest.json`).catch(() => null));
      const hasIcon = (await readTextFile(`${home}/mods/${id}/icon.svg`).catch(() => null)) !== null;
      this.meta[id] = pageMeta(id, mod, manifest, hasIcon);
      this.loading.delete(id);
      cx.notify();
    });
  }

  open(mod) {
    const next = pageClick(pageActiveOf(shared(PAGE_KEY), this.features()), mod);
    setShared(PAGE_KEY, next);
  }

  features() { return shared("dock.config.applied")?.pages?.features ?? []; }

  face(t, f, size) {
    const meta = this.meta[f.mod];
    const title = f.props?.title ?? meta?.title ?? f.mod;
    return meta?.icon ? svg(meta.icon).size(size) : div().text_size(size - 3).font_semibold().child(title.slice(0, 1).toUpperCase());
  }

  header(t, onTitle) {
    const title = div().text_size(11.5).font_medium().text_color(t.dim).child("Pages");
    return h_flex().px(16).h(onTitle ? 31 : 41).pt(onTitle ? 0 : 14).pb(onTitle ? 0 : 5).flex_none().items_center()
      .child(onTitle
        ? title.id("dock-pages-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Pages").on_click(() => onTitle())
        : title);
  }

  render(cx) {
    const t = theme();
    const myId = props()?.dockFeature ?? "dock-pages";
    const features = this.features();
    for (const f of features) this.load(f.mod, cx);
    const active = pageActiveOf(shared(PAGE_KEY), features);
    const face = featureMode(shared("dock.left.mode"), shared("dock.left.focus"), myId, props()?.dockRegion);
    if (face === "icon") {
      return v_flex().size_full().w(48).min_h(0).bg(t.chrome).items_center().pt(8).gap(4)
        .children(features.map((f, i) => {
          const on = f.mod === active;
          const title = f.props?.title ?? this.meta[f.mod]?.title ?? f.mod;
          return div().id(`page-icon-${i}`).relative().size(32).flex_none().flex().items_center().justify_center().rounded(6)
            .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(title)
            .on_click((_e, cx) => { cx.stop_propagation(); this.open(f.mod); })
            .when(on, (el) => el.child(div().absolute().left(-8).top(8).w(2).h(16).rounded(1).bg(t.accent)))
            .child(this.face(t, f, 16));
        }));
    }
    if (face === "collapsed") {
      return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).child(this.header(t, () => requestFocus(myId)));
    }
    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .child(this.header(t, null))
      .child(v_flex().id("dock-pages-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).gap(1)
        .when(!features.length, (el) => el.child(div().px(8).py(4).text_size(12).text_color(t.dim)
          .tooltip("Add a page in the Dock layout dialog (Ctrl+Alt+,), region Pages.").child("no pages")))
        .children(features.map((f, i) => {
          const on = f.mod === active;
          const title = f.props?.title ?? this.meta[f.mod]?.title ?? f.mod;
          const badge = badgeText(shared(`dock.page.badge.${f.mod}`));
          return h_flex().id(`page-${i}-${f.mod}`).h(30).px(8).gap(8).flex_none().items_center().rounded(6)
            .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip(on ? `${title}: click to go back to the terminal (Ctrl+Alt+P cycles)` : title)
            .on_click(() => this.open(f.mod))
            .child(div().flex_none().size(16).flex().items_center().justify_center().child(this.face(t, f, 15)))
            .child(div().flex_1().min_w(0).truncate().text_size(13).child(title))
            .when(badge !== null, (el) => el.child(div().flex_none().px(6).rounded(8).bg(t.border).text_size(11).text_color(t.muted).child(badge)));
        })));
  }
}
