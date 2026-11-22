// src/mods/dock-git/main.js
import { View, div as div2, svg as svg2 } from "gpui-kit";
import { v_flex as v_flex2, h_flex } from "gpui-base";
import { theme, shared, setShared as setShared2, props, run as run2, exec, pickFolder, window, openOverlay } from "herdr";

// src/mods/_feature.js
import { div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { setShared } from "herdr";

// src/mods/_feature-mode.js
function featureMode(sharedMode, focus, myId, region) {
  if (region !== "left") return "full";
  if (sharedMode === "icons") return "icon";
  if (sharedMode === "expanded" && focus != null && focus !== myId) return "collapsed";
  return "full";
}

// src/mods/_feature.js
var RAIL_PX = 48;
function iconRail(t, iconPath, title, onClick) {
  return v_flex().size_full().w(RAIL_PX).min_h(0).bg(t.chrome).items_center().pt(8).child(div().id("dock-feature-icon").size(32).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(title).on_click((_e, cx) => {
    cx.stop_propagation();
    onClick();
  }).child(svg(iconPath).size(16)));
}
function requestFocus(myId) {
  setShared("dock.left.focus", myId);
  setShared("dock.left.mode", "expanded");
}

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

// src/shared/platform.js
function openUrlCommand(platform, url) {
  if (platform === "windows") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "macos") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/shared/git.js
function worktreeId(machine, path, platform) {
  let p = slashPath(path);
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  if (platform === "windows") p = p.toLowerCase();
  return `${machine ?? ""}|${p}`;
}

// src/mods/dock-git/view.js
var EMPTY_TEXT = "No repos yet: + Add repo, or open a terminal in a repo.";
var PROVIDER = { gitlab: "GitLab", github: "GitHub" };
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
function pipelineTip(p) {
  if (!p) return "No pipeline";
  if (p.error) return `Pipeline: ${p.error}${p.hint ? ` \xB7 run ${p.hint}` : ""}`;
  const s = p.status === "none" ? "no pipeline yet" : p.status;
  return `Pipeline ${p.number != null ? `#${p.number} ` : ""}${s}${p.stale ? " \xB7 older commit than local HEAD" : ""} \xB7 click for details`;
}
function repoWebUrl(repo) {
  return repo?.host && repo?.path ? `https://${repo.host}/${repo.path}` : null;
}
function gitRows(state, selected) {
  const repos = Array.isArray(state?.repos) ? state.repos : [];
  if (!repos.length) return [{ kind: "empty", text: EMPTY_TEXT }];
  const rows = [];
  for (const r of repos) {
    const wts = Array.isArray(r.worktrees) ? r.worktrees : [];
    rows.push({
      kind: "repo",
      id: r.id,
      name: r.name,
      machine: r.machine ?? null,
      provider: r.provider ?? null,
      added: Boolean(r.added),
      error: r.error ?? null,
      // The machine is already in the name ("tool · devbox"): the detail is just the provider.
      detail: r.provider ?? "",
      webUrl: repoWebUrl(r),
      webLabel: `Open in ${PROVIDER[r.provider] ?? "browser"}`,
      mainPath: wts[0]?.path ?? null,
      tooltip: [r.name, r.machine && `on ${r.machine}`, r.host && r.path && `${r.host}/${r.path}`, r.error].filter(Boolean).join(" \xB7 ")
    });
    for (const w of wts) {
      const branch = w.branch || `detached @${String(w.sha ?? "").slice(0, 7)}`;
      rows.push({
        kind: "worktree",
        id: w.id,
        repoId: r.id,
        branch,
        path: w.path,
        open: Boolean(w.open),
        space: w.space ?? null,
        selected: w.id === selected,
        badge: badgeOf(w.pipeline),
        badgeTip: pipelineTip(w.pipeline),
        ahead: w.ahead > 0 ? `\u2191${w.ahead}` : null,
        behind: w.behind > 0 ? `\u2193${w.behind}` : null,
        noUpstream: !w.upstream && !w.detached,
        dirty: Boolean(w.dirty),
        tooltip: `${branch} \xB7 ${w.path}${w.dirty ? " \xB7 uncommitted changes" : ""}${w.open ? " \xB7 open in a space" : ""}`
      });
    }
  }
  return rows;
}
function gitSummary(state) {
  const repos = Array.isArray(state?.repos) ? state.repos : [];
  const failing = repos.reduce((n, r) => n + (r.worktrees ?? []).filter((w) => w.pipeline?.status === "failed").length, 0);
  return { repos: repos.length, failing, text: `${repos.length} repo${repos.length === 1 ? "" : "s"} \xB7 ${failing} failing` };
}
var platformFor = (machine, path, platform) => machine == null ? platform : /^[A-Za-z]:\//.test(slashPath(path)) ? "windows" : "linux";
var idOf = (machine, path, platform) => worktreeId(machine, path, platformFor(machine, path, platform));
function addRepoPath(list, path, platform) {
  const cur = Array.isArray(list) ? list : [];
  const id = idOf(null, path, platform);
  if (cur.some((e) => e && typeof e.path === "string" && idOf(e.machine ?? null, e.path, platform) === id)) return null;
  return [...cur, { path, machine: null }];
}
function removeRepoPaths(list, repo, platform) {
  const cur = Array.isArray(list) ? list : [];
  const machine = repo.machine ?? null;
  const ids = /* @__PURE__ */ new Set([repo.id, ...(repo.worktrees ?? []).map((w) => idOf(machine, w.path, platform))]);
  for (const a of Array.isArray(repo.addedPaths) ? repo.addedPaths : []) {
    if (a && typeof a.path === "string" && (a.machine ?? null) === machine) ids.add(idOf(machine, a.path, platform));
  }
  return cur.filter((e) => !(e && typeof e.path === "string" && (e.machine ?? null) === machine && ids.has(idOf(machine, e.path, platform))));
}
function skipAfterRemove(skipped, repo) {
  if (!(repo?.worktrees ?? []).some((w) => w.open)) return null;
  const list = Array.isArray(skipped) ? skipped : [];
  return list.includes(repo.id) ? list : [...list, repo.id];
}
function rowMenu(rows, row) {
  const repo = row.kind === "repo" ? row : rows.find((r) => r.kind === "repo" && r.id === row.repoId);
  if (!repo) return [];
  const items = row.kind === "repo" ? [{ key: "remove", label: `Remove repo ${repo.name}`, repoId: repo.id }] : [
    { key: "hide", label: "Hide from list", worktree: row.id },
    ...row.path === repo.mainPath ? [] : [{ key: "delete", label: "Delete worktree\u2026", worktree: row.id }]
  ];
  if (repo.webUrl) items.push({ key: "web", label: repo.webLabel, url: repo.webUrl });
  const path = row.kind === "repo" ? repo.mainPath : row.path;
  if (path) items.push({ key: "copy", label: "Copy path", path });
  return items;
}
function hideWorktree(hidden, rows, row) {
  const others = rows.filter((r) => r.kind === "worktree" && r.repoId === row.repoId && r.id !== row.id);
  if (!others.length) return { hidden: null, removeRepo: row.repoId };
  const list = (Array.isArray(hidden) ? hidden : []).filter((e) => e?.id !== row.id);
  return { hidden: [...list, { id: row.id, held: Boolean(row.open) }], removeRepo: null };
}

// src/mods/dock-git/main.js
var REPOS_KEY = "dock.git.repos";
var SKIPPED_KEY = "dock.git.skipped";
var HIDDEN_KEY = "dock.git.hidden";
var WARN = "#d29922";
var Git = class extends View {
  init() {
    this.menu = null;
    this.hover = null;
  }
  tones(t) {
    return { ok: t.ansi2 ?? "#46a758", bad: t.ansi1 ?? "#e5484d", busy: t.accent, dim: t.dim, warn: WARN };
  }
  repoById(id) {
    const repos = shared("dock.git.state")?.repos;
    return Array.isArray(repos) ? repos.find((r) => r.id === id) ?? null : null;
  }
  addRepo(cx) {
    cx.spawn(async () => {
      const picked = await pickFolder({ prompt: "Add a repo" }).catch(() => null);
      if (!picked) return;
      const next = addRepoPath(shared(REPOS_KEY), slashPath(picked), window()?.platform);
      if (next) setShared2(REPOS_KEY, next);
      gitCommand("git.refresh");
    });
  }
  removeRepo(id) {
    const repo = this.repoById(id);
    if (repo) {
      setShared2(REPOS_KEY, removeRepoPaths(shared(REPOS_KEY), repo, window()?.platform));
      const skipped = skipAfterRemove(shared(SKIPPED_KEY), repo);
      if (skipped) setShared2(SKIPPED_KEY, skipped);
    }
    this.menu = null;
    gitCommand("git.refresh");
  }
  hideWorktree(rows, row) {
    const { hidden, removeRepo } = hideWorktree(shared(HIDDEN_KEY), rows, row);
    if (removeRepo) return this.removeRepo(removeRepo);
    setShared2(HIDDEN_KEY, hidden);
    this.menu = null;
    gitCommand("git.refresh");
  }
  // Deleting from disk can lose work: dock-git-delete warns first, and only its Delete runs it.
  confirmDelete(row) {
    this.menu = null;
    const name = String(row.path ?? "").replace(/\/+$/, "").split("/").pop();
    const repo = this.repoById(row.repoId);
    openOverlay({
      mod: "dock-git-delete",
      kind: "dialog",
      modal: true,
      width: 460,
      height: 230,
      props: { branch: row.branch, name, path: row.path, machine: repo?.machine ?? null, worktree: row.id }
    });
  }
  openWeb(url) {
    const { command, args } = openUrlCommand(window()?.platform, url);
    exec(command, args).catch((e) => console.log(`dock-git: open failed: ${e?.message ?? e}`));
  }
  header(t, onTitle, summary) {
    const title = div2().text_size(11.5).font_medium().text_color(t.dim).child("Git projects");
    const button = (id, tip, child, action) => div2().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => {
      cx.stop_propagation();
      action(cx);
    }).child(child);
    return h_flex().px(16).pr(onTitle ? 16 : 10).h(onTitle ? 31 : 41).pt(onTitle ? 0 : 14).pb(onTitle ? 0 : 5).flex_none().items_center().gap(2).child(onTitle ? title.id("dock-git-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Git projects").on_click(() => onTitle()) : title.flex_1()).when(Boolean(summary), (el) => el.child(div2().flex_none().text_size(11).text_color(t.dim).child(summary))).when(!onTitle, (el) => el.child(button("git-refresh", "Refresh repos and pipelines", div2().text_size(15).child("\u27F3"), () => gitCommand("git.refresh"))).child(button("git-add", "Add a repo", svg2("mods/workspace-chrome/plus.svg").size(14), (cx) => this.addRepo(cx))));
  }
  repoRow(t, r, i) {
    const red = t.ansi1 ?? "#e5484d";
    const detail = r.detail;
    return h_flex().id(`git-repo-${i}`).h(24).px(16).gap(6).flex_none().items_center().mt(i ? 6 : 0).tooltip(r.tooltip).on_mouse_down("right", (_e, cx) => this.toggleMenu(r.id, cx)).on_hover((on, cx) => {
      const next = on ? r.id : this.hover === r.id ? null : this.hover;
      if (next !== this.hover) {
        this.hover = next;
        cx.notify();
      }
    }).child(div2().flex_none().text_size(12.5).font_medium().text_color(t.foreground).child(r.name)).when(Boolean(detail), (el) => el.child(div2().flex_none().text_size(11).text_color(t.dim).child(`\xB7 ${detail}`))).child(div2().flex_1()).when(Boolean(r.error), (el) => el.child(div2().flex_none().text_size(12).text_color(WARN).child("\u26A0")).child(div2().id(`git-remove-${i}`).flex_none().px(6).h(18).rounded(5).text_size(11).text_color(red).flex().items_center().cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
      cx.stop_propagation();
      this.removeRepo(r.id);
      cx.notify();
    }).child("Remove"))).when(!r.error && this.hover === r.id, (el) => el.child(div2().id(`git-x-${i}`).flex_none().w(18).h(18).rounded(4).flex().items_center().justify_center().text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(red)).tooltip(`Remove ${r.name} from the list`).on_click((_e, cx) => {
      cx.stop_propagation();
      this.removeRepo(r.id);
      cx.notify();
    }).child("\u2715")));
  }
  toggleMenu(id, cx) {
    cx.stop_propagation();
    this.menu = this.menu === id ? null : id;
    cx.notify();
  }
  menuFor(t, rows, r, i) {
    const act = {
      remove: (m) => () => this.removeRepo(m.repoId),
      hide: () => () => this.hideWorktree(rows, r),
      delete: () => () => this.confirmDelete(r),
      web: (m) => () => this.openWeb(m.url),
      copy: (m) => (cx) => cx.write_to_clipboard(m.path)
    };
    const items = rowMenu(rows, r).map((m) => [m.key, m.label, act[m.key](m)]);
    if (!items.length) items.push(["none", "No actions", () => {
    }]);
    return v_flex2().id(`git-menu-${i}`).mx(12).my(2).p(4).flex_none().rounded(7).bg(t.popover ?? t.chrome).border(1).border_color(t.border).text_size(12).on_mouse_down_out((_e, cx) => {
      this.menu = null;
      cx.notify();
    }).children(items.map(([key, label, action]) => div2().id(`git-menu-${i}-${key}`).h(26).px(8).rounded(5).flex().items_center().text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
      cx.stop_propagation();
      action(cx);
      this.menu = null;
      cx.notify();
    }).child(label)));
  }
  worktreeRow(t, w, i) {
    const tones = this.tones(t);
    const select = () => {
      if (w.open && w.space) run2("space.select", { id: w.space });
      gitCommand("git.select", { worktree: w.id });
    };
    return h_flex().id(`git-wt-${i}`).h(24).mx(8).pl(10).pr(8).gap(6).flex_none().items_center().rounded(6).text_size(12.5).cursor_pointer().when(w.selected, (el) => el.bg(t.selected ?? t.hover)).hover((s) => s.bg(t.hover)).on_click(() => select()).on_mouse_down("right", (_e, cx) => this.toggleMenu(w.id, cx)).child(div2().size(6).flex_none().rounded_full().bg(w.open ? tones.ok : "#00000000")).child(div2().id(`git-branch-${i}`).flex_1().min_w(0).truncate().text_color(w.open ? t.foreground : t.muted).tooltip(w.tooltip).child(w.branch)).when(Boolean(w.badge.glyph), (el) => el.child(div2().id(`git-badge-${i}`).flex_none().w(18).h(18).rounded(4).flex().items_center().justify_center().text_size(12).text_color(tones[w.badge.tone] ?? t.dim).hover((s) => s.bg(t.border)).tooltip(w.badgeTip).on_click((_e, cx) => {
      cx.stop_propagation();
      gitCommand("git.show", { worktree: w.id });
    }).child(w.badge.glyph))).when(Boolean(w.ahead), (el) => el.child(div2().flex_none().text_size(11).text_color(t.muted).child(w.ahead))).when(Boolean(w.behind), (el) => el.child(div2().flex_none().text_size(11).text_color(t.muted).child(w.behind))).when(w.noUpstream, (el) => el.child(div2().flex_none().text_size(10.5).text_color(t.dim).child("no upstream"))).when(w.dirty, (el) => el.child(div2().flex_none().text_size(12).text_color(WARN).child("\u2022")));
  }
  render() {
    const t = theme();
    const myId = props()?.dockFeature ?? "dock-git";
    const face = featureMode(shared("dock.left.mode"), shared("dock.left.focus"), myId, props()?.dockRegion);
    const state = shared("dock.git.state");
    const sum = gitSummary(state);
    if (face === "icon") {
      const rail = iconRail(t, "mods/dock-git/icon.svg", "Git projects", () => requestFocus(myId));
      if (!sum.failing) return rail;
      return rail.child(div2().id("git-failing").mt(2).size(7).rounded_full().bg(t.ansi1 ?? "#e5484d").tooltip(`${sum.failing} failing`));
    }
    if (face === "collapsed") {
      return v_flex2().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).child(this.header(t, () => requestFocus(myId), sum.text));
    }
    const rows = gitRows(state, shared("dock.git.selected") ?? null);
    const children = [];
    rows.forEach((r, i) => {
      if (r.kind === "empty") children.push(div2().px(16).py(4).text_size(12).text_color(t.dim).child(r.text));
      else {
        children.push(r.kind === "repo" ? this.repoRow(t, r, i) : this.worktreeRow(t, r, i));
        if (this.menu === r.id) children.push(this.menuFor(t, rows, r, i));
      }
    });
    return v_flex2().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).child(this.header(t, null, null)).child(v_flex2().id("git-list").flex_1().min_h(0).pb(6).overflow_y_scrollbar().children(children));
  }
};
export {
  Git as default
};
