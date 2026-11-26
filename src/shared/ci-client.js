// CI server access for the collector: the provider and login of each host (tokens borrowed from glab/gh and
// kept in this closure only), API requests through the injected fetch with a glab/gh CLI fallback, a 401
// re-login, timeouts on the collector's clock, per-host backoff, conditional GETs (ETags) and the host's API
// rate limit (budget from the response headers, a pause at the limit). (No Node built-ins: bundled into Herdr mods.)
import { limiter } from "./limiter.js";
import { readLimit, pauseFor, isLow, cliLimited, bodyLimited, lru } from "./ci-budget.js";
import {
  normalizeStatus, gitlabCommitPipeline, githubLatest, lastLogLine,
  keepGithubRuns, keepGithubJobs, keepGitlabPipelines, keepGitlabJobs, keepGitlabBridges,
} from "./ci.js";

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
const ETAGS = 300; // URLs whose last ETag and answer are kept
// A limit known only from text (a CLI message, or a 403's body) has no reset time: the host pauses this long.
const TEXT_PAUSE = 60000;
const JOBS_CACHE = 100; // finished builds whose jobs are kept
const FINISHED = new Set(["passed", "failed", "canceled", "skipped"]);

class Timeout extends Error {}

// The job-cache stamp of a finished build: anything that changes a build moves its updated_at (a Retry also changes
// its status). Null for a build still running or pending, which is always fetched, and for one without updated_at,
// whose change couldn't be seen. GitLab's "canceling" counts as canceled, but its jobs are still stopping.
function finishedStamp(provider, b) {
  if (!b?.updated_at || b.status === "canceling" || !FINISHED.has(normalizeStatus(provider, b))) return null;
  return provider === "github" ? `${b.updated_at}|${b.status}|${b.conclusion}` : `${b.updated_at}|${b.status}`;
}

// Whether every job of an answer is settled. The build's status and its jobs come from separate requests, so a
// finished build can arrive with a job that is not (and GitLab's "canceling" job is still stopping): such an answer
// is never cached, so the next poll asks again.
function allSettled(provider, jobs) {
  return jobs.every((j) => j?.status !== "canceling" && FINISHED.has(normalizeStatus(provider, j)));
}

// A fetch whose headers can't be read (a getter that throws) is treated like one without them: unknown, never a
// network error that would move the host to the CLI.
const headerReader = (r) => (name) => {
  try {
    return r.headers?.get?.(name);
  } catch {
    return undefined;
  }
};

// The text of an answer already received (a 403's message), or "" when it can't be read.
async function bodyText(r) {
  try {
    if (typeof r.text === "function") return String(await r.text());
    return JSON.stringify(await r.json());
  } catch {
    return "";
  }
}

// A deep copy that nothing can change: a cached list must answer later polls as it was fetched, whatever happens to
// the answer it came from. The ETag store keeps one too, so a 200 and the 304s after it answer with the same object.
function frozenCopy(v) {
  const freeze = (x) => {
    if (x && typeof x === "object") {
      for (const k of Object.keys(x)) freeze(x[k]);
      Object.freeze(x);
    }
    return x;
  };
  return freeze(JSON.parse(JSON.stringify(v)));
}

export function loginHint(provider, host) {
  if (provider === "github") return host === "github.com" ? "gh auth login" : `gh auth login --hostname ${host}`;
  return `glab auth login --hostname ${host}`;
}

const firstLine = (s) => String(s ?? "").trim().split(/\r?\n/)[0];
const pad = (n) => String(n).padStart(2, "0");
const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export function createCiClient(io, log) {
  const http = limiter(HTTP_LIMIT);
  // host -> { want, provider, login: Promise|null, loginDone, loginError, loginRetryAt, token, cli,
  //   failures, blockedUntil, windowEnd, lastError, budget, limitedUntil, headers, lowLogged }
  // budget: { remaining, limit, resetAt } from the latest answer that carried rate-limit headers; limitedUntil: the
  // end of a limit pause (its own state, never the backoff ladder); headers: undefined | "seen" | "none" (logged),
  // missing: answers without a rate-limit pair before the first log line.
  const hosts = new Map();
  // Fetch route only: url -> { etag, data } of the last JSON answer that carried an ETag. A 304 to the next GET
  // reuses data (GitHub doesn't count a 304 against the limit).
  const etags = lru(ETAGS);
  // Finished builds' jobs, which can't change until the build does: "gl|<host>|<path>|<pipeline id>" or
  // "gh|<host>|<path>|<run id>" -> { stamp, jobs } (a frozen copy). Reused while the build's stamp stays; a running
  // build never reads it. GitLab bridges are never kept: a retried child pipeline may not move the parent's
  // updated_at, so they are asked on every full poll (with their ETag).
  const jobsCache = lru(JOBS_CACHE);
  const remember = (key, stamp, jobs) => jobsCache.set(key, { stamp, jobs: frozenCopy(jobs) });
  const cachedJobs = (key, stamp) => {
    const e = stamp ? jobsCache.get(key) : undefined;
    return e?.stamp === stamp ? e.jobs : undefined;
  };
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
      budget: null, limitedUntil: 0, headers: undefined, missing: 0, lowLogged: false,
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
  // At the API limit the host is paused until its reset: requests fail fast with no network call, and it is not a
  // host failure (the host answered; waiting is the fix).
  const isLimited = (h) => io.now() < h.limitedUntil;
  const limitedResult = (h) => ({ ok: false, error: "API limit reached", limited: true, limitedUntil: h.limitedUntil, hostFailure: false });
  function pause(host, h, ms) {
    const now = io.now();
    if (now >= h.limitedUntil) log(`CI: ${host} API limit reached; paused until ${clock(now + ms)}`);
    h.limitedUntil = Math.max(h.limitedUntil, now + ms);
  }

  // Reads what the client needs from an answer's headers (when this fetch exposes them; get never throws): the
  // host's budget, and the limit pause. Returns true when the answer was a limit answer.
  function noteHeaders(host, h, status, get) {
    const limit = readLimit(get, h.provider);
    if (limit) h.budget = limit;
    // Once per host: does Herdr's fetch expose them? "seen" on the first pair; "not readable" only after 3 answers
    // without one (a single endpoint may lack them), and never once seen. A pair after "not readable" still logs.
    if (limit && h.headers !== "seen") {
      h.headers = "seen";
      log(`CI: ${host} rate-limit headers seen`);
    } else if (!limit && h.headers === undefined && ++h.missing >= 3) {
      h.headers = "none";
      log(`CI: ${host} rate-limit headers not readable`);
    }
    if (limit) {
      const low = isLow(limit);
      if (low && !h.lowLogged) log(`CI: ${host} API budget low (${limit.remaining}/${limit.limit}); slower polling`);
      h.lowLogged = low;
    }
    const ms = pauseFor({
      status,
      remaining: get(h.provider === "gitlab" ? "ratelimit-remaining" : "x-ratelimit-remaining"),
      resetAt: limit?.resetAt ?? null,
      retryAfter: get("retry-after"), // seconds; pauseFor ignores anything but a plain integer (e.g. a date)
      now: io.now(),
    });
    if (ms > 0) pause(host, h, ms);
    return ms > 0;
  }

  async function viaCli(host, h, method, path, wantJson, opts = {}) {
    const cmd = h.provider === "github" ? "gh" : "glab";
    const hostArgs = cmd === "glab" || host !== "github.com" ? ["--hostname", host] : [];
    let startedAt = io.now();
    const r = await http(() => {
      if (isLimited(h)) return { limited: true };
      if (isBlocked(h)) return null;
      startedAt = io.now();
      const extra = Object.entries(opts.headers ?? {}).flatMap(([k, v]) => ["-H", `${k}: ${v}`]);
      return cli(cmd, ["api", ...hostArgs, ...(method === "POST" ? ["-X", "POST"] : []), ...extra, path], opts.timeout);
    });
    if (!r) return blockedResult(h);
    if (r.limited) return limitedResult(h);
    if (r.code !== 0) {
      if (cliLimited(`${r.stderr ?? ""}\n${r.stdout ?? ""}`)) {
        pause(host, h, TEXT_PAUSE);
        return limitedResult(h);
      }
      const msg = firstLine(r.stderr || r.stdout) || `${cmd} api exited ${r.code}`;
      // An HTTP 4xx answer isn't the host failing; anything else (no CLI, network, timeout) backs off.
      const code = /\b(4\d\d)\b/.exec(msg);
      return fail(h, msg, !code, startedAt, code ? { status: Number(code[1]) } : {}, opts);
    }
    if (opts.text) return good(h, String(r.stdout ?? ""));
    if (!wantJson) return good(h, null);
    try {
      const data = JSON.parse(String(r.stdout ?? ""));
      return good(h, opts.keep ? opts.keep(data) : data);
    } catch {
      return fail(h, "bad response", false, startedAt, {}, opts);
    }
  }

  // One API call. `path` is relative to the API root ("projects/..." or "repos/..."). Resolves to
  // { ok: true, data, status?, notModified? } or { ok: false, error, hint?, hostFailure, limited?, limitedUntil? };
  // never rejects. opts.keep(data): what to keep of a JSON answer (ci.js keep*), on both routes; it is what the ETag
  // store holds, frozen, and what a 200 and the 304s after it return.
  async function request(host, method, path, opts = {}) {
    const h = rec(host);
    const wantJson = method === "GET" && !opts.text;
    if (!h.provider || !h.token) return { ok: false, error: "not logged in", hint: loginHint(h.provider, host), hostFailure: false };
    if (isLimited(h)) return limitedResult(h);
    if (isBlocked(h)) return blockedResult(h);
    if (h.cli) return viaCli(host, h, method, path, wantJson, opts);
    let startedAt = io.now();
    const url = baseUrl(host, h.provider) + path;
    const once = () =>
      http(() => {
        if (isLimited(h)) return { limited: true };
        if (isBlocked(h)) return { blocked: true };
        startedAt = io.now();
        return timed(async (signal) => {
          // Only JSON GETs are conditional: a trace's Range answers vary, so they are never stored.
          const stored = wantJson ? etags.get(url) : undefined;
          const conditional = stored ? { "If-None-Match": stored.etag } : {};
          const init = { method, headers: { ...opts.headers, ...conditional, ...headers(h.provider, h.token) } };
          if (signal) init.signal = signal;
          const r = await io.fetch(url, init);
          const get = headerReader(r);
          // A 401's rate-limit headers describe the unauthenticated budget, not this token's.
          if (r.status !== 401 && noteHeaders(host, h, r.status, get)) return { limited: true };
          if (r.status === 403 && bodyLimited(await bodyText(r))) {
            pause(host, h, TEXT_PAUSE);
            return { limited: true };
          }
          if (r.status === 304 && stored) return { status: 304, ok: true, data: stored.data, notModified: true };
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
            const raw = await r.json();
            const data = opts.keep ? opts.keep(raw) : raw;
            const etag = get("etag");
            if (!etag) {
              etags.delete(url);
              return { status: r.status, ok: true, data };
            }
            const kept = frozenCopy(data);
            etags.set(url, { etag, data: kept });
            return { status: r.status, ok: true, data: kept };
          } catch {
            return { status: r.status, ok: false, data: null, bad: true };
          }
        }, opts.timeout);
      });
    try {
      let r = await once();
      if (r.limited) return limitedResult(h);
      if (r.blocked) return blockedResult(h);
      if (r.status === 401) {
        h.token = await readToken(host, h.provider);
        if (h.token) r = await once();
        if (r.limited) return limitedResult(h);
        if (r.blocked) return blockedResult(h);
        if (!h.token || r.status === 401) {
          Object.assign(h, { token: null, budget: null, loginError: "not logged in", loginRetryAt: io.now() + RELOGIN });
          return fail(h, "not logged in", false, startedAt, { hint: loginHint(h.provider, host) }, opts);
        }
      }
      if (r.bad) return fail(h, "bad response", false, startedAt, {}, opts);
      // A 429 never gets here: it is a limit answer (above), not a host failure.
      if (!r.ok) return fail(h, `HTTP ${r.status}`, r.status >= 500, startedAt, { status: r.status }, opts);
      // Only this route knows the status (206 vs 200 for a Range request). A 304 is a good answer like a 200.
      return { ...good(h, r.data), status: r.status, ...(r.notModified ? { notModified: true } : {}) };
    } catch (e) {
      if (e instanceof Timeout) return fail(h, "timeout", true, startedAt, {}, opts);
      // A network or TLS error (not an HTTP status): use the CLI for this host for the rest of the session.
      h.cli = true;
      log(`CI: fetch to ${host} failed (${redact(e?.cause?.code ?? e?.message ?? e)}); using ${h.provider === "github" ? "gh" : "glab"} api`);
      return viaCli(host, h, method, path, wantJson, opts);
    }
  }

  // One poll's requests to a host: req(method, path, opts) is request() that also notes a limit answer. A limit hit
  // on any of them discards the whole poll (`limited` is then the limit result latest() returns), so the collector
  // keeps the previous pipeline rather than mix fresh lists with missing jobs.
  function pollOf(host) {
    let hit = null;
    return {
      req: async (method, path, opts) => {
        const r = await request(host, method, path, opts);
        if (r.limited && (!hit || r.limitedUntil > hit.limitedUntil)) hit = r;
        return r;
      },
      get limited() { return hit && { ...hit }; },
    };
  }
  // The host's API budget from the latest answer with rate-limit headers; null on the CLI route (no headers) or
  // before any were seen, except while the host is paused: then always an object, so the panel can say "API limit
  // reached" even for a bare 429 or a CLI message (remaining/limit/resetAt null, low false, when no headers were seen).
  // low: under 10 % left (log tails are skipped).
  function budget(host) {
    const h = hosts.get(host);
    if (!h) return null;
    const limitedUntil = isLimited(h) ? h.limitedUntil : null;
    const b = h.cli ? null : h.budget;
    if (!b) return limitedUntil == null ? null : { remaining: null, limit: null, resetAt: null, limitedUntil, low: false };
    return { remaining: b.remaining, limit: b.limit, resetAt: b.resetAt, limitedUntil, low: isLow(b) };
  }

  // A low budget drops the repo's kept log lines on any poll, plain or full, so a line from before the low stretch
  // never comes back after it.
  const dropLinesIfLow = (host, path) => {
    if (budget(host)?.low) lastLog.delete(`${host}|${path}`);
  };

  // Asks by branch and by HEAD commit at once (the branch first). The commit's answer wins when it has builds of
  // that commit (a tag build of HEAD is filed under the tag, not the branch), and only those are kept: a server
  // that ignores the filter must not show another branch's builds. Else the branch's newest, as before. Only the
  // branch query speaks for the host's health: the commit query failing never backs the host off, so it can't
  // block this poll's jobs call or the next polls. Its failure is logged once until it answers again (a limit
  // answer has its own line, and discards the poll).
  async function branchOrCommit(req, host, path, branchPath, commitPath, rows, ofHead) {
    const [b, c] = await Promise.all([
      req("GET", branchPath),
      req("GET", commitPath, { noBackoff: true }),
    ]);
    const found = c.ok ? rows(c.data) : null;
    if (!found) {
      if (!c.limited) failedOnce(`commit|${host}|${path}`, `CI: ${host}/${path}: HEAD commit query: ${c.ok ? "bad response" : c.error}`);
      return b;
    }
    succeeded(`commit|${host}|${path}`);
    const mine = found.filter(ofHead);
    return mine.length ? { ...c, rows: mine } : b;
  }

  // A worktree's runs as { ok, data: [row] } or an error: by branch and HEAD commit; by sha alone when detached; by
  // branch alone before a first commit. rows(data) is the list in an answer (null if malformed); ofHead(row)
  // whether a row is a build of the HEAD commit.
  async function runsOf(req, host, path, { branch, sha }, branchPath, commitPath, rows, ofHead) {
    const r = !branch ? await req("GET", commitPath)
      : !sha ? await req("GET", branchPath)
        : await branchOrCommit(req, host, path, branchPath, commitPath, rows, ofHead);
    if (!r.ok) return r;
    const list = r.rows ?? rows(r.data);
    return list ? { ok: true, data: list } : { ok: false, error: "bad response", hostFailure: false };
  }

  // A job (or bridge) list sorted by id, or null with a log line. Jobs may come newest first: stage order and the
  // first failed job need id order. Without jobs the status (and an alert) still stand. `once` (a failing key)
  // marks a call that may fail on every poll (bridges on an older GitLab): logged once until it succeeds. A limit
  // answer isn't logged here: the pause has its own line, and the poll is discarded.
  function listOf(r, what, once) {
    if (!r || r.limited) return null;
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
  // or running pipeline; full: every pipeline's jobs and bridges, and the running jobs' last log lines. A finished
  // pipeline's lists come from the job cache while its stamp stays.
  async function gitlabLatest(host, path, head, { full = false } = {}) {
    dropLinesIfLow(host, path); // a low stretch may have been spent at the limit, with no poll reaching its jobs
    const poll = pollOf(host);
    const enc = encodeURIComponent(path);
    const pipes = `projects/${enc}/pipelines?`;
    const sha = encodeURIComponent(head.sha);
    const listReq = (method, p, opts) => poll.req(method, p, { ...opts, keep: keepGitlabPipelines });
    const r = await runsOf(listReq, host, path, head,
      `${pipes}ref=${encodeURIComponent(head.branch)}&per_page=1&order_by=id&sort=desc`,
      head.branch ? `${pipes}sha=${sha}&order_by=id&sort=desc&per_page=5` : `${pipes}sha=${sha}&per_page=1&order_by=id&sort=desc`,
      (d) => (Array.isArray(d) ? d : null), (p) => p.sha === head.sha);
    if (poll.limited) return poll.limited;
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
      const key = `gl|${host}|${path}|${p.id}`;
      const stamp = finishedStamp("gitlab", p);
      const cached = wantJobs ? cachedJobs(key, stamp) : undefined;
      const [j, b] = await Promise.all([
        !wantJobs ? null : cached ? { ok: true, data: cached } : poll.req("GET", `${at}/jobs?per_page=100`, { keep: keepGitlabJobs }),
        full ? poll.req("GET", `${at}/bridges?per_page=100`, { keep: keepGitlabBridges }) : null,
      ]);
      const jobs = listOf(j, `jobs of ${host}/${path} pipeline ${p.id}`);
      const bridges = listOf(b, `bridges of ${host}/${path} pipeline ${p.id}`, `bridges|${host}|${path}|${p.id}`);
      if (stamp && jobs && !cached && allSettled("gitlab", jobs)) remember(key, stamp, jobs);
      return { pipeline: p, jobs, bridges };
    }));
    dropLinesIfLow(host, path);
    if (poll.limited) return poll.limited;
    const pipeline = gitlabCommitPipeline(entries);
    if (full && pipeline) await logLines(host, path, pipeline, poll.req);
    if (poll.limited) return poll.limited;
    return { ok: true, pipeline };
  }

  // Sets logLine on the most recently started running jobs (not bridges: they have no log of their own). The
  // traces are awaited on purpose, so the poll publishes its jobs with their lines: a slow trace delays that
  // poll's publish by at most 8 s (16 s with a 416 retry). The in-flight skip guards overlapping polls of two
  // worktrees of one repo, which can happen after the selection moves between them. On a low budget there are no
  // traces at all: the calls left go to the lists and jobs (gitlabLatest drops the kept lines).
  async function logLines(host, path, pipeline, req) {
    if (budget(host)?.low) return;
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
      if (!e.busy) await fetchLogLine(req, host, path, j.id, e); // else its previous call is still in flight
      j.logLine = e.line;
    }));
  }

  // A trace call asks for the log's tail and never counts toward the host's backoff, so a big or slow log can't
  // stop CI for the host. A 416 (the Range refused) is asked once more without it. A limit answer isn't logged
  // (the pause has its own line).
  async function fetchLogLine(req, host, path, jobId, e) {
    const trace = `projects/${encodeURIComponent(path)}/jobs/${encodeURIComponent(jobId)}/trace`;
    const opts = { text: true, noBackoff: true, timeout: TRACE_TIMEOUT };
    e.busy = true;
    try {
      let r = await req("GET", trace, { ...opts, headers: { Range: TRACE_TAIL } });
      if (r.ok && !rangeLogged.has(host)) {
        // The fetch route has the status (206 or 200); the glab route has none, so the body's length tells.
        const byStatus = r.status === 206 || r.status === 200;
        if (byStatus || r.status == null) {
          rangeLogged.add(host);
          const honoured = byStatus ? r.status === 206 : String(r.data ?? "").length <= TRACE_TAIL_CHARS;
          log(`CI: ${host} trace Range ${honoured ? "honoured" : "ignored"}${byStatus ? "" : " (by size)"}`);
        }
      }
      if (!r.ok && r.status === 416) r = await req("GET", trace, opts);
      if (r.ok) {
        e.line = lastLogLine(r.data, redact);
        e.failLogged = false;
      } else if (!r.limited && !e.failLogged) {
        e.failLogged = true;
        log(`CI: trace of ${host}/${path} job ${jobId}: ${r.error}`);
      }
    } finally {
      e.busy = false;
    }
  }

  // GitHub: the HEAD commit's runs, else the branch's recent runs; the newest head_sha's runs make one pipeline
  // (githubLatest). Jobs of its failed runs; full: of every run. A completed run's jobs come from the job cache while
  // its stamp stays.
  async function githubLatestOf(host, path, head, { full = false } = {}) {
    const poll = pollOf(host);
    const repo = path.split("/").map(encodeURIComponent).join("/");
    const runs = `repos/${repo}/actions/runs?`;
    const listReq = (method, p, opts) => poll.req(method, p, { ...opts, keep: keepGithubRuns });
    const r = await runsOf(listReq, host, path, head,
      `${runs}branch=${encodeURIComponent(head.branch)}&per_page=20`,
      `${runs}head_sha=${encodeURIComponent(head.sha)}&per_page=20`,
      (d) => (Array.isArray(d?.workflow_runs) ? d.workflow_runs : null), (x) => x.head_sha === head.sha);
    if (poll.limited) return poll.limited;
    if (!r.ok) return r;
    const answer = { workflow_runs: r.data };
    const first = githubLatest(answer, {});
    if (!first) return { ok: true, pipeline: null };
    const ofHead = r.data.filter((x) => x.head_sha === first.id);
    const failed = ofHead.filter((x) => normalizeStatus("github", x) === "failed");
    const jobsByRunId = {};
    await Promise.all((full ? ofHead : failed).map(async (run) => {
      const key = `gh|${host}|${path}|${run.id}`;
      const stamp = finishedStamp("github", run);
      const cached = cachedJobs(key, stamp);
      if (cached) {
        jobsByRunId[run.id] = cached;
        return;
      }
      const j = await poll.req("GET", `repos/${repo}/actions/runs/${encodeURIComponent(run.id)}/jobs?per_page=100`, { keep: keepGithubJobs });
      if (j.ok) {
        jobsByRunId[run.id] = j.data;
        if (stamp && Array.isArray(j.data?.jobs) && allSettled("github", j.data.jobs)) remember(key, stamp, j.data);
      } else if (!j.limited) log(`CI: jobs of ${host}/${path} run ${run.id}: ${j.error}`);
    }));
    if (poll.limited) return poll.limited;
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
    // Backed off, or paused at the API limit: either way a poll now would make no request.
    blocked: (host, now) => {
      const h = hosts.get(host);
      return now < (h?.blockedUntil ?? 0) || now < (h?.limitedUntil ?? 0);
    },
    budget,
    // The refresh button: clear backoff, and let hosts without a login check again.
    reset() {
      for (const h of hosts.values()) {
        Object.assign(h, { failures: 0, blockedUntil: 0, windowEnd: 0 });
        if (!h.token) h.login = null;
      }
    },
  };
}
