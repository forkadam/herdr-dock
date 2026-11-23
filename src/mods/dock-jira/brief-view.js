// Today's brief (above the sprint board, or alone when no board is set) and, in an issue's detail, What changed and
// Recent changes. src/shared/jira/brief.js and diff.js decide; this draws. `page` is the Jira view: brief, marks(),
// options, subtasks, selected, detail, change, recent, scroll(key), button(t, id, label, onClick, opts),
// openBriefItem(key, cx), markAllRead(cx), markRead(cx), checkMyWork(item, cx), openUrl(url), toggleRecent(key, cx).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { briefLists, checkWork, editsText, isUnread } from "../../shared/jira/brief.js";
import { diffStats, foldDiff } from "../../shared/jira/diff.js";
import { ago } from "../../shared/jira/model.js";

const WARN = "#d29922";
const BRIEF_MAX_H = 280; // the brief's height above the board at most (it scrolls past that); the board keeps the rest
const CONTEXT = 2; // the unchanged lines kept on each side of a change in a folded diff
const WHY = { added: "added to the sprint", created: "created in the sprint", assigned: "assigned to you" };
const PART = { changed: "Changed", bugs: "High-priority bugs" };
const shortDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dateTime = (ms) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const problemText = (p) => `${p.message} ${p.hint ?? ""}`.trim();
const green = (t) => t.ansi2 ?? "#46a758";
const red = (t) => t.ansi1 ?? "#e5484d";

// "+5 −2": a diff's added and removed lines.
const stats = (t, ops) => {
  const { added, removed } = diffStats(ops);
  return h_flex().flex_none().gap(6).text_size(11)
    .child(div().text_color(green(t)).child(`+${added}`)).child(div().text_color(red(t)).child(`−${removed}`));
};

// A line diff: added lines green with "+", removed ones red, struck through, with "−"; long runs of unchanged lines
// folded (foldDiff) until `full`; a fold's click shows the whole text (showAll).
function diffView(t, id, ops, full, showAll) {
  const shown = full ? ops : foldDiff(ops, CONTEXT);
  const line = (o, i) => {
    if (o.op === "skip") {
      return div().id(`${id}-skip-${i}`).px(8).py(2).text_size(11.5).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.foreground)).tooltip("Show the whole text").on_click((_e, cx) => showAll(cx))
        .child(`⋯ ${o.count} unchanged line${o.count === 1 ? "" : "s"}`);
    }
    const add = o.op === "add", del = o.op === "del";
    return h_flex().items_start().gap(6).px(8).min_h(18)
      .when(add, (el) => el.bg(`${green(t)}18`)).when(del, (el) => el.bg(`${red(t)}18`))
      .child(div().w(10).flex_none().text_color(add ? green(t) : del ? red(t) : t.dim).child(add ? "+" : del ? "−" : " "))
      .child(div().flex_1().min_w(0).text_color(add || del ? t.foreground : t.muted).when(del, (el) => el.line_through()).child(o.text || " "));
  };
  return v_flex().id(id).py(4).rounded(6).border_1().border_color(t.border).bg(t.background).text_size(12.3)
    .children(shown.length ? shown.map(line) : [div().px(8).text_color(t.dim).child("No text on either side.")]);
}

// The brief: Changed (description edits by others, unread), New in sprint (unread; only with a board) and
// High-priority bugs (all of them, unread ones first and marked "new"), each row key · summary · why · when; a click
// opens the issue beside it. Mark all read on top.
export function briefView(page, t) {
  const b = page.brief;
  const alone = page.options.board == null;
  const now = Date.now();
  const lists = briefLists(b, page.marks());
  const newBugs = lists.bugs.filter((x) => x.unread).length;
  const unread = lists.changed.length + lists.sprint.length + newBugs;
  const row = (kind, item, why, fresh) => h_flex().id(`jira-brief-${kind}-${item.key}`).h(30).px(16).gap(10).flex_none().items_center()
    .cursor_pointer().bg(page.selected === item.key ? t.selected : t.background).hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => page.openBriefItem(item.key, cx))
    .child(div().w(76).flex_none().text_size(12).text_color(t.dim).child(item.key))
    .child(div().flex_1().min_w(0).truncate().text_size(12.8).text_color(t.foreground).child(item.summary || item.key))
    .when(fresh, (el) => el.child(div().flex_none().px(5).rounded(4).border_1().border_color(WARN).text_size(10.5).text_color(WARN).child("new")))
    .child(div().flex_none().max_w(220).truncate().text_size(11.5).text_color(t.muted).child(why))
    .child(div().w(34).flex_none().text_size(11.5).text_color(t.dim).child(ago(item.at, now)));
  const section = (title, count, rows, none) => [
    h_flex().h(28).px(16).pt(6).gap(6).flex_none().items_center()
      .child(div().text_size(11.5).font_medium().text_color(t.muted).child(title))
      .child(div().text_size(11.5).text_color(t.dim).child(count)),
    ...(rows.length ? rows : [div().px(16).pb(4).text_size(12).text_color(t.dim).child(none)]),
  ];
  const sections = !b.at ? [div().px(16).py(8).text_size(12.5).text_color(t.dim).child("Loading…")] : [
    ...section("Changed", String(lists.changed.length), lists.changed.map((x) => row("changed", x, editsText(x.edits, { when: false }), false)),
      "No unread description changes."),
    ...(alone ? [] : section("New in sprint", String(lists.sprint.length), lists.sprint.map((x) => row("sprint", x, WHY[x.why] ?? x.why, false)),
      page.sprint.current ? "Nothing new in the sprint." : "No active sprint.")),
    ...section("High-priority bugs", newBugs ? `${newBugs} new of ${lists.bugs.length}` : String(lists.bugs.length),
      lists.bugs.map((x) => row("bug", x, [x.priority, x.status].filter(Boolean).join(" · "), x.unread)), "No high-priority bugs."),
  ];
  const head = h_flex().h(38).px(16).gap(8).flex_none().items_center()
    .child(div().text_size(13).font_semibold().child("Brief"))
    .child(div().text_size(11.5).text_color(t.dim).child(b.sinceMs ? `since ${shortDate(b.sinceMs)}` : ""))
    .child(div().flex_1())
    .child(page.button(t, "jira-brief-read-all", "Mark all read", (cx) => page.markAllRead(cx), { enabled: unread > 0 }));
  // A search that failed: said over what the brief last had.
  const failed = b.problem ? div().px(16).pb(4).text_size(12).text_color(t.blocked).child(`${PART[b.problem.part] ?? "The brief"}: ${problemText(b.problem)}`) : null;
  const scroll = page.scroll("today/brief");
  // Alone, the brief fills Today; above the board, it takes BRIEF_MAX_H at most.
  const body = (alone ? v_flex().id("jira-brief-list").flex_1().min_h(0) : v_flex().id("jira-brief-list").flex_none().max_h(BRIEF_MAX_H))
    .overflow_y_scrollbar().pb(10)
    .when(Boolean(scroll), (el) => el.track_scroll(scroll))
    .when(Boolean(failed), (el) => el.child(failed))
    .children(sections);
  return (alone ? v_flex().id("jira-brief").flex_1().min_h(0) : v_flex().id("jira-brief").flex_none().border_b(1).border_color(t.border))
    .min_w(0).child(head).child(body);
}

// In the open issue's detail, above its description: What changed, for an unread Changed item of the brief (its diff
// from before the first unread edit to after the last, kept while the issue stays open; who and when; Mark read, Open
// in browser, Check against my work); then Recent changes, closed until clicked (the description edits by others
// since the brief's window started, each as its own diff, read or not).
export function changeView(page, t) {
  const d = page.detail;
  const ch = page.change?.key === d.key ? page.change : null;
  const rc = page.recent?.key === d.key ? page.recent : null;
  const label = (text) => div().text_size(11.5).font_medium().text_color(t.muted).child(text);
  const note = (text, color = t.dim) => div().text_size(12).text_color(color).child(text);

  const what = (() => {
    if (!ch) return null;
    const read = !isUnread("changed", ch.item, page.marks());
    const check = checkWork(ch.item, { template: page.options.checkTask, subtasks: page.subtasks.byParent });
    return v_flex().id("jira-change").gap(8).p(10).rounded(8).bg(t.surface ?? t.chrome).border_1().border_color(read ? t.border : t.accent)
      .child(h_flex().gap(8).items_center().child(label("What changed")).child(div().flex_1()).child(stats(t, ch.ops)))
      .child(note(editsText(ch.item.edits), t.muted))
      .child(diffView(t, "jira-change-diff", ch.ops, ch.full, (cx) => { ch.full = true; cx.notify(); }))
      .child(h_flex().gap(8).flex_wrap()
        .child(page.button(t, "jira-change-read", read ? "Read" : "Mark read", (cx) => page.markRead(cx), { enabled: !read }))
        .child(page.button(t, "jira-change-open", "Open in browser", () => page.openUrl(d.url)))
        .child(page.button(t, "jira-change-check", "Check against my work", (cx) => page.checkMyWork(ch.item, cx),
          { primary: true, tip: `Opens a Claude tab with:\n${check?.args.task ?? ""}` })));
  })();

  const toggle = h_flex().id("jira-recent").h(24).gap(6).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
    .tooltip(rc ? "Hide the recent changes" : "The description's edits by others since the brief's start, as diffs")
    .on_click((_e, cx) => page.toggleRecent(d.key, cx))
    .child(svg(`mods/workspace-chrome/chevron-${rc ? "down" : "right"}.svg`).size(12).text_color(t.dim))
    .child(label("Recent changes"))
    .when(Boolean(rc?.sinceMs), (el) => el.child(div().text_size(11).text_color(t.dim).child(`since ${shortDate(rc.sinceMs)}`)));
  const edits = !rc ? []
    : rc.edits === "loading" ? [note("Asking Jira…")]
      : !Array.isArray(rc.edits) ? [note(problemText(rc.edits.problem), t.blocked)]
        : !rc.edits.length ? [note("No description edits by others in that time.")]
          : rc.edits.map((e, i) => v_flex().gap(6)
            .child(h_flex().gap(8).items_center()
              .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`${e.author || "Someone"} · ${dateTime(e.at)}`))
              .child(stats(t, e.ops)))
            .child(diffView(t, `jira-recent-diff-${i}`, e.ops, rc.full.has(i), (cx) => { rc.full.add(i); cx.notify(); })));

  return v_flex().gap(14)
    .when(Boolean(what), (el) => el.child(what))
    .child(v_flex().gap(8).child(toggle).children(edits));
}
