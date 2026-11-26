// Pure rules for keeping CI polling inside a host's API rate limit, and the resume time the dock shows for a pause.
// No I/O: the CI client reads the headers and sleeps; these functions only decide.

// Header values are untrusted text: only plain digits count, so "0x10", "1e3" and "-1" are treated as missing (NaN).
export function plainInt(v) {
  return v != null && /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN;
}

// The remaining/limit pair from a response's headers; both hosts report the reset as epoch seconds.
// Without a numeric pair there is nothing to budget against, so the answer is null.
export function readLimit(get, provider) {
  const prefix = provider === "gitlab" ? "ratelimit-" : "x-ratelimit-";
  const remaining = plainInt(get(`${prefix}remaining`));
  const limit = plainInt(get(`${prefix}limit`));
  if (!Number.isFinite(remaining) || !Number.isFinite(limit)) return null;
  const reset = plainInt(get(`${prefix}reset`));
  return { remaining, limit, resetAt: Number.isFinite(reset) ? reset * 1000 : null };
}

// How long to stop calling the host, in ms; 0 when the answer is not a limit answer. remaining and retryAfter
// (seconds) may be raw header text. A spent budget (remaining 0) waits for the reset. With calls left, a 429 (or a
// 403 with retry-after) is a short-term "secondary" limit: it waits retry-after, never the hourly reset. Any other
// 403 is a permission error that waiting won't fix.
export function pauseFor({ status, remaining, resetAt, retryAfter, now }) {
  if (status !== 429 && status !== 403) return 0;
  const wait = plainInt(retryAfter);
  const after = Number.isFinite(wait) ? wait * 1000 : null;
  let ms;
  if (plainInt(remaining) === 0) ms = resetAt != null ? resetAt - now : after ?? 60000;
  else if (status === 429 || after != null) ms = after ?? 60000;
  else return 0;
  return ms > 0 ? ms : 30000;
}

export function isLow(b) {
  return Boolean(b && b.limit > 0 && b.remaining / b.limit < 0.1);
}

// The CLI route (gh / glab) gives no headers, only text, so the limit is recognised from the message.
export function cliLimited(text) {
  return /rate limit|too many requests|\bHTTP 429\b/i.test(String(text ?? ""));
}

// A 403 whose headers don't make it a limit (calls left, no retry-after) may still be one: GitHub's secondary limits
// can answer that way and say so only in the message (from memory, unverified). A 403 without such text stays a
// permission error.
export function bodyLimited(text) {
  return /rate limit/i.test(String(text ?? ""));
}

// The local HH:MM a limit pause ends (ms), rounded up to the next minute: a pause until 15:46:50 says 15:47, so the
// time shown is never before the pause really ends.
export function resumeClock(ms) {
  const d = new Date(Math.ceil(ms / 60000) * 60000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A small least-recently-used map; Map keeps insertion order, so re-inserting on get/set refreshes an entry.
export function lru(max) {
  const m = new Map();
  return {
    get(k) {
      if (!m.has(k)) return undefined;
      const v = m.get(k);
      m.delete(k);
      m.set(k, v);
      return v;
    },
    set(k, v) {
      m.delete(k);
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value);
    },
    delete(k) {
      m.delete(k);
    },
    get size() {
      return m.size;
    },
  };
}
