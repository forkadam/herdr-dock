// src/mods/dock-warnings/main.js
import { View, div as div2 } from "gpui-kit";
import { theme, shared } from "herdr";

// src/mods/_bar.js
import { h_flex } from "gpui-base";
var WARN = "#d29922";
function barRow(t) {
  return h_flex().size_full().min_w(0).px(14).gap(16).items_center().overflow_hidden().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted);
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

// src/mods/_feature.js
import { div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { setShared } from "herdr";
function requestFocus(myId) {
  setShared("dock.left.focus", myId);
  setShared("dock.left.mode", "expanded");
}

// src/shared/system.js
var SAMPLE_KEY = "dock.system.sample";
var CPU_WINDOW_MS = 250;
var SAMPLE_MAX_AGE_MS = 3e4;
var QUOTA_WARN_PERCENT = 90;
var QUOTA_MAX_AGE_MS = 12e4;
var DISK_WARN_FREE_PERCENT = 10;
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
function warningsFor({ sample, gitState, quotaTop, now }) {
  const out = [];
  const worktrees = [];
  for (const r of gitState?.repos ?? []) for (const w of r.worktrees ?? []) if (w.pipeline?.status === "running") worktrees.push(w.id);
  const running = worktrees.length;
  if (running > 0) out.push({ key: "pipelines", text: `\u27F3 ${running}`, tip: `${running} pipeline${running === 1 ? "" : "s"} running`, worktrees });
  const fresh = Number.isFinite(quotaTop?.at) && now - quotaTop.at <= QUOTA_MAX_AGE_MS;
  if (quotaTop && fresh && !quotaTop.stale && quotaTop.p >= QUOTA_WARN_PERCENT) {
    out.push({ key: "quota", text: `\u26A0 quota ${Math.round(quotaTop.p)}%`, tip: `Agent quota at ${Math.round(quotaTop.p)}%` });
  }
  if (sample && typeof sample.diskFree === "number" && sample.diskFree < DISK_WARN_FREE_PERCENT && now - sample.at < SAMPLE_MAX_AGE_MS) {
    out.push({ key: "disk", text: `\u26A0 disk ${Math.round(sample.diskFree)}%`, tip: `System drive has ${Math.round(sample.diskFree)}% free` });
  }
  return out;
}

// src/mods/dock-warnings/main.js
var CLICK = {
  pipelines: (w) => w.worktrees?.length === 1 ? gitCommand("git.show", { worktree: w.worktrees[0] }) : gitCommand("git.show"),
  quota: () => requestFocus("dock-quotas")
};
var Warnings = class extends View {
  init(_props, cx) {
    cx.timer.every(5e3, (cx2) => cx2.notify());
  }
  item(t, w) {
    const click = CLICK[w.key];
    return div2().id(`dock-warning-${w.key}`).flex_none().text_color(w.key === "pipelines" ? t.muted : WARN).tooltip(w.tip).when(Boolean(click), (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => {
      cx.stop_propagation();
      click(w);
    })).child(w.text);
  }
  render() {
    const t = theme();
    const list = warningsFor({
      sample: shared(SAMPLE_KEY),
      gitState: shared("dock.git.state"),
      quotaTop: shared("dock.quotas.top"),
      now: Date.now()
    });
    return barRow(t).gap(12).children(list.map((w) => this.item(t, w)));
  }
};
export {
  Warnings as default
};
