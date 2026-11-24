// A view's severity (pure; no host imports): the Jira field that rates a ticket and the levels it maps to, read from
// the view's `severity` block in the settings file, and what the page does with it: a ticket's level and colour, the
// search for the tickets that need attention now, and the sections a tab's rows fall into.
import { quote } from "./jql.js";
import { groupByCategory } from "./model.js";

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

// A field value -> its text: a string as is, an object's `value` (a select) or else `name`, anything else null.
function readValue(v) {
  if (typeof v === "string") return v;
  const text = isObj(v) ? v.value ?? v.name : null;
  return typeof text === "string" ? text : null;
}

// An issue from the search (its `fields`) -> the value of the severity field, `field` being its id: a string as is,
// an object's `value` ?? `name`, a list's first element read the same way; anything else (or nothing) null.
export function severityValue(issue, field) {
  const raw = issue?.fields?.[field];
  return readValue(Array.isArray(raw) ? raw[0] : raw);
}

// The first level whose values hold `value`, else null (the ticket has no level: unrated).
export const levelOf = (value, severity) => severity.levels.find((l) => l.values.includes(value)) ?? null;

// The colours by name that are not the page's own: the rest are theme colours (blocked, done, dim).
const NAMED_HEX = { orange: "#f97316", yellow: "#eab308", blue: "#3b82f6", purple: "#8b5cf6" };
const THEME_COLOR = { red: "blocked", green: "done", gray: "dim" };

// A level's colour -> how to draw it: `{ theme }` names one of the page's theme colours, `{ hex }` is a fixed one
// (a #rrggbb colour as given).
export const colorOf = (color) => (THEME_COLOR[color] ? { theme: THEME_COLOR[color] } : { hex: NAMED_HEX[color] ?? color });

// How a JQL search names the field: `cf[N]` for customfield_N, else the name, quoted unless it is a plain word.
function fieldRef(field) {
  const custom = /^customfield_(\d+)$/.exec(field);
  if (custom) return `cf[${custom[1]}]`;
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(field) ? field : quote(field);
}

// A view's JQL -> the search for its open tickets at an attention level (the levels with `attention`), its ORDER BY
// dropped; null when no level asks for attention.
export function attentionJql(jql, severity) {
  const values = severity.levels.filter((l) => l.attention).flatMap((l) => l.values);
  if (!values.length) return null;
  const m = /^(.*?)\s*\b(order\s+by\s+.+)$/is.exec(String(jql ?? "").trim());
  const where = (m ? m[1] : String(jql ?? "")).trim();
  return `${where ? `(${where}) AND ` : ""}${fieldRef(severity.field)} in (${values.map(quote).join(", ")}) AND statusCategory != Done`;
}

// Rows (each with `severity`, the field's raw value, and `category`) -> { attention, sections }, each a list of
// { title, level, parts } (`parts`: groupByCategory's). `attention`: the open rows of each attention level, in
// the level order. `sections`: each level in order with the rows `attention` leaves (an attention level's done
// rows, every row of the others), then the rows with no level under severity.unrated (level null). Empty ones are
// left out.
export function severitySections(rows, severity) {
  const by = new Map(severity.levels.map((l) => [l, []]));
  const unrated = [];
  for (const row of rows) (by.get(levelOf(row.severity, severity)) ?? unrated).push(row);
  const section = (title, level, list) => ({ title, level, parts: groupByCategory(list) });
  const titleOf = (l) => `${l.label} · ${l.values.join("/")}`;
  const attention = [];
  const sections = [];
  for (const [level, list] of by) {
    const open = list.filter((r) => r.category !== "done");
    if (level.attention && open.length) attention.push(section(titleOf(level), level, open));
    const rest = level.attention ? list.filter((r) => r.category === "done") : list;
    if (rest.length) sections.push(section(titleOf(level), level, rest));
  }
  if (unrated.length) sections.push(section(severity.unrated, null, unrated));
  return { attention, sections };
}
