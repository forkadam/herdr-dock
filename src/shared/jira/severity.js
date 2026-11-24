// A view's severity (pure; no host imports): the Jira field that rates a ticket and the levels it maps to, read from
// the view's `severity` block in the settings file.

// The colours a level can take by name; a level can also give a hex colour, #rrggbb.
export const COLOR_NAMES = Object.freeze(["red", "orange", "yellow", "green", "blue", "purple", "gray"]);

const DEFAULT_UNRATED = "No severity";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";

// One entry of `levels` -> { level } or { error } (what is wrong, led by the entry's place in the list).
function parseLevel(l, at) {
  if (!isObj(l)) return { error: `${at} is not an object` };
  if (!Array.isArray(l.values) || !l.values.length || !l.values.every(nonEmpty)) return { error: `${at} needs a list of values` };
  if (!nonEmpty(l.label)) return { error: `${at} needs a label` };
  const color = typeof l.color === "string" ? l.color.trim() : "";
  if (!COLOR_NAMES.includes(color) && !HEX_COLOR.test(color)) return { error: `${at} colour is not ${COLOR_NAMES.join(", ")} or #rrggbb` };
  if (l.attention != null && typeof l.attention !== "boolean") return { error: `${at} attention is not true or false` };
  return { level: { values: l.values.map((v) => v.trim()), label: l.label.trim(), color: color.toLowerCase(), attention: l.attention === true } };
}

// A view's `severity` value -> { severity, warning }. Valid: `field` (the Jira field's id), `levels` (worst first;
// each: `values` the field's values it covers, `label`, `color`, optional `attention` true or false, default false)
// and an optional `unrated` (the name of the rest, default "No severity"). Anything else gives no severity and one
// warning, led by `at` (the view's place in the file), so the view keeps working without it.
export function parseSeverity(value, at) {
  const bad = (what) => ({ severity: null, warning: `${at}.severity: ${what}` });
  if (!isObj(value)) return bad("not an object");
  if (!nonEmpty(value.field)) return bad("needs a field");
  if (!Array.isArray(value.levels) || !value.levels.length) return bad("needs a list of levels");
  const levels = [];
  for (const [i, l] of value.levels.entries()) {
    const { level, error } = parseLevel(l, `levels[${i}]`);
    if (error) return bad(error);
    levels.push(level);
  }
  if (value.unrated != null && !nonEmpty(value.unrated)) return bad("unrated is not a name");
  return { severity: { field: value.field.trim(), levels, unrated: nonEmpty(value.unrated) ? value.unrated.trim() : DEFAULT_UNRATED }, warning: null };
}
