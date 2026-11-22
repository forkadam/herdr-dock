#!/usr/bin/env node
// Antigravity's status line -> herdr-dock's Quotas. The agy CLI pipes its state (JSON) to its status-line command on
// every update; this keeps only the plan and the quota buckets (remaining fraction, reset time) in
// ~/.gemini/antigravity-cli/statusline-cache/agy-statusline.json. No paths, prompts or account details.
// Never throws and never prints, so the status line can't break; --tee writes the input back unchanged, to sit in
// front of a status line of your own: `node herdr-agy-statusline.mjs --tee | your-status-line`.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".gemini", "antigravity-cli", "statusline-cache");
const FILE = join(DIR, "agy-statusline.json");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function main(raw) {
  const event = JSON.parse(raw.slice(0, 1 << 20).replace(/^﻿+/, ""));
  if (!isObj(event)) return;
  let prev = {};
  try { prev = JSON.parse(readFileSync(FILE, "utf8")); } catch { prev = {}; }
  const buckets = {};
  if (isObj(event.quota)) {
    for (const [key, b] of Object.entries(event.quota)) {
      if (!/^[\w.-]{1,64}$/.test(key) || !isObj(b) || num(b.remaining_fraction) === null) continue;
      buckets[key] = { remaining_fraction: b.remaining_fraction, reset_time: typeof b.reset_time === "string" ? b.reset_time : null };
    }
  }
  const have = Object.keys(buckets).length > 0;
  const out = {
    provider: "antigravity", source: "agy-statusline",
    plan: typeof event.plan_tier === "string" ? event.plan_tier.slice(0, 64) : prev.plan ?? null,
    fetched_at_unix: have ? Date.now() / 1000 : num(prev.fetched_at_unix) ?? Date.now() / 1000,
    buckets: have ? buckets : isObj(prev.buckets) ? prev.buckets : {},
  };
  mkdirSync(DIR, { recursive: true });
  const tmp = join(DIR, `.agy-statusline-${process.pid}-${Date.now()}`);
  try { writeFileSync(tmp, JSON.stringify(out)); renameSync(tmp, FILE); } finally { try { rmSync(tmp, { force: true }); } catch {} }
}

let raw = "";
try { raw = readFileSync(0, "utf8"); main(raw); } catch { /* never break the status line */ }
if (process.argv.includes("--tee")) { try { process.stdout.write(raw); } catch {} }
