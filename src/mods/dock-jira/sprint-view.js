// The Today tab's sprint board, laid out like the team's Jira Software board: the shown sprint's label and its menu,
// the board's own columns (each covering several statuses) sharing the width, one lane per parent story (its header
// folds it), scrolling down only. src/shared/jira/sprint.js decides; this draws. `page` is the Jira view: sprint,
// shown(), collapsed, sprintOpen, drag, dropChoice, dropNote, dropColumn, scroll(key), card(t, r), choiceBox(t),
// noteBox(t), dragBar(t), pointerMoved(e, cx), released(cx), showSprint(id, cx), toggleLane(key, cx).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Popover } from "gpui-base";
import { laneCells, litColumns, menuSprint, sprintLabel, sprintRows, sprintSeries } from "../../shared/jira/sprint.js";

// A lane's key: its parent story's, "" for Other issues.
const laneKey = (lane) => lane.parent?.key ?? "";

// The sprint menu: the shown sprint's label; open, the current sprint's series (sprintSeries) to pick from, newest
// first. On a board with no active sprint, the series of the one that ended last (menuSprint).
export function sprintMenu(page, t) {
  const sp = page.sprint;
  const items = sprintSeries(menuSprint(sp.current, sp.all), sp.all, sp.mine);
  const item = (s) => h_flex().id(`jira-sprint-item-${s.id}`).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer()
    .bg(s.id === sp.shown?.id ? t.selected : t.popover).hover((st) => st.bg(t.hover))
    .on_click((_e, cx) => page.showSprint(s.id, cx))
    .child(div().flex_1().min_w(0).truncate().child(s.name))
    .child(div().flex_none().text_size(11).text_color(t.dim).child(s.id === sp.current?.id ? "current" : s.state));
  return Popover.new("jira-sprint-menu").open(page.sprintOpen)
    .on_open_change((open, cx) => { page.sprintOpen = open; cx.notify(); })
    .trigger(h_flex().id("jira-sprint-trigger").h(28).px(10).gap(6).items_center().rounded(7).border_1().border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover)).text_size(12.5)
      .child(div().truncate().child(sp.shown ? sprintLabel(sp.shown, Date.now()) : "Sprints"))
      .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim)))
    .content(v_flex().id("jira-sprint-list").w(280).max_h(360).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover)
      .border_1().border_color(t.border).text_size(12.5).text_color(t.foreground)
      .children(items.length ? items.map(item) : [div().p(8).text_color(t.dim).child("No sprints on this board.")]));
}

export function sprintBoard(page, t) {
  const sp = page.sprint;
  const message = (text) => v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(text);
  const problem = (p) => v_flex().gap(6)
    .child(div().text_size(13).text_color(t.blocked).child(p.message)).child(div().text_size(12).text_color(t.dim).child(p.hint ?? ""));
  // Nothing read yet (or the board's columns and sprints couldn't be).
  if (!sp.cachedAt) return sp.problem ? v_flex().flex_1().p(24).child(problem(sp.problem)) : message("Loading…");
  const top = h_flex().flex_none().h(44).px(16).gap(10).items_center().child(sprintMenu(page, t));
  const withMenu = (...children) => v_flex().flex_1().min_w(0).min_h(0).child(top).children(children);
  // A later refresh that failed: said above what Today last had.
  const failed = sp.problem ? div().flex_none().px(16).pb(8).text_size(12).text_color(t.blocked).child(`${sp.problem.message} ${sp.problem.hint ?? ""}`.trim()) : null;
  if (!sp.shown) return withMenu(...(failed ? [failed] : []), message(`No active sprint on ${sp.board?.name ?? `board ${sp.board?.id}`}.`));
  if (!sp.at) return withMenu(sp.problem ? v_flex().p(24).child(problem(sp.problem)) : message("Loading…"));

  const d = page.drag;
  const cols = sp.columns;
  // While dragging, the columns the card can move into light up; the rest dim, except its own.
  const lit = d ? litColumns(cols, d.targets, d.row.status) : new Set();
  const dim = (c) => Boolean(d) && !lit.has(c.name) && !c.statuses.includes(d.row.status);
  const hover = (name) => (_e, cx) => {
    if (!page.drag) return;
    page.drag.hover = name;
    const over = name !== null && lit.has(name) ? name : null;
    if (page.drag.over !== over) { page.drag.over = over; cx.notify(); }
  };
  const lanes = sprintRows(sp.rows);
  const cells = lanes.map((l) => laneCells(l, cols));
  const column = (el, c) => el.rounded(8).bg(d?.over === c.name ? t.selected : t.chrome).border_1().border_color(lit.has(c.name) ? t.accent : t.border)
    .when(dim(c), (x) => x.opacity(0.4)).on_mouse_move(hover(c.name));

  // The columns' names and how many cards each holds, above the lanes (they scroll under it).
  const heads = h_flex().flex_none().px(12).gap(8).children(cols.map((c, ci) => column(h_flex().id(`jira-sprint-col-${ci}`), c)
    .flex_1().min_w(0).h(32).px(10).gap(6).items_center()
    .child(div().min_w(0).truncate().text_size(12).font_medium().text_color(lit.has(c.name) ? t.foreground : t.muted).child(c.name))
    .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(cells.reduce((n, lane) => n + lane[ci].length, 0))))));

  const here = (lane, c, key) => !d && page.dropColumn === c.name && lane.rows.some((r) => r.key === key);
  const lane = (l, li) => {
    const key = laneKey(l);
    const folded = page.collapsed.has(key);
    const head = h_flex().id(`jira-lane-${li}`).h(30).px(4).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(folded ? "Show this story's issues" : "Fold this story")
      .on_mouse_move(hover(null))
      .on_click((_e, cx) => page.toggleLane(key, cx))
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(12).text_color(t.dim))
      .when(Boolean(l.parent), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(l.parent.key)))
      .when(Boolean(l.parent?.status), (el) => el.child(div().flex_none().px(6).py(1).rounded(5).bg(t.border).text_size(11).text_color(t.muted).child(l.parent.status)))
      .child(div().flex_1().min_w(0).truncate().text_size(12.8).font_medium().text_color(t.foreground)
        .child(l.parent ? l.parent.summary || l.parent.key : "Other issues"))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(l.rows.length)));
    if (folded) return v_flex().flex_none().child(head);
    // A plain flex row (h_flex centers vertically): a lane's cells share its height.
    return v_flex().flex_none().gap(6).child(head)
      .child(div().flex().flex_row().gap(8).children(cols.map((c, ci) => column(v_flex().id(`jira-sprint-cell-${li}-${ci}`), c)
        .flex_1().min_w(0).min_h(44).p(6).gap(6)
        .when(Boolean(page.dropChoice) && here(l, c, page.dropChoice?.row.key), (el) => el.child(page.choiceBox(t)))
        .when(Boolean(page.dropNote) && here(l, c, page.dropNote?.key), (el) => el.child(page.noteBox(t)))
        .children(cells[li][ci].map((r) => page.card(t, r))))));
  };

  const scroll = page.scroll("today/board");
  return v_flex().id("jira-sprint-wrap").relative().flex_1().min_w(0).min_h(0)
    .on_mouse_move((e, cx) => page.pointerMoved(e, cx))
    .on_mouse_up("left", (_e, cx) => page.released(cx))
    .child(top)
    .when(Boolean(failed), (el) => el.child(failed))
    .child(heads)
    .child(v_flex().id("jira-sprint-lanes").flex_1().min_h(0).overflow_y_scrollbar().px(12).pt(10).pb(16).gap(12)
      .when(Boolean(scroll), (el) => el.track_scroll(scroll))
      .children(lanes.length ? lanes.map(lane) : [div().p(12).text_size(12.5).text_color(t.dim).child(`None of your issues are in ${sp.shown.name}.`)]))
    .when(Boolean(d), (el) => el.child(page.dragBar(t)))
    .when(Boolean(d?.at), (el) => el.child(div().absolute().left(d.at.x + 14).top(d.at.y + 14).w(240).p(10).rounded(8)
      .bg(t.surface ?? t.chrome).border_1().border_color(t.accent).opacity(0.92).text_size(12.5).text_color(t.foreground)
      .child(div().text_size(11).text_color(t.dim).child(d.row.key)).child(div().truncate().child(d.row.summary))));
}
