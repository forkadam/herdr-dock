// The Jira page's settings (pure; no host imports). Per PC, under the app home, never in the repo or the shared
// config:
//   herdr-dock/jira-<site>.json             base URL, connection, CA file, Start-work template, extra filters
//   herdr-dock/secrets/jira-<site>.token    the personal access token (private: folder 700, file 600)
//   herdr-dock/secrets/jira-<site>.curlrc   the same token as a curl config, for the curl connection
import { slashPath } from "../path.js";

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

// The settings file's text; a token never goes in it.
export function formatSettings(settings) {
  const { token: _never, ...rest } = settings ?? {};
  return JSON.stringify({ ...DEFAULT_SETTINGS, ...rest, v: 1 }, null, 2) + "\n";
}
