// src/mods/dock-pipelines/main.js
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, props, closeOverlay } from "herdr";

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

// src/mods/dock-pipelines/main.js
var WARN = "#d29922";
var PROVIDER = { gitlab: "GitLab", github: "GitHub" };
var RETRY_SHOW_MS = 3e3;
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
    cx.spawn(async (cx2) => {
      await cx2.sleep(RETRY_SHOW_MS);
      this.retrying = false;
      gitCommand("git.refresh");
      cx2.notify();
    });
  }
  close() {
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
    ))).when(overlay, (el) => el.child(div().id("pl-close").flex_none().size(22).rounded(5).flex().items_center().justify_center().text_size(15).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close").on_click(() => this.close()).child("\xD7")));
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
  stages(t, p) {
    const tones = this.tones(t);
    const list = Array.isArray(p.stages) ? p.stages : [];
    if (!list.length) return null;
    return h_flex().flex_wrap().px(16).pt(10).gap(12).flex_none().text_size(12).children(list.map((s, i) => {
      const b = badgeOf({ status: s.status });
      return h_flex().id(`pl-stage-${i}`).gap(4).flex_none().tooltip(`${s.name}: ${s.status}`).child(div().text_color(t.foreground).child(s.name)).child(div().text_color(tones[b.tone] ?? t.dim).child(b.glyph || "\u2013"));
    }));
  }
  failedJobs(t, p) {
    const jobs = Array.isArray(p.failedJobs) ? p.failedJobs : [];
    if (!jobs.length) return null;
    const red = t.ansi1 ?? "#e5484d";
    return v_flex().pt(10).gap(2).flex_none().children(jobs.map((j, i) => h_flex().id(`pl-job-${i}`).h(24).px(16).gap(8).items_center().flex_none().text_size(12).tooltip(j.stage ? `${j.name} (stage ${j.stage})` : j.name).child(div().flex_none().text_color(red).child("\u2715")).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(j.name)).child(div().flex_none().font_family(this.mono).text_size(11.5).text_color(t.dim).child(duration(j.duration))).when(Boolean(j.webUrl), (el) => el.child(this.link(
      t,
      `pl-job-open-${i}`,
      "open job \u2197",
      "Open the job log",
      () => gitCommand("git.open.job", { index: i })
    )))));
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
    const stages = this.stages(t, p);
    if (stages) out.push(stages);
    const jobs = this.failedJobs(t, p);
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
