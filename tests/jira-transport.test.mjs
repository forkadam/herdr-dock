// How the Jira page sends a request (src/shared/jira/transport.js): Herdr's fetch, or curl with the token only in a
// private config file.
import test from "node:test";
import assert from "node:assert/strict";
import { curlArgs, curlConfig, fetchRequest, parseCurl, parseJson } from "../src/shared/jira/transport.js";

const TOKENS = ["mock-token", "NDk0MjE3OTc2NjE0OkYqv2r+abc/def==", 'we"ird\\tok', "a b"];

test("fetchRequest: Bearer token, JSON headers, a JSON body only when there is one", () => {
  const r = fetchRequest({ url: "https://j/rest/api/2/myself", token: " t0k " });
  assert.equal(r.url, "https://j/rest/api/2/myself");
  assert.equal(r.options.method, "GET");
  assert.equal(r.options.headers.Authorization, "Bearer t0k");
  assert.equal(r.options.headers.Accept, "application/json");
  assert.equal("Content-Type" in r.options.headers, false);
  assert.equal(r.options.body, undefined);
  const p = fetchRequest({ method: "POST", url: "u", token: "t", body: { body: "hi" } });
  assert.equal(p.options.headers["Content-Type"], "application/json");
  assert.equal(p.options.body, '{"body":"hi"}');
});

test("curlArgs never contain the token; the -K config file carries it", () => {
  for (const token of TOKENS) {
    const args = curlArgs({ method: "POST", url: "https://j/rest/api/2/issue/A-1/comment", configPath: "/s/jira-work.curlrc", body: { body: "x" } });
    assert.ok(!args.join(" ").includes(token), token);
    assert.ok(!args.some((a) => /authorization/i.test(a)));
    const k = args.indexOf("-K");
    assert.equal(args[k + 1], "/s/jira-work.curlrc");
    assert.ok(curlConfig(token).includes("Authorization: Bearer"));
  }
});

test("curlArgs: method, JSON body, timeout, status line, URL last; a CA file when given", () => {
  const get = curlArgs({ url: "https://j/x?a=[1]", configPath: "/c" });
  assert.deepEqual(get.slice(0, 2), ["-sS", "--globoff"]);
  assert.equal(get.at(-1), "https://j/x?a=[1]");
  assert.equal(get[get.indexOf("-X") + 1], "GET");
  assert.equal(get[get.indexOf("--max-time") + 1], "20");
  assert.equal(get[get.indexOf("-w") + 1], "\n%{http_code}");
  assert.equal(get.includes("--data-binary"), false);
  assert.equal(get.includes("--cacert"), false);
  const put = curlArgs({ method: "PUT", url: "u", configPath: "/c", body: { name: "me" }, timeoutMs: 5000, caFile: "/etc/corp-ca.pem" });
  assert.equal(put[put.indexOf("--data-binary") + 1], '{"name":"me"}');
  assert.ok(put.includes("Content-Type: application/json"));
  assert.equal(put[put.indexOf("--max-time") + 1], "5");
  assert.equal(put[put.indexOf("--cacert") + 1], "/etc/corp-ca.pem");
});

test("curlConfig escapes quotes and backslashes and drops line breaks", () => {
  assert.equal(curlConfig('a"b\\c\nd'), 'header = "Authorization: Bearer a\\"b\\\\cd"\n');
  assert.equal(curlConfig("  t  "), 'header = "Authorization: Bearer t"\n');
});

test("parseCurl: the body and the status from -w; a failed curl's exit code", () => {
  assert.deepEqual(parseCurl({ code: 0, stdout: '{"a":1}\n200', stderr: "" }), { status: 200, text: '{"a":1}' });
  assert.deepEqual(parseCurl({ code: 0, stdout: "\n204", stderr: "" }), { status: 204, text: "" });
  assert.deepEqual(parseCurl({ code: 0, stdout: "line1\nline2\n401", stderr: "" }), { status: 401, text: "line1\nline2" });
  assert.deepEqual(parseCurl({ code: 7, stdout: "", stderr: "curl: (7) Failed to connect" }), { curlCode: 7, stderr: "curl: (7) Failed to connect" });
  assert.deepEqual(parseCurl({ code: 0, stdout: "no status", stderr: "" }), { curlCode: -1, stderr: "curl printed no status" });
});

test("parseJson: JSON or null", () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.equal(parseJson(""), null);
  assert.equal(parseJson("<html>"), null);
});
