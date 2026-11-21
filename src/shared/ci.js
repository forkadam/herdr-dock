// Pure CI helpers: map GitLab / GitHub Actions API JSON to one Pipeline shape,
// plus alert and polling-cadence rules (no Node built-ins: bundled into Herdr mods).

// Worst first. A stage / pipeline takes the status with the lowest index.
const RANK = ["failed", "running", "pending", "unknown", "canceled", "passed", "skipped"];
const rank = (s) => {
  const i = RANK.indexOf(s);
  return i < 0 ? RANK.indexOf("pending") : i;
};
const worst = (statuses) => statuses.reduce((a, b) => (rank(b) < rank(a) ? b : a));

const GITLAB = {
  success: "passed", failed: "failed", running: "running", canceled: "canceled", skipped: "skipped",
  pending: "pending", created: "pending", waiting_for_resource: "pending", preparing: "pending",
  scheduled: "pending", manual: "pending",
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
  return {
    id: p.id,
    status: normalizeStatus("gitlab", p),
    ref: p.ref,
    sha: p.sha,
    webUrl: p.web_url,
    createdAt: p.created_at,
    // The alert key's finish time. The pipelines list endpoint has no finished_at, and updated_at moves on a
    // still-failed pipeline, so it comes from the failed jobs (a retry that fails again moves it); never updated_at.
    finishedAt: lastFail ?? p.finished_at ?? null,
    stages: [...byStage].map(([name, sts]) => ({ name, status: worst(sts) })),
    failedJobs,
  };
}

const secondsBetween = (a, b) => {
  const d = (Date.parse(b) - Date.parse(a)) / 1000;
  return Number.isFinite(d) ? d : null;
};

export function githubLatest(runsJson, jobsByRunId) {
  const runs = runsJson?.workflow_runs ?? [];
  if (!runs.length) return null;
  const time = (r) => Date.parse(r.created_at) || 0;
  const newest = runs.reduce((a, b) => (time(b) > time(a) ? b : a));
  const same = runs.filter((r) => r.head_sha === newest.head_sha);
  const stages = same.map((r) => ({ name: r.name, status: normalizeStatus("github", r) }));
  const failedJobs = [];
  same.forEach((r, i) => {
    if (stages[i].status !== "failed") return;
    for (const j of jobsByRunId?.[r.id]?.jobs ?? []) {
      if (normalizeStatus("github", j) !== "failed") continue;
      failedJobs.push({
        name: j.name, stage: r.name, webUrl: j.html_url,
        duration: j.started_at && j.completed_at ? secondsBetween(j.started_at, j.completed_at) : null,
      });
    }
  });
  const failedRun = same.find((_, i) => stages[i].status === "failed");
  // finishedAt: the newest updated_at of the commit's failed runs (a rerun that fails again moves it), so a
  // workflow still running beside a failed one doesn't change it. With no failed run, of all its runs.
  const failedRuns = same.filter((_, i) => stages[i].status === "failed");
  const stamps = (failedRuns.length ? failedRuns : same).map((r) => r.updated_at).filter(Boolean);
  const finishedAt = stamps.length ? stamps.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : null;
  const times = same.map(time).filter(Boolean);
  const earliest = same.find((r) => time(r) === Math.min(...times)) ?? newest;
  return {
    id: newest.head_sha,
    status: worst(stages.map((s) => s.status)),
    ref: newest.head_branch,
    sha: newest.head_sha,
    webUrl: (failedRun ?? newest).html_url,
    createdAt: earliest.created_at,
    finishedAt,
    stages,
    failedJobs,
  };
}

// The dock.git.alerted value for a failed pipeline: its id plus when it finished, so a Retry that fails again
// (same GitLab pipeline id, same GitHub sha) is a new failure.
export const alertKey = (p) => `${p.id}|${p.finishedAt ?? null}`;

export function alertFor({ prev, cur, alerted, startedAt, repo, branch }) {
  if (cur.status !== "failed") return null;
  // A bare id is the old format of alerted: it still suppresses that pipeline.
  if (alerted != null && (alerted === alertKey(cur) || String(alerted) === String(cur.id))) return null;
  const refinished = prev?.finishedAt != null && cur.finishedAt != null && prev.finishedAt !== cur.finishedAt;
  const fresh = prev
    ? prev.status !== "failed" || prev.id !== cur.id || refinished
    : Date.parse(cur.createdAt) > startedAt;
  if (!fresh) return null;
  const jobs = cur.failedJobs ?? [];
  const more = jobs.length - 1;
  const body = jobs.length
    ? `Pipeline failed: ${jobs[0].name}${more > 0 ? ` (+${more} more)` : ""}`
    : "Pipeline failed";
  return { title: `${repo} · ${branch}`, body };
}

export function ciInterval({ status, upstreamChangedAt, now }) {
  if (status === "running" || status === "pending") return 30000;
  if (now - upstreamChangedAt < 120000) return 15000;
  return 300000;
}

export function gitInterval({ open }) {
  return open ? 15000 : 60000;
}
