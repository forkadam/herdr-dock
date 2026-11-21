// The config dialog's editing session over injected I/O (no gpui, no Node built-ins).
import { DEFAULT_CONFIG, parseConfig } from "../../shared/config.js";
import { draftFromConfig, planReset, planSave, rebaseDraft, sameDraft } from "../../shared/edit.js";
import { buildInventory, installedFallbackIds } from "../../shared/inventory.js";
import { listDirCommand, parseDirListing } from "../../shared/platform.js";
import { slashPath } from "../../shared/path.js";

const CHANGED_NOTICE = "dock.json changed on disk; your edits were re-applied, check and save again";
const INCOMPLETE_NOTICE = "mod list may be incomplete";

const parseJson = (t) => { try { return JSON.parse(t ?? "null"); } catch { return null; } };

async function resolvePathAndHost(io) {
  let path = io.shared("dock.config.path");
  let host = io.shared("dock.host");
  if (typeof path !== "string" || !path || typeof host !== "string" || !host) {
    const src = parseJson(await io.readTextFile(`${io.appHome}/mods/dock-core/source.json`).catch(() => null));
    if (typeof path !== "string" || !path) path = typeof src?.config === "string" ? slashPath(src.config) : null;
    if (typeof host !== "string" || !host) host = typeof src?.hostname === "string" ? src.hostname.trim().toLowerCase() : "";
  }
  return { path, host: host || null };
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

export async function loadSession(io) {
  const { path, host } = await resolvePathAndHost(io);
  const opened = path ? await io.readTextFile(path).catch(() => null) : null;
  const { entries, notice } = await loadEntries(io);
  let draft, readOnly = false, error = null;
  const parsed = opened === null ? { ok: false, error: path ? "dock.json could not be read" : "dock.json path is unknown" } : parseConfig(opened);
  if (!parsed.ok) {
    readOnly = true;
    const applied = io.shared("dock.config.applied");
    draft = applied ? { regions: applied } : draftFromConfig(DEFAULT_CONFIG, host ?? "");
    error = `${parsed.error} — fix config/dock.json by hand, then reopen`;
  } else {
    draft = draftFromConfig(parsed.config, host ?? "");
  }
  if (!host) {
    readOnly = true;
    error = "this computer's hostname is unknown: run npm run deploy";
  }
  // baseDraft: the draft as the file had it; a conflict re-applies only what differs from it.
  return { path, host, opened, draft, baseDraft: draft, inventory: buildInventory(entries, draft), entries, readOnly, notice, error };
}

const withInventory = (s, draft) => ({ ...s, draft, inventory: buildInventory(s.entries, draft) });

const parseOpened = (text) => (text === null || text === undefined ? { ok: false, error: "dock.json could not be read" } : parseConfig(text));

// The file changed under the dialog: load its new text and put back only the fields the user changed.
// Writes nothing. A file that can't be used keeps the edits (still dirty) and shows why.
function rebase(session, fresh) {
  const parsed = parseOpened(fresh);
  if (!parsed.ok) {
    return { ...session, opened: fresh, notice: null, error: `${parsed.error} — fix config/dock.json by hand, then save again (your edits are kept)` };
  }
  const freshDraft = draftFromConfig(parsed.config, session.host);
  const draft = rebaseDraft(session.baseDraft, session.draft, freshDraft);
  return { ...withInventory(session, draft), baseDraft: freshDraft, opened: fresh, notice: CHANGED_NOTICE, error: null };
}

const reread = (session, io) => io.readTextFile(session.path).catch(() => null);

// Write the planned text. A refused write is a conflict only when the file's text moved; otherwise
// the write's own error is shown. A session whose file text didn't parse re-reads it first.
async function commit(session, io, makePlan) {
  if (!parseOpened(session.opened).ok) return rebase(session, await reread(session, io));
  const plan = makePlan(session.opened);
  if (!plan.ok) return { ...session, error: plan.error };
  try {
    await io.writeTextFile(session.path, plan.text, session.opened);
  } catch (e) {
    const fresh = await reread(session, io);
    if (fresh === session.opened) return { ...session, notice: null, error: String(e) };
    return rebase(session, fresh);
  }
  return { ...session, opened: plan.text, baseDraft: session.draft, notice: null, error: null };
}

export async function saveSession(session, io) {
  if (session.readOnly) return session;
  return commit(session, io, (opened) => planSave(opened, session.host, session.draft));
}

export async function resetSession(session, io) {
  if (session.readOnly) return session;
  const next = await commit(session, io, (opened) => planReset(opened, session.host));
  if (next.error || next.notice) return next;
  const parsed = parseConfig(next.opened);
  if (!parsed.ok) return next;
  const draft = draftFromConfig(parsed.config, session.host);
  return { ...withInventory(next, draft), baseDraft: draft };
}

// A writable session whose file text doesn't parse holds edits that still need a save.
export function isDirty(session) {
  const parsed = parseOpened(session.opened);
  if (!parsed.ok) return !session.readOnly;
  return !sameDraft(session.draft, draftFromConfig(parsed.config, session.host));
}
