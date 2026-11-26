// Pure formatting for the Pipelines panel (no host imports: node --test runs it).
import { resumeClock } from "../../shared/ci-budget.js";

// "3m ago" for an ISO time before `now` (ms). Under a minute, or a little ahead (clock skew): "just now".
// A missing or unparsable time gives "".
export function ago(createdAt, now) {
  const at = createdAt == null ? NaN : Date.parse(createdAt);
  if (!Number.isFinite(at)) return "";
  const sec = Math.floor((now - at) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A job's duration in seconds as "45s", "2m14s" or "1h03m". Missing or negative gives "".
export function duration(sec) {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  if (s < 60) return `${s}s`;
  const pad = (n) => String(n).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}m`;
}

// Retry only makes sense for a finished pipeline that didn't pass.
export function canRetry(status) {
  return status === "failed" || status === "canceled";
}

// Counts are listed in this order, most urgent first.
const COUNT_ORDER = ["failed", "running", "pending", "manual", "warn", "passed", "canceled", "skipped"];
// A stage shows its worst bucket; a manual job never outranks a job that is really doing something.
const WORST_ORDER = ["failed", "running", "pending", "warn", "canceled", "passed", "skipped", "manual"];
const DONE = new Set(["passed", "failed", "warn", "canceled", "skipped"]);

// The bucket a job is counted in: waiting for a person (manual/scheduled), an allowed failure (warn), or its status.
export function bucketOf(job) {
  if (job.label === "manual" || job.label === "scheduled") return "manual";
  if (job.status === "failed") return job.allowFailure ? "warn" : "failed";
  return COUNT_ORDER.includes(job.status) ? job.status : "pending";
}

// "12 jobs · 1 running · 4 pending · 7 passed"; "100+ jobs" when the list was cut off; "" for no jobs.
export function countLine(jobs, truncated) {
  if (!jobs.length) return "";
  const counts = {};
  for (const j of jobs) counts[bucketOf(j)] = (counts[bucketOf(j)] ?? 0) + 1;
  const head = `${jobs.length}${truncated ? "+" : ""} ${jobs.length === 1 && !truncated ? "job" : "jobs"}`;
  return [head, ...COUNT_ORDER.filter((b) => counts[b]).map((b) => `${counts[b]} ${b}`)].join(" · ");
}

// A stage's worst bucket and how many of its jobs are done. Manual jobs are not part of the total.
export function stageSummary(jobs) {
  const buckets = jobs.map(bucketOf);
  const bucket = WORST_ORDER.find((b) => buckets.includes(b)) ?? "pending";
  return {
    bucket,
    done: buckets.filter((b) => DONE.has(b)).length,
    total: buckets.filter((b) => b !== "manual").length,
  };
}

// How long a running job has been going, via duration(); "" when it has no start time.
export function elapsed(startedAt, now) {
  const at = startedAt == null ? NaN : Date.parse(startedAt);
  if (!Number.isFinite(at)) return "";
  return duration((now - at) / 1000);
}

// The commit's builds as groups -> stages -> job rows, groups newest first as given. `index` is the job's place in
// pipeline.jobs. A group whose only stage carries the group's own name (a GitHub workflow) gets no stage header.
// Jobs that belong to no listed group (state written before groups existed) go in a trailing "Jobs" group.
// Two builds with the same title (a push and a pull_request run of one GitHub workflow) also say their event.
export function viewGroups(pipeline, branch) {
  const jobs = pipeline.jobs ?? [];
  const groups = pipeline.groups ?? [];
  const known = new Set(groups.map((g) => g.key));
  const build = (rows, groupName) => {
    const byStage = new Map();
    rows.forEach((row) => {
      const stage = row.job.stage;
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage).push(row);
    });
    return [...byStage].map(([name, r]) => ({
      name: groupName != null && byStage.size === 1 && name === groupName ? null : name,
      summary: stageSummary(r.map((x) => x.job)),
      jobs: r,
    }));
  };
  const indexed = jobs.map((job, index) => ({ job, index }));
  const titles = groups.map((g) => (g.ref && g.ref !== branch ? `${g.name} · ${g.ref}` : g.name));
  const shared = (t) => titles.filter((x) => x === t).length > 1;
  const out = groups.map((g, i) => ({
    key: g.key,
    title: shared(titles[i]) && g.event ? `${titles[i]} · ${g.event}` : titles[i],
    webUrl: g.webUrl,
    stages: build(indexed.filter((r) => r.job.group === g.key), g.name),
  }));
  const rest = indexed.filter((r) => !known.has(r.job.group));
  if (rest.length) out.push({ key: "", title: "Jobs", webUrl: null, stages: build(rest, null) });
  return out;
}

const API_NAME = { github: "GitHub", gitlab: "GitLab" };
const isPaused = (budget, now) => typeof budget?.limitedUntil === "number" && budget.limitedUntil > now;

// The Retry button's tooltip while the host is paused at its API limit (the button is then disabled: its POST would
// fail fast); null when it isn't.
export function limitTip(budget, now) {
  return isPaused(budget, now) ? `API limit reached — resumes at ${resumeClock(budget.limitedUntil)}` : null;
}

// 4321 -> "4,321" by a fixed rule, not the machine's locale, so the line reads the same everywhere.
function thousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// The API budget under the pipeline line: a warn line while the host is paused at its limit (whatever numbers are
// known), else a dim "left" line when remaining and limit are both numbers. A pause without readable headers has
// no numbers, so it can only warn. `limitedUntil` and `now` are ms; the time is local, HH:MM, rounded up.
export function budgetLine(budget, now) {
  if (!budget) return null;
  const name = `${API_NAME[budget.provider] ?? budget.provider} API`;
  if (isPaused(budget, now)) return { tone: "warn", text: `${name} limit reached — resumes at ${resumeClock(budget.limitedUntil)}` };
  const { remaining, limit } = budget;
  if (!Number.isFinite(remaining) || !Number.isFinite(limit)) return null;
  return { tone: "dim", text: `${name}: ${thousands(remaining)} of ${thousands(limit)} left` };
}
