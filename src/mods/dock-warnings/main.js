// Warnings: running pipelines, a quota near its limit, low disk. Draws nothing when none applies.
import { View, div } from "gpui-kit";
import { theme, shared } from "herdr";
import { barRow, WARN } from "../_bar.js";
import { gitCommand } from "../_git-command.js";
import { requestFocus } from "../_feature.js";
import { SAMPLE_KEY, warningsFor } from "../../shared/system.js";
import { leftFeatureId } from "../../shared/layout.js";

// Quotas in the left panel, by its block id (the one features compare dock.left.focus against); nothing when it
// isn't there, rather than a focus no feature has, which would collapse them all.
function showQuotas() {
  const id = leftFeatureId(shared("dock.config.applied"), "dock-quotas");
  if (id) requestFocus(id);
}

// One running pipeline: show its worktree; several: just show Git projects.
const CLICK = {
  pipelines: (w) => (w.worktrees?.length === 1 ? gitCommand("git.show", { worktree: w.worktrees[0] }) : gitCommand("git.show")),
  quota: () => showQuotas(),
};

export default class Warnings extends View {
  init(_props, cx) {
    cx.timer.every(5000, (cx) => cx.notify()); // a disk sample ages out even when nothing else changes
  }

  item(t, w) {
    const click = CLICK[w.key];
    return div().id(`dock-warning-${w.key}`).flex_none().text_color(w.key === "pipelines" ? t.muted : WARN)
      .tooltip(w.tip)
      .when(Boolean(click), (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); click(w); }))
      .child(w.text);
  }

  render() {
    const t = theme();
    const list = warningsFor({
      sample: shared(SAMPLE_KEY), gitState: shared("dock.git.state"), quotaTop: shared("dock.quotas.top"), now: Date.now(),
    });
    return barRow(t).gap(12).children(list.map((w) => this.item(t, w)));
  }
}
