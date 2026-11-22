// src/mods/dock-overview/main.js
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, run, setShared as setShared2, shared as shared2, theme } from "herdr";

// src/mods/_page.js
import { setShared, shared } from "herdr";

// src/shared/panel.js
var PAGE_KEY = "dock.page.active";

// src/mods/_page.js
function showTerminal() {
  if ((shared(PAGE_KEY) ?? null) !== null) setShared(PAGE_KEY, null);
}

// src/mods/dock-overview/view.js
var STATUS_ORDER = ["blocked", "done", "working", "idle"];
var STATUS_TITLE = { blocked: "Needs you", done: "Done", working: "Working", idle: "Idle" };
function overviewModel(agents2) {
  const counts = { blocked: 0, done: 0, working: 0, idle: 0 };
  const by = { blocked: [], done: [], working: [], idle: [] };
  for (const a of agents2 ?? []) {
    const s = STATUS_ORDER.includes(a?.status) ? a.status : "idle";
    counts[s]++;
    by[s].push(a);
  }
  const groups = STATUS_ORDER.filter((s) => by[s].length).map((s) => ({
    status: s,
    title: STATUS_TITLE[s],
    agents: by[s].slice().sort((x, y) => (y.seq ?? 0) - (x.seq ?? 0)).map((a) => ({
      address: a.address,
      pane: a.pane,
      program: a.program ?? null,
      title: (a.title ?? "").trim() || a.program?.name || a.address,
      where: [a.space_name, a.tab_name || (Number.isInteger(a.tab_index) ? `tab ${a.tab_index + 1}` : null)].filter(Boolean).join(" \xB7 ")
    }))
  }));
  return { counts, groups };
}

// src/mods/dock-overview/main.js
var BADGE_KEY = "dock.page.badge.dock-overview";
var Overview = class extends View {
  init() {
  }
  render() {
    const t = theme();
    let list = [];
    try {
      list = agents();
    } catch {
      list = [];
    }
    const m = overviewModel(list);
    if ((shared2(BADGE_KEY)?.count ?? 0) !== m.counts.blocked) setShared2(BADGE_KEY, { count: m.counts.blocked, tone: "bad" });
    const stat = (s) => v_flex().flex_1().min_w(0).p(14).gap(4).rounded(10).bg(t.surface ?? t.chrome).border_1().border_color(t.border).child(div().text_size(12).text_color(t.dim).child(STATUS_TITLE[s])).child(div().text_size(26).font_semibold().text_color(m.counts[s] && (s === "blocked" || s === "done") ? t[s] : t.foreground).child(String(m.counts[s])));
    const card = (a, s, i) => h_flex().id(`ov-${s}-${i}`).p(12).gap(10).items_center().rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(s === "blocked" ? t.blocked : t.border).cursor_pointer().hover((st) => st.bg(t.hover)).tooltip("Go to this agent").on_click(() => {
      showTerminal();
      run("pane.focus", { pane: a.pane });
    }).when(Boolean(a.program?.icon), (el) => el.child(a.program.tint ? svg(a.program.icon).size(18).text_color(t.muted) : image(a.program.icon).size(18))).child(v_flex().flex_1().min_w(0).gap(2).child(div().truncate().text_size(13.5).text_color(t.foreground).child(a.title)).child(div().truncate().text_size(12).text_color(t.dim).child(a.where))).when(s === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(14).text_color(t.working).spin(900))).when(s === "blocked" || s === "done", (el) => el.child(div().size(8).rounded(4).bg(t[s])));
    return v_flex().id("dock-overview").size_full().min_h(0).bg(t.background).text_color(t.foreground).child(h_flex().flex_none().px(24).pt(20).pb(12).items_baseline().gap(10).child(div().text_size(20).font_semibold().child("Overview")).child(div().text_size(12.5).text_color(t.dim).child(`${list.length} agent${list.length === 1 ? "" : "s"} across all spaces`))).child(h_flex().flex_none().px(24).pb(16).gap(12).children(STATUS_ORDER.map(stat))).child(v_flex().id("dock-overview-list").flex_1().min_h(0).overflow_y_scrollbar().px(24).pb(24).gap(16).when(!m.groups.length, (el) => el.child(div().py(24).text_color(t.dim).child("No agents running. Start one in a tab, and it shows here."))).children(m.groups.map((g) => v_flex().gap(8).child(div().text_size(12).font_medium().text_color(t.muted).child(`${g.title} \xB7 ${g.agents.length}`)).children(g.agents.map((a, i) => card(a, g.status, i))))));
  }
};
export {
  Overview as default
};
