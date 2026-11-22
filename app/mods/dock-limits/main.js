// src/mods/dock-limits/main.js
import { View, div as div2 } from "gpui-kit";
import { h_flex as h_flex3, v_flex, HoverCard } from "gpui-base";
import { checking, knownAgents, shared, theme } from "herdr";

// src/mods/_bar.js
import { h_flex } from "gpui-base";
function barRow(t) {
  return h_flex().size_full().min_w(0).px(14).gap(16).items_center().overflow_hidden().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted);
}

// src/shared/claude.js
function formatPercent(p) {
  return `${Math.round(p)}% used`;
}
function formatAge(ms) {
  if (ms < 6e4) return "just now";
  const m = Math.floor(ms / 6e4);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function formatReset(resetsMs, nowMs) {
  const diff = resetsMs - nowMs;
  if (diff <= 0) return "resetting";
  const totalMin = Math.floor(diff / 6e4);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor(totalMin % 1440 / 60);
  const m = totalMin % 60;
  if (d > 0) return `resets in ${d}d ${h}h`;
  if (h > 0) return `resets in ${h}h ${String(m).padStart(2, "0")}m`;
  return `resets in ${m}m`;
}

// src/shared/claude-usage.js
var HOUR = 36e5;
var WEEK = 7 * 24 * HOUR;
var CLI_STALE_MS = 15 * 6e4;
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
function paceOf(w, nowMs) {
  if (!isNum(w?.durationMs) || !isNum(w?.resetsMs)) return null;
  const elapsed = w.durationMs - (w.resetsMs - nowMs);
  return Math.max(0, Math.min(1, elapsed / w.durationMs));
}
function planLabel(plan) {
  if (typeof plan !== "string" || !plan.trim()) return null;
  const words = plan.replace(/^claude[_-]/i, "").split(/[_\s-]+/).filter(Boolean);
  return words.map((w, i) => i === 0 ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

// src/mods/dock-quotas/view.js
var PROVIDERS = [
  { id: "claude", title: "Claude", agent: "claude", source: "Claude status line" },
  { id: "codex", title: "Codex", agent: "codex", source: "Codex session logs" },
  // `icon`: Herdr's shipped program icon, used when its agent table has no entry under `agent`.
  { id: "antigravity", title: "Antigravity", agent: "antigravity", icon: "icons/antigravity.svg", source: "Antigravity status line" }
];
var LABELS = { five_hour: "5-hour", weekly: "weekly" };
var sourceOf = (usage, provider) => usage.source === "cli" ? "Claude Code (/usage)" : provider.source;
var labelOf = (w) => w.kind === "model" ? `weekly \xB7 ${w.label}` : w.kind === "bucket" ? w.label : LABELS[w.kind] ?? w.kind;
var SHORT = { five_hour: "5h", weekly: "wk" };
var shortOf = (w) => w.kind === "model" ? w.label : w.kind === "bucket" ? w.short ?? w.label : SHORT[w.kind] ?? w.kind;
var isReset = (w, nowMs) => Number.isFinite(nowMs) && Number.isFinite(w.resetsMs) && w.resetsMs <= nowMs;
function shortReset(resetsMs, nowMs) {
  if (!Number.isFinite(resetsMs) || resetsMs <= nowMs) return null;
  const min = Math.floor((resetsMs - nowMs) / 6e4);
  if (min < 1) return "<1m";
  const d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60), m = min % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}
function quotaRows(usage, nowMs, provider) {
  const age = formatAge(nowMs - usage.fetchedMs);
  const source = sourceOf(usage, provider);
  return usage.windows.map((w) => {
    const label = labelOf(w);
    const short = shortOf(w);
    if (isReset(w, nowMs)) {
      return {
        label,
        value: "reset",
        detail: `reset \xB7 ${age}`,
        stale: Boolean(usage.stale),
        tooltip: `${provider.title} \xB7 ${label}: reset since this reading \xB7 ${age} \xB7 source: ${source}`,
        percent: null,
        pace: null,
        usage: "reset",
        reset: null,
        short
      };
    }
    const pace = paceOf(w, nowMs);
    const detail = w.resetsMs == null ? age : `${formatReset(w.resetsMs, nowMs)} \xB7 ${age}`;
    return {
      label,
      short,
      value: formatPercent(w.usedPercent),
      detail,
      stale: Boolean(usage.stale),
      tooltip: `${provider.title} \xB7 ${label}: ${formatPercent(w.usedPercent)} \xB7 ${detail}${pace == null ? "" : ` \xB7 ${Math.round(pace * 100)}% of the window has passed`} \xB7 source: ${source}`,
      usage: `${Math.round(w.usedPercent)}%`,
      reset: shortReset(w.resetsMs, nowMs),
      percent: w.usedPercent,
      pace
    };
  });
}
function quotaGroups(byId, nowMs) {
  return PROVIDERS.filter((p) => byId?.[p.id]?.windows?.length).map((p) => ({ id: p.id, title: p.title, agent: p.agent, icon: p.icon ?? null, plan: planLabel(byId[p.id].plan), rows: quotaRows(byId[p.id], nowMs, p) }));
}
var barLevel = (p) => p >= 90 ? "high" : p >= 70 ? "warn" : "ok";
function stripItems(groups) {
  return (groups ?? []).map((g) => ({
    id: g.id,
    title: g.title,
    agent: g.agent,
    icon: g.icon ?? null,
    plan: g.plan ?? null,
    items: g.rows.map((r) => {
      const level = r.percent == null ? "ok" : barLevel(r.percent);
      return { short: r.short, usage: r.usage, reset: level === "ok" ? null : r.reset ?? null, percent: r.percent, pace: r.pace, level, stale: r.stale, tooltip: r.tooltip };
    })
  }));
}

// src/mods/dock-quotas/draw.js
import { div, svg, image } from "gpui-kit";
import { h_flex as h_flex2 } from "gpui-base";
var WARN = "#d29922";
var HIGH = "#f85149";
var levelColor = (t, level) => ({ ok: t.accent, warn: WARN, high: t.blocked ?? HIGH })[level] ?? t.accent;
function providerFace(t, g, icons, size = 13) {
  const ic = icons?.[g.agent];
  if (ic) return ic.tint ? svg(ic.icon).size(size).text_color(t.muted) : image(ic.icon).size(size);
  if (g.icon) return image(g.icon).size(size);
  return div().size(size).flex().items_center().justify_center().text_size(size - 3).font_semibold().text_color(t.dim).child(g.title.slice(0, 1));
}
function quotaBar(t, r, w = null) {
  const level = barLevel(r.percent ?? 0);
  const pct = Math.max(0, Math.min(100, r.percent ?? 0));
  return div().h(4).relative().rounded(2).bg(t.border).when(w == null, (el) => el.flex_1().min_w(24)).when(w != null, (el) => el.w(w).flex_none()).when(r.percent != null, (bar) => bar.child(div().w(`${pct}%`).h(4).rounded(2).bg(levelColor(t, level)))).when(r.pace != null, (bar) => bar.child(div().absolute().top(-2).left(`${Math.round(r.pace * 100)}%`).w(2).h(8).rounded(1).bg(t.foreground).opacity(0.7)));
}
function groupHeaderEl(t, g, i, icons, { id = `quota-group-${i}`, px = 16 } = {}) {
  return h_flex2().id(id).px(px).pt(i ? 8 : 2).pb(1).gap(6).flex_none().items_center().child(providerFace(t, g, icons)).child(div().text_size(11.5).font_medium().text_color(t.muted).child(g.title)).when(Boolean(g.plan), (el) => el.child(div().px(5).rounded(4).bg(t.border).text_size(10).text_color(t.muted).child(g.plan)));
}
function quotaRowEl(t, r, id, { px = 16 } = {}) {
  const level = barLevel(r.percent ?? 0);
  return h_flex2().id(id).px(px).h(24).gap(8).flex_none().items_center().tooltip(r.tooltip).when(r.stale, (el) => el.opacity(0.55)).child(div().w(92).flex_none().truncate().text_size(12).text_color(t.foreground).child(r.label)).child(quotaBar(t, r)).child(div().w(34).flex_none().flex().justify_end().text_size(12).text_color(r.percent == null ? t.dim : level === "ok" ? t.muted : levelColor(t, level)).child(r.usage ?? r.value)).child(div().w(46).flex_none().flex().justify_end().text_size(11).text_color(t.dim).child(r.stale ? "stale" : r.reset ?? ""));
}

// src/mods/dock-limits/main.js
var READINGS_KEY = "dock.quotas.readings";
var Limits = class extends View {
  init(_props, cx) {
    this.icons = {};
    if (checking()) return;
    cx.spawn(async (cx2) => {
      try {
        for (const a of await knownAgents()) if (a?.key && a.icon) this.icons[a.key] = { icon: a.icon, tint: Boolean(a.tint) };
        cx2.notify();
      } catch (e) {
        console.log(`dock-limits: agent icons unavailable: ${e}`);
      }
    });
    cx.timer.every(3e4, (cx2) => cx2.notify());
  }
  item(t, it, key) {
    return h_flex3().id(key).gap(5).flex_none().items_center().when(it.stale, (el) => el.opacity(0.55)).child(div2().text_color(t.dim).child(it.short)).child(quotaBar(t, it, 26)).child(div2().text_color(it.level === "ok" ? t.muted : levelColor(t, it.level)).child(it.usage ?? "")).when(Boolean(it.reset), (el) => el.child(div2().text_color(t.dim).child(`\xB7 ${it.reset}`)));
  }
  panel(t, groups) {
    let n = 0;
    return v_flex().id("dock-limits-panel").w(380).py(8).gap(2).rounded(10).bg(t.popover).border_1().border_color(t.border).text_size(13).text_color(t.foreground).children(groups.flatMap((g, gi) => [
      groupHeaderEl(t, g, gi, this.icons, { id: `limits-group-${gi}`, px: 14 }),
      ...g.rows.map((r) => quotaRowEl(t, r, `limits-row-${n++}`, { px: 14 }))
    ])).child(div2().px(14).pt(6).text_size(11).text_color(t.dim).child("Hover a line for its reset time, age and source."));
  }
  render() {
    const t = theme();
    const groups = quotaGroups(shared(READINGS_KEY) ?? {}, Date.now());
    const strips = stripItems(groups);
    const row = barRow(t).id("dock-limits").flex_1().gap(12);
    if (!strips.length) {
      return row.child(div2().text_color(t.dim).tooltip("Usage limits appear here once Quotas (left panel) has a reading.").child("no limits yet"));
    }
    const strip = h_flex3().id("dock-limits-strip").min_w(0).gap(12).items_center().overflow_hidden().children(strips.flatMap((g, gi) => [
      ...gi ? [div2().w(1).h(12).flex_none().bg(t.border)] : [],
      h_flex3().gap(8).flex_none().items_center().child(providerFace(t, g, this.icons, 12)).children(g.items.map((it, i) => this.item(t, it, `limits-${g.id}-${i}`)))
    ]));
    return row.child(HoverCard.new("dock-limits-card").anchor("bottom_left").open_delay(250).close_delay(300).trigger(strip).content(this.panel(t, groups)));
  }
};
export {
  Limits as default
};
