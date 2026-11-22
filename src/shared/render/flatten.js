// beautiful-mermaid's SVG made drawable without a browser (Herdr draws SVG natively): CSS variables and color-mix()
// resolved to colours, no @import or web fonts (generic families), a background rect, no foreignObject. Ported from
// herdr-chat's host/mermaid.ts (MIT, (c) Adam Chmara: https://github.com/ChmaraX/herdr-chat).

function parseHex(c) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

// color-mix(in srgb, A p%, B) for hex colours.
export function mix(a, p, b) {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return a;
  return toHex(x.map((v, i) => v * p + y[i] * (1 - p)));
}

function closeParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function args(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function resolve(value, vars, depth = 0) {
  if (depth > 20) return value;
  let s = value;
  for (;;) {
    const i = s.search(/\b(var|color-mix)\(/);
    if (i < 0) return s;
    const fn = s.startsWith("var(", i) ? "var" : "color-mix";
    const open = i + fn.length;
    const close = closeParen(s, open);
    if (close < 0) return s;
    const inner = s.slice(open + 1, close);
    let rep;
    if (fn === "var") {
      const [name, ...fb] = args(inner);
      const v = vars.get(name);
      rep = v !== undefined ? resolve(v, vars, depth + 1) : fb.length ? resolve(fb.join(","), vars, depth + 1) : "none";
    } else {
      const [, a = "", b = ""] = args(inner).map((x) => resolve(x, vars, depth + 1));
      const pa = /^(.*?)\s+([\d.]+)%$/.exec(a);
      rep = mix(pa ? pa[1].trim() : a, pa ? Number(pa[2]) / 100 : 0.5, b.replace(/\s+[\d.]+%$/, "").trim());
    }
    s = s.slice(0, i) + rep + s.slice(close + 1);
  }
}

export function flattenSvg(svg, bg) {
  const vars = new Map();
  const collect = (decls) => {
    for (const d of decls.split(";")) {
      const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d);
      if (m) vars.set(m[1], m[2]);
    }
  };
  const root = /<svg\b[^>]*>/.exec(svg);
  if (!root) throw new Error("no <svg> element");
  collect(/ style="([^"]*)"/.exec(root[0])?.[1] ?? "");
  for (const m of svg.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    // An `svg { --x: … }` rule, at the start, after another rule or after a statement (an @import).
    for (const r of m[1].matchAll(/(?:^|[};\n])\s*svg\s*\{([^}]*)\}/g)) collect(r[1].replace(/\/\*[\s\S]*?\*\//g, ""));
  }
  const newRoot = root[0].replace(/ style="[^"]*"/, "").replace(/<svg\b/, '<svg font-family="sans-serif"');
  let out = svg.slice(0, root.index) + newRoot + svg.slice(root.index + root[0].length);
  out = out.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => {
    const rules = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@import\s+url\([^)]*\)\s*;?/g, "")
      .replace(/(^|[};\n])\s*svg\s*\{[^}]*\}/g, "$1")
      .replace(/font-family:\s*([^;}]*)/g, (_m, v) => `font-family: ${/mono/i.test(v) ? "monospace" : "sans-serif"}`)
      .replace(/:\s*([^;{}]*\b(?:var|color-mix)\([^;{}]*)/g, (_m, v) => `: ${resolve(v, vars)}`);
    return `<style>${rules.replace(/\n\s*\n/g, "\n")}</style>`;
  });
  out = out.replace(/"([^"]*\b(?:var|color-mix)\([^"]*)"/g, (_, v) => `"${resolve(v, vars)}"`);
  out = out.replace(/font-family="[^"]*"/g, (m) => (/mono/i.test(m) ? 'font-family="monospace"' : 'font-family="sans-serif"'));
  const vb = /viewBox="([\d.\s-]+)"/.exec(newRoot)?.[1]?.trim().split(/\s+/).map(Number);
  if (vb && vb.length === 4) {
    const rect = `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${bg}"/>`;
    out = /<\/style>/.test(out) ? out.replace(/(<\/style>)/, `$1\n${rect}`) : out.replace(newRoot, `${newRoot}\n${rect}`);
  }
  if (/\b(var|color-mix)\(|<foreignObject/i.test(out)) throw new Error("SVG still needs a browser (CSS variables or foreignObject)");
  return out;
}
