import { join, resolve } from "node:path";
import { homedir } from "node:os";

// The Herdr app home: --app-home <dir>, else $HERDR_APP_HOME, else ~/.config/herdr-app. null when --app-home has no value.
export function resolveAppHome(args, env = process.env) {
  const ai = args.indexOf("--app-home");
  if (ai >= 0 && (!args[ai + 1] || args[ai + 1].startsWith("--"))) return null;
  return resolve(ai >= 0 ? args[ai + 1] : env.HERDR_APP_HOME || join(homedir(), ".config/herdr-app"));
}
