import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaRows, iconBadge, barLevel } from "../src/mods/dock-quotas/view.js";

const S = (o = {}) => ({ fetchedMs: 1_000_000, stale: false, sessions: new Map(),
  windows: [{ kind: "five_hour", usedPercent: 5, resetsMs: 1_000_000 + 7_500_000 }], ...o });

test("quotaRows formats windows", () => {
  const [r] = quotaRows(S(), 1_000_000 + 30_000);
  assert.equal(r.label, "Claude · 5-hour"); assert.equal(r.value, "5% used");
  assert.match(r.detail, /^resets in 2h 04m · just now$/);
  assert.equal(r.stale, false); assert.equal(r.percent, 5);
});
test("quotaRows weekly label, null reset", () => {
  const [r] = quotaRows(S({ windows: [{ kind: "weekly", usedPercent: 40, resetsMs: null }] }), 1_060_000);
  assert.equal(r.label, "Claude · weekly");
  assert.equal(r.detail, "1m ago");
});
test("quotaRows with no data", () => {
  assert.deepEqual(quotaRows(null, 0), [{ label: "Claude", value: "no data", detail: "start Claude Code to report usage", stale: false }]);
});
test("a stale reading marks every row stale", () => {
  const rows = quotaRows(S({ stale: true }), 2_000_000);
  assert.ok(rows.every((r) => r.stale));
});
test("topUsed and barLevel", () => {
  assert.equal(barLevel(69.9), "ok"); assert.equal(barLevel(70), "warn"); assert.equal(barLevel(89.9), "warn"); assert.equal(barLevel(90), "high");
});
test("iconBadge", () => {
  const w = [{ kind: "five_hour", usedPercent: 14 }, { kind: "weekly", usedPercent: 62.4 }];
  assert.deepEqual(iconBadge(S({ windows: w })), { text: "62%", stale: false });
  assert.deepEqual(iconBadge(S({ windows: w, stale: true })), { text: "62%", stale: true });
  assert.equal(iconBadge(null), null);
  assert.equal(iconBadge(S({ windows: [] })), null);
  assert.deepEqual(iconBadge(S({ windows: [{ kind: "five_hour", usedPercent: NaN }, { kind: "weekly", usedPercent: null }, { kind: "weekly", usedPercent: 7 }] })), { text: "7%", stale: false });
  assert.equal(iconBadge(S({ windows: [{ kind: "weekly", usedPercent: NaN }] })), null);
});
