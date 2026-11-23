// Parsing of `dock browse` arguments and the agent-browser words the agent may not use (pure).

export class UsageError extends Error {
  constructor(message) { super(message); this.name = "UsageError"; }
}

const need = (v, msg) => { if (!v) throw new UsageError(msg); return v; };

export function parseBrowse(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined: case "help": case "--help": case "-h": return { cmd: "help" };
    case "wait": case "status": case "close": return { cmd };
    case "open": {
      let profile = "clean";
      const pos = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--profile") {
          profile = rest[++i];
          if (profile !== "clean" && profile !== "signed-in") throw new UsageError("--profile must be clean or signed-in");
        } else pos.push(rest[i]);
      }
      return { cmd, profile, url: need(pos[0], "usage: browse open [--profile clean|signed-in] <url>") };
    }
    case "action": {
      const args = rest[0] === "--" ? rest.slice(1) : rest;
      if (!args.length) throw new UsageError("usage: browse action -- <agent-browser command...>");
      return { cmd, args };
    }
    case "handoff": return { cmd, message: need(rest.join(" ").trim(), "usage: browse handoff <message>") };
    case "login": return { cmd, url: need(rest[0], "usage: browse login <url>") };
    case "window-open": case "window-done": {
      const i = rest.indexOf("--terminal");
      return { cmd, terminal: need(i >= 0 && rest[i + 1], `usage: browse ${cmd} --terminal <id>`) };
    }
    default: throw new UsageError(`unknown browse command: ${cmd}`);
  }
}

const REASONS = {
  close: "close is not allowed: the person's browser stays open (use `browse close` to end it)",
  connect: "connect is not allowed: this browser is managed by herdr-dock",
};
const FLAGS = ["--cdp", "--session", "--profile", "--state", "--auto-connect", "-p", "--provider"];

// The reason an agent-browser command is refused, or null.
export function refused(args) {
  const word = args.find((a) => !a.startsWith("-"));
  if (REASONS[word]) return REASONS[word];
  for (const a of args) {
    const flag = a.startsWith("--") ? a.split("=")[0] : a;
    if (FLAGS.includes(flag)) return `${flag} is not allowed: this browser is managed by herdr-dock`;
  }
  return null;
}
