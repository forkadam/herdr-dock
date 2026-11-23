// What the Browser panel does outside itself: the control record (it is that record's one writer), agent-browser and
// browse.mjs runs, and the "The agent needs you" notifications. No typed input passes through here.
import { appHome, exec, notify, readTextFile, setShared, shared, writeTextFile } from "herdr";
import * as fs from "fs/promises";
import { slashPath } from "../../shared/path.js";
import { controlFileRel, sessionsRel } from "../../shared/browser/session.js";
import { parseControl, parseSession } from "../../shared/browser/registry.js";
import { browserShowName, controlOf, controlText, handoffNotices, rememberNotified } from "../../shared/browser/panel.js";

const NOTIFIED_KEY = "dock.browser.notified"; // handoff ids already announced, shared by every copy of the panel

const home = () => slashPath(appHome());

// Terminal t's control record as it is on disk now (what another panel copy may have written since).
export async function readControl(t, created) {
  return controlOf(await readTextFile(`${home()}/${controlFileRel(t)}`).catch(() => null), created);
}

// Changes terminal t's control record (written whole and atomically, checked against what was read, so two panel
// copies never lose each other's change). Returns the new control, or null when it couldn't be written.
export async function writeControl(t, created, change) {
  const path = `${home()}/${controlFileRel(t)}`;
  await fs.mkdir(`${home()}/${sessionsRel()}`, { recursive: true }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    const text = await readTextFile(path).catch(() => null);
    const next = controlText(text, created, change);
    try {
      await writeTextFile(path, next, text);
      return parseControl(next);
    } catch {}
  }
  return null;
}

const firstLine = (r) => String(r?.stderr || r?.stdout || "").trim().split("\n").find((l) => l.trim()) ?? "";

// Runs a program; throws with its first line of output when it fails.
export async function run(cmd, args, timeout = 60_000) {
  const r = await exec(cmd, args, { timeout });
  if (r.code !== 0) throw new Error(firstLine(r) || `${cmd} exited ${r.code}`);
  return r;
}

// browse.mjs (the window commands), as the agent's own browse runs.
export const browse = (args) => run("node", [`${home()}/mods/dock-browser/browse.mjs`, ...args], 120_000);

// Every terminal's session and control records.
async function allRecords() {
  const dir = `${home()}/${sessionsRel()}`;
  let names = [];
  try { names = await fs.readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json") || n.endsWith(".control.json")) continue;
    const session = parseSession(await readTextFile(`${dir}/${n}`).catch(() => null));
    if (!session) continue;
    const control = parseControl(await readTextFile(`${home()}/${controlFileRel(session.terminal)}`).catch(() => null));
    out.push({ session, control });
  }
  return out;
}

// One notification per new handoff: "The agent needs you", the agent's message; clicked, it shows the panel on that
// agent (dock-core's browser.show).
export async function announceHandoffs(handoffMinutes) {
  const entries = await allRecords();
  const notices = handoffNotices(entries, shared(NOTIFIED_KEY), Date.now(), handoffMinutes);
  if (!notices.length) return;
  setShared(NOTIFIED_KEY, rememberNotified(shared(NOTIFIED_KEY), notices.map((n) => n.id)));
  for (const n of notices) {
    notify({
      title: "The agent needs you", body: n.message, level: "warning",
      action: { name: `dock-core.${browserShowName(n.terminal)}` },
    });
  }
}
