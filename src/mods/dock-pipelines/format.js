// Pure formatting for the Pipelines panel (no host imports: node --test runs it).

// "3m ago" for an ISO time before `now` (ms). Under a minute, or a little ahead (clock skew): "just now".
// A missing or unparsable time gives "".
export function ago(createdAt, now) {
  const at = createdAt == null ? NaN : Date.parse(createdAt);
  if (!Number.isFinite(at)) return "";
  const sec = Math.floor((now - at) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A job's duration in seconds as "45s", "2m14s" or "1h03m". Missing or negative gives "".
export function duration(sec) {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  if (s < 60) return `${s}s`;
  const pad = (n) => String(n).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}m`;
}

// Retry only makes sense for a finished pipeline that didn't pass.
export function canRetry(status) {
  return status === "failed" || status === "canceled";
}
