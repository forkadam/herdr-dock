// The system item's tooltips (pure): the system figure, plus Herdr's own use when its sample is under 30 s old.
const HERDR_MAX_AGE_MS = 30000;
const MIB = 2 ** 20;
const GIB = 2 ** 30;

// Bytes as MB under 1 GiB, else GB with one decimal (2 GB, 1.5 GB).
function size(bytes) {
  return Math.round(bytes / MIB) < 1024 ? `${Math.round(bytes / MIB)} MB` : `${Math.round((bytes / GIB) * 10) / 10} GB`;
}

export function systemTips(sample, herdr, now) {
  const cpu = `CPU ${Math.round(sample.cpu)}%`;
  const mem = `Memory ${Math.round(sample.mem)}%`;
  const fresh = herdr && Number.isFinite(herdr.at) && now - herdr.at < HERDR_MAX_AGE_MS;
  if (!fresh) return { cpu, mem };
  return {
    cpu: typeof herdr.cpu === "number" && Number.isFinite(herdr.cpu) ? `${cpu} · Herdr ${herdr.cpu}%` : cpu,
    mem: typeof herdr.mem === "number" && Number.isFinite(herdr.mem) ? `${mem} · Herdr ${size(herdr.mem)}` : mem,
  };
}
