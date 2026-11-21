// Merge key bindings into one section of keys.json (pure; returns a new object).
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function mergeKeys(keys, section, bindings) {
  const current = isObj(keys[section]) ? keys[section] : {};
  const next = { ...current };
  const added = [];
  const skipped = [];
  for (const [key, action] of bindings) {
    if (current[key] === action) continue;
    if (current[key] !== undefined) {
      skipped.push({ key, reason: `already bound to "${current[key]}"` });
      continue;
    }
    next[key] = action;
    added.push(key);
  }
  return { keys: { ...keys, [section]: next }, added, skipped };
}
