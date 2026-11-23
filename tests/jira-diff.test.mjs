// The line diff (src/shared/jira/diff.js): what changed in an issue's description, as same/add/del lines.
import test from "node:test";
import assert from "node:assert/strict";
import { diffStats, lineDiff } from "../src/shared/jira/diff.js";

const same = (text) => ({ op: "same", text });
const add = (text) => ({ op: "add", text });
const del = (text) => ({ op: "del", text });
const lines = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test("lineDiff: changes in the middle", () => {
  assert.deepEqual(lineDiff("a\nb\nc", "a\nx\nc"), [{ op: "same", text: "a" }, { op: "del", text: "b" }, { op: "add", text: "x" }, { op: "same", text: "c" }]);
});

test("lineDiff: from nothing, to nothing", () => {
  assert.deepEqual(lineDiff(null, "a\nb"), [{ op: "add", text: "a" }, { op: "add", text: "b" }]);
  assert.deepEqual(lineDiff("a", ""), [{ op: "del", text: "a" }]);
  assert.deepEqual(lineDiff("", ""), []);
});

test("lineDiff: a 3000-line text stays fast", () => {
  const a = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
  const t = performance.now();
  assert.deepEqual(diffStats(lineDiff(a, a.replace("line 1500", "changed"))), { added: 1, removed: 1 });
  assert.ok(performance.now() - t < 500);
});

test("lineDiff: null, undefined and empty all mean no lines", () => {
  assert.deepEqual(lineDiff(null, null), []);
  assert.deepEqual(lineDiff(undefined, undefined), []);
  assert.deepEqual(lineDiff(undefined, "a"), [add("a")]);
  assert.deepEqual(lineDiff("a", null), [del("a")]);
});

test("lineDiff: equal texts are all same", () => {
  assert.deepEqual(lineDiff("a\nb", "a\nb"), [same("a"), same("b")]);
});

test("lineDiff: an empty line in the middle is a line like any other", () => {
  assert.deepEqual(lineDiff("a\n\nb", "a\nb"), [same("a"), del(""), same("b")]);
  assert.deepEqual(lineDiff("a\nb", "a\n\nb"), [same("a"), add(""), same("b")]);
});

test("lineDiff: \\r\\n and \\n line breaks compare equal", () => {
  assert.deepEqual(lineDiff("a\r\nb\r\nc", "a\nb\nc"), [same("a"), same("b"), same("c")]);
  assert.deepEqual(lineDiff("a\r\nb\r\nc", "a\r\nx\r\nc"), [same("a"), del("b"), add("x"), same("c")]);
  assert.deepEqual(lineDiff("a\nb", "a\r\nb\r\nc"), [same("a"), same("b"), add("c")]);
});

test("lineDiff: lines compare exactly, whitespace and all", () => {
  assert.deepEqual(lineDiff("a\n b", "a\nb"), [same("a"), del(" b"), add("b")]);
  assert.deepEqual(lineDiff("a ", "a"), [del("a "), add("a")]);
});

test("lineDiff: insertions and deletions at the ends", () => {
  assert.deepEqual(lineDiff("b\nc", "a\nb\nc\nd"), [add("a"), same("b"), same("c"), add("d")]);
  assert.deepEqual(lineDiff("a\nb\nc\nd", "b\nc"), [del("a"), same("b"), same("c"), del("d")]);
});

test("lineDiff: a line that moved is found through the LCS, not as a whole rewrite", () => {
  assert.deepEqual(lineDiff("a\nb\nc\nd", "b\nc\nd\na"), [del("a"), same("b"), same("c"), same("d"), add("a")]);
  assert.deepEqual(lineDiff("x\na\ny\nb\nz", "a\nb"), [del("x"), same("a"), del("y"), same("b"), del("z")]);
});

test("lineDiff: within a changed region every del comes before the adds", () => {
  assert.deepEqual(lineDiff("a\nb\nc\nd\ne", "a\nX\nY\nZ\ne"), [same("a"), del("b"), del("c"), del("d"), add("X"), add("Y"), add("Z"), same("e")]);
  // Two regions apart: each gets its own del-then-add order.
  assert.deepEqual(lineDiff("a\nb\nc\nd\ne", "a\nB\nc\nD\ne"), [same("a"), del("b"), add("B"), same("c"), del("d"), add("D"), same("e")]);
  // An interleaving the LCS walk could otherwise produce still comes out del-first.
  const ops = lineDiff("p\nq\nr\ns\nt", "q\nx\ns\ny\nt2");
  let seenAdd = false;
  for (const o of ops) {
    if (o.op === "same") seenAdd = false;
    else if (o.op === "add") seenAdd = true;
    else assert.equal(seenAdd, false, `del after add in ${JSON.stringify(ops)}`);
  }
});

test("lineDiff: replaying the ops rebuilds both texts", () => {
  const before = "title\n\nsteps:\n1. open\n2. click\n3. save\n\nnotes\nold note";
  const after = "title\n\nsteps:\n1. open\n2. press enter\n3. save\n4. close\n\nnotes\nnew note\nmore";
  const ops = lineDiff(before, after);
  assert.equal(ops.filter((o) => o.op !== "add").map((o) => o.text).join("\n"), before);
  assert.equal(ops.filter((o) => o.op !== "del").map((o) => o.text).join("\n"), after);
});

test("lineDiff: past 2000 x 2000 changed lines the middle is all del, then all add", () => {
  // 2001 lines each, nothing shared at the ends, one line shared in the middle: an LCS would keep it as same.
  const before = [...lines("old ", 1000), "keep", ...lines("old2 ", 1000)];
  const after = [...lines("new ", 1000), "keep", ...lines("new2 ", 1000)];
  const t = performance.now();
  const ops = lineDiff(before.join("\n"), after.join("\n"));
  assert.ok(performance.now() - t < 500);
  assert.equal(ops.length, 4002);
  assert.deepEqual(ops.slice(0, 2001), before.map(del));
  assert.deepEqual(ops.slice(2001), after.map(add));
  assert.deepEqual(diffStats(ops), { added: 2001, removed: 2001 });
});

test("lineDiff: the size limit counts the middle only, after the common ends are trimmed", () => {
  // 5000 lines each, but only 3 differ in the middle: the LCS runs on that and finds the shared line.
  const head = lines("head ", 2500), tail = lines("tail ", 2500);
  const before = [...head, "a", "keep", "b", ...tail].join("\n");
  const after = [...head, "x", "keep", "y", ...tail].join("\n");
  const ops = lineDiff(before, after);
  assert.equal(ops.length, 2500 + 5 + 2500);
  assert.deepEqual(ops.slice(2500, 2505), [del("a"), add("x"), same("keep"), del("b"), add("y")]);
  assert.deepEqual(diffStats(ops), { added: 2, removed: 2 });
});

test("lineDiff: exactly 2000 x 2000 changed lines still gets the LCS", () => {
  const before = [...lines("old ", 1000), "keep", ...lines("old2 ", 999)];
  const after = [...lines("new ", 1000), "keep", ...lines("new2 ", 999)];
  assert.equal(before.length * after.length, 2000 * 2000);
  const t = performance.now();
  const ops = lineDiff(before.join("\n"), after.join("\n"));
  assert.ok(performance.now() - t < 1000);
  assert.equal(ops.filter((o) => o.op === "same").length, 1);
  assert.deepEqual(ops[2000], same("keep"));
  assert.deepEqual(diffStats(ops), { added: 1999, removed: 1999 });
});

test("lineDiff: one side huge and the other tiny is under the limit and diffs normally", () => {
  const big = lines("line ", 100000);
  const ops = lineDiff(big.join("\n"), "line 7\nline 50000\nbrand new");
  assert.equal(ops.filter((o) => o.op === "same").length, 2);
  assert.deepEqual(diffStats(ops), { added: 1, removed: 99998 });
});

test("diffStats: counts the added and removed lines", () => {
  assert.deepEqual(diffStats([same("a"), del("b"), add("x"), add("y"), same("c")]), { added: 2, removed: 1 });
  assert.deepEqual(diffStats([]), { added: 0, removed: 0 });
  assert.deepEqual(diffStats(lineDiff("a\nb", "a\nb")), { added: 0, removed: 0 });
});
