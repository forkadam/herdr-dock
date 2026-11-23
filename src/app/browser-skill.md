---
name: dock-browser
description: Use the browser beside this conversation in Herdr (herdr-dock) to debug a UI workflow end to end, check a page for security bugs, check layout at phone, tablet and desktop sizes, or act on Design Feedback the person sends. Use it whenever a task needs a real browser and this session runs in a Herdr terminal.
---
<!-- herdr-dock: dock-browser -->

# The browser beside this conversation

This session has a real browser of its own. The person sees the same page live in the Browser panel next to you and can take over at any point. Every command below is run through your shell tool. It works only in a Herdr terminal: outside one, `browse` says so and exits 2 (then tell the person; don't look for another way in).

## When to use it

Use it when the task needs a real page: reproducing a bug in a UI flow, walking a workflow until it breaks, checking a page for security problems, checking layout at several sizes, or acting on Design Feedback. For reading a static page or an API, use a plain fetch instead.

## Open and act

- Open a page (`localhost:3000`, a URL or a file path): `{{BROWSE}} open <url>`
- Run one agent-browser command on it: `{{BROWSE}} action -- <command>`. The useful ones: `snapshot -i` (the page's controls, each with an `@e1` style reference), `click @e3`, `fill @e2 "text"`, `press Enter`, `get text @e1`, `eval "<js>"`, `console`, `errors`, `network requests`, `screenshot <path>`, `tab ...`, `set viewport`, `set device`.
- Take a fresh `snapshot -i` after every step that changes the page: references go stale.
- `{{BROWSE}} status` says what is open and whether the person has control. `{{BROWSE}} close` ends the browser when you are done.
- `close`, `connect`, `--cdp`, `--session` and `--profile` are refused in `action`; they would leave or swap your browser.

## Debugging a workflow

After each step, run `{{BROWSE}} action -- errors` and `{{BROWSE}} action -- console`, and look at failed requests with `{{BROWSE}} action -- network requests`. Take a screenshot at each state that matters (`{{BROWSE}} action -- screenshot <path>`) and say what you saw before moving on. Report the first step where behaviour differs from what the person expects, with the evidence.

## Profiles and security checks

- `open` uses the **clean** profile by default: a fresh browser, nothing kept.
- `open --profile signed-in` uses the person's saved logins, shared by all sessions. The profile of a running session doesn't change; asking for the other one restarts the session.
- Security checks (crafted input, changed requests, other users' IDs, probing for injection or access control gaps) only with `{{BROWSE}} open --profile clean <url>`: never with the signed-in profile, whose cookies are the person's real ones.

## Production

When output starts with a `PRODUCTION (<host>)` banner, the page is a production host. There: no probing, and nothing that writes (submit, save, delete, send, purchase) unless the person asked for exactly that in this task. Reading and looking are fine.

## Handoff: the person's turn

You never type credentials and never solve captchas or 2FA. Hand the page to the person:

1. `{{BROWSE}} handoff "Sign in to alpha, then press Done"` returns at once.
2. Run `{{BROWSE}} wait`. Run it with the **longest timeout your shell tool allows**: it waits at most 9 minutes. Exit 0: the person pressed Done or handed back, carry on. Exit 1: they cancelled or nobody answered in time; stop and say so. On **exit 4** it is still waiting at the limit: run `wait` again.
3. If an `action` returns **exit 3** the person has taken control of the page ("the person has control; run browse wait"): run `{{BROWSE}} wait`, then continue with a fresh `snapshot -i`.

To use the signed-in profile before the person has logged in, ask them to run `{{BROWSE}} login <url>` themselves.

## Credentials

Never read credential fields: no `eval` on password inputs, no `get value` on them (nor on tokens, API keys or one-time codes), and don't screenshot them filled. What the person types into the page during a handoff or take-over is theirs.

## Layout at several sizes

Check sizes in a tab of its own so your main tab keeps its size: `{{BROWSE}} action -- tab new <url>`, then `{{BROWSE}} action -- set device "iPhone 16"` (phone), `set device "iPad"` (tablet), `set viewport 1440 900` (desktop), screenshot each, then `{{BROWSE}} action -- tab close`.

## Design Feedback

A prompt headed `## Design Feedback` comes from the person picking elements in the panel. Per element it gives a selector, its text, the person's note, an intent and priority when they set one, on a dev build the source file and line to change, and a `Picture:` path: open it to see the whole page as it was, with that element outlined in orange. `[redacted]` stands where something looked like a secret. Make the changes in those sources, then reload the page in the browser and check the result against the note.

## Leave it to the person

Anything that publishes or acts in the person's name stays on its button for them: Submit, Send, Approve, Merge, Delete, a review, a comment, a form that sends. Get the page to the point of pressing it, say so, and let them.

---
Adapted from the `side-browser` skill of cockpit (quaresc/cockpit, MIT). Browser automation by agent-browser (Vercel, Apache-2.0).
