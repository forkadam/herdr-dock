// The Pages bar (left panel), after cockpit's app bar: one row of icons on a raised strip, the Terminal first,
// then each dock page in config order, each with a count badge in its corner; the one shown sits on a raised
// tile. Clicking a page shows it in place of the terminal; clicking it again, or the Terminal, brings the
// terminal back. The state is this PC's (shared dock.page.active); dock-core applies it to the layout. A page
// sets its badge through shared dock.page.badge.<mod> (see view.js badgeOf). In icon mode: a column of icons.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, checking, props, readTextFile, setShared, shared, theme } from "herdr";
import { featureMode, requestFocus } from "../_feature.js";
import { PAGE_KEY, pageActiveOf, pageClick } from "../../shared/panel.js";
import { slashPath } from "../../shared/path.js";
import { badgeOf, pageMeta } from "./view.js";

const TERMINAL_ICON = "mods/workspace-chrome/terminal.svg";
const WARN = "#d29922";

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

  // A round count in the icon's top-right corner: red for "needs you", amber for a warning, else light.
  badge(t, b) {
    const bg = b.tone === "bad" ? (t.blocked ?? "#e5484d") : b.tone === "warn" ? WARN : t.foreground;
    return div().absolute().top(-5).right(-6).h(14).min_w(14).px(3).rounded(7).bg(bg)
      .flex().items_center().justify_center().text_size(9.5).font_semibold().text_color(t.chrome).child(b.text);
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
            .child(this.face(t, f, 16))
            .when(badgeOf(shared(`dock.page.badge.${f.mod}`)) !== null, (el) => el.child(this.badge(t, badgeOf(shared(`dock.page.badge.${f.mod}`)))));
        }));
    }
    if (face === "collapsed") {
      return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).child(this.header(t, () => requestFocus(myId)));
    }
    const tile = (id, on, tip, face, badge, onClick) => div().id(id).relative().size(30).flex_none().flex().items_center().justify_center()
      .rounded(7).cursor_pointer().tooltip(tip)
      .when(on, (el) => el.bg(t.raised ?? t.selected).border_1().border_color(t.border).text_color(t.foreground))
      .when(!on, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); })
      .child(face)
      .when(badge !== null, (el) => el.child(this.badge(t, badge)));
    const terminal = tile("page-terminal", active === null, "Terminal (Ctrl+Alt+P cycles the pages)",
      svg(TERMINAL_ICON).size(15), null, () => { if (active !== null) setShared(PAGE_KEY, null); });
    const pages = features.map((f, i) => {
      const title = f.props?.title ?? this.meta[f.mod]?.title ?? f.mod;
      const on = f.mod === active;
      return tile(`page-${i}-${f.mod}`, on, on ? `${title}: click to go back to the terminal` : title,
        this.face(t, f, 15), badgeOf(shared(`dock.page.badge.${f.mod}`)), () => this.open(f.mod));
    });
    return div().size_full().min_h(0).bg(t.chrome).px(8).py(6).flex().items_center()
      .child(h_flex().id("dock-pages-bar").w_full().h(40).px(5).gap(6).items_center().rounded(8)
        .bg(t.surface ?? t.background).border_1().border_color(t.border).overflow_x_scrollbar()
        .child(terminal)
        .when(!features.length, (el) => el.child(div().flex_1().px(6).truncate().text_size(11.5).text_color(t.dim)
          .tooltip("Add a page in the Dock layout dialog (Ctrl+Alt+,), section Pages.").child("no pages yet")))
        .children(pages));
  }
}
