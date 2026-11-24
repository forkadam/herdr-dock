# Dock layout dialog: a Browser section — design

Date: 2026-11-24. Status: designed, not built. Builds on `2026-11-23-dock-browser-design.md` (the Browser panel,
`dock-browser`, opt-in through `browser.enabled`).

## Intent

The Browser panel is off by default and can only be turned on by editing a settings file and deploying. The Dock
layout dialog lists only installed mods, and "off means absent" (nothing of the browser is installed while it's off),
so a new user never sees it. In the user's words: "otherwise how does a newly installed herdr-dock user know how to
access it". The dialog gets a **Browser** section where anyone can find the browser, see what turning it on costs, and
turn it on or off with a click.

## What exists (the builder's starting point)

- `browser` settings: `enabled` (default false), `chrome` (path; empty downloads Chrome for Testing, ~150 MB),
  `production` (host patterns), `handoffMinutes` (default 15). Read merged from `config/dock.json` and this PC's
  `local.json` by `browserOf(merged)` (`src/shared/browser/config.js`).
- When `enabled`, the merged config already puts `dock-browser` at the end of the right region
  (`src/shared/config.js:123`, `withBrowserFeature`).
- **Clone install:** `npm run deploy` installs `mods/dock-browser`, downloads agent-browser (~20 MB, pinned checksum)
  into `<app home>/herdr-dock/browser/bin/`, gets Chrome unless `chrome` is set, and writes the `dock-browser` skill to
  `~/.claude/skills`, `~/.codex/skills` (and `~/.gemini/config/skills` where it exists); with `enabled: false` it removes
  the mod, the binary and the skills. A plain deploy also runs the Claude status-line setup (its documented default;
  the Updates strip's `npm run update` does the same).
- **App install:** `mods/dock-browser` ships with the app; `node <app home>/mods/dock-browser/herdr-browser-setup.mjs`
  reads the merged settings and installs or removes (agent-browser, Chrome, skills); `--check` only reports.
- **The dialog** (`src/mods/dock-config/`) edits a draft of the layout and writes this PC's
  `<app home>/herdr-dock/local.json` on **Save** (never `config/dock.json`), guarding against a file changed on disk.
  Its **Updates** strip runs an action at once: it opens a Herdr tab that runs the update (clone: the repo's script;
  app: the shipped `update-app.mjs`, `update-view.js`).

## Goals

A **Browser** section in the Dock layout dialog, right below the Updates strip, for every user:

```
Off:        Browser  ○ Off   Let agents open and drive a real browser beside the terminal.
                     Turning it on downloads agent-browser (~20 MB) and, without a Chrome,
                     Chrome for Testing (~150 MB).
                     Chrome: ● Google Chrome (found on this PC)   ○ Download Chrome for Testing
                     [ Turn on ]

On:         Browser  ● On · Google Chrome                                      [ Turn off ]
                     Production hosts [ example.com, *.example.com            ]
                     Agents get a warning on these sites; nothing is blocked.

Not set up: Browser  ● On · not set up (agent-browser missing)                 [ Set up ]
Running:    Browser  Setting up… see the "Set up the browser" tab
```

- **Turn on / Set up / Turn off** act at once, like Update (not part of the draft):
  1. write only the `browser` keys to this PC's `local.json` — `enabled` (true / false), and `chrome` (the found
     path when chosen; removed when "Download" is chosen) — keeping every other key, with the same on-disk guard as
     Save; any unsaved layout edits stay in the draft, unsaved;
  2. open a Herdr tab **Set up the browser** running: clone → `npm run deploy` in the repo; app →
     `node <app home>/mods/dock-browser/herdr-browser-setup.mjs`. The tab shows the downloads and the result.
- **Production hosts:** one text field, patterns separated by commas or spaces (`example.com`, `*.example.com`),
  shown when the browser is on; saved with the dialog's **Save** as `browser.production` (part of the draft, like the
  other edits). A malformed pattern is an error on the field and Save is refused until it's fixed.
- **Chrome found on this PC:** the first existing path from a per-platform list — macOS: Google Chrome, Chromium,
  Google Chrome Canary under `/Applications`; Windows: `chrome.exe` under Program Files, Program Files (x86) and Local
  AppData `Google\Chrome\Application`; Linux: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`
  on PATH. None found → only "Download Chrome for Testing". A `chrome` already set in the settings is shown as the
  choice when it exists.
- **Status from a setup result (my call, mirrors the Updates strip's `update-result.json`).** Files alone can't tell
  "still running" from "failed" or "tab closed", so every setup run records its outcome in
  `<app home>/herdr-dock/browser/setup-result.json`:
  - at start `{ "state": "running", "startedAt": <ms>, "action": "on" | "off" }`;
  - at the end `{ "state": "ok" | "failed" | "unsupported", "at": <ms>, "action", "message" }`, where `message` is the
    failure's first line (for example "Chrome for Testing couldn't be downloaded", "no agent-browser build for this
    computer").
  - Writers: the browser step of `scripts/deploy.mjs` (clone) and `herdr-browser-setup.mjs`
    (`src/app/browser-install.js`, app install). A Chrome that fails or a configured `chrome` path that's missing is
    `failed`, not `ok`.
  - The section's states, from the merged settings plus that file (re-read when the dialog opens and every few
    seconds while a run is `running`):

    | State | When | Shows |
    |---|---|---|
    | Off | `enabled` false, no run | Off copy, Chrome choice, **Turn on** |
    | Running | result `running`, started < 15 min ago | "Setting up…" / "Turning off…", see the tab |
    | On | `enabled`, mod + binary present, last result `ok` | "On · <Chrome>", production hosts, **Turn off** |
    | Failed | last result `failed` | its message, **Set up again** (or **Turn off**) |
    | Not here | last result `unsupported` | "Not available on this computer", **Turn off** |
    | Not set up | `enabled`, mod or binary missing, no result (settings edited by hand) | **Set up** |

    A `running` result older than 15 minutes counts as failed ("the setup tab was closed or stopped").
  - While a browser run or an update (the Updates strip's state) is running, **Turn on / Turn off / Set up** are
    disabled, so two deploys never overlap.
- **Reset keeps the browser (my call).** "Reset this PC to shared" resets the layout only: it keeps the `browser`
  block in `local.json` (today `planReset` writes `{ v: 1, regions: {} }` and would drop `enabled`, `chrome` and
  `production`). The browser is per PC and has its own **Turn off**.
- **The layout views follow the Browser section (my call).** In By mod and By region, `dock-browser` can still be
  moved between regions, but its **Off** is disabled with the tip "Turn the browser off in the Browser section"
  (`withBrowserFeature` would put it back anyway). While the browser is off, `dock-browser` isn't offered for
  placing (in an app install it ships with the app and would otherwise look placeable).

## Non-goals

- `handoffMinutes` and the skills choice (`--no-skills`) stay in the settings file with their defaults.
- `browse login` (saving signed-in cookies) stays a terminal command; the section can mention it in one line.
- No `config/dock.json` editing: the browser is per PC.

## Anti-goals

- Downloading anything without the user's click.
- Writing `config/dock.json`, or losing / silently saving the user's unsaved layout edits.
- Company specifics in code, tests, README or RECIPE.

## Approaches

- **A. Essentials (chosen, with production hosts added):** status, on/off, which Chrome, production hosts. Covers
  discovery and the one safety setting; the rest keeps defaults.
- **B. Everything:** also handoff minutes and per-agent skills. More to build and more for a new user to read.
- **C. A hint only** ("a Browser panel exists — see the README"): discoverable but still needs the file; doesn't meet
  the intent.

The user chose **A plus production hosts** on 2026-11-24.

## Left to the builder

- Exact copy and layout within the sketch; where the section's pure decisions live (a new `browser-view.js` beside
  `update-view.js` is the expected shape) and their tests.
- The poll interval while running; how the result file is written safely (whole-file write is enough).
- The exact per-platform Chrome path list beyond the ones named; how existence is checked (the dialog's existing
  injected I/O).
- README (Browser → Turning it on) and `app/RECIPE.md` updates: the dialog is now the first way to turn it on.
