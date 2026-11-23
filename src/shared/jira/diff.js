// A line diff (no host imports), for what changed in an issue's description: the text before and after, split into
// lines, as [{ op: "same" | "add" | "del", text }] in reading order. Within a changed region every "del" line comes
// before the "add" lines. Lines compare exactly (no trimming); "\r\n" counts as "\n".

// When the lines left after the common start and end are trimmed make a table bigger than this (before x after),
// the LCS is skipped and the middle is given as all "del", then all "add".
const MAX_CELLS = 2000 * 2000;

// null, undefined and "" are no lines at all (so "" -> "a" is one add, not a del of an empty line plus an add).
const toLines = (text) => (typeof text === "string" && text !== "" ? text.replace(/\r\n/g, "\n").split("\n") : []);

// before and after: strings (or null/undefined for no text).
export function lineDiff(before, after) {
  const a = toLines(before), b = toLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ op: "same", text: a[i] });
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  for (const o of diffMiddle(midA, midB)) ops.push(o);
  for (let i = endA; i < a.length; i++) ops.push({ op: "same", text: a[i] });
  return ops;
}

// { added, removed } line counts of lineDiff's result.
export function diffStats(ops) {
  let added = 0, removed = 0;
  for (const o of Array.isArray(ops) ? ops : []) {
    if (o?.op === "add") added++;
    else if (o?.op === "del") removed++;
  }
  return { added, removed };
}

// ---- The middle ----

const dels = (lines) => lines.map((text) => ({ op: "del", text }));
const adds = (lines) => lines.map((text) => ({ op: "add", text }));

// The ops for lines that differ at both ends (neither starts or ends the same way).
function diffMiddle(a, b) {
  if (!a.length) return adds(b);
  if (!b.length) return dels(a);
  if (a.length * b.length > MAX_CELLS) return [...dels(a), ...adds(b)];

  // Same text -> same number, so the table below compares numbers and not strings.
  const ids = new Map();
  const num = (line) => { let n = ids.get(line); if (n === undefined) ids.set(line, n = ids.size); return n; };
  const x = a.map(num), y = b.map(num);

  // lcs[i * w + j]: the longest common run of x[i..] and y[j..]. At most min(a, b) <= 2000 here, so 16 bits are plenty.
  const w = y.length + 1;
  const lcs = new Uint16Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  // Walk it from the start; between two "same" lines gather the dels and the adds apart, then give the dels first.
  const ops = [];
  let del = [], add = [];
  const flush = () => { for (const o of dels(del)) ops.push(o); for (const o of adds(add)) ops.push(o); del = []; add = []; };
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { flush(); ops.push({ op: "same", text: a[i] }); i++; j++; }
    else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) del.push(a[i++]);
    else add.push(b[j++]);
  }
  while (i < x.length) del.push(a[i++]);
  while (j < y.length) add.push(b[j++]);
  flush();
  return ops;
}
