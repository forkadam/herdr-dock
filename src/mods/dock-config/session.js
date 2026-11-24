// The config dialog's editing session over injected I/O (no gpui, no Node built-ins).
// It edits this PC's local file (<app home>/herdr-dock/local.json) over the shared config/dock.json
// (merged with machines.<host>), and never writes config/dock.json. `baseText` is the shared file's
// text, `opened` the local file's (null when there is none); a save diffs the draft against the base.
// The Browser section reads the browser's status here and turns it on or off (setBrowser) over the same guard.
import { browserOf, withBrowserFeature } from "../../shared/browser/config.js";
import { binRel } from "../../shared/browser/session.js";
import { SETUP_RESULT_REL, parseSetupResult, startResult } from "../../shared/browser/setup-result.js";
import { DEFAULT_CONFIG, LOCAL_REL, mergeForHost, parseConfig, parseLocal } from "../../shared/config.js";
import { EMPTY_LOCAL, draftFromConfig, planReset, planSave, rebaseDraft, regionOf, sameDraft } from "../../shared/edit.js";
import { fixHint, installOf, modeOf } from "../../shared/install.js";
import { buildInventory, installedFallbackIds } from "../../shared/inventory.js";
import { listDirCommand, parseDirListing } from "../../shared/platform.js";
import { slashPath } from "../../shared/path.js";
import { browserRun, chromeCandidates, parseProbe, probeCommand, withBrowserSetting } from "./browser-view.js";

const CHANGED_NOTICE = "the dock config changed on disk; your edits were re-applied, check and save again";
const INCOMPLETE_NOTICE = "mod list may be incomplete";

const parseJson = (t) => { try { return JSON.parse(t ?? "null"); } catch { return null; } };

async function resolvePaths(io) {
  let path = io.shared("dock.config.path");
  let host = io.shared("dock.host");
  let localPath = io.shared("dock.config.localPath");
  let mode = null;
  if (typeof path !== "string" || !path || typeof host !== "string" || !host) {
    const src = parseJson(await io.readTextFile(`${io.appHome}/mods/dock-core/source.json`).catch(() => null));
    // A clone install's config/dock.json, or an app install's shipped mods/dock-core/config.json.
    mode = modeOf(src);
    if (typeof path !== "string" || !path) path = installOf(src, io.appHome)?.configPath ?? null;
    if (typeof host !== "string" || !host) host = typeof src?.hostname === "string" ? src.hostname.trim().toLowerCase() : "";
  }
  if (typeof localPath !== "string" || !localPath) localPath = `${io.appHome}/${LOCAL_REL}`;
  // Known whenever the host had to come from source.json (the only case the mode words a message).
  if (!mode && path === installOf({ mode: "app" }, io.appHome).configPath) mode = "app";
  return { path, localPath: slashPath(localPath), host: host || null, mode };
}

// Installed mods: the folder listing, each mod's mod.json; the installed.json ids when the listing fails.
async function loadEntries(io) {
  const modsDir = `${io.appHome}/mods`;
  let ids = null;
  try {
    const { command, args } = listDirCommand(io.platform, modsDir);
    const r = await io.exec(command, args);
    if (r.code === 0) {
      const listed = parseDirListing(io.platform, r.stdout ?? "");
      if (listed.length) ids = listed;
    }
  } catch { ids = null; }
  let notice = null;
  if (!ids) {
    notice = INCOMPLETE_NOTICE;
    ids = installedFallbackIds(await io.readTextFile(`${io.appHome}/installed.json`).catch(() => null) ?? "");
  }
  const entries = [];
  for (const id of ids) {
    const modJson = parseJson(await io.readTextFile(`${modsDir}/${id}/mod.json`).catch(() => null));
    entries.push({ id, modJson: modJson !== null && typeof modJson === "object" ? modJson : null });
  }
  return { entries, notice };
}

// The draft both files give, or which one can't be used and why ("fix ... by hand" names it).
function parseFiles(baseText, localText, host, localPath) {
  const base = baseText === null || baseText === undefined ? { ok: false, error: "dock.json could not be read" } : parseConfig(baseText);
  if (!base.ok) return { ok: false, error: base.error, file: "config/dock.json" };
  const local = parseLocal(localText ?? null);
  if (!local.ok) return { ok: false, error: local.error, file: localPath };
  return { ok: true, draft: draftFromConfig(base.config, host ?? "", local.local) };
}

// The browser settings the session's files give: whether it is on and its chrome (merged), and this PC's own chrome
// (local.json's, null when it sets none). Files that don't parse go by the draft (the applied regions hold
// dock-browser exactly while it is on).
function browserSettings(session) {
  const base = session.baseText == null ? null : parseConfig(session.baseText);
  const local = parseLocal(session.opened ?? null);
  if (!base?.ok || !local.ok) return { enabled: regionOf(session.draft, "dock-browser") !== null, chrome: "", localChrome: null };
  const b = browserOf(mergeForHost(base.config, session.host ?? "", local.local));
  const mine = local.local?.browser?.chrome;
  return { enabled: b.enabled === true, chrome: typeof b.chrome === "string" ? b.chrome : "", localChrome: typeof mine === "string" ? mine : null };
}

export async function loadSession(io) {
  const { path, localPath, host, mode } = await resolvePaths(io);
  const baseText = path ? await io.readTextFile(path).catch(() => null) : null;
  const opened = await io.readTextFile(localPath).catch(() => null);
  const { entries, notice } = await loadEntries(io);
  let draft, readOnly = false, error = null;
  const parsed = path ? parseFiles(baseText, opened, host, localPath) : { ok: false, error: "dock.json path is unknown", file: "config/dock.json" };
  if (!parsed.ok) {
    readOnly = true;
    const applied = io.shared("dock.config.applied");
    // Regions published before dock pages existed have no pages region.
    draft = applied ? { regions: { pages: { features: [], hidden: false }, ...applied } } : draftFromConfig(DEFAULT_CONFIG, host ?? "");
    error = `${parsed.error} — fix ${parsed.file} by hand, then reopen`;
  } else {
    draft = parsed.draft;
  }
  if (!host) {
    readOnly = true;
    error = mode === "app" ? "could not read this computer's hostname" : `this computer's hostname is unknown: ${fixHint(mode)}`;
  }
  // baseDraft: the draft as the files had it; a conflict re-applies only what differs from it.
  // mode: "clone" | "app", or null when only dock-core's shared keys said where things are.
  const browserEnabled = browserSettings({ baseText, opened, host, draft }).enabled;
  return {
    path, localPath, host, mode, baseText, opened, draft, baseDraft: draft, browserEnabled,
    inventory: buildInventory(entries, draft, { browserEnabled }), entries, readOnly, notice, error,
  };
}

const withInventory = (s, draft) => ({ ...s, draft, inventory: buildInventory(s.entries, draft, { browserEnabled: s.browserEnabled }) });

const parseSession = (s, baseText = s.baseText, opened = s.opened) => parseFiles(baseText, opened, s.host, s.localPath);

// A file changed under the dialog: load the new texts and put back only the fields the user changed.
// Writes nothing. Files that can't be used keep the edits (still dirty) and show why.
function rebase(session, baseText, opened) {
  const parsed = parseSession(session, baseText, opened);
  if (!parsed.ok) {
    return { ...session, baseText, opened, notice: null, error: `${parsed.error} — fix ${parsed.file} by hand, then save again (your edits are kept)` };
  }
  const draft = rebaseDraft(session.baseDraft, session.draft, parsed.draft);
  const next = { ...session, baseDraft: parsed.draft, baseText, opened, notice: CHANGED_NOTICE, error: null };
  return withInventory({ ...next, browserEnabled: browserSettings(next).enabled }, draft);
}

const reread = (io, path) => (path ? io.readTextFile(path).catch(() => null) : Promise.resolve(null));

// Write the planned local text. The shared file is re-read first: if it moved, the session rebases
// instead (the diff would be against a stale base). A refused write is a conflict only when the
// local file's text moved; otherwise the write's own error is shown. A session whose files didn't
// parse re-reads them first. -> { text } once written, or { session } (rebased or with the error) when not.
async function writeLocal(session, io, makePlan) {
  const baseText = await reread(io, session.path);
  if (!parseSession(session).ok || baseText !== session.baseText) {
    return { session: rebase(session, baseText, await reread(io, session.localPath)) };
  }
  const plan = makePlan();
  if (!plan.ok) return { session: { ...session, error: plan.error } };
  const text = plan.delete ? EMPTY_LOCAL : plan.text;
  try {
    await io.writeTextFile(session.localPath, text, session.opened);
  } catch (e) {
    const fresh = await reread(io, session.localPath);
    if (fresh === session.opened) return { session: { ...session, notice: null, error: String(e) } };
    return { session: rebase(session, baseText, fresh) };
  }
  return { text };
}

async function commit(session, io, makePlan) {
  const w = await writeLocal(session, io, makePlan);
  if (w.session) return w.session;
  return { ...session, opened: w.text, baseDraft: session.draft, notice: null, error: null };
}

export async function saveSession(session, io) {
  if (session.readOnly) return session;
  return commit(session, io, () => planSave(session.baseText, session.opened, session.host, session.draft));
}

export async function resetSession(session, io) {
  if (session.readOnly) return session;
  const next = await commit(session, io, () => planReset(session.opened));
  if (next.error || next.notice) return next;
  const parsed = parseSession(next);
  if (!parsed.ok) return next;
  return { ...withInventory(next, parsed.draft), baseDraft: parsed.draft };
}

// A writable session whose files don't parse holds edits that still need a save.
export function isDirty(session) {
  const parsed = parseSession(session);
  if (!parsed.ok) return !session.readOnly;
  return !sameDraft(session.draft, parsed.draft);
}

// ---- The Browser section ----

const WIN_ENV = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"];
// Herdr's window().platform -> Node's names (chromeCandidates, binRel).
const nodePlatform = (p) => ({ windows: "win32", macos: "darwin", linux: "linux" })[p] ?? p;

async function probe(io, names, paths) {
  const { command, args } = probeCommand(names, paths);
  const r = await io.exec(command, args);
  const p = r.code === 0 ? parseProbe(r.stdout ?? "", paths) : null;
  if (!p) throw new Error(String(r.stderr || `node exit ${r.code}`).trim());
  return p;
}

// What the Browser section shows: { enabled, chrome (merged, "" for none), localChrome (local.json's, or null),
// modInstalled (<app home>/mods/dock-browser), binInstalled (agent-browser), chromeExists (the merged chrome's path),
// found (the first Chrome candidate that exists, or null), result (setup-result.json, or null), problem (why the
// files couldn't be checked, or null) }. The settings are the session's texts; the files are read now.
export async function readBrowserStatus(session, io) {
  const { enabled, chrome, localChrome } = browserSettings(session);
  const platform = nodePlatform(io.platform);
  const mod = `${io.appHome}/mods/dock-browser`;
  const bin = `${io.appHome}/${binRel(platform)}`;
  const result = parseSetupResult(await io.readTextFile(`${io.appHome}/${SETUP_RESULT_REL}`).catch(() => null));
  let exists = () => false;
  let candidates = [];
  let problem = null;
  try {
    const env = platform === "win32" ? (await probe(io, WIN_ENV, [])).env : {};
    candidates = chromeCandidates(platform, env);
    exists = (await probe(io, [], [mod, bin, ...(chrome ? [chrome] : []), ...candidates])).exists;
  } catch (e) {
    problem = `couldn't check the browser's files: ${e?.message ?? e}`;
  }
  return {
    enabled, chrome, localChrome, modInstalled: exists(mod), binInstalled: exists(bin), chromeExists: Boolean(chrome) && exists(chrome),
    found: candidates.find(exists) ?? null, result, problem,
  };
}

// The start of a run, so the section shows it running before the setup gets that far. -> whether it was written.
async function writeStart(io, result) {
  const path = `${io.appHome}/${SETUP_RESULT_REL}`;
  try {
    const now = await io.readTextFile(path).catch(() => null);
    await io.writeTextFile(path, JSON.stringify(result), now);
    return true;
  } catch {
    return false;
  }
}

// Turn on / Turn off / Set up (action "on" | "off" | "setup"), at once and outside the draft: write only browser.enabled
// and browser.chrome (a path, or null to remove it) to local.json with Save's guard (a file changed on disk rebases
// with the changed-on-disk notice, and nothing runs), carry the unsaved edits over the new files (dock-browser joins
// or leaves the draft), record the start in setup-result.json and open the "Set up the browser" tab (io.run).
// -> { session, ran, recorded } (recorded: the start was written; when not, the dialog counts from the click).
export async function setBrowser(session, io, { action, chrome = null, mode, repo, now }) {
  const none = (s) => ({ session: s, ran: false, recorded: false });
  if (session.readOnly) return none(session);
  if (mode !== "app" && !repo) return none({ ...session, error: `can't set up the browser: herdr-dock's folder is unknown (${fixHint(mode)})` });
  const enabled = action !== "off";
  const w = await writeLocal(session, io, () => {
    try {
      return { ok: true, text: withBrowserSetting(session.opened, { enabled, chrome }) };
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });
  if (w.session) return none(w.session);
  let next = { ...session, opened: w.text, notice: null, error: null };
  const parsed = parseSession(next);
  if (parsed.ok) {
    const on = browserSettings(next).enabled;
    const kept = rebaseDraft(session.baseDraft, session.draft, parsed.draft);
    // A right region the user edited comes back whole: the browser still follows the setting.
    const draft = { ...kept, regions: withBrowserFeature(kept.regions, on) };
    next = withInventory({ ...next, baseDraft: parsed.draft, browserEnabled: on }, draft);
  }
  const recorded = await writeStart(io, startResult(enabled ? "on" : "off", now));
  const { command, args } = browserRun({ mode, repo, home: io.appHome });
  io.run(command, args);
  return { session: next, ran: true, recorded };
}
