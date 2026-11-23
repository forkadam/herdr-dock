// The sprint board's pure model (no host imports): the board's columns by status name, the sprint to open on, the
// sprint menu, lanes by parent story, what a drop on a column can do and a sprint's one-line label.
// Sprint = { id, name, state: "active" | "future" | "closed", startMs, endMs } (client.js sprints()).

const DAY_MS = 86400000;
const KEEP_CLOSED = 5;
const num = (v) => (Number.isFinite(v) ? v : null);
const list = (v) => (Array.isArray(v) ? v : []);

// ---- Columns ----

// The board's columns as { name, statuses } with the statuses' names, from the board configuration's ids. An id no
// status has is skipped; a column without any stays (it's still a drop target in Jira).
export function sprintColumns(columns, statuses) {
  const names = new Map(list(statuses).map((s) => [String(s?.id), s?.name]));
  return list(columns).map((c) => ({
    name: String(c?.name ?? ""),
    statuses: list(c?.statusIds).map((id) => names.get(String(id))).filter((n) => typeof n === "string" && n),
  }));
}

// ---- Which sprint ----

// Earliest start first; a sprint without one after the dated ones; then the lowest id.
const earliest = (a, b) => (num(a.startMs) ?? Infinity) - (num(b.startMs) ?? Infinity) || a.id - b.id;
// Newest first by start (a sprint without one is a future one, so the newest); a tie: the higher id.
const newest = (a, b) => {
  const x = num(a.startMs) ?? Infinity, y = num(b.startMs) ?? Infinity;
  return x === y ? b.id - a.id : y - x;
};

// The active sprint to open on: the one holding most of your issues (`mineBySprint`: sprint id -> your count), a tie
// (all zero included) the earliest start. Null without an active sprint.
export function pickSprint(active, mineBySprint) {
  const mine = (s) => mineBySprint?.get?.(s.id) ?? 0;
  const sorted = [...list(active)].sort((a, b) => mine(b) - mine(a) || earliest(a, b));
  return sorted[0] ?? null;
}

// The sprint's series: its name with the last number as "#" ("Lapras Sprint 19" -> "Lapras Sprint #"); null when the
// name has no number (a plain "Planning" sprint belongs to no series).
export function seriesKey(name) {
  const text = String(name ?? "");
  return /\d/.test(text) ? text.replace(/\d+(?!.*\d)/, "#").trim() : null;
}

// The sprint menu for `current`, newest first: in its series the next future sprint, the active one(s) and the last 5
// closed (by end); a sprint without a number in its name has no series, so every sprint holding some of yours. The
// current sprint is always listed.
export function sprintSeries(current, sprints, mineBySprint) {
  if (!current) return [];
  const all = list(sprints);
  const key = seriesKey(current.name);
  let picked;
  if (key === null) {
    picked = all.filter((s) => (mineBySprint?.get?.(s.id) ?? 0) > 0);
  } else {
    const same = all.filter((s) => seriesKey(s.name) === key);
    const rank = (s) => num(s.endMs) ?? num(s.startMs) ?? -Infinity;
    const closed = same.filter((s) => s.state === "closed").sort((a, b) => rank(b) - rank(a) || b.id - a.id).slice(0, KEEP_CLOSED);
    const next = same.filter((s) => s.state === "future").sort(earliest).slice(0, 1);
    picked = [...next, ...same.filter((s) => s.state === "active"), ...closed];
  }
  return [...new Map([...picked, current].map((s) => [s.id, s])).values()].sort(newest);
}

// ---- Lanes ----

// The sprint's rows as lanes, one per parent story in order of first appearance, then the rows without a parent
// (parent null, "Other issues"). When the parent is itself one of the rows, the lane's header takes that row's own
// key, summary and status, and that row isn't a card anywhere. A lane's `parent` comes from its first child.
export function sprintRows(rows) {
  const all = list(rows);
  const own = new Map(all.map((r) => [r?.key, r]));
  const parents = new Set(all.map((r) => r?.parent?.key).filter(Boolean));
  const lanes = new Map();
  const loose = [];
  for (const row of all) {
    if (!row || parents.has(row.key)) continue;
    const p = row.parent;
    if (!p?.key) { loose.push(row); continue; }
    if (!lanes.has(p.key)) {
      const head = own.get(p.key) ?? p;
      lanes.set(p.key, { parent: { key: head.key, summary: head.summary, status: head.status }, rows: [] });
    }
    lanes.get(p.key).rows.push(row);
  }
  return [...lanes.values(), ...(loose.length ? [{ parent: null, rows: loose }] : [])];
}

// ---- Drops ----

// A drop on a board column (several statuses): { kind: "run", transition } when one move leads into one of its
// statuses, { kind: "choose", transitions } when several do, { kind: "none" } when none does or when the card is
// already in that column (a drop on its own column never changes its status, as on Jira's board). dropPlan's sibling
// (page.js), for a column instead of one status.
export function columnDrop(transitions, column, current) {
  const into = new Set(list(column?.statuses));
  if (into.has(current)) return { kind: "none" };
  const ways = list(transitions).filter((t) => t?.to?.name && into.has(t.to.name));
  if (!ways.length) return { kind: "none" };
  return ways.length === 1 ? { kind: "run", transition: ways[0] } : { kind: "choose", transitions: ways };
}

// ---- Label ----

const shortDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
// The local calendar day of a time, as a UTC day number (so a day is exactly DAY_MS, daylight saving or not).
const dayOf = (ms) => { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };

// "Sprint 42 · Nov 16 – Nov 27 · 5 days left": the name, the dates and how long is left, counted in local calendar
// days. "· ends today" on the end date, "· ended" from the end on, or whenever the sprint is closed. Just the name
// when it has no (both) dates.
export function sprintLabel(sprint, now) {
  const name = String(sprint?.name ?? "");
  const start = num(sprint?.startMs), end = num(sprint?.endMs);
  if (start === null || end === null) return name;
  const head = `${name} · ${shortDate(start)} – ${shortDate(end)}`;
  if (sprint.state === "closed" || end - now <= 0) return `${head} · ended`;
  const days = Math.round((dayOf(end) - dayOf(now)) / DAY_MS);
  if (days <= 0) return `${head} · ends today`;
  return `${head} · ${days} ${days === 1 ? "day" : "days"} left`;
}
