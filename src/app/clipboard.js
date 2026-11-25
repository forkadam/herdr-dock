// The Render panel's formatted copy: HTML and its plain text as one macOS pasteboard item, so a paste into Jira,
// Confluence or an email keeps the formatting and a paste into a plain field gets the text. A mod can only write plain
// text (cx.write_to_clipboard), so the helper runs osascript's JavaScript with the payload on stdin. The script is
// prismantis 0.20.0's MAC_TABLE_COPY (hooks/clipboard.ts), https://github.com/NahumLitvin/prismantis (MIT).
import { spawnSync } from "node:child_process";

export const MAC_HTML_COPY = `
ObjC.import('AppKit')
var input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
var payload = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding)))
var item = $.NSPasteboardItem.alloc.init
if (!item.setStringForType(payload.html, $.NSPasteboardTypeHTML) ||
    !item.setStringForType(payload.text, $.NSPasteboardTypeString)) throw new Error('Cannot encode copy')
var pasteboard = $.NSPasteboard.generalPasteboard
if (!pasteboard || !pasteboard.writeObjects) throw new Error('macOS clipboard is unavailable to this session')
pasteboard.clearContents
if (!pasteboard.writeObjects($.NSArray.arrayWithObject(item))) throw new Error('Cannot write clipboard')
if (ObjC.unwrap(pasteboard.stringForType($.NSPasteboardTypeHTML)) !== payload.html ||
    ObjC.unwrap(pasteboard.stringForType($.NSPasteboardTypeString)) !== payload.text) throw new Error('Clipboard verification failed')
`;

const runOsascript = (cmd, args, input) => spawnSync(cmd, args, { input, encoding: "utf8", timeout: 5000 });

// { html, text } onto the clipboard -> { ok: true } | { ok: false, error }.
export function copyHtml({ html, text }, { platform = process.platform, run = runOsascript } = {}) {
  if (platform !== "darwin") return { ok: false, error: "formatted copy works on macOS only" };
  const r = run("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_HTML_COPY], JSON.stringify({ html, text }));
  if (r?.status === 0 && !r.error) return { ok: true };
  const why = String(r?.stderr ?? "").trim().split("\n")[0] || r?.error?.message || `osascript exited ${r?.status}`;
  return { ok: false, error: why.slice(0, 200) };
}
