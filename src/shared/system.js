// CPU / memory / disk sample (pure; the sampling itself runs in a `node -e` child) and the
// warning rules the bottom bar shows.
export const SAMPLE_KEY = "dock.system.sample";
export const HERDR_KEY = "dock.system.herdr";

const CPU_WINDOW_MS = 250;
const SAMPLE_MAX_AGE_MS = 30000;
const QUOTA_WARN_PERCENT = 90;
// dock-quotas refreshes dock.quotas.top's `at` at least every 60 s while mounted; older means it stopped.
const QUOTA_MAX_AGE_MS = 120000;
const DISK_WARN_FREE_PERCENT = 10;

// Prints one JSON line {"cpu","mem","diskFree"} (percent) plus "cores". CPU is busy time over a short window;
// the disk is the system drive root on Windows, else the home folder (null if statfs fails). On macOS it also
// prints `vm_stat`'s text and the total memory, because freemem there leaves out the cache macOS reclaims at
// will and so reads 90%+ all the time; parseSample works out "Memory Used" from them (macUsedPercent).
const SCRIPT = `
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

export function sampleCommand() {
  return { command: "node", args: ["-e", SCRIPT] };
}

const pct = (n) => Math.min(100, Math.max(0, Math.round(n)));

// macOS "Memory Used" as Activity Monitor counts it, in percent of `totalBytes`, from `vm_stat` text:
// app memory (anonymous pages minus purgeable) + wired + compressed. Without the anonymous-pages line (older
// macOS) it uses active + wired + compressed. Null when the text or total can't be used.
export function macUsedPercent(vmStat, totalBytes) {
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

// The sample out of sampleCommand's stdout, stamped with `now`; null when it isn't one. On macOS the memory
// comes from vm_stat when it was readable (see SCRIPT), else the freemem figure stays.
export function parseSample(stdout, now) {
  let o;
  try { o = JSON.parse(String(stdout ?? "").trim().split(/\r?\n/).pop()); } catch { return null; }
  if (!o || typeof o.cpu !== "number" || typeof o.mem !== "number" || !Number.isFinite(o.cpu + o.mem)) return null;
  const d = typeof o.diskFree === "number" && Number.isFinite(o.diskFree) ? pct(o.diskFree) : null;
  const cores = Number.isInteger(o.cores) && o.cores > 0 ? o.cores : null;
  const mac = typeof o.vm === "string" ? macUsedPercent(o.vm, o.total) : null;
  return { cpu: pct(o.cpu), mem: mac ?? pct(o.mem), diskFree: d, cores, at: now };
}

// What the bottom bar flags, in display order: running pipelines (with their worktree ids), quota near its
// limit (only a reading published within the last 120 s), low disk.
export function warningsFor({ sample, gitState, quotaTop, now }) {
  const out = [];
  const worktrees = [];
  for (const r of gitState?.repos ?? []) for (const w of r.worktrees ?? []) if (w.pipeline?.status === "running") worktrees.push(w.id);
  const running = worktrees.length;
  if (running > 0) out.push({ key: "pipelines", text: `⟳ ${running}`, tip: `${running} pipeline${running === 1 ? "" : "s"} running`, worktrees });
  const fresh = Number.isFinite(quotaTop?.at) && now - quotaTop.at <= QUOTA_MAX_AGE_MS;
  if (quotaTop && fresh && !quotaTop.stale && quotaTop.p >= QUOTA_WARN_PERCENT) {
    out.push({ key: "quota", text: `⚠ quota ${Math.round(quotaTop.p)}%`, tip: `Agent quota at ${Math.round(quotaTop.p)}%` });
  }
  if (sample && typeof sample.diskFree === "number" && sample.diskFree < DISK_WARN_FREE_PERCENT
      && now - sample.at < SAMPLE_MAX_AGE_MS) {
    out.push({ key: "disk", text: `⚠ disk ${Math.round(sample.diskFree)}%`, tip: `System drive has ${Math.round(sample.diskFree)}% free` });
  }
  return out;
}

// Herdr's own processes (herdr-app, herdr-core, ...). Windows prints `name,pid,workingSetBytes,cpuMs` per
// process; mac/linux use `ps` (`pid rss-KiB time command`).
export function herdrSampleCommand(platform) {
  if (platform === "windows") {
    const ps = "Get-Process -Name herdr* -ErrorAction SilentlyContinue | ForEach-Object { '{0},{1},{2},{3}' -f $_.ProcessName,$_.Id,[int64]$_.WorkingSet64,[int64]$_.TotalProcessorTime.TotalMilliseconds }";
    return { command: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", ps] };
  }
  return { command: "ps", args: ["-axo", "pid=,rss=,time=,command="] };
}

// [[dd-]hh:]mm:ss[.ff] to milliseconds; null when it isn't one.
function psTimeMs(t) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  return Math.round((((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1000);
}

// The summed CPU time (ms) and memory (bytes) of every herdr* process; null when there are none.
export function parseHerdrProcs(platform, stdout) {
  let cpuMs = 0, mem = 0, n = 0;
  for (const line of String(stdout ?? "").split("\n")) {
    if (platform === "windows") {
      const p = line.trim().split(","); // trim also drops a trailing CR
      if (p.length !== 4 || !/^herdr/i.test(p[0])) continue;
      const [ws, ms] = [Number(p[2]), Number(p[3])];
      if (!Number.isFinite(ws) || !Number.isFinite(ms) || p[2] === "" || p[3] === "") continue;
      mem += ws; cpuMs += ms; n++;
    } else {
      const m = /^\s*\d+\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!m) continue;
      const exe = m[3].split(/\s/)[0].split("/").pop();
      const ms = psTimeMs(m[2]);
      if (!/^herdr/i.test(exe) || ms === null) continue;
      mem += Number(m[1]) * 1024; cpuMs += ms; n++;
    }
  }
  return n ? { cpuMs, mem } : null;
}

// Herdr's CPU % of the whole machine between two parsed samples (null without a previous one).
export function herdrUsage(prev, cur, elapsedMs, cores, now) {
  if (!prev || !(elapsedMs > 0) || !(cores > 0)) return { cpu: null, mem: cur.mem, at: now };
  return { cpu: Math.round(Math.min(100, Math.max(0, 100 * (cur.cpuMs - prev.cpuMs) / (elapsedMs * cores))) * 10) / 10, mem: cur.mem, at: now };
}
