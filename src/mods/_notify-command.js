// How a mod asks dock-core (the one writer of dock.notify.history) to change the notification history.
// Bundled into each mod that imports it.
//   notifyCommand("notify.add", { n })     record a toast: n is its props { title, body, level, icon, action }
//   notifyCommand("notify.clear", { id })  remove one item
//   notifyCommand("notify.clearall")       remove every item
//   notifyCommand("notify.clearfilter", { filter })  remove the items a panel filter shows (shared/notify.js FILTERS)
//   notifyCommand("notify.read")           mark every item read
//   notifyCommand("notify.show")           mark every item read and reveal dock-notifications
// Herdr drops run()'s args for mod commands, so notifyCommandName puts them in the command name.
import { run } from "herdr";
import { notifyCommandName } from "../shared/notifycmd.js";

export function notifyCommand(name, args) {
  run(`dock-core.${notifyCommandName(name, args)}`);
}
