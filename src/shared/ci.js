// Pure CI helpers: map GitLab / GitHub Actions API JSON to one Pipeline shape,
// plus alert and polling-cadence rules (no Node built-ins: bundled into Herdr mods).

// Worst first. A stage / pipeline takes the status with the lowest index.
const RANK = ["failed", "running", "pending", "unknown", "canceled", "passed", "skipped"];
const rank = (s) => {
  const i = RANK.indexOf(s);
  return i < 0 ? RANK.indexOf("pending") : i;
};
const worst = (statuses) => statuses.reduce((a, b) => (rank(b) < rank(a) ? b : a));
// A Pipeline's busy: some run of it is still going, whatever its worst status (a failed branch pipeline can sit
// beside a running tag one).
const isBusy = (status) => status === "running" || status === "pending";

const GITLAB = {
  success: "passed", failed: "failed", running: "running", canceled: "canceled", skipped: "skipped",
  pending: "pending", created: "pending", waiting_for_resource: "pending", preparing: "pending",
  scheduled: "pending", manual: "pending", canceling: "canceled",
};
const GITHUB_DONE = {
  success: "passed", failure: "failed", timed_out: "failed", startup_failure: "failed", action_required: "failed",
  cancelled: "canceled", skipped: "skipped", neutral: "skipped",
};

export function normalizeStatus(provider, raw) {
  const r = raw ?? {};
  if (provider === "gitlab") return GITLAB[r.status] ?? "unknown";
  if (r.status === "completed") return GITHUB_DONE[r.conclusion] ?? "unknown";
  return r.status === "in_progress" ? "running" : "pending";
}

const GITLAB_LABEL = {
  manual: "manual", scheduled: "scheduled", created: "created", waiting_for_resource: "waiting", preparing: "waiting",
};
const GITLAB_PAGE = 100; // jobs per page the client asks for: a full page means there may be more

// One job of the jobs view; logLine is filled later by the collector, for the running job only.
export function gitlabJob(j, groupKey) {
  const status = normalizeStatus("gitlab", j);
  const allowed = j.allow_failure === true;
  return {
    id: j.id, name: j.name, stage: j.stage, group: groupKey, status,
    label: status === "failed" && allowed ? "allowed to fail" : GITLAB_LABEL[j.status] ?? null,
    allowFailure: allowed, duration: j.duration ?? null, startedAt: j.started_at ?? null,
    webUrl: j.web_url ?? null, step: null, logLine: null, bridge: false,
  };
}

// A bridge triggers a downstream pipeline; the job shows that pipeline's status and link, not the trigger's own.
export function gitlabBridge(b, groupKey) {
  const d = b.downstream_pipeline;
  const base = gitlabJob(b, groupKey);
  if (!d) return { ...base, bridge: true };
  const own = b.pipeline?.project_id;
  const otherProject = own != null && d.project_id != null && own !== d.project_id;
  return {
    ...base,
    status: normalizeStatus("gitlab", d),
    webUrl: d.web_url ?? base.webUrl,
    label: otherProject ? `→ ${d.project_path ?? "downstream"}` : "child pipeline",
    bridge: true,
  };
}

// One failed pipeline (GitLab) or run (GitHub) of a Pipeline: its alert key, and what alertFor needs to tell a new
// failure from one already seen. Each has its own key, so a second failed build of the commit being retried, or
// passing, never changes the key of the one still failed.
const failure = (id, finishedAt, createdAt, jobs) =>
  ({ key: `${id}|${finishedAt ?? null}`, id, finishedAt: finishedAt ?? null, createdAt: createdAt ?? null, jobs });

export function gitlabPipeline(p, jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const byStage = new Map();
  const failedJobs = [];
  let lastFail = null; // the newest finished_at of the failed (not allowed-to-fail) jobs
  for (const j of list) {
    const status = normalizeStatus("gitlab", j);
    if (!byStage.has(j.stage)) byStage.set(j.stage, []);
    byStage.get(j.stage).push(status);
    if (status === "failed" && j.allow_failure !== true) {
      failedJobs.push({ name: j.name, stage: j.stage, webUrl: j.web_url, duration: j.duration ?? null });
      if (j.finished_at && (!lastFail || Date.parse(j.finished_at) > Date.parse(lastFail))) lastFail = j.finished_at;
    }
  }
  const status = normalizeStatus("gitlab", p);
  const finishedAt = lastFail ?? p.finished_at ?? null;
  const failures = status === "failed"
    ? [failure(p.id, finishedAt, p.created_at, failedJobs.map((j) => j.name))]
    : [];
  return {
    id: p.id,
    number: p.id ?? null, // what the UI shows as #<number>
    status,
    busy: isBusy(status),
    ref: p.ref,
    sha: p.sha,
    webUrl: p.web_url,
    createdAt: p.created_at,
    // The alert key's finish time. The pipelines list endpoint has no finished_at, and updated_at moves on a
    // still-failed pipeline, so it comes from the failed jobs (a retry that fails again moves it); never updated_at.
    finishedAt,
    stages: [...byStage].map(([name, sts]) => ({ name, status: worst(sts) })),
    failedJobs,
    failedKeys: failures.map((f) => f.key),
    failures,
    jobs: [],
    groups: [],
    jobsTruncated: false,
  };
}

const gitlabGroup = (p) => ({
  key: `gl:${p.id}`, id: p.id, name: `#${p.id}`, ref: p.ref, event: p.source ?? null, status: normalizeStatus("gitlab", p), webUrl: p.web_url,
});

// Every pipeline of one commit (a branch and a tag pipeline can share it), newest first, as one Pipeline: the
// newest one's identity and stages, the worst status, every failed job, and all jobs with bridges by pipeline.
export function gitlabCommitPipeline(entries) {
  if (!entries.length) return null;
  const parts = entries.map((e) => gitlabPipeline(e.pipeline, e.jobs));
  const base = parts[0];
  const status = worst(parts.map((x) => x.status));
  // While failed, id + finishedAt (what clears a stale Retry error) are the failed pipelines' own, so a tag pipeline
  // starting or passing beside a failed branch pipeline moves neither. Alerts key on each failed pipeline instead
  // (failures). The UI's number, link and age stay the newest's.
  const keyed = status === "failed" ? parts.filter((x) => x.status === "failed") : parts;
  const finishedAt = latestStamp(keyed.map((x) => x.finishedAt).filter(Boolean));
  const jobs = entries.flatMap((e) => {
    const key = `gl:${e.pipeline.id}`;
    const all = [
      ...(Array.isArray(e.jobs) ? e.jobs : []).map((j) => gitlabJob(j, key)),
      ...(Array.isArray(e.bridges) ? e.bridges : []).map((b) => gitlabBridge(b, key)),
    ];
    return all.sort((a, b) => a.id - b.id);
  });
  return {
    ...base,
    id: keyed[0].id,
    status,
    busy: parts.some((x) => x.busy),
    failedJobs: parts.flatMap((x) => x.failedJobs),
    failedKeys: parts.flatMap((x) => x.failedKeys),
    failures: parts.flatMap((x) => x.failures),
    finishedAt,
    jobs,
    groups: entries.map((e) => gitlabGroup(e.pipeline)),
    jobsTruncated: entries.some((e) => (e.jobs?.length ?? 0) >= GITLAB_PAGE || (e.bridges?.length ?? 0) >= GITLAB_PAGE),
  };
}

// The newest of some ISO stamps, skipping any that do not parse (one bad first stamp must not outrank later valid ones); null if none parse.
const latestStamp = (stamps) =>
  stamps.reduce((a, b) => (Number.isNaN(Date.parse(b)) || (a != null && Date.parse(a) >= Date.parse(b)) ? a : b), null);

const secondsBetween = (a, b) => {
  const d = (Date.parse(b) - Date.parse(a)) / 1000;
  return Number.isFinite(d) ? d : null;
};

export function githubJob(j, run) {
  const steps = Array.isArray(j.steps) ? j.steps : [];
  const at = steps.findIndex((st) => st.status === "in_progress");
  return {
    id: j.id, name: j.name, stage: run.name, group: `gh:${run.id}`, status: normalizeStatus("github", j),
    label: null, allowFailure: false,
    duration: j.started_at && j.completed_at ? secondsBetween(j.started_at, j.completed_at) : null,
    startedAt: j.started_at ?? null, webUrl: j.html_url ?? null,
    step: at < 0 ? null : { index: at + 1, total: steps.length, name: steps[at].name },
    logLine: null, bridge: false,
  };
}

export function githubLatest(runsJson, jobsByRunId) {
  const runs = runsJson?.workflow_runs ?? [];
  if (!runs.length) return null;
  const time = (r) => Date.parse(r.created_at) || 0;
  const newest = runs.reduce((a, b) => (time(b) > time(a) ? b : a));
  const same = runs.filter((r) => r.head_sha === newest.head_sha);
  const stages = same.map((r) => ({ name: r.name, status: normalizeStatus("github", r) }));
  const failedJobs = [];
  const failures = [];
  same.forEach((r, i) => {
    if (stages[i].status !== "failed") return;
    const names = [];
    for (const j of jobsByRunId?.[r.id]?.jobs ?? []) {
      if (normalizeStatus("github", j) !== "failed") continue;
      names.push(j.name);
      failedJobs.push({
        name: j.name, stage: r.name, webUrl: j.html_url,
        duration: j.started_at && j.completed_at ? secondsBetween(j.started_at, j.completed_at) : null,
      });
    }
    // A rerun keeps the run id and moves updated_at, so a rerun that fails again is a new key.
    failures.push(failure(r.id, r.updated_at, r.created_at, names));
  });
  const failedRun = same.find((_, i) => stages[i].status === "failed");
  // finishedAt: the newest updated_at of the commit's failed runs (a rerun that fails again moves it), so a
  // workflow still running beside a failed one doesn't change it. With no failed run, of all its runs.
  const failedRuns = same.filter((_, i) => stages[i].status === "failed");
  const stamps = (failedRuns.length ? failedRuns : same).map((r) => r.updated_at).filter(Boolean);
  const finishedAt = latestStamp(stamps);
  const times = same.map(time).filter(Boolean);
  const earliest = same.find((r) => time(r) === Math.min(...times)) ?? newest;
  const newestFirst = [...same].sort((a, b) => time(b) - time(a));
  const jobs = newestFirst.flatMap((r) => (jobsByRunId?.[r.id]?.jobs ?? []).map((j) => githubJob(j, r)));
  const groups = newestFirst.map((r) => ({
    key: `gh:${r.id}`, id: r.id, name: r.name, ref: r.head_branch, event: r.event ?? null, status: normalizeStatus("github", r),
    webUrl: r.html_url,
  }));
  const jobsTruncated = same.some((r) => {
    const e = jobsByRunId?.[r.id];
    return e != null && (e.total_count ?? 0) > (e.jobs?.length ?? 0);
  });
  return {
    id: newest.head_sha, // the alert identity; the UI shows number
    number: newest.run_number ?? null,
    status: worst(stages.map((s) => s.status)),
    busy: stages.some((s) => isBusy(s.status)),
    ref: newest.head_branch,
    sha: newest.head_sha,
    webUrl: (failedRun ?? newest).html_url,
    createdAt: earliest.created_at,
    finishedAt,
    stages,
    failedJobs,
    failedKeys: failures.map((f) => f.key),
    failures,
    jobs,
    groups,
    jobsTruncated,
  };
}

// A dock.git.alerted key: an id plus when it finished, so a Retry that fails again (same id) is a new failure. Each
// failed pipeline / run has one (Pipeline.failedKeys); this is the key of a Pipeline taken as one failure.
export const alertKey = (p) => `${p.id}|${p.finishedAt ?? null}`;

const ALERTED_MAX = 20;
const alertedList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// A worktree's dock.git.alerted value after alerting `key`: a list of the last 20 keys, newest last. A branch
// switch forgets the last-seen pipeline, so one key per worktree would re-alert the other branch's old failure on
// every switch. An old single-string value is kept as the list's first entry.
export function nextAlerted(prev, key) {
  const list = alertedList(prev).filter((k) => k !== key);
  list.push(key);
  return list.slice(-ALERTED_MAX);
}

// A Pipeline's failed builds. One mapped before failures existed (or built by hand) is one failure under its own id.
const failuresOf = (p) =>
  Array.isArray(p?.failures) ? p.failures
    : p?.status === "failed" ? [failure(p.id, p.finishedAt, p.createdAt, null)] : [];

// Whether the previous poll's Pipeline listed build `id` at all (failed or not). One without groups (mapped before
// groups existed, or built by hand) is taken to have listed it.
const listed = (p, id) => !Array.isArray(p.groups) || p.groups.some((g) => String(g.id) === String(id));

// The failed builds of `cur` to alert about: not in `alerted`, and new. If the previous poll listed the build, new
// means it wasn't failed then, or failed again since (both finish stamps known and different: a stamp still
// unknown, say its jobs couldn't be read, is not a new failure). With no previous poll (start-up, a branch switch),
// or one that didn't list the build (the HEAD-commit query failed and the branch's answer stood in), the build was
// created after the dock started: its own created time, not the newest build's, so a tag build created after
// start-up doesn't make an old branch failure new.
export function freshFailures({ prev, cur, alerted, startedAt }) {
  if (cur?.status !== "failed") return [];
  // alerted: a list of keys (or, in older stores, one key or a bare id). A bare id still suppresses that build.
  const seen = alertedList(alerted);
  const before = prev ? failuresOf(prev) : null;
  return failuresOf(cur).filter((f) => {
    if (seen.some((k) => k != null && (k === f.key || String(k) === String(f.id)))) return false;
    if (!before || !listed(prev, f.id)) return Date.parse(f.createdAt) > startedAt;
    return !before.some((b) => String(b.id) === String(f.id)
      && (b.finishedAt == null || f.finishedAt == null || b.finishedAt === f.finishedAt));
  });
}

// The notification for freshFailures(args), or null. The body names the failed jobs of the newly failed builds only.
export function alertFor(args) {
  const fresh = freshFailures(args);
  if (!fresh.length) return null;
  const jobs = fresh.flatMap((f) => f.jobs ?? (args.cur.failedJobs ?? []).map((j) => j.name));
  const more = jobs.length - 1;
  const body = jobs.length
    ? `Pipeline failed: ${jobs[0]}${more > 0 ? ` (+${more} more)` : ""}`
    : "Pipeline failed";
  return { title: `${args.repo} · ${args.branch}`, body };
}

export function ciInterval({ status, upstreamChangedAt, now, watched }) {
  // A watched panel shows the running job live, so it polls faster than the background cadence.
  if (watched && (status === "running" || status === "pending")) return 10000;
  if (status === "running" || status === "pending") return 30000;
  if (now - upstreamChangedAt < 120000) return 15000;
  return 300000;
}

export function gitInterval({ open }) {
  return open ? 15000 : 60000;
}

// The last meaningful line of a job log, for the running job's live line. Only the tail is read (a log can be
// megabytes). Colour codes, OSC sequences (hyperlinks, titles), charset escapes, GitLab's section markers and stray
// control characters are noise, and a line redrawn with \r keeps only its final draw.
// `redact` (the CI client's) runs after the strip, so a token split by a colour code is whole again, and before
// the 200-character cut, so the cut can't leave part of a token it no longer recognises.
export function lastLogLine(text, redact = (s) => s) {
  if (!text) return null;
  const lines = text
    .slice(-16384)
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b[()][A-Za-z0-9]/g, "")
    .replace(/section_(start|end):\d+:[^\r\n]*/g, "")
    .split("\n")
    // CRLF logs: drop the line's trailing \r first, or the redraw rule below would empty it.
    .map((l) => l.replace(/\r+$/, ""))
    // Then whatever control characters are left (a lone ESC, NUL, backspace, DEL): after the \r rule, which needs \r.
    .map((l) => l.slice(l.lastIndexOf("\r") + 1).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim())
    .filter(Boolean);
  return lines.length ? redact(lines[lines.length - 1]).slice(0, 200) : null;
}
