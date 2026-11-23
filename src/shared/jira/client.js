// The Jira REST v2 client the page uses (no host imports: Herdr's fetch and exec are handed in as `io`, so Node's
// stand in for tests). Every call resolves { ok: true, data } or { ok: false, problem } (model.js classify) and
// never throws.
import { searchUrl } from "./jql.js";
import { classify } from "./model.js";
import { curlArgs, fetchRequest, parseCurl, parseJson } from "./transport.js";

// What the detail pane shows.
export const DETAIL_FIELDS = ["summary", "description", "status", "issuetype", "priority", "assignee", "reporter", "project",
  "created", "updated", "resolution", "comment", "issuelinks"];
const TIMEOUT = Symbol("timeout");

// A fetch failure's text, with its cause (Node and some hosts say "fetch failed" and put ECONNREFUSED, a DNS or a
// certificate error in the cause).
function errorText(e) {
  const parts = [e?.message ?? String(e)];
  for (let c = e?.cause, n = 0; c && n < 3; c = c.cause, n++) parts.push(c.code, c.message);
  return parts.filter(Boolean).join(" ");
}

// io: { fetch(url, options) -> { status, text() }, exec(command, args, { timeout }) -> { code, stdout, stderr },
//       sleep?(ms) -> Promise, readTextFile?, writeTextFile? } (without sleep a fetch has no timeout of its own).
// curlBodyPath (with io's file calls): curl reads request bodies from that private file, emptied after each request.
export function createClient({ base, transport = "fetch", token, curlConfigPath, curlBodyPath, caFile, io, timeoutMs = 20000 }) {
  const root = String(base ?? "").replace(/\/+$/, "");
  const api = (path) => `${root}/rest/api/2${path}`;
  const agile = (path) => `${root}/rest/agile/1.0${path}`; // Jira Software: boards and sprints
  const issuePath = (key) => `/issue/${encodeURIComponent(key)}`;

  async function viaFetch(method, url, body) {
    const { options } = fetchRequest({ method, url, token, body });
    let r;
    try {
      const call = Promise.resolve().then(() => io.fetch(url, options));
      r = io.sleep ? await Promise.race([call, io.sleep(timeoutMs).then(() => TIMEOUT)]) : await call;
    } catch (e) {
      return { ok: false, problem: classify({ error: errorText(e) }) };
    }
    if (r === TIMEOUT) return { ok: false, problem: classify({ error: "timed out" }) };
    let text = "";
    try { text = await r.text(); } catch { text = ""; }
    return answer(r.status, text);
  }

  // Writes `text` to the body file whatever it holds now (Herdr's writeTextFile wants the current text).
  async function putBody(text) {
    const now = await io.readTextFile(curlBodyPath).catch(() => null);
    if (now !== text) await io.writeTextFile(curlBodyPath, text, now);
  }

  async function viaCurl(method, url, body) {
    const useFile = body !== undefined && curlBodyPath && io.writeTextFile && io.readTextFile;
    if (useFile) {
      try { await putBody(JSON.stringify(body)); } catch (e) {
        return { ok: false, problem: { kind: "unknown", message: `Couldn't prepare the request: ${e?.message ?? e}`, hint: "Check the herdr-dock/secrets folder, or switch the connection to fetch." } };
      }
    }
    let res;
    try {
      res = await io.exec("curl", curlArgs({ method, url, configPath: curlConfigPath, body, bodyPath: useFile ? curlBodyPath : undefined, timeoutMs, caFile }), { timeout: timeoutMs + 10000 });
    } catch (e) {
      return { ok: false, problem: { kind: "nocurl", message: `Couldn't run curl: ${e?.message ?? e}`, hint: "Install curl, or switch the connection to fetch in Settings." } };
    } finally {
      if (useFile) await putBody("").catch(() => {});
    }
    const p = parseCurl(res);
    if ("curlCode" in p) return { ok: false, problem: classify(p.curlCode === -1 ? { error: p.stderr } : { curlCode: p.curlCode }) };
    return answer(p.status, p.text);
  }

  function answer(status, text) {
    const data = parseJson(text);
    if (status >= 200 && status < 300) return { ok: true, status, data };
    return { ok: false, status, problem: classify({ status, data }) };
  }

  async function request(method, url, body) {
    try {
      return await (transport === "curl" ? viaCurl : viaFetch)(method, url, body);
    } catch (e) {
      return { ok: false, problem: classify({ error: String(e?.message ?? e) }) };
    }
  }
  const map = (r, f) => (r.ok ? { ...r, data: f(r.data) } : r);
  const list = (d) => (Array.isArray(d) ? d : []);
  const ms = (s) => { const t = Date.parse(s ?? ""); return Number.isFinite(t) ? t : null; };

  return {
    serverInfo: () => request("GET", api("/serverInfo")),
    myself: () => request("GET", api("/myself")),
    search: (jql, page = {}) => request("GET", searchUrl(root, jql, page)),
    issue: (key) => request("GET", `${api(issuePath(key))}?fields=${DETAIL_FIELDS.join(",")}`),
    // A project's statuses across its issue types, once each, in Jira's order: [{ name, category }] (board columns).
    projectStatuses: (key) => request("GET", api(`/project/${encodeURIComponent(key)}/statuses`)).then((r) => map(r, (d) => {
      const seen = new Map();
      for (const type of Array.isArray(d) ? d : []) {
        for (const st of type?.statuses ?? []) if (st?.name && !seen.has(st.name)) seen.set(st.name, { name: st.name, category: st.statusCategory?.key ?? "new" });
      }
      return [...seen.values()];
    })),
    // The scrum boards (whose name has `name` in it, when given): [{ id, name, type }].
    boards: (name) => request("GET", agile(`/board?${new URLSearchParams({ type: "scrum", ...(name ? { name } : {}) })}`))
      .then((r) => map(r, (d) => list(d?.values).map((b) => ({ id: b.id, name: b.name, type: b.type })))),
    // A board's columns, each with the ids (strings) of the statuses it holds: { columns: [{ name, statusIds }] }.
    boardConfiguration: (id) => request("GET", agile(`/board/${encodeURIComponent(id)}/configuration`))
      .then((r) => map(r, (d) => ({ columns: list(d?.columnConfig?.columns).map((c) => ({ name: c.name, statusIds: list(c.statuses).map((st) => String(st.id)) })) }))),
    // A board's sprints in the given states ("active", "future", "closed"), in Jira's order, following its pages of 50
    // (isLast; at most 20 pages): [{ id, name, state, startMs, endMs }]. A page that fails fails the call.
    async sprints(boardId, states = []) {
      const out = [];
      for (let page = 0, startAt = 0; page < 20; page++) {
        const params = new URLSearchParams({ ...(states.length ? { state: states.join(",") } : {}), startAt: String(startAt), maxResults: "50" });
        const r = await request("GET", agile(`/board/${encodeURIComponent(boardId)}/sprint?${params}`));
        if (!r.ok) return r;
        const values = list(r.data?.values);
        out.push(...values.map((s) => ({ id: Number(s.id), name: s.name, state: s.state, startMs: ms(s.startDate), endMs: ms(s.endDate) })));
        if (r.data?.isLast !== false || !values.length) break;
        startAt += values.length;
      }
      return { ok: true, data: out };
    },
    // An issue's description and its changelog's histories (what changed, when, by whom), newest last as Jira sends them.
    issueHistory: (key) => request("GET", `${api(issuePath(key))}?fields=description&expand=changelog`)
      .then((r) => map(r, (d) => ({ description: d?.fields?.description ?? null, histories: list(d?.changelog?.histories) }))),
    statuses: () => request("GET", api("/status")).then((r) => map(r, (d) => (Array.isArray(d) ? d : []))),
    favouriteFilters: () => request("GET", api("/filter/favourite")).then((r) => map(r, (d) => (Array.isArray(d) ? d : []))),
    // With each step's screen fields (required ones and their allowed values), so the page can ask for them.
    transitions: (key) => request("GET", api(`${issuePath(key)}/transitions?expand=transitions.fields`)).then((r) => map(r, (d) => d?.transitions ?? [])),
    transition: (key, id, fields) => request("POST", api(`${issuePath(key)}/transitions`), { transition: { id: String(id) }, ...(fields ? { fields } : {}) }),
    assign: (key, name) => request("PUT", api(`${issuePath(key)}/assignee`), { name }),
    comment: (key, text) => request("POST", api(`${issuePath(key)}/comment`), { body: text }),
  };
}
