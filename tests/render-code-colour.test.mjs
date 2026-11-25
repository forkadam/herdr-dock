// Code coloured as prismantis colours it (src/shared/render/code-colour.js).
import test from "node:test";
import assert from "node:assert/strict";
import { codeLines, isShellLang } from "../src/shared/render/code-colour.js";

const roles = (line) => line.map((r) => [r.text, r.role ?? null]);

test("shell (and unlabelled) code: command, flags, strings, comments, restarting after | && ; ||", () => {
  assert.ok(isShellLang("") && isShellLang("BASH") && isShellLang("ps1") && !isShellLang("js"));
  const [a, b] = codeLines('npm run deploy --dry-run "x" | grep ok\n# done', "bash");
  assert.deepEqual(roles(a).filter(([t]) => t.trim()), [["npm", "function"], ["run", null], ["deploy", null], ["--dry-run", "keyword"], ['"x"', "string"], ["|", null], ["grep", "function"], ["ok", null]]);
  assert.deepEqual(roles(b), [["# done", "comment"]]);
  assert.deepEqual(codeLines("ls  -la", "").length, 1);
});

test("Prism languages: keywords, strings, numbers, comments, functions", () => {
  const [line] = codeLines('const x = f("a", 2); // c', "js");
  const got = Object.fromEntries(roles(line).filter(([, r]) => r));
  assert.equal(got.const, "keyword");
  assert.equal(got['"a"'], "string");
  assert.equal(got["2"], "number");
  assert.equal(got["// c"], "comment");
  assert.equal(got.f, "function");
  assert.equal(roles(codeLines("def f(): pass", "py")[0]).find(([t]) => t === "def")[1], "keyword");
});

test("a language neither knows is plain; lines and empty lines are kept; text is never lost", () => {
  const code = "a b\n\n  c";
  const lines = codeLines(code, "brainfuck-ish");
  assert.deepEqual(lines.map((l) => l.map((r) => r.text).join("")), ["a b", "", "  c"]);
  assert.ok(lines.flat().every((r) => !r.role));
  const ts = codeLines("let s: string = `t${1}`;\n", "ts");
  assert.equal(ts.map((l) => l.map((r) => r.text).join("")).join("\n"), "let s: string = `t${1}`;\n");
});
