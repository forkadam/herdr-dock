# Bottom bar revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show the full branch name, put notifications at the far right, use icons for CPU/RAM, and show Herdr's own CPU and memory on hover.

**Architecture:** dock-core gets a second sampler, every 10 s, for Herdr's processes (pure parsing in `src/shared/system.js`), publishing `dock.system.herdr`. dock-system draws icons and puts the Herdr figures in tooltips. The bottom region's default order changes.

**Tech Stack:** Herdr mods, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-22-bottom-bar-design.md` (section "Revision 2026-11-22").

## Global Constraints

- Order: `dock-where` (no size, takes the rest), `dock-warnings` 210, `dock-system` 150, `dock-attention` 190.
- Herdr sample every **10 s**. Windows: `powershell -NoProfile -NonInteractive -Command "Get-Process -Name herdr* | …"`. macOS/Linux: `ps -A -o pid=,rss=,time=,comm=`, filtered to `comm` containing `herdr`.
- `dock.system.herdr = { cpu, mem, at }`. `cpu` is 0–100, rounded, as a whole-machine share: delta CPU ms / (elapsed ms × cores) × 100. `mem` is in bytes. Tooltips leave it out when it's older than 30 s.
- Tooltips: `CPU 34% · Herdr 2%`, `Memory 61% · Herdr 210 MB` (MB rounded; `GB` with one decimal at ≥ 1024 MB).
- `config/dock.json`: commit only the base hunk. Build it from `git show HEAD:config/dock.json` and stage with `git update-index --cacheinfo`. Never commit `machines.*`.

## Review Focus

- First Herdr sample (no previous one): CPU is unknown, so the tooltip shows only Herdr's memory, never `NaN%`. Task 1 test: `herdrUsage: no previous sample gives cpu null`.
- A Herdr process restarting between samples (its CPU time goes down): never a negative CPU %, and never over 100. Task 1 test: `herdrUsage: clamps to 0–100`.
- PowerShell missing or failing: the tooltip has no Herdr part, and the failure is logged once, not every 10 s (Task 1 wiring).
- Windows locale decimal commas: the PowerShell command prints integers only (`[int64]` ms and bytes), so parsing never depends on locale. Task 1 test on integer-only lines.
- A very long branch name on a narrow window: dock-where truncates only when there really isn't room, and the tooltip still shows the full name.

---

### Task 1: Herdr process sample

**Files:** Modify `src/shared/system.js`, `src/mods/dock-core/main.js`. Test `tests/system.test.mjs`.

**Interfaces — Produces:**
- `HERDR_KEY = "dock.system.herdr"`
- `herdrSampleCommand(platform) -> { command, args }`. On Windows it prints one line per process: `name,pid,workingSetBytes,cpuMs`, all integers.
- `parseHerdrProcs(platform, stdout) -> { cpuMs: number, mem: number } | null`. Sums all `herdr*` processes. Returns null when there are none or the output is unparseable. On mac/linux, `time` is `[[dd-]hh:]mm:ss[.ff]` and `rss` is in KiB.
- `herdrUsage(prev, cur, elapsedMs, cores, now) -> { cpu: number|null, mem, at }`. With `prev` null, `cpu` is null.
- The system sample (`parseSample`) gains `cores`, from `os.cpus().length` in the sample script.

- [ ] **Step 1: Write the failing tests.**
  - `parseHerdrProcs`:
    - Windows lines are summed.
    - A mac `ps` line `  123  163840 1:02.50 /Applications/Herdr.app/…/herdr-app` gives cpuMs 62500 and mem 163840×1024.
    - A linux `01:02:03` time parses.
    - Non-herdr lines are ignored.
    - Empty output gives null.
  - `herdrUsage: no previous sample gives cpu null`.
  - `herdrUsage: clamps to 0–100`: cpuMs going down gives 0; a huge delta gives 100.
  - `herdrUsage` normal case: 1000 ms over 10000 ms × 4 cores gives 3.
  - `parseSample` keeps `cores`.
- [ ] **Step 2: Run** `node --test tests/system.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions in `system.js`. In dock-core, add a 10 s loop beside the 5 s one:
  - exec `herdrSampleCommand(window()?.platform)` with `timeout: 5000` and parse the output;
  - compute usage from the previous parsed sample and `cores` from `dock.system.sample`;
  - `setShared(HERDR_KEY, …)`;
  - log a failure once, not on every loop.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then `npm run deploy`. Within ~25 s, `dock.system.herdr` appears in `~/.config/herdr-app/shared.json`, with a numeric `cpu` after the second sample.
- [ ] **Step 5: Commit** `feat(system): sample Herdr's own CPU and memory`.

### Task 2: Bar layout and icons

**Files:**
- Modify `src/mods/dock-system/main.js` (and add `cpu.svg`, `memory.svg` in that folder), `src/mods/dock-where/main.js`, `src/shared/config.js` (bottom default), `config/dock.json` (base bottom line only), and `tests/layout.test.mjs` or any config test that pins the default.
- Create `src/mods/dock-system/view.js`.
- Test `tests/bar.test.mjs`.

**Interfaces:**
- Consumes: `SAMPLE_KEY`, `HERDR_KEY` (Task 1).
- Produces: `systemTips(sample, herdr, now) -> { cpu: string, mem: string }` in `dock-system/view.js`.

- [ ] **Step 1: Write the failing tests** for `systemTips`:
  - fresh herdr `{cpu:2, mem:210*2**20}` gives `"CPU 34% · Herdr 2%"` and `"Memory 61% · Herdr 210 MB"`;
  - `mem` of 1.5 GiB gives `"Herdr 1.5 GB"`;
  - herdr `cpu: null` gives the CPU tip `"CPU 34%"`, while the memory tip still has Herdr;
  - herdr older than 30 s, or missing, gives `"CPU 34%"` and `"Memory 61%"`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - dock-system draws `svg(cpu.svg)` + `34%` and `svg(memory.svg)` + `61%` with those tooltips. Each icon-and-value group has an `.id`, which the tooltip needs.
  - dock-where flexes (`flex_1`). It truncates only when out of room and keeps its tooltip.
  - Set the new default order from Global Constraints in `config.js` and in the base line of `config/dock.json`, working copy too. The per-PC section has no bottom override.
- [ ] **Step 4: Run** `npm test`, then `npm run deploy`. Check with `herdr-app shot`: the full branch name, icons with %, and notifications at the far right.
- [ ] **Step 5: Commit** (base hunk of `config/dock.json` only) `feat(bar): full branch name, icon resources with Herdr usage on hover, notifications at the right`.

### Task 3: README

- [ ] Update the README "Bottom bar" section: the new order, the icons, Herdr's usage on hover (what counts as Herdr, every 10 s), and `dock.system.herdr` in the list of per-PC keys. Run `npm test`. Commit `docs(readme): bar revision`.
