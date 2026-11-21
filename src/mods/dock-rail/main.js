// The rail on the far right: one icon per right-region mod, in config order. Clicking a mod that
// isn't showing opens it in the right panel; clicking the one showing hides the panel. The state
// is this PC's (shared dock.right.shown / dock.right.active); dock-core applies it to the layout.
import { View, div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { appHome, checking, readTextFile, setShared, shared, theme } from "herdr";
import { railClick, rightActiveOf, rightShownOf } from "../../shared/panel.js";
import { slashPath } from "../../shared/path.js";

// Herdr's shipped panels have no title or manifest: their own icons and names.
const KNOWN = {
  files: { title: "Files", icon: "mods/files/file.svg" },
  changes: { title: "Changes", icon: "mods/changes/changes.svg" },
};

const parse = (text) => { try { return JSON.parse(text ?? "null"); } catch { return null; } };

export default class DockRail extends View {
  init() {
    this.meta = {}; // mod id -> { title, icon } (icon null: letter badge)
    this.loading = new Set();
  }

  // A mod's title and icon: KNOWN, else mod.json's title / manifest name, and the manifest icon
  // or mods/<id>/icon.svg when that file exists.
  load(id, cx) {
    if (this.meta[id] || this.loading.has(id) || checking()) return;
    this.loading.add(id);
    cx.spawn(async (cx) => {
      const home = slashPath(appHome());
      let meta = KNOWN[id] ?? null;
      if (!meta) {
        const mod = parse(await readTextFile(`${home}/mods/${id}/mod.json`).catch(() => null));
        const manifest = parse(await readTextFile(`${home}/mods/${id}/manifest.json`).catch(() => null));
        let icon = typeof manifest?.icon === "string" ? `mods/${id}/${manifest.icon}` : null;
        if (!icon && (await readTextFile(`${home}/mods/${id}/icon.svg`).catch(() => null)) !== null) icon = `mods/${id}/icon.svg`;
        const title = (typeof mod?.title === "string" && mod.title) || (typeof manifest?.name === "string" && manifest.name) || id;
        meta = { title, icon };
      }
      this.meta[id] = meta;
      this.loading.delete(id);
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    const applied = shared("dock.config.applied");
    const features = applied?.right?.features ?? [];
    const shown = rightShownOf(shared("dock.right.shown"), applied);
    const active = rightActiveOf(shared("dock.right.active"), features);
    const item = (f, i) => {
      this.load(f.mod, cx);
      const meta = this.meta[f.mod];
      const title = meta?.title ?? f.mod;
      const on = shown && f.mod === active;
      const face = meta?.icon
        ? svg(meta.icon).size(16)
        : div().text_size(13).font_semibold().child(title.slice(0, 1).toUpperCase());
      return div().id(`rail-${i}-${f.mod}`).relative().size(30).flex_none().flex().items_center().justify_center().rounded(7)
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip(title)
        .on_click(() => {
          const next = railClick(shown, active, f.mod);
          if (next.active !== shared("dock.right.active")) setShared("dock.right.active", next.active);
          setShared("dock.right.shown", next.shown);
        })
        .when(on, (el) => el.child(div().absolute().left(-5).top(7).w(2).h(16).rounded(1).bg(t.accent)))
        .child(face);
    };
    return v_flex().id("dock-rail").size_full().bg(t.chrome).border_l(1).border_color(t.border)
      .pt(8).gap(4).items_center().overflow_y_scrollbar()
      .children(features.map(item));
  }
}
