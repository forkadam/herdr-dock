// Code coloured for the Render panel (helper side: Prism is bundled into herdr-render.mjs, never into the mod).
// codeLines(code, lang) -> one array of runs per line: { text, role? }, role one of comment, string, number, keyword,
// function, property, attr, regex. Shell and unlabelled code is coloured as prismantis 0.20.0 does it (hooks/render.tsx
// isShellLang / codeLine); other languages by Prism (MIT), its token types mapped as prismantis's PRISM_COLORS maps
// them (https://github.com/NahumLitvin/prismantis, MIT). A language neither knows is plain.
import Prism from "prismjs";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-rust.js";
import "prismjs/components/prism-java.js";
import "prismjs/components/prism-kotlin.js";
import "prismjs/components/prism-swift.js";
import "prismjs/components/prism-c.js";
import "prismjs/components/prism-cpp.js";
import "prismjs/components/prism-csharp.js";
import "prismjs/components/prism-ruby.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-yaml.js";
import "prismjs/components/prism-toml.js";
import "prismjs/components/prism-sql.js";
import "prismjs/components/prism-docker.js";
import "prismjs/components/prism-hcl.js";
import "prismjs/components/prism-diff.js";

export const isShellLang = (lang) => lang === "" || /^(sh|bash|zsh|shell|console|fish|powershell|ps1)$/i.test(lang);

const ALIASES = {
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", py: "python", golang: "go", rs: "rust",
  kt: "kotlin", "c++": "cpp", cc: "cpp", h: "c", hpp: "cpp", cs: "csharp", rb: "ruby", yml: "yaml", dockerfile: "docker",
  html: "markup", xml: "markup", svg: "markup", tf: "hcl", patch: "diff",
};

// prismantis's PRISM_COLORS, its slots mapped onto our roles.
const SLOT = { codeComment: "comment", codeString: "string", number: "number", codeFlag: "keyword", codeCommand: "function", link: "property", emphasis: "attr", path: "regex" };
const PRISM_COLORS = {
  comment: "codeComment", prolog: "codeComment", doctype: "codeComment", cdata: "codeComment",
  string: "codeString", char: "codeString", "template-string": "codeString", "attr-value": "codeString", url: "codeString",
  number: "number", boolean: "number", constant: "number", symbol: "number", inserted: "number",
  keyword: "codeFlag", important: "codeFlag", atrule: "codeFlag", rule: "codeFlag", deleted: "codeFlag",
  function: "codeCommand", "class-name": "codeCommand", builtin: "codeCommand", key: "codeCommand", selector: "codeCommand",
  property: "link", tag: "link", "attr-name": "emphasis", variable: "emphasis", regex: "path",
};
const roleOf = (token) => {
  for (const t of [token.type, ...[].concat(token.alias ?? [])]) if (PRISM_COLORS[t]) return SLOT[PRISM_COLORS[t]];
  return undefined;
};

// Prism's token tree -> flat runs (an inner token's role wins; one with none inherits its parent's).
function flatten(tokens, role, out) {
  for (const t of tokens) {
    if (typeof t === "string") out.push({ text: t, role });
    else flatten(Array.isArray(t.content) ? t.content : [t.content], roleOf(t) ?? role, out);
  }
  return out;
}

// Appends a run to a line, merged into the last one when they share a colour (fewer pieces for the panel to draw).
function push(line, text, role) {
  const last = line.at(-1);
  if (last && (last.role ?? null) === (role ?? null)) last.text += text;
  else line.push(role ? { text, role } : { text });
}

// Runs (which may hold "\n") -> lines of runs; empty pieces dropped, empty lines kept.
function toLines(runs) {
  const lines = [[]];
  for (const r of runs) {
    r.text.split("\n").forEach((piece, i) => {
      if (i > 0) lines.push([]);
      if (piece) push(lines.at(-1), piece, r.role);
    });
  }
  return lines;
}

// One shell line, as prismantis colours it.
function shellLine(line) {
  if (/[\u2500-\u257F]/.test(line)) return line ? [{ text: line }] : [];
  if (/^\s*#/.test(line)) return [{ text: line, role: "comment" }];
  const out = [];
  let seenCommand = false;
  for (const p of line.split(/("[^"]*"|'[^']*'|\s+)/).filter((x) => x !== "")) {
    if (/^\s+$/.test(p)) push(out, p);
    else if (/^["']/.test(p)) push(out, p, "string");
    else if (/^--?[\w-]/.test(p)) push(out, p, "keyword");
    else if (!seenCommand && !/^[$>|&;]+$/.test(p)) { seenCommand = true; push(out, p, "function"); }
    else {
      if (/^(\||&&|;|\|\|)$/.test(p)) seenCommand = false;
      push(out, p);
    }
  }
  return out;
}

export function codeLines(code, lang = "") {
  const text = String(code ?? "");
  const l = String(lang ?? "").trim().toLowerCase();
  if (isShellLang(l)) return text.split("\n").map(shellLine);
  const grammar = Prism.languages[ALIASES[l] ?? l];
  if (!grammar) return text.split("\n").map((line) => (line ? [{ text: line }] : []));
  return toLines(flatten(Prism.tokenize(text, grammar), undefined, []));
}
