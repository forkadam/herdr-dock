// CI server access for the collector: the provider and login of each host (tokens borrowed from glab/gh and
// kept in this closure only), API requests through the injected fetch with a glab/gh CLI fallback, a 401
// re-login, timeouts on the collector's clock, and per-host backoff. (No Node built-ins: bundled into Herdr mods.)
import { limiter } from "./limiter.js";
import { normalizeStatus, gitlabPipeline, githubLatest } from "./ci.js";

const HTTP_LIMIT = 4; // HTTP requests (or CLI api calls) at once
const TIMEOUT = 15000;
const BACKOFF = [30000, 60000, 120000, 300000];
const HOSTS_KEY = "dock.git.hosts";
const RELOGIN = 300000; // a host with no login is checked again at the slow CI cadence
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
          const init = { method, headers: { ...headers(h.provider, h.token), ...opts.headers } };
          if (signal) init.signal = signal;
          const r = await io.fetch(url, init);
          if (!r.ok) return { status: r.status, ok: false, data: null };
          if (opts.text) return { status: r.status, ok: true, data: String(await r.text()) };
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
      return good(h, r.data);
    } catch (e) {
      if (e instanceof Timeout) return fail(h, "timeout", true, startedAt, {}, opts);
      // A network or TLS error (not an HTTP status): use the CLI for this host for the rest of the session.
      h.cli = true;
      log(`CI: fetch to ${host} failed (${redact(e?.cause?.code ?? e?.message ?? e)}); using ${h.provider === "github" ? "gh" : "glab"} api`);
      return viaCli(host, h, method, path, wantJson, opts);
    }
  }

  // The latest GitLab pipeline of a ref (or sha), newest id first, with its jobs when failed or running.
  async function gitlabLatest(host, path, { branch, sha }) {
    const enc = encodeURIComponent(path);
    const q = branch ? `ref=${encodeURIComponent(branch)}` : `sha=${encodeURIComponent(sha)}`;
    const r = await request(host, "GET", `projects/${enc}/pipelines?${q}&per_page=1&order_by=id&sort=desc`);
    if (!r.ok) return r;
    if (!Array.isArray(r.data)) return { ok: false, error: "bad response", hostFailure: false };
    const p = r.data[0];
    if (!p) return { ok: true, pipeline: null };
    let jobs = null;
    if (["failed", "running"].includes(normalizeStatus("gitlab", p))) {
      const j = await request(host, "GET", `projects/${enc}/pipelines/${encodeURIComponent(p.id)}/jobs?per_page=100`);
      // Jobs may come newest first: sort by id so stage order and the first failed job are right. Without
      // jobs the status (and an alert) still stand; only stages and failed jobs are missing.
      if (j.ok && Array.isArray(j.data)) jobs = [...j.data].sort((a, b) => a.id - b.id);
      else log(`CI: jobs of ${host}/${path} pipeline ${p.id}: ${j.error ?? "bad response"}`);
    }
    return { ok: true, pipeline: gitlabPipeline(p, jobs) };
  }

  // GitHub: the branch's recent runs; the newest head_sha's runs make one pipeline (githubLatest).
  async function githubLatestOf(host, path, { branch, sha }) {
    const repo = path.split("/").map(encodeURIComponent).join("/");
    const q = branch ? `branch=${encodeURIComponent(branch)}` : `head_sha=${encodeURIComponent(sha)}`;
    const r = await request(host, "GET", `repos/${repo}/actions/runs?${q}&per_page=20`);
    if (!r.ok) return r;
    if (!Array.isArray(r.data?.workflow_runs)) return { ok: false, error: "bad response", hostFailure: false };
    const first = githubLatest(r.data, {});
    if (!first) return { ok: true, pipeline: null };
    const failed = r.data.workflow_runs.filter((x) => x.head_sha === first.id && normalizeStatus("github", x) === "failed");
    const jobsByRunId = {};
    await Promise.all(failed.map(async (run) => {
      const j = await request(host, "GET", `repos/${repo}/actions/runs/${encodeURIComponent(run.id)}/jobs`);
      if (j.ok) jobsByRunId[run.id] = j.data;
      else log(`CI: jobs of ${host}/${path} run ${run.id}: ${j.error}`);
    }));
    const canceled = r.data.workflow_runs.filter((x) => x.head_sha === first.id && normalizeStatus("github", x) === "canceled");
    return { ok: true, pipeline: githubLatest(r.data, jobsByRunId), runIds: failed.map((x) => x.id), canceledRunIds: canceled.map((x) => x.id) };
  }

  // The latest pipeline of a worktree's branch (or detached sha): { ok, pipeline: Pipeline | null, runIds }.
  const latest = (host, provider, path, head) =>
    (provider === "github" ? githubLatestOf : gitlabLatest)(host, path, head);

  // Retry: GitLab retries the pipeline; GitHub reruns the failed jobs of each failed run of that commit, and
  // reruns each canceled run whole (a canceled run has no failed jobs to rerun).
  async function retry(host, provider, path, pipeline, runIds, canceledRunIds) {
    let posts;
    if (provider === "gitlab") {
      posts = [`projects/${encodeURIComponent(path)}/pipelines/${encodeURIComponent(pipeline.id)}/retry`];
    } else {
      const repo = path.split("/").map(encodeURIComponent).join("/");
      posts = [
        ...(runIds ?? []).map((rid) => `repos/${repo}/actions/runs/${encodeURIComponent(rid)}/rerun-failed-jobs`),
        ...(canceledRunIds ?? []).map((rid) => `repos/${repo}/actions/runs/${encodeURIComponent(rid)}/rerun`),
      ];
      if (!posts.length) return { ok: false, error: "no failed or canceled runs" };
    }
    const results = await Promise.all(posts.map((p) => request(host, "POST", p)));
    const bad = results.find((r) => !r.ok);
    return bad ? { ok: false, error: bad.error } : { ok: true, error: null };
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
