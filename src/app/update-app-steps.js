// The pure steps of update-app (the app-mode updater, src/app/update-app.js).
import { mergeKeys } from "../shared/keys.js";

export const KEYS_SECTION = "layout:herdr-dock";
// A dock mod folder name: never a path, never a non-dock mod.
const MOD_NAME = /^dock-[a-z0-9][a-z0-9-]*$/;

const modsOf = (version, which) => {
  const mods = version?.mods;
  if (!Array.isArray(mods)) throw new Error(`the ${which} VERSION.json has no mods list`);
  return mods;
};

// Which mods/<name> folders an update replaces (every mod the new VERSION.json lists) and removes (a dock-* mod
// the old list has and the new one doesn't). Mods neither list names are never touched.
export function planSwap(oldVersion, newVersion) {
  const replace = modsOf(newVersion, "new");
  for (const name of replace) {
    if (typeof name !== "string" || !MOD_NAME.test(name)) throw new Error(`bad mod name in the new VERSION.json: ${JSON.stringify(name)}`);
  }
  const old = oldVersion && Array.isArray(oldVersion.mods) ? oldVersion.mods : [];
  const remove = old.filter((name) => typeof name === "string" && MOD_NAME.test(name) && !replace.includes(name));
  return { replace: [...replace], remove };
}

// Adds the app's layout:herdr-dock bindings that keys.json lacks; a key already bound (to anything else) is kept
// and listed in skipped. The text is returned unchanged when nothing is added, else in the file's own style.
export function addMissingKeys(keysText, appKeysText) {
  const clean = (t) => String(t).replace(/^﻿/, "");
  const keys = JSON.parse(clean(keysText));
  const app = JSON.parse(clean(appKeysText));
  const bindings = Object.entries(app?.[KEYS_SECTION] ?? {});
  const merged = mergeKeys(keys, KEYS_SECTION, bindings);
  const skipped = merged.skipped.map((s) => s.key);
  if (!merged.added.length) return { text: keysText, added: [], skipped };
  const text = clean(keysText).includes("\n") ? JSON.stringify(merged.keys, null, 2) + "\n" : JSON.stringify(merged.keys);
  return { text, added: merged.added, skipped };
}

// The result file dock-core consumes (same shape as scripts/update.mjs; from/to are VERSION.json sources).
export function resultFor({ ok, from, to, reason }, now) {
  return { ok: !!ok, from: from ?? null, to: to ?? null, commits: null, reason: reason ?? null, at: now };
}
