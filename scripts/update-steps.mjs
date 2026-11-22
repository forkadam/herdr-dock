// Pure decisions for scripts/update.mjs.

// Update only runs on a clean main.
export function preflight({ dirty, branch }) {
  if (branch !== "main") return { ok: false, reason: `on branch ${branch}` };
  if (dirty.length) return { ok: false, reason: `local changes: ${dirty.join(", ")}` };
  return { ok: true };
}

export const needsInstall = (changedFiles) => changedFiles.some((f) => f === "package.json" || f === "package-lock.json");

// The file dock-core reads: { ok, from, to, commits, reason, at }.
export function resultOf({ from, to, commits, ok, reason }, now) {
  return { ok: !!ok, from: from ?? null, to: to ?? null, commits: commits ?? 0, reason: reason ?? null, at: now };
}
