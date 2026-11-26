import { test } from "node:test";
import assert from "node:assert/strict";
import { readLimit, pauseFor, isLow, cliLimited, lru } from "../src/shared/ci-budget.js";

const headers = (o) => (name) => o[name];

test("readLimit: GitHub and GitLab headers", () => {
  const want = { remaining: 4321, limit: 5000, resetAt: 1795707975000 };
  assert.deepEqual(readLimit(headers({ "x-ratelimit-remaining": "4321", "x-ratelimit-limit": "5000", "x-ratelimit-reset": "1795707975" }), "github"), want);
  assert.deepEqual(readLimit(headers({ "ratelimit-remaining": "4321", "ratelimit-limit": "5000", "ratelimit-reset": "1795707975" }), "gitlab"), want);
});

test("readLimit: missing or non-numeric gives null", () => {
  assert.equal(readLimit(headers({}), "github"), null);
  assert.equal(readLimit(headers({ "x-ratelimit-remaining": "abc", "x-ratelimit-limit": "5000" }), "github"), null);
  assert.equal(readLimit(headers({ "ratelimit-remaining": "5", "ratelimit-limit": "abc" }), "gitlab"), null);
});

test("pauseFor", () => {
  const now = 1000000;
  assert.equal(pauseFor({ status: 429, now }), 60000);
  assert.equal(pauseFor({ status: 429, retryAfter: 12, now }), 12000);
  assert.equal(pauseFor({ status: 403, remaining: 0, resetAt: now + 90000, now }), 90000);
  assert.equal(pauseFor({ status: 403, remaining: 5, now }), 0);
  assert.equal(pauseFor({ status: 503, retryAfter: 30, now }), 0);
  assert.equal(pauseFor({ status: 429, resetAt: now - 5000, now }), 30000);
});

test("isLow", () => {
  assert.equal(isLow({ remaining: 499, limit: 5000 }), true);
  assert.equal(isLow({ remaining: 500, limit: 5000 }), false);
  assert.equal(isLow(null), false);
});

test("cliLimited", () => {
  assert.equal(cliLimited("HTTP 403: API rate limit exceeded for user"), true);
  assert.equal(cliLimited("429 Too Many Requests"), true);
  assert.equal(cliLimited("HTTP 404: Not Found"), false);
});

test("lru drops the least recently used", () => {
  const c = lru(2);
  c.set("a", 1); c.set("b", 2);
  assert.equal(c.get("a"), 1);
  c.set("c", 3);
  assert.equal(c.get("b"), undefined);
  assert.equal(c.get("a"), 1);
  assert.equal(c.size, 2);
  c.delete("a");
  assert.equal(c.size, 1);
});

test("cliLimited: a bare 429 inside a URL or id is not a limit", () => {
  assert.equal(cliLimited("HTTP 404: Not Found (https://api.github.com/repos/a/b/actions/runs/429)"), false);
  assert.equal(cliLimited("HTTP 429: slow down"), true);
  assert.equal(cliLimited("429 Too Many Requests"), true);
});

test("readLimit: no reset header keeps the pair; pauseFor falls to retryAfter", () => {
  assert.deepEqual(readLimit(headers({ "x-ratelimit-remaining": "5", "x-ratelimit-limit": "10" }), "github"), { remaining: 5, limit: 10, resetAt: null });
  assert.equal(pauseFor({ status: 429, resetAt: null, retryAfter: 7, now: 1000 }), 7000);
});

test("readLimit: only plain non-negative integers count", () => {
  for (const bad of ["0x10", "1e3", "-1", "1.5", ""]) {
    assert.equal(readLimit(headers({ "x-ratelimit-remaining": bad, "x-ratelimit-limit": "10" }), "github"), null, bad);
    assert.equal(readLimit(headers({ "x-ratelimit-remaining": "5", "x-ratelimit-limit": bad }), "github"), null, bad);
  }
  assert.deepEqual(readLimit(headers({ "x-ratelimit-remaining": " 5 ", "x-ratelimit-limit": "10", "x-ratelimit-reset": "0x10" }), "github"), { remaining: 5, limit: 10, resetAt: null });
});

test("pauseFor: a string remaining of 0 still pauses a 403", () => {
  assert.equal(pauseFor({ status: 403, remaining: "0", resetAt: 91000, now: 1000 }), 90000);
});

test("lru: setting an existing key refreshes its order without growing", () => {
  const c = lru(2);
  c.set("a", 1); c.set("b", 2); c.set("a", 3); c.set("c", 4);
  assert.equal(c.get("b"), undefined);
  assert.equal(c.get("a"), 3);
  assert.equal(c.size, 2);
});
