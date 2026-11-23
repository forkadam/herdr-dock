// The git/CI collector: discovers repos and worktrees (added repos + terminals), polls git status, and
// publishes `dock.git.state`; polls each worktree's latest CI pipeline, raises failure alerts, and publishes
// the selected worktree's `dock.git.detail`. Host-independent: all I/O goes through the injected `io`, and
// there are no timers here — the host calls tick() every second and scheduling (and request timeouts)
// compare io.now() on each tick. The HTTP/CLI route lives in ci-client.js.
// (No Node built-ins: bundled into Herdr mods.)
import { parseWorktrees, parseStatus, parseRevParse, parseRemote, worktreeId } from "./git.js";
import { gitInterval, ciInterval, alertFor, alertKey, nextAlerted } from "./ci.js";
import { createCiClient } from "./ci-client.js";
import { limiter } from "./limiter.js";
import { gitCommandName } from "./gitcmd.js";
import { slashPath } from "./path.js";

const GIT_LIMIT = 4; // git processes at once
// How long a git call may take before it is given up (Herdr's own exec default). A call Herdr never answers would
// otherwise keep its GIT_LIMIT slot for good, and every later git call would wait behind it.
const GIT_TIMEOUT = 30000;
// Absolute paths (git >= 2.31): without it the common dir comes back relative to the -C folder.
const REV_PARSE = ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"];
const LIST_EVERY = 60000; // re-run `worktree list` for added repos
const REPOS_KEY = "dock.git.repos";
const SKIPPED_KEY = "dock.git.skipped";
const HIDDEN_KEY = "dock.git.hidden";
const STATE_KEY = "dock.git.state";
const SELECTED_KEY = "dock.git.selected";
const DETAIL_KEY = "dock.git.detail";
const ALERTED_KEY = "dock.git.alerted";

const basename = (p) => p.replace(/\/+$/, "").split("/").pop() || p;
const errText = (r) => String(r.stderr || r.stdout || `git exited ${r.code}`).trim().split(/\r?\n/)[0];
const repoName = (mainPath, machine) =>
  basename(mainPath).replace(/\.git$/, "") + (machine ? ` · ${machine}` : "");
// The main worktree of a repo known only by its common dir.
const mainFromCommonDir = (commonDir) => (commonDir.endsWith("/.git") ? commonDir.slice(0, -5) : commonDir);

export function createCollector(io) {
  const git = limiter(GIT_LIMIT);
  // Every log line passes through the client's redaction, so no token can reach io.log.
  const log = (msg) => { try { io.log?.(client.redact(msg)); } catch { /* logging never breaks a tick */ } };
  const client = createCiClient(io, log);
  const startedAt = io.now();

  // Remote paths are POSIX unless they look like a Windows drive path.
  const platformOf = (machine, path) =>
    machine == null ? io.platform : /^[A-Za-z]:\//.test(slashPath(path)) ? "windows" : "linux";
  const idOf = (machine, path) => worktreeId(machine, path, platformOf(machine, path));

  // Git calls running now, each { deadline, giveUp }: tick() gives up every one past its deadline (sweepGit).
  const gitCalls = new Set();

  // One git process via the limiter. A rejected exec (no git, machine unreachable) becomes code -1, and so does a
  // call with no answer after GIT_TIMEOUT (stderr "timeout"). Its deadline starts when it runs, not while it waits
  // for a slot, and giving up frees the slot.
  const run = (machine, args) =>
    git(() => {
      const call = { deadline: io.now() + GIT_TIMEOUT, giveUp: null };
      const given = new Promise((resolve) => {
        call.giveUp = () => resolve({ code: -1, stdout: "", stderr: "timeout" });
      });
      gitCalls.add(call);
      const ran = Promise.resolve()
        .then(() => io.exec("git", args, { on: machine ?? undefined, timeout: GIT_TIMEOUT }))
        .catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
      return Promise.race([ran, given]).finally(() => gitCalls.delete(call));
    });

  const sweepGit = (now) => {
    for (const call of gitCalls) if (now >= call.deadline) call.giveUp();
  };

  // --- internal state ---------------------------------------------------------------------------
  // Added repos, by `${machine}|${path}`: { machine, path, at, busy, done, error, commonDir, list }.
  const added = new Map();
  // Pane cwds, by `${machine}|${cwd}`: { busy, done, at, result: { top, commonDir } | null }. A cwd git couldn't
  // even run in (code -1: exec rejected, machine unreachable) isn't done: it retries on the git cadence (at).
  const cwds = new Map();
  // Per repo (by repo id): { origin: undefined (unread) | { host, path } | null (no origin), busy, tried }.
  const repoRecs = new Map();
  // Per worktree (by worktree id): { id, machine, path, gitAt, busy, git: parseStatus() | null, error,
  //   upstreamChangedAt, ci: { at, busy, done, host, path, provider, pipeline (full) | null, runIds, error,
  //   hint, hostFailure, target, prev } } (see newCi()).
  const wtRecs = new Map();
  let published = { repos: [], updatedAt: null };
  let publishedKey = null;
  let detailKey = null;
  let selected = io.shared(SELECTED_KEY) ?? null;
  // Ticks may overlap (a slow git status outlives the 1 s timer). Each tick takes a generation. The newest
  // membership (built and pruned by the tick numbered viewGen) is kept in currentView, and publishing always
  // reads currentView plus the current records, never a view captured earlier. A tick older than viewGen
  // doesn't publish at all: the newer tick that rebuilt membership (or the next one) does.
  let tickGen = 0;
  let viewGen = 0;
  let currentView = new Map();

  const readAdded = () => {
    const list = io.shared(REPOS_KEY);
    return (Array.isArray(list) ? list : [])
      .filter((r) => r && typeof r.path === "string" && r.path)
      .map((r) => ({ path: slashPath(r.path), machine: r.machine ?? null }));
  };

  const readPanes = () => {
    const spaces = io.spaces() ?? [];
    return (io.panes() ?? [])
      .filter((p) => p && typeof p.cwd === "string" && p.cwd) // mod panes have cwd: null
      .map((p) => {
        const sp = spaces.find((s) => (s.tabs ?? []).some((t) => t.id === p.tab));
        return { cwd: p.cwd, machine: sp?.machine ?? null, space: sp?.id ?? null };
      });
  };

  // --- jobs -------------------------------------------------------------------------------------
  async function listAdded(e, now) {
    e.busy = true;
    try {
      const rp = await run(e.machine, ["-C", e.path, ...REV_PARSE]);
      if (rp.code !== 0) {
        Object.assign(e, { error: errText(rp), list: [] });
        return;
      }
      const { top, commonDir } = parseRevParse(rp.stdout, e.path);
      const wl = await run(e.machine, ["-C", top, "worktree", "list", "--porcelain"]);
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
      const r = await run(p.machine, ["-C", p.cwd, ...REV_PARSE]);
      e.result = r.code === 0 ? parseRevParse(r.stdout, p.cwd) : null;
      // Not a repo (git ran and said so) is cached; git not running at all is retried.
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
      const r = await run(machine, ["-C", path, "remote", "get-url", "origin"]);
      // Exit 2 is git's "no such remote": cache "no origin". Any other failure (exec rejected, machine
      // unreachable) leaves origin unread, to retry with the repo's next status poll.
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
      // --no-optional-locks: a background status must never take index.lock (it would break the user's own
      // git commit/add/rebase, on Windows especially).
      const r = await run(w.machine, ["--no-optional-locks", "-C", w.path, "status", "--porcelain=v2", "--branch"]);
      if (r.code === 0) {
        const g = parseStatus(r.stdout);
        // A push: ahead drops from >0 to 0 between two polls. CI then polls fast for a while (ciInterval).
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

  // --- CI ---------------------------------------------------------------------------------------
  const newCi = () => ({
    at: -Infinity, busy: false, done: false, host: null, path: null, provider: null, pipeline: null, runIds: [],
    error: null, hint: null, hostFailure: false, target: null, prev: undefined, retryError: null,
  });
  const headOf = (wt, w) => (wt.git ? { branch: wt.git.branch, sha: wt.git.oid } : { branch: w.branch, sha: w.head });
  const branchLabel = ({ branch, sha }) => branch ?? (sha ? `detached @${sha.slice(0, 7)}` : "detached");

  function maybeAlert(wt, repo, cur, head) {
    const alerted = io.shared(ALERTED_KEY);
    const a = alertFor({
      prev: wt.ci.prev, cur, alerted: alerted?.[wt.id], startedAt, repo: repoName(repo.mainPath, repo.machine), branch: branchLabel(head),
    });
    if (!a) return;
    // Recorded before notifying, so a crash or restart mid-alert can't alert twice.
    // Per worktree, the last 20 alert keys: a branch switch back to an old failure doesn't alert again.
    const all = alerted && typeof alerted === "object" && !Array.isArray(alerted) ? alerted : {};
    io.setShared(ALERTED_KEY, { ...all, [wt.id]: nextAlerted(all[wt.id], alertKey(cur)) });
    try {
      // Herdr drops a mod command's args, so the worktree rides in the name (args kept for readers).
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
      // Another branch (or sha) is a different pipeline history: forget the last-seen pipeline.
      if (ci.target !== target) Object.assign(ci, { target, prev: undefined });
      const cur = got.pipeline;
      // A different pipeline (a new run, or its status moved) makes the last Retry error old news.
      const was = ci.pipeline;
      if (!was || !cur || was.id !== cur.id || was.status !== cur.status || was.finishedAt !== cur.finishedAt) ci.retryError = null;
      Object.assign(ci, { pipeline: cur, runIds: got.runIds ?? [], canceledRunIds: got.canceledRunIds ?? [], error: null, hint: null, hostFailure: false, done: true });
      if (cur) maybeAlert(wt, repo, cur, head);
      ci.prev = cur ?? undefined;
    } finally {
      Object.assign(ci, { at: now, busy: false });
      publish(io.now()); // from current membership and records, never a captured view
    }
  }

  function ciDue(wt, host, now) {
    if (wt.ci.busy || client.blocked(host, now)) return false;
    if (wt.ci.hostFailure) return true; // the host's backoff is over
    return now - wt.ci.at >= ciInterval({ status: wt.ci.pipeline?.status, upstreamChangedAt: wt.upstreamChangedAt, now });
  }

  // The published summary of a worktree's pipeline (full details only in dock.git.detail).
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
      hint: ci.hint,
    };
  }

  // The view repo and worktree entry holding a worktree id.
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
      retryError: ci?.retryError ?? null, // the last Retry's failure, until a Retry succeeds
    };
    const key = JSON.stringify(detail);
    if (key === detailKey) return;
    detailKey = key;
    io.setShared(DETAIL_KEY, detail);
  }

  // --- discovery view ---------------------------------------------------------------------------
  // Repo id -> { id, machine, mainPath, added, addedPaths, error, wts: Map(wtId -> { path, branch, detached, head,
  // open, space }) }. addedPaths: the dock.git.repos entries that produced the repo (Remove repo drops those).
  function buildView(addedList, paneList) {
    const view = new Map();
    const repoFor = (id, machine, mainPath) => {
      if (!view.has(id)) view.set(id, { id, machine, mainPath, added: false, addedPaths: [], error: null, wts: new Map() });
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
    // Added repos keep their list order; terminal-only repos follow, by name.
    const nameOf = (id) => repoName(view.get(id).mainPath, view.get(id).machine);
    fromPanes.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b));
    const ordered = new Map();
    for (const [id, r] of view) if (!fromPanes.includes(id)) ordered.set(id, r);
    for (const id of fromPanes) ordered.set(id, view.get(id));
    return ordered;
  }

  // Auto-add and skip (docs/superpowers/specs/2026-11-22-auto-add-repos-design.md):
  // - a repo a terminal works in that isn't added is appended to dock.git.repos, so it stays after
  //   its terminals close (waits while an added entry is still resolving, so nothing is added twice);
  // - a repo in dock.git.skipped (removed while a terminal was in it) is hidden and never auto-added,
  //   and leaves the list once no terminal is in it.
  function applySkipAndAutoAdd(view, addedList) {
    const resolving = addedList.some((a) => !added.get(`${a.machine ?? ""}|${a.path}`)?.done);
    applyHidden(view, resolving);
    const raw = io.shared(SKIPPED_KEY);
    const skipped = Array.isArray(raw) ? raw.filter((s) => typeof s === "string") : [];
    const open = new Set([...view.values()].filter((r) => [...r.wts.values()].some((w) => w.open)).map((r) => r.id));
    const keep = skipped.filter((id) => open.has(id));
    if (keep.length !== skipped.length || !Array.isArray(raw)) {
      if (raw !== undefined || keep.length) io.setShared(SKIPPED_KEY, keep);
    }
    for (const id of keep) view.delete(id);
    if (io.autoAdd === false) return; // tests of other behaviour can turn it off; on in the app
    if (resolving) return;
    // An added entry whose listing failed is keyed by its path, not its common dir, so its terminal's row looks
    // un-added: never append a path that is already listed (the same check as the panel's Add repo).
    const listed = new Set(addedList.map((a) => idOf(a.machine, a.path)));
    const extra = [];
    for (const r of view.values()) {
      if (r.added || r.error) continue;
      const w = [...r.wts.values()].find((x) => x.open);
      if (w && !listed.has(idOf(r.machine ?? null, w.path))) extra.push({ path: w.path, machine: r.machine ?? null });
    }
    if (extra.length) io.setShared(REPOS_KEY, [...(io.shared(REPOS_KEY) ?? []), ...extra]);
  }

  // Hidden worktrees (docs/superpowers/specs/2026-11-22-worktree-hide-delete-design.md): dock.git.hidden is
  // [{ id, held }], held while a terminal was in it when hidden. Each entry is left out of the list until a
  // terminal enters it after none was in it; an entry for a worktree that no longer exists is dropped (not
  // while an added repo is still resolving, when its worktrees aren't known yet). A repo left with no
  // worktrees is left out too.
  function applyHidden(view, resolving) {
    const raw = io.shared(HIDDEN_KEY);
    const list = Array.isArray(raw) ? raw.filter((e) => e && typeof e.id === "string") : [];
    const where = new Map();
    for (const r of view.values()) for (const [id, w] of r.wts) where.set(id, { r, w });
    const next = [];
    for (const e of list) {
      const f = where.get(e.id);
      if (!f) { if (resolving) next.push(e); continue; }
      if (!e.held && f.w.open) continue; // a terminal came back: show it again
      next.push({ id: e.id, held: Boolean(e.held && f.w.open) });
      f.r.wts.delete(e.id);
      if (!f.r.wts.size && !f.r.error) view.delete(f.r.id);
    }
    if (JSON.stringify(next) !== JSON.stringify(list) || (raw !== undefined && !Array.isArray(raw))) io.setShared(HIDDEN_KEY, next);
  }

  // Deletes a worktree from disk: `git worktree remove` from its repo's main checkout, never --force, so git
  // refuses one with uncommitted changes. The main checkout itself is refused. Notifies on failure.
  async function deleteWorktree(id) {
    let found = null;
    for (const r of currentView.values()) if (r.wts.has(id)) found = { r, w: r.wts.get(id) };
    if (!found) return { ok: false, error: "worktree not found" };
    const { r, w } = found;
    if (slashPath(w.path).toLowerCase() === slashPath(r.mainPath).toLowerCase()) {
      return { ok: false, error: "the main checkout can't be deleted as a worktree" };
    }
    const res = await run(r.machine, ["-C", r.mainPath, "worktree", "remove", w.path]);
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
        path: origin?.path ?? null, // the origin's remote path (e.g. "grp/api"), not a folder
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
            pipeline: pipelineSummary(wtRecs.get(id)),
          };
        }),
      };
    });
    publishDetail();
    const key = JSON.stringify(repos);
    if (key === publishedKey) return;
    publishedKey = key;
    published = { repos, updatedAt: now };
    io.setShared(STATE_KEY, published);
  }

  // --- public -----------------------------------------------------------------------------------
  async function tick() {
    const gen = ++tickGen;
    const now = io.now();
    client.sweep(now); // time out requests past their 15 s
    sweepGit(now); // and git calls past their 30 s
    const addedList = readAdded();
    const paneList = readPanes();

    // 1. Discovery: list due added repos, resolve new pane cwds.
    const addedKeys = new Set();
    const jobs = [];
    for (const a of addedList) {
      const key = `${a.machine ?? ""}|${a.path}`;
      addedKeys.add(key);
      if (!added.has(key)) added.set(key, { machine: a.machine, path: a.path, at: -Infinity, busy: false, done: false });
      const e = added.get(key);
      if (!e.busy && now - e.at >= LIST_EVERY) jobs.push(listAdded(e, now));
    }
    for (const key of added.keys()) if (!addedKeys.has(key)) added.delete(key);
    const cwdKeys = new Set();
    for (const p of paneList) {
      const key = `${p.machine ?? ""}|${p.cwd}`;
      cwdKeys.add(key);
      if (!cwds.has(key)) cwds.set(key, { busy: false, done: false, at: -Infinity, result: null });
      const e = cwds.get(key);
      if (!e.busy && !e.done && now - e.at >= gitInterval({ open: true })) jobs.push(resolveCwd(e, p, now));
    }
    for (const key of cwds.keys()) if (!cwdKeys.has(key)) cwds.delete(key);
    await Promise.all(jobs);

    // 2. Membership: sync per-repo and per-worktree records with the view.
    const view = buildView(addedList, paneList);
    applySkipAndAutoAdd(view, addedList);
    currentView = view;
    viewGen = gen;
    const wtIds = new Set();
    for (const r of view.values()) {
      if (!repoRecs.has(r.id)) repoRecs.set(r.id, { origin: undefined, busy: false, tried: false });
      for (const [id, w] of r.wts) {
        wtIds.add(id);
        if (!wtRecs.has(id)) wtRecs.set(id, { id, machine: r.machine, path: w.path, gitAt: -Infinity, busy: false, git: null, error: null, upstreamChangedAt: -Infinity, ci: newCi() });
      }
    }
    for (const id of repoRecs.keys()) if (!view.has(id)) repoRecs.delete(id);
    for (const id of wtRecs.keys()) if (!wtIds.has(id)) wtRecs.delete(id);

    // 3. Git: origin once per repo, status at the gitInterval cadence.
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
      // Read once; an unread origin (a transient failure) is retried along with a status poll.
      if (first && rec.origin === undefined && !rec.busy && (!rec.tried || anyDue)) {
        rec.tried = true;
        polls.push(readOrigin(rec, r.machine, first.path));
      }
    }
    await Promise.all(polls);
    if (gen < viewGen) return; // a newer tick rebuilt membership; it polls CI and publishes

    // 4. CI, after git so the branch and sha are fresh. Each CI poll also publishes when it ends.
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

  // Selects a worktree for the Pipelines panel and publishes its detail; polls its CI first if it never was.
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

  // Retries the selected pipeline: GitLab retries the pipeline; GitHub reruns the failed jobs of each failed
  // run of that commit.
  async function retry() {
    const ci = wtRecs.get(selected)?.ci;
    const p = ci?.pipeline;
    if (!p || !ci.provider) return { ok: false, error: "no pipeline" };
    const r = await client.retry(ci.host, ci.provider, ci.path, p, ci.runIds, ci.canceledRunIds);
    ci.at = -Infinity; // re-query on the next tick
    ci.retryError = r.ok ? null : r.error ?? "retry failed";
    if (!r.ok) log(`CI: retry on ${ci.host}/${ci.path}: ${r.error}`);
    publishDetail(); // the panel shows a failed Retry
    return r;
  }

  // The selected pipeline's web URL, or one of its failed jobs' (by index into failedJobs).
  function urlFor(target) {
    const p = wtRecs.get(selected)?.ci.pipeline;
    if (!p) return null;
    if (target === "pipeline") return p.webUrl ?? null;
    const job = Number.isInteger(target?.job) ? p.failedJobs?.[target.job] : null;
    return job?.webUrl ?? null;
  }

  return { tick, refresh, select, retry, deleteWorktree, urlFor, state: () => published };
}
