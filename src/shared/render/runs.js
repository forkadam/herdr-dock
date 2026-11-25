// Inline Markdown as coloured runs for the Render panel (pure; no host imports; no Intl, so the mod can use it).
// A run is a piece of text and how it looks: { text, role?, bold?, italic?, strike?, href? }, role one of strong, em,
// del, code, link, number, path. Made from marked's inline tokens; in plain text, numbers and paths become their own
// runs with prismantis 0.20.0's patterns (hooks/markdown.ts, https://github.com/NahumLitvin/prismantis, MIT), a path
// winning where they overlap, and neither inside inline code or links.

const NUMBER = /(?<![\w.#/-])(v?\d+(?:[.,:]\d+)*(?:%|ms|s|m|h|d|Gi|Mi|GB|MB|KB|x)?)(?![\w/])/g;
const PATH = /(?<![\w/.:])((?:~|\.{1,2})?\/[\w.@+-]+(?:\/[\w.@+-]*)*)/g;

const STYLE = ["role", "bold", "italic", "strike", "href"];
const sameStyle = (a, b) => STYLE.every((k) => a[k] === b[k]);

// A run with only the keys that are set (so tests and the panel see { text } for plain text).
function run(text, style) {
  const r = { text };
  for (const k of STYLE) if (style[k] !== undefined) r[k] = style[k];
  return r;
}

// Plain text -> runs: numbers and paths take their role and keep the base's bold, italic and strike.
export function decorate(text, base = {}) {
  const marks = [];
  for (const m of text.matchAll(PATH)) marks.push({ start: m.index, end: m.index + m[0].length, role: "path" });
  for (const m of text.matchAll(NUMBER)) {
    const start = m.index, end = start + m[0].length;
    if (!marks.some((p) => start < p.end && end > p.start)) marks.push({ start, end, role: "number" });
  }
  marks.sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const m of marks) {
    if (m.start > at) out.push(run(text.slice(at, m.start), base));
    out.push(run(text.slice(m.start, m.end), { ...base, role: m.role }));
    at = m.end;
  }
  if (at < text.length) out.push(run(text.slice(at), base));
  return out;
}

function walk(tokens, base, out) {
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong": walk(t.tokens, { ...base, role: "strong", bold: true }, out); break;
      case "em": walk(t.tokens, { ...base, role: "em", italic: true }, out); break;
      case "del": walk(t.tokens, { ...base, role: "del", strike: true }, out); break;
      case "codespan": out.push(run(t.text, { role: "code" })); break;
      case "link": {
        // The link's own text, undecorated.
        const text = []; walk(t.tokens, {}, text);
        out.push(run(text.map((r) => r.text).join(""), { role: "link", href: t.href }));
        break;
      }
      case "br": out.push({ text: "\n" }); break;
      case "checkbox": break; // a task item's [ ] / [x]: the panel draws its marker instead
      case "escape": out.push(...decorate(t.text, base)); break;
      default:
        if (Array.isArray(t.tokens) && t.tokens.length && t.type !== "html") walk(t.tokens, base, out);
        // A line break inside a paragraph is a space, as Markdown (and prismantis) show it; only a hard break starts a line.
        else out.push(...decorate(t.type === "html" ? String(t.raw ?? "") : String(t.text ?? t.raw ?? "").replace(/\n/g, " "), base));
    }
  }
  return out;
}

// marked inline tokens -> runs, adjacent runs of the same style merged.
export function inlineRuns(tokens) {
  const out = [];
  for (const r of walk(tokens, {}, [])) {
    const last = out.at(-1);
    if (last && r.text !== "\n" && last.text !== "\n" && sameStyle(last, r)) last.text += r.text;
    else if (r.text) out.push({ ...r });
  }
  return out;
}
