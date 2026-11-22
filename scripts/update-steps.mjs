// Pure decisions for scripts/update.mjs.

// Update only runs on a clean main.
export function preflight({ dirty, branch }) {
  if (branch !== "main") return { ok: false, reason: `on branch ${branch}` };
  if (dirty.length) return { ok: false, reason: `local changes: ${dirty.join(", ")}` };
  return { ok: true };
}

export const needsInstall = (changedFiles) => changedFiles.some((f) => f === "package.json" || f === "package-lock.json");

// npm ci runs when the package files changed since the base, when node_modules is missing, or when the
// change can't be known (changed null: no deployed commit to compare with).
export const installNeeded = ({ changed, hasNodeModules }) => !hasNodeModules || changed == null || needsInstall(changed);

// What to do after the pull, given the HEAD before (from) and after (to) it and the commit the last deploy
// recorded in mods/dock-core/source.json (deployed; null when unknown).
// "deploy": new commits (packages compared from the deployed commit when known, else from);
// "redeploy": nothing pulled, but HEAD isn't what was deployed (a half-finished update, a manual pull);
// "none": up to date.
export function planAfterPull({ from, to, deployed }) {
  const d = deployed || null;
  if (to !== from) return { action: "deploy", base: d ?? from };
  if (d === to) return { action: "none" };
  return { action: "redeploy", base: d };
}

// The file dock-core reads: { ok, from, to, commits, reason, at }.
export function resultOf({ from, to, commits, ok, reason }, now) {
  return { ok: !!ok, from: from ?? null, to: to ?? null, commits: commits ?? 0, reason: reason ?? null, at: now };
}

// File names from `git status --porcelain` output (lines are "XY path", a rename "XY old -> new").
export function parseDirty(porcelain) {
  return String(porcelain).split(/\r?\n/).filter((l) => l.length > 3).map((l) => {
    const p = l.slice(3);
    const i = p.indexOf(" -> ");
    return (i >= 0 ? p.slice(i + 4) : p).trim();
  });
}
