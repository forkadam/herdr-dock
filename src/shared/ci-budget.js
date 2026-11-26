// Pure rules for keeping CI polling inside a host's API rate limit. No I/O: the CI client reads the headers and
// sleeps; these functions only decide.

// Header values are untrusted text: only plain digits count, so "0x10", "1e3" and "-1" are treated as missing.
const num = (v) => (v != null && /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);

// The remaining/limit pair from a response's headers; both hosts report the reset as epoch seconds.
// Without a numeric pair there is nothing to budget against, so the answer is null.
export function readLimit(get, provider) {
  const prefix = provider === "gitlab" ? "ratelimit-" : "x-ratelimit-";
  const remaining = num(get(`${prefix}remaining`));
  const limit = num(get(`${prefix}limit`));
  if (!Number.isFinite(remaining) || !Number.isFinite(limit)) return null;
  const reset = num(get(`${prefix}reset`));
  return { remaining, limit, resetAt: Number.isFinite(reset) ? reset * 1000 : null };
}

// How long to stop calling the host, in ms; 0 when the answer is not a limit answer. A 403 only counts as a limit
// when the budget is exhausted, since other 403s are permission errors that waiting won't fix.
export function pauseFor({ status, remaining, resetAt, retryAfter, now }) {
  if (!(status === 429 || (status === 403 && remaining != null && Number(remaining) === 0))) return 0;
  const ms = resetAt != null ? resetAt - now : retryAfter != null ? retryAfter * 1000 : 60000;
  return ms > 0 ? ms : 30000;
}

export function isLow(b) {
  return Boolean(b && b.limit > 0 && b.remaining / b.limit < 0.1);
}

// The CLI route (gh / glab) gives no headers, only text, so the limit is recognised from the message.
export function cliLimited(text) {
  return /rate limit|too many requests|\bHTTP 429\b/i.test(String(text ?? ""));
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
