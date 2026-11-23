// A stand-in for agent-browser in tests: logs its argv (one JSON line) to $FAKE_AB_LOG and answers the few queries
// browse makes. FAKE_AB_URL is the page's url, FAKE_AB_EXIT the exit code. `state save <file>` writes a state with one
// cookie; FAKE_AB_STATE "empty" writes none, "fail" writes nothing and exits 1, "relaunched" saves from a browser
// launched for the save (the window was closed: --json's lifecycle says so). FAKE_AB_OPEN_EXIT is open's exit code.
import { appendFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.FAKE_AB_LOG) appendFileSync(process.env.FAKE_AB_LOG, JSON.stringify(argv) + "\n");
const words = argv.filter((a, i) => !a.startsWith("-") && !["--session", "--state", "--executable-path"].includes(argv[i - 1]));
const line = words.join(" ");
if (words[0] === "state" && words[1] === "save") {
  if (process.env.FAKE_AB_STATE === "fail") process.exit(1);
  const cookies = process.env.FAKE_AB_STATE === "empty" ? [] : [{ name: "sid", value: "x", domain: "example.com" }];
  writeFileSync(words[2], JSON.stringify({ cookies, origins: [] }));
  const launched = process.env.FAKE_AB_STATE === "relaunched";
  if (argv.includes("--json")) console.log(JSON.stringify({ success: true, data: { lifecycle: { launched, reused: !launched }, path: words[2], saved: true }, error: null }));
} else if (words[0] === "open" && process.env.FAKE_AB_OPEN_EXIT) process.exit(Number(process.env.FAKE_AB_OPEN_EXIT));
else if (line.startsWith("stream status")) console.log(JSON.stringify({ success: true, data: { port: 4567 } }));
else if (line === "get url") console.log(process.env.FAKE_AB_URL ?? "http://localhost:3000/");
else if (line === "get title") console.log("Title");
else if (process.env.FAKE_AB_OUT) console.log(process.env.FAKE_AB_OUT);
process.exit(Number(process.env.FAKE_AB_EXIT ?? 0));
