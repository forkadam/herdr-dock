// A stand-in for agent-browser in tests: logs its argv (one JSON line) to $FAKE_AB_LOG and answers the few queries
// browse makes. FAKE_AB_URL is the page's url, FAKE_AB_EXIT the exit code.
import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.FAKE_AB_LOG) appendFileSync(process.env.FAKE_AB_LOG, JSON.stringify(argv) + "\n");
const words = argv.filter((a, i) => !a.startsWith("-") && !["--session", "--state", "--executable-path"].includes(argv[i - 1]));
const line = words.join(" ");
if (line.startsWith("stream status")) console.log(JSON.stringify({ success: true, data: { port: 4567 } }));
else if (line === "get url") console.log(process.env.FAKE_AB_URL ?? "http://localhost:3000/");
else if (line === "get title") console.log("Title");
else if (process.env.FAKE_AB_OUT) console.log(process.env.FAKE_AB_OUT);
process.exit(Number(process.env.FAKE_AB_EXIT ?? 0));
