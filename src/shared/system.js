// CPU / memory / disk sample (pure; the sampling itself runs in a `node -e` child) and the
// warning rules the bottom bar shows.
export const SAMPLE_KEY = "dock.system.sample";

const CPU_WINDOW_MS = 250;
const SAMPLE_MAX_AGE_MS = 30000;
const QUOTA_WARN_PERCENT = 90;
const DISK_WARN_FREE_PERCENT = 10;

// Prints one JSON line {"cpu","mem","diskFree"} (percent). CPU is busy time over a short window;
// the disk is the system drive root on Windows, else the home folder (null if statfs fails).
const SCRIPT = `
const os = require("os"), fs = require("fs");
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
  console.log(JSON.stringify({ cpu, mem, diskFree }));
}, ${CPU_WINDOW_MS});
`;

export function sampleCommand() {
  return { command: "node", args: ["-e", SCRIPT] };
}

const pct = (n) => Math.min(100, Math.max(0, Math.round(n)));

// The sample out of sampleCommand's stdout, stamped with `now`; null when it isn't one.
export function parseSample(stdout, now) {
  let o;
  try { o = JSON.parse(String(stdout ?? "").trim().split(/\r?\n/).pop()); } catch { return null; }
  if (!o || typeof o.cpu !== "number" || typeof o.mem !== "number" || !Number.isFinite(o.cpu + o.mem)) return null;
  const d = typeof o.diskFree === "number" && Number.isFinite(o.diskFree) ? pct(o.diskFree) : null;
  return { cpu: pct(o.cpu), mem: pct(o.mem), diskFree: d, at: now };
}

// What the bottom bar flags, in display order: running pipelines, quota near its limit, low disk.
export function warningsFor({ sample, gitState, quotaTop, now }) {
  const out = [];
  let running = 0;
  for (const r of gitState?.repos ?? []) for (const w of r.worktrees ?? []) if (w.pipeline?.status === "running") running++;
  if (running > 0) out.push({ key: "pipelines", text: `⟳ ${running}`, tip: `${running} pipeline${running === 1 ? "" : "s"} running` });
  if (quotaTop && !quotaTop.stale && quotaTop.p >= QUOTA_WARN_PERCENT) {
    out.push({ key: "quota", text: `⚠ quota ${Math.round(quotaTop.p)}%`, tip: `Agent quota at ${Math.round(quotaTop.p)}%` });
  }
  if (sample && typeof sample.diskFree === "number" && sample.diskFree < DISK_WARN_FREE_PERCENT
      && now - sample.at < SAMPLE_MAX_AGE_MS) {
    out.push({ key: "disk", text: `⚠ disk ${Math.round(sample.diskFree)}%`, tip: `System drive has ${Math.round(sample.diskFree)}% free` });
  }
  return out;
}
