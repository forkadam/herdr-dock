// The config dialog's editing session over injected I/O (no gpui, no Node built-ins).
// It edits this PC's local file (<app home>/herdr-dock/local.json) over the shared config/dock.json
// (merged with machines.<host>), and never writes config/dock.json. `baseText` is the shared file's
// text, `opened` the local file's (null when there is none); a save diffs the draft against the base.
import { DEFAULT_CONFIG, LOCAL_REL, parseConfig, parseLocal } from "../../shared/config.js";
import { EMPTY_LOCAL, draftFromConfig, planReset, planSave, rebaseDraft, sameDraft } from "../../shared/edit.js";
import { fixHint, installOf, modeOf } from "../../shared/install.js";
import { buildInventory, installedFallbackIds } from "../../shared/inventory.js";
import { listDirCommand, parseDirListing } from "../../shared/platform.js";
import { slashPath } from "../../shared/path.js";

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
    draft = applied ? { regions: applied } : draftFromConfig(DEFAULT_CONFIG, host ?? "");
    error = `${parsed.error} — fix ${parsed.file} by hand, then reopen`;
  } else {
    draft = parsed.draft;
  }
  if (!host) {
    readOnly = true;
    error = mode === "app" ? "could not read this computer's hostname" : `this computer's hostname is unknown: ${fixHint(mode)}`;
  }
  // baseDraft: the draft as the files had it; a conflict re-applies only what differs from it.
  return { path, localPath, host, baseText, opened, draft, baseDraft: draft, inventory: buildInventory(entries, draft), entries, readOnly, notice, error };
}

const withInventory = (s, draft) => ({ ...s, draft, inventory: buildInventory(s.entries, draft) });

const parseSession = (s, baseText = s.baseText, opened = s.opened) => parseFiles(baseText, opened, s.host, s.localPath);

// A file changed under the dialog: load the new texts and put back only the fields the user changed.
// Writes nothing. Files that can't be used keep the edits (still dirty) and show why.
function rebase(session, baseText, opened) {
  const parsed = parseSession(session, baseText, opened);
  if (!parsed.ok) {
    return { ...session, baseText, opened, notice: null, error: `${parsed.error} — fix ${parsed.file} by hand, then save again (your edits are kept)` };
  }
  const draft = rebaseDraft(session.baseDraft, session.draft, parsed.draft);
  return { ...withInventory(session, draft), baseDraft: parsed.draft, baseText, opened, notice: CHANGED_NOTICE, error: null };
}

const reread = (io, path) => (path ? io.readTextFile(path).catch(() => null) : Promise.resolve(null));

// Write the planned local text. The shared file is re-read first: if it moved, the session rebases
// instead (the diff would be against a stale base). A refused write is a conflict only when the
// local file's text moved; otherwise the write's own error is shown. A session whose files didn't
// parse re-reads them first.
async function commit(session, io, makePlan) {
  const baseText = await reread(io, session.path);
  if (!parseSession(session).ok || baseText !== session.baseText) {
    return rebase(session, baseText, await reread(io, session.localPath));
  }
  const plan = makePlan();
  if (!plan.ok) return { ...session, error: plan.error };
  const text = plan.delete ? EMPTY_LOCAL : plan.text;
  try {
    await io.writeTextFile(session.localPath, text, session.opened);
  } catch (e) {
    const fresh = await reread(io, session.localPath);
    if (fresh === session.opened) return { ...session, notice: null, error: String(e) };
    return rebase(session, baseText, fresh);
  }
  return { ...session, opened: text, baseDraft: session.draft, notice: null, error: null };
}

export async function saveSession(session, io) {
  if (session.readOnly) return session;
  return commit(session, io, () => planSave(session.baseText, session.opened, session.host, session.draft));
}

export async function resetSession(session, io) {
  if (session.readOnly) return session;
  const next = await commit(session, io, () => planReset());
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
