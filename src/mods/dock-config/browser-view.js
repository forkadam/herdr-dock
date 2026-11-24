// The Browser section of the Dock layout dialog (pure): which state it shows and the one action it offers, the tab
// that sets the browser up, the local.json edit that turns it on or off, the production-host field, and where Chrome
// usually lives. No host imports: the dialog draws these and runs the tab.
import { checkBrowser } from "../../shared/browser/config.js";
import { runState } from "../../shared/browser/setup-result.js";
import { formatConfig } from "../../shared/edit.js";

const ABANDONED = "the setup tab was closed or stopped";
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
