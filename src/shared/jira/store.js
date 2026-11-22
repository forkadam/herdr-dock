// Reads and writes the Jira page's settings and token with Herdr's file calls handed in (no host imports):
// io = { appHome, platform, readTextFile, writeTextFile(path, text, expected), exec }. Herdr's writeTextFile
// replaces a file only if it still holds `expected` (null: it must not exist yet) and may not create folders, so
// folders are made with node (which herdr-dock needs anyway).
import { curlConfig } from "./transport.js";
import { formatSettings, jiraPaths, parseSettings, validateToken } from "./settings.js";

const NODE_MKDIR = "const fs=require('fs');fs.mkdirSync(process.argv[1],{recursive:true,mode:process.argv[2]==='private'?0o700:0o755});if(process.argv[2]==='private')fs.chmodSync(process.argv[1],0o700)";
const NODE_CHMOD = "const fs=require('fs');for(const p of process.argv.slice(1))fs.chmodSync(p,0o600)";

async function makeFolder(io, dir, kind) {
  try {
    const r = await io.exec("node", ["-e", NODE_MKDIR, dir, kind]);
    return r.code === 0 ? null : (r.stderr || `node exit ${r.code}`).trim();
  } catch (e) {
    return `couldn't run node: ${e?.message ?? e}`;
  }
}

// Writes `text` whatever the file holds now (read first, then replace that), creating it if needed.
async function put(io, path, text) {
  const now = await io.readTextFile(path).catch(() => null);
  if (now === text) return;
  await io.writeTextFile(path, text, now);
}

// -> { paths, settings, settingsText, token (null: none), problem (null, or why the settings file was ignored) }
export async function loadJira(io, site) {
  const paths = jiraPaths(io.appHome, site);
  const settingsText = await io.readTextFile(paths.settingsPath).catch(() => null);
  const parsed = parseSettings(settingsText);
  const raw = await io.readTextFile(paths.tokenPath).catch(() => null);
  const token = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  return {
    paths, settings: parsed.settings, settingsText,
    token, problem: parsed.ok ? null : `herdr-dock/${paths.settingsPath.split("/").pop()} ${parsed.error}; using defaults until it's saved again`,
  };
}

// Saves the settings. `expectedText`: the text they were loaded from, so an edit made elsewhere meanwhile isn't
// overwritten (undefined: write whatever is there).
export async function saveSettings(io, site, settings, expectedText) {
  const paths = jiraPaths(io.appHome, site);
  const text = formatSettings(settings);
  try {
    if (expectedText === undefined) {
      try { await put(io, paths.settingsPath, text); } catch {
        const err = await makeFolder(io, paths.dir, "plain");
        if (err) return { ok: false, error: `couldn't create ${paths.dir}: ${err}` };
        await put(io, paths.settingsPath, text);
      }
    } else {
      await io.writeTextFile(paths.settingsPath, text, expectedText);
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: /stale/i.test(String(e?.message ?? e)) ? "the settings changed on disk meanwhile; reopen Settings and save again" : `couldn't save: ${e?.message ?? e}` };
  }
}

// Saves the token: the secrets folder made private first (only you can open it), then the token and its curl
// config, then both files made private too. Nothing is written if the folder can't be made private.
export async function saveToken(io, site, text) {
  const v = validateToken(text);
  if (!v.ok) return { ok: false, error: v.error };
  const paths = jiraPaths(io.appHome, site);
  const err = await makeFolder(io, paths.secretsDir, "private");
  if (err) return { ok: false, error: `couldn't make the secrets folder private: ${err}` };
  try {
    await put(io, paths.tokenPath, `${v.token}\n`);
    await put(io, paths.curlConfigPath, curlConfig(v.token));
  } catch (e) {
    return { ok: false, error: `couldn't save the token: ${e?.message ?? e}` };
  }
  return lockFiles(io, paths);
}

// Disconnect: both files emptied (Herdr has no delete).
export async function clearToken(io, site) {
  const paths = jiraPaths(io.appHome, site);
  try {
    for (const p of [paths.tokenPath, paths.curlConfigPath]) {
      const now = await io.readTextFile(p).catch(() => null);
      if (now) await io.writeTextFile(p, "", now);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `couldn't clear the token: ${e?.message ?? e}` };
  }
}

// Files written by replacement get the default permissions: set 600 again after every write (the folder is 700,
// so they were never readable by others meanwhile). On Windows the profile folder is already private.
async function lockFiles(io, paths) {
  if (io.platform === "windows") return { ok: true };
  try {
    const r = await io.exec("node", ["-e", NODE_CHMOD, paths.tokenPath, paths.curlConfigPath]);
    return r.code === 0 ? { ok: true } : { ok: false, error: `token saved, but couldn't make it private: ${(r.stderr || "").trim()}` };
  } catch (e) {
    return { ok: false, error: `token saved, but couldn't make it private: ${e?.message ?? e}` };
  }
}
