// Writes tests/fixtures/gpui-element-methods.json: every element method Herdr's gpui-kit.d.ts declares
// (see `shapes` below), which the tests' host stub accepts and nothing else.
// Run after a Herdr update: node scripts/gpui-element-methods.mjs [path/to/gpui-kit.d.ts]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const home = process.env.HERDR_APP_HOME ?? join(homedir(), ".config", "herdr-app");
const source = process.argv[2] ?? join(home, "mods", "dock-core", "gpui-kit.d.ts");
const text = readFileSync(source, "utf8");
// Two shapes: `name<Self extends Element[, T]>(this: Self, …)` and `name(…): this;` (token, on_token_click, …).
const shapes = [/^\s+([a-z_][a-z_0-9]*)<Self extends Element[^>]*>\(this: Self/gm, /^\s+([a-z_][a-z_0-9]*)\(.*\):\s*this;$/gm];
const names = [...new Set(shapes.flatMap((re) => [...text.matchAll(re)].map((m) => m[1])))].sort();
if (!names.length) throw new Error(`no element methods found in ${source}`);
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "gpui-element-methods.json");
writeFileSync(out, JSON.stringify(names) + "\n");
console.log(`wrote ${names.length} element methods from ${source} to ${out}`);
