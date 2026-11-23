// Diagram colours (pure; no host imports): the colours beautiful-mermaid draws with, and the painting done after it,
// on the flattened SVG. Each node, participant, class box and ER entity takes its own colour from the theme's
// terminal colours; a chart's series too; a single-series bar chart prints its values. A node the author styled in the
// source (`style`, `class`, `cssClass`, `:::`) is left as drawn. Anything unexpected gives the SVG back unchanged.
import { mix } from "./flatten.js";

const TINT = 0.18; // a painted node's fill: this much of its colour over the fill it had
const BAR_TINT = 0.35; // a bar's fill: this much of its colour over the background
const LABEL_SIZE = 12;
const LABEL_GAP = 6;
const MIN_CONTRAST = 3; // WCAG ratio a palette colour needs against the background
const NODE_OPEN = /<g class="(?:node|class-node|entity|actor)" data-id="([^"]*)"[^>]*>/g;

// What beautiful-mermaid draws with, from the panel's theme.
export function mermaidColors(t) {
  return {
    bg: t.background, fg: t.foreground, line: mix(t.foreground, 0.5, t.background), accent: t.accent, muted: t.muted,
    surface: mix(t.foreground, t.dark ? 0.06 : 0.04, t.background), border: t.border, font: "sans-serif",
  };
}

const isHex = (c) => typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
const channels = (hex) => {
  const h = hex.trim().slice(1);
  const full = h.length === 3 ? [...h].map((x) => x + x).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// The WCAG contrast ratio of two hex colours (1 to 21).
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// The colours nodes take, in order: blue, cyan, green, magenta, yellow, then the accent. Red is left out (it reads as
// an error), and so is a duplicate or a colour too faint on the background. None left: the accent alone.
export function nodePalette(theme) {
  const t = theme ?? {};
  const seen = new Set();
  const out = [];
  for (const c of [t.ansi4, t.ansi6, t.ansi2, t.ansi5, t.ansi3, t.accent]) {
    if (!isHex(c) || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    if (isHex(t.background) && contrast(c, t.background) < MIN_CONTRAST) continue;
    out.push(c);
  }
  if (out.length) return out;
  return isHex(t.accent) ? [t.accent] : [];
}

// The node id just before `:::` in `text`: its shape ([…], (…), {…}, nested) skipped back over.
function idBefore(text) {
  let end = text.length;
  const close = { "]": "[", ")": "(", "}": "{" };
  if (close[text[end - 1]]) {
    let depth = 0;
    for (let i = end - 1; i >= 0; i--) {
      const ch = text[i];
      if (close[ch]) depth++;
      else if (Object.values(close).includes(ch) && --depth === 0) { end = i; break; }
    }
  }
  const token = /([\w.=-]+)\s*$/.exec(text.slice(0, end))?.[1];
  // A link written without spaces (---, -.-, ===, or one with a circle / cross head: --o, ---x, ==o) is made of these
  // characters too: the id is what follows the last link, read as the patched parser reads it (a hyphen before -, .
  // or > starts a link; == does; an o / x right after is its head), so `hot---B` and `A---oB` are `B` and `my-node`
  // stays whole.
  return token?.split(/(?:-(?=[-.>])[-.]*|={2,})[ox]?/).pop() || null;
}

// The nodes the source styles itself: `style X`, `class X,Y name` (not in a class diagram, where it declares a class),
// `cssClass "X,Y" name`, `X:::name`; `all` when a `classDef default` styles every node.
export function styledIds(source) {
  const lines = String(source ?? "").split("\n");
  const kind = lines.map((l) => l.trim()).find((l) => l && !l.startsWith("%%")) ?? "";
  const classDiagram = /^classDiagram\b/.test(kind);
  const ids = new Set();
  let all = false;
  const addList = (list) => { for (const id of list.split(",")) if (id.trim()) ids.add(id.trim()); };
  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if (/^classDef\s+default\b/.test(line)) all = true;
    if ((m = /^style\s+([^\s]+)/.exec(line))) addList(m[1]);
    if (!classDiagram && (m = /^class\s+([^\s]+)\s+\S/.exec(line))) addList(m[1]);
    if ((m = /^cssClass\s+"([^"]+)"/.exec(line))) addList(m[1]);
    for (let at = line.indexOf(":::"); at >= 0; at = line.indexOf(":::", at + 3)) {
      const id = idBefore(line.slice(0, at));
      if (id) ids.add(id);
    }
  }
  return { all, ids };
}

const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const px = (n) => Math.round(n * 100) / 100;

// Each node group, its end found by counting nested <g> (a stick-figure actor holds its icon in one, so the first </g>
// isn't the group's), replaced by fn(open, rawId, body, close). An unbalanced group leaves the rest as it is.
function replaceNodeGroups(svg, fn) {
  let out = "", at = 0;
  for (const m of svg.matchAll(NODE_OPEN)) {
    if (m.index < at) continue;
    const bodyStart = m.index + m[0].length;
    const tags = /<g\b|<\/g>/g;
    tags.lastIndex = bodyStart;
    let depth = 1, close = -1, t;
    while ((t = tags.exec(svg))) {
      if (t[0] !== "</g>") depth++;
      else if (--depth === 0) { close = t.index; break; }
    }
    if (close < 0) break;
    out += svg.slice(at, m.index) + fn(m[0], m[1], svg.slice(bodyStart, close), "</g>");
    at = close + "</g>".length;
  }
  return out + svg.slice(at);
}

// Each unstyled node group: strokes and text in its colour, other fills tinted toward it.
function paintNodes(svg, palette, styled) {
  if (!palette.length || styled.all) return svg;
  const colourOf = new Map();
  return replaceNodeGroups(svg, (open, rawId, body, close) => {
    const id = unxml(rawId);
    if (/^_(start|end)/.test(id) || styled.ids.has(id)) return open + body + close;
    if (!colourOf.has(id)) colourOf.set(id, palette[colourOf.size % palette.length]);
    const c = colourOf.get(id);
    const painted = body
      .replace(/(<(?:text|tspan)\b[^>]*?\bfill=")#[0-9a-f]{3,8}(")/gi, `$1${c}$2`)
      .replace(/(<(?!text\b|tspan\b)[a-z]+\b[^>]*?\bfill=")(#[0-9a-f]{6}|#[0-9a-f]{3})(")/gi, (_m, a, fill, b) => `${a}${mix(c, TINT, fill)}${b}`)
      .replace(/(\bstroke=")#[0-9a-f]{3,8}(")/gi, `$1${c}$2`);
    return open + painted + close;
  });
}

// Adds CSS to a start tag's style attribute (inline style wins over beautiful-mermaid's class rules).
function restyle(tag, css) {
  if (/\sstyle="/.test(tag)) return tag.replace(/\sstyle="([^"]*)"/, (_m, s) => ` style="${s.replace(/;?\s*$/, ";")}${css}"`);
  return tag.replace(/\s*(\/?)>$/, ` style="${css}"$1>`);
}

const attrOf = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const classesOf = (tag) => (attrOf(tag, "class") ?? "").split(/\s+/);

// A multi-series chart: everything of series N (bars, lines, their shadows, dots, legend swatches) takes palette
// colour N, the way beautiful-mermaid colours them: a bar its fill and stroke, a circle its fill, a path or line its
// stroke. Leaving any out would make the legend point at the wrong series.
function paintSeries(svg, palette, theme) {
  if (!palette.length) return svg;
  return svg.replace(/<([a-z]+)\b[^>]*>/g, (tag, name) => {
    const cls = classesOf(tag);
    const n = cls.map((k) => /^xychart-color-(\d+)$/.exec(k)?.[1]).find((x) => x !== undefined);
    if (n === undefined) return tag;
    const c = palette[Number(n) % palette.length];
    if (cls.includes("xychart-bar")) return restyle(tag, `fill:${mix(c, BAR_TINT, theme.background)};stroke:${c}`);
    if (name === "circle") return restyle(tag, `fill:${c}`);
    if (name === "path" || name === "line" || name === "polyline") return restyle(tag, `stroke:${c}`);
    return tag;
  });
}

// A bar's box, from its path (x,y pairs) or its rect attributes.
function barBox(tag) {
  const d = attrOf(tag, "d");
  if (d) {
    const n = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  }
  const x = Number(attrOf(tag, "x")), y = Number(attrOf(tag, "y"));
  return { left: x, right: x + Number(attrOf(tag, "width")), top: y, bottom: y + Number(attrOf(tag, "height")) };
}

// A single-series bar chart: the tallest bar in the accent, the rest muted, each value printed by its bar; the drawing
// grows upward if a value would leave it.
function labelBars(svg, theme) {
  const accent = theme.accent ?? theme.foreground, muted = theme.muted ?? theme.foreground;
  const bars = [...svg.matchAll(/<[a-z]+\b[^>]*>/g)].map((m) => m[0])
    .filter((tag) => classesOf(tag).includes("xychart-bar") && attrOf(tag, "data-value") !== undefined);
  if (!bars.length) return svg;
  const values = bars.map((tag) => Number(attrOf(tag, "data-value")));
  // The highlighted bars: the largest magnitude (in an all-negative chart, the most negative), every one of a tie; a
  // value that isn't a number is never it.
  const highlight = Math.max(...values.filter(Number.isFinite).map(Math.abs));
  const labels = [];
  let out = svg.replace(/<[a-z]+\b[^>]*>/g, (tag) => {
    const i = bars.indexOf(tag);
    if (i < 0) return tag;
    const c = Math.abs(values[i]) === highlight ? accent : muted;
    const box = barBox(tag);
    if (![box.left, box.right, box.top, box.bottom].every(Number.isFinite)) throw new Error("bar without a box");
    const y = values[i] < 0 ? box.bottom + LABEL_GAP + LABEL_SIZE : box.top - LABEL_GAP;
    labels.push({ x: (box.left + box.right) / 2, y, text: attrOf(tag, "data-value") });
    return restyle(tag, `fill:${mix(c, BAR_TINT, theme.background)};stroke:${c}`);
  });
  out = out.replace(/<\/svg>\s*$/, `${labels.map((l) => `<text x="${px(l.x)}" y="${px(l.y)}" text-anchor="middle" font-size="${LABEL_SIZE}" fill="${muted}" class="render-bar-value">${escText(l.text)}</text>`).join("\n")}\n</svg>\n`);
  // Room above: a label over the top grows the viewBox, the height and the background rect flattenSvg added.
  const root = /<svg\b[^>]*>/.exec(out)[0];
  const vb = attrOf(root, "viewBox")?.trim().split(/\s+/).map(Number);
  const top = Math.min(...labels.map((l) => l.y - LABEL_SIZE));
  if (vb?.length === 4 && top < vb[1]) {
    const grow = Math.ceil(vb[1] - top) + 4;
    const nvb = [vb[0], vb[1] - grow, vb[2], vb[3] + grow];
    let nroot = root.replace(/\sviewBox="[^"]*"/, ` viewBox="${nvb.join(" ")}"`);
    const h = Number(attrOf(root, "height"));
    if (h > 0) nroot = nroot.replace(/\sheight="[^"]*"/, ` height="${px(h * nvb[3] / vb[3])}"`);
    out = out.replace(root, nroot)
      .replace(`<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}"`, `<rect x="${nvb[0]}" y="${nvb[1]}" width="${nvb[2]}" height="${nvb[3]}"`);
  }
  return out;
}

// The flattened SVG of `source`, painted; the input unchanged if anything goes wrong.
export function paintDiagram(svg, source, theme) {
  try {
    if (typeof svg !== "string" || !/<svg\b/.test(svg)) return svg;
    const t = theme ?? {};
    const palette = nodePalette(t);
    let out = paintNodes(svg, palette, styledIds(source));
    const src = String(source ?? "");
    if (/^\s*xychart(-beta)?\b/m.test(src)) {
      const series = [...src.matchAll(/^\s*(bar|line)\b/gm)].map((m) => m[1]);
      if (series.length >= 2) {
        // With one colour, painting would make every series alike: beautiful-mermaid's own colours stay.
        if (palette.length >= 2) out = paintSeries(out, palette, t);
      } else if (series[0] === "bar" && !/^\s*xychart(-beta)?\s+horizontal/m.test(src)) out = labelBars(out, t);
    }
    if (!/<svg\b/.test(out) || /var\(|color-mix|<foreignObject/i.test(out)) return svg;
    return out;
  } catch {
    return svg;
  }
}
