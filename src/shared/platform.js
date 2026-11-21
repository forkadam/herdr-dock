// OS-specific choices (pure; no Node built-ins).

// The command that prints this computer's hostname. platform: window().platform
// ("linux" | "macos" | "windows"). Linux may lack `hostname`; `uname -n` is always there.
export function hostnameCommand(platform) {
  return platform === "linux" ? { command: "uname", args: ["-n"] } : { command: "hostname", args: [] };
}

// The command that lists the sub-folders of dir (one name per line). On Windows `dir /b /ad`
// wants backslashes; elsewhere `ls -1 -p` marks folders with a trailing "/".
export function listDirCommand(platform, dir) {
  if (platform === "windows") return { command: "cmd", args: ["/c", "dir", "/b", "/ad", dir.replaceAll("/", "\\")] };
  return { command: "ls", args: ["-1", "-p", dir] };
}

// Folder names out of listDirCommand's stdout.
export function parseDirListing(platform, stdout) {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (platform === "windows") return lines;
  return lines.filter((l) => l.endsWith("/")).map((l) => l.slice(0, -1));
}

// The command that opens url in the default browser.
export function openUrlCommand(platform, url) {
  if (platform === "windows") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "macos") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}
