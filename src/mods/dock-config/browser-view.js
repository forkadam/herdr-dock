// The Browser section of the Dock layout dialog (pure): which state it shows and the one action it offers, the tab
// that sets the browser up, the local.json edit that turns it on or off, the production-host field, and where Chrome
// usually lives. No host imports: the dialog draws these and runs the tab.
import { checkBrowser } from "../../shared/browser/config.js";
import { runState, startResult } from "../../shared/browser/setup-result.js";
import { formatConfig } from "../../shared/edit.js";

const ABANDONED = "the setup tab was closed or stopped";
const TAB = '"Set up the browser" tab';
// By mod's Off and By region's ✕ for dock-browser: the Browser section turns it off (the merge would put it back).
export const BROWSER_OFF_TIP = "Turn the browser off in the Browser section";
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// Where Chrome (or a Chromium build) is usually installed, in the order to try. Windows needs the environment
// (ProgramFiles, ProgramFiles(x86), LOCALAPPDATA); only the variables that are set give a path. Linux has fixed paths,
// no PATH search. An unknown platform has none.
export function chromeCandidates(platform, env = {}) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ];
  }
  if (platform === "win32") {
    return [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean).map((base) => `${base}\\Google\\Chrome\\Application\\chrome.exe`);
  }
  if (platform === "linux") {
    return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  }
  return [];
}

// What the section shows: { state, action, busy, message }.
//   state   "off" | "running" | "on" | "failed" | "unsupported" | "notSetUp"
//   action  "on" (turn it on), "off" (turn it off), "setup" (set it up again), null (nothing while it runs)
//   busy    a setup run or a dock update is in progress, so the buttons wait
//   message why it failed or isn't supported, "" when there is nothing to say
// `result` is the parsed setup-result.json (or null). A running or abandoned run is always shown. A finished
// result that disagrees with `enabled` (a set-up while enabled is false, a turn-off while it is true) is stale
// and ignored: the settings and the files decide, as with no result.
export function browserSection({ enabled, modInstalled, binInstalled, result, updateRunning, now }) {
  const run = runState(result, now);
  const busy = run === "running" || Boolean(updateRunning);
  if (run === "running") return { state: "running", action: null, busy, message: "" };
  if (run === "abandoned") return { state: "failed", action: result.action === "off" ? "off" : "setup", busy, message: ABANDONED };

  const stale = (result?.action === "on" && !enabled) || (result?.action === "off" && enabled);
  if (run && !stale) {
    const message = String(result.message ?? "");
    if (run === "failed") return { state: "failed", action: result.action === "off" ? "off" : "setup", busy, message };
    if (run === "unsupported") return { state: "unsupported", action: "off", busy, message };
  }
  if (!enabled) return { state: "off", action: "on", busy, message: "" };
  if (modInstalled && binInstalled) return { state: "on", action: "off", busy, message: "" };
  return { state: "notSetUp", action: "setup", busy, message: "" };
}

// The Herdr command that opens the tab running the setup. A clone runs its deploy (which sets the browser up or
// removes it from local.json's browser.enabled); an app install runs the shipped setup script from the app home.
export function browserRun({ mode, repo, home }) {
  const tab = (folder, argv) => ({ command: "tab.new", args: { name: "Set up the browser", folder, argv } });
  if (mode === "app") return tab(home, ["node", `${home}/mods/dock-browser/herdr-browser-setup.mjs`]);
  return tab(repo, ["npm", "run", "deploy"]);
}

// local.json's text with browser.enabled set and browser.chrome set (a string) or removed (anything else, like null);
// every other key stays. No file (null) starts from { v: 1, regions: {} }. The dialog calls this on text that parsed,
// so text that is not a JSON object throws instead of replacing the user's file.
export function withBrowserSetting(localText, { enabled, chrome }) {
  let file = { v: 1, regions: {} };
  if (localText != null) {
    try {
      file = JSON.parse(localText);
    } catch (e) {
      throw new Error(`local.json is not valid JSON: ${e.message}`);
    }
    if (!isObj(file)) throw new Error("local.json must be a JSON object");
  }
  if ("browser" in file && !isObj(file.browser)) throw new Error("local.json: browser must be an object");
  const browser = { ...file.browser, enabled: enabled === true };
  if (typeof chrome === "string") browser.chrome = chrome;
  else delete browser.chrome;
  return formatConfig({ ...file, browser });
}

// The production-hosts field (commas or whitespace between hosts) -> { ok: true, hosts } with the hosts lower-cased,
// or { ok: false, error } naming the first entry that isn't a host like example.com or *.example.com.
export function parseHosts(text) {
  const hosts = String(text ?? "").split(/[\s,]+/).filter(Boolean).map((h) => h.toLowerCase());
  const problem = checkBrowser({ production: hosts });
  if (!problem) return { ok: true, hosts };
  const bad = hosts.find((h) => checkBrowser({ production: [h] }));
  return { ok: false, error: bad ? `"${bad}" isn't a host like example.com or *.example.com` : problem };
}

// The result the section reads. A click whose start couldn't be written to the result file counts as a run started at
// the click (clicked: { at, action }) until the file shows a run that started or ended at or after it; like any run,
// it is abandoned 15 minutes on.
export function clickedResult(result, clicked) {
  if (!clicked) return result;
  const t = result?.state === "running" ? result.startedAt : result?.at;
  if (Number.isFinite(t) && t >= clicked.at) return result;
  return startResult(clicked.action, clicked.at);
}

const KNOWN_CHROMES = { chrome: "Google Chrome", "google-chrome": "Google Chrome", "google-chrome-stable": "Google Chrome", chromium: "Chromium", "chromium-browser": "Chromium" };

// A Chrome path's name as people know it: the macOS app's name, else Google Chrome or Chromium for their usual file
// names, else the file name.
export function chromeName(path) {
  const p = String(path ?? "");
  const app = /([^/\\]+)\.app(?:[/\\]|$)/.exec(p);
  if (app) return app[1];
  const base = p.split(/[/\\]/).pop().replace(/\.exe$/i, "");
  return KNOWN_CHROMES[base.toLowerCase()] ?? base;
}

// The Chrome choices Turn on offers, the first one preselected: the settings' chrome when that path exists, else the
// first Chrome found on this PC, and always the download (value null: Turn on removes chrome from local.json).
export function chromeChoices({ chrome, chromeExists, found }) {
  const out = [];
  if (chrome && chromeExists) out.push({ value: chrome, label: `${chromeName(chrome)} (from your settings)` });
  else if (found) out.push({ value: found, label: `${chromeName(found)} (found on this PC)` });
  out.push({ value: null, label: "Download Chrome for Testing" });
  return out;
}

// The Chrome Turn on uses: the person's pick (a path, or null for the download) while it is still offered, else the
// first choice.
export const chosenChrome = (choices, pick) => (choices.some((c) => c.value === pick) ? pick : choices[0].value);

// The chrome Turn on writes for that pick: the path, or for the download (null) an empty chrome when the shared config
// (merged without this PC's file) sets one, so the download wins in the merge, else null (no chrome key).
export const turnOnChrome = (pick, sharedChrome) => (typeof pick === "string" ? pick : sharedChrome ? "" : null);

const button = (label, action, primary) => ({ label, action, primary });

// What the section says for browserSection's `section`, given the status (the merged chrome, which files are there,
// the result it reads): { head, tone: "dim" | "ok" | "bad" | "accent", intro, note, button: { label, action, primary }
// or null, secondary (a second button, or null), chrome (show the Chrome choice), hosts (show the production hosts
// field) }. A failed set-up offers Turn off beside Set up again, so a setup that keeps failing can still be left.
export function sectionCopy(section, { chrome, modInstalled, binInstalled, result }) {
  const out = { head: "", tone: "dim", intro: "", note: "", button: null, secondary: null, chrome: false, hosts: false };
  switch (section.state) {
    case "off":
      return {
        ...out, head: "○ Off", intro: "Let agents open and drive a real browser beside the terminal.",
        note: "Turning it on downloads agent-browser (~20 MB) and, without a Chrome, Chrome for Testing (~150 MB).",
        button: button("Turn on", "on", true), chrome: true,
      };
    case "running":
      return { ...out, head: `${result?.action === "off" ? "Turning off…" : "Setting up…"} see the ${TAB}` };
    case "on":
      return { ...out, head: `● On · ${chrome ? chromeName(chrome) : "Chrome for Testing"}`, tone: "ok", button: button("Turn off", "off", false), hosts: true };
    case "failed":
      return {
        ...out, head: section.message ? `Setup failed: ${section.message}` : `Setup failed — see the ${TAB}`, tone: "bad",
        button: section.action === "off" ? button("Turn off", "off", false) : button("Set up again", "setup", true),
        secondary: section.action === "off" ? null : button("Turn off", "off", false),
      };
    case "unsupported":
      return { ...out, head: "Not available on this computer", tone: "bad", note: section.message, button: button("Turn off", "off", false) };
    default: {
      const missing = [!modInstalled && "dock-browser", !binInstalled && "agent-browser"].filter(Boolean).join(" and ");
      return { ...out, head: `● On · not set up (${missing} missing)`, tone: "accent", button: button("Set up", "setup", true) };
    }
  }
}

// One node run (herdr-dock needs node anyway; Herdr's own file reads are for text) that prints which of `paths` exist
// and what the environment variables `names` hold: { env: { name: value or null }, exists: [boolean] }.
const PROBE = "const fs=require('fs');const names=process.argv[1].split(',').filter(Boolean);"
  + "console.log(JSON.stringify({env:Object.fromEntries(names.map((n)=>[n,process.env[n]??null])),exists:process.argv.slice(2).map((p)=>fs.existsSync(p))}))";

export const probeCommand = (names, paths) => ({ command: "node", args: ["-e", PROBE, "--", names.join(","), ...paths] });

// probeCommand's stdout -> { env, exists(path) -> boolean }, or null when it isn't the probe's answer for `paths`.
export function parseProbe(stdout, paths) {
  let r;
  try { r = JSON.parse(stdout); } catch { return null; }
  if (!isObj(r) || !isObj(r.env) || !Array.isArray(r.exists) || r.exists.length !== paths.length) return null;
  const there = new Set(paths.filter((_p, i) => r.exists[i] === true));
  return { env: r.env, exists: (p) => there.has(p) };
}
