// Column widths for a table (pure arithmetic; no Intl, so the Render mod can use it as well as the helper). Ported from
// prismantis 0.20.0 (hooks/render.tsx columnWidths), https://github.com/NahumLitvin/prismantis (MIT).

// Column widths that fit `available` columns with `gap` between them: natural when they fit, else the narrow ones
// keep theirs and the rest share what's left (never below a column's longest word when that fits).
export function columnWidths(natural, available, gap, words = []) {
  const room = Math.max(natural.length, available - gap * (natural.length - 1));
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= room) return natural;
  const minimum = natural.map((w, c) => Math.min(w, Math.max(1, words[c] ?? 1)));
  const widths = natural.map(() => 0);
  let open = natural.map((_, c) => c);
  let left = room;
  for (let fixed = [-1]; fixed.length;) {
    const share = Math.floor(left / open.length);
    const claim = (c) => (natural[c] <= share ? natural[c] : minimum[c]);
    const minimumsFit = open.reduce((a, c) => a + minimum[c], 0) <= left;
    const needed = open.reduce((a, c) => a + claim(c), 0);
    fixed = open.filter((c) => natural[c] <= share);
    if (minimumsFit && (!fixed.length || needed > left)) fixed = open.filter((c) => minimum[c] > share);
    fixed.forEach((c) => { widths[c] = claim(c); left -= widths[c]; });
    open = open.filter((c) => !fixed.includes(c));
  }
  open.forEach((c, i) => { widths[c] = Math.max(1, Math.floor(left / open.length) + (i < left % open.length ? 1 : 0)); });
  while (widths.reduce((a, b) => a + b, 0) > room) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 1) break;
    widths[widest]--;
  }
  return widths;
}
