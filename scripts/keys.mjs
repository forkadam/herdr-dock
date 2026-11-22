export { mergeKeys } from "../src/shared/keys.js";

// The dock's keys.json section and bindings: deploy merges them into the app home's keys.json, build:app writes
// them as app/keys.json (and update-app adds the missing ones from that file).
export const SECTION = "layout:herdr-dock";
export const BINDINGS = [["ctrl-alt-b", "dock-core.cycle"], ["ctrl-alt-,", "dock-core.config"], ["ctrl-alt-n", "dock-core.right"], ["ctrl-alt-p", "dock-core.page"]];
