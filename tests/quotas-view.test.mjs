import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaRows, quotaGroups, iconBadge, barLevel, PROVIDERS } from "../src/mods/dock-quotas/view.js";

const S = (o = {}) => ({ fetchedMs: 1_000_000, stale: false, sessions: new Map(),
  windows: [{ kind: "five_hour", usedPercent: 5, resetsMs: 1_000_000 + 7_500_000 }], ...o });
const CLAUDE = PROVIDERS.find((p) => p.id === "claude");
const CODEX = PROVIDERS.find((p) => p.id === "codex");

test("providers: Claude then Codex, each naming its source", () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["claude", "codex"]);
  assert.equal(CLAUDE.title, "Claude"); assert.equal(CLAUDE.source, "Claude status line");
  assert.equal(CODEX.title, "Codex"); assert.equal(CODEX.source, "Codex session logs");
});
test("quotaRows formats windows (the group header names the provider)", () => {
  const [r] = quotaRows(S(), 1_000_000 + 30_000, CLAUDE);
  assert.equal(r.label, "5-hour"); assert.equal(r.value, "5% used");
  assert.match(r.detail, /^resets in 2h 04m · just now$/);
  assert.equal(r.stale, false); assert.equal(r.percent, 5);
  assert.equal(r.tooltip, "Claude · 5-hour: 5% used · resets in 2h 04m · just now · source: Claude status line");
});
test("quotaRows weekly label, null reset", () => {
  const [r] = quotaRows(S({ windows: [{ kind: "weekly", usedPercent: 40, resetsMs: null }] }), 1_060_000, CODEX);
  assert.equal(r.label, "weekly");
  assert.equal(r.detail, "1m ago");
  assert.equal(r.tooltip, "Codex · weekly: 40% used · 1m ago · source: Codex session logs");
});
test("a stale reading marks every row stale", () => {
  const rows = quotaRows(S({ stale: true }), 2_000_000, CLAUDE);
  assert.ok(rows.every((r) => r.stale));
});
test("quotaGroups: one group per provider with usage, in provider order; none recorded hides the provider", () => {
  const g = quotaGroups({ codex: S({ windows: [{ kind: "weekly", usedPercent: 31, resetsMs: null }] }), claude: S() }, 1_030_000);
  assert.deepEqual(g.map((x) => [x.id, x.title, x.rows.length]), [["claude", "Claude", 1], ["codex", "Codex", 1]]);
  assert.deepEqual(quotaGroups({ claude: null, codex: S() }, 1_030_000).map((x) => x.id), ["codex"]);
  // A Claude cache with sessions but no windows has nothing for Quotas.
  assert.deepEqual(quotaGroups({ claude: S({ windows: [] }), codex: null }, 0), []);
  assert.deepEqual(quotaGroups({}, 0), []);
});
test("barLevel", () => {
  assert.equal(barLevel(69.9), "ok"); assert.equal(barLevel(70), "warn"); assert.equal(barLevel(89.9), "warn"); assert.equal(barLevel(90), "high");
});
test("iconBadge: the highest used % across providers, stale with the reading it came from", () => {
  const w = [{ kind: "five_hour", usedPercent: 14 }, { kind: "weekly", usedPercent: 62.4 }];
  assert.deepEqual(iconBadge([S({ windows: w })]), { text: "62%", stale: false });
  assert.deepEqual(iconBadge([S({ windows: w, stale: true })]), { text: "62%", stale: true });
  assert.deepEqual(iconBadge([S({ windows: w }), S({ windows: [{ kind: "weekly", usedPercent: 80 }], stale: true })]), { text: "80%", stale: true });
  assert.equal(iconBadge([null, null]), null);
  assert.equal(iconBadge([]), null);
  assert.equal(iconBadge([S({ windows: [] })]), null);
  assert.deepEqual(iconBadge([S({ windows: [{ kind: "five_hour", usedPercent: NaN }, { kind: "weekly", usedPercent: null }, { kind: "weekly", usedPercent: 7 }] })]), { text: "7%", stale: false });
});

test("a window whose reset time has passed shows as reset, with no bar, and stays out of the badge", () => {
  const now = 5_000_000;
  const old = S({ fetchedMs: 1_000_000, stale: true, windows: [{ kind: "weekly", usedPercent: 95, resetsMs: 4_000_000 }] });
  const [r] = quotaRows(old, now, CODEX);
  assert.equal(r.value, "reset");
  assert.equal(r.percent, null);
  assert.match(r.detail, /^reset · /);
  const fresh = S({ fetchedMs: now, windows: [{ kind: "five_hour", usedPercent: 40, resetsMs: now + 60_000 }] });
  assert.deepEqual(iconBadge([fresh, old], now), { text: "40%", stale: false });
  assert.equal(iconBadge([old], now), null);
});

// ---- Limits from the claude CLI: per-model rows, pace, plan, source ----
test("quotaRows: a model's own weekly limit, the pace tick, the CLI as the source", () => {
  const now = Date.parse("2026-11-22T14:00:00Z");
  const cli = { source: "cli", plan: "team", fetchedMs: now, stale: false, windows: [
    { kind: "five_hour", usedPercent: 14, resetsMs: now + 3600e3, durationMs: 5 * 3600e3 },
    { kind: "model", label: "Fable", usedPercent: 3, resetsMs: now + 3.5 * 86400e3, durationMs: 7 * 86400e3 }] };
  const [five, fable] = quotaRows(cli, now, CLAUDE);
  assert.equal(five.pace, 0.8);
  assert.equal(fable.label, "weekly · Fable");
  assert.equal(fable.pace, 0.5);
  assert.match(five.tooltip, /source: Claude Code \(\/usage\)$/);
  assert.match(five.tooltip, /80% of the window has passed/);
  // A status-line reading has no window length: no tick, and it names the status line.
  const [sl] = quotaRows(S(), 1_000_000, CLAUDE);
  assert.equal(sl.pace, null);
  assert.match(sl.tooltip, /source: Claude status line$/);
});

test("quotaGroups: Claude's group carries the plan", () => {
  const now = 1_000_000;
  const cli = { source: "cli", plan: "claude_max_20x", fetchedMs: now, stale: false, windows: [{ kind: "weekly", usedPercent: 1, resetsMs: null, durationMs: 1 }] };
  assert.equal(quotaGroups({ claude: cli }, now)[0].plan, "Max 20x");
  assert.equal(quotaGroups({ claude: S() }, now)[0].plan, null);
});

// ---- One line per window: label, bar, usage, reset ----
import { shortReset } from "../src/mods/dock-quotas/view.js";

test("shortReset: the time left, short, for a one-line row", () => {
  const now = 1_000_000;
  assert.equal(shortReset(now + 7_440_000, now), "2h 04m");
  assert.equal(shortReset(now + (5 * 86400 + 5 * 3600 + 30 * 60) * 1000, now), "5d 5h");
  assert.equal(shortReset(now + 38 * 60e3, now), "38m");
  assert.equal(shortReset(now + 20e3, now), "<1m");
  assert.equal(shortReset(null, now), null);
  assert.equal(shortReset(now - 1, now), null);
});

test("quotaRows: the one-line usage and reset, and the full detail in the tooltip", () => {
  const [r] = quotaRows(S(), 1_000_000 + 30_000, CLAUDE);
  assert.equal(r.usage, "5%");
  assert.equal(r.reset, "2h 04m");
  assert.match(r.tooltip, /resets in 2h 04m · just now/);
  const [reset] = quotaRows(S({ windows: [{ kind: "five_hour", usedPercent: 50, resetsMs: 999_000 }] }), 1_000_000, CLAUDE);
  assert.equal(reset.usage, "reset");
  assert.equal(reset.reset, null);
});
