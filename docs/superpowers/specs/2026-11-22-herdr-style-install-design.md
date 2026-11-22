# Herdr-style install (the `app/` folder) — design

Date: 2026-11-22. Builds on `2026-11-22-install-update-design.md` (clone install, per-PC local file, the Updates
strip, `npm run update`).

## Intent

Herdr's own way to share a layout is a GitHub folder laid out like the app home. You tell an agent: "Read
~/.config/herdr-app/AGENTS.md, then add this layout: <link>" (see AGENTS.md, "Layouts and mods other people
made"). Cockpit and herdr-nvim work this way.

The user wants herdr-dock to support **both** ways:
- **Clone and deploy** (built): their main way for now, while the repo is private.
- **Herdr's way:**
  `Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/forkadam/herdr-dock/tree/main/app`.

Each install gets updates through the same Updates strip.

## Goals

1. **A committed `app/` folder** in the convention's layout:
   - `layouts/herdr-dock.json`: the default layout, built from the shared `config/dock.json`;
   - `mods/dock-*/`: the built mods (the same bundles deploy installs), plus the app-mode files below;
   - `keys.json`: the dock's keys (Ctrl+Alt+B, Ctrl+Alt+N, Ctrl+Alt+, as deploy adds them);
   - `RECIPE.md`: per the convention's five sections, written from the real files;
   - `preview.png`: a screenshot of herdr-dock;
   - `VERSION.json`: `{ "repo": "forkadam/herdr-dock", "branch": "main", "commit": "<short sha>", "mods": ["dock-…", …] }`.
2. **`npm run build:app`** regenerates `app/`, except `RECIPE.md` and `preview.png`, which are written by hand. A
   test fails when the committed `app/` doesn't match what the build would produce, so it can't drift. Building
   the same source twice gives the same bytes.
3. **dock-core works without a clone (app mode).**
   - **Detecting the mode:** `mods/dock-core/source.json` with a `repo` means a clone install (as now). App mode is
     `source.json` holding `{ "mode": "app" }`, as shipped in `app/`. Deploy overwrites it with the clone form.
   - **Where the config comes from:** the shared default comes from `mods/dock-core/config.json`, a copy of
     `config/dock.json` shipped in the app folder. The per-PC `<app home>/herdr-dock/local.json` works the same in
     both modes. dock-core still writes `layouts/herdr-dock.json` from config plus local, so the Dock layout
     dialog's saves apply in app mode too.
   - **What an app install can't do:** there is no repo, so no git calls and nothing to migrate.
4. **The status-line writer in app mode.** `herdr-statusline-cache.mjs` also ships inside
   `mods/dock-quotas/`. In app mode, the status-line line points at
   `~/.config/herdr-app/mods/dock-quotas/herdr-statusline-cache.mjs`. The README and RECIPE give both lines.
5. **The Updates strip in app mode.**
   - dock-core reads the installed `mods/dock-core/VERSION.json` (a copy of `app/VERSION.json`) and the published
     one: first a plain download of
     `https://raw.githubusercontent.com/<repo>/<branch>/app/VERSION.json`; on failure (the repo is private),
     `gh api repos/<repo>/contents/app/VERSION.json -H "Accept: application/vnd.github.raw"`.
   - If the published `commit` differs, the strip shows `● Update available · <installed> → <published>`. There
     is one notification per new published commit, as in clone mode.
   - If neither download works: `Can't check: <reason>`, for example "gh not logged in" while the repo is private.
   - Same timing as clone mode: at start, every 6 h, and Check now.
6. **Applying an update in app mode (approach C).** Update opens a Herdr tab named `Update herdr-dock`, running
   `node <app home>/mods/dock-core/update-app.mjs`. The script:
   1. clones the repo's branch into a temporary folder: `git clone --depth 1 --branch <branch>
      https://github.com/<repo>.git`, which uses the machine's git credentials (gh's helper while private);
   2. runs `herdr-app check` on every `app/mods/<name>` in that copy and stops before touching anything if any
      check fails;
   3. replaces each `mods/dock-*` listed in the new `VERSION.json` and `layouts/herdr-dock.json`, and removes a
      `dock-*` mod only if the old `VERSION.json` listed it and the new one doesn't;
   4. leaves alone: the person's `keys.json` (it adds only key bindings that are missing, never replaces one),
      `local.json`, and every other mod;
   5. writes the same `update-result.json` that clone mode uses (`{ ok, from, to, commits: null, reason, at }`),
      so the strip and notifications work unchanged;
   6. deletes the temporary folder.
7. **RECIPE "Watch out"** tells an agent:
   - if `mods/dock-core` already exists from a clone install, don't add a second copy under a new name; use
     `npm run update` instead;
   - the mods run programs (git, gh, node, ps or PowerShell) and read files outside their folders (Claude's
     status-line cache, Codex sessions), which step 1 of the convention requires them to say.

## Non-goals

- No herdr.dev listing or public release now; the repo stays private. Everything works through `gh` until it goes
  public, and then through plain downloads with no change.
- No conversion between modes. A machine uses one install. Switching means removing the dock mods and installing
  the other way.

## Anti-goals

- An app-mode update that leaves a mix of old and new mods without saying so. The checks run before anything is
  replaced, and the result file reports any failure.
- An update that touches the person's other mods, their keys, or their per-PC file.
- An `app/` folder that silently falls behind the source.

## Approaches (how an app install applies an update)

- **A. Update opens an agent tab** ("Read AGENTS.md, then update herdr-dock from <link>"). Most Herdr-like, but
  slow, costs tokens every time, and needs an agent set up on that machine.
- **B. dock-core downloads and swaps the files itself.** One click, but dock-core replaces its own folder while
  running, and a failure midway is hard to show.
- **C. A visible tab runs `update-app.mjs` shipped in `app/` (chosen by the user).** It's the same pattern as
  `npm run update`, every mod is checked before any file is swapped, and the result goes back through the existing
  result file.

## Calls made after the builder check (controller's, for the user to check)

1. **What makes an app install "out of date".** A commit can't contain its own sha, so `VERSION.json` holds:
   - `version`: a content hash. It is the first 12 hex digits of a sha256 over every file in `app/` except
     `VERSION.json`, `RECIPE.md` and `preview.png`, taken in sorted path order (each entry: path, NUL, byte length, NUL, content).
   - `source`: the short sha the build ran from. It's for display only.

   An app install is out of date when the published `version` differs from the installed one, so a source commit
   that doesn't change the built files doesn't trigger an update. The strip shows the `source` values
   (`<installed source> → <published source>`). The drift test compares everything except `source`.
2. **The layout file in app mode.**
   - `update-app.mjs` replaces `mods/dock-*` (including `mods/dock-core/config.json`) but **not**
     `layouts/herdr-dock.json`. dock-core rebuilds the layout from `config.json` + `local.json` + this PC's
     right-panel state on its next reload, which a mod update triggers anyway.
   - The shipped `app/layouts/herdr-dock.json` is just a valid starting layout for the first switch. dock-core
     rebuilds it on its first start, so the per-PC file applies straight away.
3. **Name clashes.** The dock mods refer to each other by name: layout `mod` names, `dock-core.*` keys, and
   `mods/dock-core/…` paths. RECIPE "Watch out" tells the agent: **don't rename**. If `mods/dock-core` (or any
   `dock-*` it would add) or `layouts/herdr-dock.json` already exists, stop and ask the person. `update-app` and
   `source.json` assume the original names.
4. **Clone mode doesn't change.**
   - `npm run build:app` runs the existing build into `dist/`, copies the mods into `app/mods/`, then adds the
     app-only files: `mods/dock-core/source.json` `{ "mode": "app" }`, `mods/dock-core/config.json`,
     `mods/dock-core/VERSION.json`, `mods/dock-core/update-app.mjs` and
     `mods/dock-quotas/herdr-statusline-cache.mjs`.
   - It then writes `app/layouts/herdr-dock.json`, `app/keys.json` and `app/VERSION.json`.
   - `buildAll()` and deploy stay as they are.
   - The drift test runs `build:app` into a temporary folder and compares it with `app/`, leaving out the
     hand-written files and `VERSION.json`'s `source` field.
5. **`herdr-app check` with extra files, on a temporary path:** checked live. A built `dock-core` with
   `source.json`, `config.json`, `update-app.mjs` and `VERSION.json` added, in a temporary folder outside the app
   home, passes. So step 6.2 works before any swap.
6. **keys.json.** `app/keys.json` holds only the `layout:herdr-dock` section with the three bindings deploy adds.
   `update-app.mjs` adds a missing binding in that section and skips (and reports) one already in use, the same
   as deploy's `mergeKeys`. That logic is bundled into `update-app.mjs`, which runs without the repo.
7. **The strip in app mode** uses these states: checking, up to date (`herdr-dock <source> · up to date ·
   checked …`), available, updating, updated, failed, and `Can't check: …`. It drops blocked and redeploy, which
   need a clone.
   - `update.js` gets an app-mode state builder.
   - dock-core publishes `mode: "app"|"clone"` in `dock.update.state`, and the dialog picks the Update action by
     mode: `update-app.mjs` in app mode, `scripts/update.mjs` in clone mode.
   - "Updated to …" survives the restart through the same result file, consumed at start.
   - The Git features don't depend on the herdr-dock repo, so they're unaffected.

## Left to the builder

- Byte-for-byte determinism of the esbuild bundles. If it doesn't hold, the drift test compares the bundles with
  the build's own output in a temporary folder.
- `RECIPE.md` wording and the preview screenshot.
- How `update-app.mjs` finds the app home: the folder two levels above its own file.
- Strip wording for app mode within the shapes above.
