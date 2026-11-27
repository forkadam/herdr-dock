// src/mods/dock-pages/main.js
import { View, div as div2, svg as svg2 } from "gpui-kit";
import { v_flex as v_flex2, h_flex } from "gpui-base";
import { appHome, checking, props, readTextFile, setShared as setShared2, shared as shared2, theme } from "herdr";

// src/mods/_feature.js
import { div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { setShared, shared } from "herdr";

// src/mods/_feature-mode.js
function featureMode(sharedMode, focus, myId, region) {
  if (region !== "left") return "full";
  if (sharedMode === "icons") return "icon";
  if (sharedMode === "expanded" && focus != null && focus !== myId) return "collapsed";
  return "full";
}

// src/mods/_feature.js
function releaseFocus() {
  setShared("dock.left.focus", null);
}

// src/shared/layout.js
function pageActiveOf(active, features) {
  return typeof active === "string" && (features ?? []).some((f) => f.mod === active) ? active : null;
}

// src/shared/panel.js
var PAGE_KEY = "dock.page.active";
var pageClick = (active, mod) => active === mod ? null : mod;

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/mods/dock-pages/view.js
function pageMeta(id, modJson, manifest, hasIconSvg) {
  const title = typeof modJson?.title === "string" && modJson.title || typeof manifest?.name === "string" && manifest.name || id;
  const icon = typeof manifest?.icon === "string" && manifest.icon ? `mods/${id}/${manifest.icon}` : hasIconSvg ? `mods/${id}/icon.svg` : null;
  return { title, icon };
}
function badgeText(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v > 0 ? v > 99 ? "99+" : String(Math.round(v)) : null;
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 6);
  return null;
}
function badgeOf(v) {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const text2 = badgeText(v.count ?? v.text);
    if (text2 === null) return null;
    return { text: text2, tone: ["bad", "warn", "info"].includes(v.tone) ? v.tone : "info" };
  }
  const text = badgeText(v);
  return text === null ? null : { text, tone: "info" };
}

// src/mods/dock-pages/main.js
var TERMINAL_ICON = "mods/workspace-chrome/terminal.svg";
var WARN = "#d29922";
var parse = (text) => {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return null;
  }
};
var DockPages = class extends View {
  init() {
    this.meta = {};
    this.loading = /* @__PURE__ */ new Set();
  }
  load(id, cx) {
    if (this.meta[id] || this.loading.has(id) || checking()) return;
    this.loading.add(id);
    cx.spawn(async (cx2) => {
      const home = slashPath(appHome());
      const mod = parse(await readTextFile(`${home}/mods/${id}/mod.json`).catch(() => null));
      const manifest = parse(await readTextFile(`${home}/mods/${id}/manifest.json`).catch(() => null));
      const hasIcon = await readTextFile(`${home}/mods/${id}/icon.svg`).catch(() => null) !== null;
      this.meta[id] = pageMeta(id, mod, manifest, hasIcon);
      this.loading.delete(id);
      cx2.notify();
    });
  }
  open(mod) {
    const next = pageClick(pageActiveOf(shared2(PAGE_KEY), this.features()), mod);
    setShared2(PAGE_KEY, next);
  }
  features() {
    return shared2("dock.config.applied")?.pages?.features ?? [];
  }
  face(t, f, size) {
    const meta = this.meta[f.mod];
    const title = f.props?.title ?? meta?.title ?? f.mod;
    return meta?.icon ? svg2(meta.icon).size(size) : div2().text_size(size - 3).font_semibold().child(title.slice(0, 1).toUpperCase());
  }
  // A round count in the icon's top-right corner: red for "needs you", amber for a warning, else light.
  badge(t, b) {
    const bg = b.tone === "bad" ? t.blocked ?? "#e5484d" : b.tone === "warn" ? WARN : t.foreground;
    return div2().absolute().top(-5).right(-6).h(14).min_w(14).px(3).rounded(7).bg(bg).flex().items_center().justify_center().text_size(9.5).font_semibold().text_color(t.chrome).child(b.text);
  }
  header(t, onTitle) {
    const title = div2().text_size(11.5).font_medium().text_color(t.dim).child("Pages");
    return h_flex().px(16).h(onTitle ? 31 : 41).pt(onTitle ? 0 : 14).pb(onTitle ? 0 : 5).flex_none().items_center().child(onTitle ? title.id("dock-pages-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Pages").on_click(() => onTitle()) : title);
  }
  render(cx) {
    const t = theme();
    const myId = props()?.dockFeature ?? "dock-pages";
    const features = this.features();
    for (const f of features) this.load(f.mod, cx);
    const active = pageActiveOf(shared2(PAGE_KEY), features);
    const face = featureMode(shared2("dock.left.mode"), shared2("dock.left.focus"), myId, props()?.dockRegion);
    if (face === "icon") {
      return v_flex2().size_full().w(48).min_h(0).bg(t.chrome).items_center().pt(8).gap(4).children(features.map((f, i) => {
        const on = f.mod === active;
        const title = f.props?.title ?? this.meta[f.mod]?.title ?? f.mod;
        return div2().id(`page-icon-${i}`).relative().size(32).flex_none().flex().items_center().justify_center().rounded(6).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(title).on_click((_e, cx2) => {
          cx2.stop_propagation();
          this.open(f.mod);
        }).when(on, (el) => el.child(div2().absolute().left(-8).top(8).w(2).h(16).rounded(1).bg(t.accent))).child(this.face(t, f, 16)).when(badgeOf(shared2(`dock.page.badge.${f.mod}`)) !== null, (el) => el.child(this.badge(t, badgeOf(shared2(`dock.page.badge.${f.mod}`)))));
      }));
    }
    if (face === "collapsed") {
      return v_flex2().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).child(this.header(t, releaseFocus));
    }
    const tile = (id, on, tip, face2, badge, onClick) => div2().id(id).relative().size(30).flex_none().flex().items_center().justify_center().rounded(7).cursor_pointer().tooltip(tip).when(on, (el) => el.bg(t.raised ?? t.selected).border_1().border_color(t.border).text_color(t.foreground)).when(!on, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground))).on_click((_e, cx2) => {
      cx2.stop_propagation();
      onClick();
    }).child(face2).when(badge !== null, (el) => el.child(this.badge(t, badge)));
    const terminal = tile(
      "page-terminal",
      active === null,
      "Terminal (Ctrl+Alt+P cycles the pages)",
      svg2(TERMINAL_ICON).size(15),
      null,
      () => {
        if (active !== null) setShared2(PAGE_KEY, null);
      }
    );
    const pages = features.map((f, i) => {
      const title = f.props?.title ?? this.meta[f.mod]?.title ?? f.mod;
      const on = f.mod === active;
      return tile(
        `page-${i}-${f.mod}`,
        on,
        on ? `${title}: click to go back to the terminal` : title,
        this.face(t, f, 15),
        badgeOf(shared2(`dock.page.badge.${f.mod}`)),
        () => this.open(f.mod)
      );
    });
    return div2().size_full().min_h(0).bg(t.chrome).px(8).py(6).flex().items_center().child(h_flex().id("dock-pages-bar").w_full().h(40).px(5).gap(6).items_center().rounded(8).bg(t.surface ?? t.background).border_1().border_color(t.border).overflow_x_scrollbar().child(terminal).when(!features.length, (el) => el.child(div2().flex_1().px(6).truncate().text_size(11.5).text_color(t.dim).tooltip("Add a page in the Dock layout dialog (Ctrl+Alt+,), section Pages.").child("no pages yet"))).children(pages));
  }
};
export {
  DockPages as default
};
