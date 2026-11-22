# Dock pages, and a Jira page — design

Date: 2026-11-22. Status: Part 1 built (see "As built"); Part 2 planned (decisions below, plan in
`docs/superpowers/plans/2026-11-22-jira-page.md`).

## Intent

- **Part 1, dock pages.** A place for features bigger than a right-panel mod. A **Pages** list in the left panel
  (like Cockpit's left navigation); clicking a page fills the work area with it. One page at a time, global (not
  tied to a space or tab), so two copies of a page can never be open and disagree. Configurable like the other
  regions: which pages, their order, per PC.
- **Part 2, the first page: Jira.** The company's self-hosted Jira (Server / Data Center). The user's issues and
  saved filters, quick actions (status, assign, comment), and **Start work**: a Claude tab on the issue.
- **Access.** On the web Jira uses company SSO; the Jira MCP uses a **personal access token** (PAT). The page uses
  a PAT the same way. Jira can't be reached from home, so development and tests run against a **mock Jira
  server** in the repo; the first real check happens at the office.

## Part 1: dock pages

### What the user sees

- A new left feature, **Pages** (`dock-pages`): one row per page (icon, title, an optional badge such as "12").
  The selected page is highlighted. In the left panel's icon mode it shows one icon per page.
- Clicking a page shows it in the work area, in place of the terminal pane. The top bar stays (it holds the panel
  toggle and dock-core); the tab bar's tabs are drawn dimmed while a page is shown.
- Going back to terminals: click any tab, any space or agent, or the selected page again. **Ctrl+Alt+P** cycles:
  terminals → page 1 → page 2 → … → terminals. (Esc inside a page: not in v1; a page needs keyboard focus for it.)
- The right panel and bottom bar are unchanged and work beside a page.
- What's shown is remembered per PC (`dock.page.active`, a shared key like `dock.right.active`), so a restart
  comes back to the same page.

### Layout

Today the body is `dock-body` → `[dock-main, dock-right]`. With pages, `dock-main` moves into a stack:

```
dock-body (row)
├─ dock-work-stack (stack, active: dock-main | dock-page-<i>-<mod>)
│  ├─ dock-main            (content.tab: "active", the terminal pane, as today)
│  ├─ dock-page-0-dock-jira (block, content: {mod: "dock-jira", props: {..., dockFeature, dockRegion: "pages"}})
│  └─ …
└─ dock-right …
```

- This is the right panel's pattern: dock-core watches `dock.page.active` and rewrites the stack's `active`.
  Page mods stay mounted while hidden, so switching is instant and a page keeps its scroll and state.
- With no pages configured the stack isn't emitted and the layout is exactly today's (no change for anyone who
  doesn't use pages).
- Selecting a tab, space or agent while a page is shown sets `dock.page.active` back to `null` (dock-core already
  sees these through Herdr's focus).

### Config

A fifth region, `pages`, in `config/dock.json` and the per-PC `local.json`:

```json
"pages": { "features": [ { "mod": "dock-jira", "props": { "site": "work" } } ] }
```

- `features` only (a page has no size: it fills the work area). Each `props` reaches the page mod.
- `dock-pages` (the nav list) is a normal left feature; adding the region without it shows a config warning.
- Placement follows the existing rules: any mod except the top-only and left-only ones can be a page, and
  page-only mods (`PAGE_ONLY` in `config.js`, like `LEFT_ONLY`) can only be pages. The dialog gets a **Pages**
  section like the other regions: add, remove, reorder; placing the first page also adds `dock-pages` to the left.
- `src/mods/_page.js` gives page mods `pageShown(mod)` (to pause timers while hidden) and `showTerminal()`.

### Out of scope (Part 1)

- Several pages side by side, or a page inside a space's tab (Herdr's `tab.new {mod}` already does that).
- Pages contributed by mods outside herdr-dock (later: any mod whose manifest lists `pages`).

### As built (Part 1)

- `pages` region in `config.js` (`REGION_NAMES`, features only), `PAGE_ONLY`, `dock-pages` in `LEFT_ONLY`.
- `layout.js`: `dock-work-stack` (stack of `dock-main` and `dock-page-<i>-<mod>`) only when pages exist.
- `panel.js`: `PAGE_KEY` (`dock.page.active`), `liveWork`, `planPage` (a live `layout.select`, like the right
  panel), `nextPage`, `pageClick`, `focusLeavesPage`; `rightStateFromShared` also reads the page for deploy.
- dock-core: `syncPage` in render (select the child; a space/tab focus change clears the page), commands `page`
  and `terminals`; key `ctrl-alt-p`.
- Tabs, Spaces, Agents and Git projects call `showTerminal()` on click; Tabs dims while a page shows.
- `dock-pages`: after cockpit's app bar (quaresc/cockpit, the icon row under its quota bars): a 52 px row of icons
  on a raised strip, Terminal first, count badges in the corners (`dock.page.badge.<mod>`, with a tone), the shown
  one on a raised tile. `dock-overview` is the first page.
- Tests: `tests/pages.test.mjs`.

## Part 2: the Jira page (`dock-jira`)

### What the user sees

- **Header:** "Jira", the site name, a filter picker, a search box, refresh, and the time of the last fetch.
- **Filters:** built in — *Assigned to me* (`assignee = currentUser() AND resolution = Unresolved ORDER BY updated
  DESC`), *Reported by me*, *Recently viewed*; plus the user's own saved JQL filters (from Jira's favourite
  filters, and any listed in `props.filters`).
- **Two views, a toggle in the header** (remembered per PC):
  - **List:** issues grouped by status category (To do, In progress, Done), each row: type icon, key, summary,
    priority, assignee, updated ("2h"). Dense; the default.
  - **Board:** one column per status (ordered by category, then by the order Jira returns them), cards with key,
    summary, priority and assignee; columns scroll on their own. The same issues as the list (the filter's), not a
    Jira agile board.
- A badge with the count of *Assigned to me* shows in the Pages bar.
- **Detail** (click a row; a split on the right of the page): summary, status, description (plain text; Jira
  wiki markup shown as text in v1), the last 5 comments, links.
- **Actions** in the detail:
  - **Status**: a menu of the issue's allowed transitions (from Jira, so the workflow is respected).
  - **Assign to me**.
  - **Comment**: a text box, Ctrl+Enter sends.
  - **Open in browser** (SSO in the browser works as today).
  - **Start work** (below).
- Errors are shown in the page, never as a blank list: not configured, no token, token rejected (401), Jira not
  reachable (offline / not on the company network), TLS error. Each says what to do.

### Start work

The user's own Claude skills do the real work (initialize the ticket, sync it to their Obsidian note, read it and
investigate). So Start work only opens the tab and hands Claude the issue; it creates no branch and changes nothing
in Jira.

- Runs `tab.new {name: "PROJ-123", argv: ["claude"], task}` in the selected space, then shows the terminal.
- `task` comes from a template, `props.startTask`, with `{key}`, `{summary}`, `{url}`, `{type}`, `{status}`,
  `{priority}` and `{description}` filled in. Default: `Work on Jira issue {key}: {summary}\n{url}`. The user sets it
  to call their skill, e.g. `/init-ticket {key}`.
- The button's tooltip shows the message it will send.

### Access to Jira

- **REST API v2** (Server / DC): `GET /rest/api/2/myself`, `GET /rest/api/2/search` (JQL, `fields` limited to what
  the list shows, `maxResults` 50, paging), `GET /rest/api/2/issue/{key}` (detail, `expand=renderedFields` not
  used in v1), `GET /rest/api/2/filter/favourite`, `GET|POST /rest/api/2/issue/{key}/transitions`,
  `PUT /rest/api/2/issue/{key}/assignee`, `POST /rest/api/2/issue/{key}/comment`.
- **Auth:** `Authorization: Bearer <PAT>`. The PAT is the one the Jira MCP already uses: the MCP is
  **mcp-atlassian** (sooperset), so its entry in the Claude config holds `JIRA_URL` (the base URL),
  `JIRA_PERSONAL_TOKEN` (the PAT) and maybe `JIRA_SSL_VERIFY` (false means an internal certificate: see the TLS risk).
  The Connect form asks for the URL and the token; the user copies them from there.
- **Where settings live:**
  - Shared config / `local.json` page `props`: `site` name, `baseUrl`, filters, project → repo mapping. Never the
    token.
  - The token: a file only this user can read, `~/.config/herdr-app/herdr-dock/secrets/jira-<site>.token`
    (created by the page's **Connect** form, mode 600 on macOS / Linux). Not in the repo, not in `local.json`,
    not in shared state. The README says so.
  - Considered: the OS keychain (`security` on macOS, `secret-tool` on Linux, Credential Manager on Windows).
    Better at rest, but three code paths and no simple Windows CLI; a later step.
  - Rejected for v1: reading the token from the MCP's config. It reaches into another tool's settings; the user
    chose the private file.
- **Calls:** Herdr's `fetch` from the mod. Polling: every 2 min while the page is shown, every 10 min while hidden
  (for the nav badge), never while Jira is unreachable more often than every 5 min.
- **Risk, to check first at the office:** the company's TLS certificate. If Jira uses an internal CA, Herdr's
  `fetch` may reject it. Fallback designed in: the same requests through `curl` (`exec`), which uses the system
  trust store. A tiny transport layer (`fetch` or `curl`) keeps the rest unchanged.

### Mock Jira (development and tests)

- `scripts/mock-jira.mjs`, Node's `http`, no dependencies: `npm run mock:jira` → `http://127.0.0.1:8089`.
- Implements exactly the endpoints above, with the same JSON shapes (taken from Atlassian's REST v2 docs), from
  `tests/fixtures/jira/*.json`: ~30 issues across 3 projects, statuses in all three categories, a workflow with
  transitions, comments, two favourite filters.
- Checks the Bearer token (`mock-token`; anything else → 401) and keeps changes in memory (a transition moves the
  issue, a comment appears), so actions can be clicked through.
- A small JQL subset: `assignee = currentUser()`, `reporter = currentUser()`, `project = X`, `status = "Y"`,
  `resolution = Unresolved`, `text ~ "q"`, `AND`, `ORDER BY updated DESC`; anything else → 400 with Jira's error
  shape (so the error display is tested too).
- Switches to rehearse failures: `--slow 3000`, `--down` (connection refused), `--status 500`.
- The pure parts (JQL building, response → view model, grouping, task text) are unit-tested; the client is tested
  against the mock.

### Out of scope (Jira v1)

- Creating issues, editing fields other than status / assignee, boards and sprints, attachments, rendering wiki
  markup.
- Jira Cloud (different auth: email + API token, `/rest/api/3`). The transport keeps it possible later.

## Order of work

Part 1 is done. Part 2: `docs/superpowers/plans/2026-11-22-jira-page.md`.

## Open questions

- Jira version at work (Server 8.x vs Data Center 9/10): PATs need 8.14+.
- Does the company Jira need a proxy or VPN from the office network, and does its certificate come from an
  internal CA?
- The exact first message for Start work (the user's skill name), set in `props.startTask`.
- Whether `JIRA_SSL_VERIFY` is false in the MCP's config (an internal CA): if so, plan on the `curl` transport.
