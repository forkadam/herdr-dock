// The Jira page's settings (pure; no host imports). Per PC, under the app home, never in the repo or the shared
// config:
//   herdr-dock/jira-<site>.json             base URL, connection, CA file, Start-work template, extra filters
//   herdr-dock/secrets/jira-<site>.token    the personal access token (private: folder 700, file 600)
//   herdr-dock/secrets/jira-<site>.curlrc   the same token as a curl config, for the curl connection
//   herdr-dock/secrets/jira-<site>.body     a curl request's body while it runs (a comment), then emptied
import { slashPath } from "../path.js";
import { parseSeverity } from "./severity.js";

export const DEFAULT_SETTINGS = Object.freeze({ v: 1, baseUrl: "", transport: "fetch", caFile: "", startTask: "", filters: [] });
const TRANSPORTS = ["fetch", "curl"];

// A page's `site` prop as a safe file-name part (it names files): lower-case letters, digits and dashes.
export function siteName(site) {
  const s = String(site ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(s) ? s : "work";
}

export function jiraPaths(appHome, site) {
  const home = slashPath(appHome).replace(/\/+$/, "");
  const name = siteName(site);
  const dir = `${home}/herdr-dock`;
  const secretsDir = `${dir}/secrets`;
  return {
    dir,
    settingsPath: `${dir}/jira-${name}.json`,
    secretsDir,
    tokenPath: `${secretsDir}/jira-${name}.token`,
    curlConfigPath: `${secretsDir}/jira-${name}.curlrc`,
    bodyPath: `${secretsDir}/jira-${name}.body`, // a curl request's body (a comment), emptied after each request
  };
}

// What people paste (a browse link, a dashboard, a bare host) -> Jira's base URL: scheme, host, port and any
// context path (https://corp.com/jira), without Jira's own pages after it.
const JIRA_PAGES = /\/(browse|secure|projects|issues|rest|plugins|servicedesk|login\.jsp|dashboards?)(\/|$|\?|\.)/i;
export function normalizeBaseUrl(text) {
  let s = String(text ?? "").trim();
  if (!s) return { ok: false, error: "Enter Jira's address, e.g. https://jira.example.com" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/\s/.test(s) || !/^[\w.-]+(:\d+)?(\/|$)/.test(s)) return { ok: false, error: "That doesn't look like an address." };
    s = `https://${s}`;
  }
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: "That doesn't look like an address." }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "Jira's address starts with https:// (or http://)." };
  if (!u.hostname) return { ok: false, error: "That address has no host." };
  let path = u.pathname;
  const m = JIRA_PAGES.exec(path);
  if (m) path = path.slice(0, m.index);
  path = path.replace(/\/+$/, "");
  return { ok: true, url: `${u.protocol}//${u.host}${path}` };
}

// A personal access token as pasted: one word, without the "Bearer " people sometimes copy along.
export function validateToken(text) {
  const t = String(text ?? "").trim();
  if (!t) return { ok: false, error: "Paste your personal access token." };
  if (/^bearer\s/i.test(t)) return { ok: false, error: 'Paste the token alone, without "Bearer".' };
  if (/\s/.test(t)) return { ok: false, error: "A token is one word, without spaces." };
  return { ok: true, token: t };
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : "");

// Text (null: no file) -> { ok, settings, error? }. Junk gives the defaults (ok false, with why); wrong types fall
// back key by key; keys this version doesn't know are kept, so an older page never drops a newer one's settings.
export function parseSettings(text) {
  if (text == null || !String(text).trim()) return { ok: true, settings: { ...DEFAULT_SETTINGS, filters: [] } };
  let raw;
  try { raw = JSON.parse(String(text).replace(/^﻿/, "")); } catch (e) {
    return { ok: false, settings: { ...DEFAULT_SETTINGS, filters: [] }, error: `not valid JSON (${e.message})` };
  }
  if (!isObj(raw)) return { ok: false, settings: { ...DEFAULT_SETTINGS, filters: [] }, error: "not a JSON object" };
  const { token: _never, ...rest } = raw;
  return {
    ok: true,
    settings: {
      ...rest,
      v: 1,
      baseUrl: str(raw.baseUrl).trim(),
      transport: TRANSPORTS.includes(raw.transport) ? raw.transport : "fetch",
      caFile: str(raw.caFile).trim(),
      startTask: str(raw.startTask),
      filters: (Array.isArray(raw.filters) ? raw.filters : [])
        .filter((f) => isObj(f) && str(f.name).trim() && str(f.jql).trim())
        .map((f) => ({ name: f.name.trim(), jql: f.jql.trim() })),
    },
  };
}

// The settings file changed on disk (edited by hand) while the page runs: what to do with its new text (`file`: its
// name). Text that doesn't parse never replaces the settings in use: { kind: "keep", problem } says why. Otherwise
// { kind: "load", newSite }: `newSite` when the address differs, so the old site's issues are forgotten first.
export function settingsReload(current, text, file) {
  const parsed = parseSettings(text);
  if (!parsed.ok) return { kind: "keep", problem: `herdr-dock/${file} ${parsed.error}; the page keeps the settings it had until the file is fixed` };
  return { kind: "load", newSite: parsed.settings.baseUrl !== (current?.baseUrl ?? "") };
}

// The settings file's text; a token never goes in it.
export function formatSettings(settings) {
  const { token: _never, ...rest } = settings ?? {};
  return JSON.stringify({ ...DEFAULT_SETTINGS, ...rest, v: 1 }, null, 2) + "\n";
}

// ---- options: what the page reads from the keys parseSettings keeps, checked and defaulted ----
// None of these defaults is ever written to the settings file (formatSettings and DEFAULT_SETTINGS don't know them).

export const DEFAULT_HIGH_PRIORITIES = /* @__PURE__ */ Object.freeze(["Highest", "High"]);
export const DEFAULT_BRIEF_BUGS = "issuetype = Bug AND assignee = currentUser() AND resolution = Unresolved";
export const DEFAULT_CHECK_TASK =
  "The description of {key} ({summary}) changed {when}. Read the change with your Jira tools and check it against my work on {mine} in this repo.";

const VIEW_ID = /^[a-z][a-z0-9-]{0,23}$/;
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";

// A board id: a positive whole number, or its digits as text.
function boardId(v) {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// One entry of `actions`: what it matches (project, type, subtask, parentType: any of) and what it runs on Start
// (start) and Finish (finish). A match key of the wrong type skips the rule, so it never ends up matching more than
// its author meant; a start or finish of the wrong type is as good as missing.
function parseRule(a) {
  if (!isObj(a)) return { error: "not an object" };
  const rule = {};
  for (const k of ["project", "type"]) {
    if (a[k] == null) continue;
    if (!nonEmpty(a[k])) return { error: `${k} is not a name` };
    rule[k] = a[k].trim();
  }
  if (a.subtask != null) {
    if (typeof a.subtask !== "boolean") return { error: "subtask is not true or false" };
    rule.subtask = a.subtask;
  }
  if (a.parentType != null) {
    const list = typeof a.parentType === "string" ? [a.parentType] : a.parentType;
    if (!Array.isArray(list) || !list.length || !list.every(nonEmpty)) return { error: "parentType is not a type name or a list of them" };
    rule.parentType = list.map((t) => t.trim());
  }
  for (const k of ["start", "finish"]) if (nonEmpty(a[k])) rule[k] = a[k];
  if (rule.start === undefined && rule.finish === undefined) return { error: "needs a start or a finish" };
  return { rule };
}

// Settings -> { board, highPriorities, briefBugs, views, actions, checkTask, warnings }. A bad view or rule is skipped
// with one warning (its place in the file counted from 0), so the rest of the file still works. A view's optional
// `button` ({ label, task }: opens Claude with `task`) that lacks either is dropped with a warning; the view is kept.
// So is a malformed `severity` block (severity.js's parseSeverity). A view's `group` is "type", "severity" or null:
// with no `group`, a valid severity block groups by severity; `group: "severity"` needs that block.
export function jiraOptions(settings) {
  const s = isObj(settings) ? settings : {};
  const warnings = [];

  let board = null;
  if (s.board != null) {
    board = boardId(s.board);
    if (board === null) warnings.push("board: not a board id");
  }

  const hp = s.highPriorities;
  const highPriorities = Array.isArray(hp) && hp.length && hp.every(nonEmpty) ? hp.map((p) => p.trim()) : [...DEFAULT_HIGH_PRIORITIES];

  const views = [];
  if (s.views != null && !Array.isArray(s.views)) warnings.push("views: not a list");
  for (const [i, v] of (Array.isArray(s.views) ? s.views : []).entries()) {
    const at = `views[${i}]`;
    if (!isObj(v)) { warnings.push(`${at}: not an object`); continue; }
    const name = str(v.name).trim();
    const jql = str(v.jql).trim();
    if (!name || !jql) { warnings.push(`${at}: needs a name and a jql`); continue; }
    if (typeof v.id !== "string" || !VIEW_ID.test(v.id)) {
      warnings.push(`${at}: the id must be lower-case letters, digits and dashes, starting with a letter (24 at most)`);
      continue;
    }
    if (v.id === "today") { warnings.push(`${at}: "today" is the Today tab's id`); continue; }
    if (views.some((w) => w.id === v.id)) { warnings.push(`${at}: the id "${v.id}" is already used`); continue; }
    let severity = null;
    if (v.severity != null) {
      const parsed = parseSeverity(v.severity, at);
      severity = parsed.severity;
      if (parsed.warning) warnings.push(parsed.warning);
    }
    let group = null;
    if (v.group == null) group = severity ? "severity" : null;
    else if (v.group === "type") group = "type";
    else if (v.group === "severity") {
      if (severity) group = "severity";
      else warnings.push(`${at}: group "severity" needs a valid severity block`);
    } else warnings.push(`${at}: group "${v.group}" is not "type" or "severity"`);
    let button = null;
    if (v.button != null) {
      if (isObj(v.button) && nonEmpty(v.button.label) && nonEmpty(v.button.task)) button = { label: v.button.label.trim(), task: v.button.task.trim() };
      else warnings.push(`${at}: button needs a label and a task`);
    }
    views.push({ id: v.id, name, jql, group, button, severity });
  }

  const actions = [];
  if (s.actions != null && !Array.isArray(s.actions)) warnings.push("actions: not a list");
  for (const [i, a] of (Array.isArray(s.actions) ? s.actions : []).entries()) {
    const { rule, error } = parseRule(a);
    if (error) warnings.push(`actions[${i}]: ${error}`);
    else actions.push(rule);
  }

  return {
    board,
    highPriorities,
    briefBugs: nonEmpty(s.briefBugs) ? s.briefBugs.trim() : DEFAULT_BRIEF_BUGS,
    views,
    actions,
    checkTask: nonEmpty(s.checkTask) ? s.checkTask : DEFAULT_CHECK_TASK,
    warnings,
  };
}

// ---- The settings form's Scrum board and High priorities ----

// The file's highPriorities as the form's comma-separated text (only its names; anything else is no list).
export function prioritiesText(settings) {
  const hp = isObj(settings) ? settings.highPriorities : null;
  return Array.isArray(hp) ? hp.filter(nonEmpty).map((p) => p.trim()).join(", ") : "";
}

// The settings with the form's choices: `board` (a picked board's id, or null for none) and `priorities` (the typed
// text, comma-separated). None or nothing typed removes the key, so the default applies and is never written.
export function withFormOptions(settings, { board, priorities }) {
  const { board: _b, highPriorities: _h, ...rest } = isObj(settings) ? settings : {};
  const names = String(priorities ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return { ...rest, ...(board != null ? { board } : {}), ...(names.length ? { highPriorities: names } : {}) };
}
