// Pipelines: the selected worktree's CI pipeline (dock.git.detail, published by dock-core's collector). Shown
// in the right panel when placed there, else as a dialog opened by dock-core's git.show (props().overlay set,
// so it gets a close ×). Every action goes to dock-core through gitCommand. While on screen it writes the
// dock.git.watching heartbeat: the collector fetches every job and the running job's log line only then.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, checking } from "herdr";
import { gitCommand } from "../_git-command.js";
import { badgeOf } from "../dock-git/view.js";
import { rightActiveOf, rightShownOf } from "../../shared/panel.js";
import { ago, duration, canRetry, bucketOf, countLine, elapsed, viewGroups, budgetLine } from "./format.js";

const MOD = "dock-pipelines";
const WARN = "#d29922";
const PROVIDER = { gitlab: "GitLab", github: "GitHub" };
const RETRY_SHOW_MS = 3000; // "Retrying…" shows this long, then a refresh re-reads the pipeline
const TICK_MS = 1000; // a running job's elapsed time redraws this often
const HEARTBEAT_TICKS = 5; // the heartbeat is written every 5th tick; the collector forgets it after 15 s
const WATCHING_KEY = "dock.git.watching";
// Each display bucket (format.js bucketOf) as a glyph and one of tones()' keys.
const GLYPH = { passed: "✓", failed: "✕", running: "●", pending: "○", manual: "○", warn: "⚠", canceled: "–", skipped: "–" };
const TONE = { passed: "ok", failed: "bad", running: "busy", warn: "warn", pending: "dim", manual: "dim", canceled: "dim", skipped: "dim" };
// Buckets whose glyph alone is ambiguous, so the row also says the word.
const WORDED = new Set(["pending", "canceled", "skipped"]);
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
  init(_props, cx) {
    this.retrying = false;
    this.mono = "monospace";
    this.closed = false;
    // One loop per instance: if init ran again while it lives, resetting `closed` above keeps it going.
    if (checking() || this.looping) return;
    this.looping = true;
    // One loop for the view's life: a redraw each second while a job runs (its elapsed time ticks), and the
    // heartbeat at once and then every 5 s while the panel is on screen. Herdr calls close() when the pane, tab,
    // slot or overlay goes, however it was closed (×, Esc, a click beside the dialog), then cancels the view's
    // unfinished tasks (AGENTS.md "Cleanup"); close() also ends the loop itself.
    cx.spawn(async (cx) => {
      try {
        for (let tick = 0; !this.closed; tick++) {
          if (tick % HEARTBEAT_TICKS === 0 && this.shown()) setShared(WATCHING_KEY, { at: Date.now() });
          await cx.sleep(TICK_MS);
          // Hidden (the right panel on another feature, or closed), a redraw would only cost battery.
          if (!this.closed && this.shown() && this.takeRedraw()) cx.notify();
        }
      } finally {
        this.looping = false;
      }
    });
  }

  // On screen: the dialog while it lives; in the right panel, while the panel shows and Pipelines is its feature
  // (the test dock-browser uses). The manifest allows only the right region ("regions": ["right"]), so a view not
  // in the right panel is the dialog.
  shown() {
    if (props()?.overlay || props()?.dockRegion !== "right") return true;
    const applied = shared("dock.config.applied");
    return rightShownOf(shared("dock.right.shown"), applied) && rightActiveOf(shared("dock.right.active"), applied?.right?.features ?? []) === MOD;
  }

  // A running job's elapsed time ticks; a limit pause's warn line must go when the pause ends, with no new detail
  // to trigger a draw, so the tick after it ends redraws once more.
  // Not a pure check: it also remembers whether this tick was limited, for the one redraw after the pause ends.
  takeRedraw() {
    const until = shared("dock.git.detail")?.budget?.limitedUntil;
    const limited = typeof until === "number" && until > Date.now();
    const wasLimited = this.wasLimited;
    this.wasLimited = limited;
    return this.anyRunning() || limited || wasLimited === true;
  }

  anyRunning() {
    const jobs = shared("dock.git.detail")?.pipeline?.jobs;
    return Array.isArray(jobs) && jobs.some((j) => bucketOf(j) === "running");
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

  // Herdr's lifecycle hook: its pane, tab, slot or overlay is already going, so this only stops the loop and drops
  // the heartbeat (the collector goes back to light polls); closing the overlay again here would be wrong.
  close() {
    this.closed = true;
    setShared(WATCHING_KEY, null);
  }

  // The × button: stops the loop and drops the heartbeat at once, then closes the dialog. Herdr then calls close()
  // as well, which only repeats the same two writes.
  closeClicked() {
    this.close();
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
        .on_click(() => this.closeClicked()).child("×")));
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
      .when(p.number != null, (el) => el.child(div().flex_none().font_medium().text_color(t.foreground).child(`#${p.number}`)))
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

  // A stage's (or a one-stage build's) worst glyph and done/total, e.g. "● 1/3"; only the glyph when every job
  // waits for a person (the total leaves those out).
  summary(t, s) {
    const text = s.total > 0 ? `${GLYPH[s.bucket]} ${s.done}/${s.total}` : GLYPH[s.bucket];
    return div().flex_none().font_family(this.mono).text_size(11.5).text_color(this.tones(t)[TONE[s.bucket]]).child(text);
  }

  groupHeader(t, g, gi, summary) {
    return h_flex().id(`pl-group-${gi}`).h(24).px(16).pt(gi === 0 ? 0 : 8).gap(8).items_center().flex_none()
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(g.title))
      .when(Boolean(summary), (el) => el.child(this.summary(t, summary)));
  }

  stageHeader(t, s, gi, si) {
    return h_flex().id(`pl-stage-${gi}-${si}`).h(22).px(16).pt(4).gap(8).items_center().flex_none().text_size(12)
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.name))
      .child(this.summary(t, s.summary));
  }

  // One job: glyph, name, its time (duration, or live elapsed while running) and the provider's word when the glyph
  // doesn't say it all. A running job has an accent bar and, when known, what it is doing now on a second line:
  // the log's last line (GitLab) or its current step (GitHub).
  jobRow(t, job, index, now) {
    const bucket = bucketOf(job);
    const running = bucket === "running";
    const time = running ? elapsed(job.startedAt, now) : duration(job.duration);
    const word = job.label ?? (WORDED.has(bucket) || (running && !time) ? bucket : null);
    const step = job.step ? `step ${job.step.index}/${job.step.total} · ${job.step.name}` : null;
    const doing = running ? job.logLine || step : null;
    const top = h_flex().h(22).gap(8).items_center().text_size(12)
      .child(div().flex_none().w(12).text_color(this.tones(t)[TONE[bucket]]).child(GLYPH[bucket]))
      .child(div().flex_1().min_w(0).truncate().text_color(running ? t.accent : t.foreground).child(job.name))
      .when(Boolean(time), (el) => el.child(div().flex_none().font_family(this.mono).text_size(11.5)
        .text_color(running ? t.accent : t.dim).child(time)))
      .when(Boolean(word), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(word)))
      .when(Boolean(job.webUrl), (el) => el.child(this.link(t, `pl-job-open-${index}`, "↗", "Open the job",
        () => gitCommand("git.open.job", { index }))));
    return v_flex().id(`pl-job-${index}`).flex_none().ml(14).pr(10).tooltip(job.stage ? `${job.name} (${job.stage})` : job.name)
      .when(running, (el) => el.border_l(2).border_color(t.accent).pl(8))
      .when(!running, (el) => el.pl(10))
      .child(top)
      .when(Boolean(doing), (el) => el.child(div().pl(20).pb(2).truncate().font_family(this.mono).text_size(11)
        .text_color(t.dim).child(doing)));
  }

  // Before the first full poll the detail has no jobs yet, only the stages' names and statuses: those as a strip.
  stageStrip(t, p) {
    const tones = this.tones(t);
    const list = Array.isArray(p.stages) ? p.stages : [];
    if (!list.length) return null;
    return h_flex().flex_wrap().px(16).pt(10).gap(12).flex_none().text_size(12)
      .children(list.map((s, i) => {
        const b = badgeOf({ status: s.status });
        return h_flex().id(`pl-strip-${i}`).gap(4).flex_none().tooltip(`${s.name}: ${s.status}`)
          .child(div().text_color(t.foreground).child(s.name))
          .child(div().text_color(tones[b.tone] ?? t.dim).child(b.glyph || "–"));
      }));
  }

  // The count line, then every job of the commit's builds: group headers, stage headers, one row per job.
  jobList(t, d) {
    const p = d.pipeline;
    const jobs = Array.isArray(p.jobs) ? p.jobs : [];
    if (!jobs.length) return this.stageStrip(t, p);
    const now = Date.now();
    const groups = viewGroups(p, d.branch);
    // A lone GitLab pipeline's header would only repeat the pipeline line's #number.
    const lone = groups.length === 1 && groups[0].title === `#${p.number}` && groups[0].stages.every((s) => s.name != null);
    const rows = [div().px(16).pb(4).text_size(12).text_color(t.dim).child(countLine(jobs, p.jobsTruncated))];
    groups.forEach((g, gi) => {
      // A GitHub workflow is its own only stage: the group header carries the stage's counts.
      const oneStage = g.stages.length === 1 && g.stages[0].name == null ? g.stages[0].summary : null;
      if (!lone) rows.push(this.groupHeader(t, g, gi, oneStage));
      g.stages.forEach((s, si) => {
        if (s.name != null) rows.push(this.stageHeader(t, s, gi, si));
        for (const { job, index } of s.jobs) rows.push(this.jobRow(t, job, index, now));
      });
    });
    return v_flex().pt(8).gap(1).flex_none().children(rows);
  }

  retryButton(t, p, retryError) {
    const busy = p.status === "running" || p.status === "pending";
    const enabled = canRetry(p.status) && !this.retrying && p.id != null;
    const label = this.retrying ? "Retrying…" : "Retry";
    const tip = busy ? "The pipeline is still running" : canRetry(p.status) ? "Retry the failed jobs" : "Nothing to retry";
    return v_flex().px(16).pt(12).gap(6).flex_none()
      .child(div().id("pl-retry").flex_none().self_start().px(12).h(26).rounded(6).border(1).border_color(t.border).flex().items_center()
        .text_size(12.5).text_color(t.foreground)
        .tooltip(tip)
        .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); this.retry(cx); }))
        .when(!enabled, (el) => el.opacity(0.45))
        .child(label))
      .when(Boolean(retryError) && !this.retrying, (el) => el.child(div().text_size(11.5).text_color(WARN)
        .child(`Retry failed: ${retryError}`)));
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
    const budget = budgetLine(d.budget, Date.now());
    if (budget) out.push(div().px(16).pt(3).flex_none().text_size(11.5).text_color(budget.tone === "warn" ? WARN : t.dim).child(budget.text));
    const jobs = this.jobList(t, d);
    if (jobs) out.push(jobs);
    out.push(this.retryButton(t, p, d.retryError));
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
