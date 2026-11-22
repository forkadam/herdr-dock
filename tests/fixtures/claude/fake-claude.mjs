#!/usr/bin/env node
// A stand-in for `claude -p --input-format stream-json ...`: reads the control request from stdin and answers like
// Claude Code 2.1 does. FAKE_CLAUDE=silent never answers; FAKE_CLAUDE=error answers with an error subtype.
let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  const req = JSON.parse(input.trim().split("\n")[0]);
  if (process.env.FAKE_CLAUDE === "silent") { setTimeout(() => {}, 60000); return; }
  console.log(JSON.stringify({ type: "system", subtype: "init" }));
  if (process.env.FAKE_CLAUDE === "error") {
    console.log(JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: req.request_id, error: "not logged in" } }));
    return;
  }
  console.log(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: req.request_id, response: {
    subscription_type: "team", session: { secret: "x" },
    rate_limits: {
      five_hour: { utilization: 14, resets_at: "2026-11-22T16:09:59.773743+00:00", limit_dollars: null },
      seven_day: { utilization: 20, resets_at: "2026-11-27T19:59:59.773759+00:00" },
      seven_day_opus: null, seven_day_sonnet: { utilization: 5, resets_at: "2026-11-27T20:00:00+00:00" },
      model_scoped: [{ display_name: "Fable", utilization: 0, resets_at: "2026-11-27T20:00:00+00:00" }],
      spend: { should: "not be passed on" },
    },
  } } }));
});
