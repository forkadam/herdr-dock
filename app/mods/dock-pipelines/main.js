// src/mods/dock-pipelines/main.js
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, checking } from "herdr";

// src/mods/_git-command.js
import { run } from "herdr";

// src/shared/gitcmd.js
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function utf8(str) {
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return out;
}
function b64urlEncode(str) {
  const b = utf8(String(str));
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = b[i] << 16 | (b[i + 1] ?? 0) << 8 | (b[i + 2] ?? 0);
    s += ALPHABET[n >> 18 & 63] + ALPHABET[n >> 12 & 63];
    if (i + 1 < b.length) s += ALPHABET[n >> 6 & 63];
    if (i + 2 < b.length) s += ALPHABET[n & 63];
  }
  return s;
}
function gitCommandName(name, args = {}) {
  switch (name) {
    case "git.refresh":
    case "git.retry":
    case "git.open":
      return name;
    case "git.open.job":
      if (!Number.isInteger(args?.index) || args.index < 0) throw new Error("git.open.job needs { index }");
      return `${name}.${args.index}`;
    case "git.select":
    case "git.delete":
      if (typeof args?.worktree !== "string") throw new Error(`${name} needs { worktree }`);
      return `${name}.${b64urlEncode(args.worktree)}`;
    case "git.show":
      return typeof args?.worktree === "string" ? `${name}.${b64urlEncode(args.worktree)}` : name;
    default:
      throw new Error(`unknown git command: ${name}`);
  }
}

// src/mods/_git-command.js
function gitCommand(name, args) {
  run(`dock-core.${gitCommandName(name, args)}`);
}

// src/mods/dock-git/view.js
function badgeOf(pipeline) {
  if (!pipeline) return { glyph: "", tone: "dim" };
  if (pipeline.error || pipeline.status === "unknown") return { glyph: "\u26A0", tone: "warn" };
  switch (pipeline.status) {
    case "passed":
      return { glyph: "\u2713", tone: "ok" };
    case "failed":
      return { glyph: "\u2715", tone: "bad" };
    case "running":
    case "pending":
      return { glyph: "\u27F3", tone: "busy" };
    default:
      return { glyph: "\u2013", tone: "dim" };
  }
}

// src/shared/layout.js
function rightActiveOf(active, features) {
  if (!features.length) return null;
  return features.some((f) => f.mod === active) ? active : features[0].mod;
}

// src/shared/panel.js
function rightShownOf(sharedShown, applied) {
  if (typeof sharedShown === "boolean") return sharedShown;
  return applied?.right?.hidden === false;
}

// src/mods/dock-pipelines/format.js
function ago(createdAt, now) {
  const at = createdAt == null ? NaN : Date.parse(createdAt);
  if (!Number.isFinite(at)) return "";
  const sec = Math.floor((now - at) / 1e3);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function duration(sec) {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  if (s < 60) return `${s}s`;
  const pad = (n) => String(n).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${pad(Math.floor(s % 3600 / 60))}m`;
}
function canRetry(status) {
  return status === "failed" || status === "canceled";
}
var COUNT_ORDER = ["failed", "running", "pending", "manual", "warn", "passed", "canceled", "skipped"];
var WORST_ORDER = ["failed", "running", "pending", "warn", "canceled", "passed", "skipped", "manual"];
var DONE = /* @__PURE__ */ new Set(["passed", "failed", "warn", "canceled", "skipped"]);
function bucketOf(job) {
  if (job.label === "manual" || job.label === "scheduled") return "manual";
  if (job.status === "failed") return job.allowFailure ? "warn" : "failed";
  return COUNT_ORDER.includes(job.status) ? job.status : "pending";
}
function countLine(jobs, truncated) {
  if (!jobs.length) return "";
  const counts = {};
  for (const j of jobs) counts[bucketOf(j)] = (counts[bucketOf(j)] ?? 0) + 1;
  const head = `${jobs.length}${truncated ? "+" : ""} ${jobs.length === 1 && !truncated ? "job" : "jobs"}`;
  return [head, ...COUNT_ORDER.filter((b) => counts[b]).map((b) => `${counts[b]} ${b}`)].join(" \xB7 ");
}
function stageSummary(jobs) {
  const buckets = jobs.map(bucketOf);
  const bucket = WORST_ORDER.find((b) => buckets.includes(b)) ?? "pending";
  return {
    bucket,
    done: buckets.filter((b) => DONE.has(b)).length,
    total: buckets.filter((b) => b !== "manual").length
  };
}
function elapsed(startedAt, now) {
  const at = startedAt == null ? NaN : Date.parse(startedAt);
  if (!Number.isFinite(at)) return "";
  return duration((now - at) / 1e3);
}
function viewGroups(pipeline, branch) {
  const jobs = pipeline.jobs ?? [];
  const groups = pipeline.groups ?? [];
  const known = new Set(groups.map((g) => g.key));
  const build = (rows, groupName) => {
    const byStage = /* @__PURE__ */ new Map();
    rows.forEach((row) => {
      const stage = row.job.stage;
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage).push(row);
    });
    return [...byStage].map(([name, r]) => ({
      name: groupName != null && byStage.size === 1 && name === groupName ? null : name,
      summary: stageSummary(r.map((x) => x.job)),
      jobs: r
    }));
  };
  const indexed = jobs.map((job, index) => ({ job, index }));
  const titles = groups.map((g) => g.ref && g.ref !== branch ? `${g.name} \xB7 ${g.ref}` : g.name);
  const shared2 = (t) => titles.filter((x) => x === t).length > 1;
  const out = groups.map((g, i) => ({
    key: g.key,
    title: shared2(titles[i]) && g.event ? `${titles[i]} \xB7 ${g.event}` : titles[i],
    webUrl: g.webUrl,
    stages: build(indexed.filter((r) => r.job.group === g.key), g.name)
  }));
  const rest = indexed.filter((r) => !known.has(r.job.group));
  if (rest.length) out.push({ key: "", title: "Jobs", webUrl: null, stages: build(rest, null) });
  return out;
}
var API_NAME = { github: "GitHub", gitlab: "GitLab" };
function thousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function budgetLine(budget, now) {
  if (!budget) return null;
  const name = `${API_NAME[budget.provider] ?? budget.provider} API`;
  if (typeof budget.limitedUntil === "number" && budget.limitedUntil > now) {
    const at = new Date(budget.limitedUntil);
    const pad = (n) => String(n).padStart(2, "0");
    return { tone: "warn", text: `${name} limit reached \u2014 resumes at ${pad(at.getHours())}:${pad(at.getMinutes())}` };
  }
  const { remaining, limit } = budget;
  if (!Number.isFinite(remaining) || !Number.isFinite(limit)) return null;
  return { tone: "dim", text: `${name}: ${thousands(remaining)} of ${thousands(limit)} left` };
}

// src/mods/dock-pipelines/main.js
var MOD = "dock-pipelines";
var WARN = "#d29922";
var PROVIDER = { gitlab: "GitLab", github: "GitHub" };
var RETRY_SHOW_MS = 3e3;
var TICK_MS = 1e3;
var HEARTBEAT_TICKS = 5;
var WATCHING_KEY = "dock.git.watching";
var GLYPH = { passed: "\u2713", failed: "\u2715", running: "\u25CF", pending: "\u25CB", manual: "\u25CB", warn: "\u26A0", canceled: "\u2013", skipped: "\u2013" };
var TONE = { passed: "ok", failed: "bad", running: "busy", warn: "warn", pending: "dim", manual: "dim", canceled: "dim", skipped: "dim" };
var WORDED = /* @__PURE__ */ new Set(["pending", "canceled", "skipped"]);
function monoFont(cx) {
  try {
    return cx?.theme?.()?.typography?.mono || "monospace";
  } catch {
    return "monospace";
  }
}
function emptyText(d) {
  const repos = shared("dock.git.state")?.repos;
  const wt = Array.isArray(repos) ? repos.flatMap((r) => r.worktrees ?? []).find((w) => w.id === d.worktree) : null;
  if (wt?.pipeline?.status === "none") return "No pipeline for this branch yet.";
  return d.provider ? "Checking the pipeline\u2026" : "No CI for this repo.";
}
var Pipelines = class extends View {
  init(_props, cx) {
    this.retrying = false;
    this.mono = "monospace";
    this.closed = false;
    if (checking() || this.looping) return;
    this.looping = true;
    cx.spawn(async (cx2) => {
      try {
        for (let tick = 0; !this.closed; tick++) {
          if (tick % HEARTBEAT_TICKS === 0 && this.shown()) setShared(WATCHING_KEY, { at: Date.now() });
          await cx2.sleep(TICK_MS);
          if (!this.closed && this.shown() && this.takeRedraw()) cx2.notify();
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
    cx.spawn(async (cx2) => {
      await cx2.sleep(RETRY_SHOW_MS);
      this.retrying = false;
      gitCommand("git.refresh");
      cx2.notify();
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
    return div().id(id).flex_none().px(6).h(20).rounded(5).flex().items_center().text_size(11.5).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(tip).on_click((_e, cx) => {
      cx.stop_propagation();
      action(cx);
    }).child(label);
  }
  header(t, d, overlay) {
    const title = d?.repo ? `${d.repo} \xB7 ${d.branch ?? "detached"}` : "Pipelines";
    const web = d?.pipeline?.webUrl && PROVIDER[d.provider];
    return h_flex().flex_none().px(16).pt(overlay ? 14 : 12).pb(8).gap(6).items_center().child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(title)).when(Boolean(web), (el) => el.child(this.link(
      t,
      "pl-open",
      `\u2197 ${web}`,
      `Open the pipeline in ${web}`,
      () => gitCommand("git.open")
    ))).when(overlay, (el) => el.child(div().id("pl-close").flex_none().size(22).rounded(5).flex().items_center().justify_center().text_size(15).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close").on_click(() => this.closeClicked()).child("\xD7")));
  }
  // The error, and the login command to run when there is one.
  warning(t, d) {
    return v_flex().mx(16).mb(10).p(10).gap(6).flex_none().rounded(6).border(1).border_color(WARN).child(h_flex().gap(6).items_start().text_size(12).text_color(t.foreground).child(div().flex_none().text_color(WARN).child("\u26A0")).child(div().flex_1().min_w(0).child(d.error ? `Pipeline: ${d.error}` : "Pipeline status unknown"))).when(Boolean(d.hint), (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Run this, then press \u27F3 in Git projects:")).child(div().px(8).py(4).rounded(4).bg(t.hover).font_family(this.mono).text_size(12).text_color(t.foreground).child(d.hint)));
  }
  pipelineLine(t, d) {
    const p = d.pipeline;
    const tones = this.tones(t);
    const badge = badgeOf({ status: p.status });
    const when = ago(p.createdAt, Date.now());
    const line = h_flex().flex_wrap().px(16).gap(8).items_center().flex_none().text_size(12.5).when(p.number != null, (el) => el.child(div().flex_none().font_medium().text_color(t.foreground).child(`#${p.number}`))).child(h_flex().flex_none().gap(4).text_color(tones[badge.tone] ?? t.dim).child(div().child(badge.glyph || "\u2013")).child(div().child(p.status))).when(Boolean(when), (el) => el.child(div().flex_none().text_color(t.dim).child(`\xB7 ${when}`))).when(Boolean(p.sha), (el) => el.child(div().flex_none().font_family(this.mono).text_size(11.5).text_color(t.muted).child(String(p.sha).slice(0, 8))));
    const notes = [d.olderThanHead && "(older commit than local HEAD)", d.via && d.via !== "fetch" && `via ${d.via}`].filter(Boolean);
    return v_flex().gap(3).flex_none().child(line).when(notes.length > 0, (el) => el.child(div().px(16).text_size(11.5).text_color(t.dim).child(notes.join(" \xB7 "))));
  }
  // A stage's (or a one-stage build's) worst glyph and done/total, e.g. "● 1/3"; only the glyph when every job
  // waits for a person (the total leaves those out).
  summary(t, s) {
    const text = s.total > 0 ? `${GLYPH[s.bucket]} ${s.done}/${s.total}` : GLYPH[s.bucket];
    return div().flex_none().font_family(this.mono).text_size(11.5).text_color(this.tones(t)[TONE[s.bucket]]).child(text);
  }
  groupHeader(t, g, gi, summary) {
    return h_flex().id(`pl-group-${gi}`).h(24).px(16).pt(gi === 0 ? 0 : 8).gap(8).items_center().flex_none().child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(g.title)).when(Boolean(summary), (el) => el.child(this.summary(t, summary)));
  }
  stageHeader(t, s, gi, si) {
    return h_flex().id(`pl-stage-${gi}-${si}`).h(22).px(16).pt(4).gap(8).items_center().flex_none().text_size(12).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.name)).child(this.summary(t, s.summary));
  }
  // One job: glyph, name, its time (duration, or live elapsed while running) and the provider's word when the glyph
  // doesn't say it all. A running job has an accent bar and, when known, what it is doing now on a second line:
  // the log's last line (GitLab) or its current step (GitHub).
  jobRow(t, job, index, now) {
    const bucket = bucketOf(job);
    const running = bucket === "running";
    const time = running ? elapsed(job.startedAt, now) : duration(job.duration);
    const word = job.label ?? (WORDED.has(bucket) || running && !time ? bucket : null);
    const step = job.step ? `step ${job.step.index}/${job.step.total} \xB7 ${job.step.name}` : null;
    const doing = running ? job.logLine || step : null;
    const top = h_flex().h(22).gap(8).items_center().text_size(12).child(div().flex_none().w(12).text_color(this.tones(t)[TONE[bucket]]).child(GLYPH[bucket])).child(div().flex_1().min_w(0).truncate().text_color(running ? t.accent : t.foreground).child(job.name)).when(Boolean(time), (el) => el.child(div().flex_none().font_family(this.mono).text_size(11.5).text_color(running ? t.accent : t.dim).child(time))).when(Boolean(word), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(word))).when(Boolean(job.webUrl), (el) => el.child(this.link(
      t,
      `pl-job-open-${index}`,
      "\u2197",
      "Open the job",
      () => gitCommand("git.open.job", { index })
    )));
    return v_flex().id(`pl-job-${index}`).flex_none().ml(14).pr(10).tooltip(job.stage ? `${job.name} (${job.stage})` : job.name).when(running, (el) => el.border_l(2).border_color(t.accent).pl(8)).when(!running, (el) => el.pl(10)).child(top).when(Boolean(doing), (el) => el.child(div().pl(20).pb(2).truncate().font_family(this.mono).text_size(11).text_color(t.dim).child(doing)));
  }
  // Before the first full poll the detail has no jobs yet, only the stages' names and statuses: those as a strip.
  stageStrip(t, p) {
    const tones = this.tones(t);
    const list = Array.isArray(p.stages) ? p.stages : [];
    if (!list.length) return null;
    return h_flex().flex_wrap().px(16).pt(10).gap(12).flex_none().text_size(12).children(list.map((s, i) => {
      const b = badgeOf({ status: s.status });
      return h_flex().id(`pl-strip-${i}`).gap(4).flex_none().tooltip(`${s.name}: ${s.status}`).child(div().text_color(t.foreground).child(s.name)).child(div().text_color(tones[b.tone] ?? t.dim).child(b.glyph || "\u2013"));
    }));
  }
  // The count line, then every job of the commit's builds: group headers, stage headers, one row per job.
  jobList(t, d) {
    const p = d.pipeline;
    const jobs = Array.isArray(p.jobs) ? p.jobs : [];
    if (!jobs.length) return this.stageStrip(t, p);
    const now = Date.now();
    const groups = viewGroups(p, d.branch);
    const lone = groups.length === 1 && groups[0].title === `#${p.number}` && groups[0].stages.every((s) => s.name != null);
    const rows = [div().px(16).pb(4).text_size(12).text_color(t.dim).child(countLine(jobs, p.jobsTruncated))];
    groups.forEach((g, gi) => {
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
    const label = this.retrying ? "Retrying\u2026" : "Retry";
    const tip = busy ? "The pipeline is still running" : canRetry(p.status) ? "Retry the failed jobs" : "Nothing to retry";
    return v_flex().px(16).pt(12).gap(6).flex_none().child(div().id("pl-retry").flex_none().self_start().px(12).h(26).rounded(6).border(1).border_color(t.border).flex().items_center().text_size(12.5).text_color(t.foreground).tooltip(tip).when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
      cx.stop_propagation();
      this.retry(cx);
    })).when(!enabled, (el) => el.opacity(0.45)).child(label)).when(Boolean(retryError) && !this.retrying, (el) => el.child(div().text_size(11.5).text_color(WARN).child(`Retry failed: ${retryError}`)));
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
    return v_flex().id("dock-pipelines").size_full().min_h(0).bg(overlay ? t.popover ?? t.chrome : t.chrome).text_size(13).text_color(t.foreground).child(this.header(t, d, overlay)).child(v_flex().id("pl-body").flex_1().min_h(0).pb(12).overflow_y_scrollbar().children(this.body(t, d)));
  }
};
export {
  Pipelines as default
};
