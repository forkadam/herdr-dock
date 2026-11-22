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

// The command that opens a folder in the file manager (Explorer wants backslashes).
export function openFolderCommand(platform, path) {
  if (platform === "windows") return { command: "explorer", args: [String(path).replace(/\//g, "\\")] };
  if (platform === "macos") return { command: "open", args: [path] };
  return { command: "xdg-open", args: [path] };
}

// The command that lists the files (not folders) in `dir`.
export function listFilesCommand(platform, dir) {
  if (platform === "windows") return { command: "cmd", args: ["/c", "dir", "/b", "/a-d", dir.replaceAll("/", "\\")] };
  return { command: "ls", args: ["-1", "-p", dir] };
}

// The command that lists the files in `dir`, most recently modified first (parse with parseFileListing).
export function listFilesByTimeCommand(platform, dir) {
  if (platform === "windows") return { command: "cmd", args: ["/c", "dir", "/b", "/a-d", "/o-d", "/t:w", dir.replaceAll("/", "\\")] };
  return { command: "ls", args: ["-1", "-t", "-p", dir] };
}

// The command that prints only the lines of `file` containing "rate_limits" (a Codex session log can be
// many MB; Herdr's readTextFile stops at 1 MiB, exec output at 8 MiB). Exit 1 means no such line.
export function rateLimitLinesCommand(platform, file) {
  if (platform === "windows") return { command: "findstr", args: ["/l", "/c:rate_limits", file.replaceAll("/", "\\")] };
  return { command: "grep", args: ["-F", "rate_limits", file] };
}

// listFilesCommand's stdout -> file names (macOS/Linux: entries ending in "/" are folders, dropped).
export function parseFileListing(platform, stdout) {
  const names = String(stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return platform === "windows" ? names : names.filter((n) => !n.endsWith("/"));
}
