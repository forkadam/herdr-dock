// Pipelines: the selected worktree's CI pipeline (dock.git.detail, published by dock-core's collector). Shown
// in the right panel when placed there, else as a dialog opened by dock-core's git.show (props().overlay set,
// so it gets a close ×). Every action goes to dock-core through gitCommand.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, props, closeOverlay } from "herdr";
import { gitCommand } from "../_git-command.js";
import { badgeOf } from "../dock-git/view.js";
import { ago, duration } from "./format.js";

const WARN = "#d29922";
const PROVIDER = { gitlab: "GitLab", github: "GitHub" };
const RETRY_SHOW_MS = 3000; // "Retrying…" shows this long, then a refresh re-reads the pipeline
// The theme's code face (gpui-base typography.mono), read in render; "monospace" if it can't be read.
function monoFont(cx) {
  try {
    return cx?.theme?.()?.typography?.mono || "monospace";
  } catch {
    return "monospace";
  }
}

// What to say when the detail has no pipeline: dock.git.state's summary tells "none" from not polled yet.
function emptyText(d) {
  const repos = shared("dock.git.state")?.repos;
  const wt = Array.isArray(repos) ? repos.flatMap((r) => r.worktrees ?? []).find((w) => w.id === d.worktree) : null;
  if (wt?.pipeline?.status === "none") return "No pipeline for this branch yet.";
  return d.provider ? "Checking the pipeline…" : "No CI for this repo.";
}

export default class Pipelines extends View {
  init() {
    this.retrying = false;
    this.mono = "monospace";
  }

  tones(t) {
    return { ok: t.ansi2 ?? "#46a758", bad: t.ansi1 ?? "#e5484d", busy: t.accent, dim: t.dim, warn: WARN };
  }

  retry(cx) {
    if (this.retrying) return;
    this.retrying = true;
    gitCommand("git.retry");
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(RETRY_SHOW_MS);
      this.retrying = false;
      gitCommand("git.refresh");
      cx.notify();
    });
  }

  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  link(t, id, label, tip, action) {
    return div().id(id).flex_none().px(6).h(20).rounded(5).flex().items_center().text_size(11.5)
      .text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(label);
  }

  header(t, d, overlay) {
    const title = d?.repo ? `${d.repo} · ${d.branch ?? "detached"}` : "Pipelines";
    const web = d?.pipeline?.webUrl && PROVIDER[d.provider];
    return h_flex().flex_none().px(16).pt(overlay ? 14 : 12).pb(8).gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(web), (el) => el.child(this.link(t, "pl-open", `↗ ${web}`, `Open the pipeline in ${web}`,
        () => gitCommand("git.open"))))
      .when(overlay, (el) => el.child(div().id("pl-close").flex_none().size(22).rounded(5).flex().items_center()
        .justify_center().text_size(15).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close")
        .on_click(() => this.close()).child("×")));
  }

  // The error, and the login command to run when there is one.
  warning(t, d) {
    return v_flex().mx(16).mb(10).p(10).gap(6).flex_none().rounded(6).border(1).border_color(WARN)
      .child(h_flex().gap(6).items_start().text_size(12).text_color(t.foreground)
        .child(div().flex_none().text_color(WARN).child("⚠"))
        .child(div().flex_1().min_w(0).child(d.error ? `Pipeline: ${d.error}` : "Pipeline status unknown")))
      .when(Boolean(d.hint), (el) => el
        .child(div().text_size(11.5).text_color(t.dim).child("Run this, then press ⟳ in Git projects:"))
        .child(div().px(8).py(4).rounded(4).bg(t.hover).font_family(this.mono).text_size(12).text_color(t.foreground)
          .child(d.hint)));
  }

  pipelineLine(t, d) {
    const p = d.pipeline;
    const tones = this.tones(t);
    const badge = badgeOf({ status: p.status });
    const when = ago(p.createdAt, Date.now());
    const line = h_flex().flex_wrap().px(16).gap(8).items_center().flex_none().text_size(12.5)
      .child(div().flex_none().font_medium().text_color(t.foreground).child(`#${p.id}`))
      .child(h_flex().flex_none().gap(4).text_color(tones[badge.tone] ?? t.dim)
        .child(div().child(badge.glyph || "–")).child(div().child(p.status)))
      .when(Boolean(when), (el) => el.child(div().flex_none().text_color(t.dim).child(`· ${when}`)))
      .when(Boolean(p.sha), (el) => el.child(div().flex_none().font_family(this.mono).text_size(11.5).text_color(t.muted)
        .child(String(p.sha).slice(0, 8))));
    const notes = [d.olderThanHead && "(older commit than local HEAD)", d.via && d.via !== "fetch" && `via ${d.via}`]
      .filter(Boolean);
    return v_flex().gap(3).flex_none().child(line)
      .when(notes.length > 0, (el) => el.child(div().px(16).text_size(11.5).text_color(t.dim).child(notes.join(" · "))));
  }

  stages(t, p) {
    const tones = this.tones(t);
    const list = Array.isArray(p.stages) ? p.stages : [];
    if (!list.length) return null;
    return h_flex().flex_wrap().px(16).pt(10).gap(12).flex_none().text_size(12)
      .children(list.map((s, i) => {
        const b = badgeOf({ status: s.status });
        return h_flex().id(`pl-stage-${i}`).gap(4).flex_none().tooltip(`${s.name}: ${s.status}`)
          .child(div().text_color(t.foreground).child(s.name))
          .child(div().text_color(tones[b.tone] ?? t.dim).child(b.glyph || "–"));
      }));
  }

  failedJobs(t, p) {
    const jobs = Array.isArray(p.failedJobs) ? p.failedJobs : [];
    if (!jobs.length) return null;
    const red = t.ansi1 ?? "#e5484d";
    return v_flex().pt(10).gap(2).flex_none()
      .children(jobs.map((j, i) => h_flex().id(`pl-job-${i}`).h(24).px(16).gap(8).items_center().flex_none()
        .text_size(12).tooltip(j.stage ? `${j.name} (stage ${j.stage})` : j.name)
        .child(div().flex_none().text_color(red).child("✕"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(j.name))
        .child(div().flex_none().font_family(this.mono).text_size(11.5).text_color(t.dim).child(duration(j.duration)))
        .when(Boolean(j.webUrl), (el) => el.child(this.link(t, `pl-job-open-${i}`, "open job ↗", "Open the job log",
          () => gitCommand("git.open.job", { index: i }))))));
  }

  retryButton(t, p) {
    const busy = p.status === "running" || p.status === "pending";
    const enabled = !busy && !this.retrying && p.id != null;
    const label = this.retrying ? "Retrying…" : "Retry";
    return h_flex().px(16).pt(12).flex_none()
      .child(div().id("pl-retry").px(12).h(26).rounded(6).border(1).border_color(t.border).flex().items_center()
        .text_size(12.5).text_color(t.foreground)
        .tooltip(busy ? "The pipeline is still running" : "Retry the failed jobs")
        .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); this.retry(cx); }))
        .when(!enabled, (el) => el.opacity(0.45))
        .child(label));
  }

  message(t, text) {
    return div().px(16).py(6).text_size(12).text_color(t.dim).child(text);
  }

  body(t, d) {
    if (!d?.worktree || !d.repo) return [this.message(t, "Select a worktree in Git projects.")];
    const out = [];
    if (d.error || d.hint) out.push(this.warning(t, d));
    const p = d.pipeline;
    if (!p) {
      if (!d.error) out.push(this.message(t, emptyText(d)));
      return out;
    }
    out.push(this.pipelineLine(t, d));
    const stages = this.stages(t, p);
    if (stages) out.push(stages);
    const jobs = this.failedJobs(t, p);
    if (jobs) out.push(jobs);
    out.push(this.retryButton(t, p));
    return out;
  }

  render(cx) {
    const t = theme();
    this.mono = monoFont(cx);
    const overlay = Boolean(props()?.overlay);
    const d = shared("dock.git.detail") ?? null;
    return v_flex().id("dock-pipelines").size_full().min_h(0).bg(overlay ? (t.popover ?? t.chrome) : t.chrome)
      .text_size(13).text_color(t.foreground)
      .child(this.header(t, d, overlay))
      .child(v_flex().id("pl-body").flex_1().min_h(0).pb(12).overflow_y_scrollbar().children(this.body(t, d)));
  }
}
