// How a mod asks dock-core (which runs the git/CI collector) to do something. Bundled into each mod that
// imports it.
//   gitCommand("git.refresh")                         re-poll every repo and pipeline now
//   gitCommand("git.retry")                           retry the selected pipeline
//   gitCommand("git.open")                            open the selected pipeline in the browser
//   gitCommand("git.open.job", { index })             open failed job `index` of dock.git.detail.pipeline.failedJobs
//   gitCommand("git.select", { worktree })            select a worktree (dock.git.selected, dock.git.detail)
//   gitCommand("git.show", { worktree })              select it and reveal dock-pipelines (no worktree: the selection)
// Herdr drops run()'s args for mod commands, so gitCommandName puts them in the command name.
import { run } from "herdr";
import { gitCommandName } from "../shared/gitcmd.js";

export function gitCommand(name, args) {
  run(`dock-core.${gitCommandName(name, args)}`);
}
