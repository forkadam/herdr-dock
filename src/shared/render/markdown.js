// Markdown with Mermaid in it (pure; no host imports): a message split into what TextView.markdown draws and the
// Mermaid diagrams drawn as images.

// FNV-1a, 32-bit, hex: names a rendered diagram by its source (so each is rendered once).
export function hashText(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w.+-]*)/;
const trimBlank = (lines) => {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b).join("\n");
};

// Text -> [{ kind: "md", text } | { kind: "mermaid", source, id }], in order. A ```mermaid (or ~~~mermaid, any case)
// block becomes a diagram; any other fenced block stays Markdown (and a "mermaid" inside it isn't one). A fence not
// closed yet (an answer still arriving) stays text.
export function splitSegments(text) {
  const out = [];
  let md = [];
  const flush = () => {
    const t = trimBlank(md);
    if (t) out.push({ kind: "md", text: t });
    md = [];
  };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (!m) { md.push(lines[i]); continue; }
    const fence = m[1];
    const close = new RegExp(`^\\s{0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    if (j >= lines.length) { md.push(...lines.slice(i)); break; } // not closed: text
    if (m[2].toLowerCase() === "mermaid") {
      flush();
      const source = lines.slice(i + 1, j).join("\n").replace(/\s+$/, "");
      out.push({ kind: "mermaid", source, id: hashText(source) });
    } else {
      md.push(...lines.slice(i, j + 1));
    }
    i = j;
  }
  flush();
  return out;
}

// Just the Mermaid sources of a text, in order.
export const mermaidBlocks = (text) => splitSegments(text).filter((s) => s.kind === "mermaid").map((s) => s.source);
