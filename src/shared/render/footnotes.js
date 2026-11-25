// Footnotes for the Render panel (helper side), as prismantis 0.20.0 draws them (hooks/markdown.ts,
// https://github.com/NahumLitvin/prismantis, MIT): `[^label]` references become superscript marks numbered by first
// reference (notes nobody references come after, in the order written), and the notes (`[^label]: text`, with
// indented continuation lines) are drawn at the end. marked 18 has no footnotes, so this runs before it. Nothing inside
// a fence or inline code counts; a reference without a note stays as written.
import { marked } from "marked";
import { inlineRuns } from "./runs.js";

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const markOf = (n) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join("");
const NOTE = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const REF = /\[\^([^\]\s]+)\](?!:)/g;
const CODE_SPAN = /(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;
const bytes = (s) => new TextEncoder().encode(String(s ?? "")).length;

// Lines with whether each is code (inside a fence, fences included), and for each note line its label and text.
function scan(text) {
  const out = [];
  let fence = null;
  let note = null; // the note being continued by indented lines
  for (const line of String(text ?? "").split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push({ line, code: true });
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      continue;
    }
    if (f) { fence = f[1]; note = null; out.push({ line, code: true }); continue; }
    const m = NOTE.exec(line);
    if (m) { note = { label: m[1], text: m[2] }; out.push({ line, note }); continue; }
    if (note && /^( {2,}|\t)\S/.test(line)) { note.text += ` ${line.trim()}`; out.push({ line, cont: true }); continue; }
    note = null;
    out.push({ line });
  }
  return out;
}

// Runs fn over the parts of a line outside inline code spans.
function outsideCode(line, fn) {
  let out = "", at = 0;
  for (const m of line.matchAll(CODE_SPAN)) { out += fn(line.slice(at, m.index)) + m[0]; at = m.index + m[0].length; }
  return out + fn(line.slice(at));
}

// The notes and the mark each label gets.
export function collectFootnotes(text) {
  const lines = scan(text);
  const defs = new Map();
  for (const l of lines) if (l.note && !defs.has(l.note.label)) defs.set(l.note.label, l.note.text.trim());
  const marks = new Map();
  for (const l of lines) {
    if (l.code || l.note || l.cont) continue;
    outsideCode(l.line, (part) => {
      for (const m of part.matchAll(REF)) if (defs.has(m[1]) && !marks.has(m[1])) marks.set(m[1], markOf(marks.size + 1));
      return part;
    });
  }
  for (const label of defs.keys()) if (!marks.has(label)) marks.set(label, markOf(marks.size + 1));
  const notes = [...marks].map(([label, mark]) => ({ mark, md: defs.get(label) }));
  return { marks, notes };
}

// The text with references outside code replaced by their marks and the notes taken out.
export function applyFootnotes(text, marks) {
  if (!marks?.size) return String(text ?? "");
  return scan(text).filter((l) => !(l.note && marks.has(l.note.label)) && !l.cont)
    .map((l) => (l.code || l.note ? l.line : outsideCode(l.line, (part) => part.replace(REF, (all, label) => marks.get(label) ?? all))))
    .join("\n");
}

// The block the panel draws at the end: each note's mark and its text as runs.
export function footnotesBlock(notes) {
  const md = notes.map((n) => `${n.mark} ${n.md}`).join("\n");
  const n = bytes(md);
  return {
    kind: "footnotes", md, bytes: n, cost: n, buttons: [],
    notes: notes.map((x) => ({ mark: x.mark, runs: inlineRuns(marked.lexer(x.md, { gfm: true })[0]?.tokens ?? []) })),
  };
}
