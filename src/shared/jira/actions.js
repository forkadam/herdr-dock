// The action rules, as a pure model (no host imports): which messages Start work and Finish send for an issue.
// Rule = { project?, type?, subtask?, parentType?: string[], start?, finish? } (settings.js validates them). The first
// rule whose every given key matches the issue gives both messages; none matching gives neither.
// Issues are rows or details (model.js): { key, project, type, subtask, parent: { type } | null }.

// An issue's project: its own field, or the key's prefix (before the last dash) when it has none.
function projectOf(issue) {
  if (issue?.project != null) return issue.project;
  const key = String(issue?.key ?? "");
  const dash = key.lastIndexOf("-");
  return dash > 0 ? key.slice(0, dash) : null;
}

// Project and type are Jira's names, matched exactly. subtask false takes an issue whose subtask is false or missing.
// parentType takes an issue whose parent's type is one of its entries, so an issue without a parent never matches it.
function matches(rule, issue) {
  if (rule.project != null && rule.project !== projectOf(issue)) return false;
  if (rule.type != null && rule.type !== issue?.type) return false;
  if (rule.subtask != null && rule.subtask !== Boolean(issue?.subtask)) return false;
  if (rule.parentType != null && !(Array.isArray(rule.parentType) && rule.parentType.includes(issue?.parent?.type))) return false;
  return true;
}

// -> { start, finish }: the messages of the first matching rule (null for the one it lacks), both null for none.
export function matchAction(rules, issue) {
  const rule = (Array.isArray(rules) ? rules : []).find((r) => r && typeof r === "object" && matches(r, issue));
  return { start: rule?.start ?? null, finish: rule?.finish ?? null };
}
