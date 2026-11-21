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
  assert.equal(r.tooltip, "Claude · 5-hour: 5% used · source: Claude status line");
});
test("quotaRows weekly label, null reset", () => {
  const [r] = quotaRows(S({ windows: [{ kind: "weekly", usedPercent: 40, resetsMs: null }] }), 1_060_000, CODEX);
  assert.equal(r.label, "weekly");
  assert.equal(r.detail, "1m ago");
  assert.equal(r.tooltip, "Codex · weekly: 40% used · source: Codex session logs");
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
