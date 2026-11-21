// OS-specific choices (pure; no Node built-ins).

// The command that prints this computer's hostname. platform: window().platform
// ("linux" | "macos" | "windows"). Linux may lack `hostname`; `uname -n` is always there.
export function hostnameCommand(platform) {
  return platform === "linux" ? { command: "uname", args: ["-n"] } : { command: "hostname", args: [] };
}
