// CI server access for the collector: the provider and login of each host (tokens borrowed from glab/gh and
// kept in this closure only), API requests through the injected fetch with a glab/gh CLI fallback, a 401
// re-login, timeouts on the collector's clock, and per-host backoff. (No Node built-ins: bundled into Herdr mods.)
import { limiter } from "./limiter.js";
import { normalizeStatus, gitlabCommitPipeline, githubLatest, lastLogLine } from "./ci.js";

const HTTP_LIMIT = 4; // HTTP requests (or CLI api calls) at once
const TIMEOUT = 15000;
const BACKOFF = [30000, 60000, 120000, 300000];
const HOSTS_KEY = "dock.git.hosts";
const RELOGIN = 300000; // a host with no login is checked again at the slow CI cadence
const COMMIT_GROUPS = 3; // GitLab: pipelines of one commit shown, the newest per ref
// Log tails per full poll. The HTTP limiter is shared by every host and worktree, so logs never take more than half.
const LOG_JOBS = 2;
const TRACE_TAIL = "bytes=-16384"; // lastLogLine reads only the last 16 KB
const TRACE_TAIL_CHARS = 16384; // the CLI route has no status: a body this short or shorter is taken as the tail
const TRACE_TIMEOUT = 8000;
// glab auth status output that clearly means "no login" (anything else non-zero may be the network).
const NOT_LOGGED_IN = /not (been )?authenticated|not logged in|no token|auth login|\b401\b|unauthori[sz]ed/i;
const MISSING_CLI = /ENOENT|not found|not recognized|no such file/i;

class Timeout extends Error {}

export function loginHint(provider, host) {
  if (provider === "github") return host === "github.com" ? "gh auth login" : `gh auth login --hostname ${host}`;
  return `glab auth login --hostname ${host}`;
}

const firstLine = (s) => String(s ?? "").trim().split(/\r?\n/)[0];

export function createCiClient(io, log) {
  const http = limiter(HTTP_LIMIT);
  // host -> { want, provider, login: Promise|null, loginDone, loginError, loginRetryAt, token, cli,
  //   failures, blockedUntil, windowEnd, lastError }
  const hosts = new Map();
  const deadlines = new Set(); // in-flight requests: { deadline, reject, ctl }
  const secrets = new Set(); // every token seen, to scrub from any text that leaves this module
  const redact = (s) => {
    let t = String(s ?? "");
    for (const k of secrets) t = t.split(k).join("***");
    return t;
  };
  // Full GitLab polls: per "host|path", jobId -> { line, busy, failLogged } for the jobs still running. A failed
  // trace call keeps the job's previous line, and is logged once until a call succeeds again. Keyed by repo, not
  // worktree, because only the watched worktree polls full.
  const lastLog = new Map();
  const rangeLogged = new Set(); // hosts whose answer to a Range request was logged (does GitLab honour it?)
  // Calls that may fail on every poll, logged once, then again only after a success: "commit|<host>|<path>" (the
  // HEAD-commit query) and "bridges|<host>|<path>|<pipeline id>" (bridges on an older GitLab, per pipeline so one
  // failing beside a working one still logs once).
  const failing = new Set();
  const failedOnce = (key, line) => {
    if (failing.has(key)) return;
    failing.add(key);
    log(line);
  };
  const succeeded = (key) => failing.delete(key);
  const rec = (host) => {
    if (!hosts.has(host)) hosts.set(host, {
      want: null, provider: undefined, login: null, loginDone: false, loginError: null, loginRetryAt: 0, token: null,
      cli: false, failures: 0, blockedUntil: 0, windowEnd: 0, lastError: null,
    });
    return hosts.get(host);
  };

  // Races fn(signal) against a deadline that sweep() enforces on the collector's clock (io.now()).
  function timed(fn, ms = TIMEOUT) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const entry = { deadline: io.now() + ms, ctl, reject: null };
    const timer = new Promise((_, reject) => { entry.reject = reject; });
    deadlines.add(entry);
    return Promise.race([Promise.resolve().then(() => fn(ctl?.signal)), timer]).finally(() => deadlines.delete(entry));
  }

  function sweep(now) {
    for (const e of [...deadlines]) {
      if (now < e.deadline) continue;
      deadlines.delete(e);
      e.reject(new Timeout("timeout"));
      try { e.ctl?.abort(); } catch { /* nothing to abort */ }
    }
  }

  // A local CLI call (glab/gh run on this PC). A rejection or timeout becomes code -1. The exec timeout makes
  // Herdr kill a hung CLI process too (the sweep only stops waiting for it).
  const cli = (cmd, args, ms = TIMEOUT) =>
    timed(() => io.exec(cmd, args, { timeout: ms }), ms).catch((e) => ({ code: -1, stdout: "", stderr: e instanceof Timeout ? "timeout" : String(e?.message ?? e) }));

  async function readToken(host, provider) {
    let token = "";
    if (provider === "github") {
      const r = await cli("gh", ["auth", "token", "--hostname", host]);
      if (r.code === 0) token = String(r.stdout ?? "").trim();
    } else {
      const r = await cli("glab", ["config", "get", "token", "--host", host]);
      if (r.code === 0) token = String(r.stdout ?? "").trim();
      if (!token) {
        // Keyring / OAuth logins: config has no token, but auth status can show it.
        const s = await cli("glab", ["auth", "status", "--hostname", host, "--show-token"]);
        const m = /Token:\s*(\S+)/.exec(`${s.stdout ?? ""}\n${s.stderr ?? ""}`);
        token = m && !/^\*+$/.test(m[1]) ? m[1] : "";
      }
    }
    if (token) secrets.add(token);
    return token || null;
  }

  // Sets h.provider, h.token and h.loginError ("not logged in" | "cannot reach <host>" | null).
  async function login(host, h) {
    const startedAt = io.now();
    h.loginError = null;
    if (h.want === "none") { h.provider = null; return; }
    const provider = h.want === "auto" ? (host === "github.com" ? "github" : null) : h.want;
    let unreachable = false;
    if (!provider) {
      // Any other host: GitLab when glab is logged in to it. Without glab or a login, it is still treated as
      // GitLab (unknown + login hint); dock.git.hosts can map the host to "none".
      const st = await cli("glab", ["auth", "status", "--hostname", host]);
      h.provider = "gitlab";
      if (st.code !== 0) {
        const out = `${st.stdout ?? ""}\n${st.stderr ?? ""}`;
        if ((st.code === -1 && MISSING_CLI.test(out)) || NOT_LOGGED_IN.test(out)) {
          h.loginError = "not logged in";
          return;
        }
        // Probably the network (VPN not up yet, a timeout): the stored token may still be there.
        unreachable = true;
      }
    } else h.provider = provider;
    h.token = await readToken(host, h.provider);
    if (h.token) return;
    h.loginError = unreachable ? `cannot reach ${host}` : "not logged in";
    if (unreachable) backoff(h, h.loginError, startedAt);
  }

  // Provider and login for a host: once, then again while there is no token (after the host's backoff when it
  // couldn't be reached, else every RELOGIN), or after reset().
  async function resolve(host) {
    const h = rec(host);
    const ov = io.shared(HOSTS_KEY)?.[host];
    const want = ov == null ? "auto" : ov === "gitlab" || ov === "github" ? ov : "none";
    if (h.want !== want) Object.assign(h, { want, provider: undefined, login: null, loginDone: false, token: null });
    if (h.login && h.loginDone && h.provider && !h.token && io.now() >= h.loginRetryAt) h.login = null;
    if (!h.login) {
      h.loginDone = false;
      h.login = login(host, h).finally(() => {
        h.loginDone = true;
        if (!h.token) h.loginRetryAt = h.loginError === "not logged in" ? io.now() + RELOGIN : h.blockedUntil;
      });
    }
    await h.login;
    if (!h.provider) return { provider: null, error: null, hint: null, hostFailure: false };
    if (h.token) return { provider: h.provider, error: null, hint: null, hostFailure: false };
    const error = h.loginError ?? "not logged in";
    const network = error !== "not logged in";
    return { provider: h.provider, error, hint: network ? null : loginHint(h.provider, host), hostFailure: network };
  }

  const baseUrl = (host, provider) =>
    provider === "github"
      ? host === "github.com" ? "https://api.github.com/" : `https://${host}/api/v3/`
      : `https://${host}/api/v4/`;
  // GitHub refuses API requests that have no User-Agent (HTTP 403), and Herdr's fetch sends none.
  const headers = (provider, token) =>
    provider === "github"
      ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "herdr-dock" }
      : { "PRIVATE-TOKEN": token, "User-Agent": "herdr-dock" };

  // Counts at most one failure per outage: only a request that started after the last backoff window ended,
  // and only while the host isn't already blocked. Requests in flight when the outage began don't add to it.
  function backoff(h, error, startedAt) {
    const now = io.now();
    if (now < h.blockedUntil || startedAt < h.windowEnd) return;
    h.failures++;
    h.blockedUntil = h.windowEnd = now + BACKOFF[Math.min(h.failures, BACKOFF.length) - 1];
    h.lastError = error;
  }
  // opts.noBackoff: the caller can do without this endpoint (a job log), so its failure never blocks the host.
  function fail(h, error, hostFailure, startedAt, extra = {}, opts = {}) {
    if (hostFailure && !opts.noBackoff) backoff(h, error, startedAt);
    return { ok: false, error: redact(error), hostFailure, ...extra };
  }
  // A request for a blocked host fails fast, without a network call, with the outage's error.
  const isBlocked = (h) => io.now() < h.blockedUntil;
  const blockedResult = (h) => ({ ok: false, error: redact(h.lastError ?? "unavailable"), hostFailure: true });
  const good = (h, data) => {
    h.failures = 0;
    h.blockedUntil = 0;
    h.windowEnd = 0; // the outage is over: the next failure starts a new window
    return { ok: true, data };
  };

  async function viaCli(host, h, method, path, wantJson, opts = {}) {
    const cmd = h.provider === "github" ? "gh" : "glab";
    const hostArgs = cmd === "glab" || host !== "github.com" ? ["--hostname", host] : [];
    let startedAt = io.now();
    const r = await http(() => {
      if (isBlocked(h)) return null;
      startedAt = io.now();
      const extra = Object.entries(opts.headers ?? {}).flatMap(([k, v]) => ["-H", `${k}: ${v}`]);
      return cli(cmd, ["api", ...hostArgs, ...(method === "POST" ? ["-X", "POST"] : []), ...extra, path], opts.timeout);
    });
    if (!r) return blockedResult(h);
    if (r.code !== 0) {
      const msg = firstLine(r.stderr || r.stdout) || `${cmd} api exited ${r.code}`;
      // An HTTP 4xx answer isn't the host failing; anything else (no CLI, network, timeout) backs off.
      const code = /\b(4\d\d)\b/.exec(msg);
      return fail(h, msg, !code, startedAt, code ? { status: Number(code[1]) } : {}, opts);
    }
    if (opts.text) return good(h, String(r.stdout ?? ""));
    if (!wantJson) return good(h, null);
    try {
      return good(h, JSON.parse(String(r.stdout ?? "")));
    } catch {
      return fail(h, "bad response", false, startedAt, {}, opts);
    }
  }

  // One API call. `path` is relative to the API root ("projects/..." or "repos/..."). Resolves to
  // { ok: true, data } or { ok: false, error, hint?, hostFailure }; never rejects.
  async function request(host, method, path, opts = {}) {
    const h = rec(host);
    const wantJson = method === "GET" && !opts.text;
    if (!h.provider || !h.token) return { ok: false, error: "not logged in", hint: loginHint(h.provider, host), hostFailure: false };
    if (isBlocked(h)) return blockedResult(h);
    if (h.cli) return viaCli(host, h, method, path, wantJson, opts);
    let startedAt = io.now();
    const url = baseUrl(host, h.provider) + path;
    const once = () =>
      http(() => {
        if (isBlocked(h)) return { blocked: true };
        startedAt = io.now();
        return timed(async (signal) => {
          const init = { method, headers: { ...opts.headers, ...headers(h.provider, h.token) } };
          if (signal) init.signal = signal;
          const r = await io.fetch(url, init);
          if (!r.ok) return { status: r.status, ok: false, data: null };
          if (opts.text) {
            try {
              return { status: r.status, ok: true, data: String(await r.text()) };
            } catch {
              return { status: r.status, ok: false, data: null, bad: true };
            }
          }
          if (!wantJson) return { status: r.status, ok: true, data: null };
          try {
            return { status: r.status, ok: true, data: await r.json() };
          } catch {
            return { status: r.status, ok: false, data: null, bad: true };
          }
        }, opts.timeout);
      });
    try {
      let r = await once();
      if (r.blocked) return blockedResult(h);
      if (r.status === 401) {
        h.token = await readToken(host, h.provider);
        if (h.token) r = await once();
        if (r.blocked) return blockedResult(h);
        if (!h.token || r.status === 401) {
          Object.assign(h, { token: null, loginError: "not logged in", loginRetryAt: io.now() + RELOGIN });
          return fail(h, "not logged in", false, startedAt, { hint: loginHint(h.provider, host) }, opts);
        }
      }
      if (r.bad) return fail(h, "bad response", false, startedAt, {}, opts);
      if (!r.ok) return fail(h, `HTTP ${r.status}`, r.status >= 500 || r.status === 429, startedAt, { status: r.status }, opts);
      return { ...good(h, r.data), status: r.status }; // only this route knows it (206 vs 200 for a Range request)
    } catch (e) {
      if (e instanceof Timeout) return fail(h, "timeout", true, startedAt, {}, opts);
      // A network or TLS error (not an HTTP status): use the CLI for this host for the rest of the session.
      h.cli = true;
      log(`CI: fetch to ${host} failed (${redact(e?.cause?.code ?? e?.message ?? e)}); using ${h.provider === "github" ? "gh" : "glab"} api`);
      return viaCli(host, h, method, path, wantJson, opts);
    }
  }

  // Asks by branch and by HEAD commit at once (the branch first). The commit's answer wins when it has builds of
  // that commit (a tag build of HEAD is filed under the tag, not the branch), and only those are kept: a server
  // that ignores the filter must not show another branch's builds. Else the branch's newest, as before. Only the
  // branch query speaks for the host's health: the commit query failing never backs the host off, so it can't
  // block this poll's jobs call or the next polls. Its failure is logged once until it answers again.
  async function branchOrCommit(host, path, branchPath, commitPath, rows, ofHead) {
    const [b, c] = await Promise.all([
      request(host, "GET", branchPath),
      request(host, "GET", commitPath, { noBackoff: true }),
    ]);
    const found = c.ok ? rows(c.data) : null;
    if (!found) {
      failedOnce(`commit|${host}|${path}`, `CI: ${host}/${path}: HEAD commit query: ${c.ok ? "bad response" : c.error}`);
      return b;
    }
    succeeded(`commit|${host}|${path}`);
    const mine = found.filter(ofHead);
    return mine.length ? { ...c, rows: mine } : b;
  }

  // A worktree's runs as { ok, data: [row] } or an error: by branch and HEAD commit; by sha alone when detached; by
  // branch alone before a first commit. rows(data) is the list in an answer (null if malformed); ofHead(row)
  // whether a row is a build of the HEAD commit.
  async function runsOf(host, path, { branch, sha }, branchPath, commitPath, rows, ofHead) {
    const r = !branch ? await request(host, "GET", commitPath)
      : !sha ? await request(host, "GET", branchPath)
        : await branchOrCommit(host, path, branchPath, commitPath, rows, ofHead);
    if (!r.ok) return r;
    const list = r.rows ?? rows(r.data);
    return list ? { ok: true, data: list } : { ok: false, error: "bad response", hostFailure: false };
  }

  // A job (or bridge) list sorted by id, or null with a log line. Jobs may come newest first: stage order and the
  // first failed job need id order. Without jobs the status (and an alert) still stand. `once` (a failing key)
  // marks a call that may fail on every poll (bridges on an older GitLab): logged once until it succeeds.
  function listOf(r, what, once) {
    if (!r) return null;
    if (r.ok && Array.isArray(r.data)) {
      if (once) succeeded(once);
      return [...r.data].sort((a, b) => a.id - b.id);
    }
    const line = `CI: ${what}: ${r.error ?? "bad response"}`;
    if (once) failedOnce(once, line);
    else log(line);
    return null;
  }

  // GitLab: the HEAD commit's pipelines (the newest per ref, at most 3), else the branch's newest. Jobs of a failed
  // or running pipeline; full: every pipeline's jobs and bridges, and the running jobs' last log lines.
  async function gitlabLatest(host, path, head, { full = false } = {}) {
    const enc = encodeURIComponent(path);
    const pipes = `projects/${enc}/pipelines?`;
    const sha = encodeURIComponent(head.sha);
    const r = await runsOf(host, path, head,
      `${pipes}ref=${encodeURIComponent(head.branch)}&per_page=1&order_by=id&sort=desc`,
      head.branch ? `${pipes}sha=${sha}&order_by=id&sort=desc&per_page=5` : `${pipes}sha=${sha}&per_page=1&order_by=id&sort=desc`,
      (d) => (Array.isArray(d) ? d : null), (p) => p.sha === head.sha);
    if (!r.ok) return r;
    const kept = [];
    const refs = new Set();
    for (const p of r.data) {
      if (refs.has(p.ref) || kept.length >= COMMIT_GROUPS) continue;
      refs.add(p.ref);
      kept.push(p);
    }
    const entries = await Promise.all(kept.map(async (p) => {
      const at = `projects/${enc}/pipelines/${encodeURIComponent(p.id)}`;
      const wantJobs = full || ["failed", "running"].includes(normalizeStatus("gitlab", p));
      const [j, b] = await Promise.all([
        wantJobs ? request(host, "GET", `${at}/jobs?per_page=100`) : null,
        full ? request(host, "GET", `${at}/bridges?per_page=100`) : null,
      ]);
      return {
        pipeline: p,
        jobs: listOf(j, `jobs of ${host}/${path} pipeline ${p.id}`),
        bridges: listOf(b, `bridges of ${host}/${path} pipeline ${p.id}`, `bridges|${host}|${path}|${p.id}`),
      };
    }));
    const pipeline = gitlabCommitPipeline(entries);
    if (full && pipeline) await logLines(host, path, pipeline);
    return { ok: true, pipeline };
  }

  // Sets logLine on the most recently started running jobs (not bridges: they have no log of their own). The
  // traces are awaited on purpose, so the poll publishes its jobs with their lines: a slow trace delays that
  // poll's publish by at most 8 s (16 s with a 416 retry). The in-flight skip guards overlapping polls of two
  // worktrees of one repo, which can happen after the selection moves between them.
  async function logLines(host, path, pipeline) {
    const key = `${host}|${path}`;
    const prev = lastLog.get(key) ?? new Map();
    const runningJobs = pipeline.jobs.filter((j) => j.status === "running" && !j.bridge);
    const kept = new Map(); // a job no longer running drops its entry
    for (const j of runningJobs) kept.set(j.id, prev.get(j.id) ?? { line: null, busy: false, failLogged: false });
    lastLog.set(key, kept);
    const started = (j) => Date.parse(j.startedAt) || 0;
    const newest = [...runningJobs].sort((a, b) => started(b) - started(a)).slice(0, LOG_JOBS);
    await Promise.all(newest.map(async (j) => {
      const e = kept.get(j.id);
      if (!e.busy) await fetchLogLine(host, path, j.id, e); // else its previous call is still in flight
      j.logLine = e.line;
    }));
  }

  // A trace call asks for the log's tail and never counts toward the host's backoff, so a big or slow log can't
  // stop CI for the host. A 416 (the Range refused) is asked once more without it.
  async function fetchLogLine(host, path, jobId, e) {
    const trace = `projects/${encodeURIComponent(path)}/jobs/${encodeURIComponent(jobId)}/trace`;
    const opts = { text: true, noBackoff: true, timeout: TRACE_TIMEOUT };
    e.busy = true;
    try {
      let r = await request(host, "GET", trace, { ...opts, headers: { Range: TRACE_TAIL } });
      if (r.ok && !rangeLogged.has(host)) {
        // The fetch route has the status (206 or 200); the glab route has none, so the body's length tells.
        const byStatus = r.status === 206 || r.status === 200;
        if (byStatus || r.status == null) {
          rangeLogged.add(host);
          const honoured = byStatus ? r.status === 206 : String(r.data ?? "").length <= TRACE_TAIL_CHARS;
          log(`CI: ${host} trace Range ${honoured ? "honoured" : "ignored"}${byStatus ? "" : " (by size)"}`);
        }
      }
      if (!r.ok && r.status === 416) r = await request(host, "GET", trace, opts);
      if (r.ok) {
        e.line = lastLogLine(r.data, redact);
        e.failLogged = false;
      } else if (!e.failLogged) {
        e.failLogged = true;
        log(`CI: trace of ${host}/${path} job ${jobId}: ${r.error}`);
      }
    } finally {
      e.busy = false;
    }
  }

  // GitHub: the HEAD commit's runs, else the branch's recent runs; the newest head_sha's runs make one pipeline
  // (githubLatest). Jobs of its failed runs; full: of every run.
  async function githubLatestOf(host, path, head, { full = false } = {}) {
    const repo = path.split("/").map(encodeURIComponent).join("/");
    const runs = `repos/${repo}/actions/runs?`;
    const r = await runsOf(host, path, head,
      `${runs}branch=${encodeURIComponent(head.branch)}&per_page=20`,
      `${runs}head_sha=${encodeURIComponent(head.sha)}&per_page=20`,
      (d) => (Array.isArray(d?.workflow_runs) ? d.workflow_runs : null), (x) => x.head_sha === head.sha);
    if (!r.ok) return r;
    const answer = { workflow_runs: r.data };
    const first = githubLatest(answer, {});
    if (!first) return { ok: true, pipeline: null };
    const ofHead = r.data.filter((x) => x.head_sha === first.id);
    const failed = ofHead.filter((x) => normalizeStatus("github", x) === "failed");
    const jobsByRunId = {};
    await Promise.all((full ? ofHead : failed).map(async (run) => {
      const j = await request(host, "GET", `repos/${repo}/actions/runs/${encodeURIComponent(run.id)}/jobs?per_page=100`);
      if (j.ok) jobsByRunId[run.id] = j.data;
      else log(`CI: jobs of ${host}/${path} run ${run.id}: ${j.error}`);
    }));
    const canceled = ofHead.filter((x) => normalizeStatus("github", x) === "canceled");
    return { ok: true, pipeline: githubLatest(answer, jobsByRunId), runIds: failed.map((x) => x.id), canceledRunIds: canceled.map((x) => x.id) };
  }

  // A worktree's pipeline, every build of its HEAD commit (else its branch's newest): { ok, pipeline: Pipeline |
  // null, runIds, canceledRunIds }. opts.full: every job (GitLab bridges too), with running jobs' last log lines.
  const latest = (host, provider, path, head, opts) =>
    (provider === "github" ? githubLatestOf : gitlabLatest)(host, path, head, opts);

  // Retry: GitLab retries each failed or canceled pipeline of the commit (a tag and a branch pipeline can both have
  // failed); GitHub reruns the failed jobs of each failed run of that commit, and reruns each canceled run whole (a
  // canceled run has no failed jobs to rerun).
  async function retry(host, provider, path, pipeline, runIds, canceledRunIds) {
    // { what, path }: `what` names the pipeline or run in the error, since only some of several POSTs may fail.
    let posts;
    if (provider === "gitlab") {
      const ids = (pipeline.groups ?? []).filter((g) => g.status === "failed" || g.status === "canceled").map((g) => g.id);
      posts = ids.map((id) => ({ what: `pipeline ${id}`, path: `projects/${encodeURIComponent(path)}/pipelines/${encodeURIComponent(id)}/retry` }));
      if (!posts.length) return { ok: false, error: "no failed or canceled pipelines" };
    } else {
      const repo = path.split("/").map(encodeURIComponent).join("/");
      const run = (rid, action) => ({ what: `run ${rid}`, path: `repos/${repo}/actions/runs/${encodeURIComponent(rid)}/${action}` });
      posts = [
        ...(runIds ?? []).map((rid) => run(rid, "rerun-failed-jobs")),
        ...(canceledRunIds ?? []).map((rid) => run(rid, "rerun")),
      ];
      if (!posts.length) return { ok: false, error: "no failed or canceled runs" };
    }
    const results = await Promise.all(posts.map((p) => request(host, "POST", p.path)));
    const bad = posts.map((p, i) => (results[i].ok ? null : `${p.what}: ${results[i].error}`)).filter(Boolean);
    return bad.length ? { ok: false, error: bad.join("; ") } : { ok: true, error: null };
  }

  return {
    latest,
    retry,
    resolve,
    request,
    sweep,
    redact,
    providerOf: (host) => hosts.get(host)?.provider ?? null,
    via: (host) => {
      const h = hosts.get(host);
      return h?.cli ? (h.provider === "github" ? "gh" : "glab") : "fetch";
    },
    blocked: (host, now) => now < (hosts.get(host)?.blockedUntil ?? 0),
    // The refresh button: clear backoff, and let hosts without a login check again.
    reset() {
      for (const h of hosts.values()) {
        Object.assign(h, { failures: 0, blockedUntil: 0, windowEnd: 0 });
        if (!h.token) h.login = null;
      }
    },
  };
}
