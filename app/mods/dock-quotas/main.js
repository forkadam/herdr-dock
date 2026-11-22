// src/mods/dock-quotas/main.js
import { View, div as div2, svg as svg2, image } from "gpui-kit";
import { v_flex as v_flex2, h_flex } from "gpui-base";
import { theme, shared, setShared as setShared2, props, checking, home, appHome, readTextFile, watchFolder, exec, knownAgents, window as window2 } from "herdr";

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

// src/shared/claude.js
var STALE_MS = 12e4;
var KINDS = /* @__PURE__ */ new Set(["five_hour", "weekly"]);
function parseJson(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
function parseStatusline(text, nowMs) {
  const d = parseJson(text);
  if (!isObj(d) || d.provider !== "claude" || d.source !== "claude-statusline") return null;
  if (!isNum(d.fetched_at_unix)) return null;
  const fetchedMs = d.fetched_at_unix * 1e3;
  const sessions = /* @__PURE__ */ new Map();
  if (isObj(d.session_contexts)) {
    for (const [id, s] of Object.entries(d.session_contexts)) {
      if (!isObj(s) || !isNum(s.used_percent)) continue;
      const act = isObj(s.cache) ? s.cache.last_activity_unix : void 0;
      const seenMs = isNum(act) ? act * 1e3 : 0;
      sessions.set(id.toLowerCase(), { usedPercent: s.used_percent, seenMs, stale: nowMs - seenMs > STALE_MS });
    }
  }
  const windows = [];
  if (Array.isArray(d.windows)) {
    for (const w of d.windows) {
      if (!isObj(w) || !KINDS.has(w.kind) || !isNum(w.used_percent)) continue;
      windows.push({
        kind: w.kind,
        usedPercent: w.used_percent,
        resetsMs: isNum(w.resets_at) ? w.resets_at * 1e3 : null
      });
    }
  }
  return { fetchedMs, stale: nowMs - fetchedMs > STALE_MS, sessions, windows };
}
function formatPercent(p) {
  return `${Math.round(p)}% used`;
}
function formatAge(ms) {
  if (ms < 6e4) return "just now";
  const m = Math.floor(ms / 6e4);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function formatReset(resetsMs, nowMs) {
  const diff = resetsMs - nowMs;
  if (diff <= 0) return "resetting";
  const totalMin = Math.floor(diff / 6e4);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor(totalMin % 1440 / 60);
  const m = totalMin % 60;
  if (d > 0) return `resets in ${d}d ${h}h`;
  if (h > 0) return `resets in ${h}h ${String(m).padStart(2, "0")}m`;
  return `resets in ${m}m`;
}

// src/shared/claude-usage.js
var HOUR = 36e5;
var WEEK = 7 * 24 * HOUR;
var CLI_STALE_MS = 15 * 6e4;
var isNum2 = (v) => typeof v === "number" && Number.isFinite(v);
function window(kind, l, durationMs, label) {
  if (!l || !isNum2(l.utilization)) return null;
  const t = Date.parse(l.resets_at ?? "");
  return { kind, ...label ? { label } : {}, usedPercent: l.utilization, resetsMs: Number.isFinite(t) ? t : null, durationMs };
}
function parseUsageOutput(text, nowMs) {
  let d;
  try {
    d = JSON.parse(String(text ?? "").trim().split("\n").pop());
  } catch {
    return null;
  }
  if (!d?.ok || !d.limits) return null;
  const l = d.limits;
  const windows = [
    window("five_hour", l.five_hour, 5 * HOUR),
    window("weekly", l.seven_day, WEEK),
    window("model", l.seven_day_opus, WEEK, "Opus"),
    window("model", l.seven_day_sonnet, WEEK, "Sonnet"),
    ...Array.isArray(l.model_scoped) ? l.model_scoped.map((m) => window("model", m, WEEK, m.display_name || "model")) : []
  ].filter(Boolean);
  return { source: "cli", plan: typeof d.plan === "string" && d.plan ? d.plan : null, fetchedMs: nowMs, stale: false, windows };
}
function mergeClaude(cli, statusline, nowMs) {
  if (!cli) return statusline ?? null;
  const fresher = statusline && statusline.fetchedMs > cli.fetchedMs ? statusline : null;
  const windows = cli.windows.map((w) => {
    const s = fresher?.windows.find((x) => x.kind === w.kind && w.kind !== "model");
    return s ? { ...w, usedPercent: s.usedPercent, resetsMs: s.resetsMs ?? w.resetsMs } : w;
  });
  const fetchedMs = fresher ? fresher.fetchedMs : cli.fetchedMs;
  return { ...cli, windows, fetchedMs, stale: fresher ? Boolean(fresher.stale) && nowMs - cli.fetchedMs > CLI_STALE_MS : nowMs - cli.fetchedMs > CLI_STALE_MS };
}
function paceOf(w, nowMs) {
  if (!isNum2(w?.durationMs) || !isNum2(w?.resetsMs)) return null;
  const elapsed = w.durationMs - (w.resetsMs - nowMs);
  return Math.max(0, Math.min(1, elapsed / w.durationMs));
}
function planLabel(plan) {
  if (typeof plan !== "string" || !plan.trim()) return null;
  const words = plan.replace(/^claude[_-]/i, "").split(/[_\s-]+/).filter(Boolean);
  return words.map((w, i) => i === 0 ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

// src/shared/codex.js
var STALE_MS2 = 12e4;
var pad = (n) => String(n).padStart(2, "0");
var isObj2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var isNum3 = (v) => typeof v === "number" && Number.isFinite(v);
function codexSessionDirs(codexHome, nowMs) {
  const out = [];
  for (let d = 0; d <= 7; d++) {
    const t = new Date(nowMs - d * 864e5);
    for (const [y, m, day] of [[t.getFullYear(), t.getMonth() + 1, t.getDate()], [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]]) {
      const dir = `${codexHome}/sessions/${y}/${pad(m)}/${pad(day)}`;
      if (!out.includes(dir)) out.push(dir);
    }
  }
  return out;
}
function windowOf(w, eventMs) {
  if (!isObj2(w) || !isNum3(w.used_percent) || w.used_percent < 0 || w.used_percent > 100) return null;
  let resetsMs = null;
  if (isNum3(w.resets_at)) resetsMs = w.resets_at > 1e12 ? w.resets_at : w.resets_at * 1e3;
  else if (isNum3(w.resets_in_seconds) && isNum3(eventMs)) resetsMs = eventMs + w.resets_in_seconds * 1e3;
  return { usedPercent: w.used_percent, minutes: isNum3(w.window_minutes) ? w.window_minutes : null, resetsMs };
}
function parseCodexUsage(text, nowMs) {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes("rate_limits")) continue;
    let ev;
    try {
      ev = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const rl = ev?.payload?.rate_limits ?? ev?.rate_limits;
    if (!isObj2(rl)) continue;
    const eventMs = Date.parse(ev.timestamp);
    const found = [["primary", "five_hour"], ["secondary", "weekly"]].map(([key, kind]) => {
      const w = windowOf(rl[key], eventMs);
      if (!w) return null;
      const byLength = w.minutes === 300 ? "five_hour" : w.minutes === 10080 ? "weekly" : kind;
      return { kind: byLength, usedPercent: w.usedPercent, resetsMs: w.resetsMs };
    }).filter(Boolean);
    if (!found.length) continue;
    if (!isNum3(eventMs)) return { windows: found, fetchedMs: nowMs, stale: true };
    return { windows: found, fetchedMs: eventMs, stale: nowMs - eventMs > STALE_MS2 };
  }
  return null;
}
function pickNewestUsage(readings) {
  let best = null;
  for (const r of readings ?? []) if (r && (!best || r.fetchedMs > best.fetchedMs)) best = r;
  return best;
}

// src/shared/statusline.js
var WRITER_MARK = "herdr-statusline-cache";
var isObj3 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function readSettings(text) {
  if (text == null || !String(text).trim()) return { ok: true, settings: {}, command: null };
  let settings;
  try {
    settings = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: `not valid JSON (${e.message})` };
  }
  if (!isObj3(settings)) return { ok: false, error: "the root is not an object" };
  const sl = settings.statusLine;
  const command = isObj3(sl) && typeof sl.command === "string" && sl.command.trim() ? sl.command : null;
  return { ok: true, settings, command };
}
function isSimpleCommand(command) {
  let q = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if ("|&;<>`\n\r".includes(c)) return false;
    if (c === "$" && command[i + 1] === "(") return false;
  }
  return q === null;
}
function scriptPaths(command, home2) {
  const words = String(command).match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const out = [];
  for (let w of words) {
    w = w.replace(/^["']|["']$/g, "");
    if (w.startsWith("-") || !/[\\/]/.test(w)) continue;
    w = w.replace(/^~(?=[\\/])/, home2).replace(/^\$HOME(?=[\\/])/, home2).replace(/^\$\{HOME\}(?=[\\/])/, home2).replace(/^%USERPROFILE%(?=[\\/])/i, home2).replace(/^\$env:USERPROFILE(?=[\\/])/i, home2).replace(/\\/g, "/");
    if (!/^([A-Za-z]:)?\//.test(w)) continue;
    out.push(w);
    if (out.length >= 3) break;
  }
  return out;
}
var writerCommand = (writer) => `node "${String(writer).replace(/\\/g, "/")}"`;
function statuslinePlan(settingsText, writer, scriptTexts = []) {
  const r = readSettings(settingsText);
  if (!r.ok) return { state: "invalid", error: r.error };
  const { settings, command } = r;
  if (command && (command.includes(WRITER_MARK) || scriptTexts.some((t) => typeof t === "string" && t.includes(WRITER_MARK)))) {
    return { state: "fed" };
  }
  const nl = settingsText && String(settingsText).includes("\r\n") ? "\r\n" : "\n";
  const write = (statusLine) => JSON.stringify({ ...settings, statusLine }, null, 2).replace(/\n/g, nl) + nl;
  if (!command) {
    const prev = isObj3(settings.statusLine) ? settings.statusLine : {};
    return { state: "missing", text: write({ ...prev, type: "command", command: writerCommand(writer) }) };
  }
  if (!isSimpleCommand(command)) return { state: "complex", command };
  return { state: "other", command, text: write({ ...settings.statusLine, command: `${writerCommand(writer)} --tee | ${command}` }) };
}

// src/shared/platform.js
function listDirCommand(platform, dir) {
  if (platform === "windows") return { command: "cmd", args: ["/c", "dir", "/b", "/ad", dir.replaceAll("/", "\\")] };
  return { command: "ls", args: ["-1", "-p", dir] };
}
function listFilesByTimeCommand(platform, dir) {
  if (platform === "windows") return { command: "cmd", args: ["/c", "dir", "/b", "/a-d", "/o-d", "/t:w", dir.replaceAll("/", "\\")] };
  return { command: "ls", args: ["-1", "-t", "-p", dir] };
}
function rateLimitLinesCommand(platform, file) {
  if (platform === "windows") return { command: "findstr", args: ["/l", "/c:rate_limits", file.replaceAll("/", "\\")] };
  return { command: "grep", args: ["-F", "rate_limits", file] };
}
function parseFileListing(platform, stdout) {
  const names = String(stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return platform === "windows" ? names : names.filter((n) => !n.endsWith("/"));
}

// src/shared/path.js
function slashPath(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ":");
  if (s.length > 1 && !/^[A-Z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
  if (/^[A-Z]:$/.test(s)) s += "/";
  return s === "" ? "/" : s;
}

// src/mods/dock-quotas/view.js
var PROVIDERS = [
  { id: "claude", title: "Claude", agent: "claude", source: "Claude status line" },
  { id: "codex", title: "Codex", agent: "codex", source: "Codex session logs" }
];
var LABELS = { five_hour: "5-hour", weekly: "weekly" };
var sourceOf = (usage, provider) => usage.source === "cli" ? "Claude Code (/usage)" : provider.source;
var labelOf = (w) => w.kind === "model" ? `weekly \xB7 ${w.label}` : LABELS[w.kind] ?? w.kind;
var isReset = (w, nowMs) => Number.isFinite(nowMs) && Number.isFinite(w.resetsMs) && w.resetsMs <= nowMs;
function shortReset(resetsMs, nowMs) {
  if (!Number.isFinite(resetsMs) || resetsMs <= nowMs) return null;
  const min = Math.floor((resetsMs - nowMs) / 6e4);
  if (min < 1) return "<1m";
  const d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60), m = min % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}
function quotaRows(usage, nowMs, provider) {
  const age = formatAge(nowMs - usage.fetchedMs);
  const source = sourceOf(usage, provider);
  return usage.windows.map((w) => {
    const label = labelOf(w);
    if (isReset(w, nowMs)) {
      return {
        label,
        value: "reset",
        detail: `reset \xB7 ${age}`,
        stale: Boolean(usage.stale),
        tooltip: `${provider.title} \xB7 ${label}: reset since this reading \xB7 ${age} \xB7 source: ${source}`,
        percent: null,
        pace: null,
        usage: "reset",
        reset: null
      };
    }
    const pace = paceOf(w, nowMs);
    const detail = w.resetsMs == null ? age : `${formatReset(w.resetsMs, nowMs)} \xB7 ${age}`;
    return {
      label,
      value: formatPercent(w.usedPercent),
      detail,
      stale: Boolean(usage.stale),
      tooltip: `${provider.title} \xB7 ${label}: ${formatPercent(w.usedPercent)} \xB7 ${detail}${pace == null ? "" : ` \xB7 ${Math.round(pace * 100)}% of the window has passed`} \xB7 source: ${source}`,
      usage: `${Math.round(w.usedPercent)}%`,
      reset: shortReset(w.resetsMs, nowMs),
      percent: w.usedPercent,
      pace
    };
  });
}
function quotaGroups(byId, nowMs) {
  return PROVIDERS.filter((p) => byId?.[p.id]?.windows?.length).map((p) => ({ id: p.id, title: p.title, agent: p.agent, plan: planLabel(byId[p.id].plan), rows: quotaRows(byId[p.id], nowMs, p) }));
}
function iconBadge(readings, nowMs) {
  let best = null;
  for (const r of readings ?? []) {
    for (const w of r?.windows ?? []) {
      if (!Number.isFinite(w.usedPercent) || isReset(w, nowMs)) continue;
      if (!best || w.usedPercent > best.p) best = { p: w.usedPercent, stale: Boolean(r.stale) };
    }
  }
  return best ? { text: `${Math.round(best.p)}%`, stale: best.stale } : null;
}
var barLevel = (p) => p >= 90 ? "high" : p >= 70 ? "warn" : "ok";
function setupNotice(state, { busy = false, error = null } = {}) {
  if (error) return { text: "Claude: set up failed", tip: error, action: "setup" };
  if (busy) return { text: "Claude: setting up\u2026", tip: "Writing ~/.claude/settings.json", action: null };
  switch (state) {
    case "missing":
      return {
        text: "Claude: status line not set up",
        tip: "Claude Code gives its usage limits only to a status line. Set up adds one that prints nothing.",
        action: "setup"
      };
    case "other":
      return {
        text: "Claude: status line doesn't feed Quotas",
        tip: "Set up puts herdr-dock's writer in front of your status line; it prints the same.",
        action: "setup"
      };
    case "complex":
      return {
        text: "Claude: add one line to your status line",
        tip: `Your status line is more than one command, so it's left alone. README: "Where the quota and context numbers come from".`,
        action: null
      };
    case "fed":
      return {
        text: "Claude: waiting for Claude Code's next reply",
        tip: "The status line is set up. The limits arrive with the next reply in any Claude Code session (only on a Claude subscription). Nothing after a reply? Restart Claude Code.",
        action: null
      };
    case "invalid":
      return { text: "Claude: ~/.claude/settings.json isn't valid JSON", tip: "Fix the file; Quotas checks again.", action: null };
    default:
      return null;
  }
}

// src/mods/dock-quotas/main.js
var REFRESH_MS = 3e4;
var CODEX_ABSENT_MS = 3e5;
var EMPTY_WATCH_MS = 1e3;
var TOP_KEY = "dock.quotas.top";
var CLI_EVERY_MS = 5 * 6e4;
var TOP_REFRESH_MS = 55e3;
var SETUP_CHECK_MS = 6e4;
var WARN = "#d29922";
var HIGH = "#f85149";
var Quotas = class extends View {
  init(_props, cx) {
    this.statusline = null;
    this.cli = null;
    this.cliAt = 0;
    this.codex = null;
    this.icons = {};
    this.setup = { state: null, busy: false, error: null, nextAt: 0 };
    if (checking()) return;
    cx.spawn(async (cx2) => {
      try {
        for (const a of await knownAgents()) if (a?.key && a.icon) this.icons[a.key] = { icon: a.icon, tint: Boolean(a.tint) };
        cx2.notify();
      } catch (e) {
        console.log(`dock-quotas: agent icons unavailable: ${e}`);
      }
    });
    this.codexNextAt = 0;
    cx.timer.every(REFRESH_MS, (cx2) => {
      this.reload(cx2);
      this.reloadCodex(cx2);
      this.reloadCli(cx2);
    });
    this.reloadCli(cx);
    const dir = slashPath(home()) + "/.claude/statusline-cache";
    this.reload(cx);
    this.reloadCodex(cx);
    cx.spawn(async (cx2) => {
      try {
        for (; ; ) {
          const changed = await watchFolder(dir);
          if (!changed?.length) {
            await cx2.sleep(EMPTY_WATCH_MS);
            continue;
          }
          this.reload(cx2);
        }
      } catch (e) {
        console.log(`dock-quotas: watch ended, using the timer: ${e}`);
      }
    });
  }
  // One read at a time; a request meanwhile runs once more after it.
  reload(cx) {
    if (this.reading) {
      this.again = true;
      return;
    }
    this.reading = true;
    cx.spawn(async (cx2) => {
      try {
        do {
          this.again = false;
          const text = await readTextFile(slashPath(home()) + "/.claude/statusline-cache/claude-statusline.json").catch(() => null);
          this.statusline = parseStatusline(text, Date.now());
          if (!this.statusline) this.checkSetup(cx2);
          this.publishTop();
          cx2.notify();
        } while (this.again);
      } catch (e) {
        console.log(`dock-quotas: read failed: ${e}`);
        this.statusline = null;
        this.cli = null;
        this.cliAt = 0;
        this.publishTop();
        cx2.notify();
      } finally {
        this.reading = false;
      }
    });
  }
  // Asks the claude CLI for your limits (scripts/herdr-claude-usage.mjs, shipped in this mod). No claude, not logged
  // in, or no answer: the last reading stays and goes stale; the status line still works on its own.
  reloadCli(cx) {
    if (this.cliReading || Date.now() - this.cliAt < CLI_EVERY_MS) return;
    this.cliReading = true;
    this.cliAt = Date.now();
    cx.spawn(async (cx2) => {
      try {
        const helper = slashPath(appHome()) + "/mods/dock-quotas/herdr-claude-usage.mjs";
        const r = await exec("node", [helper], { timeout: 4e4 });
        const reading = parseUsageOutput(r.stdout, Date.now());
        if (reading) this.cli = reading;
        else console.log(`dock-quotas: claude usage: ${(r.stdout || r.stderr || "").trim().slice(0, 200)}`);
      } catch (e) {
        console.log(`dock-quotas: claude usage failed: ${e}`);
      } finally {
        this.cliReading = false;
        this.publishTop();
        cx2.notify();
      }
    });
  }
  // What Quotas shows for Claude: the CLI's reading, with a fresher status line's 5-hour and weekly numbers.
  claude() {
    return mergeClaude(this.cli, this.statusline, Date.now());
  }
  reloadCodex(cx) {
    if (this.codexReading || Date.now() < this.codexNextAt) return;
    this.codexReading = true;
    cx.spawn(async (cx2) => {
      try {
        this.codex = await this.readCodex();
      } catch (e) {
        console.log(`dock-quotas: Codex read failed: ${e}`);
        this.codex = null;
      } finally {
        this.codexReading = false;
        this.publishTop();
        cx2.notify();
      }
    });
  }
  // No Claude reading: is Claude Code's status line wired to the writer? Reads ~/.claude/settings.json (and the
  // script its command runs, for a line added by hand); no ~/.claude means Claude Code isn't used here.
  checkSetup(cx, force = false) {
    if (this.setup.checking || this.setup.busy || !force && Date.now() < this.setup.nextAt) return;
    this.setup.checking = true;
    cx.spawn(async (cx2) => {
      try {
        const root = slashPath(home());
        const text = await readTextFile(root + "/.claude/settings.json").catch(() => null);
        let state;
        if (text == null) {
          const probe = listDirCommand(window2()?.platform, root + "/.claude");
          const r = await exec(probe.command, probe.args).catch(() => null);
          state = r && r.code === 0 ? "missing" : "no-claude";
        } else {
          const writer = this.writerPath();
          const first = statuslinePlan(text, writer);
          state = first.command ? statuslinePlan(text, writer, await Promise.all(scriptPaths(first.command, root).map((p) => readTextFile(p).catch(() => null)))).state : first.state;
        }
        this.setup.state = state;
      } catch (e) {
        console.log(`dock-quotas: status line check failed: ${e}`);
      } finally {
        this.setup.checking = false;
        this.setup.nextAt = Date.now() + SETUP_CHECK_MS;
        cx2.notify();
      }
    });
  }
  writerPath() {
    return slashPath(appHome()) + "/mods/dock-quotas/herdr-statusline-cache.mjs";
  }
  // Set up: runs the setup script shipped with this mod (it backs up settings.json, then writes it).
  runSetup(cx) {
    if (this.setup.busy) return;
    this.setup.busy = true;
    this.setup.error = null;
    cx.notify();
    cx.spawn(async (cx2) => {
      try {
        const script = slashPath(appHome()) + "/mods/dock-quotas/herdr-statusline-setup.mjs";
        const r = await exec("node", [script, "--writer", this.writerPath()], { timeout: 3e4 });
        if (r.code !== 0) this.setup.error = (r.stderr || r.stdout || `exit ${r.code}`).trim();
        else {
          this.setup.state = "fed";
          console.log(`dock-quotas: ${r.stdout.trim()}`);
        }
      } catch (e) {
        this.setup.error = `couldn't run node: ${e}`;
      } finally {
        this.setup.busy = false;
        this.checkSetup(cx2, true);
        cx2.notify();
      }
    });
  }
  setupRow(t) {
    const n = this.claude() ? null : setupNotice(this.setup.state, this.setup);
    if (!n) return null;
    return h_flex().id("quota-setup").px(16).py(4).gap(8).flex_none().items_center().tooltip(n.tip).child(div2().flex_1().min_w(0).truncate().text_size(12).text_color(this.setup.error ? t.blocked ?? HIGH : t.muted).child(n.text)).when(n.action === "setup", (el) => el.child(h_flex().id("quota-setup-run").h(22).px(8).flex_none().items_center().rounded(6).border_1().border_color(t.border).text_size(11.5).text_color(t.foreground).cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.runSetup(cx)).child("Set up")));
  }
  // The highest used % across Claude and Codex, for the bottom bar's warnings: shared dock.quotas.top =
  // { p, stale, at } (at: when it was published), or null with no reading. Written when p or stale changes,
  // and again once `at` is TOP_REFRESH_MS old (the 30 s timer calls this), so a reading that stops being
  // refreshed (this mod unmounted or stuck) ages out of the warnings after 120 s.
  publishTop() {
    const now = Date.now();
    const b = iconBadge([this.claude(), this.codex], now);
    const prev = shared(TOP_KEY) ?? null;
    if (!b) {
      if (prev !== null) setShared2(TOP_KEY, null);
      return;
    }
    const p = parseInt(b.text, 10), stale = b.stale;
    const same = prev && prev.p === p && prev.stale === stale && Number.isFinite(prev.at) && now - prev.at < TOP_REFRESH_MS;
    if (!same) setShared2(TOP_KEY, { p, stale, at: now });
  }
  // Codex's latest rate limits: in each of the last 8 days' session folders (newest first), the most
  // recently modified logs; only their "rate_limits" lines are read (logs can be many MB). The newest
  // reading among the first 3 folders that have logs wins, so a long or resumed session in an older
  // folder still counts. No ~/.codex/sessions: nothing, and no look again for 5 minutes.
  async readCodex() {
    const platform = window2()?.platform;
    const now = Date.now();
    const root = slashPath(home()) + "/.codex";
    const probe = listDirCommand(platform, root + "/sessions");
    const has = await exec(probe.command, probe.args).catch(() => null);
    if (!has || has.code !== 0) {
      this.codexNextAt = now + CODEX_ABSENT_MS;
      return null;
    }
    const found = [];
    let folders = 0;
    for (const dir of codexSessionDirs(root, now)) {
      if (folders >= 3) break;
      const ls = listFilesByTimeCommand(platform, dir);
      const r = await exec(ls.command, ls.args).catch(() => null);
      if (!r || r.code !== 0) continue;
      const logs = parseFileListing(platform, r.stdout).filter((n) => /^rollout-.*\.jsonl$/.test(n));
      if (!logs.length) continue;
      folders++;
      for (const name of logs.slice(0, 3)) {
        const g = rateLimitLinesCommand(platform, `${dir}/${name}`);
        const lines = await exec(g.command, g.args).catch(() => null);
        const usage = lines && lines.code === 0 ? parseCodexUsage(lines.stdout, now) : null;
        if (usage) {
          found.push(usage);
          break;
        }
      }
    }
    return pickNewestUsage(found);
  }
  groupHeader(t, g, i) {
    const ic = this.icons[g.agent];
    const face = ic ? ic.tint ? svg2(ic.icon).size(13).text_color(t.muted) : image(ic.icon).size(13) : div2().size(13).flex().items_center().justify_center().text_size(10).font_semibold().text_color(t.dim).child(g.title.slice(0, 1));
    return h_flex().id(`quota-group-${i}`).px(16).pt(i ? 8 : 2).pb(1).gap(6).flex_none().items_center().child(face).child(div2().text_size(11.5).font_medium().text_color(t.muted).child(g.title)).when(Boolean(g.plan), (el) => el.child(div2().px(5).rounded(4).bg(t.border).text_size(10).text_color(t.muted).child(g.plan)));
  }
  header(t, onTitle) {
    const title = div2().text_size(11.5).font_medium().text_color(t.dim).child("Quotas");
    return h_flex().px(16).h(onTitle ? 31 : 41).pt(onTitle ? 0 : 14).pb(onTitle ? 0 : 5).flex_none().items_center().child(onTitle ? title.id("dock-quotas-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Show Quotas").on_click(() => onTitle()) : title);
  }
  // One line per window: label, bar (with the pace tick), usage, time to reset. The rest (full reset time, age,
  // source, pace in numbers) is in the tooltip.
  row(t, r, i) {
    const level = barLevel(r.percent ?? 0);
    const color = { ok: t.accent, warn: WARN, high: t.blocked ?? HIGH }[level];
    const pct = Math.max(0, Math.min(100, r.percent ?? 0));
    return h_flex().id(`quota-${i}`).px(16).h(24).gap(8).flex_none().items_center().tooltip(r.tooltip).when(r.stale, (el) => el.opacity(0.55)).child(div2().w(92).flex_none().truncate().text_size(12).text_color(t.foreground).child(r.label)).child(div2().flex_1().min_w(24).h(4).relative().rounded(2).bg(t.border).when(r.percent != null, (bar) => bar.child(div2().w(`${pct}%`).h(4).rounded(2).bg(color))).when(r.pace != null, (bar) => bar.child(div2().absolute().top(-2).left(`${Math.round(r.pace * 100)}%`).w(2).h(8).rounded(1).bg(t.foreground).opacity(0.7)))).child(div2().w(34).flex_none().flex().justify_end().text_size(12).text_color(r.percent == null ? t.dim : level === "ok" ? t.muted : color).child(r.usage ?? r.value)).child(div2().w(46).flex_none().flex().justify_end().text_size(11).text_color(t.dim).child(r.stale ? "stale" : r.reset ?? ""));
  }
  render(cx) {
    const t = theme();
    const myId = props()?.dockFeature ?? "dock-quotas";
    const face = featureMode(shared("dock.left.mode"), shared("dock.left.focus"), myId, props()?.dockRegion);
    if (face === "icon") {
      const b = iconBadge([this.claude(), this.codex], Date.now());
      const rail = iconRail(t, "mods/dock-quotas/icon.svg", "Quotas", () => requestFocus(myId));
      if (!b) return rail;
      const p = parseInt(b.text, 10);
      const color = barLevel(p) === "ok" ? t.muted : barLevel(p) === "warn" ? WARN : t.blocked ?? HIGH;
      return rail.child(div2().id("quota-badge").text_size(10).text_color(color).when(b.stale, (el) => el.opacity(0.55)).tooltip(b.stale ? `${p}% used \xB7 stale` : `${p}% used`).child(b.text));
    }
    if (face === "collapsed") {
      return v_flex2().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).child(this.header(t, () => requestFocus(myId)));
    }
    const groups = quotaGroups({ claude: this.claude(), codex: this.codex }, Date.now());
    const setup = this.setupRow(t);
    let n = 0;
    return v_flex2().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).child(this.header(t, null)).child(v_flex2().id("dock-quotas-list").flex_1().min_h(0).overflow_y_scrollbar().when(Boolean(setup), (el) => el.child(setup)).when(!groups.length && !setup, (el) => el.child(div2().px(16).py(4).text_size(12).text_color(t.dim).tooltip("Claude: arrives after a Claude Code reply. Codex: use it once.").child("no usage recorded yet"))).children(groups.flatMap((g, gi) => [this.groupHeader(t, g, gi), ...g.rows.map((r) => this.row(t, r, n++))])));
  }
};
export {
  Quotas as default
};
