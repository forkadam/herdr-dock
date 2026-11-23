// The Jira page's tab row, under the header: one tab per search (src/shared/jira/views.js tabList), its name and its
// count, the shown one raised. `page` is the Jira view: tabs(), tab(), counts, showTab(id, cx).
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { tabCountText } from "../../shared/jira/views.js";

export function tabBar(page, t) {
  const shown = page.tab().id;
  const tab = (x) => {
    const on = x.id === shown;
    const c = page.counts.get(x.id);
    const count = tabCountText(c);
    return h_flex().id(`jira-tab-${x.id}`).h(28).px(10).gap(6).flex_none().items_center().rounded(7).text_size(12.5).cursor_pointer()
      .when(on, (el) => el.bg(t.raised ?? t.selected).text_color(t.foreground))
      .when(!on, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
      // A failed search says why on its "!" (the tab itself shows it in full).
      .when(Boolean(c?.problem), (el) => el.tooltip(`${c.problem.message} ${c.problem.hint ?? ""}`.trim()))
      .on_click((_e, cx) => page.showTab(x.id, cx))
      .child(div().child(x.name))
      .when(count !== "", (el) => el.child(div().text_size(11).text_color(c?.problem ? t.blocked : t.dim).child(count)));
  };
  return div().id("jira-tabs").flex().flex_row().flex_none().h(40).px(12).gap(4).items_center().overflow_x_scrollbar()
    .border_b(1).border_color(t.border).children(page.tabs().map(tab));
}
