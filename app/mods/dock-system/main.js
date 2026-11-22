// src/mods/dock-system/main.js
import { View, div, svg } from "gpui-kit";
import { h_flex as h_flex2 } from "gpui-base";
import { theme, shared } from "herdr";

// src/mods/_bar.js
import { h_flex } from "gpui-base";
var WARN = "#d29922";
function barRow(t) {
  return h_flex().size_full().min_w(0).px(14).gap(16).items_center().overflow_hidden().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted);
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

// src/mods/dock-system/view.js
var HERDR_MAX_AGE_MS = 3e4;
var MIB = 2 ** 20;
var GIB = 2 ** 30;
function size(bytes) {
  return Math.round(bytes / MIB) < 1024 ? `${Math.round(bytes / MIB)} MB` : `${Math.round(bytes / GIB * 10) / 10} GB`;
}
function systemTips(sample, herdr, now) {
  const cpu = `CPU ${Math.round(sample.cpu)}%`;
  const mem = `Memory ${Math.round(sample.mem)}%`;
  const fresh = herdr && Number.isFinite(herdr.at) && now - herdr.at < HERDR_MAX_AGE_MS;
  if (!fresh) return { cpu, mem };
  return {
    cpu: typeof herdr.cpu === "number" && Number.isFinite(herdr.cpu) ? `${cpu} \xB7 Herdr ${herdr.cpu}%` : cpu,
    mem: typeof herdr.mem === "number" && Number.isFinite(herdr.mem) ? `${mem} \xB7 Herdr ${size(herdr.mem)}` : mem
  };
}

// src/mods/dock-system/main.js
var MAX_AGE_MS = 3e4;
var HOT = 90;
var System = class extends View {
  init(_props, cx) {
    cx.timer.every(5e3, (cx2) => cx2.notify());
  }
  render() {
    const t = theme();
    const s = shared(SAMPLE_KEY);
    const now = Date.now();
    const fresh = s && typeof s.cpu === "number" && typeof s.mem === "number" && now - s.at < MAX_AGE_MS;
    const row = barRow(t).gap(12).justify_end();
    if (!fresh) return row;
    const tips = systemTips(s, shared(HERDR_KEY), now);
    const value = (id, icon, n, tip) => h_flex2().id(id).tooltip(tip).flex_none().gap(4).items_center().text_color(n >= HOT ? WARN : t.muted).child(svg(`mods/dock-system/${icon}.svg`).size(13).flex_none()).child(div().child(`${Math.round(n)}%`));
    return row.child(value("dock-system-cpu", "cpu", s.cpu, tips.cpu)).child(value("dock-system-mem", "memory", s.mem, tips.mem));
  }
};
export {
  System as default
};
