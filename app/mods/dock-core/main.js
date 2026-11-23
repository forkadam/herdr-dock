// src/mods/dock-core/main.js
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  agents,
  appHome,
  checking,
  exec,
  focused,
  layout,
  nextCommand,
  notify,
  openOverlay,
  panes,
  playSound,
  props,
  readTextFile,
  run,
  setShared,
  shared,
  spaces,
  theme,
  watchFolder,
  window,
  writeTextFile
} from "herdr";

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/shared/git.js
var lines = (s) => String(s ?? "").split(/\r?\n/);
function parseWorktrees(porcelain) {
  const out = [];
  let cur = null;
  for (const line of lines(porcelain)) {
    if (line.startsWith("worktree ")) {
      cur = { path: slashPath(line.slice(9)), head: "", branch: null, detached: false, bare: false };
      out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5).trim();
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    else if (line === "detached") cur.detached = true;
    else if (line === "bare") cur.bare = true;
  }
  return out;
}
function parseStatus(porcelainV2) {
  const r = { branch: null, oid: null, upstream: null, ahead: null, behind: null, dirty: false };
  for (const line of lines(porcelainV2)) {
    if (line.startsWith("# branch.oid ")) {
      const v = line.slice(13).trim();
      r.oid = v === "(initial)" ? null : v;
    } else if (line.startsWith("# branch.head ")) {
      const v = line.slice(14).trim();
      r.branch = v === "(detached)" ? null : v;
    } else if (line.startsWith("# branch.upstream ")) r.upstream = line.slice(18).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        r.ahead = Number(m[1]);
        r.behind = Number(m[2]);
      }
    } else if (line && !line.startsWith("#")) r.dirty = true;
  }
  return r;
}
var isAbs = (p) => /^([A-Za-z]:)?\//.test(p);
function parseRevParse(stdout, base) {
  const [a = "", b = ""] = lines(stdout).map((l) => l.trim()).filter(Boolean);
  const top = slashPath(a);
  let commonDir = b.replace(/[\\]/g, "/");
  if (!isAbs(commonDir)) {
    const from = base ? slashPath(base) : top;
    const parts = [];
    for (const seg of `${from}/${commonDir}`.split("/")) {
      if (seg === "." || seg === "" && parts.length) continue;
      if (seg === ".." && parts.length > 1) parts.pop();
      else parts.push(seg);
    }
    commonDir = parts.join("/");
  }
  return { top, commonDir: slashPath(commonDir) };
}
function parseRemote(url) {
  const s = String(url ?? "").trim();
  let m = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(s);
  let host, path;
  if (m && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) [, host, path] = m;
  else if (m = /^ssh:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+)$/i.exec(s)) [, host, path] = m;
  else if (m = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(s)) [, host, path] = m;
  else return null;
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  return host && path ? { host, path } : null;
}
function worktreeId(machine, path, platform) {
  let p = slashPath(path);
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  if (platform === "windows") p = p.toLowerCase();
  return `${machine ?? ""}|${p}`;
}

// src/shared/ci.js
var RANK = ["failed", "running", "pending", "unknown", "canceled", "passed", "skipped"];
var rank = (s) => {
  const i = RANK.indexOf(s);
  return i < 0 ? RANK.indexOf("pending") : i;
};
var worst = (statuses) => statuses.reduce((a, b) => rank(b) < rank(a) ? b : a);
var GITLAB = {
  success: "passed",
  failed: "failed",
  running: "running",
  canceled: "canceled",
  skipped: "skipped",
  pending: "pending",
  created: "pending",
  waiting_for_resource: "pending",
  preparing: "pending",
  scheduled: "pending",
  manual: "pending",
  canceling: "canceled"
};
var GITHUB_DONE = {
  success: "passed",
  failure: "failed",
  timed_out: "failed",
  startup_failure: "failed",
  action_required: "failed",
  cancelled: "canceled",
  skipped: "skipped",
  neutral: "skipped"
};
function normalizeStatus(provider, raw) {
  const r = raw ?? {};
  if (provider === "gitlab") return GITLAB[r.status] ?? "unknown";
  if (r.status === "completed") return GITHUB_DONE[r.conclusion] ?? "unknown";
  return r.status === "in_progress" ? "running" : "pending";
}
function gitlabPipeline(p, jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const byStage = /* @__PURE__ */ new Map();
  const failedJobs = [];
  let lastFail = null;
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
    number: p.id ?? null,
    // what the UI shows as #<number>
    status: normalizeStatus("gitlab", p),
    ref: p.ref,
    sha: p.sha,
    webUrl: p.web_url,
    createdAt: p.created_at,
    // The alert key's finish time. The pipelines list endpoint has no finished_at, and updated_at moves on a
    // still-failed pipeline, so it comes from the failed jobs (a retry that fails again moves it); never updated_at.
    finishedAt: lastFail ?? p.finished_at ?? null,
    stages: [...byStage].map(([name, sts]) => ({ name, status: worst(sts) })),
    failedJobs
  };
}
var secondsBetween = (a, b) => {
  const d = (Date.parse(b) - Date.parse(a)) / 1e3;
  return Number.isFinite(d) ? d : null;
};
function githubLatest(runsJson, jobsByRunId) {
  const runs = runsJson?.workflow_runs ?? [];
  if (!runs.length) return null;
  const time = (r) => Date.parse(r.created_at) || 0;
  const newest = runs.reduce((a, b) => time(b) > time(a) ? b : a);
  const same = runs.filter((r) => r.head_sha === newest.head_sha);
  const stages = same.map((r) => ({ name: r.name, status: normalizeStatus("github", r) }));
  const failedJobs = [];
  same.forEach((r, i) => {
    if (stages[i].status !== "failed") return;
    for (const j of jobsByRunId?.[r.id]?.jobs ?? []) {
      if (normalizeStatus("github", j) !== "failed") continue;
      failedJobs.push({
        name: j.name,
        stage: r.name,
        webUrl: j.html_url,
        duration: j.started_at && j.completed_at ? secondsBetween(j.started_at, j.completed_at) : null
      });
    }
  });
  const failedRun = same.find((_, i) => stages[i].status === "failed");
  const failedRuns = same.filter((_, i) => stages[i].status === "failed");
  const stamps = (failedRuns.length ? failedRuns : same).map((r) => r.updated_at).filter(Boolean);
  const finishedAt = stamps.length ? stamps.reduce((a, b) => Date.parse(b) > Date.parse(a) ? b : a) : null;
  const times = same.map(time).filter(Boolean);
  const earliest = same.find((r) => time(r) === Math.min(...times)) ?? newest;
  return {
    id: newest.head_sha,
    // the alert identity; the UI shows number
    number: newest.run_number ?? null,
    status: worst(stages.map((s) => s.status)),
    ref: newest.head_branch,
    sha: newest.head_sha,
    webUrl: (failedRun ?? newest).html_url,
    createdAt: earliest.created_at,
    finishedAt,
    stages,
    failedJobs
  };
}
var alertKey = (p) => `${p.id}|${p.finishedAt ?? null}`;
var ALERTED_MAX = 20;
var alertedList = (v) => Array.isArray(v) ? v : v == null ? [] : [v];
function nextAlerted(prev, key) {
  const list = alertedList(prev).filter((k) => k !== key);
  list.push(key);
  return list.slice(-ALERTED_MAX);
}
function alertFor({ prev, cur, alerted, startedAt, repo, branch }) {
  if (cur.status !== "failed") return null;
  const key = alertKey(cur);
  if (alertedList(alerted).some((k) => k != null && (k === key || String(k) === String(cur.id)))) return null;
  const refinished = prev?.finishedAt != null && cur.finishedAt != null && prev.finishedAt !== cur.finishedAt;
  const fresh = prev ? prev.status !== "failed" || prev.id !== cur.id || refinished : Date.parse(cur.createdAt) > startedAt;
  if (!fresh) return null;
  const jobs = cur.failedJobs ?? [];
  const more = jobs.length - 1;
  const body = jobs.length ? `Pipeline failed: ${jobs[0].name}${more > 0 ? ` (+${more} more)` : ""}` : "Pipeline failed";
  return { title: `${repo} \xB7 ${branch}`, body };
}
function ciInterval({ status, upstreamChangedAt, now }) {
  if (status === "running" || status === "pending") return 3e4;
  if (now - upstreamChangedAt < 12e4) return 15e3;
  return 3e5;
}
function gitInterval({ open }) {
  return open ? 15e3 : 6e4;
}

// src/shared/limiter.js
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < n && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        active--;
        next();
      });
    }
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

// src/shared/ci-client.js
var HTTP_LIMIT = 4;
var TIMEOUT = 15e3;
var BACKOFF = [3e4, 6e4, 12e4, 3e5];
var HOSTS_KEY = "dock.git.hosts";
var RELOGIN = 3e5;
var NOT_LOGGED_IN = /not (been )?authenticated|not logged in|no token|auth login|\b401\b|unauthori[sz]ed/i;
var MISSING_CLI = /ENOENT|not found|not recognized|no such file/i;
var Timeout = class extends Error {
};
function loginHint(provider, host) {
  if (provider === "github") return host === "github.com" ? "gh auth login" : `gh auth login --hostname ${host}`;
  return `glab auth login --hostname ${host}`;
}
var firstLine = (s) => String(s ?? "").trim().split(/\r?\n/)[0];
function createCiClient(io, log) {
  const http = limiter(HTTP_LIMIT);
  const hosts = /* @__PURE__ */ new Map();
  const deadlines = /* @__PURE__ */ new Set();
  const secrets = /* @__PURE__ */ new Set();
  const redact = (s) => {
    let t = String(s ?? "");
    for (const k of secrets) t = t.split(k).join("***");
    return t;
  };
  const rec = (host) => {
    if (!hosts.has(host)) hosts.set(host, {
      want: null,
      provider: void 0,
      login: null,
      loginDone: false,
      loginError: null,
      loginRetryAt: 0,
      token: null,
      cli: false,
      failures: 0,
      blockedUntil: 0,
      windowEnd: 0,
      lastError: null
    });
    return hosts.get(host);
  };
  function timed(fn) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const entry = { deadline: io.now() + TIMEOUT, ctl, reject: null };
    const timer = new Promise((_, reject) => {
      entry.reject = reject;
    });
    deadlines.add(entry);
    return Promise.race([Promise.resolve().then(() => fn(ctl?.signal)), timer]).finally(() => deadlines.delete(entry));
  }
  function sweep(now) {
    for (const e of [...deadlines]) {
      if (now < e.deadline) continue;
      deadlines.delete(e);
      e.reject(new Timeout("timeout"));
      try {
        e.ctl?.abort();
      } catch {
      }
    }
  }
  const cli = (cmd, args) => timed(() => io.exec(cmd, args, { timeout: TIMEOUT })).catch((e) => ({ code: -1, stdout: "", stderr: e instanceof Timeout ? "timeout" : String(e?.message ?? e) }));
  async function readToken(host, provider) {
    let token = "";
    if (provider === "github") {
      const r = await cli("gh", ["auth", "token", "--hostname", host]);
      if (r.code === 0) token = String(r.stdout ?? "").trim();
    } else {
      const r = await cli("glab", ["config", "get", "token", "--host", host]);
      if (r.code === 0) token = String(r.stdout ?? "").trim();
      if (!token) {
        const s = await cli("glab", ["auth", "status", "--hostname", host, "--show-token"]);
        const m = /Token:\s*(\S+)/.exec(`${s.stdout ?? ""}
${s.stderr ?? ""}`);
        token = m && !/^\*+$/.test(m[1]) ? m[1] : "";
      }
    }
    if (token) secrets.add(token);
    return token || null;
  }
  async function login(host, h) {
    const startedAt = io.now();
    h.loginError = null;
    if (h.want === "none") {
      h.provider = null;
      return;
    }
    const provider = h.want === "auto" ? host === "github.com" ? "github" : null : h.want;
    let unreachable = false;
    if (!provider) {
      const st = await cli("glab", ["auth", "status", "--hostname", host]);
      h.provider = "gitlab";
      if (st.code !== 0) {
        const out = `${st.stdout ?? ""}
${st.stderr ?? ""}`;
        if (st.code === -1 && MISSING_CLI.test(out) || NOT_LOGGED_IN.test(out)) {
          h.loginError = "not logged in";
          return;
        }
        unreachable = true;
      }
    } else h.provider = provider;
    h.token = await readToken(host, h.provider);
    if (h.token) return;
    h.loginError = unreachable ? `cannot reach ${host}` : "not logged in";
    if (unreachable) backoff(h, h.loginError, startedAt);
  }
  async function resolve(host) {
    const h = rec(host);
    const ov = io.shared(HOSTS_KEY)?.[host];
    const want = ov == null ? "auto" : ov === "gitlab" || ov === "github" ? ov : "none";
    if (h.want !== want) Object.assign(h, { want, provider: void 0, login: null, loginDone: false, token: null });
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
  const baseUrl = (host, provider) => provider === "github" ? host === "github.com" ? "https://api.github.com/" : `https://${host}/api/v3/` : `https://${host}/api/v4/`;
  const headers = (provider, token) => provider === "github" ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "herdr-dock" } : { "PRIVATE-TOKEN": token, "User-Agent": "herdr-dock" };
  function backoff(h, error, startedAt) {
    const now = io.now();
    if (now < h.blockedUntil || startedAt < h.windowEnd) return;
    h.failures++;
    h.blockedUntil = h.windowEnd = now + BACKOFF[Math.min(h.failures, BACKOFF.length) - 1];
    h.lastError = error;
  }
  function fail(h, error, hostFailure, startedAt, extra = {}) {
    if (hostFailure) backoff(h, error, startedAt);
    return { ok: false, error: redact(error), hostFailure, ...extra };
  }
  const isBlocked = (h) => io.now() < h.blockedUntil;
  const blockedResult = (h) => ({ ok: false, error: redact(h.lastError ?? "unavailable"), hostFailure: true });
  const good = (h, data) => {
    h.failures = 0;
    h.blockedUntil = 0;
    h.windowEnd = 0;
    return { ok: true, data };
  };
  async function viaCli(host, h, method, path, wantJson) {
    const cmd = h.provider === "github" ? "gh" : "glab";
    const hostArgs = cmd === "glab" || host !== "github.com" ? ["--hostname", host] : [];
    let startedAt = io.now();
    const r = await http(() => {
      if (isBlocked(h)) return null;
      startedAt = io.now();
      return cli(cmd, ["api", ...hostArgs, ...method === "POST" ? ["-X", "POST"] : [], path]);
    });
    if (!r) return blockedResult(h);
    if (r.code !== 0) {
      const msg = firstLine(r.stderr || r.stdout) || `${cmd} api exited ${r.code}`;
      return fail(h, msg, !/\b4\d\d\b/.test(msg), startedAt);
    }
    if (!wantJson) return good(h, null);
    try {
      return good(h, JSON.parse(String(r.stdout ?? "")));
    } catch {
      return fail(h, "bad response", false, startedAt);
    }
  }
  async function request(host, method, path) {
    const h = rec(host);
    const wantJson = method === "GET";
    if (!h.provider || !h.token) return { ok: false, error: "not logged in", hint: loginHint(h.provider, host), hostFailure: false };
    if (isBlocked(h)) return blockedResult(h);
    if (h.cli) return viaCli(host, h, method, path, wantJson);
    let startedAt = io.now();
    const url = baseUrl(host, h.provider) + path;
    const once = () => http(() => {
      if (isBlocked(h)) return { blocked: true };
      startedAt = io.now();
      return timed(async (signal) => {
        const init = { method, headers: headers(h.provider, h.token) };
        if (signal) init.signal = signal;
        const r = await io.fetch(url, init);
        if (!r.ok || !wantJson) return { status: r.status, ok: r.ok, data: null };
        try {
          return { status: r.status, ok: true, data: await r.json() };
        } catch {
          return { status: r.status, ok: false, data: null, bad: true };
        }
      });
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
          return fail(h, "not logged in", false, startedAt, { hint: loginHint(h.provider, host) });
        }
      }
      if (r.bad) return fail(h, "bad response", false, startedAt);
      if (!r.ok) return fail(h, `HTTP ${r.status}`, r.status >= 500 || r.status === 429, startedAt);
      return good(h, r.data);
    } catch (e) {
      if (e instanceof Timeout) return fail(h, "timeout", true, startedAt);
      h.cli = true;
      log(`CI: fetch to ${host} failed (${redact(e?.cause?.code ?? e?.message ?? e)}); using ${h.provider === "github" ? "gh" : "glab"} api`);
      return viaCli(host, h, method, path, wantJson);
    }
  }
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
      if (j.ok && Array.isArray(j.data)) jobs = [...j.data].sort((a, b) => a.id - b.id);
      else log(`CI: jobs of ${host}/${path} pipeline ${p.id}: ${j.error ?? "bad response"}`);
    }
    return { ok: true, pipeline: gitlabPipeline(p, jobs) };
  }
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
    await Promise.all(failed.map(async (run2) => {
      const j = await request(host, "GET", `repos/${repo}/actions/runs/${encodeURIComponent(run2.id)}/jobs`);
      if (j.ok) jobsByRunId[run2.id] = j.data;
      else log(`CI: jobs of ${host}/${path} run ${run2.id}: ${j.error}`);
    }));
    const canceled = r.data.workflow_runs.filter((x) => x.head_sha === first.id && normalizeStatus("github", x) === "canceled");
    return { ok: true, pipeline: githubLatest(r.data, jobsByRunId), runIds: failed.map((x) => x.id), canceledRunIds: canceled.map((x) => x.id) };
  }
  const latest = (host, provider, path, head) => (provider === "github" ? githubLatestOf : gitlabLatest)(host, path, head);
  async function retry(host, provider, path, pipeline, runIds, canceledRunIds) {
    let posts;
    if (provider === "gitlab") {
      posts = [`projects/${encodeURIComponent(path)}/pipelines/${encodeURIComponent(pipeline.id)}/retry`];
    } else {
      const repo = path.split("/").map(encodeURIComponent).join("/");
      posts = [
        ...(runIds ?? []).map((rid) => `repos/${repo}/actions/runs/${encodeURIComponent(rid)}/rerun-failed-jobs`),
        ...(canceledRunIds ?? []).map((rid) => `repos/${repo}/actions/runs/${encodeURIComponent(rid)}/rerun`)
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
      return h?.cli ? h.provider === "github" ? "gh" : "glab" : "fetch";
    },
    blocked: (host, now) => now < (hosts.get(host)?.blockedUntil ?? 0),
    // The refresh button: clear backoff, and let hosts without a login check again.
    reset() {
      for (const h of hosts.values()) {
        Object.assign(h, { failures: 0, blockedUntil: 0, windowEnd: 0 });
        if (!h.token) h.login = null;
      }
    }
  };
}

// src/shared/gitcmd.js
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function utf8(str2) {
  const out = [];
  for (const ch of str2) {
    const c = ch.codePointAt(0);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return out;
}
function b64urlEncode(str2) {
  const b = utf8(String(str2));
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = b[i] << 16 | (b[i + 1] ?? 0) << 8 | (b[i + 2] ?? 0);
    s += ALPHABET[n >> 18 & 63] + ALPHABET[n >> 12 & 63];
    if (i + 1 < b.length) s += ALPHABET[n >> 6 & 63];
    if (i + 2 < b.length) s += ALPHABET[n & 63];
  }
  return s;
}
function b64urlDecode(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const bytes = [];
  for (let i = 0; i < s.length; i += 4) {
    const q = s.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) n = n << 6 | (j < q.length ? ALPHABET.indexOf(q[j]) : 0);
    bytes.push(n >> 16 & 255);
    if (q.length > 2) bytes.push(n >> 8 & 255);
    if (q.length > 3) bytes.push(n & 255);
  }
  const MIN = [0, 0, 128, 2048, 65536];
  let out = "";
  try {
    for (let i = 0; i < bytes.length; ) {
      const b = bytes[i];
      const len = b < 128 ? 1 : (b & 224) === 192 ? 2 : (b & 240) === 224 ? 3 : (b & 248) === 240 ? 4 : 0;
      if (!len || i + len > bytes.length) return null;
      let c = len === 1 ? b : b & 255 >> len + 1;
      for (let j = 1; j < len; j++) {
        if ((bytes[i + j] & 192) !== 128) return null;
        c = c << 6 | bytes[i + j] & 63;
      }
      if (len > 1 && c < MIN[len] || c > 1114111 || c >= 55296 && c <= 57343) return null;
      out += String.fromCodePoint(c);
      i += len;
    }
  } catch {
    return null;
  }
  return out;
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
function parseGitCommand(c) {
  if (typeof c !== "string" || !c.startsWith("git.")) return null;
  const rest = c.slice(4);
  if (rest === "refresh" || rest === "retry" || rest === "open") return { cmd: rest };
  if (rest === "show") return { cmd: "show", worktree: null };
  let m = /^open\.job\.(\d+)$/.exec(rest);
  if (m) return { cmd: "open.job", index: Number(m[1]) };
  m = /^(select|show|delete)\.([A-Za-z0-9_-]+)$/.exec(rest);
  if (m) {
    const worktree = b64urlDecode(m[2]);
    return worktree == null ? null : { cmd: m[1], worktree };
  }
  return null;
}
var DIALOG = { mod: "dock-pipelines", kind: "dialog", width: 640, height: 0.7 };
function revealPlan(merged, mod, dialog) {
  const placed = (merged?.regions?.right?.features ?? []).some((f) => f?.mod === mod);
  if (placed) return { set: { "dock.right.active": mod, "dock.right.shown": true } };
  return { overlay: { ...dialog } };
}
var showPlan = (merged) => revealPlan(merged, "dock-pipelines", DIALOG);

// src/shared/collector.js
var GIT_LIMIT = 4;
var REV_PARSE = ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"];
var LIST_EVERY = 6e4;
var REPOS_KEY = "dock.git.repos";
var SKIPPED_KEY = "dock.git.skipped";
var HIDDEN_KEY = "dock.git.hidden";
var STATE_KEY = "dock.git.state";
var SELECTED_KEY = "dock.git.selected";
var DETAIL_KEY = "dock.git.detail";
var ALERTED_KEY = "dock.git.alerted";
var basename = (p) => p.replace(/\/+$/, "").split("/").pop() || p;
var errText = (r) => String(r.stderr || r.stdout || `git exited ${r.code}`).trim().split(/\r?\n/)[0];
var repoName = (mainPath, machine) => basename(mainPath).replace(/\.git$/, "") + (machine ? ` \xB7 ${machine}` : "");
var mainFromCommonDir = (commonDir) => commonDir.endsWith("/.git") ? commonDir.slice(0, -5) : commonDir;
function createCollector(io) {
  const git = limiter(GIT_LIMIT);
  const log = (msg) => {
    try {
      io.log?.(client.redact(msg));
    } catch {
    }
  };
  const client = createCiClient(io, log);
  const startedAt = io.now();
  const platformOf = (machine, path) => machine == null ? io.platform : /^[A-Za-z]:\//.test(slashPath(path)) ? "windows" : "linux";
  const idOf = (machine, path) => worktreeId(machine, path, platformOf(machine, path));
  const run2 = (machine, args) => git(async () => {
    try {
      return await io.exec("git", args, { on: machine ?? void 0 });
    } catch (e) {
      return { code: -1, stdout: "", stderr: String(e?.message ?? e) };
    }
  });
  const added = /* @__PURE__ */ new Map();
  const cwds = /* @__PURE__ */ new Map();
  const repoRecs = /* @__PURE__ */ new Map();
  const wtRecs = /* @__PURE__ */ new Map();
  let published = { repos: [], updatedAt: null };
  let publishedKey = null;
  let detailKey = null;
  let selected = io.shared(SELECTED_KEY) ?? null;
  let tickGen = 0;
  let viewGen = 0;
  let currentView = /* @__PURE__ */ new Map();
  const readAdded = () => {
    const list = io.shared(REPOS_KEY);
    return (Array.isArray(list) ? list : []).filter((r) => r && typeof r.path === "string" && r.path).map((r) => ({ path: slashPath(r.path), machine: r.machine ?? null }));
  };
  const readPanes = () => {
    const spaces2 = io.spaces() ?? [];
    return (io.panes() ?? []).filter((p) => p && typeof p.cwd === "string" && p.cwd).map((p) => {
      const sp = spaces2.find((s) => (s.tabs ?? []).some((t) => t.id === p.tab));
      return { cwd: p.cwd, machine: sp?.machine ?? null, space: sp?.id ?? null };
    });
  };
  async function listAdded(e, now) {
    e.busy = true;
    try {
      const rp = await run2(e.machine, ["-C", e.path, ...REV_PARSE]);
      if (rp.code !== 0) {
        Object.assign(e, { error: errText(rp), list: [] });
        return;
      }
      const { top, commonDir } = parseRevParse(rp.stdout, e.path);
      const wl = await run2(e.machine, ["-C", top, "worktree", "list", "--porcelain"]);
      if (wl.code !== 0) {
        Object.assign(e, { error: errText(wl), list: [] });
        return;
      }
      Object.assign(e, { error: null, commonDir, list: parseWorktrees(wl.stdout).filter((w) => !w.bare) });
    } finally {
      Object.assign(e, { at: now, busy: false, done: true });
    }
  }
  async function resolveCwd(e, p, now) {
    e.busy = true;
    let done = true;
    try {
      const r = await run2(p.machine, ["-C", p.cwd, ...REV_PARSE]);
      e.result = r.code === 0 ? parseRevParse(r.stdout, p.cwd) : null;
      if (r.code === -1) {
        done = false;
        log(`git rev-parse failed in ${p.cwd}: ${errText(r)}`);
      }
    } finally {
      Object.assign(e, { busy: false, done, at: now });
    }
  }
  async function readOrigin(rec, machine, path) {
    rec.busy = true;
    try {
      const r = await run2(machine, ["-C", path, "remote", "get-url", "origin"]);
      if (r.code === 0) rec.origin = parseRemote(r.stdout);
      else if (r.code === 2) rec.origin = null;
      else log(`git remote get-url failed in ${path}: ${errText(r)}`);
    } finally {
      rec.busy = false;
    }
  }
  async function pollStatus(w, now) {
    w.busy = true;
    try {
      const r = await run2(w.machine, ["--no-optional-locks", "-C", w.path, "status", "--porcelain=v2", "--branch"]);
      if (r.code === 0) {
        const g = parseStatus(r.stdout);
        if (w.git?.ahead > 0 && g.ahead === 0) w.upstreamChangedAt = now;
        Object.assign(w, { git: g, error: null });
      } else {
        w.error = errText(r);
        log(`git status failed in ${w.path}: ${w.error}`);
      }
    } finally {
      Object.assign(w, { gitAt: now, busy: false });
    }
  }
  const newCi = () => ({
    at: -Infinity,
    busy: false,
    done: false,
    host: null,
    path: null,
    provider: null,
    pipeline: null,
    runIds: [],
    error: null,
    hint: null,
    hostFailure: false,
    target: null,
    prev: void 0,
    retryError: null
  });
  const headOf = (wt, w) => wt.git ? { branch: wt.git.branch, sha: wt.git.oid } : { branch: w.branch, sha: w.head };
  const branchLabel = ({ branch, sha }) => branch ?? (sha ? `detached @${sha.slice(0, 7)}` : "detached");
  function maybeAlert(wt, repo, cur, head) {
    const alerted = io.shared(ALERTED_KEY);
    const a = alertFor({
      prev: wt.ci.prev,
      cur,
      alerted: alerted?.[wt.id],
      startedAt,
      repo: repoName(repo.mainPath, repo.machine),
      branch: branchLabel(head)
    });
    if (!a) return;
    const all = alerted && typeof alerted === "object" && !Array.isArray(alerted) ? alerted : {};
    io.setShared(ALERTED_KEY, { ...all, [wt.id]: nextAlerted(all[wt.id], alertKey(cur)) });
    try {
      const name = `dock-core.${gitCommandName("git.show", { worktree: wt.id })}`;
      io.notify({ ...a, level: "error", action: { name, args: { worktree: wt.id } } });
      io.playSound("blocked");
    } catch (e) {
      log(`CI: alert failed: ${e?.message ?? e}`);
    }
  }
  async function pollCi(wt, repo, origin, w, now) {
    const ci = wt.ci;
    ci.busy = true;
    try {
      const login = await client.resolve(origin.host);
      Object.assign(ci, { host: origin.host, path: origin.path, provider: login.provider });
      if (!login.provider) return Object.assign(ci, { error: null, hint: null, hostFailure: false, done: false });
      if (login.error) return Object.assign(ci, { error: login.error, hint: login.hint, hostFailure: login.hostFailure, done: true });
      const head = headOf(wt, w);
      if (!head.branch && !head.sha) return;
      const target = head.branch ? `ref:${head.branch}` : `sha:${head.sha}`;
      const got = await client.latest(origin.host, login.provider, origin.path, head);
      if (!got.ok) {
        log(`CI: ${origin.host}/${origin.path}: ${got.error}`);
        return Object.assign(ci, { error: got.error, hint: got.hint ?? null, hostFailure: got.hostFailure, done: true });
      }
      if (ci.target !== target) Object.assign(ci, { target, prev: void 0 });
      const cur = got.pipeline;
      const was = ci.pipeline;
      if (!was || !cur || was.id !== cur.id || was.status !== cur.status || was.finishedAt !== cur.finishedAt) ci.retryError = null;
      Object.assign(ci, { pipeline: cur, runIds: got.runIds ?? [], canceledRunIds: got.canceledRunIds ?? [], error: null, hint: null, hostFailure: false, done: true });
      if (cur) maybeAlert(wt, repo, cur, head);
      ci.prev = cur ?? void 0;
    } finally {
      Object.assign(ci, { at: now, busy: false });
      publish(io.now());
    }
  }
  function ciDue(wt, host, now) {
    if (wt.ci.busy || client.blocked(host, now)) return false;
    if (wt.ci.hostFailure) return true;
    return now - wt.ci.at >= ciInterval({ status: wt.ci.pipeline?.status, upstreamChangedAt: wt.upstreamChangedAt, now });
  }
  function pipelineSummary(wt) {
    const ci = wt?.ci;
    if (!ci?.provider || !ci.done) return null;
    const p = ci.pipeline;
    const head = wt.git?.oid ?? null;
    return {
      status: ci.error ? "unknown" : p ? p.status : "none",
      id: p?.id ?? null,
      number: p?.number ?? null,
      sha: p?.sha ?? null,
      webUrl: p?.webUrl ?? null,
      createdAt: p?.createdAt ?? null,
      stale: !!(p && head && p.sha && p.sha !== head),
      error: ci.error,
      hint: ci.hint
    };
  }
  function locate(id) {
    for (const r of currentView.values()) if (r.wts.has(id)) return { repo: r, w: r.wts.get(id) };
    return null;
  }
  function publishDetail() {
    if (selected == null) return;
    const wt = wtRecs.get(selected);
    const at = locate(selected);
    const ci = wt?.ci;
    const head = wt && at ? headOf(wt, at.w) : { branch: null, sha: null };
    const p = ci?.pipeline ?? null;
    const detail = {
      worktree: selected,
      repo: at ? repoName(at.repo.mainPath, at.repo.machine) : null,
      branch: head.branch ?? null,
      provider: ci?.provider ?? null,
      via: ci?.provider ? client.via(ci.host) : null,
      pipeline: p,
      olderThanHead: !!(p && head.sha && p.sha && p.sha !== head.sha),
      error: ci?.error ?? null,
      hint: ci?.hint ?? null,
      retryError: ci?.retryError ?? null
      // the last Retry's failure, until a Retry succeeds
    };
    const key = JSON.stringify(detail);
    if (key === detailKey) return;
    detailKey = key;
    io.setShared(DETAIL_KEY, detail);
  }
  function buildView(addedList, paneList) {
    const view = /* @__PURE__ */ new Map();
    const repoFor = (id, machine, mainPath) => {
      if (!view.has(id)) view.set(id, { id, machine, mainPath, added: false, addedPaths: [], error: null, wts: /* @__PURE__ */ new Map() });
      return view.get(id);
    };
    for (const a of addedList) {
      const e = added.get(`${a.machine ?? ""}|${a.path}`);
      if (!e?.done) continue;
      if (e.error) {
        const bad = repoFor(idOf(a.machine, a.path), a.machine, a.path);
        Object.assign(bad, { added: true, error: e.error });
        bad.addedPaths.push({ path: a.path, machine: a.machine });
        continue;
      }
      const repo = repoFor(idOf(a.machine, e.commonDir), a.machine, e.list[0]?.path ?? mainFromCommonDir(e.commonDir));
      repo.added = true;
      repo.addedPaths.push({ path: a.path, machine: a.machine });
      for (const w of e.list) {
        const id = idOf(a.machine, w.path);
        if (!repo.wts.has(id)) {
          repo.wts.set(id, { path: w.path, branch: w.branch, detached: w.detached, head: w.head || null, open: false, space: null });
        }
      }
    }
    const fromPanes = [];
    for (const p of paneList) {
      const r = cwds.get(`${p.machine ?? ""}|${p.cwd}`)?.result;
      if (!r) continue;
      const id = idOf(p.machine, r.commonDir);
      if (!view.has(id)) fromPanes.push(id);
      const repo = repoFor(id, p.machine, mainFromCommonDir(r.commonDir));
      const wid = idOf(p.machine, r.top);
      if (!repo.wts.has(wid)) {
        repo.wts.set(wid, { path: r.top, branch: null, detached: false, head: null, open: false, space: null });
      }
      const w = repo.wts.get(wid);
      w.open = true;
      w.space ??= p.space;
    }
    const nameOf = (id) => repoName(view.get(id).mainPath, view.get(id).machine);
    fromPanes.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b));
    const ordered = /* @__PURE__ */ new Map();
    for (const [id, r] of view) if (!fromPanes.includes(id)) ordered.set(id, r);
    for (const id of fromPanes) ordered.set(id, view.get(id));
    return ordered;
  }
  function applySkipAndAutoAdd(view, addedList) {
    const resolving = addedList.some((a) => !added.get(`${a.machine ?? ""}|${a.path}`)?.done);
    applyHidden(view, resolving);
    const raw = io.shared(SKIPPED_KEY);
    const skipped = Array.isArray(raw) ? raw.filter((s) => typeof s === "string") : [];
    const open = new Set([...view.values()].filter((r) => [...r.wts.values()].some((w) => w.open)).map((r) => r.id));
    const keep = skipped.filter((id) => open.has(id));
    if (keep.length !== skipped.length || !Array.isArray(raw)) {
      if (raw !== void 0 || keep.length) io.setShared(SKIPPED_KEY, keep);
    }
    for (const id of keep) view.delete(id);
    if (io.autoAdd === false) return;
    if (resolving) return;
    const extra = [];
    for (const r of view.values()) {
      if (r.added || r.error) continue;
      const w = [...r.wts.values()].find((x) => x.open);
      if (w) extra.push({ path: w.path, machine: r.machine ?? null });
    }
    if (extra.length) io.setShared(REPOS_KEY, [...io.shared(REPOS_KEY) ?? [], ...extra]);
  }
  function applyHidden(view, resolving) {
    const raw = io.shared(HIDDEN_KEY);
    const list = Array.isArray(raw) ? raw.filter((e) => e && typeof e.id === "string") : [];
    const where = /* @__PURE__ */ new Map();
    for (const r of view.values()) for (const [id, w] of r.wts) where.set(id, { r, w });
    const next = [];
    for (const e of list) {
      const f = where.get(e.id);
      if (!f) {
        if (resolving) next.push(e);
        continue;
      }
      if (!e.held && f.w.open) continue;
      next.push({ id: e.id, held: Boolean(e.held && f.w.open) });
      f.r.wts.delete(e.id);
      if (!f.r.wts.size && !f.r.error) view.delete(f.r.id);
    }
    if (JSON.stringify(next) !== JSON.stringify(list) || raw !== void 0 && !Array.isArray(raw)) io.setShared(HIDDEN_KEY, next);
  }
  async function deleteWorktree(id) {
    let found = null;
    for (const r2 of currentView.values()) if (r2.wts.has(id)) found = { r: r2, w: r2.wts.get(id) };
    if (!found) return { ok: false, error: "worktree not found" };
    const { r, w } = found;
    if (slashPath(w.path).toLowerCase() === slashPath(r.mainPath).toLowerCase()) {
      return { ok: false, error: "the main checkout can't be deleted as a worktree" };
    }
    const res = await run2(r.machine, ["-C", r.mainPath, "worktree", "remove", w.path]);
    refresh();
    if (res.code === 0) return { ok: true };
    const error = errText(res);
    log(`git worktree remove ${w.path} failed: ${error}`);
    io.notify({ title: `Couldn't delete worktree ${basename(w.path)}`, body: error, level: "error" });
    return { ok: false, error };
  }
  function publish(now) {
    const repos = [...currentView.values()].map((r) => {
      const origin = repoRecs.get(r.id)?.origin ?? null;
      return {
        id: r.id,
        name: repoName(r.mainPath, r.machine),
        machine: r.machine,
        provider: origin ? client.providerOf(origin.host) : null,
        host: origin?.host ?? null,
        path: origin?.path ?? null,
        // the origin's remote path (e.g. "grp/api"), not a folder
        added: r.added,
        addedPaths: r.addedPaths,
        error: r.error,
        worktrees: [...r.wts].map(([id, w]) => {
          const g = wtRecs.get(id)?.git;
          return {
            id,
            path: w.path,
            branch: g ? g.branch : w.branch,
            detached: g ? g.branch === null : w.detached,
            sha: g ? g.oid : w.head,
            upstream: g?.upstream ?? null,
            ahead: g?.ahead ?? null,
            behind: g?.behind ?? null,
            dirty: g?.dirty ?? false,
            open: w.open,
            space: w.space,
            pipeline: pipelineSummary(wtRecs.get(id))
          };
        })
      };
    });
    publishDetail();
    const key = JSON.stringify(repos);
    if (key === publishedKey) return;
    publishedKey = key;
    published = { repos, updatedAt: now };
    io.setShared(STATE_KEY, published);
  }
  async function tick() {
    const gen = ++tickGen;
    const now = io.now();
    client.sweep(now);
    const addedList = readAdded();
    const paneList = readPanes();
    const addedKeys = /* @__PURE__ */ new Set();
    const jobs = [];
    for (const a of addedList) {
      const key = `${a.machine ?? ""}|${a.path}`;
      addedKeys.add(key);
      if (!added.has(key)) added.set(key, { machine: a.machine, path: a.path, at: -Infinity, busy: false, done: false });
      const e = added.get(key);
      if (!e.busy && now - e.at >= LIST_EVERY) jobs.push(listAdded(e, now));
    }
    for (const key of added.keys()) if (!addedKeys.has(key)) added.delete(key);
    const cwdKeys = /* @__PURE__ */ new Set();
    for (const p of paneList) {
      const key = `${p.machine ?? ""}|${p.cwd}`;
      cwdKeys.add(key);
      if (!cwds.has(key)) cwds.set(key, { busy: false, done: false, at: -Infinity, result: null });
      const e = cwds.get(key);
      if (!e.busy && !e.done && now - e.at >= gitInterval({ open: true })) jobs.push(resolveCwd(e, p, now));
    }
    for (const key of cwds.keys()) if (!cwdKeys.has(key)) cwds.delete(key);
    await Promise.all(jobs);
    const view = buildView(addedList, paneList);
    applySkipAndAutoAdd(view, addedList);
    currentView = view;
    viewGen = gen;
    const wtIds = /* @__PURE__ */ new Set();
    for (const r of view.values()) {
      if (!repoRecs.has(r.id)) repoRecs.set(r.id, { origin: void 0, busy: false, tried: false });
      for (const [id, w] of r.wts) {
        wtIds.add(id);
        if (!wtRecs.has(id)) wtRecs.set(id, { id, machine: r.machine, path: w.path, gitAt: -Infinity, busy: false, git: null, error: null, upstreamChangedAt: -Infinity, ci: newCi() });
      }
    }
    for (const id of repoRecs.keys()) if (!view.has(id)) repoRecs.delete(id);
    for (const id of wtRecs.keys()) if (!wtIds.has(id)) wtRecs.delete(id);
    const polls = [];
    for (const r of view.values()) {
      const rec = repoRecs.get(r.id);
      const first = r.wts.values().next().value;
      let anyDue = false;
      for (const [id, w] of r.wts) {
        const wt = wtRecs.get(id);
        if (!wt.busy && now - wt.gitAt >= gitInterval({ open: w.open })) {
          anyDue = true;
          polls.push(pollStatus(wt, now));
        }
      }
      if (first && rec.origin === void 0 && !rec.busy && (!rec.tried || anyDue)) {
        rec.tried = true;
        polls.push(readOrigin(rec, r.machine, first.path));
      }
    }
    await Promise.all(polls);
    if (gen < viewGen) return;
    const ciJobs = [];
    for (const r of currentView.values()) {
      const origin = repoRecs.get(r.id)?.origin;
      if (!origin) continue;
      for (const [id, w] of r.wts) {
        const wt = wtRecs.get(id);
        if (wt && ciDue(wt, origin.host, now)) ciJobs.push(pollCi(wt, r, origin, w, now));
      }
    }
    publish(now);
    await Promise.all(ciJobs);
  }
  function refresh() {
    for (const e of added.values()) e.at = -Infinity;
    for (const e of cwds.values()) if (!e.busy) Object.assign(e, { done: false, at: -Infinity });
    for (const w of wtRecs.values()) {
      w.gitAt = -Infinity;
      w.ci.at = -Infinity;
      w.ci.hostFailure = false;
    }
    client.reset();
  }
  async function select(id) {
    selected = id ?? null;
    io.setShared(SELECTED_KEY, selected);
    publishDetail();
    const wt = wtRecs.get(selected);
    const at = locate(selected);
    const origin = at ? repoRecs.get(at.repo.id)?.origin : null;
    if (wt && origin && !wt.ci.busy && wt.ci.at === -Infinity) await pollCi(wt, at.repo, origin, at.w, io.now());
    publishDetail();
  }
  async function retry() {
    const ci = wtRecs.get(selected)?.ci;
    const p = ci?.pipeline;
    if (!p || !ci.provider) return { ok: false, error: "no pipeline" };
    const r = await client.retry(ci.host, ci.provider, ci.path, p, ci.runIds, ci.canceledRunIds);
    ci.at = -Infinity;
    ci.retryError = r.ok ? null : r.error ?? "retry failed";
    if (!r.ok) log(`CI: retry on ${ci.host}/${ci.path}: ${r.error}`);
    publishDetail();
    return r;
  }
  function urlFor(target) {
    const p = wtRecs.get(selected)?.ci.pipeline;
    if (!p) return null;
    if (target === "pipeline") return p.webUrl ?? null;
    const job = Number.isInteger(target?.job) ? p.failedJobs?.[target.job] : null;
    return job?.webUrl ?? null;
  }
  return { tick, refresh, select, retry, deleteWorktree, urlFor, state: () => published };
}

// src/shared/layout.js
var DIVIDER = { width: 1, color: "border" };
var MAIN_PANE = {
  gap: 8,
  radius: 10,
  background: "background",
  lone: true,
  border: { width: 1, color: "border" },
  focus: { width: 1, color: "accent" },
  header: {
    content: { mod: "pane" },
    height: 30,
    position: "top",
    reveal: "always"
  }
};
var blockId = (region, index, mod) => `dock-${region}-${index}-${mod}`;
function featureBlocks(region, features, extra) {
  return features.map((f, i) => {
    const id = blockId(region, i, f.mod);
    return {
      id,
      type: "block",
      size: f.size ? { px: f.size } : { weight: 1 },
      ...extra,
      ...f.drag ? { window_drag: true } : {},
      content: { mod: f.mod, props: { ...f.props, dockFeature: id, dockRegion: region } }
    };
  });
}
function regionNode(merged, region, type, extra) {
  const r = merged.regions[region];
  if (!r.features.length) return null;
  const node = { id: `dock-${region}`, type, size: { px: r.size }, ...extra.node };
  if (extra.hidden) node.hidden = true;
  node.children = featureBlocks(region, r.features, extra.block);
  return node;
}
function rightActiveOf(active, features) {
  if (!features.length) return null;
  return features.some((f) => f.mod === active) ? active : features[0].mod;
}
function rightNodes(regions, state) {
  const r = regions.right;
  if (!r.features.length) return { right: null, rail: null };
  const shown = typeof state.rightShown === "boolean" ? state.rightShown : !r.hidden;
  const active = rightActiveOf(state.active, r.features);
  const index = r.features.findIndex((f) => f.mod === active);
  const right = {
    id: "dock-right",
    type: "column",
    size: { px: r.size },
    min: 280,
    max: 900,
    ...shown ? {} : { hidden: true },
    children: [{
      id: "dock-right-stack",
      type: "stack",
      active: blockId("right", index, active),
      children: featureBlocks("right", r.features)
    }]
  };
  const rail = {
    id: "dock-rail",
    type: "block",
    size: { px: 40 },
    background: "chrome",
    content: { mod: "dock-rail", props: { dockRegion: "rail" } }
  };
  return { right, rail };
}
var WORK_STACK = "dock-work-stack";
var MAIN_ID = "dock-main";
function pageActiveOf(active, features) {
  return typeof active === "string" && (features ?? []).some((f) => f.mod === active) ? active : null;
}
function pageChildOf(active, features) {
  const mod = pageActiveOf(active, features);
  if (!mod) return MAIN_ID;
  return blockId("page", features.findIndex((f) => f.mod === mod), mod);
}
function workNode(regions, page) {
  const main = { id: MAIN_ID, type: "block", content: { tab: "active", pane: MAIN_PANE } };
  const pages = regions.pages?.features ?? [];
  if (!pages.length) return main;
  return {
    id: WORK_STACK,
    type: "stack",
    active: pageChildOf(page, pages),
    children: [main, ...pages.map((f, i) => ({
      id: blockId("page", i, f.mod),
      type: "block",
      content: { mod: f.mod, props: { ...f.props, dockFeature: blockId("page", i, f.mod), dockRegion: "pages" } }
    }))]
  };
}
function buildLayout(merged, state = {}) {
  const { regions } = merged;
  const top = regionNode(merged, "top", "row", { node: { window_drag: true }, hidden: regions.top.hidden });
  const left = regionNode(merged, "left", "column", {
    node: { min: 44, max: 480, background: "chrome" },
    block: { min: 32 },
    hidden: regions.left.hidden || regions.left.mode === "hidden"
  });
  const { right, rail } = rightNodes(regions, state);
  const bottom = regionNode(merged, "bottom", "row", { node: {}, hidden: regions.bottom.hidden });
  const main = workNode(regions, state.page);
  const body = {
    id: "dock-body",
    type: "row",
    padding: 8,
    gap: 8,
    children: [main, right].filter(Boolean)
  };
  const mid = { id: "dock-mid", type: "row", resizable: false, children: [body, rail].filter(Boolean) };
  const work = {
    id: "dock-work",
    type: "column",
    resizable: false,
    children: [top, mid, bottom].filter(Boolean)
  };
  return {
    id: "root",
    toast: "dock-toast",
    type: "row",
    titlebar: "none",
    background: "canvas",
    terminal_padding: [14, 12],
    divider: DIVIDER,
    children: [left, work].filter(Boolean)
  };
}
function leftFeatureIds(merged) {
  return merged.regions.left.features.map((f, i) => blockId("left", i, f.mod));
}

// src/shared/browser/config.js
var DEFAULT_BROWSER = { enabled: false, chrome: "", production: [], handoffMinutes: 15 };
var isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var HOST_PATTERN = /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
function checkBrowser(value, where = "browser") {
  if (!isObj(value)) return `${where}: must be an object`;
  for (const [k, v] of Object.entries(value)) {
    const at = `${where}.${k}`;
    if (k === "enabled") {
      if (typeof v !== "boolean") return `${at}: must be true or false`;
    } else if (k === "chrome") {
      if (typeof v !== "string") return `${at}: must be a string`;
    } else if (k === "handoffMinutes") {
      if (!(Number.isInteger(v) && v > 0)) return `${at}: must be a positive integer`;
    } else if (k === "production") {
      if (!Array.isArray(v)) return `${at}: must be an array`;
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] !== "string" || !HOST_PATTERN.test(v[i])) return `${at}[${i}]: must be a host pattern like example.com or *.example.com`;
      }
    } else return `${at}: unknown setting`;
  }
  return null;
}
function browserOf(merged) {
  return { ...DEFAULT_BROWSER, ...isObj(merged?.browser) ? merged.browser : {} };
}
function withBrowserFeature(regions, enabled) {
  const out = {};
  for (const [name, r] of Object.entries(regions)) {
    out[name] = { ...r, features: enabled ? [...r.features] : r.features.filter((f) => f.mod !== "dock-browser") };
  }
  if (enabled && !Object.values(out).some((r) => r.features.some((f) => f.mod === "dock-browser"))) {
    out.right.features.push({ mod: "dock-browser" });
  }
  return out;
}

// src/shared/config.js
var REGION_NAMES = ["top", "left", "right", "bottom", "pages"];
var LEFT_MODES = ["expanded", "icons", "hidden"];
var LEFT_ONLY = ["dock-header", "dock-footer", "dock-spaces", "dock-agents", "dock-git", "dock-quotas", "dock-pages"];
var PAGE_ONLY = ["dock-overview", "dock-jira"];
var NEEDS_CORE = "dock-core draws the left-panel toggle, runs Ctrl+Alt+B and shows config errors, so it must stay in a shown top bar";
var isObj2 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function checkRegions(regions, where) {
  if (!isObj2(regions)) return `${where}: must be an object`;
  for (const [name, r] of Object.entries(regions)) {
    const at = `${where}.${name}`;
    if (!REGION_NAMES.includes(name)) return `${at}: unknown region`;
    if (!isObj2(r)) return `${at}: must be an object`;
    if (name === "pages" && "size" in r) return `${at}.size: a page fills the work area, it has no size`;
    if (name === "pages" && r.hidden === true) return `${at}.hidden: pages can't be hidden; remove them instead`;
    if ("size" in r && !(Number.isInteger(r.size) && r.size > 0)) return `${at}.size: must be a positive integer`;
    if ("hidden" in r && typeof r.hidden !== "boolean") return `${at}.hidden: must be a boolean`;
    if ("mode" in r) {
      if (name !== "left") return `${at}.mode: only the left region has a mode`;
      if (!LEFT_MODES.includes(r.mode)) return `${at}.mode: must be one of ${LEFT_MODES.join(", ")}`;
    }
    if (name === "top" && r.hidden === true) return `${at}.hidden: the top bar can't be hidden: ${NEEDS_CORE}`;
    if ("features" in r) {
      if (!Array.isArray(r.features)) return `${at}.features: must be an array`;
      for (let i = 0; i < r.features.length; i++) {
        const f = r.features[i];
        const fa = `${at}.features[${i}]`;
        if (!isObj2(f)) return `${fa}: must be an object`;
        if (typeof f.mod !== "string" || f.mod === "") return `${fa}.mod: must be a non-empty string`;
        if ("size" in f && !(Number.isInteger(f.size) && f.size > 0)) return `${fa}.size: must be a positive integer`;
        if (name === "pages" && "size" in f) return `${fa}.size: a page fills the work area, it has no size`;
        if ("props" in f && !isObj2(f.props)) return `${fa}.props: must be an object`;
        if ("drag" in f && typeof f.drag !== "boolean") return `${fa}.drag: must be true or false`;
        if (name !== "left" && LEFT_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.left`;
        if (name !== "pages" && PAGE_ONLY.includes(f.mod)) return `${fa}.mod: ${f.mod} can only be placed in regions.pages`;
      }
      if (name === "top" && !r.features.some((f) => f.mod === "dock-core")) return `${at}.features: must include dock-core: ${NEEDS_CORE}`;
    }
  }
  return null;
}
function parseConfig(text) {
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }
  if (!isObj2(c)) return { ok: false, error: "config: must be an object" };
  if (c.v !== 1) return { ok: false, error: `v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const err = checkRegions(c.regions ?? {}, "regions");
  if (err) return { ok: false, error: err };
  if (!Array.isArray(c.regions?.top?.features)) return { ok: false, error: `regions.top.features: must include dock-core: ${NEEDS_CORE}` };
  if ("browser" in c) {
    const be = checkBrowser(c.browser, "browser");
    if (be) return { ok: false, error: be };
  }
  if ("machines" in c) {
    if (!isObj2(c.machines)) return { ok: false, error: "machines: must be an object" };
    for (const [host, m] of Object.entries(c.machines)) {
      if (!isObj2(m)) return { ok: false, error: `machines.${host}: must be an object` };
      const e = checkRegions(m.regions ?? {}, `machines.${host}.regions`);
      if (e) return { ok: false, error: e };
      if ("browser" in m) {
        const be = checkBrowser(m.browser, `machines.${host}.browser`);
        if (be) return { ok: false, error: be };
      }
    }
  }
  return { ok: true, config: c };
}
function deepMerge(base, over) {
  if (!isObj2(base) || !isObj2(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}
function hostKey(machines, hostname) {
  const host = String(hostname).toLowerCase();
  return Object.keys(machines).find((k) => k.toLowerCase() === host);
}
function mergeForHost(config, hostname, local = null) {
  const { machines = {}, ...base } = config;
  const key = hostKey(machines, hostname);
  let merged = key ? deepMerge(base, machines[key]) : base;
  if (local) merged = deepMerge(merged, { regions: local.regions ?? {}, ..."browser" in local ? { browser: local.browser } : {} });
  const regions = {};
  for (const name of REGION_NAMES) {
    const r = merged.regions?.[name] ?? {};
    regions[name] = { ...r, features: r.features ?? [], hidden: r.hidden ?? false };
    if (name === "left") regions[name].mode = r.hidden === true ? "hidden" : r.mode ?? "expanded";
  }
  return { ...merged, regions: withBrowserFeature(regions, browserOf(merged).enabled) };
}
var LOCAL_REL = "herdr-dock/local.json";
function parseLocal(text) {
  if (text == null) return { ok: true, local: null };
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${LOCAL_REL}: Invalid JSON: ${e.message}` };
  }
  if (!isObj2(c)) return { ok: false, error: `${LOCAL_REL}: must be an object` };
  if (c.v !== 1) return { ok: false, error: `${LOCAL_REL}: v: unsupported version ${JSON.stringify(c.v)} (expected 1)` };
  const regions = c.regions ?? {};
  const err = checkRegions(regions, "regions");
  if (err) return { ok: false, error: `${LOCAL_REL}: ${err}` };
  if ("browser" in c) {
    const be = checkBrowser(c.browser, "browser");
    if (be) return { ok: false, error: `${LOCAL_REL}: ${be}` };
  }
  return { ok: true, local: { ...c, regions } };
}
function mergeWithLocal(config, hostname, local) {
  const ok = isObj2(local) && local.v === 1 && !checkRegions(local.regions ?? {}, "regions") && !("browser" in local && checkBrowser(local.browser, "browser"));
  return mergeForHost(config, hostname, ok ? local : null);
}
function jsonEqual(a, b) {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isObj2(a)) {
    if (!isObj2(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && jsonEqual(a[k], b[k]));
  }
  return a === b;
}
function withoutEmptyMachines(c) {
  if (!isObj2(c.machines) || Object.keys(c.machines).length) return c;
  const { machines, ...rest } = c;
  return rest;
}
function migrationPlan({ configText, host, localText, headText }) {
  if (localText != null || typeof configText !== "string") return null;
  let c;
  try {
    c = JSON.parse(configText);
  } catch {
    return null;
  }
  if (!isObj2(c) || !isObj2(c.machines)) return null;
  const key = hostKey(c.machines, host);
  if (key === void 0 || !isObj2(c.machines[key])) return null;
  const { [key]: section, ...others } = c.machines;
  const rest = { ...c };
  if (Object.keys(others).length) rest.machines = others;
  else delete rest.machines;
  let head;
  try {
    head = typeof headText === "string" ? JSON.parse(headText) : void 0;
  } catch {
    head = void 0;
  }
  return {
    localText: JSON.stringify({ v: 1, regions: section.regions ?? {} }, null, 2) + "\n",
    configText: isObj2(head) && jsonEqual(rest, withoutEmptyMachines(head)) ? headText : JSON.stringify(rest, null, 2) + "\n"
  };
}
async function migrateLocal({ configPath, localPath, host, read, write, headText }) {
  const localText = await read(localPath);
  if (localText != null) return false;
  const configText = await read(configPath);
  if (migrationPlan({ configText, host, localText: null }) === null) return false;
  let head;
  try {
    head = await headText();
  } catch {
    head = void 0;
  }
  const plan = migrationPlan({ configText, host, localText: null, headText: head });
  await write(localPath, plan.localText, null);
  if (plan.configText !== configText) await write(configPath, plan.configText, configText);
  return true;
}
function planApply(configText, hostname, currentLayoutText, lastGood, state = {}, localText = null) {
  if (typeof configText !== "string") return { write: null, error: "config file not found", merged: lastGood };
  const parsed = parseConfig(configText);
  if (!parsed.ok) return { write: null, error: parsed.error, merged: lastGood };
  const local = parseLocal(localText);
  if (!local.ok) return { write: null, error: local.error, merged: lastGood };
  const merged = mergeWithLocal(parsed.config, hostname, local.local);
  const text = JSON.stringify(buildLayout(merged, state), null, 2) + "\n";
  return { write: text === currentLayoutText ? null : text, error: null, merged };
}

// src/shared/panel.js
var ORDER = ["expanded", "icons", "hidden"];
var LEFT = "dock-left";
var ICON_PX = 48;
var COLLAPSED_PX = 32;
function nextMode(mode, focus = null) {
  if (mode === "expanded" && focus != null) return "expanded";
  const i = ORDER.indexOf(mode);
  return ORDER[(i + 1) % ORDER.length];
}
var configSize = (f) => f.size ? { px: f.size } : { weight: 1 };
var sizeArgs = (id, s) => Number.isFinite(s?.px) ? { id, px: s.px } : { id, weight: s?.weight ?? 1 };
var resize = (args) => ({ command: "layout.resize", args });
function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}
function liveSizes(tree, merged) {
  const node = findNode(tree, LEFT);
  if (!node) return null;
  const sizes = {};
  for (const id of leftFeatureIds(merged)) {
    const s = findNode(node, id)?.size;
    if (s) sizes[id] = Number.isFinite(s.px) ? { px: s.px } : { weight: s.weight ?? 1 };
  }
  return { px: Number.isFinite(node.size?.px) ? node.size.px : null, sizes };
}
function sizeChanges(before, after) {
  if (!before || !after) return null;
  const out = { sizes: {} };
  if (before.regions.left.size !== after.regions.left.size) out.px = after.regions.left.size;
  const old = new Map(leftFeatureIds(before).map((id, i) => [id, before.regions.left.features[i]]));
  leftFeatureIds(after).forEach((id, i) => {
    const f = after.regions.left.features[i];
    if (old.has(id) && (old.get(id).size ?? null) !== (f.size ?? null)) out.sizes[id] = configSize(f);
  });
  return "px" in out || Object.keys(out.sizes).length ? out : null;
}
function sizesSnapshot(merged) {
  const left = merged?.regions?.left;
  if (!left) return null;
  return { regions: { left: { size: left.size, features: (left.features ?? []).map((f) => f.size ? { mod: f.mod, size: f.size } : { mod: f.mod }) } } };
}
function snapshot(merged, live) {
  const sizes = {};
  leftFeatureIds(merged).forEach((id, i) => {
    sizes[id] = live?.sizes?.[id] ?? configSize(merged.regions.left.features[i]);
  });
  const px = Number.isFinite(live?.px) && live.px > ICON_PX ? live.px : merged.regions.left.size;
  return { px, sizes };
}
function changeActions(changes) {
  if (!changes) return [];
  const out = [];
  if (Number.isFinite(changes.px)) out.push(resize({ id: LEFT, px: changes.px }));
  for (const [id, s] of Object.entries(changes.sizes ?? {})) out.push(resize(sizeArgs(id, s)));
  return out;
}
function planPanel({ mode, focus, merged, live, restore, changes }) {
  const ids = leftFeatureIds(merged);
  const features = merged.regions.left.features;
  const foreign = ids.filter((_, i) => !String(features[i].mod).startsWith("dock-"));
  const ours = mode === "icons" || mode === "expanded" && focus != null;
  let saved = restore ?? null;
  if (ours && !saved) saved = snapshot(merged, live);
  if (saved && changes) {
    saved = { px: changes.px ?? saved.px, sizes: { ...saved.sizes, ...changes.sizes } };
  }
  if (mode === "hidden") {
    return { actions: [{ command: "layout.hide", args: { id: LEFT } }, ...saved ? [] : changeActions(changes)], restore: saved };
  }
  const out = [{ command: "layout.show", args: { id: LEFT } }];
  if (mode === "icons") {
    for (const id of foreign) out.push({ command: "layout.hide", args: { id } });
    out.push(resize({ id: LEFT, px: ICON_PX }));
    return { actions: out, restore: saved };
  }
  for (const id of foreign) out.push({ command: "layout.show", args: { id } });
  if (focus != null) {
    out.push(resize({ id: LEFT, px: saved.px }));
    for (const id of ids) out.push(resize(id === focus ? { id, weight: 1 } : { id, px: COLLAPSED_PX }));
    return { actions: out, restore: saved };
  }
  if (saved) {
    out.push(resize({ id: LEFT, px: saved.px }));
    ids.forEach((id, i) => out.push(resize(sizeArgs(id, saved.sizes[id] ?? configSize(features[i])))));
    return { actions: out, restore: null };
  }
  const acts = changeActions(changes);
  if (!acts.some((a) => a.args.id === LEFT) && Number.isFinite(live?.px) && live.px <= ICON_PX) {
    acts.unshift(resize({ id: LEFT, px: merged.regions.left.size }));
  }
  out.push(...acts);
  return { actions: out, restore: null };
}
function modeFromConfig(lastConfigMode, sharedMode, configMode) {
  if (lastConfigMode === configMode) return null;
  if (lastConfigMode == null && ORDER.includes(sharedMode)) return { record: configMode, mode: null };
  return { record: configMode, mode: configMode };
}
function planSync({ mode, focus, leftIds, applied }) {
  let f = mode === "expanded" ? focus ?? null : null;
  let clearFocus = false;
  if (f !== null && !leftIds.includes(f)) {
    f = null;
    clearFocus = true;
  }
  const key = `${mode}|${f}`;
  if (key === applied) return null;
  const appliedMode = typeof applied === "string" ? applied.split("|")[0] : null;
  if (mode !== "expanded" && focus != null && appliedMode === "expanded" && applied !== "expanded|null") clearFocus = true;
  return { key, focus: f, clearFocus };
}
var RIGHT = "dock-right";
var RIGHT_STACK = "dock-right-stack";
function liveRight(tree) {
  const col = findNode(tree, RIGHT);
  const stack = findNode(tree, RIGHT_STACK);
  return {
    column: Boolean(col && !col.hidden),
    active: stack?.active ?? null,
    children: stack ? (stack.children ?? []).map((c) => c?.id).filter((id) => typeof id === "string") : null
  };
}
function rightShownOf(sharedShown, applied) {
  if (typeof sharedShown === "boolean") return sharedShown;
  return applied?.right?.hidden === false;
}
function planRight({ shown, active, features, live }) {
  if (!features.length) return [];
  const mod = rightActiveOf(active, features);
  const child = `dock-right-${features.findIndex((f) => f.mod === mod)}-${mod}`;
  if (!shown) return live.column ? [{ command: "layout.hide", args: { id: RIGHT } }] : [];
  if (Array.isArray(live.children) && !live.children.includes(child)) return [];
  const out = [];
  if (live.active !== child) out.push({ command: "layout.select", args: { stack: RIGHT_STACK, child } });
  if (!live.column) out.push({ command: "layout.show", args: { id: RIGHT } });
  return out;
}
function rightFromConfig(lastConfigHidden, sharedShown, configHidden) {
  if (lastConfigHidden === configHidden) return null;
  if (lastConfigHidden == null && typeof sharedShown === "boolean") return { record: configHidden, shown: null };
  return { record: configHidden, shown: !configHidden };
}
function rightConfigUpdate({ prev, merged, saved }) {
  const set = {};
  let shown = saved.shown;
  let active = saved.active;
  const r = rightFromConfig(saved.configHidden, shown, merged.regions.right.hidden);
  if (r) {
    set["dock.right.configHidden"] = r.record;
    if (r.shown !== null) {
      shown = r.shown;
      set["dock.right.shown"] = r.shown;
    }
  }
  if (prev) {
    const before = new Set(prev.regions.right.features.map((f) => f.mod));
    const added = merged.regions.right.features.find((f) => !before.has(f.mod))?.mod;
    if (added) {
      active = added;
      set["dock.right.active"] = added;
      if (shown !== true) {
        shown = true;
        set["dock.right.shown"] = true;
      }
    }
  }
  return {
    set,
    state: { rightShown: rightShownOf(shown, merged.regions), active: typeof active === "string" ? active : void 0 }
  };
}
var PAGE_KEY = "dock.page.active";
function liveWork(tree) {
  const stack = findNode(tree, WORK_STACK);
  if (!stack) return null;
  return { active: stack.active ?? null, children: (stack.children ?? []).map((c) => c?.id).filter((id) => typeof id === "string") };
}
function planPage({ active, features, live }) {
  if (!live || !features?.length) return [];
  const child = pageChildOf(active, features);
  if (!live.children.includes(child) || live.active === child) return [];
  return [{ command: "layout.select", args: { stack: WORK_STACK, child } }];
}
function nextPage(active, features) {
  const list = (features ?? []).map((f) => f.mod);
  if (!list.length) return null;
  const cur = pageActiveOf(active, features);
  const i = cur === null ? -1 : list.indexOf(cur);
  return i + 1 < list.length ? list[i + 1] : null;
}
var focusLeavesPage = (prev, now) => prev !== null && prev !== now;

// src/shared/browser/panel.js
var bigWindow = (terminal) => ({
  mod: "dock-browser",
  kind: "window",
  key: "dock-browser-big",
  width: 0.8,
  height: 0.85,
  props: { big: true, ...terminal ? { terminal } : {} }
});
function parseBrowserShow(c) {
  const m = /^browser\.show\.([A-Za-z0-9_-]+)$/.exec(String(c ?? ""));
  if (!m) return null;
  const terminal = b64urlDecode(m[1]);
  return terminal ? { terminal } : null;
}

// src/shared/notify.js
var HISTORY_KEY = "dock.notify.history";
var CAP = 200;
var BODY_MAX = 2e3;
var cut = (s) => typeof s === "string" && s.length > BODY_MAX ? s.slice(0, BODY_MAX) + "\u2026" : s;
var isObj3 = (v) => v != null && typeof v === "object" && !Array.isArray(v);
var str = (v) => typeof v === "string" ? v : null;
function actionOf(a) {
  if (!isObj3(a) || typeof a.name !== "string") return null;
  return a.args === void 0 ? { name: a.name } : { name: a.name, args: a.args };
}
function itemOf(x) {
  if (!isObj3(x) || typeof x.id !== "string") return null;
  const needs = isObj3(x.needs) && (x.needs.kind === "agent" && typeof x.needs.terminal === "string" || x.needs.kind === "pipeline" && typeof x.needs.worktree === "string") ? x.needs : null;
  return {
    id: x.id,
    at: Number.isFinite(x.at) ? x.at : 0,
    title: typeof x.title === "string" ? x.title : "",
    body: str(x.body),
    level: str(x.level),
    icon: str(x.icon),
    action: actionOf(x.action),
    read: x.read === true,
    needs,
    resolved: needs != null && x.resolved === true
  };
}
function historyOf(raw) {
  return Array.isArray(raw) ? raw.map(itemOf).filter(Boolean) : [];
}
function needsOf(n) {
  const name = isObj3(n) && isObj3(n.action) ? n.action.name : null;
  if (typeof name !== "string") return null;
  if (name.startsWith("dock-core.")) {
    const c = parseGitCommand(name.slice("dock-core.".length));
    return c?.cmd === "show" && typeof c.worktree === "string" ? { kind: "pipeline", worktree: c.worktree } : null;
  }
  const terminal = n.action.args?.terminal;
  if (name === "agent.focus" && n.level === "error" && typeof terminal === "string") return { kind: "agent", terminal };
  return null;
}
function addItem(list, n, now, id) {
  const p = isObj3(n) ? n : {};
  const out = [itemOf({ ...p, body: cut(p.body), id, at: now, read: false, needs: needsOf(p), resolved: false }), ...list];
  while (out.length > CAP) {
    const i = out.findLastIndex((x) => x.resolved);
    out.splice(i >= 0 ? i : out.length - 1, 1);
  }
  return out;
}
var clearItem = (list, id) => list.filter((x) => x.id !== id);
var clearAll = () => [];
var markAllRead = (list) => list.map((x) => x.read ? x : { ...x, read: true });
function isFixed(needs, agents2, gitState) {
  if (needs.kind === "agent") {
    if (!Array.isArray(agents2)) return false;
    const a = agents2.find((g) => g?.address === needs.terminal);
    return !a || a.status !== "blocked";
  }
  for (const r of gitState?.repos ?? []) {
    const w = (r?.worktrees ?? []).find((x) => x?.id === needs.worktree);
    if (w) {
      const status = w.pipeline?.status;
      return typeof status === "string" && status !== "unknown" && status !== "failed";
    }
  }
  return false;
}
function resolveItems(list, { agents: agents2, gitState } = {}) {
  let changed = false;
  const out = list.map((x) => {
    if (!x.needs || x.resolved || !isFixed(x.needs, agents2, gitState)) return x;
    changed = true;
    return { ...x, resolved: true };
  });
  return changed ? out : list;
}

// src/shared/notifycmd.js
var NOTIFY_DIALOG = { mod: "dock-notifications", kind: "dialog", width: 520, height: 0.7 };
var isObj4 = (v) => v != null && typeof v === "object" && !Array.isArray(v);
function parseNotifyCommand(c) {
  if (typeof c !== "string" || !c.startsWith("notify.")) return null;
  const rest = c.slice(7);
  if (rest === "clearall" || rest === "read" || rest === "show") return { cmd: rest };
  const m = /^(add|clear)\.([A-Za-z0-9_-]+)$/.exec(rest);
  if (!m) return null;
  const text = b64urlDecode(m[2]);
  if (text == null) return null;
  if (m[1] === "clear") return { cmd: "clear", id: text };
  let n;
  try {
    n = JSON.parse(text);
  } catch {
    return null;
  }
  return isObj4(n) ? { cmd: "add", n } : null;
}
function applyNotifyCommand(list, cmd, now, newId) {
  switch (cmd?.cmd) {
    case "add":
      return addItem(list, cmd.n, now, newId);
    case "clear":
      return clearItem(list, cmd.id);
    case "clearall":
      return clearAll();
    case "read":
      return markAllRead(list);
    default:
      return list;
  }
}

// src/shared/install.js
var isText = (v) => typeof v === "string" && v.trim() !== "";
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function modeOf(src) {
  if (!isObject(src)) return null;
  if (isText(src.repo) || isText(src.config)) return "clone";
  if (src.mode === "app") return "app";
  return null;
}
function installOf(src, home) {
  const mode = modeOf(src);
  if (mode === "app") {
    return { mode, configPath: `${home}/mods/dock-core/config.json`, repo: null, versionPath: `${home}/mods/dock-core/VERSION.json` };
  }
  if (mode !== "clone" || !isText(src.config)) return null;
  const configPath = slashPath(src.config);
  const repo = isText(src.repo) ? slashPath(src.repo) : configPath.split("/").slice(0, -2).join("/");
  return { mode, configPath, repo, versionPath: null };
}
function publishedUrl({ repo, branch }) {
  return `https://raw.githubusercontent.com/${repo}/${branch}/app/VERSION.json`;
}
function ghVersionArgs({ repo, branch }) {
  return ["api", `repos/${repo}/contents/app/VERSION.json?ref=${encodeURIComponent(branch)}`, "-H", "Accept: application/vnd.github.raw"];
}
function parseVersionJson(text) {
  let v;
  try {
    v = JSON.parse(text ?? "null");
  } catch {
    return null;
  }
  if (!isObject(v) || !isText(v.repo) || !isText(v.branch) || !isText(v.version)) return null;
  return {
    repo: v.repo.trim(),
    branch: v.branch.trim(),
    version: v.version.trim(),
    source: isText(v.source) ? v.source.trim() : null,
    mods: Array.isArray(v.mods) ? v.mods.filter(isText) : []
  };
}
function fixHint(mode) {
  if (mode === "app") return "reinstall herdr-dock from its app/ folder";
  if (mode === "clone") return "run npm run deploy";
  return "run npm run deploy (a clone install) or reinstall herdr-dock from its app/ folder";
}

// src/shared/platform.js
function hostnameCommand(platform) {
  return platform === "linux" ? { command: "uname", args: ["-n"] } : { command: "hostname", args: [] };
}
function openUrlCommand(platform, url) {
  if (platform === "windows") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "macos") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

// src/shared/system.js
var SAMPLE_KEY = "dock.system.sample";
var HERDR_KEY = "dock.system.herdr";
var CPU_WINDOW_MS = 250;
var SCRIPT = `
const os = require("os"), fs = require("fs"), cp = require("child_process");
const times = () => os.cpus().reduce((a, c) => {
  const t = c.times;
  a.total += t.user + t.nice + t.sys + t.idle + t.irq;
  a.idle += t.idle;
  return a;
}, { total: 0, idle: 0 });
const a = times();
setTimeout(() => {
  const b = times();
  const total = b.total - a.total;
  const cpu = total > 0 ? 100 * (1 - (b.idle - a.idle) / total) : 0;
  const mem = 100 * (1 - os.freemem() / os.totalmem());
  let diskFree = null;
  try {
    const root = process.platform === "win32" ? (process.env.SystemDrive || "C:") + "\\\\" : os.homedir();
    const s = fs.statfsSync(root);
    diskFree = 100 * s.bavail / s.blocks;
  } catch {}
  const out = { cpu, mem, diskFree, cores: os.cpus().length };
  if (process.platform === "darwin") {
    try { out.vm = cp.execFileSync("vm_stat", { encoding: "utf8", timeout: 2000 }); out.total = os.totalmem(); } catch {}
  }
  console.log(JSON.stringify(out));
}, ${CPU_WINDOW_MS});
`;
function sampleCommand() {
  return { command: "node", args: ["-e", SCRIPT] };
}
var pct = (n) => Math.min(100, Math.max(0, Math.round(n)));
function macUsedPercent(vmStat, totalBytes) {
  const text = String(vmStat ?? "");
  const size = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  if (!(size > 0) || !(totalBytes > 0)) return null;
  const pages = (label) => {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, "m").exec(text);
    return m ? Number(m[1]) : null;
  };
  const wired = pages("Pages wired down"), compressed = pages("Pages occupied by compressor");
  if (wired == null || compressed == null) return null;
  const anon = pages("Anonymous pages"), purgeable = pages("Pages purgeable") ?? 0, active = pages("Pages active");
  const app = anon != null ? Math.max(0, anon - purgeable) : active;
  if (app == null) return null;
  return pct(100 * (app + wired + compressed) * size / totalBytes);
}
function parseSample(stdout, now) {
  let o;
  try {
    o = JSON.parse(String(stdout ?? "").trim().split(/\r?\n/).pop());
  } catch {
    return null;
  }
  if (!o || typeof o.cpu !== "number" || typeof o.mem !== "number" || !Number.isFinite(o.cpu + o.mem)) return null;
  const d = typeof o.diskFree === "number" && Number.isFinite(o.diskFree) ? pct(o.diskFree) : null;
  const cores = Number.isInteger(o.cores) && o.cores > 0 ? o.cores : null;
  const mac = typeof o.vm === "string" ? macUsedPercent(o.vm, o.total) : null;
  return { cpu: pct(o.cpu), mem: mac ?? pct(o.mem), diskFree: d, cores, at: now };
}
function herdrSampleCommand(platform) {
  if (platform === "windows") {
    const ps = "Get-Process -Name herdr* -ErrorAction SilentlyContinue | ForEach-Object { '{0},{1},{2},{3}' -f $_.ProcessName,$_.Id,[int64]$_.WorkingSet64,[int64]$_.TotalProcessorTime.TotalMilliseconds }";
    return { command: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", ps] };
  }
  return { command: "ps", args: ["-axo", "pid=,rss=,time=,command="] };
}
function psTimeMs(t) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  return Math.round((((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1e3);
}
function parseHerdrProcs(platform, stdout) {
  let cpuMs = 0, mem = 0, n = 0;
  for (const line of String(stdout ?? "").split("\n")) {
    if (platform === "windows") {
      const p = line.trim().split(",");
      if (p.length !== 4 || !/^herdr/i.test(p[0])) continue;
      const [ws, ms] = [Number(p[2]), Number(p[3])];
      if (!Number.isFinite(ws) || !Number.isFinite(ms) || p[2] === "" || p[3] === "") continue;
      mem += ws;
      cpuMs += ms;
      n++;
    } else {
      const m = /^\s*\d+\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!m) continue;
      const exe = m[3].split(/\s/)[0].split("/").pop();
      const ms = psTimeMs(m[2]);
      if (!/^herdr/i.test(exe) || ms === null) continue;
      mem += Number(m[1]) * 1024;
      cpuMs += ms;
      n++;
    }
  }
  return n ? { cpuMs, mem } : null;
}
function herdrUsage(prev, cur, elapsedMs, cores, now) {
  if (!prev || !(elapsedMs > 0) || !(cores > 0)) return { cpu: null, mem: cur.mem, at: now };
  return { cpu: Math.round(Math.min(100, Math.max(0, 100 * (cur.cpuMs - prev.cpuMs) / (elapsedMs * cores))) * 10) / 10, mem: cur.mem, at: now };
}

// src/shared/update.js
var UPDATE_KEY = "dock.update.state";
var NOTIFIED_KEY = "dock.update.notified";
var RESULT_REL = "herdr-dock/update-result.json";
var TIMEOUT_MS = 10 * 60 * 1e3;
var CHECK_EVERY_MS = 6 * 60 * 60 * 1e3;
var FETCH_TIMEOUT_MS = 3e4;
var OPEN_DIALOG = { name: "mod.open", args: { name: "dock-config" } };
var firstLine2 = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l) ?? "";
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function blockReason({ branch, ahead, behind, dirty }) {
  if (branch === "HEAD") return "detached HEAD";
  if (branch !== "main") return `on branch ${branch}`;
  if (ahead > 0) return plural(ahead, "local commit");
  if (dirty && behind > 0) return "local changes in the repo";
  return null;
}
function updateState({ fetchOk, fetchError, branch, ahead, behind, latest, subject, current, dirty, deployed }, now, prev = null) {
  const common = { current: current ?? prev?.current ?? null, deployed: deployed ?? prev?.deployed ?? null, checkedAt: now, startedAt: null };
  if (!fetchOk) {
    return {
      status: "failed",
      latest: prev?.latest ?? null,
      behind: prev?.behind ?? null,
      subject: prev?.subject ?? null,
      ...common,
      reason: `Can't check: ${firstLine2(fetchError) || "git fetch failed"}`
    };
  }
  const s = { status: "idle", ...common, latest: latest ?? null, behind: behind ?? 0, subject: subject ?? null, reason: null };
  const redeploy = s.behind === 0 && !!s.deployed && !!s.current && s.deployed !== s.current;
  const reason = blockReason({ branch, ahead: ahead ?? 0, behind: redeploy ? 1 : s.behind, dirty: !!dirty });
  if (reason) return { ...s, status: "blocked", reason };
  if (s.behind > 0) return { ...s, status: "available" };
  if (redeploy) return { ...s, status: "available", redeploy: true };
  if (prev?.status === "updated" && prev.current && prev.current === s.current) {
    return { ...s, status: "updated", commits: prev.commits ?? null };
  }
  return s;
}
function appUpdateState({ fetchOk, fetchError, installed, published }, now, prev = null) {
  const common = { mode: "app", checkedAt: now, startedAt: null, behind: null, subject: null };
  if (!fetchOk) {
    return {
      ...common,
      status: "failed",
      current: installed?.source ?? prev?.current ?? null,
      latest: prev?.latest ?? null,
      version: prev?.version ?? null,
      reason: `Can't check: ${firstLine2(fetchError) || "fetch failed"}`
    };
  }
  const s = { ...common, status: "idle", current: installed?.source ?? null, latest: published?.source ?? null, version: published?.version ?? null, reason: null };
  if (published?.version !== installed?.version) return { ...s, status: "available" };
  if (prev?.mode === "app" && prev.status === "updated" && prev.version === s.version) {
    return { ...s, status: "updated", commits: prev.commits ?? null };
  }
  return s;
}
function shouldNotify(state, notifiedSha) {
  if (state?.mode === "app") return state.status === "available" && !!state.version && state.version !== notifiedSha;
  return state?.status === "available" && !state.redeploy && !!state.latest && state.latest !== notifiedSha;
}
function availableNote(state) {
  const body = state?.mode === "app" ? `${state.current ?? "?"} \u2192 ${state.latest ?? "?"}` : plural(state.behind, "new commit");
  return { title: "herdr-dock update available", body, level: "info", action: OPEN_DIALOG };
}
function resultToState(result, prev, _now) {
  if (result == null || typeof result !== "object" || Array.isArray(result)) return null;
  const p = prev && typeof prev === "object" ? prev : {};
  const fromResult = result.commits === null ? "app" : typeof result.commits === "number" ? "clone" : null;
  const mode = prev && typeof prev === "object" ? p.mode : fromResult;
  const app = mode === "app" ? { mode: "app", version: p.version ?? null } : mode ? { mode } : {};
  const s = {
    ...app,
    status: "idle",
    current: p.current ?? null,
    deployed: p.deployed ?? null,
    latest: p.latest ?? null,
    behind: p.behind ?? null,
    subject: p.subject ?? null,
    checkedAt: p.checkedAt ?? null,
    reason: null,
    startedAt: null
  };
  if (result.ok) {
    const to = result.to ?? p.latest ?? null;
    return { ...s, status: "updated", current: to, deployed: to, latest: to, behind: 0, commits: result.commits ?? null };
  }
  return { ...s, status: "failed", reason: firstLine2(result.reason) || "unknown error" };
}
function resultNote(result) {
  if (result?.ok) {
    const body = typeof result.commits === "number" || result.commits === void 0 ? plural(result.commits ?? 0, "commit") : `${result.from ?? "?"} \u2192 ${result.to ?? "?"}`;
    return { title: `herdr-dock updated to ${result.to}`, body, level: "success", action: OPEN_DIALOG };
  }
  return { title: "herdr-dock update failed", body: firstLine2(result?.reason) || "unknown error", level: "error", action: OPEN_DIALOG };
}
function startState(prev, now) {
  return { ...prev && typeof prev === "object" ? prev : {}, status: "updating", reason: null, startedAt: now };
}
function timedOut(state, now) {
  if (state?.status !== "updating" || typeof state.startedAt !== "number") return null;
  if (now - state.startedAt < TIMEOUT_MS) return null;
  return { ...state, status: "failed", reason: "no result (was the update tab closed?)", startedAt: null };
}
function parseUpdateCommand(c) {
  if (c === "update.check") return { cmd: "check" };
  if (c === "update.start") return { cmd: "start" };
  return null;
}

// src/mods/dock-core/main.js
var MODES = ["expanded", "icons", "hidden"];
var MODE_KEY = "dock.left.mode";
var FOCUS_KEY = "dock.left.focus";
var ERROR_KEY = "dock.config.error";
var HOST_KEY = "dock.host";
var PATH_KEY = "dock.config.path";
var LOCAL_PATH_KEY = "dock.config.localPath";
var REPO_KEY = "dock.config.repo";
var APPLIED_KEY = "dock.config.applied";
var RESTORE_KEY = "dock.left.restore";
var CONFIG_MODE_KEY = "dock.left.configMode";
var SIZES_KEY = "dock.left.appliedSizes";
var RIGHT_KEY = "dock.right.shown";
var ACTIVE_KEY = "dock.right.active";
var RIGHT_CONFIG_KEY = "dock.right.configHidden";
var RELOAD_SETTLE_MS = 400;
var POLL_MS = 3e3;
var EMPTY_WATCH_MS = 1e3;
var TICK_MS = 1e3;
var AGENT_GRACE_MS = 3e4;
var SAMPLE_MS = 5e3;
var SAMPLE_TIMEOUT_MS = 4e3;
var HERDR_MS = 1e4;
var HERDR_TIMEOUT_MS = 5e3;
var RESULT_EVERY_TICKS = 5;
var isTop = () => props()?.dockRegion === "top";
var DockCore = class extends View {
  init(_props, cx) {
    this.merged = null;
    this.applied = null;
    this.changes = null;
    this.host = "";
    this.hostError = null;
    this.configPath = null;
    this.localPath = null;
    this.layoutPath = null;
    this.installMode = null;
    this.repo = null;
    this.versionPath = null;
    this.resultPath = null;
    this.updateBusy = false;
    this.consuming = false;
    this.sourcePath = null;
    this.updateTicks = 0;
    this.collector = null;
    this.notifySeq = 0;
    this.startedAt = Date.now();
    if (checking() || !isTop()) return;
    cx.spawn(async (cx2) => this.start(cx2));
    this.startCollector(cx);
    this.startSampler(cx);
    this.startHerdrSampler(cx);
    cx.spawn(async (cx2) => {
      for (; ; ) {
        const c = await nextCommand();
        try {
          this.command(c, cx2);
        } catch (e) {
          console.log(`dock-core: command ${c} failed: ${e?.message ?? e}`);
        }
        cx2.notify();
      }
    });
  }
  async start(cx) {
    const home = slashPath(appHome());
    this.layoutPath = `${home}/layouts/herdr-dock.json`;
    let src = null;
    try {
      src = JSON.parse(await readTextFile(`${home}/mods/dock-core/source.json`) ?? "null");
    } catch {
      src = null;
    }
    const install = installOf(src, home);
    if (!install) {
      setShared(ERROR_KEY, `mods/dock-core/source.json is missing or unreadable: ${fixHint(modeOf(src))}`);
      cx.notify();
      return;
    }
    this.installMode = install.mode;
    this.configPath = install.configPath;
    setShared(PATH_KEY, this.configPath);
    try {
      const { command, args } = hostnameCommand(window()?.platform);
      this.host = (await exec(command, args)).stdout.trim().toLowerCase();
    } catch (e) {
      console.log(`dock-core: hostname failed, using source.json: ${e}`);
    }
    if (!this.host && typeof src?.hostname === "string" && src.hostname.trim()) this.host = src.hostname.trim().toLowerCase();
    setShared(HOST_KEY, this.host || null);
    if (!this.host) {
      this.hostError = "could not read this computer's hostname: machines sections are ignored" + (install.mode === "clone" ? " (re-run npm run deploy)" : "");
    }
    this.localPath = `${home}/${LOCAL_REL}`;
    setShared(LOCAL_PATH_KEY, this.localPath);
    const localDir = this.localPath.slice(0, this.localPath.lastIndexOf("/"));
    await this.ensureFolder(localDir);
    if (install.mode === "clone") await this.migrate(install.repo);
    await this.reload(cx);
    if (install.mode === "clone") {
      this.repo = install.repo;
      setShared(REPO_KEY, install.repo);
    } else {
      this.versionPath = install.versionPath;
      if ((shared(REPO_KEY) ?? null) !== null) setShared(REPO_KEY, null);
    }
    this.resultPath = `${home}/${RESULT_REL}`;
    this.sourcePath = `${home}/mods/dock-core/source.json`;
    await this.consumeResult(cx);
    cx.spawn(async (cx2) => {
      for (; ; ) {
        await this.checkUpdate(cx2);
        await cx2.sleep(CHECK_EVERY_MS);
      }
    });
    cx.spawn(async (cx2) => this.watch(localDir, cx2, () => this.consumeResult(cx2)));
    if (install.mode === "clone") await this.watch(this.configPath.slice(0, this.configPath.lastIndexOf("/")) || "/", cx);
  }
  // The one-time move of machines.<host> from config/dock.json to the local file (deploy does the
  // same; whichever runs first wins, the other finds the local file and does nothing).
  async migrate(repo) {
    if (!this.host) return;
    const rel = this.configPath.startsWith(`${repo}/`) ? this.configPath.slice(repo.length + 1) : null;
    try {
      const moved = await migrateLocal({
        configPath: this.configPath,
        localPath: this.localPath,
        host: this.host,
        read: (path) => readTextFile(path).catch(() => null),
        write: (path, text, expected) => writeTextFile(path, text, expected),
        headText: async () => {
          if (!rel) return void 0;
          const r = await exec("git", ["show", `HEAD:${rel}`], { cwd: repo });
          return r.code === 0 ? r.stdout : void 0;
        }
      });
      if (moved) console.log(`dock-core: moved machines.${this.host} to ${this.localPath}`);
    } catch (e) {
      console.log(`dock-core: local file migration failed: ${e?.message ?? e}`);
    }
  }
  // Creates a folder (with a .keep file) so it can be watched before anything is saved in it.
  async ensureFolder(dir) {
    const keep = `${dir}/.keep`;
    try {
      if (await readTextFile(keep).catch(() => null) !== null) return;
      try {
        await writeTextFile(keep, "", null);
      } catch {
        await exec("node", ["-e", "require('fs').mkdirSync(process.argv[1], { recursive: true })", dir]);
        await writeTextFile(keep, "", null);
      }
    } catch (e) {
      console.log(`dock-core: could not create ${dir}: ${e?.message ?? e}`);
    }
  }
  // Reloads whenever something in dir changes (the config's folder and the local file's folder), then runs
  // after (the local folder also receives the update script's result file).
  async watch(dir, cx, after = null) {
    for (; ; ) {
      try {
        const changed = await watchFolder(dir);
        if (!changed?.length) {
          await cx.sleep(EMPTY_WATCH_MS);
          continue;
        }
      } catch (e) {
        console.log(`dock-core: watch of ${dir} failed, polling: ${e}`);
        await cx.sleep(POLL_MS);
      }
      await this.reload(cx);
      if (after) await after();
    }
  }
  // One update check: clone mode fetches main (30 s) and compares; app mode compares the installed VERSION.json
  // with the published one. Publishes UPDATE_KEY (with mode) and notifies once per new upstream sha (app mode: per
  // new published version). Never leaves the state on "checking"; never overwrites an update in progress.
  async checkUpdate(cx) {
    if (!(this.installMode === "app" ? this.versionPath : this.repo) || this.updateBusy) return;
    const prev = shared(UPDATE_KEY) ?? null;
    if (prev?.status === "updating") return;
    this.updateBusy = true;
    setShared(UPDATE_KEY, { ...prev ?? {}, mode: this.installMode, status: "checking" });
    cx.notify();
    let next;
    try {
      next = this.installMode === "app" ? appUpdateState(await this.appUpdateInfo(cx), Date.now(), prev) : { mode: "clone", ...updateState({ ...await this.gitUpdateInfo(), deployed: await this.deployedCommit() }, Date.now(), prev) };
    } catch (e) {
      next = this.installMode === "app" ? appUpdateState({ fetchOk: false, fetchError: e?.message ?? String(e) }, Date.now(), prev) : { mode: "clone", ...updateState({ fetchOk: false, fetchError: e?.message ?? String(e) }, Date.now(), prev) };
    } finally {
      this.updateBusy = false;
    }
    if ((shared(UPDATE_KEY) ?? null)?.status !== "checking") return;
    setShared(UPDATE_KEY, next);
    if (shouldNotify(next, shared(NOTIFIED_KEY) ?? null)) {
      try {
        notify(availableNote(next));
      } catch (e) {
        console.log(`dock-core: update notify failed: ${e?.message ?? e}`);
      }
      setShared(NOTIFIED_KEY, next.mode === "app" ? next.version : next.latest);
    }
    cx.notify();
  }
  // What appUpdateState needs: the installed mods/dock-core/VERSION.json and the published app/VERSION.json, a plain
  // download first, then gh api (the repo may be private), each bounded by FETCH_TIMEOUT_MS.
  async appUpdateInfo(cx) {
    const installed = parseVersionJson(await readTextFile(this.versionPath).catch(() => null));
    if (!installed) return { fetchOk: false, fetchError: "mods/dock-core/VERSION.json is missing or unreadable" };
    const bounded = (p) => {
      const timer = cx.sleep(FETCH_TIMEOUT_MS).then(() => {
        throw new Error(`timed out after ${FETCH_TIMEOUT_MS / 1e3} s`);
      });
      timer.catch(() => {
      });
      return Promise.race([p, timer]);
    };
    let published = null;
    let why = null;
    try {
      const r = await bounded(globalThis.fetch(publishedUrl(installed), { headers: { "User-Agent": "herdr-dock" } }));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      published = parseVersionJson(await bounded(r.text()));
      if (!published) throw new Error("not a VERSION.json");
    } catch (e) {
      why = `download: ${e?.message ?? e}`;
    }
    if (!published) {
      try {
        const r = await bounded(exec("gh", ghVersionArgs(installed), { timeout: FETCH_TIMEOUT_MS }));
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim());
        published = parseVersionJson(r.stdout);
        if (!published) throw new Error("not a VERSION.json");
      } catch (e) {
        const first = String(e?.message ?? e).split(/\r?\n/)[0];
        return { fetchOk: false, fetchError: `${first} (${why})`, installed };
      }
    }
    return { fetchOk: true, installed, published };
  }
  // The commit the last deploy recorded in source.json (re-read each check), or null.
  async deployedCommit() {
    try {
      const src = JSON.parse(await readTextFile(this.sourcePath) ?? "null");
      return typeof src?.commit === "string" && src.commit.trim() ? src.commit.trim() : null;
    } catch {
      return null;
    }
  }
  // What updateState needs, from git in the repo. A failed fetch returns fetchOk false; any other failed git
  // command throws (shown as a failed check).
  async gitUpdateInfo() {
    const git = (args, timeout) => exec("git", args, { cwd: this.repo, ...timeout ? { timeout } : {} });
    let current = null;
    try {
      const r = await git(["rev-parse", "--short", "HEAD"]);
      if (r.code === 0) current = r.stdout.trim();
    } catch {
    }
    let fetch;
    try {
      fetch = await git(["-c", "credential.interactive=never", "fetch", "--quiet", "origin", "main"], FETCH_TIMEOUT_MS);
    } catch (e) {
      return { fetchOk: false, fetchError: e?.message ?? String(e), current };
    }
    if (fetch.code !== 0) return { fetchOk: false, fetchError: fetch.stderr || fetch.stdout, current };
    const out = async (args) => {
      const r = await git(args);
      if (r.code !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || r.stdout || "").trim()}`);
      return r.stdout;
    };
    const [behind, log, status, branch, ahead] = await Promise.all([
      out(["rev-list", "--count", "HEAD..origin/main"]),
      out(["log", "-1", "--format=%h%x09%s", "origin/main"]),
      out(["status", "--porcelain"]),
      out(["rev-parse", "--abbrev-ref", "HEAD"]),
      out(["rev-list", "--count", "origin/main..HEAD"])
    ]);
    const line = log.replace(/\r?\n$/, "");
    const tab = line.indexOf("	");
    return {
      fetchOk: true,
      current,
      branch: branch.trim(),
      behind: Number(behind.trim()) || 0,
      ahead: Number(ahead.trim()) || 0,
      latest: (tab < 0 ? line : line.slice(0, tab)).trim() || null,
      subject: tab < 0 ? null : line.slice(tab + 1),
      dirty: status.trim() !== ""
    };
  }
  // Applies and deletes the update script's result file, if there is one.
  async consumeResult(cx) {
    if (!this.resultPath || this.consuming) return;
    this.consuming = true;
    try {
      const text = await readTextFile(this.resultPath).catch(() => null);
      if (text == null || text.trim() === "") return;
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        result = void 0;
      }
      const next = resultToState(result, shared(UPDATE_KEY) ?? null, Date.now());
      if (!next) {
        console.log("dock-core: update-result.json is not a result yet");
        return;
      }
      await exec("node", ["-e", "require('fs').rmSync(process.argv[1], { force: true })", this.resultPath]).catch((e) => console.log(`dock-core: could not delete ${this.resultPath}: ${e?.message ?? e}`));
      setShared(UPDATE_KEY, next);
      try {
        notify(resultNote(result));
      } catch (e) {
        console.log(`dock-core: update notify failed: ${e?.message ?? e}`);
      }
      cx.notify();
    } catch (e) {
      console.log(`dock-core: update result failed: ${e?.message ?? e}`);
    } finally {
      this.consuming = false;
    }
  }
  // Each tick while "updating": every RESULT_EVERY_TICKS ticks, look for the result file (the folder watch
  // can miss one written before it started), and once more right before an update with no result for
  // 10 minutes becomes a failure.
  updateTick(cx) {
    const state = shared(UPDATE_KEY) ?? null;
    if (state?.status !== "updating") {
      this.updateTicks = 0;
      return;
    }
    this.updateTicks = (this.updateTicks + 1) % RESULT_EVERY_TICKS;
    const late = timedOut(state, Date.now());
    if (!late && this.updateTicks !== 0) return;
    cx.spawn(async (cx2) => {
      await this.consumeResult(cx2);
      if (!late) return;
      const next = timedOut(shared(UPDATE_KEY) ?? null, Date.now());
      if (!next) return;
      setShared(UPDATE_KEY, next);
      try {
        notify({ title: "herdr-dock update failed", body: next.reason, level: "error", action: OPEN_DIALOG });
      } catch (e) {
        console.log(`dock-core: update notify failed: ${e?.message ?? e}`);
      }
      cx2.notify();
    });
  }
  // An update.* command: check now, or the dialog opening the update tab. Returns false when c isn't one.
  updateCommand(c, cx) {
    const u = parseUpdateCommand(c);
    if (!u) return false;
    if (u.cmd === "check") cx.spawn(async (cx2) => this.checkUpdate(cx2));
    else setShared(UPDATE_KEY, startState(shared(UPDATE_KEY) ?? null, Date.now()));
    return true;
  }
  // The git/CI collector runs here, in the one top copy: it publishes dock.git.* for dock-git and
  // dock-pipelines. Ticks are not awaited: a tick waits on its CI requests, and the next tick is what times
  // them out (the collector's busy flags keep overlapping ticks from repeating work).
  startCollector(cx) {
    const platform = window()?.platform;
    this.platform = platform;
    try {
      this.collector = createCollector({
        exec,
        fetch: (url, init) => globalThis.fetch(url, init),
        panes,
        spaces,
        shared,
        setShared,
        notify,
        playSound,
        platform,
        now: Date.now,
        log: (m) => console.log(`dock-core: ${m}`)
      });
    } catch (e) {
      this.collector = null;
      console.log(`dock-core: git collector failed to start: ${e?.message ?? e}`);
    }
    cx.spawn(async (cx2) => {
      for (; ; ) {
        this.collector?.tick().catch((e) => console.log(`dock-core: git tick failed: ${e?.message ?? e}`));
        try {
          this.resolveNotify();
        } catch (e) {
          console.log(`dock-core: notify resolve failed: ${e?.message ?? e}`);
        }
        try {
          this.updateTick(cx2);
        } catch (e) {
          console.log(`dock-core: update tick failed: ${e?.message ?? e}`);
        }
        await cx2.sleep(TICK_MS);
      }
    });
  }
  // The system sampler: one node child every SAMPLE_MS publishes dock.system.sample. A failure is
  // logged once, then again only after a success, so a missing node does not flood the log.
  startSampler(cx) {
    let failed = false;
    cx.spawn(async (cx2) => {
      for (; ; ) {
        try {
          const { command, args } = sampleCommand();
          const { stdout } = await exec(command, args, { timeout: SAMPLE_TIMEOUT_MS });
          const sample = parseSample(stdout, Date.now());
          if (!sample) throw new Error("unreadable sample output");
          setShared(SAMPLE_KEY, sample);
          failed = false;
        } catch (e) {
          if (!failed) console.log(`dock-core: system sample failed: ${e?.message ?? e}`);
          failed = true;
        }
        await cx2.sleep(SAMPLE_MS);
      }
    });
  }
  // Herdr's own CPU % (of the whole machine, over the time between samples) and memory, published as
  // dock.system.herdr every HERDR_MS. The first sample has no cpu. Failures are logged once, like the system sampler.
  startHerdrSampler(cx) {
    let failed = false;
    let prev = null;
    cx.spawn(async (cx2) => {
      for (; ; ) {
        try {
          const platform = window()?.platform;
          const { command, args } = herdrSampleCommand(platform);
          const { stdout } = await exec(command, args, { timeout: HERDR_TIMEOUT_MS });
          const t = Date.now();
          const cur = parseHerdrProcs(platform, stdout);
          if (!cur) throw new Error("no herdr process in the output");
          const cores = shared(SAMPLE_KEY)?.cores;
          setShared(HERDR_KEY, herdrUsage(prev, cur, prev ? t - prev.t : 0, cores, t));
          prev = { ...cur, t };
          failed = false;
        } catch (e) {
          prev = null;
          if (!failed) console.log(`dock-core: herdr sample failed: ${e?.message ?? e}`);
          failed = true;
        }
        await cx2.sleep(HERDR_MS);
      }
    });
  }
  // A git.* command (see src/mods/_git-command.js). Returns false when c isn't one.
  gitCommand(c) {
    const g = parseGitCommand(c);
    if (!g) return false;
    const col = this.collector;
    if (!col) return true;
    const fail = (what) => (e) => console.log(`dock-core: git.${what} failed: ${e?.message ?? e}`);
    const open = (url) => {
      if (!url) return;
      const { command, args } = openUrlCommand(this.platform, url);
      exec(command, args).catch(fail("open"));
    };
    if (g.cmd === "refresh") col.refresh();
    else if (g.cmd === "retry") col.retry().catch(fail("retry"));
    else if (g.cmd === "open") open(col.urlFor("pipeline"));
    else if (g.cmd === "open.job") open(col.urlFor({ job: g.index }));
    else if (g.cmd === "select") col.select(g.worktree).catch(fail("select"));
    else if (g.cmd === "delete") col.deleteWorktree(g.worktree).catch(fail("delete"));
    else if (g.cmd === "show") {
      const worktree = g.worktree ?? shared("dock.git.selected") ?? null;
      if (worktree) col.select(worktree).catch(fail("select"));
      this.reveal(showPlan(this.merged), fail("show"));
    }
    return true;
  }
  // Applies a revealPlan: the right panel's shared keys, else the dialog.
  reveal(plan, fail) {
    if (plan.set) for (const [k, v] of Object.entries(plan.set)) setShared(k, v);
    else {
      try {
        openOverlay(plan.overlay);
      } catch (e) {
        fail(e);
      }
    }
  }
  // A notify.* command (see src/mods/_notify-command.js): dock-core is the one writer of the history.
  // Returns false when c isn't one.
  notifyCommand(c) {
    const cmd = parseNotifyCommand(c);
    if (!cmd) return false;
    const history = historyOf(shared(HISTORY_KEY));
    if (cmd.cmd === "show") {
      if (history.some((x) => !x.read)) setShared(HISTORY_KEY, markAllRead(history));
      this.reveal(
        revealPlan(this.merged, "dock-notifications", NOTIFY_DIALOG),
        (e) => console.log(`dock-core: notify.show failed: ${e?.message ?? e}`)
      );
      return true;
    }
    const id = `${Date.now().toString(36)}-${(this.notifySeq++).toString(36)}`;
    setShared(HISTORY_KEY, applyNotifyCommand(history, cmd, Date.now(), id));
    return true;
  }
  // browser.show.<terminal> (a handoff's notification): the agent's terminal in front, so the Browser panel follows
  // it, and the panel shown (the right column, else the big window on that terminal). Returns false when c isn't one.
  browserCommand(c) {
    const b = parseBrowserShow(c);
    if (!b) return false;
    try {
      run("agent.focus", { terminal: b.terminal });
    } catch (e) {
      console.log(`dock-core: agent.focus failed: ${e?.message ?? e}`);
    }
    this.reveal(
      revealPlan(this.merged, "dock-browser", bigWindow(b.terminal)),
      (e) => console.log(`dock-core: browser.show failed: ${e?.message ?? e}`)
    );
    return true;
  }
  // Each tick: mark needs-you items whose cause is fixed, writing the history only when one changed.
  resolveNotify() {
    const history = historyOf(shared(HISTORY_KEY));
    if (!history.length) return;
    let list;
    if (Date.now() - this.startedAt >= AGENT_GRACE_MS) {
      try {
        list = agents();
      } catch {
        list = void 0;
      }
    }
    const next = resolveItems(history, { agents: list, gitState: shared("dock.git.state") });
    if (next !== history) setShared(HISTORY_KEY, next);
  }
  // Re-read the config; write the layout only when it changed and the config is valid.
  async reload(cx) {
    if (!this.configPath || checking()) return;
    const configText = await readTextFile(this.configPath).catch(() => null);
    const localText = this.localPath ? await readTextFile(this.localPath).catch(() => null) : null;
    const current = await readTextFile(this.layoutPath).catch(() => null);
    let plan = planApply(configText, this.host, current, this.merged, {}, localText);
    if (!plan.error && plan.merged) {
      const active = shared(ACTIVE_KEY);
      const u = rightConfigUpdate({
        prev: this.merged,
        merged: plan.merged,
        saved: { shown: shared(RIGHT_KEY), active, configHidden: shared(RIGHT_CONFIG_KEY) }
      });
      for (const [key, value] of Object.entries(u.set)) setShared(key, value);
      plan = planApply(configText, this.host, current, this.merged, { ...u.state, page: shared(PAGE_KEY) ?? void 0 }, localText);
    }
    const error = plan.error ?? this.hostError;
    if ((shared(ERROR_KEY) ?? null) !== error) setShared(ERROR_KEY, error);
    const before = this.merged ?? shared(SIZES_KEY) ?? null;
    const changes = plan.error ? null : sizeChanges(before, plan.merged);
    this.merged = plan.merged;
    if (!plan.error && plan.merged) {
      const snap = sizesSnapshot(plan.merged);
      if (JSON.stringify(shared(SIZES_KEY) ?? null) !== JSON.stringify(snap)) setShared(SIZES_KEY, snap);
      const regions = JSON.parse(JSON.stringify(plan.merged.regions));
      regions.left.hidden = false;
      if (JSON.stringify(shared(APPLIED_KEY) ?? null) !== JSON.stringify(regions)) setShared(APPLIED_KEY, regions);
      const m = modeFromConfig(shared(CONFIG_MODE_KEY), shared(MODE_KEY), plan.merged.regions.left.mode);
      if (m) {
        setShared(CONFIG_MODE_KEY, m.record);
        if (m.mode) {
          if ((shared(FOCUS_KEY) ?? null) !== null) setShared(FOCUS_KEY, null);
          setShared(MODE_KEY, m.mode);
        }
      }
    }
    if (plan.write) {
      const err = await this.writeLayout(plan.write, current);
      if (err) setShared(ERROR_KEY, err);
      await cx.sleep(RELOAD_SETTLE_MS);
      this.applied = null;
    }
    if (changes) {
      this.changes = changes;
      this.applied = null;
    }
    cx.notify();
  }
  // writeTextFile rejects when the file changed since `current` was read (a stale snapshot):
  // re-read it and try once more. Returns an error message, or null when written.
  async writeLayout(text, current) {
    try {
      await writeTextFile(this.layoutPath, text, current);
      return null;
    } catch (first) {
      console.log(`dock-core: layout write failed, retrying: ${first}`);
      try {
        const fresh = await readTextFile(this.layoutPath).catch(() => null);
        if (fresh !== text) await writeTextFile(this.layoutPath, text, fresh);
        return null;
      } catch (e) {
        return `could not write layout: ${e}`;
      }
    }
  }
  rightShown() {
    return rightShownOf(shared(RIGHT_KEY), this.merged?.regions);
  }
  mode() {
    const m = shared(MODE_KEY);
    if (MODES.includes(m)) return m;
    return this.merged?.regions.left.mode ?? "expanded";
  }
  command(c, cx) {
    if (this.gitCommand(c)) return;
    if (this.notifyCommand(c)) return;
    if (this.browserCommand(c)) return;
    if (this.updateCommand(c, cx)) return;
    if (c === "reload") {
      cx.spawn(async (cx2) => this.reload(cx2));
      return;
    }
    if (c === "right") {
      setShared(RIGHT_KEY, !this.rightShown());
      return;
    }
    if (c === "page" || c === "terminals") {
      const next = c === "page" ? nextPage(shared(PAGE_KEY), this.merged?.regions.pages?.features) : null;
      if ((shared(PAGE_KEY) ?? null) !== next) setShared(PAGE_KEY, next);
      return;
    }
    if (c === "config") {
      run("mod.open", { name: "dock-config" });
      return;
    }
    const mode = c === "cycle" ? nextMode(this.mode(), shared(FOCUS_KEY) ?? null) : MODES.includes(c) ? c : null;
    if (!mode) return;
    if ((shared(FOCUS_KEY) ?? null) !== null) setShared(FOCUS_KEY, null);
    setShared(MODE_KEY, mode);
  }
  // Called from render: notice a mode or focus change (ours or a feature's) and apply it once.
  // The focus stays in shared state while the panel is expanded (features read it to collapse).
  sync(cx) {
    if (!this.merged) return;
    const mode = this.mode();
    const plan = planSync({
      mode,
      focus: shared(FOCUS_KEY) ?? null,
      leftIds: leftFeatureIds(this.merged),
      applied: this.applied
    });
    if (!plan) return;
    this.applied = plan.key;
    cx.spawn(async (_cx) => this.apply(plan.key, mode, plan.focus, plan.clearFocus));
  }
  // Called from render: keep the live right panel (shown, which mod) in line with this PC's state.
  syncRight(cx) {
    if (!this.merged) return;
    let live;
    try {
      live = liveRight(layout());
    } catch (e) {
      console.log(`dock-core: layout() failed: ${e}`);
      return;
    }
    const actions = planRight({
      shown: this.rightShown(),
      active: shared(ACTIVE_KEY),
      features: this.merged.regions.right.features,
      live
    });
    if (!actions.length) return;
    cx.spawn(async (_cx) => {
      for (const a of actions) {
        try {
          run(a.command, a.args);
        } catch (e) {
          console.log(`dock-core: ${a.command} failed: ${e}`);
        }
      }
    });
  }
  // Called from render: show this PC's page (or the terminal) in the work stack. Another space or tab
  // getting focus (a click, a key, a new tab) while a page shows brings the terminal back.
  syncPage(cx) {
    if (!this.merged) return;
    const features = this.merged.regions.pages?.features ?? [];
    if (!features.length) return;
    let where = null;
    try {
      const f = focused();
      where = f ? `${f.space}|${f.tab}` : null;
    } catch {
      where = null;
    }
    if (where !== null) {
      const leave = focusLeavesPage(this.focusKey ?? null, where);
      this.focusKey = where;
      if (leave && (shared(PAGE_KEY) ?? null) !== null) setShared(PAGE_KEY, null);
    }
    let live;
    try {
      live = liveWork(layout());
    } catch (e) {
      console.log(`dock-core: layout() failed: ${e}`);
      return;
    }
    const actions = planPage({ active: shared(PAGE_KEY), features, live });
    if (!actions.length) return;
    cx.spawn(async (_cx) => {
      for (const a of actions) {
        try {
          run(a.command, a.args);
        } catch (e) {
          console.log(`dock-core: ${a.command} failed: ${e}`);
        }
      }
    });
  }
  apply(key, mode, focus, clearFocus) {
    if (!this.merged || this.applied !== key) return;
    let live = null;
    try {
      live = liveSizes(layout(), this.merged);
    } catch (e) {
      console.log(`dock-core: layout() failed: ${e}`);
    }
    const restore = shared(RESTORE_KEY) ?? null;
    const plan = planPanel({ mode, focus, merged: this.merged, live, restore, changes: this.changes });
    this.changes = null;
    for (const a of plan.actions) {
      try {
        run(a.command, a.args);
      } catch (e) {
        console.log(`dock-core: ${a.command} failed: ${e}`);
      }
    }
    if (JSON.stringify(plan.restore) !== JSON.stringify(restore)) setShared(RESTORE_KEY, plan.restore);
    if (shared(MODE_KEY) !== mode) setShared(MODE_KEY, mode);
    if (clearFocus) setShared(FOCUS_KEY, null);
  }
  render(cx) {
    if (!isTop()) return div();
    this.sync(cx);
    this.syncRight(cx);
    this.syncPage(cx);
    const t = theme();
    const mode = this.mode();
    const err = shared(ERROR_KEY);
    const stop = (_e, cx2) => cx2.stop_propagation();
    return h_flex().size_full().items_center().justify_center().child(div().relative().size(28).flex_none().child(div().id("dock-toggle").size_full().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip(`Left panel: ${mode} (Ctrl+Alt+B)`).on_mouse_down("left", stop).on_click((_e, cx2) => {
      cx2.stop_propagation();
      this.command("cycle", cx2);
    }).child(svg(`mods/dock-core/panel-${mode}.svg`).size(16))).when(typeof err === "string" && err !== "", (el) => el.child(
      div().id("dock-error").absolute().top(-2).right(-2).size(10).flex().items_center().justify_center().tooltip(`Config error: ${err}`).on_mouse_down("left", stop).child(div().size(8).rounded_full().bg(t.ansi1 ?? "#e5484d"))
    )));
  }
};
export {
  DockCore as default
};
