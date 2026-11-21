// The git/CI collector: discovers repos and worktrees (added repos + terminals), polls git status, and
// publishes `dock.git.state`. Host-independent: all I/O goes through the injected `io`, and there are no
// timers here — the host calls tick() every second and scheduling compares io.now() on each tick.
// (No Node built-ins: bundled into Herdr mods.)
import { parseWorktrees, parseStatus, parseRevParse, parseRemote, worktreeId } from "./git.js";
import { gitInterval } from "./ci.js";
import { slashPath } from "./path.js";

const GIT_LIMIT = 4; // git processes at once
const LIST_EVERY = 60000; // re-run `worktree list` for added repos
const REPOS_KEY = "dock.git.repos";
const STATE_KEY = "dock.git.state";

// Runs at most `n` async jobs at once; the rest wait in FIFO order.
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < n && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => { active--; next(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

const basename = (p) => p.replace(/\/+$/, "").split("/").pop() || p;
const errText = (r) => String(r.stderr || r.stdout || `git exited ${r.code}`).trim().split(/\r?\n/)[0];
const repoName = (mainPath, machine) =>
  basename(mainPath).replace(/\.git$/, "") + (machine ? ` · ${machine}` : "");
// The main worktree of a repo known only by its common dir.
const mainFromCommonDir = (commonDir) => (commonDir.endsWith("/.git") ? commonDir.slice(0, -5) : commonDir);

export function createCollector(io) {
  const git = limiter(GIT_LIMIT);
  const log = (msg) => { try { io.log?.(msg); } catch { /* logging never breaks a tick */ } };

  // Remote paths are POSIX unless they look like a Windows drive path.
  const platformOf = (machine, path) =>
    machine == null ? io.platform : /^[A-Za-z]:\//.test(slashPath(path)) ? "windows" : "linux";
  const idOf = (machine, path) => worktreeId(machine, path, platformOf(machine, path));

  // One git process via the limiter. A rejected exec (no git, machine unreachable) becomes code -1.
  const run = (machine, args) =>
    git(async () => {
      try {
        return await io.exec("git", args, { on: machine ?? undefined });
      } catch (e) {
        return { code: -1, stdout: "", stderr: String(e?.message ?? e) };
      }
    });

  // --- internal state ---------------------------------------------------------------------------
  // Added repos, by `${machine}|${path}`: { machine, path, at, busy, done, error, commonDir, list }.
  const added = new Map();
  // Pane cwds, by `${machine}|${cwd}`: { busy, done, result: { top, commonDir } | null }.
  const cwds = new Map();
  // Per repo (by repo id): { origin: undefined (unread) | { host, path } | null, busy }.
  const repoRecs = new Map();
  // Per worktree (by worktree id): { id, machine, path, gitAt, busy, git: parseStatus() | null, error }.
  // Task 4 adds its CI schedule (nextCiAt, pipeline, ...) to this record.
  const wtRecs = new Map();
  let published = { repos: [], updatedAt: null };
  let publishedKey = null;

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
      const rp = await run(e.machine, ["-C", e.path, "rev-parse", "--show-toplevel", "--git-common-dir"]);
      if (rp.code !== 0) {
        Object.assign(e, { error: errText(rp), list: [] });
        return;
      }
      const { top, commonDir } = parseRevParse(rp.stdout);
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

  async function resolveCwd(e, p) {
    e.busy = true;
    try {
      const r = await run(p.machine, ["-C", p.cwd, "rev-parse", "--show-toplevel", "--git-common-dir"]);
      e.result = r.code === 0 ? parseRevParse(r.stdout) : null;
    } finally {
      Object.assign(e, { busy: false, done: true });
    }
  }

  async function readOrigin(rec, machine, path) {
    rec.busy = true;
    try {
      const r = await run(machine, ["-C", path, "remote", "get-url", "origin"]);
      rec.origin = r.code === 0 ? parseRemote(r.stdout) : null; // exit 2: no origin
      if (r.code !== 0 && r.code !== 2) log(`git remote get-url failed in ${path}: ${errText(r)}`);
    } finally {
      rec.busy = false;
    }
  }

  async function pollStatus(w, now) {
    w.busy = true;
    try {
      const r = await run(w.machine, ["-C", w.path, "status", "--porcelain=v2", "--branch"]);
      if (r.code === 0) Object.assign(w, { git: parseStatus(r.stdout), error: null });
      else {
        w.error = errText(r);
        log(`git status failed in ${w.path}: ${w.error}`);
      }
    } finally {
      Object.assign(w, { gitAt: now, busy: false });
    }
  }

  // --- discovery view ---------------------------------------------------------------------------
  // Repo id -> { id, machine, mainPath, added, error, wts: Map(wtId -> { path, branch, detached, head, open, space }) }.
  function buildView(addedList, paneList) {
    const view = new Map();
    const repoFor = (id, machine, mainPath) => {
      if (!view.has(id)) view.set(id, { id, machine, mainPath, added: false, error: null, wts: new Map() });
      return view.get(id);
    };
    for (const a of addedList) {
      const e = added.get(`${a.machine ?? ""}|${a.path}`);
      if (!e?.done) continue;
      if (e.error) {
        Object.assign(repoFor(idOf(a.machine, a.path), a.machine, a.path), { added: true, error: e.error });
        continue;
      }
      const repo = repoFor(idOf(a.machine, e.commonDir), a.machine, e.list[0]?.path ?? mainFromCommonDir(e.commonDir));
      repo.added = true;
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

  function publish(view, now) {
    const repos = [...view.values()].map((r) => {
      const origin = repoRecs.get(r.id)?.origin ?? null;
      return {
        id: r.id,
        name: repoName(r.mainPath, r.machine),
        machine: r.machine,
        provider: null, // Task 4
        host: origin?.host ?? null,
        path: origin?.path ?? null,
        added: r.added,
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
            pipeline: null, // Task 4
          };
        }),
      };
    });
    const key = JSON.stringify(repos);
    if (key === publishedKey) return;
    publishedKey = key;
    published = { repos, updatedAt: now };
    io.setShared(STATE_KEY, published);
  }

  // --- public -----------------------------------------------------------------------------------
  async function tick() {
    const now = io.now();
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
      if (!cwds.has(key)) cwds.set(key, { busy: false, done: false, result: null });
      const e = cwds.get(key);
      if (!e.busy && !e.done) jobs.push(resolveCwd(e, p));
    }
    for (const key of cwds.keys()) if (!cwdKeys.has(key)) cwds.delete(key);
    await Promise.all(jobs);

    // 2. Membership: sync per-repo and per-worktree records with the view.
    const view = buildView(addedList, paneList);
    const wtIds = new Set();
    for (const r of view.values()) {
      if (!repoRecs.has(r.id)) repoRecs.set(r.id, { origin: undefined, busy: false });
      for (const [id, w] of r.wts) {
        wtIds.add(id);
        if (!wtRecs.has(id)) wtRecs.set(id, { id, machine: r.machine, path: w.path, gitAt: -Infinity, busy: false, git: null, error: null });
      }
    }
    for (const id of repoRecs.keys()) if (!view.has(id)) repoRecs.delete(id);
    for (const id of wtRecs.keys()) if (!wtIds.has(id)) wtRecs.delete(id);

    // 3. Git: origin once per repo, status at the gitInterval cadence.
    const polls = [];
    for (const r of view.values()) {
      const rec = repoRecs.get(r.id);
      const first = r.wts.values().next().value;
      if (first && rec.origin === undefined && !rec.busy) polls.push(readOrigin(rec, r.machine, first.path));
      for (const [id, w] of r.wts) {
        const rec = wtRecs.get(id);
        if (!rec.busy && now - rec.gitAt >= gitInterval({ open: w.open })) polls.push(pollStatus(rec, now));
      }
    }
    await Promise.all(polls);

    publish(view, now);
  }

  function refresh() {
    for (const e of added.values()) e.at = -Infinity;
    for (const e of cwds.values()) if (!e.busy) e.done = false;
    for (const w of wtRecs.values()) w.gitAt = -Infinity;
  }

  return { tick, refresh, state: () => published };
}
