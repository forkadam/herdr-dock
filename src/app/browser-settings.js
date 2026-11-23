// The browser settings of an install: dock-core's source.json -> config, plus the local file; defaults if unreadable.
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { mergeWithLocal, parseConfig, parseLocal, LOCAL_REL } from "../shared/config.js";
import { installOf } from "../shared/install.js";
import { browserOf } from "../shared/browser/config.js";

const readText = (path) => { try { return readFileSync(path, "utf8"); } catch { return null; } };

// Merged browser settings for the app home `home` (a slash path).
export function browserSettings(home) {
  try {
    const src = JSON.parse(readText(join(home, "mods/dock-core/source.json")));
    const inst = installOf(src, home);
    const parsed = parseConfig(readText(inst.configPath));
    if (!parsed.ok) return browserOf(null);
    const local = parseLocal(readText(join(home, LOCAL_REL)));
    return browserOf(mergeWithLocal(parsed.config, hostname().toLowerCase(), local.ok ? local.local : null));
  } catch { return browserOf(null); }
}
